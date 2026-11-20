# Agente.s — Avaliação inicial de riscos do dashboard

**Versão:** 0.4.0
**Status:** Avaliação consolidada na fase F0 — não representa aprovação integral de segurança.
**Escopo:** Frontend demonstrativo em `apps/dashboard`, sua publicação no GitHub Pages e o pipeline de CI/CD.

## 1. Objetivo e limites

Interface demonstrativa com quatro áreas: monitoramento (escritório virtual 3D), segurança, fluxo de trabalho e logs/evidências.

Nesta etapa não há API, banco de dados, autenticação, persistência, Bridge local, integração com o Codex App Server nem execução de agentes. Todos os dados são sintéticos e identificados como DEMO.

## 2. Ativos e dados

- Código-fonte e dependências do dashboard (incluindo three.js, @react-three/fiber e @react-three/drei).
- Dados sintéticos usados na interface.
- Configurações de desenvolvimento, build e CI/CD.
- Artefato publicado no GitHub Pages.

Não incluir dados pessoais reais, tokens, credenciais, chaves, cookies ou conteúdo de sessões reais.

## 3. Usuários e permissões

O dashboard não implementa usuários, autenticação ou autorização e não oferece operações privilegiadas.

A futura API deverá aplicar autenticação e autorização no servidor, com negação por padrão e menor privilégio.

## 4. Fronteiras de confiança

- Código-fonte local → processo Vite de desenvolvimento.
- Repositório GitHub → GitHub Actions (build e verificação) → GitHub Pages.
- Navegador → bundle estático publicado.
- Fixtures DEMO → componentes de apresentação.

Não existe fronteira de API externa nesta etapa. Qualquer integração futura deverá tratar os dados recebidos como conteúdo não confiável.

## 5. Ameaças e controles

| Ameaça | Impacto | Controle | Risco residual |
|---|---|---|---|
| Exposição do servidor local | Acesso não autorizado na rede | Vite dev/preview com bind em `127.0.0.1` e porta estrita | Exposição efetiva não verificada em todas as redes locais |
| XSS/injeção de conteúdo | Execução de script | Renderização React de texto; CSP por meta tag no build (`script-src 'self'`, `img-src 'self'`, `object-src 'none'`, `base-uri 'self'`) | Integrações futuras exigirão validação e codificação contextual |
| Clickjacking | Uso indevido da interface | **Nenhum controle efetivo no GitHub Pages** (ver §8.6) | Aceito enquanto o site for estático, sem dados reais nem ações; reavaliar antes de qualquer integração |
| MIME sniffing / Referrer / Permissions-Policy | Vazamento ou abuso de recursos | Cabeçalhos aplicados somente no Vite local | Sem efeito no site publicado (ver §8.6) |
| Vazamento de segredos | Comprometimento de serviços | Secret scanning e push protection nativos do GitHub ativados no repositório (verificado via API em 19/11/2026) | Ver §8.6 |
| Dependência vulnerável | Comprometimento da cadeia | Lockfile versionado; `npm audit --audit-level=high` bloqueia o deploy no CI | Vulnerabilidades médias/baixas não bloqueiam; precisam ser registradas |
| Action comprometida ou alterada | Comprometimento do pipeline | Actions fixadas por SHA completo, em versões que executam em Node 24 (checkout v7.0.1, setup-node v7.1.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1); permissões mínimas por job; `persist-credentials: false`; sintaxe validada com actionlint 1.7.12 | Atualizações das actions passam a ser manuais. `upload-pages-artifact` v5.0.0 fixa `actions/upload-artifact` v7 por SHA. A combinação `upload-pages-artifact` v5 + `deploy-pages` v5 não aparece em exemplo oficial, mas publicou com sucesso em execução real (§8.4). O cache do npm (`cache: npm`) é um risco residual baixo. |
| Regressão publicada | Interface quebrada em público | Job `verify-and-build` obrigatório antes do deploy; job `deploy` restrito a `refs/heads/main` no workflow e pela regra do environment `github-pages`; publicação somente se o commit for o HEAD atual da `main` (§8.2) | Não há testes de interface automatizados no CI |
| Publicação fora de ordem | Commit antigo sobrescreve versão mais nova | Passo "Check commit is current main HEAD" dentro do grupo de concorrência do deploy (§8.2) | Ver §8.2, riscos residuais |
| Regressão chega à `main` sem verificação | Código não verificado na branch principal | **Nenhum controle ativo:** a `main` não tem proteção de branch e não há verificação em Pull Requests | Ver §8.7 |
| Confusão DEMO/real | Decisão operacional incorreta | Rótulos DEMO e avisos na interface | Revisar antes de conectar fontes reais |
| Exposição em logs | Vazamento de dados | Sem telemetria ou persistência de eventos | Política de logs necessária na futura API |

## 6. Controles aplicáveis às 16 categorias

1. **Aplicação:** renderização React de conteúdo textual, sem HTML arbitrário. CSP por meta tag no build publicado.
2. **Autenticação:** fora do escopo; necessária antes de disponibilizar dados privados.
3. **Autorização:** sem operações protegidas; autorização server-side obrigatória na API futura.
4. **Dados e privacidade:** somente fixtures sintéticas.
5. **Segredos:** nenhuma credencial identificada. Secret scanning e push protection do GitHub ativados. Variáveis privadas nunca devem usar prefixos expostos ao cliente.
6. **API e comunicação:** sem API. HTTPS imposto pelo GitHub Pages (`https_enforced: true`, HSTS entregue pelo GitHub).
7. **Infraestrutura:** servidor local em `127.0.0.1`. No GitHub Pages, somente a CSP por meta tag está ativa (limitações em §8.6).
8. **Dependências:** lockfile versionado; auditoria no CI com bloqueio para severidade alta ou crítica.
9. **Código seguro:** TypeScript strict; sem execução dinâmica nem injeção de HTML no código revisado.
10. **Testes de segurança:** testes de contrato, baseline e codificação executados no CI; auditoria de dependências no CI. DAST, SAST e testes de interface automatizados permanecem pendentes.
11. **Logs e monitoramento:** sem persistência de eventos ou telemetria real.
12. **Resposta a incidentes:** procedimento de produção fora do escopo desta etapa.
13. **Backup e continuidade:** código versionado no Git; rollback possível por novo deploy de um commit anterior.
14. **Segurança de IA:** nenhum agente conectado ao dashboard. Os revisores dependem do sandbox da sessão pai do Codex (ver README, "Revisões somente leitura").
15. **CI/CD:** verificação obrigatória antes do deploy, deploy somente a partir da `main` e somente do HEAD atual, permissões mínimas por job, actions fixadas por SHA em versões Node 24 e sintaxe validada com actionlint. Não há verificação em Pull Requests.
16. **Governança:** padrões em `standards/`. A `main` não está protegida (§8.7). A revisão independente de segurança completa permanece pendente.

## 7. Critérios de aceitação

Os detalhes e as evidências de cada item estão na seção 8.

- [x] Quatro painéis navegáveis sem chamadas de negócio.
- [x] Dados sintéticos identificados como DEMO.
- [x] Sem autenticação simulada ou operações privilegiadas.
- [x] Servidor local restrito a `127.0.0.1`.
- [x] Typecheck e build executados e aprovados.
- [x] Lockfile versionado e auditoria npm sem vulnerabilidades na última verificação.
- [x] 42 testes (contrato, baseline e codificação) executados localmente, sem falhas.
- [x] CSP presente no HTML gerado pelo build e verificada em navegador sem violações (Edge headless, `vite preview`).
- [x] Seleção de agentes por teclado verificada em navegador (Edge headless).
- [x] Workflow validado com actionlint 1.7.12 sem erros (sem shellcheck: os scripts `run:` não foram analisados por ele).
- [x] Secret scanning nativo do GitHub ativado.
- [x] Passo de atualidade do deploy testado localmente em 11 cenários, com teste de mutação (§8.2).
- [x] Cenários de job do workflow executados com act e stubs (§8.3).
- [x] Primeira execução real do workflow no GitHub Actions, com publicação confirmada (§8.4).
- [x] CSP verificada no HTML servido pelo site publicado (§8.4).
- [ ] Validação visual completa do site publicado em navegador (renderização da cena 3D e ausência de violações da CSP no site publicado).
- [ ] Teste com leitor de tela real (NVDA) (§8.5).
- [ ] Teste ponta a ponta do sandbox read-only com os subagentes revisores.
- [ ] Revisão independente de segurança concluída.

Os itens marcados representam verificações executadas com resultado registrado. Não representam certificação ou aprovação integral de segurança.

## 8. Evidências, limitações e riscos pendentes

### 8.1 Matriz de verificação do deploy

| Comportamento | Testes locais do passo (§8.2) | act com stubs (§8.3) | Produção (§8.4) |
|---|---|---|---|
| Commit atual da `main` publica | Aprovado | Aprovado | **Comprovado** (run `44734910260`) |
| Commit desatualizado é bloqueado | Aprovado | Aprovado | Não exercitado |
| Execução fora da `main` é bloqueada | Aprovado (passo) | Aprovado (`if` do job) | Não exercitado |
| Falha no `verify-and-build` bloqueia o deploy | — | Aprovado | Não exercitado |
| Falha na consulta da `main` não publica (fail closed) | Aprovado | Aprovado (host inválido) | Não exercitado |
| Referência conflitante `x/refs/heads/main` não interfere | Aprovado | — | Não exercitado |
| Fila de concorrência e corrida de ordem entre execuções | — | Não reproduzido | Não exercitado |
| Regra do environment `github-pages` | — | Não reproduzido | Aceitação da `main` comprovada; rejeição de outras branches não exercitada |
| `permissions`, token OIDC e publicação real (`deploy-pages`) | — | Não reproduzido | **Comprovado** |
| Runner hospedado `ubuntu-latest` | — | Não reproduzido (outra imagem) | **Comprovado** |
| Evento `workflow_dispatch`; indisponibilidade por timeout ou HTTP 5xx | — | Não testado | Não exercitado |

### 8.2 Concorrência e atualidade do deploy

- **Controle implementado:** o grupo `github-pages` (`cancel-in-progress: false`) fica somente no job `deploy`. Isso impede publicações simultâneas e evita que verificações de outras branches cancelem uma publicação pendente. Dentro desse grupo, imediatamente antes de publicar, o passo "Check commit is current main HEAD" compara `github.sha` com o HEAD atual da `main` (`git ls-remote`, sem credenciais). Como o padrão do `git ls-remote` casa por sufixo, a saída é filtrada para aceitar **somente** a referência exata `refs/heads/main` (correção do achado B1 da revisão independente do commit `767dfb7`, aplicada no commit `1f551ae`). O passo de deploy só executa com `publish == 'true'`.
- **Comportamento:** commit desatualizado ou execução fora da `main` gera `publish=false`, o passo de deploy é ignorado e um aviso é registrado no log. Falha ao consultar a `main` faz o job falhar sem publicar (fail closed). Com isso, um commit antigo cuja verificação termine depois da de um commit mais novo não é publicado por cima dele.
- **Testes locais (19/11/2026; ampliados em 20/11/2026):** o script do passo, extraído diretamente do workflow, foi executado em 11 cenários, todos aprovados:
  - os 8 cenários originais: commit atual da `main` publica; commit antigo é bloqueado; outra branch é bloqueada, inclusive com SHA igual ao HEAD; `main` inexistente e remoto inacessível falham sem publicar; e consulta somente leitura ao repositório real no GitHub com HEAD atual (publica) e commit antigo (bloqueia);
  - 3 cenários com a referência conflitante `refs/heads/x/refs/heads/main`: com `main` presente, o commit atual publica e o SHA da referência conflitante é bloqueado; com somente a referência conflitante no remoto, o passo falha sem publicar.
  - Um teste de mutação confirmou que o teste detecta a comparação invertida e a perda do fail closed.
  - Executados contra a versão anterior do workflow (commit `767dfb7`), 5 dos 11 cenários falharam: com a referência conflitante presente, o deploy falhava inclusive para o commit atual (bloqueio indevido); e, com somente a referência conflitante no remoto, a versão anterior publicava (fail open). A correção elimina os dois comportamentos.
- **Riscos residuais:**
  1. Se o commit mais novo falhar na verificação, o commit anterior também não é publicado, e o site permanece na última versão publicada até um novo push aprovado (falha segura, mas o site fica desatualizado).
  2. Janela de segundos entre a consulta e a publicação: um commit enviado nesse intervalo será publicado pela execução dele, que roda depois na fila.
  3. A consulta sem credenciais depende de o repositório ser público. Se ele se tornar privado, o passo falha e nada é publicado até ajuste.
  4. Esperado, não verificado: o GitHub pode registrar uma implantação no environment `github-pages` para a execução ignorada, embora o Pages não seja alterado.

### 8.3 Testes com act (19/11/2026)

- **Método:** act 0.2.98 com Docker Desktop, imagem `buildpack-deps:bookworm-scm`, evento `push` simulado e clone isolado fora do repositório. Foi usada uma cópia do workflow gerada automaticamente: todas as etapas com `uses:` (checkout, setup-node, upload-pages-artifact, deploy-pages) e as etapas de build foram trocadas por stubs `echo`. Uma verificação automática confirmou que o topo do workflow, os cabeçalhos dos dois jobs (`needs`, `if`, `concurrency`, `permissions`, `environment`), o passo "Check commit is current main HEAD" e o `if` do passo de deploy eram idênticos byte a byte ao workflow real. O passo de atualidade consultou a `main` real do repositório público, somente leitura e sem credenciais. A versão testada é anterior à correção B1; a linha alterada pela correção é coberta pelos testes locais (§8.2).
- **Cenários de comportamento (5, todos aprovados):**
  1. Verificação aprovada + commit atual da `main`: `publish=true`; o stub de deploy executou.
  2. Verificação aprovada + commit antigo: `publish=false`, com aviso de commit desatualizado; o stub de deploy foi ignorado.
  3. Execução em outra branch (`refs/heads/feature`): o job `deploy` não iniciou (bloqueado pelo `if` do job).
  4. Falha no `verify-and-build` (falha simulada no stub de testes): o job `deploy` não iniciou.
  5. Consulta da `main` indisponível (host inválido): o passo de atualidade falhou, o job `deploy` falhou e o stub de deploy não executou.
- **Cenário 6, ausência de publicação real (aprovado):** nenhuma ação real foi baixada ou executada em nenhum cenário. O stub de deploy executou somente no cenário 1 e apenas imprimiu um marcador. O act injeta automaticamente um `GITHUB_TOKEN` obtido do GitHub CLI quando nenhum é informado; os cenários foram executados com um token fictício explícito, confirmado pelo próprio stub, e nenhum token foi usado para publicar.
- **Testes de mutação (2, ambos detectados):**
  - sem o `if` do job `deploy`, a execução em outra branch iniciou o job, e o passo de atualidade bloqueou a publicação sozinho (`publish=false`), o que comprova a segunda camada de proteção;
  - com `always()` no lugar de `success()`, a falha na verificação deixou o stub de deploy executar, o que comprova que o act avalia `needs`/`success()` e que o cenário 4 tem valor real.
- **Limitações do act:** não reproduz a fila real de concorrência (`concurrency`, `cancel-in-progress` e substituição de execuções pendentes), as regras do environment `github-pages` (política de branch e registros de implantação), as `permissions` e o token OIDC (`id-token`) da publicação real (`deploy-pages` não foi executado) nem o runner hospedado `ubuntu-latest`. O que foi comprovado depois em produção está na matriz (§8.1).

### 8.4 Execução real no GitHub Actions (20/11/2026)

- O commit `1f551ae051b86985160e298a5468d61ba7becd1b` foi enviado à `main` (`4a97294..1f551ae`, incluindo `767dfb7`) e disparou o GitHub Actions run `44734910260`, concluído com sucesso.
- Job `verify-and-build`: todos os passos aprovados (testes, auditoria, typecheck, build, verificação da CSP e upload do artefato).
- Job `deploy`: o passo de atualidade registrou "Commit 1f551ae051b86985160e298a5468d61ba7becd1b e o HEAD atual da main: publicacao permitida."; o `deploy-pages` registrou a implantação de `1f551ae` e "Reported success!".
- Nenhuma anotação na execução; o aviso de depreciação do Node.js 20 da execução anterior não aparece mais.
- Site publicado: resposta HTTP 200, com a meta tag CSP presente no HTML servido e igual à política do build (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`).
- Somente o caminho de publicação foi exercitado em produção. Os caminhos de bloqueio continuam comprovados apenas pelos testes locais e pelo act (§8.1).

### 8.5 Acessibilidade do seletor de agentes e da cena 3D

Separada por nível de comprovação (Edge headless, `vite preview`, 19/11/2026):

- **Confirmado na árvore de acessibilidade do navegador** (Chrome DevTools Protocol, `Accessibility.getFullAXTree`): grupo "Selecionar agente (alternativa acessível ao escritório 3D)" com quatro filhos `button` focáveis, cada um com nome acessível completo (nome, papel e estado do agente); a cena 3D exposta com papel `image` e a descrição definida em `aria-label`.
- **Confirmado somente no DOM:** `aria-current="true"` presente apenas no botão do agente selecionado e movido corretamente ao selecionar outro agente por teclado. A árvore de acessibilidade obtida pelo protocolo não expõe essa propriedade, então a exposição de `aria-current` às tecnologias assistivas não foi verificada.
- **Confirmado por interação automatizada:** navegação por Tab/Shift+Tab, seleção por Enter e Espaço, contorno de foco visível de 3px e seleção por clique na cena 3D.
- **Depende de teste com NVDA (não realizado):** o anúncio do estado "atual" nos botões, o anúncio da atualização do inspetor (`aria-live`) e a ausência de leitura duplicada dos rótulos 3D dentro de `role="img"`.

### 8.6 Limitações gerais

- **Cabeçalhos e clickjacking:** o GitHub Pages não entrega cabeçalhos HTTP personalizados. Não há proteção contra clickjacking: `frame-ancestors` não funciona em meta tag e o Pages não permite `X-Frame-Options`. `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy` também não estão ativos no site publicado. Alternativas, que exigem decisão própria: hospedagem com suporte a cabeçalhos ou um proxy/CDN na frente do Pages.
- **CSP por meta tag:** só protege recursos carregados depois de sua leitura; por isso ela é inserida no início do `<head>`.
- **`vercel.json`:** não é usado pelo deploy atual e não tem efeito no site publicado. Mantido para uma possível migração; não deve ser citado como controle ativo.
- **Segredos:** a busca local por segredos no histórico Git foi heurística, não especializada. O secret scanning do GitHub cobre padrões de provedores conhecidos; padrões genéricos (`non_provider_patterns`) estão desativados.
- **Dependências:** `npm audit` sem vulnerabilidades não garante ausência de vulnerabilidades futuras ou desconhecidas.
- **Fora do escopo desta etapa:** autenticação, autorização, API, banco de dados, auditoria persistente, Bridge e integração com o Codex.
- Esta avaliação não comprova conformidade integral, certificação, segurança absoluta ou ausência de vulnerabilidades.

### 8.7 Governança do repositório (pendente; exige decisão e configuração no GitHub)

Verificado via API em 19/11/2026: a branch `main` **não tem proteção**, e o workflow só roda em `push` na `main` e em `workflow_dispatch`. Consequência: uma alteração pode chegar à `main` sem passar pelas verificações. Ela não é publicada, porque o deploy depende do job `verify-and-build`, mas permanece na branch principal.

Necessário, conforme `standards/SECURITY-BASELINE.md` §3.15 ("Proteger branches", "Exigir revisão para alterações sensíveis"). Também verificado via API: o repositório aceita rulesets (`GET /repos/{owner}/{repo}/rulesets` retornou `[]`) e nenhum está configurado.

#### Pré-requisito: verificação em Pull Requests (ainda não existe)

A regra de verificações obrigatórias exige informar o **nome** de uma verificação. Hoje nenhuma verificação roda em Pull Requests, então essa regra não pode ser configurada corretamente antes deste passo:

1. Criar um workflow separado, por exemplo `.github/workflows/verify.yml`, com gatilho `pull_request` para a `main`. Ele deve executar **somente** as verificações (testes, `npm audit --audit-level=high`, typecheck, build e checagem da CSP), sem job de deploy, sem `concurrency: github-pages` e com `permissions: contents: read`.
2. Dar ao job um identificador estável, por exemplo `verify`. É esse nome que aparecerá como verificação no Pull Request.
3. Abrir um Pull Request de teste para que a verificação rode ao menos uma vez e passe a ser selecionável. A documentação exige que a origem da verificação "must have recently submitted a check run".

Este workflow ainda não foi criado.

#### Procedimento do ruleset `protect-main`

Caminho na interface, conforme a documentação do GitHub ("Creating rulesets for a repository"): página do repositório → **Settings** → na barra lateral, em "Code, planning, and automation", **Rulesets** → **New ruleset** → **New branch ruleset**.

| Campo | Valor |
|---|---|
| Ruleset name | `protect-main` |
| Enforcement status | **Active** (o padrão é **Disabled**; existe também **Evaluate**, para testar sem aplicar) |
| Bypass list | Vazia. Ver a observação sobre mantenedor único abaixo. |
| Target branches | **Add a target** → incluir a branch padrão (`main`) |

Regras a marcar:

| Regra | Configuração |
|---|---|
| **Restrict deletions** | Marcada (padrão) |
| **Block force pushes** | Marcada (padrão) |
| **Require a pull request before merging** | Marcada. Número de aprovações exigidas: **0** enquanto houver um único mantenedor; **1** quando houver mais de um, junto com **Dismiss stale pull request approvals when new commits are pushed** e **Require approval of the most recent reviewable push** |
| **Require status checks to pass before merging** | Marcada somente **após** o pré-requisito. Marcar **Require branches to be up to date before merging**. Adicionar a verificação pelo nome do job (ex.: `verify`) e selecionar **GitHub Actions** como origem esperada, em vez de "any source" |

Observação sobre mantenedor único (inferência, não citada nas páginas oficiais consultadas; confirmar no GitHub): o autor de um Pull Request normalmente não pode aprovar o próprio PR. Com aprovações exigidas ≥ 1 e a lista de bypass vazia, um mantenedor único não conseguiria fazer o merge. Por isso a recomendação é **0** aprovações enquanto houver um mantenedor: o PR continua obrigatório e as verificações continuam bloqueando o merge. A alternativa, adicionar o administrador à lista de bypass com **For pull requests only**, também permitiria contornar as verificações obrigatórias, então não é recomendada.

Efeito esperado após aplicar: alterações na `main` só entram por Pull Request com a verificação aprovada; o merge dispara o workflow de deploy (`push` na `main`), que verifica novamente antes de publicar.

Esses itens alteram configurações do repositório no GitHub e **não foram aplicados**.

## 9. Próximo passo

Pendências após o primeiro deploy real (run `44734910260`):

- validar visualmente o site publicado em navegador (cena 3D e ausência de violações da CSP);
- realizar o teste com leitor de tela real (NVDA);
- executar o teste ponta a ponta do sandbox read-only dos subagentes revisores;
- aplicar a governança da `main` (verificação em Pull Requests e ruleset `protect-main`);
- decidir sobre a proteção contra clickjacking, que exige hospedagem com cabeçalhos ou proxy/CDN;
- concluir a revisão independente de segurança completa.

Nenhum commit, push ou deploy deve ser realizado sem autorização explícita.
