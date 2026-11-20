import type { Agent } from "../types/agent";

export const demoAgents: readonly Agent[] = [
  {
    id: "coordinator",
    name: "Coordinator",
    role: "Coordenação",
    status: "thinking",
    currentTask: "Organizando a fila de tarefas",
    animation: "thinking",
    lastActivity: "09:42",
  },
  {
    id: "developer",
    name: "Developer",
    role: "Desenvolvimento",
    status: "working",
    currentTask: "Implementação do dashboard",
    animation: "typing",
    lastActivity: "09:40",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Revisão de código",
    status: "waiting",
    currentTask: "Aguardando alterações para revisão",
    animation: "idle",
    lastActivity: "09:35",
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Segurança",
    status: "completed",
    currentTask: "Baseline demonstrativa verificada",
    animation: "celebrating",
    lastActivity: "09:18",
  },
];