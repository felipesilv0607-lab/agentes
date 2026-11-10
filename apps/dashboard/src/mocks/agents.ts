import type { Agent } from "../types/agent";

export const demoAgents: readonly Agent[] = [
  {
    id: "coordinator",
    name: "Coordinator",
    role: "Coordenação",
    status: "thinking",
    currentTask: "Organizando a fila de tarefas",
    modelPath: "/models/coordinator.glb",
    animation: "thinking",
    lastActivity: "09:42",
  },
  {
    id: "developer",
    name: "Developer",
    role: "Desenvolvimento",
    status: "working",
    currentTask: "Implementação do dashboard",
    modelPath: "/models/developer.glb",
    animation: "typing",
    lastActivity: "09:40",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Revisão de código",
    status: "waiting",
    currentTask: "Aguardando alterações para revisão",
    modelPath: "/models/code-reviewer.glb",
    animation: "idle",
    lastActivity: "09:35",
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Segurança",
    status: "completed",
    currentTask: "Baseline demonstrativa verificada",
    modelPath: "/models/security-reviewer.glb",
    animation: "celebrating",
    lastActivity: "09:18",
  },
];