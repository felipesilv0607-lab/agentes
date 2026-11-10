import type { AgentSnapshot } from "../../types/agent";

export interface AgentProvider {
  getSnapshot(): AgentSnapshot;
  subscribe(listener: (snapshot: AgentSnapshot) => void): () => void;
}