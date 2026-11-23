# Agente.s — AI Software Factory

Agente.s é a base de uma fábrica de software assistida por IA: uma equipe de agentes especializados que trabalha com instruções, limites claros e evidências de execução.

## Estado atual (fase F0)

| Componente | Estado real |
|---|---|
| Regras compartilhadas (`AGENTS.md`) e padrões (`standards/`) | Documentados; testes verificam a presença dos requisitos no texto, não a aplicação técnica dos controles |
| Agentes Codex em `.codex/agents/` | Nove definições (ver "Agentes"), com catálogo único no dashboard e teste de consistência |
| Dashboard (`apps/dashboard`) | React/Vite com dados **sintéticos (DEMO)**, incluindo escritório virtual 3D e seletor acessível por teclado com os nove agentes. A cena 3D ainda exibe somente os quatro primeiros agentes (ver "Limitação da cena 3D") |
| Contrato de eventos (`docs/event-contract.md`) | Proposta técnica; validador existe somente nos testes |
| CI/CD (`.github/workflows/deploy.yml`) | Testes, auditoria de dependências, typecheck e build antes de publicar no GitHub Pages |
| Bridge local, integração com Codex App Server, autenticação, persistência e execução real de agentes | **Não implementados** |

## Agentes

| Agente | Responsabilidade | Modo | Pode alterar | Sessão pai |
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
- O catálogo do dashboard (`apps/dashboard/src/data/agentCatalog.ts`) é a fonte única dos agentes exibidos. `scripts/agent-catalog.test.mjs` verifica a correspondência com `.codex/agents/`, os escopos de escrita e a cobertura na política.

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

Os testes `scripts/agent-catalog.test.mjs` e `scripts/agent-scope-check.test.mjs` são executados com `node --test <arquivo>` e **ainda não fazem parte do workflow de CI**; essa integração será avaliada separadamente.

### Limitação da cena 3D

O seletor e o inspetor do escritório virtual exibem os nove agentes, mas a cena 3D ainda tem quatro estações fixas e exibe somente os quatro primeiros agentes do catálogo (`coordinator`, `developer`, `code-reviewer`, `security-reviewer`). A cena será adaptada para todos os agentes na etapa E5.

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

## Verificações

Na raiz do repositório:

```text
node --test scripts/contract.test.mjs scripts/security-baseline.test.mjs scripts/encoding.test.mjs
```

Em `apps/dashboard`:

```text
npm ci
npm audit --audit-level=high
npm run typecheck
npm run build
```

O workflow de deploy executa essas mesmas verificações e só publica, a partir da `main`, se todas passarem.

**Governança pendente:** a `main` ainda não está protegida e não há verificações obrigatórias em Pull Requests. Uma alteração pode chegar à `main` sem verificação (ela não é publicada, mas fica na branch). O procedimento exato (pré-requisito de verificação em Pull Requests e ruleset `protect-main`) está em `docs/dashboard-risk-assessment.md`, seção "Governança do repositório".

## Publicação

O dashboard demonstrativo é publicado no GitHub Pages. O Pages não permite cabeçalhos HTTP personalizados. Por isso, a CSP do build é entregue por `<meta http-equiv>`, que não suporta `frame-ancestors`. Detalhes e riscos residuais estão em `docs/dashboard-risk-assessment.md`.

## Uso previsto

Abra este diretório no Codex e delegue tarefas ao `coordinator`, ao `developer` e aos revisores. Antes de qualquer ação destrutiva, publicação ou alteração sensível, obtenha aprovação humana.

## Próxima etapa

Concluir as pendências da F0 (teste ponta a ponta do sandbox dos revisores e revisão independente) antes de iniciar a F1: transformar o contrato de eventos em código validável e reutilizável.
