# Agente.s — Contrato de eventos

**Versão do documento:** 1.0.0
**Status:** proposta técnica para validação antes da implementação
**Escopo:** contrato lógico de eventos para uma futura camada de coleta, persistência e visualização do Agente.s.

> **Limite importante:** este contrato não afirma que o runtime atual do Codex emita esses eventos. Os exemplos são fixtures sintéticas. Os nomes `coordinator`, `developer` e `code-reviewer` são identificadores ilustrativos, não prova de que o runtime os registre ou permita delegação por esses nomes.

---

## 1. Objetivos e não objetivos

### 1.1 Objetivos

O contrato deve permitir que um futuro produtor e consumidor:

- reconstrua o ciclo de vida de tarefas, atribuições, execuções e revisões;
- correlacione tarefas filhas com uma tarefa raiz;
- identifique tentativas, falhas, bloqueios e resultados;
- processe reentregas e eventos fora de ordem sem aplicar transições incorretas;
- preserve evidências de forma controlada, sem armazenar conteúdo sensível por padrão;
- valide estrutura e consistência antes de persistir ou exibir eventos.

### 1.2 Não objetivos

Este documento não define:

- como capturar eventos do runtime do Codex;
- uma API, banco de dados, fila, interface ou mecanismo de autenticação;
- métricas de faturamento ou consumo de tokens;
- o conteúdo de prompts, respostas ou argumentos de ferramentas;
- a implementação de um catálogo de agentes;
- garantias de disponibilidade ou retenção de referências externas.

Essas decisões dependem da descoberta e validação de uma fonte real de eventos.

## 2. Terminologia e regras normativas

- **Evento:** registro imutável de um fato ocorrido ou observado.
- **Produtor:** componente que emite o evento.
- **Consumidor:** componente que valida, persiste ou projeta o evento.
- **Tarefa raiz:** tarefa no topo de uma hierarquia; não possui tarefa pai.
- **Tarefa filha:** tarefa que possui exatamente uma tarefa pai imediata.
- **Atribuição:** responsabilidade de um agente lógico por uma tarefa.
- **Execução:** uma tentativa concreta de realizar uma atribuição.
- **Agregado:** entidade cujo histórico de eventos é ordenado por uma versão própria.
- **Fixture:** exemplo sintético usado para documentação e testes.

As palavras **DEVE**, **NÃO DEVE**, **RECOMENDA-SE** e **PODE** expressam requisitos normativos deste contrato.

## 3. Princípios fundamentais

1. Eventos registram fatos; não são comandos para executar ações.
2. Eventos aceitos são imutáveis. Uma correção é representada por novo evento, nunca por edição silenciosa do evento anterior.
3. O produtor não deve declarar um dado que não observou. Campos opcionais desconhecidos devem ser omitidos, não preenchidos por inferência.
4. O consumidor valida antes de persistir ou projetar o evento.
5. A ordem de chegada não representa necessariamente a ordem em que os fatos ocorreram.
6. O contrato separa identidade da tarefa individual, identidade da raiz e identidade do pai imediato.
7. Dados brutos sensíveis não são armazenados por padrão.

## 4. Envelope comum

Todo evento DEVE ser um objeto JSON com estes campos:

| Campo | Tipo | Obrigatório | Regra |
|---|---|---:|---|
| `event_id` | string | Sim | ID não vazio, único no escopo de `source`. |
| `source` | string | Sim | URI-reference não vazia que identifica o contexto produtor do evento. Recomenda-se URI absoluta estável. |
| `event_type` | string | Sim | Um dos tipos da seção 7. |
| `schema_version` | string | Sim | Versão deste contrato, inicialmente `"1.0"`. |
| `occurred_at` | string | Sim | Timestamp RFC 3339 com offset explícito. |
| `task_id` | string | Sim | ID da tarefa individual a que o evento pertence. |
| `root_task_id` | string | Sim | ID da tarefa raiz da hierarquia. |
| `aggregate` | object | Sim | Identifica a entidade cujo histórico é versionado. |
| `payload` | object | Sim | Dados específicos do tipo de evento. |
| `recorded_at` | string | Não | Timestamp atribuído pelo coletor ao receber/gravar o evento. |
| `actor_agent_id` | string | Não | Agente lógico que produziu o evento, se observável. |
| `parent_event_ref` | object | Não | Referência tipada ao evento causal imediato, somente quando conhecido. |
| `correlation_id` | string | Não | Agrupador de uma operação lógica, se disponível. |
| `trace_id` | string | Não | Identificador de tracing distribuído, se houver integração compatível. |

O objeto `aggregate` DEVE conter:

| Campo | Tipo | Obrigatório | Regra |
|---|---|---:|---|
| `type` | string | Sim | Tipo da entidade: `task`, `assignment`, `execution`, `result`, `evidence`, `review` ou `blocker`. |
| `id` | string | Sim | ID da entidade identificada. |
| `version` | integer | Sim | Inteiro positivo, crescente em um para cada evento novo daquele agregado. |

### 4.1 Identidade e escopo

- A chave de deduplicação é o par `(source, event_id)`. O produtor DEVE preservar ambos ao reenviar o mesmo evento.
- A chave do agregado é `(source, aggregate.type, aggregate.id)`; versões são sequenciais dentro desse escopo.
- O produtor DEVE serializar a alocação de versões de cada agregado para impedir duas atualizações concorrentes com a mesma versão.
- O mesmo `event_id` pode existir em fontes diferentes; por isso, não se deve deduplicar apenas por `event_id`.
- `aggregate.type` e `aggregate.id` identificam a entidade alterada ou observada pelo evento.
- `aggregate.version` começa em `1` para o primeiro evento daquele agregado e cresce exatamente em `1` para cada novo evento emitido para o mesmo agregado. Cada evento é uma atualização/snapshot do agregado após o fato descrito.
- Uma reentrega mantém a mesma versão. Um novo fato/transição recebe nova versão.
- Reutilizar `(source, event_id)` com conteúdo semanticamente diferente é erro de integridade.
- Reutilizar `(aggregate.type, aggregate.id, version)` com evento diferente é conflito de versão e deve ser colocado em quarentena.

### 4.2 Tarefas e hierarquia

- `task_id` sempre identifica a tarefa individual, nunca implicitamente a raiz.
- `root_task_id` identifica a raiz da hierarquia.
- Para a tarefa raiz, `task_id == root_task_id` e `parent_task_id` deve estar ausente.
- Para uma tarefa filha, `task_id != root_task_id` e o evento `task` correspondente deve informar `parent_task_id`.
- `parent_task_id` identifica o pai imediato, não a raiz necessariamente.
- Uma tarefa pai e uma tarefa filha devem compartilhar o mesmo `root_task_id`.
- Uma tarefa não pode ser pai de si mesma; ciclos na hierarquia são inválidos.
- Todo evento de uma tarefa filha mantém seu `task_id` individual e o mesmo `root_task_id`.

### 4.3 Tempo

- `occurred_at` representa quando o fato ocorreu, não quando foi recebido.
- `recorded_at` só pode ser preenchido pelo coletor. O produtor não deve inventá-lo.
- Timestamps DEVEM seguir RFC 3339 e conter `Z` ou offset numérico. Recomenda-se normalizar para UTC (`Z`) na persistência.
- Timestamps de negócio no payload, como `started_at` e `ended_at`, descrevem o ciclo de vida da entidade. Quando representarem o mesmo fato de `occurred_at`, devem ser iguais.
- Não se deve usar a ordem lexical ou a ordem de chegada como substituto de `aggregate.version`.
- O contrato não exige que todos os sistemas tenham relógios perfeitamente sincronizados; a versão do agregado é a referência para ordenar fatos do mesmo agregado.

### 4.4 Relação entre agregado e tarefa

- Para `aggregate.type == "task"`, `aggregate.id` DEVE ser igual a `task_id`.
- Para os demais tipos, `aggregate.id` DEVE ser igual ao ID da entidade indicado pelo tipo: `assignment_id`, `execution_id`, `result_id`, `evidence_id`, `review_id` ou `blocker_id`.
- Um evento de atribuição, execução, resultado, evidência, revisão ou bloqueio pertence a exatamente um `task_id` individual e a um `root_task_id`.
- Referências a entidades de outras tarefas só são permitidas quando a regra do tipo declarar explicitamente esse vínculo.

## 5. Ordenação, idempotência e ingestão

### 5.1 Processamento

O consumidor DEVE:

1. validar a sintaxe JSON;
2. validar os campos obrigatórios e seus tipos;
3. validar `schema_version` e `event_type`;
4. validar a identidade do agregado e sua versão;
5. validar invariantes locais e referências disponíveis;
6. deduplicar por `(source, event_id)`;
7. aplicar a projeção somente quando a versão anterior do agregado estiver disponível.

### 5.2 Eventos duplicados

- Mesmo `(source, event_id)` e mesmo conteúdo semântico: reentrega idempotente; não aplicar duas vezes.
- Mesmo `(source, event_id)` e conteúdo diferente: erro de integridade.
- Mesmo agregado e mesma versão, mas `event_id` diferente: conflito; não escolher um evento arbitrariamente.

### 5.3 Eventos fora de ordem

- Se chegar a versão `N+1` antes de `N`, o consumidor deve mantê-la pendente e não atualizar a projeção daquele agregado.
- Quando `N` chegar e for validada, o consumidor pode processar `N` e as versões pendentes seguintes em sequência.
- Se uma versão nunca chegar, o agregado deve ser sinalizado como incompleto; não se deve pular a lacuna silenciosamente.
- `occurred_at` não substitui a sequência `aggregate.version`.
- Eventos de agregados diferentes não possuem ordenação total garantida. `parent_event_ref` e referências estabelecem relações causais quando fornecidas.

### 5.4 Falhas de validação

Eventos inválidos não devem ser corrigidos automaticamente. O consumidor deve registrar o motivo da rejeição/quarentena, sem incluir conteúdo sensível desnecessário. Política de retentativa, prazo de pendência e descarte são decisões da implementação.

## 6. Referências entre entidades

Referências a entidades DEVEM ser tipadas, usando este formato. Referências a eventos usam o formato `event_ref` com `source` e `event_id`:

```json
{
  "entity_type": "result",
  "entity_id": "result_001",
  "task_id": "task_001",
  "root_task_id": "task_001"
}
```

Referência a evento:

```json
{
  "source": "agente-s.example",
  "event_id": "evt_task_001"
}
```

Regras:

- `entity_type` identifica o tipo da entidade referenciada.
- `event_ref.source` e `event_ref.event_id` identificam um evento sem ambiguidade.
- `parent_event_ref`, quando presente, deve apontar para um evento causal anterior. O consumidor valida o par `(source, event_id)` e mantém a referência pendente se o evento ainda não chegou.
- `entity_id` identifica a entidade dentro daquele tipo.
- `task_id` e `root_task_id` tornam explícito o escopo da referência.
- O consumidor deve confirmar que tipo, ID e escopo correspondem ao registro referenciado.
- IDs isolados como `"result_001"` não devem ser usados como referência genérica quando puderem ser ambíguos.
- Referências a conteúdo externo (`summary_ref`, `artifact_ref`, `error_ref`, `usage_ref`) são URIs opacas controladas pelo produtor. O esquema permitido, autorização, expiração, integridade e política de acesso precisam ser definidos antes da produção.
- Uma referência não concede autorização de acesso.
- Hashes devem indicar algoritmo e codificação. Um marcador como `"sha256:EXAMPLE"` é apenas ilustrativo, não prova integridade.
## 7. Tipos de evento

Cada tipo de evento representa uma atualização do agregado indicado em `aggregate`. O campo `state`, quando definido, é o estado resultante após a ocorrência. A sequência de estados deve respeitar as transições permitidas.

### 7.1 `task`

Agregado: `{"type":"task","id":task_id,"version":N}`.

Campos obrigatórios do payload: `state`, `created_at`.

Campos opcionais: `parent_task_id`, `title_ref`, `requested_by_ref`. `ended_at` é condicionalmente obrigatório nos estados terminais.

Estado inicial: `planned`.

Estados: `planned`, `queued`, `running`, `completed`, `failed`, `blocked`, `cancelled`.

Transições:
- `planned -> queued | cancelled`
- `queued -> running | cancelled`
- `running -> completed | failed | blocked | cancelled`
- `blocked -> queued | cancelled`

Regras:
- `created_at` é obrigatório e imutável para a tarefa.
- `parent_task_id` segue as regras da seção 4.2.
- `ended_at` é obrigatório em `completed`, `failed` e `cancelled`; é proibido nos estados não terminais.
- `ended_at` deve ser posterior ou igual a `created_at`.
- `blocked` não é terminal; pode retornar a `queued`.

Fixture de tarefa raiz:

```json
{
  "event_id": "evt_task_001",
  "source": "agente-s.example",
  "event_type": "task",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:00:00Z",
  "task_id": "task_001",
  "root_task_id": "task_001",
  "aggregate": {
    "type": "task",
    "id": "task_001",
    "version": 1
  },
  "payload": {
    "state": "planned",
    "created_at": "2026-11-04T12:00:00Z"
  }
}
```

Fixture de tarefa filha:

```json
{
  "event_id": "evt_task_002",
  "source": "agente-s.example",
  "event_type": "task",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:01:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "aggregate": {
    "type": "task",
    "id": "task_002",
    "version": 1
  },
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_task_001"},
  "payload": {
    "state": "planned",
    "created_at": "2026-11-04T12:01:00Z",
    "parent_task_id": "task_001"
  }
}
```

### 7.2 `assignment`

Agregado: `{"type":"assignment","id":assignment_id,"version":N}`.

Campos obrigatórios: `assignment_id`, `agent_id`, `role`, `state`, `assigned_at`.

Campos opcionais: `parent_assignment_ref`, `started_at`, `ended_at`, `failure_ref`.

Estados iniciais permitidos: `proposed` ou `accepted`. Use `proposed` quando a proposta for observada; `accepted` quando a fonte começar a registrar a atribuição somente após sua aceitação.

Estados: `proposed`, `accepted`, `running`, `completed`, `failed`, `blocked`, `cancelled`, `rejected`.

Transições:
- `proposed -> accepted | rejected | cancelled`
- `accepted -> running | cancelled`
- `running -> completed | failed | blocked | cancelled`
- `blocked -> running | cancelled`

Regras:
- A atribuição pertence ao `task_id` do envelope.
- `parent_assignment_ref`, quando presente, é uma referência tipada a uma atribuição delegadora. Pode pertencer a outra tarefa individual, mas deve compartilhar o mesmo `root_task_id`.
- `started_at` é obrigatório em `running`, `completed`, `failed` e `blocked`, pois esses estados só podem ser alcançados após o início. Em `cancelled`, é obrigatório somente se a atribuição chegou a iniciar.
- `ended_at` é obrigatório em `completed`, `failed`, `rejected` e `cancelled`. Não deve ser usado em `blocked`: o bloqueio suspende o trabalho, mas não encerra a atribuição.
- `ended_at` deve ser posterior ou igual a `started_at`, quando ambos existirem.
- Uma atribuição em `running` pode conter várias execuções, inclusive após uma execução falhar. A falha de uma tentativa não encerra automaticamente a atribuição.
- `agent_id` é uma identidade lógica; sua existência no runtime deve ser verificada por fonte independente.

Fixture:

```json
{
  "event_id": "evt_assignment_001",
  "source": "agente-s.example",
  "event_type": "assignment",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:02:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "coordinator",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_task_002"},
  "aggregate": {
    "type": "assignment",
    "id": "assignment_001",
    "version": 1
  },
  "payload": {
    "assignment_id": "assignment_001",
    "agent_id": "developer",
    "role": "implementation",
    "state": "accepted",
    "assigned_at": "2026-11-04T12:02:00Z"
  }
}
```

### 7.3 `execution`

Agregado: `{"type":"execution","id":execution_id,"version":N}`.

Campos obrigatórios: `execution_id`, `assignment_id`, `attempt`, `state`.

Campos opcionais: `started_at`, `ended_at`, `error_ref`, `usage_ref`.

Estado inicial: `queued`.

Estados: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

Transições:
- `queued -> running | cancelled`
- `running -> succeeded | failed | cancelled`

Regras:
- `assignment_id` deve referenciar uma atribuição da mesma tarefa individual e da mesma raiz.
- `attempt` é inteiro positivo, começa em `1` e cresce em um dentro da mesma atribuição.
- Cada tentativa tem novo `execution_id`; reentrega do mesmo evento mantém o mesmo `event_id`, `execution_id` e `attempt`.
- Duas execuções da mesma atribuição não podem usar o mesmo `attempt`.
- `started_at` é obrigatório em `running`, `succeeded` e `failed`; em `cancelled`, só é obrigatório se a execução começou.
- `ended_at` é obrigatório em `succeeded`, `failed` e `cancelled`; deve ser posterior ou igual a `started_at`, quando este existir.
- Uma execução `failed` é terminal. Uma nova tentativa cria outra execução; não reabre a execução falha.
- A atribuição pode permanecer `running` após uma execução falhar, permitindo uma nova tentativa.

Fixture:

```json
{
  "event_id": "evt_execution_001",
  "source": "agente-s.example",
  "event_type": "execution",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:03:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "developer",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_assignment_001"},
  "aggregate": {
    "type": "execution",
    "id": "execution_001",
    "version": 1
  },
  "payload": {
    "execution_id": "execution_001",
    "assignment_id": "assignment_001",
    "attempt": 1,
    "state": "queued"
  }
}
```
### 7.4 `result`

Agregado: `{"type":"result","id":result_id,"version":N}`.

Campos obrigatórios: `result_id`, `execution_ref`, `state`, `result_kind`.

Campos opcionais: `summary_ref`, `evidence_refs`, `content_hash`, `error_ref`. `supersedes_ref` é obrigatório quando o estado for `superseded`.

Estado inicial: `pending`.

Estados: `pending`, `available`, `failed`, `superseded`.

Transições:
- `pending -> available | failed`
- `available -> superseded`

Regras:
- `execution_ref` é uma referência tipada a uma execução da mesma tarefa individual e raiz.
- `supersedes_ref`, quando presente, identifica o resultado que substituiu este resultado. Em um evento com estado `superseded`, deve identificar obrigatoriamente o novo resultado substituto.
- `result_kind` deve pertencer a um vocabulário controlado, versionado e publicado pelo produtor. Até isso existir, o consumidor armazena o valor literal e não presume semântica.
- `content_hash`, se presente, deve declarar algoritmo e codificação em uma especificação de armazenamento.
- `summary_ref` não deve conter o resumo em texto bruto.
- Quando um resultado passar para `superseded`, `supersedes_ref` deve identificar o resultado substituto; o consumidor deve validar que ambos pertencem à mesma tarefa individual e raiz.

Fixture:

```json
{
  "event_id": "evt_result_001",
  "source": "agente-s.example",
  "event_type": "result",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:05:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "developer",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_execution_001"},
  "aggregate": {
    "type": "result",
    "id": "result_001",
    "version": 1
  },
  "payload": {
    "result_id": "result_001",
    "execution_ref": {
      "entity_type": "execution",
      "entity_id": "execution_001",
      "task_id": "task_002",
      "root_task_id": "task_001"
    },
    "state": "pending",
    "result_kind": "proposal",
    "summary_ref": "example-redacted://summary_001"
  }
}
```

### 7.5 `evidence`

Agregado: `{"type":"evidence","id":evidence_id,"version":N}`.

Campos obrigatórios: `evidence_id`, `source_ref`, `kind`, `state`, `captured_at`, `redaction`.

Campos opcionais: `artifact_ref`, `content_hash`, `validation`, `expires_at`.

Estado inicial: `captured`.

Estados: `captured`, `redacted`, `invalid`, `expired`.

Transições:
- `captured -> redacted | invalid | expired`
- `redacted -> invalid | expired`

Regras:
- `source_ref` é uma referência tipada a uma entidade de tipo `result`, `execution` ou `review`, pertencente à mesma tarefa individual e raiz.
- `captured_at` é obrigatório.
- `expires_at`, quando presente, deve ser posterior ou igual a `captured_at`.
- `redaction` e `kind` devem usar vocabulários controlados pelo produtor. `metadata_only` é um valor ilustrativo para evidência sem conteúdo bruto.
- A existência do evento não garante que o artefato continue acessível.

Fixture:

```json
{
  "event_id": "evt_evidence_001",
  "source": "agente-s.example",
  "event_type": "evidence",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:05:10Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "developer",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_result_001"},
  "aggregate": {
    "type": "evidence",
    "id": "evidence_001",
    "version": 1
  },
  "payload": {
    "evidence_id": "evidence_001",
    "source_ref": {
      "entity_type": "result",
      "entity_id": "result_001",
      "task_id": "task_002",
      "root_task_id": "task_001"
    },
    "kind": "verification",
    "state": "captured",
    "captured_at": "2026-11-04T12:05:10Z",
    "redaction": "metadata_only"
  }
}
```

### 7.6 `review`

Agregado: `{"type":"review","id":review_id,"version":N}`.

Campos obrigatórios: `review_id`, `target_ref`, `reviewer_agent_id`, `state`.

Campos opcionais: `started_at`, `ended_at`, `finding_refs`, `decision_ref`.

Estado inicial: `pending`.

Estados: `pending`, `in_progress`, `approved`, `changes_requested`, `blocked`.

Transições:
- `pending -> in_progress | blocked`
- `in_progress -> approved | changes_requested | blocked`
- `blocked -> in_progress`

Regras:
- `target_ref` deve identificar uma tarefa, atribuição, execução, resultado ou evidência; o tipo deve ser explícito.
- `started_at` é obrigatório em `in_progress`, `approved` e `changes_requested`; não é obrigatório em `pending` ou `blocked` antes do início. Se a revisão for retomada após `blocked`, `started_at` deve preservar o instante do primeiro início.
- `ended_at` é obrigatório em `approved` e `changes_requested`. Não deve ser usado em `blocked`, pois esse estado permite retomada. Se uma revisão bloqueada for encerrada definitivamente, o produtor deve emitir uma transição terminal definida em uma futura versão do contrato; até lá, não deve inventar um encerramento.
- Quando ambos existirem, `ended_at` deve ser posterior ou igual a `started_at`.
- `reviewer_agent_id` é uma identidade lógica e não comprova capacidade de execução no runtime.

Fixture:

```json
{
  "event_id": "evt_review_001",
  "source": "agente-s.example",
  "event_type": "review",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:06:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "code-reviewer",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_result_001"},
  "aggregate": {
    "type": "review",
    "id": "review_001",
    "version": 1
  },
  "payload": {
    "review_id": "review_001",
    "target_ref": {
      "entity_type": "result",
      "entity_id": "result_001",
      "task_id": "task_002",
      "root_task_id": "task_001"
    },
    "reviewer_agent_id": "code-reviewer",
    "state": "pending"
  }
}
```
### 7.7 `blocker`

Agregado: `{"type":"blocker","id":blocker_id,"version":N}`.

Campos obrigatórios: `blocker_id`, `related_ref`, `severity`, `state`, `detected_at`, `summary_ref`.

Campos opcionais: `owner_agent_id`, `resolution_ref`, `resolved_at`, `requires_human_approval`.

Estado inicial: `open`.

Estados: `open`, `acknowledged`, `resolved`, `waived`.

Transições:
- `open -> acknowledged | resolved | waived`
- `acknowledged -> resolved | waived`

Regras:
- `related_ref` deve identificar a entidade bloqueada e conter tipo, ID, tarefa individual e raiz.
- `severity` usa `low`, `medium`, `high` ou `critical`.
- `resolved_at` é obrigatório em `resolved` e `waived`, e deve ser posterior ou igual a `detected_at`.
- `summary_ref` é referência controlada, não texto bruto.
- `requires_human_approval` é uma indicação de fluxo, não uma autorização automática para executar a ação.

Fixture:

```json
{
  "event_id": "evt_blocker_001",
  "source": "agente-s.example",
  "event_type": "blocker",
  "schema_version": "1.0",
  "occurred_at": "2026-11-04T12:07:00Z",
  "task_id": "task_002",
  "root_task_id": "task_001",
  "actor_agent_id": "code-reviewer",
  "parent_event_ref": {"source": "agente-s.example", "event_id": "evt_review_001"},
  "aggregate": {
    "type": "blocker",
    "id": "blocker_001",
    "version": 1
  },
  "payload": {
    "blocker_id": "blocker_001",
    "related_ref": {
      "entity_type": "review",
      "entity_id": "review_001",
      "task_id": "task_002",
      "root_task_id": "task_001"
    },
    "severity": "medium",
    "state": "open",
    "detected_at": "2026-11-04T12:07:00Z",
    "summary_ref": "example-redacted://blocker_001"
  }
}
```

## 8. Privacidade e segurança

- Não armazenar prompts, respostas, argumentos de ferramentas, variáveis de ambiente, tokens, cookies ou resultados brutos por padrão.
- Preferir resumos redigidos, referências controladas e hashes quando necessários.
- Redigir antes de persistir; não depender da interface para ocultar dados já armazenados.
- IDs não devem conter nomes pessoais, segredos, caminhos locais ou texto de prompts.
- Referências externas devem ser autorizadas e verificadas pelo serviço que as resolve.
- Não registrar credenciais em `*_ref`, `summary_ref`, mensagens de erro ou logs.
- Definir autenticação, autorização por recurso, criptografia, retenção, exclusão e auditoria antes de produção.
- `usage_ref` não é fonte de faturamento por si só. Métricas devem ter origem e unidade documentadas.

## 9. Versionamento e compatibilidade

- `schema_version` identifica a versão deste contrato, não a versão de cada evento.
- Mudanças compatíveis podem acrescentar campos opcionais dentro da mesma versão, desde que consumidores tolerem extensões conforme a política definida.
- Mudanças incompatíveis — renomear/remover campos obrigatórios, mudar semântica ou tipo — exigem nova versão principal do esquema.
- Consumidores devem rejeitar versões principais desconhecidas e não devem reinterpretar silenciosamente campos.
- O documento e os esquemas JSON Schema correspondentes devem ser versionados juntos quando a implementação começar.
- Recomenda-se usar JSON Schema Draft 2020-12 para validação estrutural; regras entre eventos (referências, versões de agregado e transições) exigem validação adicional na aplicação.

## 10. Validação obrigatória antes de implementar

A aprovação do contrato exige dois níveis distintos:

### 10.1 Validação estrutural

Um validador JSON Schema deve verificar:
- tipos e campos obrigatórios do envelope;
- tipos e campos obrigatórios de cada payload;
- enums e formatos básicos;
- ausência de valores nulos onde o contrato exige omissão;
- versão do esquema.

### 10.2 Validação semântica

Testes de aplicação devem verificar:
- `(source, event_id)` único;
- `(source, aggregate.type, aggregate.id, aggregate.version)` único;
- sequência sem lacunas ao projetar um agregado;
- `aggregate.type` e `aggregate.id` compatíveis com `event_type` e ID do payload;
- `task_id`, `root_task_id` e `parent_task_id` consistentes;
- ausência de ciclos na hierarquia de tarefas;
- referências tipadas existentes e pertencentes ao escopo correto;
- transições de estado permitidas;
- `attempt` único e crescente por atribuição;
- coerência de timestamps;
- comportamento de duplicatas, eventos atrasados, lacunas e conflitos.

A validade sintática de JSON não comprova validade estrutural nem semântica.

## 11. Decisões pendentes antes da produção

1. Identificar a fonte real de eventos e provar quais campos ela fornece.
2. Definir como o produtor atribui `source`, IDs, `aggregate.version` e timestamps.
3. Definir catálogo de agentes e como identidades lógicas são mapeadas para agentes observáveis.
4. Definir transporte, persistência, retentativa, quarentena e prazo de resolução de referências.
5. Definir vocabulários versionados para `role`, `result_kind`, `kind`, `redaction` e `validation`.
6. Definir formatos e autorização das referências externas.
7. Definir política de privacidade, retenção, exclusão e auditoria.
8. Definir se `review` e `blocker` são eventos nativos ou derivados.
9. Definir se tracing distribuído será usado; `trace_id` só deve ser preenchido quando houver contexto de tracing confiável.
10. Criar JSON Schemas e testes de contrato como artefatos separados, após aprovação deste documento.

## 12. Hipóteses não comprovadas

- O runtime atual emitirá qualquer um dos sete tipos definidos.
- O runtime fornecerá IDs estáveis, timestamps, estados e erros estruturados.
- Será possível correlacionar tarefas, delegações, execuções e resultados sem inferência.
- Existirá um armazenamento autorizado para as referências.
- Os nomes lógicos de agentes usados nas fixtures corresponderão a identidades observáveis na integração.

Nenhuma dessas hipóteses deve ser tratada como funcionalidade implementada.

## 13. Referências técnicas

Este contrato é específico do Agente.s e não declara conformidade integral com os padrões abaixo. Eles foram usados como referências de projeto:

1. **CloudEvents Specification** — referência para identidade do evento, origem, tipo, versão e timestamp.
   https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
2. **JSON Schema 2020-12** — referência para validação estrutural de documentos JSON.
   https://json-schema.org/specification
3. **RFC 3339** — formato de timestamps interoperáveis.
   https://www.rfc-editor.org/rfc/rfc3339
4. **W3C Trace Context** — referência para propagação de contexto de tracing distribuído, caso venha a ser adotado.
   https://www.w3.org/TR/trace-context/

---

**Critério de saída desta etapa:** este documento só deve ser marcado como aprovado quando as regras semânticas forem convertidas em testes automatizados e quando a fonte real de eventos tiver sido identificada. Até lá, permanece uma proposta de contrato, não uma descrição do runtime atual.
