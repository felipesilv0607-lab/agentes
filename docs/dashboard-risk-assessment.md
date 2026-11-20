# Agente.s — Avaliação inicial de riscos do dashboard

**Versão:** 0.3.0
**Status:** Avaliação atualizada na fase F0 — não representa aprovação integral de segurança.
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
| Clickjacking | Uso indevido da interface | **Nenhum controle efetivo no GitHub Pages.** `frame-ancestors` não funciona em meta tag e o Pages não permite `X-Frame-Options` | Aceito enquanto o site for estático, sem dados reais nem ações; reavaliar antes de qualquer integração |
| MIME sniffing / Referrer / Permissions-Policy | Vazamento ou abuso de recursos | Cabeçalhos aplicados somente no Vite local; não aplicáveis no Pages | Sem efeito no site publicado |
| Vazamento de segredos | Comprometimento de serviços | Secret scanning e push protection nativos do GitHub ativados no repositório (verificado via API em 19/11/2026) | Busca local no histórico foi heurística, não especializada |
| Dependência vulnerável | Comprometimento da cadeia | Lockfile versionado; `npm audit --audit-level=high` bloqueia o deploy no CI | Vulnerabilidades médias/baixas não bloqueiam; precisam ser registradas |
| Action comprometida ou alterada | Comprometimento do pipeline | Actions fixadas por SHA completo, em versões que executam em Node 24 (checkout v7.0.1, setup-node v7.1.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1); permissões mínimas por job; `persist-credentials: false`; sintaxe validada com actionlint 1.7.12 | Atualizações das actions passam a ser manuais. `upload-pages-artifact` v5.0.0 fixa `actions/upload-artifact` v7 por SHA. A combinação `upload-pages-artifact` v5 + `deploy-pages` v5 não aparece em exemplo oficial e só será comprovada na primeira execução. O cache do npm (`cache: npm`) é um risco residual baixo. |
| Regressão publicada | Interface quebrada em público | Job `verify-and-build` obrigatório antes do deploy; job `deploy` restrito a `refs/heads/main` no workflow e pela regra do environment `github-pages`; publicação somente se o commit for o HEAD atual da `main` | Não há testes de interface automatizados no CI |
| Publicação fora de ordem | Commit antigo sobrescreve versão mais nova | Passo "Check commit is current main HEAD" dentro do grupo de concorrência do deploy | Ver seção 8, "Concorrência e ordem do deploy" |
| Regressão chega à `main` sem verificação | Código não verificado na branch principal | **Nenhum controle ativo:** a `main` não tem proteção de branch e não há verificação em Pull Requests | Ver seção 8, "Governança do repositório" |
| Confusão DEMO/real | Decisão operacional incorreta | Rótulos DEMO e avisos na interface | Revisar antes de conectar fontes reais |
| Exposição em logs | Vazamento de dados | Sem telemetria ou persistência de eventos | Política de logs necessária na futura API |

## 6. Controles aplicáveis às 16 categorias

1. **Aplicação:** renderização React de conteúdo textual, sem HTML arbitrário. CSP por meta tag no build publicado.
2. **Autenticação:** fora do escopo; necessária antes de disponibilizar dados privados.
3. **Autorização:** sem operações protegidas; autorização server-side obrigatória na API futura.
4. **Dados e privacidade:** somente fixtures sintéticas.
5. **Segredos:** nenhuma credencial identificada. Secret scanning e push protection do GitHub ativados. Variáveis privadas nunca devem usar prefixos expostos ao cliente.
6. **API e comunicação:** sem API. HTTPS imposto pelo GitHub Pages (`https_enforced: true`, HSTS entregue pelo GitHub).
7. **Infraestrutura:** servidor local em `127.0.0.1`. No GitHub Pages, somente a CSP por meta tag está ativa; cabeçalhos personalizados não são suportados. O arquivo `vercel.json` permanece no repositório, mas **não tem efeito** no deploy atual.
8. **Dependências:** lockfile versionado; auditoria no CI com bloqueio para severidade alta ou crítica.
9. **Código seguro:** TypeScript strict; sem execução dinâmica nem injeção de HTML no código revisado.
10. **Testes de segurança:** testes de contrato, baseline e codificação executados no CI; auditoria de dependências no CI. DAST, SAST e testes de interface automatizados permanecem pendentes.
11. **Logs e monitoramento:** sem persistência de eventos ou telemetria real.
12. **Resposta a incidentes:** procedimento de produção fora do escopo desta etapa.
13. **Backup e continuidade:** código versionado no Git; rollback possível por novo deploy de um commit anterior.
14. **Segurança de IA:** nenhum agente conectado ao dashboard. Os revisores dependem do sandbox da sessão pai do Codex (ver README, "Revisões somente leitura").
15. **CI/CD:** workflow com verificação obrigatória antes do deploy, deploy somente a partir da `main`, permissões mínimas por job, actions fixadas por SHA em versões Node 24 e sintaxe validada com actionlint. Não há verificação em Pull Requests.
16. **Governança:** padrões em `standards/`. A `main` não está protegida (ver seção 8). A revisão independente de segurança completa permanece pendente.

## 7. Critérios de aceitação

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
- [x] Passo de atualidade do deploy testado localmente em 8 cenários, com teste de mutação.
- [x] Cenários de job do workflow executados com act e stubs (5 cenários de comportamento aprovados; nenhuma publicação real; 2 testes de mutação detectados). Fila de concorrência, environment `github-pages`, permissões/token de publicação e runner hospedado não reproduzidos.
- [ ] Teste com leitor de tela real (NVDA).
- [x] Secret scanning nativo do GitHub ativado.
- [ ] Primeira execução do novo workflow no GitHub Actions.
- [ ] CSP verificada no site publicado após o próximo deploy.
- [ ] Teste ponta a ponta do sandbox read-only com os subagentes revisores.
- [ ] Revisão independente de segurança concluída.

Os itens marcados representam verificações executadas com resultado registrado. Não representam certificação ou aprovação integral de segurança.

## 8. Limitações e riscos pendentes

- O GitHub Pages não entrega cabeçalhos personalizados. Não há proteção contra clickjacking, e `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy` não estão ativos no site publicado. Alternativas, que exigem decisão própria: hospedagem com suporte a cabeçalhos ou um proxy/CDN na frente do Pages.
- A CSP por meta tag só protege recursos carregados depois de sua leitura; por isso ela é inserida no início do `<head>`.
- `vercel.json` não é usado pelo deploy atual. Mantido para uma possível migração; não deve ser citado como controle ativo.
- A busca local por segredos no histórico Git foi heurística. O secret scanning do GitHub cobre padrões de provedores conhecidos; padrões genéricos (`non_provider_patterns`) estão desativados.
- `npm audit` sem vulnerabilidades não garante ausência de vulnerabilidades futuras ou desconhecidas.
- Concorrência e ordem do deploy:
  - **Controle implementado:** o grupo `github-pages` (`cancel-in-progress: false`) fica somente no job `deploy`. Isso impede publicações simultâneas e evita que verificações de outras branches cancelem uma publicação pendente. Dentro desse grupo, imediatamente antes de publicar, o passo "Check commit is current main HEAD" compara `github.sha` com o HEAD atual da `main` (`git ls-remote`, sem credenciais). O passo de deploy só executa com `publish == 'true'`.
  - **Comportamento:** commit desatualizado ou execução fora da `main` gera `publish=false`, o passo de deploy é ignorado e um aviso é registrado no log. Falha ao consultar a `main` faz o job falhar sem publicar (fail closed). Com isso, um commit antigo cuja verificação termine depois da de um commit mais novo não é mais publicado por cima dele.
  - **Testado localmente (19/11/2026):** o script do passo, extraído diretamente do workflow, foi executado em 8 cenários: commit atual da `main` publica; commit antigo é bloqueado; outra branch é bloqueada, inclusive com SHA igual ao HEAD; `main` inexistente e remoto inacessível falham sem publicar; e consulta somente leitura ao repositório real no GitHub com HEAD atual (publica) e commit antigo (bloqueia). Um teste de mutação confirmou que o teste detecta a comparação invertida e a perda do fail closed.
  - **Executado com act (19/11/2026):** act 0.2.98 com Docker Desktop, imagem `buildpack-deps:bookworm-scm`, evento `push` simulado e clone isolado fora do repositório. Foi usada uma cópia do workflow gerada automaticamente: todas as etapas com `uses:` (checkout, setup-node, upload-pages-artifact, deploy-pages) e as etapas de build foram trocadas por stubs `echo`. Uma verificação automática confirmou que o topo do workflow, os cabeçalhos dos dois jobs (`needs`, `if`, `concurrency`, `permissions`, `environment`), o passo "Check commit is current main HEAD" e o `if` do passo de deploy eram idênticos byte a byte ao workflow real. O passo de atualidade consultou a `main` real do repositório público, somente leitura e sem credenciais.
    - **Cenários de comportamento (5, todos aprovados):**
      1. Verificação aprovada + commit atual da `main`: `publish=true`; o stub de deploy executou.
      2. Verificação aprovada + commit antigo: `publish=false`, com aviso de commit desatualizado; o stub de deploy foi ignorado.
      3. Execução em outra branch (`refs/heads/feature`): o job `deploy` não iniciou (bloqueado pelo `if` do job).
      4. Falha no `verify-and-build` (falha simulada no stub de testes): o job `deploy` não iniciou.
      5. Consulta da `main` indisponível (host inválido): o passo de atualidade falhou, o job `deploy` falhou e o stub de deploy não executou.
    - **Cenário 6, ausência de publicação real (aprovado):** nenhuma ação real foi baixada ou executada em nenhum cenário. O stub de deploy executou somente no cenário 1, e apenas imprimiu um marcador. Observação: o act injeta automaticamente um `GITHUB_TOKEN` obtido do GitHub CLI quando nenhum é informado. Os cenários foram executados com um token fictício explícito, confirmado pelo próprio stub, e nenhum token foi usado para publicar.
    - **Testes de mutação (2, ambos detectados):**
      - sem o `if` do job `deploy`, a execução em outra branch iniciou o job, e o passo de atualidade bloqueou a publicação sozinho (`publish=false`), o que comprova a segunda camada de proteção;
      - com `always()` no lugar de `success()`, a falha na verificação deixou o stub de deploy executar, o que comprova que o act avalia `needs`/`success()` e que o cenário 4 tem valor real.
    - **O que o act não reproduz (permanece não testado):** a fila real de concorrência (`concurrency`, `cancel-in-progress` e substituição de execuções pendentes) e a corrida de ordem entre execuções reais; as regras do environment `github-pages` (política de branch e registros de implantação); as `permissions` e o token OIDC (`id-token`) usados pela publicação real (`deploy-pages` não foi executado); o runner hospedado `ubuntu-latest` (foi usada outra imagem). O evento `workflow_dispatch` não foi testado separadamente, e outros tipos de indisponibilidade da `main` (timeout, HTTP 5xx) não foram simulados.
  - **Pendente:** a primeira execução real do workflow no GitHub Actions, que é a única forma de comprovar os itens que o act não reproduz.
  - **Riscos residuais:** (1) se o commit mais novo falhar na verificação, o commit anterior também não é publicado e o site permanece na última versão publicada até um novo push aprovado (falha segura, mas o site fica desatualizado); (2) janela de segundos entre a consulta e a publicação: um commit enviado nesse intervalo será publicado pela execução dele, que roda depois na fila; (3) a consulta sem credenciais depende de o repositório ser público. Se ele se tornar privado, o passo falha e nada é publicado até ajuste; (4) esperado, não verificado: o GitHub pode registrar uma implantação no environment `github-pages` para a execução ignorada, embora o Pages não seja alterado.
- Autenticação, autorização, API, banco de dados, auditoria persistente, Bridge e integração com o Codex permanecem fora desta etapa.
- Acessibilidade do seletor de agentes e da cena 3D, separada por nível de comprovação (Edge headless, `vite preview`, 19/11/2026):
  - **Confirmado na árvore de acessibilidade do navegador** (Chrome DevTools Protocol, `Accessibility.getFullAXTree`): grupo "Selecionar agente (alternativa acessível ao escritório 3D)" com quatro filhos `button` focáveis, cada um com nome acessível completo (nome, papel e estado do agente); a cena 3D exposta com papel `image` e a descrição definida em `aria-label`.
  - **Confirmado somente no DOM:** `aria-current="true"` presente apenas no botão do agente selecionado e movido corretamente ao selecionar outro agente por teclado. A árvore de acessibilidade obtida pelo protocolo não expõe essa propriedade, então a exposição de `aria-current` às tecnologias assistivas não foi verificada.
  - **Confirmado por interação automatizada:** navegação por Tab/Shift+Tab, seleção por Enter e Espaço, contorno de foco visível de 3px e seleção por clique na cena 3D.
  - **Depende de teste com NVDA (não realizado):** o anúncio do estado "atual" nos botões, o anúncio da atualização do inspetor (`aria-live`) e a ausência de leitura duplicada dos rótulos 3D dentro de `role="img"`.
- Esta avaliação não comprova conformidade integral, certificação, segurança absoluta ou ausência de vulnerabilidades.

### Governança do repositório (pendente; exige decisão e configuração no GitHub)

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

Concluir a revisão independente de código e segurança, executar o teste ponta a ponta do sandbox dos revisores e verificar a CSP no site publicado após um deploy autorizado.

Nenhum commit, push ou deploy deve ser realizado sem autorização explícita.
