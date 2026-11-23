# ADR 0001 — Runtime próprio e migração gradual a partir do Codex

**Status:** aceito (direção aprovada pelo responsável humano em 2026-11-23); Blocos 1 e 2 implementados e consolidados; **pendentes de validação independente**.
**Escopo:** arquitetura de execução dos agentes do Agente.s.

## Contexto

Até a etapa E2, os nove agentes existiam como definições do Codex (`.codex/agents/*.toml`), com um catálogo para o dashboard verificado contra elas. As limitações conhecidas desse modelo:

- o sandbox e as aprovações vêm da sessão pai do Codex; um arquivo de agente não os altera;
- no modo de escrita, o agente pode alterar **qualquer** arquivo do workspace;
- `scripts/agent-scope-check.mjs` só **detecta** alterações fora do escopo depois da tarefa; ele não impede a escrita;
- as instruções dos agentes existiam somente no formato do Codex.

## Decisão

Migrar e substituir gradualmente o Codex por um runtime próprio em Node.js + TypeScript, preservando o dashboard (React + Vite + Three.js), os nove agentes, os identificadores, as responsabilidades, as instruções, as permissões e os escopos.

Elementos da arquitetura-alvo:

| Elemento | Papel |
|---|---|
| Catálogo neutro (`packages/agent-catalog`) | Fonte única dos agentes: metadados (`agents.json`) e instruções (`instructions/<id>.md`) |
| Contratos (`packages/contracts`) | Contrato de eventos (docs/event-contract.md) e contrato da API REST/SSE, com validadores |
| Runtime (`apps/runtime`) | API REST + SSE, autenticação local, armazenamento (memória e depois PostgreSQL), Event Engine, Permission Engine, Tool Registry, Model Gateway, Agent Engine e Orchestrator |
| Model Gateway | Provedores Ollama (local), OpenAI e Anthropic, atrás de uma interface comum |
| Permission Engine | Negação por padrão; destinado a ser a barreira técnica de permissões do runtime (hoje só decide; sem executor que aplique a decisão) |
| Arquitetura B | Execução de agentes escritores em container Docker isolado, com cópia do commit-base; o resultado é um patch coletado, validado e aplicado somente após aprovação humana |
| Dashboard | Mantido; `RuntimeAgentProvider` ao lado do `DemoAgentProvider`. O GitHub Pages continua só com a demonstração |

Regras permanentes:

1. Nenhum agente escreve diretamente no repositório original.
2. Alterações passam por coleta, validação e aprovação humana.
3. Nenhum agente tem autoridade própria para commit, push, PR, deploy ou `workflow_dispatch`.
4. `scripts/agent-scope-check.mjs` **não** é barreira de segurança do runtime e não recebe novas responsabilidades de proteção. Ele permanece como detecção auxiliar enquanto o Codex for usado.
5. Claude Code e Codex podem auxiliar o desenvolvimento, mas não são dependências do runtime.
6. Infraestrutura funcional (API, eventos, permissões, gateway) é distinta de agentes efetivamente autônomos; a documentação deve dizer qual dos dois existe em cada etapa.

## Sequência (blocos)

| Bloco | Conteúdo | Situação |
|---|---|---|
| 1 | Catálogo neutro, instruções, metadados, adaptadores e contratos | **Implementado e testado**; consolidado (instruções neutras × legadas) |
| 2 | Runtime: REST, SSE, autenticação local, armazenamento em memória, Permission Engine | **Implementado e testado** como infraestrutura; Permission Engine **parcial** (nenhum executor o consulta); nenhum agente executa |
| Consolidação | Instruções neutras, CI integrado, revisão técnica e de segurança | **Concluída** em 2026-11-23; revisão independente pendente |
| 3 | Model Gateway: Ollama, OpenAI, Anthropic | Não iniciado |
| 4 | `RuntimeAgentProvider` e integração do dashboard | Não iniciado |
| 5 | Ciclo de execução de tarefas, ferramentas, orquestração e resultados | Não iniciado |
| 6 | Docker, isolamento, coleta, validação e aprovação humana | Não iniciado; Docker desativado até aprovação específica dos testes de isolamento |
| 7 | PostgreSQL, revisão independente, preparação para VPS | Não iniciado |

### Bloco 1 — decisões de implementação

- **Fonte única:** `packages/agent-catalog/agents.json` e `packages/agent-catalog/instructions/<id>.md`. As instruções foram copiadas literalmente dos TOMLs.
- **Adaptadores gerados** por `scripts/generate-agent-adapters.mjs` (`--check` por padrão, `--write` explícito):
  - `.codex/agents/<id>.toml` — adaptador **temporário**. Os comentários de cabeçalho e o final de arquivo de cada TOML antigo ficam em `packages/agent-catalog/adapters/codex/layout.json`, que só existe para o adaptador e será removido com ele. Paridade comprovada: os nove TOMLs gerados são idênticos byte a byte aos anteriores.
  - `apps/dashboard/src/data/agentCatalog.ts` — cópia para o dashboard **sem as instruções**, que não entram no bundle público. O dashboard não importa o pacote diretamente porque o Vite não serve arquivos fora de `apps/dashboard` sem mudar `vite.config.ts`.
- **Renome:** `codexDescription` passou a `description` no tipo do dashboard e no catálogo.
- **Contratos:** os validadores de `scripts/contract.test.mjs` foram extraídos sem mudança de regras ou mensagens para `packages/contracts` (agora lançam `ContractError` em vez de `AssertionError`). Foi adicionado o contrato da API (`agents.snapshot` via SSE e `GET /api/state`), com validação estrita para o consumidor.
- **Sem dependências novas:** os pacotes são TypeScript com sintaxe apagável, executados diretamente pelo Node 24 e verificados pelo `tsc` já instalado no dashboard (`lib` ES2022, sem `@types/node`).

### Revisão direcionada do Bloco 1 (2026-11-23)

Achados corrigidos: o gerador seguia links simbólicos e junctions ao ler instruções e ao gravar adaptadores (poderia gravar fora do repositório ou embutir arquivos externos); textos do catálogo aceitavam caracteres de controle que tornariam o TOML inválido; o validador de timestamps (herdado de `contract.test.mjs`) aceitava datas inexistentes como `2026-02-30` e `24:00:00`; a rota de estado documentada (`/api/agents/state`) colidia com `/api/agents/:id` e passou a `/api/state`.

Decisão humana sobre o escopo do QA Engineer (2026-11-23): **preservar o `writeScope` atual**. O escopo `scripts/**/*.test.mjs` continua cobrindo `scripts/agent-adapters.test.mjs`; o catálogo e o TOML do papel não foram alterados. No runtime próprio, o Permission Engine trata esse arquivo como governança (escrita negada a todos); no uso legado do Codex, o `agent-scope-check` não o protege (risco aceito; ver "Consequências e riscos").

### Bloco 2 — decisões de implementação

- `apps/runtime` em Node.js 24 + TypeScript executado diretamente (sem build), sem dependências de produção. Única dependência de desenvolvimento: `@types/node` (^24). O `tsc` é o 5.9.3 já instalado em `apps/dashboard`, para não duplicar o compilador; a contrapartida é que o typecheck do runtime exige `npm ci` no dashboard antes.
- O catálogo é lido de `packages/agent-catalog` (não dos adaptadores), recusando links e arquivos não regulares; catálogo inválido impede o início.
- API REST + SSE somente leitura, escutando apenas em loopback, com token Bearer obrigatório, validação de `Host` (DNS rebinding), lista de `Origin`, CORS restrito, somente `GET`, recusa de corpo, consulta não documentada e caminho não canônico, limite de streams SSE e erros sem detalhes internos.
- Permission Engine próprio, com negação por padrão e lista de governança própria (independente de `agent-scope-check`). Ele decide negar publicação, escrita no repositório original, comandos, rede e modelos (decisões; nenhum executor as aplica). O isolamento está fixo em desativado (não configurável por ambiente); as regras de escopo para workspace isolado já existem e são testadas com o isolamento ativado somente em teste.
- Event Store em memória, append-only, validado pelo contrato, com limite de capacidade que recusa novos eventos ao ser atingido.

## Consolidação dos Blocos 1 e 2 (2026-11-23)

### Instruções neutras e legado do Codex

- `packages/agent-catalog/instructions/<id>.md`: **instruções neutras**, as únicas carregadas pelo runtime (`apps/runtime/src/catalog.ts`).
- `packages/agent-catalog/adapters/codex/instructions/<id>.md`: **cópia legada congelada** das instruções originais; é a única fonte das instruções dos TOMLs gerados. Os nove TOMLs continuam idênticos byte a byte aos originais.
- `packages/agent-catalog/adapters/codex/instruction-differences.json`: as **14 diferenças aprovadas**, por agente e parágrafo, com o SHA-256 do texto legado, o SHA-256 do texto neutro e a justificativa. O gerador (`--check` e `--write`) e `scripts/agent-adapters.test.mjs` falham diante de qualquer outra diferença, de aprovação sem efeito ou de texto que não corresponda ao hash aprovado.

| Agente | Parágrafos alterados | Natureza da mudança |
|---|---|---|
| coordinator | DELEGACAO, VERIFICACAO DE ESCOPO, ARQUIVOS DE GOVERNANCA, DEPENDENCIAS, SESSOES (agora PERMISSOES), CONSOLIDACAO | `.codex/agents` → catálogo neutro; procedimento de snapshot/check → decisão do Permission Engine, sem executor que a aplique (sem isolamento, decide negar qualquer escrita; agentes escritores desabilitados; bloqueio informado a humano); sandbox herdado → permissões decididas pelo Permission Engine |
| qa-engineer, devops-engineer, documentation-engineer | NAO PODE MODIFICAR, VERIFICACAO DE ESCOPO | `.codex/` → catálogo neutro e adaptadores gerados; procedimento de snapshot/check → decisão do Permission Engine, sem executor que a aplique, e exigência de validação externa |
| architect | RESPONSABILIDADE | Exemplos de integração futura: Codex App Server → runtime próprio e Model Gateway |
| security-reviewer | RESTRICAO DE PERMISSOES | "sandbox somente leitura" → "permissão de leitura" |
| developer, code-reviewer, accessibility-ux-reviewer | nenhum | Sem referência ao Codex; idênticas ao legado |

Princípios aplicados à redação: nenhuma responsabilidade, permissão, escopo ou proibição foi ampliada ou reduzida; os blocos `ESCOPO DE ESCRITA` são idênticos ao `writeScope` (verificado por teste); as menções a `scripts/agent-scope-check*.mjs` que restam nas instruções do QA são **caminhos protegidos** do escopo aprovado, não procedimentos. Desde a validação final (abaixo), as instruções neutras não descrevem como vigente nenhum mecanismo inexistente; descrevem a **decisão** do Permission Engine, que ainda não é aplicada por nenhum executor: o Permission Engine decide negar escrita no repositório original e, enquanto o isolamento não estiver implementado, decide negar qualquer escrita de agente. Workspace isolado, coleta de alterações e aprovação humana aparecem apenas como o que falta implementar; um teste impede redação que os apresente como vigentes.

**Aprovação humana registrada (2026-11-23):** a nova instrução de verificação de escopo do `coordinator` foi aprovada pelo responsável humano e, em seguida, refinada pela decisão B-M1 (também aprovada). Regra vigente: o Permission Engine decide negar escrita no repositório original e, enquanto o isolamento não estiver implementado, decide negar qualquer escrita de agente; ainda não existe executor que aplique essas decisões, e até a implementação e validação dessa integração a execução de agentes escritores permanece desabilitada; tarefas que exigem escrita são encaminhadas a um humano; workspace isolado, coleta de patch e aprovação automatizada não são descritos como implementados. A regra legada (snapshot e check do `agent-scope-check`) continua valendo apenas para o uso legado no Codex.

### Integração ao CI

No job `verify-and-build` (do qual o `deploy` depende): testes de contrato, baseline, codificação, catálogo, adaptadores e contratos compartilhados; `generate-agent-adapters.mjs --check`; typecheck do dashboard e dos pacotes (com o TypeScript do dashboard); `npm ci --ignore-scripts`, `npm audit --audit-level=high`, typecheck e testes do runtime; cache de npm com os lockfiles do dashboard e do runtime. Em Linux, os testes de links simbólicos de arquivo do gerador também executam. `scripts/agent-scope-check.test.mjs` roda no job separado `scope-checker-tests`, fora do `needs` do deploy. O fluxo de publicação (freshness check, concorrência, ambiente `github-pages`) não foi alterado.

### Revisão técnica e de segurança (consolidação)

| Gravidade | Achado | Correção |
|---|---|---|
| Média | SSE sem limite de buffer de saída: um cliente autenticado que não lê faria o processo acumular memória sem limite | Stream encerrado quando o buffer passa de 1 MiB (teste de regressão com cliente parado) |
| Baixa | Event Store sem limite de tamanho por evento: poucos eventos grandes esgotariam a memória | Eventos acima de 64 KiB, não serializáveis ou cíclicos são recusados (testes) |
| Baixa | Servidor sem limite de conexões TCP simultâneas | `maxConnections` (padrão 128, configurável só por opção de código); teste dedicado com limite 3 desde a validação final |
| Informativo | `requestTimeout` de 15 s poderia encerrar streams SSE longos | Verificado: um stream de 22 s permaneceu aberto com heartbeats; sem mudança |

Verificado sem achados: geração e leitura sem seguir links (testes de junction no Windows e de symlink de arquivo no Linux pelo CI), validação do catálogo e das instruções, timestamps de calendário, token Bearer (tempo constante, nunca em log ou resposta), `Host`/`Origin` e DNS rebinding, caminhos não canônicos, decisões do Permission Engine (negação por padrão; escrita no repositório original, publicação, comandos, rede e modelos sempre decididos como negados; nenhum executor as aplica), idempotência e capacidade do Event Store, encerramento de streams, erros sem detalhes internos e restrição a loopback.

Limitação registrada: o Permission Engine **não é barreira comprovada para execução real** enquanto não estiver integrado a um executor (Blocos 5 e 6).

## Validação final dos Blocos 1 e 2 (2026-11-23)

Revisão somente leitura feita **pelo próprio implementador** (mesmo agente que escreveu o código): **não substitui** a revisão independente exigida pelo `AGENTS.md`.

| Gravidade | Achado | Situação |
|---|---|---|
| Média | Instruções neutras descreviam como vigentes mecanismos não implementados (coleta de patch, validação do patch, "permissão concedida pelo runtime") | Corrigido: texto restrito ao que o Permission Engine decide; lista de diferenças e hashes atualizados; teste impede a regressão. Redação refinada depois por B-M1 (decisão, sem executor) |
| Baixa | Campos opcionais do envelope (`actor_agent_id`, `correlation_id`, `trace_id`) aceitavam qualquer tipo, contra a tabela da seção 4 do contrato | Corrigido: texto não vazio quando presentes (teste) |
| Baixa | Alvo de requisição fora da forma de origem (`*`, URL absoluta) respondia 414 | Corrigido: 400 `invalid-request-target` (teste) |
| Baixa | Limite de conexões TCP sem teste | Teste dedicado (limite 3, excedente encerrado sem resposta, vaga liberada volta a aceitar) |
| Informativo | `StoredEvent.status` registra o resultado no momento da gravação e não muda quando a lacuna é preenchida | Documentado no código; sem mudança de comportamento |
| Informativo | O Permission Engine permite ao `coordinator` (`workspace-write`) escrita em workspace isolado sem exigir a "autorização explícita" da política | Sem efeito hoje (isolamento desativado); requisito para o Bloco 5: autorização por tarefa |
| Informativo | A lista de governança do Permission Engine protege `apps/runtime/test/permissions.test.ts`, mas não os demais testes de segurança do runtime | Sem efeito hoje; reavaliar com o executor (Bloco 5) sem alterar escopos sem aprovação |
| Informativo | O workflow só executava em `push` na `main` e em `workflow_dispatch`: não havia caminho para validar o CI sem publicar ou sem disparo manual | Resolvido no fechamento: gatilho `pull_request` para a `main`; o `deploy` é excluído nesse evento |

## Fechamento dos Blocos 1 e 2 (2026-11-23)

- Aprovação humana da instrução do `coordinator`: registrada acima.
- CI: gatilho `pull_request` (para a `main`) adicionado. Em PR rodam `verify-and-build` e `scope-checker-tests`; o `deploy` tem `github.event_name != 'pull_request'` no `if`, além da checagem de `refs/heads/main` e da regra do ambiente `github-pages`. Nenhuma permissão de job de validação foi ampliada.
- Validação **local**: testes, paridade, typecheck, build, auditoria e validação estrutural do workflow, com simulação das condições dos jobs por evento. Validação **remota** (GitHub Actions): **pendente**; o workflow novo só executa depois de commit e push.
- Revisão independente: solicitada a dois revisores somente leitura em contextos isolados (subagentes). São do mesmo modelo do implementador, sem o contexto da implementação; não substituem uma revisão humana. Resultados em "Revisões independentes do fechamento" (abaixo).
- Permission Engine: decide e é testado, mas **não é barreira de execução comprovada** enquanto nenhum executor o consultar (Blocos 5 e 6).

Pendências para aprovação formal: (1) primeira execução do CI no GitHub, por PR, sem falhas; (2) aceite humano das revisões. B-M1 foi corrigido; A-M3 foi adiado por decisão humana (ver "Pendência adiada: A-M3").

### Revisões independentes do fechamento

Dois revisores somente leitura, em contextos isolados sem o histórico da implementação (subagentes do tipo "Plan", sem ferramentas de edição; mesmo modelo do implementador, portanto não substituem revisão humana): (A) segurança do runtime e contratos; (B) catálogo, instruções, adaptadores, CI e documentação. Nenhum achado crítico ou alto.

| Origem | Gravidade | Achado | Situação |
|---|---|---|---|
| A-M1 | Médio | Permission Engine lia `action.path` duas vezes (getter podia aprovar um caminho e entregar outro) | Corrigido: leitura única para primitivos; a decisão devolve `path` aprovado (testes) |
| A-M2 | Médio | Event Store validava o objeto vivo e media `JSON.stringify` (`toJSON` furava 64 KiB; getter gravava evento inválido; NaN divergia) | Corrigido: serializa uma vez e valida, deduplica e grava a mesma cópia (testes) |
| A-M3 | Médio | Governança do Permission Engine não inclui `app.ts`, `catalog.ts`, `main.ts`, `package.json` do runtime, helpers de teste, `contract.test.mjs` e `.github/workflows/**`; leitura é "permitida por padrão" com lista de bloqueio incompleta (`.ssh`, `.aws`, `.git-credentials`, `*.kdbx`, `*.jks`, `.claude/**`) | **Adiado por decisão humana; NÃO corrigido** (ver "Pendência adiada: A-M3") |
| B-M1 | Médio | Instruções neutras afirmavam no presente que o motor de permissões "nega" e "nunca concede", mas ele não é aplicado por executor | **Corrigido por decisão humana**: instruções (coordinator, qa-engineer, devops-engineer, documentation-engineer) e documentos passaram a dizer que o motor *decide negar* e que ainda não existe executor que aplique as decisões; agentes escritores permanecem desabilitados; hashes das diferenças aprovadas atualizados; testes rejeitam a redação antiga nas instruções e na documentação |
| B-M2 | Médio | Paridade dos TOMLs só tem referência independente no Git para 3 de 9 (coordinator tem alteração E2; 5 são novos) | Redação do README corrigida; recomendação: commitar os TOMLs originais (E2) antes do catálogo neutro, ou registrar os SHA-256 aprovados por humano |
| B-H1 | Médio | Sem `.gitattributes`, clone no Windows com `autocrlf=true` converteria catálogo e adaptadores para CRLF e quebraria a paridade | Comprovado por simulação (`git cat-file --filters`: 5 CR sem a regra, 0 com) e corrigido com `.gitattributes` restrito a esses caminhos |
| A-B1 | Baixo | Cliente SSE parado tinha a vaga liberada, mas o socket continuava aberto com o buffer retido | Corrigido: destrói a conexão; teste mede conexões abertas no servidor (mutação confirmou que detecta a regressão) |
| A-B2 | Baixo | `GET //[` gerava 500 | Corrigido: 400 (teste) |
| A-B3 | Baixo | `maxHeadersCount` truncava cabeçalhos em silêncio (pulava checagem de corpo e de Origin) | Corrigido: mais de 64 cabeçalhos → 431 (teste) |
| A-B4 | Info | `Host` duplicado aceito (Node usa o primeiro) | Corrigido: `Host`, `Origin`, `Authorization`, `Content-Length` e `Transfer-Encoding` repetidos → 400 (teste) |
| A-B5 | Info | Preflight respondia antes de validar o caminho | Corrigido: caminho canônico validado antes do OPTIONS (teste) |
| A-B6 | Info | Anos 0000-0099 no calendário; mensagens internas do Event Store chegavam ao chamador | Corrigidos (testes). Não alterados: entropia mínima do token (8 caracteres distintos), reentrega idêntica com o armazenamento cheio retorna erro de capacidade, pior caso de memória (~1,9 GB com 10 000 eventos de 64 KiB) |
| B-B1 | Baixo | ADR e comentários chamavam o Permission Engine de barreira; motivo de negação citava coleta e aprovação humana como existentes | Corrigido |
| B-B2 | Baixo | Teste contra mecanismos inexistentes usava lista negativa | Reforçado com lista positiva (só a frase aprovada pode citá-los) |
| B-B3 | Baixo | Artefato do Pages enviado também em PR | Corrigido: `Upload Pages artifact` não roda em `pull_request` |
| B-B4 | Baixo | Legenda do README dizia "testes no CI" com a execução remota pendente | Corrigido |
| B-I3 | Info | Comando `node_modules/.bin/tsc` não funciona no PowerShell | Corrigido no README e no mapa (`node …/typescript/bin/tsc`) |
| Outros | Info | Escopo do QA cobre `agent-adapters.test.mjs` (risco aceito); corrida `lstat`/escrita no gerador local; links dentro do workspace e `EventSource` sem cabeçalho `Authorization` (Blocos 4–6) | Registrados |

### Pendência adiada: A-M3 (decisão humana de 2026-11-23)

- **Situação: adiado, não corrigido.** Nenhuma lista do Permission Engine foi alterada.
- **Lacunas na lista de governança** (`GOVERNANCE_GLOBS` em `apps/runtime/src/permissions/engine.ts`): não inclui `apps/runtime/src/app.ts` (que passa `isolationEnabled`), `apps/runtime/src/catalog.ts` (que carrega agentes e escopos), `apps/runtime/src/main.ts`, `apps/runtime/package.json`, `apps/runtime/test/helpers.ts` e os demais testes de segurança do runtime, `scripts/contract.test.mjs` nem `.github/workflows/**`.
- **Lacunas na leitura:** a leitura é permitida por padrão, com lista de bloqueio (`READ_DENY_GLOBS`) que não cobre, por exemplo, `.ssh/**`, `.aws/**`, `.git-credentials`, `.pgpass`, `.docker/config.json`, `*.kdbx`, `*.jks` e `.claude/**`.
- **Impacto da correção:** completar a governança restringe a escrita (em workspace isolado) de `developer` e `coordinator` e pode conflitar com `devops-engineer` (`.github/workflows/**` é o seu único escopo); trocar a leitura para lista de permissão restringe a leitura de todos os papéis.
- **Efeito hoje:** nenhum operacional, porque o isolamento está desativado e nenhum executor consulta o motor; as lacunas passam a importar quando houver executor (Blocos 5 e 6).
- **Antes de qualquer mudança:** revisão específica de segurança e análise de impacto nos nove agentes, com aprovação humana. Pré-requisito para habilitar qualquer executor.

## Critérios para retirar os TOMLs (Bloco 5 ou posterior)

1. O runtime executa os nove papéis a partir do catálogo neutro, sem ler `.codex/`.
2. As instruções neutras (já separadas do legado) foram aprovadas na revisão humana.
3. Revisões independentes de código e segurança aprovaram o runtime.
4. Aprovação humana explícita para a remoção.

## Consequências e riscos

- O catálogo neutro passa a ser arquivo de governança pela política, mas **não** está na lista de `scripts/agent-scope-check.mjs` (por decisão, o verificador não foi ampliado). Alterações nele por um agente escritor de escopo amplo são percebidas indiretamente: o teste `scripts/agent-adapters.test.mjs` falha se os adaptadores não forem regenerados, e a regeneração altera arquivos que o verificador protege. Mudanças só no código do validador do pacote não são detectadas por esse caminho; a proteção efetiva dependerá do Permission Engine integrado a um executor e do isolamento (Blocos 5 e 6) e, até lá, de revisão humana.
- O formato literal de `agentCatalog.ts` continua acoplado ao leitor estático do verificador; um teste confere que ambos obtêm o mesmo `writeScope`.
- O CI atualizado ainda não foi observado no GitHub; a primeira execução após o commit precisa ser conferida.
- A revisão dos Blocos 1 e 2 foi feita por dois revisores em contextos isolados, do mesmo modelo do implementador; o aceite humano dessa revisão ainda está pendente.
- A-M3 (lacunas nas listas de governança e de leitura do Permission Engine) está adiado por decisão humana e não corrigido.
