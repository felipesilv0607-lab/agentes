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
 *   `--sandbox read-only -c approval_policy="never"`;
 * - `writeScope` é coerente com `accessMode` (vazio para `read-only`, `["**"]`
 *   para `workspace-write`, globs específicos para os demais) e cada glob dos
 *   modos com escopo restrito aparece literalmente nas instruções do TOML.
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
    writeScope: ["**"],
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
    writeScope: ["**"],
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
    writeScope: [],
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
    writeScope: [],
    accentColor: "#d6a45e",
    responsibilities: [
      "Revisar segurança nas 16 categorias do padrão global",
      "Diferenciar vulnerabilidades comprovadas de hipóteses",
      "Classificar achados por severidade com evidência e correção recomendada",
    ],
    codexDescription:
      "Revisor independente de seguranca do Agente.s. Analisa arquitetura, codigo, dependencias, dados, APIs, infraestrutura e as 16 categorias do padrao global.",
  },
  {
    id: "architect",
    name: "Architect",
    role: "Arquitetura",
    team: "planning",
    accessMode: "read-only",
    writeScope: [],
    accentColor: "#5fb4d3",
    responsibilities: [
      "Avaliar decisões técnicas e contratos entre componentes",
      "Comparar alternativas com riscos, custos e critérios de decisão",
      "Propor registros de decisão sem alterar arquivos",
    ],
    codexDescription:
      "Arquiteto somente leitura do Agente.s: avalia decisoes tecnicas, contratos entre componentes e trade-offs, sem alterar arquivos.",
  },
  {
    id: "qa-engineer",
    name: "QA Engineer",
    role: "Qualidade e testes",
    team: "quality",
    accessMode: "tests-only",
    writeScope: [
      "scripts/**/*.test.mjs",
      "!scripts/agent-catalog.test.mjs",
      "!scripts/agent-scope-check.test.mjs",
      "!scripts/security-baseline.test.mjs",
      "scripts/fixtures/**",
      "apps/dashboard/src/**/*.test.ts",
      "apps/dashboard/src/**/*.test.tsx",
    ],
    accentColor: "#e2788d",
    responsibilities: [
      "Projetar, escrever e executar testes, incluindo casos negativos",
      "Reportar defeitos sem corrigir código de produção",
      "Fornecer evidências reproduzíveis",
    ],
    codexDescription:
      "Engenheiro de qualidade do Agente.s: projeta, escreve e executa testes, com escrita restrita a testes e fixtures autorizados.",
  },
  {
    id: "devops-engineer",
    name: "DevOps Engineer",
    role: "CI/CD",
    team: "build",
    accessMode: "ci-cd-without-publish",
    writeScope: [".github/workflows/**"],
    accentColor: "#8cc263",
    responsibilities: [
      "Manter os workflows de CI/CD e as verificações obrigatórias",
      "Fixar actions por SHA verificado com permissões mínimas",
      "Propor, sem aplicar, mudanças fora do escopo; sem push, deploy ou PR",
    ],
    codexDescription:
      "Engenheiro de CI/CD do Agente.s: altera somente workflows do GitHub Actions, sem autorizacao propria para push, deploy, PR ou workflow_dispatch.",
  },
  {
    id: "documentation-engineer",
    name: "Documentation Engineer",
    role: "Documentação",
    team: "knowledge",
    accessMode: "docs-only",
    writeScope: ["README.md", "docs/**"],
    accentColor: "#e6d36a",
    responsibilities: [
      "Manter README e docs alinhados ao estado real do projeto",
      "Registrar somente resultados com evidência verificada",
      "Separar controles documentados, implementados e testados",
    ],
    codexDescription:
      "Engenheiro de documentacao do Agente.s: mantem README e docs alinhados a evidencias verificadas, sem alterar codigo, testes, CI ou politicas.",
  },
  {
    id: "accessibility-ux-reviewer",
    name: "Accessibility & UX Reviewer",
    role: "Acessibilidade e UX",
    team: "quality",
    accessMode: "read-only",
    writeScope: [],
    accentColor: "#7fd1c8",
    responsibilities: [
      "Revisar acessibilidade (WCAG 2.1 AA), teclado, foco e semântica",
      "Avaliar contraste, movimento reduzido e consistência da interface",
      "Separar o que foi medido do que depende de leitor de tela real",
    ],
    codexDescription:
      "Revisor somente leitura de acessibilidade e UX do Agente.s: avalia WCAG, teclado, semantica, contraste e consistencia da interface.",
  },
] as const satisfies readonly AgentDefinition[];

export type CatalogAgentId = (typeof agentCatalog)[number]["id"];
