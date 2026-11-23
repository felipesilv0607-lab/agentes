export type AgentStatus =
  | "working"
  | "thinking"
  | "waiting"
  | "paused"
  | "resting"
  | "completed"
  | "error";

export type AgentAnimation =
  | "typing"
  | "thinking"
  | "idle"
  | "walking"
  | "celebrating"
  | "error";

/**
 * Equipe (zona de trabalho) do agente. Deve coincidir com `AGENT_TEAMS` em
 * `packages/agent-catalog/src/catalog.ts` (verificado por teste).
 */
export type AgentTeam = "planning" | "build" | "quality" | "knowledge";

/**
 * Perfil de acesso DECLARADO do papel (deve coincidir com `ACCESS_MODES` em
 * `packages/agent-catalog/src/catalog.ts`). Não é, sozinho, um controle
 * técnico: a aplicação caberá ao Permission Engine do runtime próprio. Enquanto
 * o Codex for usado, o sandbox e as aprovações vêm da sessão pai (ver README,
 * "Revisões somente leitura").
 * - read-only: não altera arquivos.
 * - workspace-write: altera arquivos do workspace dentro do escopo autorizado.
 * - tests-only: escreve somente testes e fixtures autorizados (QA Engineer).
 * - ci-cd-without-publish: altera somente workflows de CI/CD, sem autorização
 *   própria para push, deploy, PR ou workflow_dispatch (DevOps Engineer).
 * - docs-only: altera somente documentação (Documentation Engineer).
 */
export type AgentAccessMode =
  | "read-only"
  | "workspace-write"
  | "tests-only"
  | "ci-cd-without-publish"
  | "docs-only";

/**
 * Definição estática de um agente no dashboard. A fonte única é o catálogo
 * neutro (`packages/agent-catalog`); `src/data/agentCatalog.ts` é gerado a
 * partir dele por `scripts/generate-agent-adapters.mjs`.
 */
export interface AgentDefinition {
  /** Identificador estável do agente no catálogo neutro. */
  id: string;
  /** Nome exibido no dashboard. */
  name: string;
  /** Papel exibido no dashboard. */
  role: string;
  team: AgentTeam;
  accessMode: AgentAccessMode;
  /**
   * Caminhos (globs relativos à raiz do repositório) que o papel pode alterar.
   * Usado por `scripts/agent-scope-check.mjs`, que DETECTA alterações fora do
   * escopo depois da tarefa, mas não impede tecnicamente a escrita.
   * - `read-only`: lista vazia.
   * - `workspace-write`: `["**"]` (qualquer caminho do repositório).
   * - demais modos: globs específicos (`**` = qualquer subcaminho, `*` =
   *   qualquer trecho sem `/`); entradas iniciadas por `!` são exclusões.
   * Independentemente do escopo, arquivos de governança (catálogo, tipos,
   * política, `.codex/` e o próprio verificador) são protegidos pelo verificador.
   */
  writeScope: readonly string[];
  /** Cor de identidade do agente (hex). */
  accentColor: string;
  /** Responsabilidades resumidas do papel. */
  responsibilities: readonly string[];
  /**
   * Descrição curta do papel, vinda do catálogo neutro
   * (`packages/agent-catalog/agents.json`). O adaptador temporário do Codex
   * usa o mesmo texto no campo `description` do TOML.
   */
  description: string;
}

/** Estado de execução (DEMO ou futuro runtime) de um agente do catálogo. */
export interface AgentRuntimeState {
  status: AgentStatus;
  currentTask: string | null;
  animation: AgentAnimation;
  lastActivity: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentTask: string | null;
  animation: AgentAnimation;
  lastActivity: string;
}

export type AgentDataSource = "demo" | "runtime";

export interface AgentSnapshot {
  source: AgentDataSource;
  updatedAt: string;
  agents: readonly Agent[];
}