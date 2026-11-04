export type PanelId = "monitoring" | "security" | "workflow" | "audit";
export interface Metric { label: string; value: string; detail: string; }
export interface Activity {
  title: string; description: string; time: string;
  status: "Concluído" | "Em revisão" | "Aguardando";
}
