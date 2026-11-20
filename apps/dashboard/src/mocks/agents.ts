import { agentCatalog } from "../data/agentCatalog";
import type { CatalogAgentId } from "../data/agentCatalog";
import type { Agent, AgentRuntimeState } from "../types/agent";

/**
 * Estado DEMO de cada agente do catálogo. A identidade (id, nome e papel) vem
 * de `data/agentCatalog.ts`; aqui fica somente o estado simulado.
 * `Record<CatalogAgentId, …>` exige estado para todo agente do catálogo.
 */
const demoRuntimeState: Record<CatalogAgentId, AgentRuntimeState> = {
  coordinator: {
    status: "thinking",
    currentTask: "Organizando a fila de tarefas",
    animation: "thinking",
    lastActivity: "09:42",
  },
  developer: {
    status: "working",
    currentTask: "Implementação do dashboard",
    animation: "typing",
    lastActivity: "09:40",
  },
  "code-reviewer": {
    status: "waiting",
    currentTask: "Aguardando alterações para revisão",
    animation: "idle",
    lastActivity: "09:35",
  },
  "security-reviewer": {
    status: "completed",
    currentTask: "Baseline demonstrativa verificada",
    animation: "celebrating",
    lastActivity: "09:18",
  },
};

export const demoAgents: readonly Agent[] = agentCatalog.map((definition) => ({
  id: definition.id,
  name: definition.name,
  role: definition.role,
  ...demoRuntimeState[definition.id],
}));
