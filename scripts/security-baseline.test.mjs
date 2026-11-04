import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseline = await readFile(
  new URL("../standards/SECURITY-BASELINE.md", import.meta.url),
  "utf8",
);

const agentPolicy = await readFile(
  new URL("../standards/AI-AGENT-POLICY.md", import.meta.url),
  "utf8",
);

const agentsInstructions = await readFile(
  new URL("../AGENTS.md", import.meta.url),
  "utf8",
);

const categories = [
  "Segurança de aplicação",
  "Autenticação",
  "Autorização",
  "Dados e privacidade",
  "Segredos",
  "API e comunicação",
  "Infraestrutura",
  "Dependências e cadeia de suprimentos",
  "Código seguro",
  "Testes de segurança",
  "Logs e monitoramento",
  "Resposta a incidentes",
  "Backup e continuidade",
  "Segurança de IA e agentes",
  "Segurança de CI/CD",
  "Governança",
];

test("contém as 16 categorias obrigatórias", () => {
  for (const category of categories) {
    assert.ok(
      baseline.includes(category),
      `Categoria ausente: ${category}`,
    );
  }
});

test("exige avaliação inicial de riscos", () => {
  assert.match(baseline, /Avaliação inicial de riscos/);
  assert.match(baseline, /modelagem de ameaças/i);
});

test("contempla referências OWASP e NIST", () => {
  assert.match(baseline, /OWASP Top 10/);
  assert.match(baseline, /OWASP ASVS/);
  assert.match(baseline, /NIST Cybersecurity Framework/);
  assert.match(
    baseline,
    /NIST Secure Software Development Framework/,
  );
});

test("define bloqueio para vulnerabilidades críticas e altas", () => {
  assert.match(baseline, /Crítica[\s\S]*Bloqueia entrega/);
  assert.match(baseline, /Alta[\s\S]*Bloqueia entrega/);
});

test("exige evidências de testes e controles", () => {
  assert.match(baseline, /Evidências obrigatórias/);
  assert.match(baseline, /Testes executados/);
  assert.match(baseline, /Riscos não resolvidos/);
});

test("política dos agentes exige menor privilégio", () => {
  assert.match(agentPolicy, /menor privilégio/i);
});

test("revisores possuem responsabilidades de leitura", () => {
  assert.match(agentPolicy, /somente leitura/i);
  assert.match(agentPolicy, /Security Reviewer/);
  assert.match(agentPolicy, /Code Reviewer/);
});

test("ações sensíveis exigem autorização explícita", () => {
  assert.match(agentPolicy, /autorização explícita/i);
  assert.match(agentPolicy, /migrações destrutivas/i);
  assert.match(agentPolicy, /publicar/i);
});

test("política reconhece limites dos controles textuais", () => {
  assert.match(agentPolicy, /controles técnicos do runtime/i);
  assert.match(agentPolicy, /Isolamento de execução/);
  assert.match(agentPolicy, /Permissões efetivas/);
});

test("AGENTS.md referencia os dois padrões globais", () => {
  assert.match(
    agentsInstructions,
    /standards\/SECURITY-BASELINE\.md/,
  );
  assert.match(
    agentsInstructions,
    /standards\/AI-AGENT-POLICY\.md/,
  );
});

test("AGENTS.md diferencia documentação de implementação", () => {
  assert.match(agentsInstructions, /Controles documentados/);
  assert.match(agentsInstructions, /Controles implementados/);
  assert.match(agentsInstructions, /Controles efetivamente testados/);
});
