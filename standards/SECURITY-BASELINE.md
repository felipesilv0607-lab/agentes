# Agente.s — Padrão Global de Segurança

**Versão:** 1.0.0
**Status:** Padrão interno de engenharia
**Escopo:** Todos os projetos desenvolvidos ou mantidos pelo Agente.s.

## 1. Objetivo

Estabelecer segurança desde a concepção (Security by Design), abrangendo arquitetura, desenvolvimento, testes, publicação e manutenção.

Princípios obrigatórios:
- Secure by Design e Secure by Default.
- Defesa em profundidade.
- Menor privilégio.
- Negação por padrão.
- Separação de responsabilidades.
- Validação em todas as fronteiras de confiança.
- Minimização e proteção de dados.
- Rastreabilidade e auditoria.
- Falhas seguras.

## 2. Avaliação inicial de riscos

Nenhum projeto começa sem avaliação inicial documentada.

A avaliação deve identificar:
- Objetivo, escopo e arquitetura.
- Dados processados e sua classificação.
- Usuários, perfis e permissões.
- Ativos que precisam de proteção.
- Fronteiras de confiança.
- APIs, integrações e dependências.
- Ameaças, impactos e possibilidades de exploração.
- Obrigações legais aplicáveis.
- Controles preventivos, detectivos e corretivos.
- Riscos residuais e critérios de aceitação.

Utilizar modelagem de ameaças, como STRIDE, quando aplicável.

## 3. Categorias obrigatórias

### 3.1 Segurança de aplicação
- Considerar OWASP Top 10 e OWASP ASVS.
- Validar entradas com esquemas.
- Prevenir SQL injection, XSS, CSRF, SSRF, command injection e path traversal.
- Utilizar consultas parametrizadas.
- Aplicar codificação de saída contextual.
- Não confiar exclusivamente em validações do frontend.
- Limitar tamanho e complexidade das entradas.
- Tratar erros sem revelar detalhes internos.

### 3.2 Autenticação
- Utilizar mecanismos de autenticação reconhecidos.
- Nunca armazenar senhas em texto puro.
- Utilizar Argon2id ou bcrypt com configuração adequada para senhas.
- Proteger sessões e tokens.
- Definir expiração, renovação e revogação.
- Aplicar MFA conforme risco e requisitos.
- Proteger recuperação de contas.
- Evitar enumeração de usuários.
- Não desenvolver protocolos criptográficos próprios.

### 3.3 Autorização
- Aplicar negação por padrão.
- Validar autorização no servidor em cada operação protegida.
- Utilizar RBAC ou ABAC conforme necessidade.
- Restringir acesso por recurso e propriedade.
- Prevenir IDOR e BOLA.
- Não confiar em permissões enviadas pelo cliente.
- Aplicar menor privilégio a usuários, serviços e agentes.
- Revisar permissões periodicamente.

### 3.4 Dados e privacidade
- Classificar dados como públicos, internos, confidenciais ou restritos.
- Coletar somente o necessário.
- Definir finalidade, retenção e descarte.
- Utilizar TLS para dados em trânsito.
- Proteger dados em repouso conforme risco.
- Gerenciar chaves separadamente dos dados protegidos.
- Restringir acesso a dados pessoais.
- Considerar LGPD e obrigações aplicáveis.
- Implementar mecanismos de correção e exclusão quando necessários.
- Não registrar dados sensíveis sem necessidade.

### 3.5 Segredos
- Nunca inserir tokens, senhas ou chaves no código.
- Utilizar variáveis de ambiente ou gerenciadores de segredos.
- Manter arquivos .env fora do Git.
- Utilizar .env.example sem credenciais reais.
- Executar secret scanning.
- Rotacionar credenciais expostas.
- Separar credenciais por ambiente.
- Aplicar menor privilégio.
- Não revelar segredos em logs, erros ou relatórios.

### 3.6 API e comunicação
- Exigir HTTPS/TLS em produção.
- Configurar CORS com origens explicitamente permitidas.
- Aplicar CSRF quando o modelo de autenticação exigir.
- Configurar rate limiting.
- Definir limites de payload.
- Validar parâmetros, cabeçalhos e corpos.
- Aplicar autenticação e autorização por endpoint.
- Definir timeouts.
- Prevenir SSRF.
- Configurar cookies Secure, HttpOnly e SameSite quando aplicável.
- Versionar e documentar APIs.

### 3.7 Infraestrutura
- Desabilitar serviços e portas desnecessários.
- Evitar privilégios administrativos sem necessidade.
- Isolar serviços e ambientes.
- Separar desenvolvimento, homologação e produção.
- Restringir acessos administrativos e de rede.
- Configurar cabeçalhos de segurança e CSP quando aplicável.
- Manter sistemas e imagens atualizados.
- Evitar contêineres privilegiados.
- Utilizar configurações seguras por padrão.

### 3.8 Dependências e cadeia de suprimentos
- Versionar lockfiles.
- Auditar dependências diretas e transitivas.
- Avaliar origem e manutenção dos pacotes.
- Evitar dependências desnecessárias.
- Monitorar CVEs e avisos de segurança.
- Gerar SBOM quando aplicável.
- Verificar integridade de pacotes e artefatos.
- Controlar atualizações.
- Documentar exceções e riscos aceitos.

### 3.9 Código seguro
- Utilizar TypeScript strict quando aplicável.
- Evitar any e conversões inseguras sem justificativa.
- Aplicar ESLint e padrões consistentes.
- Separar responsabilidades.
- Validar dados nas fronteiras entre camadas.
- Centralizar tratamento de erros.
- Evitar dados sensíveis em mensagens de erro.
- Utilizar APIs seguras da linguagem e do framework.
- Revisar código antes da integração.
- Não suprimir alertas sem justificativa documentada.

### 3.10 Testes de segurança
Selecionar verificações conforme arquitetura e risco:
- SAST: análise estática.
- DAST: análise dinâmica.
- SCA: análise de dependências.
- Secret scanning.
- Testes de autenticação e autorização.
- Testes de validação e injeção.
- Testes de integração e regressão.
- Testes de penetração quando justificados pelo risco.

Testar também caminhos negativos, acessos não autorizados e entradas inválidas.

### 3.11 Logs e monitoramento
- Utilizar logs estruturados.
- Registrar eventos relevantes de segurança.
- Incluir identificadores de correlação quando aplicável.
- Registrar falhas de autenticação e autorização.
- Redigir tokens, senhas, cookies e dados pessoais.
- Definir retenção e controle de acesso.
- Monitorar comportamentos anormais.
- Configurar alertas relevantes.
- Proteger logs contra alteração e acesso indevido.

### 3.12 Resposta a incidentes
Todo projeto em produção deve possuir procedimento proporcional ao risco para:
1. Identificar e classificar incidentes.
2. Preservar evidências.
3. Conter o incidente.
4. Revogar credenciais comprometidas.
5. Corrigir vulnerabilidades.
6. Recuperar serviços.
7. Comunicar responsáveis quando necessário.
8. Registrar causa, impacto e ações corretivas.

### 3.13 Backup e continuidade
- Definir política de backup.
- Proteger backups com controles de acesso e criptografia apropriados.
- Separar backups do ambiente principal quando possível.
- Testar restauração periodicamente.
- Definir RPO e RTO conforme criticidade.
- Aplicar timeouts e limites operacionais.
- Utilizar retentativas limitadas e backoff quando apropriado.
- Prevenir operações duplicadas em fluxos críticos.
- Documentar procedimentos de recuperação.

### 3.14 Segurança de IA e agentes
- Tratar prompts, arquivos, páginas e saídas de ferramentas como conteúdo não confiável.
- Mitigar prompt injection direta e indireta.
- Separar instruções confiáveis de conteúdo externo.
- Restringir ferramentas por função e tarefa.
- Validar argumentos antes de executar ferramentas.
- Não permitir execução arbitrária baseada em conteúdo não confiável.
- Exigir aprovação humana para operações destrutivas, irreversíveis ou externas sensíveis.
- Isolar ambientes de execução.
- Não expor segredos desnecessariamente aos agentes.
- Redigir dados antes de enviá-los a modelos externos.
- Validar resultados antes de operações críticas.
- Registrar ações relevantes sem armazenar conteúdo sensível por padrão.
- Não tratar instruções textuais como barreira técnica de segurança.

### 3.15 Segurança de CI/CD
- Proteger branches e credenciais dos pipelines.
- Executar lint, typecheck, testes e build.
- Executar verificações de segurança pertinentes.
- Proteger artefatos e dependências.
- Não expor segredos nos logs.
- Restringir permissões dos tokens de automação.
- Exigir revisão para alterações sensíveis.
- Produzir evidências das verificações.
- Manter possibilidade de rollback.
- Não publicar sem autorização prevista no fluxo.

### 3.16 Governança
- Manter políticas versionadas.
- Documentar decisões de segurança.
- Registrar riscos residuais e responsáveis.
- Definir responsáveis por aprovação.
- Revisar controles periodicamente.
- Documentar exceções com justificativa, prazo e plano de tratamento.
- Avaliar fornecedores e integrações.
- Manter inventário de ativos e dependências relevante.
- Verificar obrigações legais e contratuais.
- Não declarar certificação ou conformidade sem avaliação correspondente.

## 4. Classificação de vulnerabilidades

| Severidade | Tratamento |
|---|---|
| Crítica | Bloqueia entrega e publicação até correção. |
| Alta | Bloqueia entrega e publicação, salvo exceção formal aprovada. |
| Média | Registrar, atribuir responsável e definir prazo conforme risco. |
| Baixa | Registrar e tratar no ciclo de manutenção. |
| Informativa | Avaliar e documentar quando relevante. |

A classificação considera impacto, explorabilidade, exposição e contexto. A pontuação automática de ferramentas não substitui análise.

## 5. Critérios mínimos de liberação

- [ ] Avaliação inicial de riscos documentada.
- [ ] Segredos ausentes do código e dos artefatos publicados.
- [ ] Entradas externas validadas.
- [ ] Autenticação implementada quando necessária.
- [ ] Autorização aplicada no servidor quando necessária.
- [ ] Dados protegidos conforme classificação.
- [ ] APIs e comunicação configuradas com segurança.
- [ ] Dependências avaliadas.
- [ ] Logs sem dados sensíveis desnecessários.
- [ ] Testes funcionais e de segurança pertinentes executados.
- [ ] Lint, typecheck e build executados quando aplicáveis.
- [ ] Revisão independente concluída.
- [ ] Vulnerabilidades críticas e altas tratadas ou formalmente bloqueadas.
- [ ] Backup e recuperação avaliados conforme criticidade.
- [ ] Riscos residuais documentados.

## 6. Evidências obrigatórias

Toda entrega deve informar:
- Controles implementados.
- Arquivos alterados.
- Testes executados e resultados reais.
- Ferramentas e versões relevantes.
- Vulnerabilidades encontradas e corrigidas.
- Riscos não resolvidos.
- Exceções aprovadas.
- Próximos passos.

Não afirmar que uma verificação foi executada sem evidência.

## 7. Exceções

Toda exceção deve registrar:
- Controle não atendido.
- Motivo técnico.
- Risco residual e impacto.
- Mitigação alternativa.
- Responsável pela aprovação.
- Prazo de validade.
- Plano de correção.

Exceções não podem ocultar vulnerabilidades críticas ou altas sem decisão formal e justificativa.

## 8. Referências

Utilizar versões atuais e aplicáveis:
- OWASP Top 10.
- OWASP ASVS.
- OWASP API Security Top 10.
- OWASP SAMM.
- NIST Cybersecurity Framework.
- NIST Secure Software Development Framework.
- CIS Controls e CIS Benchmarks.
- MITRE ATT&CK quando aplicável.
- CWE e CVE.
- LGPD e orientações da ANPD quando aplicáveis.

Este padrão é uma diretriz interna de engenharia. Sua existência não comprova certificação, conformidade legal ou ausência de vulnerabilidades.
