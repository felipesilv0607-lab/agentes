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
 * Equipe (zona de trabalho) do agente. Inclui as equipes previstas para os
 * papéis planejados (Architect, QA, DevOps, Documentation, Accessibility & UX),
 * que só entram no catálogo quando tiverem definição real em `.codex/agents`.
 */
export type AgentTeam = "planning" | "build" | "quality" | "knowledge";

/**
 * Perfil de acesso DOCUMENTADO do papel. Não é um controle técnico: no Codex,
 * o sandbox e as aprovações vêm da sessão pai (ver README, "Revisões somente
 * leitura").
 * - read-only: não altera arquivos.
 * - workspace-write: altera arquivos do workspace dentro do escopo autorizado.
 * - tests-only: escreve somente testes (papel planejado: QA Engineer).
 * - ci-cd-without-publish: altera CI/CD e infraestrutura, sem autorização
 *   própria para push ou deploy (papel planejado: DevOps Engineer).
 */
export type AgentAccessMode =
  | "read-only"
  | "workspace-write"
  | "tests-only"
  | "ci-cd-without-publish";

/** Definição estática de um agente: fonte única usada pelo dashboard. */
export interface AgentDefinition {
  /** Identificador; igual ao `name` em `.codex/agents/<id>.toml`. */
  id: string;
  /** Nome exibido no dashboard. */
  name: string;
  /** Papel exibido no dashboard. */
  role: string;
  team: AgentTeam;
  accessMode: AgentAccessMode;
  /** Cor de identidade do agente (hex). */
  accentColor: string;
  /** Responsabilidades resumidas do papel. */
  responsibilities: readonly string[];
  /**
   * Cópia literal do campo `description` do TOML do Codex. O teste
   * `scripts/agent-catalog.test.mjs` falha se as duas divergirem.
   */
  codexDescription: string;
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