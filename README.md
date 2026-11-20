# Agente.s — AI Software Factory

Agente.s é a base de uma fábrica de software assistida por IA: uma equipe de agentes especializados que trabalha com instruções, limites claros e evidências de execução.

## Estado atual (fase F0)

| Componente | Estado real |
|---|---|
| Regras compartilhadas (`AGENTS.md`) e padrões (`standards/`) | Documentados; testes verificam a presença dos requisitos no texto, não a aplicação técnica dos controles |
| Agentes Codex em `.codex/agents/` | Quatro definições: `coordinator`, `developer`, `code-reviewer`, `security-reviewer` |
| Dashboard (`apps/dashboard`) | React/Vite com dados **sintéticos (DEMO)**, incluindo escritório virtual 3D e seletor acessível por teclado |
| Contrato de eventos (`docs/event-contract.md`) | Proposta técnica; validador existe somente nos testes |
| CI/CD (`.github/workflows/deploy.yml`) | Testes, auditoria de dependências, typecheck e build antes de publicar no GitHub Pages |
| Bridge local, integração com Codex App Server, autenticação, persistência e execução real de agentes | **Não implementados** |

## Agentes

- `coordinator`: planeja, delega e consolida evidências;
- `developer`: implementa mudanças de escopo definido;
- `code-reviewer`: revisa mudanças de forma independente;
- `security-reviewer`: revisa segurança conforme as 16 categorias do baseline.

As definições contêm instruções em texto. Elas não criam um serviço, painel, dependência ou execução automática.

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
