import type { AgentStatus } from "../types/agent";

/**
 * Representações compartilhadas dos estados dos agentes. `Record<AgentStatus, …>`
 * obriga, em tempo de compilação, que todo estado tenha rótulo, classe e cor.
 */

/** Rótulo exibido para cada estado. */
export const agentStatusLabels: Record<AgentStatus, string> = {
  working: "Trabalhando",
  thinking: "Pensando",
  waiting: "Aguardando",
  paused: "Pausado",
  resting: "Descansando",
  completed: "Concluído",
  error: "Com erro",
};

/** Sufixo da classe CSS `status-<sufixo>` usada no dashboard. */
export const agentStatusClassNames: Record<AgentStatus, string> = {
  working: "working",
  thinking: "thinking",
  waiting: "waiting",
  paused: "paused",
  resting: "resting",
  completed: "completed",
  error: "error",
};

/** Cor do indicador de estado na cena 3D. */
export const agentStatusSceneColors: Record<AgentStatus, string> = {
  working: "#55d6a2",
  thinking: "#8db5ff",
  waiting: "#d7bd7c",
  paused: "#a5adbd",
  resting: "#79c8d5",
  completed: "#83d3a0",
  error: "#ff8585",
};
