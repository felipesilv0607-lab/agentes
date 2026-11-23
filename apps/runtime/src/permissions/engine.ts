/**
 * Permission Engine do runtime: decide, com NEGAÇÃO POR PADRÃO, se um agente
 * do catálogo pode executar uma ação. É o componente DESTINADO a ser a barreira
 * de permissões do runtime, mas HOJE APENAS DECIDE: nenhum executor o consulta,
 * logo não é barreira comprovada (Blocos 5 e 6). Não depende de
 * `scripts/agent-scope-check.mjs`.
 *
 * Regras desta etapa (Bloco 2):
 * - agente desconhecido, ação desconhecida ou dado malformado → negado;
 * - publicação (commit, push, PR, deploy, workflow_dispatch, release) → sempre negada;
 * - escrita no repositório original → sempre negada, para qualquer agente;
 * - escrita em workspace isolado → negada enquanto o isolamento estiver
 *   desativado (Arquitetura B ainda não aprovada). Quando ativado, exige papel
 *   com escrita, caminho seguro, caminho no `writeScope` e fora da governança;
 * - leitura → permitida a qualquer agente do catálogo para caminho seguro, fora
 *   de segredos e metadados;
 * - execução de comandos, rede e chamada de modelos → negadas (capacidades ainda
 *   não implementadas; liberação exige bloco próprio).
 *
 * O motor só DECIDE. Quem executa ações (ferramentas, Blocos 5 e 6) deve
 * consultá-lo antes de cada ação, tratar qualquer erro como negação e usar
 * EXATAMENTE o caminho devolvido em `decision.path` (lido uma única vez da ação).
 */

import { compileScope, unsafePathReason } from "./paths.ts";

export const PUBLISH_OPERATIONS = ["commit", "push", "pull-request", "deploy", "workflow-dispatch", "release"] as const;
export type PublishOperation = (typeof PUBLISH_OPERATIONS)[number];

export type PermissionAction =
  | { kind: "read"; path: string }
  | { kind: "write"; target: "original-repository" | "isolated-workspace"; path: string }
  | { kind: "publish"; operation: PublishOperation }
  | { kind: "execute"; command: string }
  | { kind: "network"; host: string }
  | { kind: "model"; provider: string };

export interface PermissionDecision {
  allowed: boolean;
  /** Identificador estável da regra aplicada (para auditoria). */
  rule: string;
  reason: string;
  /** Caminho aprovado (somente em leitura/escrita permitidas): o executor deve usar exatamente este valor. */
  path?: string;
}

/** Arquivos de governança: escrita sempre negada, inclusive para `workspace-write` (sem diferenciar caixa). */
export const GOVERNANCE_GLOBS: readonly string[] = Object.freeze([
  "**/AGENTS.md",
  "**/AGENTS.override.md",
  "standards/**",
  "packages/agent-catalog/**",
  "packages/contracts/**",
  ".codex/**",
  "apps/dashboard/src/data/agentCatalog.ts",
  "apps/dashboard/src/types/agent.ts",
  "apps/runtime/src/permissions/**",
  "apps/runtime/src/config.ts",
  "scripts/agent-catalog.test.mjs",
  "scripts/agent-adapters.test.mjs",
  "scripts/agent-scope-check.mjs",
  "scripts/agent-scope-check.test.mjs",
  "scripts/security-baseline.test.mjs",
  "scripts/generate-agent-adapters.mjs",
  "apps/runtime/test/permissions.test.ts",
]);

/** Leitura negada: segredos, credenciais e metadados (sem diferenciar caixa). */
export const READ_DENY_GLOBS: readonly string[] = Object.freeze([
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.npmrc",
  "**/.netrc",
  "**/credentials*",
  "**/secrets*",
  "**/node_modules/**",
]);

export interface PermissionAgent {
  id: string;
  accessMode: string;
  writeScope: readonly string[];
}

export interface PermissionEngineOptions {
  isolationEnabled: boolean;
}

export interface PermissionEngine {
  evaluate(agentId: unknown, action: unknown): PermissionDecision;
}

const deny = (rule: string, reason: string): PermissionDecision => ({ allowed: false, rule, reason });
const allow = (rule: string, reason: string, path: string): PermissionDecision => ({ allowed: true, rule, reason, path });

const WRITER_MODES = new Set(["workspace-write", "tests-only", "ci-cd-without-publish", "docs-only"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createPermissionEngine(agents: readonly PermissionAgent[], options: PermissionEngineOptions): PermissionEngine {
  const isGovernance = compileScope(GOVERNANCE_GLOBS, true);
  const isReadDenied = compileScope(READ_DENY_GLOBS, true);
  const byId = new Map(
    agents.map((agent) => [
      agent.id,
      { ...agent, inScope: compileScope(agent.writeScope), inScopeIgnoringCase: compileScope(agent.writeScope, true) },
    ]),
  );
  const isolationEnabled = options.isolationEnabled === true;

  function evaluateUnsafe(agentId: unknown, action: unknown): PermissionDecision {
    if (typeof agentId !== "string" || !byId.has(agentId)) return deny("unknown-agent", "agente fora do catálogo");
    const agent = byId.get(agentId)!;
    if (!isRecord(action)) return deny("malformed-action", "ação malformada");
    // Cada propriedade é lida UMA única vez para valores primitivos: getters ou
    // proxies não conseguem mostrar um valor na validação e outro no uso.
    const kind: unknown = action.kind;
    const target: unknown = action.target;
    const rawPath: unknown = action.path;
    if (typeof kind !== "string") return deny("malformed-action", "ação malformada");

    switch (kind) {
      case "publish":
        return deny("publish-forbidden", "nenhum agente tem autoridade própria para publicar (commit, push, PR, deploy, workflow_dispatch)");

      case "execute":
      case "network":
      case "model":
        return deny("capability-disabled", `capacidade '${kind}' não habilitada nesta etapa`);

      case "read": {
        if (typeof rawPath !== "string") return deny("unsafe-path", "caminho vazio ou não textual");
        const reason = unsafePathReason(rawPath);
        if (reason) return deny("unsafe-path", reason);
        if (isReadDenied(rawPath)) return deny("secret-path", "leitura de segredos, credenciais ou dependências é negada");
        return allow("read-allowed", "leitura de caminho seguro do repositório", rawPath);
      }

      case "write": {
        if (target === "original-repository") {
          return deny("original-repository-read-only", "agentes nunca escrevem no repositório original (a coleta de alterações com aprovação humana ainda não está implementada)");
        }
        if (target !== "isolated-workspace") return deny("malformed-action", "destino de escrita desconhecido");
        if (!isolationEnabled) return deny("isolation-unavailable", "isolamento (Arquitetura B) desativado; nenhuma escrita é permitida");
        if (!WRITER_MODES.has(agent.accessMode)) return deny("read-only-agent", `agente ${agent.id} é somente leitura`);
        if (typeof rawPath !== "string") return deny("unsafe-path", "caminho vazio ou não textual");
        const reason = unsafePathReason(rawPath);
        if (reason) return deny("unsafe-path", reason);
        if (isGovernance(rawPath)) return deny("governance-path", "arquivo de governança: alteração só por humano");
        if (agent.inScope(rawPath)) return allow("write-in-scope", "caminho dentro do escopo do papel, em workspace isolado", rawPath);
        if (agent.inScopeIgnoringCase(rawPath)) return deny("case-mismatch", "caminho difere do escopo só em maiúsculas/minúsculas");
        return deny("out-of-scope", `caminho fora do escopo de escrita de ${agent.id}`);
      }

      default:
        return deny("unknown-action", "tipo de ação desconhecido");
    }
  }

  return Object.freeze({
    evaluate(agentId: unknown, action: unknown): PermissionDecision {
      try {
        return evaluateUnsafe(agentId, action);
      } catch {
        return deny("evaluation-error", "erro ao avaliar a permissão (falha fechada)");
      }
    },
  });
}
