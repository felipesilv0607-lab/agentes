import { demoAgents } from "../../mocks/agents";
import type { AgentSnapshot } from "../../types/agent";
import type { AgentProvider } from "./AgentProvider";

const demoSnapshot: AgentSnapshot = {
  source: "demo",
  updatedAt: "2026-11-04T09:00:00-03:00",
  agents: demoAgents,
};

export class DemoAgentProvider implements AgentProvider {
  getSnapshot(): AgentSnapshot {
    return demoSnapshot;
  }

  subscribe(_listener: (snapshot: AgentSnapshot) => void): () => void {
    // A demonstração é estática nesta etapa; nÃ£o simula eventos em tempo real.
    return () => undefined;
  }
}