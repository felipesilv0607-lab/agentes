import type { AgentDefinition } from "../types/agent";

/**
 * Catálogo único dos agentes exibidos no dashboard.
 *
 * Regras (verificadas por `scripts/agent-catalog.test.mjs`):
 * - cada `id` corresponde a `.codex/agents/<id>.toml`, com `name` igual ao `id`;
 * - todo agente definido em `.codex/agents` está neste catálogo (sem agentes
 *   apenas visuais e sem definições órfãs);
 * - `codexDescription` é idêntica ao `description` do TOML;
 * - agentes `read-only` documentam no TOML a execução com
 *   `--sandbox read-only -c approval_policy="never"`.
 *
 * Este arquivo usa somente `import type`, para poder ser importado diretamente
 * pelo Node (remoção de tipos) no teste de consistência.
 */
export const agentCatalog = [
  {
    id: "coordinator",
    name: "Coordinator",
    role: "Coordenação",
    team: "planning",
    accessMode: "workspace-write",
    accentColor: "#7798e8",
    responsibilities: [
      "Analisar solicitações e dividir tarefas em subtarefas verificáveis",
      "Delegar implementação e revisão independente",
      "Consolidar resultados e evidências",
    ],
    codexDescription:
      "Coordena tarefas complexas por meio de planejamento, delegacao e consolidacao de evidencias.",
  },
  {
    id: "developer",
    name: "Developer",
    role: "Desenvolvimento",
    team: "build",
    accessMode: "workspace-write",
    accentColor: "#54b99f",
    responsibilities: [
      "Implementar mudanças pequenas e reversíveis no escopo definido",
      "Executar as verificações relevantes",
      "Informar arquivos alterados, comandos e resultados",
    ],
    codexDescription:
      "Implementa mudancas pequenas e bem delimitadas, com verificacao e evidencias.",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Revisão de código",
    team: "quality",
    accessMode: "read-only",
    accentColor: "#b18ad9",
    responsibilities: [
      "Revisar alterações de forma independente",
      "Verificar escopo, regressões, segurança e cobertura de validação",
      "Reportar achados priorizados com evidências",
    ],
    codexDescription:
      "Revisa alteracoes de forma independente, priorizando escopo, riscos e evidencias.",
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Segurança",
    team: "quality",
    accessMode: "read-only",
    accentColor: "#d6a45e",
    responsibilities: [
      "Revisar segurança nas 16 categorias do padrão global",
      "Diferenciar vulnerabilidades comprovadas de hipóteses",
      "Classificar achados por severidade com evidência e correção recomendada",
    ],
    codexDescription:
      "Revisor independente de seguranca do Agente.s. Analisa arquitetura, codigo, dependencias, dados, APIs, infraestrutura e as 16 categorias do padrao global.",
  },
] as const satisfies readonly AgentDefinition[];

export type CatalogAgentId = (typeof agentCatalog)[number]["id"];
