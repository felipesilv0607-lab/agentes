# Agente.s — AI Software Factory

Agente.s é a base de uma fábrica de software assistida por IA: uma equipe de agentes especializados que trabalha com instruções, limites claros e evidências de execução.

## Estado atual (F0 e migração para runtime próprio — Blocos 1 e 2 consolidados)

A direção aprovada é migrar gradualmente do Codex para um runtime próprio (`docs/architecture/adr-0001-runtime-proprio.md`; mapa em `docs/project-map.md`). **Nenhum agente autônomo executa**: o runtime ainda não chama modelos, não executa ferramentas e não escreve arquivos.

Legenda: **Implementado e testado** (código com testes automatizados executados localmente e no CI do GitHub; primeira execução remota: run [`45249410602`](https://github.com/felipesilv0607-lab/agentes/actions/runs/45249410602), 2026-11-23, com sucesso); **Parcial** (existe, mas sem a integração que o torna efetivo); **Planejado** (decisão aprovada, sem código); **Pendente de validação independente** (sem revisão independente de código e de segurança).

| Componente | Estado |
|---|---|
| Catálogo neutro (`packages/agent-catalog`): nove agentes, instruções neutras do runtime e cópia legada congelada do Codex | Implementado e testado |
| Adaptadores gerados: `.codex/agents/*.toml` (temporários; idênticos byte a byte aos TOMLs do working tree antes da migração, conforme SHA-256 registrados pelo implementador; só 3 deles têm referência independente no histórico do Git) e `apps/dashboard/src/data/agentCatalog.ts` | Implementado e testado |
| Contratos (`packages/contracts`): eventos e API REST/SSE | Implementado e testado; nenhum produtor real de eventos |
| Runtime (`apps/runtime`): API REST + SSE somente leitura em loopback, token local, Event Store em memória | Implementado e testado (uso local) |
| Permission Engine (negação por padrão) | **Parcial**: decide e é testado, mas nenhum executor o consulta ainda; não é barreira comprovada para execução real. Listas de governança e de leitura com lacunas conhecidas (A-M3), **adiadas por decisão humana e não corrigidas** |
| CI (`.github/workflows/deploy.yml`): testes, paridade, typecheck, auditoria e testes do runtime; executa em `push` na `main`, `pull_request` para a `main` (sem publicar) e `workflow_dispatch` | Implementado e validado localmente e no GitHub Actions: run [`45249410602`](https://github.com/felipesilv0607-lab/agentes/actions/runs/45249410602) (PR #1, evento `pull_request`, commit `47838f9`, 2026-11-23 19:29 UTC), `verify-and-build` e `scope-checker-tests` com sucesso e `deploy` ignorado (ver "Caminho de validação do CI") |
| Dashboard (`apps/dashboard`): dados **sintéticos (DEMO)**, escritório virtual 3D, seletor com os nove agentes | Implementado; a cena 3D exibe somente quatro agentes (ver "Limitação da cena 3D") |
| Regras (`AGENTS.md`) e padrões (`standards/`) | Documentados; os testes verificam o texto, não a aplicação técnica |
| Model Gateway (Bloco 3), integração do dashboard com o runtime (Bloco 4), execução de tarefas e ferramentas (Bloco 5), isolamento Docker (Bloco 6), PostgreSQL e VPS (Bloco 7) | Planejado; **não implementado** |
| Blocos 1 e 2 como um todo | **Pendente de validação independente** |

## Agentes

| Agente | Responsabilidade | Modo | Pode alterar | Sessão pai (Codex legado) |
|---|---|---|---|---|
| `coordinator` | Planeja, delega, evita conflitos de escrita e consolida evidências | Escrita no workspace | Somente com autorização explícita | Escrita no workspace |
| `developer` | Implementa mudanças de escopo definido | Escrita no workspace | Escopo autorizado da tarefa | Escrita no workspace |
| `code-reviewer` | Revisa mudanças de forma independente | Somente leitura | Nada | Somente leitura |
| `security-reviewer` | Revisa segurança conforme as 16 categorias do baseline | Somente leitura | Nada | Somente leitura |
| `architect` | Avalia decisões técnicas, contratos e trade-offs | Somente leitura | Nada | Somente leitura |
| `qa-engineer` | Projeta, escreve e executa testes | Somente testes | `scripts/**/*.test.mjs`, `scripts/fixtures/**`, `apps/dashboard/src/**/*.test.ts`, `apps/dashboard/src/**/*.test.tsx`, exceto os testes de governança `scripts/agent-catalog.test.mjs`, `scripts/agent-scope-check.test.mjs` e `scripts/security-baseline.test.mjs` | Escrita no workspace |
| `devops-engineer` | Mantém os workflows de CI/CD; propõe, sem aplicar, mudanças fora do escopo | CI/CD sem publicação | `.github/workflows/**` | Escrita no workspace |
| `documentation-engineer` | Mantém a documentação alinhada a evidências verificadas | Somente documentação | `README.md`, `docs/**` | Escrita no workspace |
| `accessibility-ux-reviewer` | Revisa acessibilidade (WCAG) e UX | Somente leitura | Nada | Somente leitura |

- **Nenhum agente tem autoridade própria para commit, push, PR, deploy ou `workflow_dispatch`.** O `devops-engineer` também não pode alterar `apps/dashboard/vite.config.ts`, dependências nem configurações do repositório.
- Responsabilidades, limites e permissões completos: `standards/AI-AGENT-POLICY.md`, seção 2.
- As definições contêm instruções em texto. Elas não criam um serviço, painel, dependência ou execução automática.
- A fonte única dos agentes é o catálogo neutro `packages/agent-catalog`: metadados em `agents.json` e **instruções neutras** em `instructions/<id>.md`, as únicas que o runtime carrega. A cópia **legada congelada** das instruções do Codex fica em `adapters/codex/instructions/<id>.md` e só gera os TOMLs. As 14 diferenças permitidas entre as duas versões estão em `adapters/codex/instruction-differences.json` (parágrafo, SHA-256 dos dois textos e justificativa); qualquer outra diferença falha no gerador e nos testes.
- O catálogo do dashboard (`apps/dashboard/src/data/agentCatalog.ts`, sem instruções) e os TOMLs de `.codex/agents/` são **gerados** por `node scripts/generate-agent-adapters.mjs --write` e conferidos por `--check`. Para alterar um agente, edite o catálogo neutro e regenere; não edite os arquivos gerados.
- `scripts/agent-adapters.test.mjs` verifica o catálogo neutro, a equivalência legado × neutro e a paridade byte a byte dos adaptadores; `scripts/agent-catalog.test.mjs` verifica a correspondência do catálogo do dashboard com `.codex/agents/`, os escopos de escrita e a cobertura na política.

## Uso legado com o Codex (durante a transição)

Enquanto o runtime próprio não executa agentes, as nove definições continuam utilizáveis no Codex por meio dos TOMLs gerados. Esta seção descreve **somente** esse uso legado; os procedimentos abaixo não se aplicam ao runtime próprio.

### Sessões por agente

Os subagentes herdam o sandbox e as aprovações da sessão pai; um arquivo de agente não muda isso e o `coordinator` também não pode mudar.

- **Somente leitura** (`architect`, `code-reviewer`, `security-reviewer`, `accessibility-ux-reviewer`): execute em sessão independente com `codex exec --sandbox read-only -c approval_policy="never" "..."` (ver "Revisões somente leitura"). Executados a partir de uma sessão com escrita, eles poderão escrever.
- **Escritores** (`qa-engineer`, `devops-engineer`, `documentation-engineer`): `codex exec --sandbox workspace-write -c approval_policy="never" "..."`. Esse modo permite alterar **qualquer** arquivo do workspace; o escopo de cada papel é verificado depois da tarefa (ver "Verificação de escopo de escrita").

### Verificação de escopo de escrita

Executado pelo `coordinator` ou por você; **a execução feita pelo próprio agente verificado não vale como evidência**.

1. Antes da tarefa, com o repositório no commit-base revisado e os arquivos de governança sem alterações, crie o snapshot em um **diretório novo, fora do repositório e fora do alcance de escrita do agente**:

   ```text
   node scripts/agent-scope-check.mjs snapshot --agent <id> --out <diretório novo>
   ```

   O diretório recebe `snapshot.json` e uma cópia do verificador (`agent-scope-check.mjs`). Anote os dois SHA-256 impressos (`SHA256` e `VERIFICADOR_SHA256`) fora do alcance do agente.

2. Depois da tarefa, **sem executar `git status`, `git diff` ou outros comandos git no repositório antes**, confira o hash da cópia do verificador (por exemplo, `Get-FileHash <diretório>\agent-scope-check.mjs`) e execute **somente essa cópia**, a partir da raiz do repositório e de um PowerShell (não de `cmd.exe`, que procura executáveis primeiro no diretório atual):

   ```text
   node <diretório>/agent-scope-check.mjs check --agent <id> --snapshot <diretório>/snapshot.json --sha256 <SHA256>
   ```

O que o verificador faz:
- no snapshot, lê o escopo de **todos** os agentes do catálogo **no commit-base**, como dado (análise estática do texto, sem executar o TypeScript), e o grava no snapshot;
- no snapshot, **recusa um estado inicial não confiável** (saída `2`, com o motivo): verificador em execução diferente do commit-base; objetos de substituição (`git replace`); entradas com `skip-worktree`/`assume-unchanged`; configuração local que executa programas, inclui outra configuração ou redireciona o repositório (por exemplo, `core.fsmonitor`, `core.hooksPath`, `filter.*`, `diff.*.textconv`, `include.*`, `alias.*`, `credential.*helper`); hooks ativos (qualquer arquivo de `.git/hooks/` que não seja `*.sample` do Git); worktrees, submódulos, `alternates`, `grafts` e `config.worktree`; arquivos de governança diferentes do commit-base (conteúdo, índice, ausentes ou novos);
- no check, não lê nada do commit-base: usa somente o snapshot e o disco, e recusa executar a cópia do verificador que está dentro do repositório ou uma cópia cujo hash difira do registrado;
- compara **todo o workspace** por SHA-256 do conteúdo (arquivos rastreados, não rastreados e ignorados), sem depender do índice, do cache de data/tamanho do Git nem das regras de `.gitignore`; links simbólicos e junctions são registrados sem ser seguidos;
- compara por leitura direta do disco, **antes de qualquer comando git**, `config`, `config.worktree`, `commondir`, `objects/info/alternates`, `objects/info/http-alternates`, `shallow` e, recursivamente, `hooks/`, `info/`, `worktrees/` e `modules/` de `.git/`. Se algo mudou, é violação e **nenhum comando git é executado** (o índice, as referências e os commits ficam sem verificação, com aviso);
- com `.git/` inalterado, compara o índice e as referências (branches, tags, stash, `refs/replace`, HEAD) e lista os arquivos de commits feitos durante a tarefa. Os comandos git usados não aplicam filtros e rodam sem variáveis `GIT_*` herdadas, sem objetos de substituição e sem configuração global ou de sistema;
- ao final, lê de novo `.git/` e o workspace; se algo mudou **durante** a verificação (processo concorrente), descarta o resultado (saída `2`). O snapshot faz a mesma revalidação;
- trata como violação, para qualquer agente, alterações nos **arquivos de governança**: `AGENTS.md` e `AGENTS.override.md` em **qualquer nível** da árvore, `standards/**`, `apps/dashboard/src/data/agentCatalog.ts`, `apps/dashboard/src/types/agent.ts`, `scripts/agent-catalog.test.mjs`, `scripts/agent-scope-check.mjs`, `scripts/agent-scope-check.test.mjs`, `scripts/security-baseline.test.mjs` e `.codex/**` (sem diferenciar maiúsculas/minúsculas);
- trata como violação caminhos inseguros (`..`, absolutos, barra invertida, componentes `.git` em qualquer caixa e variantes do Windows como `.git.` e `GIT~1`), diferenças de maiúsculas/minúsculas, links simbólicos ou junctions novos em qualquer ponto do caminho e repositórios Git aninhados (inclusive `.GIT`);
- recusa (saída `2`) índice com `skip-worktree` ou `assume-unchanged`, snapshot com hash diferente ou de outro agente e commit-base que deixou de ser ancestral de `HEAD`;
- não atribui ao agente alterações que já existiam no snapshot e não mudaram.

Saídas: `0` sem violações; `1` com violações; `2` diante de erro, estado não confiável ou resultado ambíguo (falha fechada).

**Limitações:**
- o verificador **detecta** violações depois da tarefa; ele **não impede tecnicamente** uma escrita fora do escopo;
- **diretório do snapshot e confiança nos hashes:** a garantia depende de o agente não conseguir escrever no diretório do snapshot. Se conseguir, ela vem somente da conferência manual dos dois SHA-256 anotados fora do alcance do agente; ainda resta a janela entre conferir o hash da cópia e executá-la;
- **confiança no ponto de partida:** o snapshot compara o verificador em execução com o commit-base usando o próprio código em execução; quem cria o snapshot deve partir de um commit revisado, com `git status` limpo nos arquivos de governança;
- **execução automática de Git por IDEs, extensões ou pelo próprio agente:** comandos git executados durante a tarefa (por exemplo, `git status` de uma IDE) podem executar uma configuração maliciosa criada pelo agente **antes** do check; o check detecta a alteração em `.git/`, mas não desfaz o que já foi executado. Feche IDEs e ferramentas que executem git no repositório durante tarefas de agentes;
- **ferramentas externas e variáveis de ambiente:** o verificador descarta as variáveis `GIT_*` e a configuração global e de sistema, mas confia no `git` e no `node` encontrados no `PATH` da sessão de quem o executa;
- exclusões técnicas, não inventariadas: `node_modules/**`, `apps/dashboard/node_modules/**`, `apps/dashboard/dist/**` e `apps/dashboard/tsconfig.tsbuildinfo` (um link ou junction nesses caminhos ainda é detectado; `node_modules` e `.tsbuildinfo` em qualquer outro lugar são verificados). Depois de tarefas de agentes, reinstale as dependências com `npm ci` antes de executar build ou testes que as carreguem;
- dentro de `.git/`, somente os itens listados acima, o índice e as referências são verificados; objetos do Git (por exemplo, `objects/` e `packed-refs` alterados sem mudar referências) não são inspecionados um a um;
- diretórios vazios novos não são registrados (somente arquivos, links e repositórios aninhados);
- **Alternate Data Streams do NTFS** (por exemplo, `arquivo.md:oculto`) não são detectados: o conteúdo principal do arquivo não muda;
- o conteúdo interno do `.git` de repositórios aninhados não é inspecionado (a simples presença já é violação);
- **janelas de corrida que não podem ser eliminadas:** entre as leituras de um mesmo arquivo e entre a revalidação final e o fim do processo; o resultado é uma fotografia do momento da verificação, e escritas posteriores (por exemplo, de um processo deixado em segundo plano) não são vistas;
- **falsos positivos possíveis no uso real** (tratados como violação ou erro até revisão humana): `fetch` automático de uma IDE (altera `refs/remotes`); extensões que escrevem em `.git/config`; arquivos temporários do Vite (`apps/dashboard/vite.config.ts.timestamp-*.mjs`) presentes durante um build; build ou testes executados durante a tarefa que gravem fora das exclusões técnicas; a configuração `safe.directory` global é ignorada, então um repositório de outro dono faz o verificador falhar (saída `2`);
- o verificador só é válido a partir de um commit-base que já o contenha.

Os testes do verificador (`scripts/agent-scope-check.test.mjs`) rodam no CI em job separado (`scope-checker-tests`), que **não** bloqueia a publicação enquanto a execução em Linux não for comprovadamente estável.

**Papel do verificador na migração:** o `agent-scope-check` é uma ferramenta de **detecção auxiliar** para tarefas executadas no Codex. Ele **não** é barreira de segurança do runtime próprio e não receberá novas responsabilidades de proteção; a aplicação de permissões caberá ao Permission Engine (negação por padrão) e ao isolamento da Arquitetura B. O catálogo neutro (`packages/agent-catalog/**`) não está na lista de arquivos protegidos do verificador (ver ADR 0001, "Consequências e riscos").

### Revisões somente leitura

Segundo a documentação oficial do Codex, um arquivo de agente personalizado **não** substitui `sandbox_mode` nem `approval_policy`: o subagente herda o sandbox e as aprovações da sessão pai. Uma instrução textual "somente leitura" não é uma barreira técnica.

O modo `read-only`, sozinho, não basta: segundo a documentação oficial, nele o agente "can't edit files or run commands without approval". Ou seja, uma ação fora do sandbox ainda pode ser **solicitada** e, se alguém aprovar, executada. Por isso a revisão precisa combinar dois controles na sessão pai:

- `sandbox_mode = "read-only"`: o sandbox bloqueia escrita;
- `approval_policy = "never"`: nenhuma solicitação de escalonamento é apresentada; a ação que exigiria aprovação falha.

Execução recomendada (não interativa):

```text
codex exec --sandbox read-only -c approval_policy="never" "Peça ao code-reviewer para revisar o diff atual."
```

Em fluxos não interativos, a documentação oficial informa que "an action that needs new approval fails and Codex surfaces the error back to the parent workflow".

Em sessões interativas (CLI, app ou IDE):

1. selecione o modo de permissões somente leitura **antes** de delegar a revisão; os subagentes herdam as permissões do turno pai, inclusive mudanças feitas com `/permissions` ou `--yolo`;
2. **negue** qualquer pedido de aprovação ou de escalonamento que surgir durante uma revisão, inclusive os vindos de threads de subagentes;
3. não use `--yolo`, "Full access" nem "Approve for me" durante revisões.

A combinação `--sandbox read-only -c approval_policy="never"` foi aceita pelo Codex CLI 0.153.4 (`codex doctor` reporta `approval policy: Never`). O bloqueio de escrita do sandbox `read-only` foi verificado localmente com `codex sandbox` (Windows). O **teste ponta a ponta com os subagentes revisores ainda está pendente** e nenhuma proteção efetiva dos revisores deve ser declarada antes dele.

## Limitação da cena 3D

O seletor e o inspetor do escritório virtual exibem os nove agentes, mas a cena 3D ainda tem quatro estações fixas e exibe somente os quatro primeiros agentes do catálogo (`coordinator`, `developer`, `code-reviewer`, `security-reviewer`). A cena será adaptada para todos os agentes na etapa E5.

## Runtime local (Bloco 2)

```text
cd apps/runtime
npm ci --ignore-scripts                      # somente @types/node (desenvolvimento)
$env:AGENTES_RUNTIME_TOKEN = "<token>"       # PowerShell; gere com:
# node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npm start                                    # http://127.0.0.1:8787
```

| Rota | Autenticação | Conteúdo |
|---|---|---|
| `GET /health` | não | `{"status":"ok"}` |
| `GET /api/agents`, `GET /api/agents/:id` | Bearer | Metadados do catálogo (sem instruções) |
| `GET /api/state` | Bearer | Estado dos agentes (`AgentsSnapshotDto`; todos em repouso) |
| `GET /api/events?after=&limit=` | Bearer | Eventos do Event Store em memória |
| `GET /api/events/stream` | Bearer | SSE: `agents.snapshot` e `heartbeat` |

Controles implementados e testados (`apps/runtime/test/`): escuta só em loopback; token obrigatório (32+ caracteres, comparação em tempo constante, nunca registrado); `Host` validado contra DNS rebinding; `Origin` e CORS só para origens de loopback configuradas (`AGENTES_RUNTIME_ALLOWED_ORIGINS`); somente `GET`; corpo, consulta não documentada e caminhos não canônicos recusados; limites de streams SSE, de buffer por stream (cliente que não lê é desconectado) e de conexões; erros sem detalhes internos. Permission Engine (decisões testadas, **não** aplicadas): ele decide, com negação por padrão, negar publicação, escrita no repositório original, execução de comandos, rede e modelos, e decide negar escrita em workspace isolado enquanto o isolamento (Arquitetura B) estiver desativado, o que não é configurável por ambiente. O Permission Engine decide negar operações não permitidas, mas ainda não existe executor que aplique essas decisões. Até a implementação e validação dessa integração, a execução de agentes escritores permanece desabilitada.

Limitações: o Event Store é em memória (perde dados ao encerrar; cada evento limitado a 64 KiB e o total à capacidade configurada) e ainda não tem produtor real; nenhum executor consulta o Permission Engine ainda, portanto ele **não é barreira comprovada** para execução real; sem TLS nem usuários (uso local apenas); o dashboard ainda não consome o runtime (Bloco 4).

## Verificações

Na raiz do repositório:

```text
node --test scripts/contract.test.mjs scripts/security-baseline.test.mjs scripts/encoding.test.mjs
node --test scripts/agent-adapters.test.mjs scripts/contracts-package.test.mjs scripts/agent-catalog.test.mjs
node --test scripts/agent-scope-check.test.mjs   # auxiliar; fora do requisito de publicação
node scripts/generate-agent-adapters.mjs --check
node apps/dashboard/node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json
node apps/dashboard/node_modules/typescript/bin/tsc -p packages/agent-catalog/tsconfig.json
```

Os testes importam arquivos TypeScript diretamente; é necessário Node 24 (o mesmo do CI).

Em `apps/runtime` (o typecheck reutiliza o TypeScript 5.9.3 instalado em `apps/dashboard`; rode `npm ci` lá antes):

```text
npm ci --ignore-scripts
npm audit --audit-level=high
npm run typecheck
npm test
```

Em `apps/dashboard`:

```text
npm ci
npm audit --audit-level=high
npm run typecheck
npm run build
```

O workflow de deploy executa essas verificações no job `verify-and-build` (exceto `agent-scope-check.test.mjs`, que roda no job separado `scope-checker-tests`) e só publica, a partir da `main`, se todas passarem.

**Governança pendente:** a `main` ainda não está protegida e não há verificações obrigatórias em Pull Requests. Uma alteração pode chegar à `main` sem verificação (ela não é publicada, mas fica na branch). O procedimento exato (pré-requisito de verificação em Pull Requests e ruleset `protect-main`) está em `docs/dashboard-risk-assessment.md`, seção "Governança do repositório".

### Caminho de validação do CI

O workflow executa em três eventos:

| Evento | Jobs executados | Publica? |
|---|---|---|
| `push` na `main` | `verify-and-build`, `scope-checker-tests`, `deploy` | Sim, se a verificação passar e o commit ainda for o HEAD da `main` |
| `pull_request` para a `main` | `verify-and-build`, `scope-checker-tests` | **Não**: o `deploy` é excluído explicitamente nesse evento |
| `workflow_dispatch` | `verify-and-build`, `scope-checker-tests`; `deploy` só na `main` | Somente na `main` |

Primeira validação remota feita por esse caminho: PR #1 (`feat/runtime-blocks-1-2` → `main`), run [`45249410602`](https://github.com/felipesilv0607-lab/agentes/actions/runs/45249410602), em 2026-11-23 19:29 UTC, concluída com sucesso: no CI Ubuntu, testes de `scripts/` 111/111 (0 falhas, 0 ignorados; inclusive os testes de link simbólico de arquivo, que só são ignorados na execução local no Windows, por falta de privilégio para criar symlinks), verificador de escopo 59/59 e runtime 62/62 (ambos com 0 falhas e 0 ignorados), paridade dos 10 adaptadores, typecheck, build, CSP e `npm audit` (0 vulnerabilidades) sem falhas; `deploy` e envio do artefato do Pages ignorados. Nada foi publicado.

## Publicação

O dashboard demonstrativo é publicado no GitHub Pages. O Pages não permite cabeçalhos HTTP personalizados. Por isso, a CSP do build é entregue por `<meta http-equiv>`, que não suporta `frame-ancestors`. Detalhes e riscos residuais estão em `docs/dashboard-risk-assessment.md`.

## Uso previsto

Hoje: uso legado no Codex (ver "Uso legado com o Codex") e o runtime próprio somente como infraestrutura local de leitura. Quando os Blocos 3 a 6 estiverem implementados, os agentes executarão no runtime próprio, com escrita apenas em workspace isolado, coleta como patch e aprovação humana. Antes de qualquer ação destrutiva, publicação ou alteração sensível, obtenha aprovação humana.

## Próxima etapa

Bloco 3 da migração (ADR 0001): Model Gateway com Ollama (local), OpenAI e Anthropic atrás de uma interface comum, com chaves somente no ambiente do runtime, sem rota HTTP que acione modelos e com a capacidade `model` liberada no Permission Engine somente por decisão explícita.

Pendências que continuam abertas: revisão independente dos Blocos 1 e 2 (aceite humano), teste ponta a ponta do sandbox dos revisores no Codex (F0) e proteção da `main`.
