/**
 * Estado observável dos agentes, exposto ao dashboard via REST e SSE no formato
 * do contrato da API (`AgentsSnapshotDto`).
 *
 * Nesta etapa NENHUM agente executa: todos começam em `resting`, sem tarefa.
 * `update` existe para os próximos blocos (Agent Engine) e é validado pelo
 * mesmo parser que o consumidor usa, para que o runtime nunca emita um
 * snapshot que o contrato rejeitaria.
 */

import { parseAgentsSnapshot } from "../../../../packages/contracts/src/index.ts";
import type { AgentStateDto, AgentsSnapshotDto } from "../../../../packages/contracts/src/index.ts";

export interface AgentStateStore {
  snapshot(): AgentsSnapshotDto;
  update(id: string, change: Partial<Omit<AgentStateDto, "id">>): AgentsSnapshotDto;
  subscribe(listener: (snapshot: AgentsSnapshotDto) => void): () => void;
}

export function createAgentStateStore(agentIds: readonly string[], now: () => Date = () => new Date()): AgentStateStore {
  let current: AgentsSnapshotDto = parseAgentsSnapshot(
    {
      schemaVersion: "1.0",
      source: "runtime",
      updatedAt: now().toISOString(),
      agents: agentIds.map((id) => ({ id, status: "resting", currentTask: null, lastActivityAt: null })),
    },
    agentIds,
  );
  const listeners = new Set<(snapshot: AgentsSnapshotDto) => void>();

  return Object.freeze({
    snapshot: () => structuredClone(current),

    update(id: string, change: Partial<Omit<AgentStateDto, "id">>): AgentsSnapshotDto {
      if (!agentIds.includes(id)) throw new Error(`agente desconhecido: ${id}`);
      const next = {
        ...current,
        updatedAt: now().toISOString(),
        agents: current.agents.map((agent) => (agent.id === id ? { ...agent, ...change, id } : agent)),
      };
      current = parseAgentsSnapshot(next, agentIds);
      for (const listener of listeners) {
        try {
          listener(structuredClone(current));
        } catch {
          // Assinante com erro não afeta os demais.
        }
      }
      return structuredClone(current);
    },

    subscribe(listener: (snapshot: AgentsSnapshotDto) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
