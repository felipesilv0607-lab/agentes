# Mapa do projeto

Estado em 2026-11-23: Blocos 1 e 2 da migração para runtime próprio implementados e consolidados, pendentes de validação independente (ver `docs/architecture/adr-0001-runtime-proprio.md`). Nenhum agente autônomo executa: o Permission Engine só decide, ainda não existe executor e a execução de agentes escritores permanece desabilitada. Não implementados: Model Gateway, executor de tarefas, isolamento Docker (Arquitetura B; Docker desativado) e PostgreSQL.

| Caminho | O que é | Situação |
|---|---|---|
| `AGENTS.md`, `standards/` | Regras do projeto, baseline de segurança e política de agentes | Governança (alteração só com autorização humana) |
| `packages/agent-catalog/agents.json` | **Fonte única** dos metadados dos nove agentes | Governança |
| `packages/agent-catalog/instructions/<id>.md` | **Instruções neutras** de cada agente; as únicas carregadas pelo runtime | Governança |
| `packages/agent-catalog/adapters/codex/instructions/<id>.md` | Cópia **legada congelada** das instruções do Codex; fonte exclusiva dos TOMLs | Governança; temporário |
| `packages/agent-catalog/adapters/codex/instruction-differences.json` | 14 diferenças aprovadas entre legado e neutro (parágrafo, SHA-256, justificativa) | Governança; temporário |
| `packages/agent-catalog/adapters/codex/layout.json` | Cabeçalhos e final de arquivo dos TOMLs antigos, usados só pelo adaptador Codex | Temporário |
| `packages/agent-catalog/src/` | Tipos, validação do catálogo e renderização dos adaptadores (puro, sem Node) | Implementado |
| `packages/contracts/src/` | Contrato de eventos (envelope, hierarquia, versões) e contrato da API REST/SSE | Implementado; ainda sem produtor real de eventos |
| `.gitattributes` | Força LF no catálogo neutro e nos adaptadores gerados (paridade byte a byte em clones Windows) | Implementado |
| `scripts/generate-agent-adapters.mjs` | Gera/confere os adaptadores (`--check` / `--write`) | Implementado |
| `.codex/agents/*.toml` | Adaptador **temporário** do Codex, gerado pelo catálogo | Gerado; não editar à mão |
| `apps/dashboard/src/data/agentCatalog.ts` | Cópia do catálogo para o dashboard, sem instruções | Gerado; não editar à mão |
| `apps/dashboard/` | Dashboard React + Vite + Three.js com dados DEMO; publicado no GitHub Pages | Mantido |
| `apps/dashboard/src/services/agents/` | `AgentProvider` e `DemoAgentProvider` | Mantido; `RuntimeAgentProvider` no Bloco 4 |
| `apps/runtime/src/config.ts` | Configuração por ambiente: token, loopback, origens; isolamento fixo em desativado | Implementado; governança |
| `apps/runtime/src/catalog.ts` | Carrega `packages/agent-catalog` (sem links, falha fechada) | Implementado |
| `apps/runtime/src/permissions/` | Permission Engine (negação por padrão) e validação de caminhos/globs | Parcial: decide e é testado, mas nenhum executor aplica as decisões; listas de governança e de leitura com lacunas conhecidas (A-M3, adiado; ver ADR); governança |
| `apps/runtime/src/events/eventStore.ts` | Event Store em memória, append-only, validado pelo contrato | Implementado |
| `apps/runtime/src/state/agentState.ts` | Estado observável dos agentes (todos em repouso) | Implementado |
| `apps/runtime/src/http/server.ts` | API REST + SSE somente leitura, com token | Implementado |
| `apps/runtime/src/app.ts`, `main.ts` | Montagem e ponto de entrada (`npm start`) | Implementado; nenhum agente executa |
| `scripts/agent-scope-check.mjs` | Verificador de escopo para tarefas do Codex | Detecção auxiliar; **não** é barreira de segurança |
| `docs/event-contract.md` | Especificação do contrato de eventos | Proposta; validadores em `packages/contracts` |
| `docs/dashboard-risk-assessment.md` | Avaliação de riscos do dashboard (F0) | Mantido |
| `.github/workflows/deploy.yml` | CI e publicação no GitHub Pages | Mantido |

## Testes

| Arquivo | Cobre | No CI |
|---|---|---|
| `scripts/contract.test.mjs` | Documento do contrato de eventos e regras (via `packages/contracts`) | Sim |
| `scripts/security-baseline.test.mjs` | Presença dos requisitos no texto das políticas | Sim |
| `scripts/encoding.test.mjs` | Codificação dos arquivos de texto rastreados | Sim |
| `scripts/agent-catalog.test.mjs` | Catálogo do dashboard × TOMLs, escopos e matriz da política | Sim |
| `scripts/agent-adapters.test.mjs` | Catálogo neutro, equivalência legado × neutro, paridade byte a byte dos adaptadores, gerador e links (symlinks de arquivo só em Linux) | Sim |
| `scripts/contracts-package.test.mjs` | Pacote de contratos e contrato da API | Sim |
| `scripts/agent-scope-check.test.mjs` | Verificador de escopo (auxiliar) | Sim, em job separado que não bloqueia a publicação |
| `apps/runtime/test/*.test.ts` | Configuração, catálogo, Permission Engine, Event Store, API e SSE (segurança e integração) | Sim |
| `node scripts/generate-agent-adapters.mjs --check` | Paridade dos adaptadores e diferenças aprovadas | Sim |

Verificação de tipos dos pacotes (usa o TypeScript já instalado no dashboard):

```text
node apps/dashboard/node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json
node apps/dashboard/node_modules/typescript/bin/tsc -p packages/agent-catalog/tsconfig.json
```
