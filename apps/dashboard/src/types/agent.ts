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

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  currentTask: string | null;
  modelPath: string;
  animation: AgentAnimation;
  lastActivity: string;
}

export type AgentDataSource = "demo" | "runtime";

export interface AgentSnapshot {
  source: AgentDataSource;
  updatedAt: string;
  agents: readonly Agent[];
}