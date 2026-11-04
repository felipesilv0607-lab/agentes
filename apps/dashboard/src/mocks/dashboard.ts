import type { Activity, Metric, PanelId } from "../types/dashboard";

export const navigation: { id: PanelId; label: string; symbol: string }[] = [
  { id: "monitoring", label: "Monitoramento", symbol: "◫" },
  { id: "security", label: "Segurança", symbol: "◇" },
  { id: "workflow", label: "Fluxo de trabalho", symbol: "⇄" },
  { id: "audit", label: "Logs e evidências", symbol: "≡" }
];
export const metrics: Metric[] = [
  { label: "Agentes cadastrados", value: "04", detail: "Perfis demonstrativos" },
  { label: "Tarefas em andamento", value: "08", detail: "Dados simulados" },
  { label: "Revisões pendentes", value: "03", detail: "Exemplo de fila" },
  { label: "Eventos registrados", value: "126", detail: "Histórico fictício" }
];
export const activities: Activity[] = [
  { title: "Análise de requisitos", description: "developer · tarefa DEMO-024", time: "09:42", status: "Concluído" },
  { title: "Revisão de implementação", description: "code-reviewer · tarefa DEMO-023", time: "09:35", status: "Em revisão" },
  { title: "Verificação de segurança", description: "security-reviewer · tarefa DEMO-022", time: "09:18", status: "Aguardando" }
];
