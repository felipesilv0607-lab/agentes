# Agente.s — AI Software Factory

Agente.s é a base de uma fábrica de software assistida por IA: uma equipe de agentes especializados que trabalha com instruções, limites claros e evidências de execução.

## Primeira etapa

Esta primeira versão estabelece a fundação operacional do repositório:

- regras compartilhadas em `AGENTS.md`;
- dois papéis iniciais de agentes personalizados do Codex;
- fluxo de trabalho: analisar → planejar → implementar → testar → revisar → apresentar resultado.

Os agentes desta etapa são:

- `developer`: implementa mudanças de escopo definido;
- `code-reviewer`: revisa mudanças independentemente e reporta riscos e evidências.

As definições estão em `.codex/agents/`. Elas não criam um serviço, painel web, dependências ou execução automática.

## Uso previsto

Abra este diretório no Codex e delegue tarefas de implementação ao `developer` e de revisão ao `code-reviewer`, quando a instalação local reconhecer agentes personalizados do projeto. Antes de qualquer ação destrutiva, publicação ou alteração sensível, obtenha aprovação humana.

## Próxima etapa

Validar o carregamento dos agentes pela instalação local do Codex e, depois, ampliar a equipe com coordenação e testes antes de iniciar um painel de observabilidade.
