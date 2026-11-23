/**
 * Adaptadores gerados a partir do catálogo neutro (funções puras).
 *
 * - Codex (TEMPORÁRIO): `.codex/agents/<id>.toml`. Mantido somente durante a
 *   migração, para preservar as nove configurações antigas byte a byte. Recebe
 *   as instruções LEGADAS congeladas (`adapters/codex/instructions`), nunca as
 *   neutras do runtime. Será removido quando o runtime próprio substituir o
 *   Codex (ver ADR 0001).
 * - Dashboard: `apps/dashboard/src/data/agentCatalog.ts`. O dashboard não importa
 *   este pacote (o Vite não serve arquivos fora de `apps/dashboard`); por isso
 *   recebe uma cópia gerada, sem as instruções, que não entram no bundle público.
 *
 * `scripts/generate-agent-adapters.mjs` grava ou confere os arquivos.
 */

import type { CatalogAgent, CatalogAgentWithInstructions } from "./catalog.ts";

export const CODEX_LAYOUT_SCHEMA_VERSION = 1;

/** Forma de cada TOML antigo que não pertence ao catálogo neutro (comentários e final do arquivo). */
export interface CodexAgentLayout {
  header: string;
  trailingNewline: boolean;
}

export interface CodexLayoutData {
  schemaVersion: number;
  agents: Readonly<Record<string, CodexAgentLayout>>;
}

export function validateCodexLayout(data: unknown, agentIds: readonly string[]): string[] {
  const errors: string[] = [];
  if (data === null || typeof data !== "object" || Array.isArray(data)) return ["layout Codex: raiz precisa ser objeto"];
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== CODEX_LAYOUT_SCHEMA_VERSION) errors.push("layout Codex: schemaVersion não suportada");
  const agents = record.agents;
  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) return [...errors, "layout Codex: agents precisa ser objeto"];
  const entries = agents as Record<string, unknown>;
  for (const id of agentIds) {
    const entry = entries[id] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") {
      errors.push(`layout Codex: agente sem layout: ${id}`);
      continue;
    }
    if (typeof entry.header !== "string") errors.push(`layout Codex: header inválido em ${id}`);
    else if (entry.header !== "" && (!entry.header.endsWith("\n") || !entry.header.split("\n").slice(0, -1).every((line) => line.startsWith("#")))) {
      errors.push(`layout Codex: header de ${id} precisa conter somente linhas de comentário`);
    }
    if (typeof entry.trailingNewline !== "boolean") errors.push(`layout Codex: trailingNewline inválido em ${id}`);
  }
  for (const id of Object.keys(entries)) {
    if (!agentIds.includes(id)) errors.push(`layout Codex: layout sem agente no catálogo: ${id}`);
  }
  return errors;
}

/** String básica TOML (uma linha). */
function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Corpo de string multilinha TOML. As instruções não podem conter `\` nem `"""`:
 * isso garante que o texto lido pelo Codex é idêntico ao arquivo de instruções.
 */
function tomlMultilineBody(value: string): string {
  if (value.includes("\\") || value.includes('"""')) {
    throw new Error("instruções com '\\' ou '\"\"\"' não podem ser convertidas literalmente para TOML");
  }
  return value;
}

export function renderCodexToml(agent: CatalogAgentWithInstructions, layout: CodexAgentLayout): string {
  const instructions = agent.instructions.endsWith("\n") ? agent.instructions.slice(0, -1) : agent.instructions;
  return (
    layout.header +
    `name = ${tomlBasicString(agent.id)}\n` +
    `description = ${tomlBasicString(agent.description)}\n\n` +
    `developer_instructions = """\n${tomlMultilineBody(instructions)}\n"""` +
    (layout.trailingNewline ? "\n" : "")
  );
}

const DASHBOARD_HEADER = `// ARQUIVO GERADO — NÃO EDITAR.
// Fonte: packages/agent-catalog/agents.json
// Gerar:  node scripts/generate-agent-adapters.mjs --write
// Conferir: node scripts/generate-agent-adapters.mjs --check
import type { AgentDefinition } from "../types/agent";

/**
 * Cópia gerada do catálogo neutro para o dashboard (sem as instruções dos
 * agentes, que não entram no bundle público). A consistência com
 * \`packages/agent-catalog\` é verificada por \`scripts/agent-adapters.test.mjs\`.
 *
 * Este arquivo usa somente \`import type\`, para poder ser importado diretamente
 * pelo Node (remoção de tipos) nos testes. O formato literal de \`accessMode\` e
 * \`writeScope\` (uma chave por linha, com quatro espaços) é lido por
 * \`scripts/agent-scope-check.mjs\`; não altere o gerador sem conferir esse leitor.
 */
export const agentCatalog = [
`;

const DASHBOARD_FOOTER = `] as const satisfies readonly AgentDefinition[];

export type CatalogAgentId = (typeof agentCatalog)[number]["id"];
`;

const MAX_INLINE_WIDTH = 100;
const literal = (value: string): string => JSON.stringify(value);

function renderStringList(key: string, values: readonly string[], alwaysMultiline: boolean): string {
  const inline = `    ${key}: [${values.map(literal).join(", ")}],`;
  if (!alwaysMultiline && inline.length <= MAX_INLINE_WIDTH) return `${inline}\n`;
  return `    ${key}: [\n${values.map((value) => `      ${literal(value)},\n`).join("")}    ],\n`;
}

export function renderDashboardCatalog(agents: readonly CatalogAgent[]): string {
  const body = agents
    .map(
      (agent) =>
        "  {\n" +
        `    id: ${literal(agent.id)},\n` +
        `    name: ${literal(agent.name)},\n` +
        `    role: ${literal(agent.role)},\n` +
        `    team: ${literal(agent.team)},\n` +
        `    accessMode: ${literal(agent.accessMode)},\n` +
        renderStringList("writeScope", agent.writeScope, false) +
        `    accentColor: ${literal(agent.accentColor)},\n` +
        renderStringList("responsibilities", agent.responsibilities, true) +
        "    description:\n" +
        `      ${literal(agent.description)},\n` +
        "  },\n",
    )
    .join("");
  return DASHBOARD_HEADER + body + DASHBOARD_FOOTER;
}
