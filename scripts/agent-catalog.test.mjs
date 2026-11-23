import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// O catálogo é TypeScript com somente `import type`; o Node 24 o importa
// diretamente, removendo os tipos. Assim o teste lê a MESMA fonte do dashboard.
import { agentCatalog } from "../apps/dashboard/src/data/agentCatalog.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codexAgentsDir = path.join(repoRoot, ".codex", "agents");

const REQUIRED_TOML_FIELDS = ["name", "description", "developer_instructions"];
const READ_ONLY_INVOCATION = 'codex exec --sandbox read-only -c approval_policy="never"';
const SCOPED_MODES = new Set(["tests-only", "ci-cd-without-publish", "docs-only"]);
const scopeCheckCommand = (id) => `node <diretorio do snapshot>/agent-scope-check.mjs check --agent ${id}`;
/** Forma proibida (N8): executar a cópia do verificador do workspace, que o agente pode ter alterado. */
const WORKSPACE_CHECKER_COMMAND = "node scripts/agent-scope-check.mjs check";

/**
 * Glob relativo à raiz, sem `..`, sem caminho absoluto, sem `\` e sem segmentos
 * vazios. Um `!` inicial indica exclusão e é aceito somente uma vez.
 */
function isSafeGlob(entry) {
  if (typeof entry !== "string") return false;
  const glob = entry.startsWith("!") ? entry.slice(1) : entry;
  return (
    glob.length > 0 &&
    !glob.startsWith("!") &&
    !glob.startsWith("/") &&
    !/^[A-Za-z]:/.test(glob) &&
    !glob.includes("\\") &&
    glob.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/**
 * Lista exata do bloco "ESCOPO DE ESCRITA" das instruções do TOML: as linhas
 * "- <glob>" logo abaixo do título, até a primeira linha em branco.
 * Retorna [] para "ESCOPO DE ESCRITA: nenhum" e null se o bloco não existir.
 */
function tomlWriteScope(tomlContent) {
  const lines = tomlContent.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("ESCOPO DE ESCRITA"));
  if (start < 0) return null;
  if (/^ESCOPO DE ESCRITA: nenhum\b/.test(lines[start])) return [];
  const globs = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== ""; i++) {
    const item = lines[i].match(/^- (\S+)$/);
    if (!item) return [`<linha inválida no bloco ESCOPO DE ESCRITA: ${lines[i]}>`];
    globs.push(item[1]);
  }
  return globs;
}

/** Coerência entre `accessMode`, `writeScope` e as instruções do TOML (comparação exata). */
function validateWriteScope(agent, tomlContent) {
  const errors = [];
  const scope = agent.writeScope;
  if (!Array.isArray(scope)) return [`${agent.id}: writeScope ausente`];
  const declared = tomlWriteScope(tomlContent);
  if (agent.accessMode === "read-only") {
    if (scope.length !== 0) errors.push(`${agent.id}: agente read-only não pode ter writeScope`);
    if (declared !== null && declared.length !== 0) errors.push(`${agent.id}: TOML de agente read-only declara escopo de escrita`);
  }
  if (agent.accessMode === "workspace-write" && !(scope.length === 1 && scope[0] === "**")) {
    errors.push(`${agent.id}: agente workspace-write deve ter writeScope ["**"]`);
  }
  if (SCOPED_MODES.has(agent.accessMode)) {
    if (!scope.some((glob) => !glob.startsWith("!"))) {
      errors.push(`${agent.id}: modo ${agent.accessMode} exige ao menos um caminho permitido no writeScope`);
    }
    for (const glob of scope) {
      if (glob === "**" || glob === "!**") errors.push(`${agent.id}: modo ${agent.accessMode} não pode usar "**" isolado`);
      else if (!isSafeGlob(glob)) errors.push(`${agent.id}: glob inseguro ou inválido no writeScope: ${glob}`);
    }
    if (declared === null) errors.push(`${agent.id}: TOML sem bloco ESCOPO DE ESCRITA`);
    else if (JSON.stringify(declared) !== JSON.stringify(scope)) {
      errors.push(`${agent.id}: ESCOPO DE ESCRITA do TOML difere do writeScope (TOML: ${JSON.stringify(declared)}; catálogo: ${JSON.stringify(scope)})`);
    }
    if (!tomlContent.includes(scopeCheckCommand(agent.id))) {
      errors.push(`${agent.id}: TOML não menciona a verificação de escopo (${scopeCheckCommand(agent.id)})`);
    }
  }
  if (tomlContent.includes(WORKSPACE_CHECKER_COMMAND)) {
    errors.push(`${agent.id}: TOML instrui o check com a cópia do verificador do workspace (${WORKSPACE_CHECKER_COMMAND}); use a cópia do snapshot`);
  }
  return errors;
}

/**
 * Leitor mínimo das chaves de nível superior dos TOMLs de agentes:
 * `chave = "texto"` (string básica de uma linha) e `chave = """…"""`
 * (multilinha). Comentários e linhas em branco são ignorados; leitura para
 * na primeira tabela (`[...]`). Não é um parser TOML completo: só cobre o
 * formato usado em `.codex/agents`.
 */
function parseAgentToml(content) {
  const fields = {};
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\s*\[/.test(line)) break;
    const multi = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"""(.*)$/);
    if (multi) {
      const parts = [multi[2]];
      while (!parts[parts.length - 1].includes('"""') && i + 1 < lines.length) parts.push(lines[++i]);
      fields[multi[1]] = parts.join("\n").replace(/"""\s*$/, "").trim();
      continue;
    }
    const single = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(#.*)?$/);
    if (single) fields[single[1]] = single[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return fields;
}

/** Valida o catálogo contra as definições do Codex. Retorna a lista de erros. */
function validateCatalog(catalog, tomlFiles) {
  const errors = [];
  const definitions = new Map();

  for (const { fileName, content } of tomlFiles) {
    const fields = parseAgentToml(content);
    for (const field of REQUIRED_TOML_FIELDS) {
      if (!fields[field]) errors.push(`${fileName}: campo obrigatório ausente: ${field}`);
    }
    if (!fields.name) continue;
    if (fileName !== `${fields.name}.toml`) {
      errors.push(`${fileName}: name "${fields.name}" não corresponde ao nome do arquivo`);
    }
    if (definitions.has(fields.name)) {
      errors.push(`name duplicado em .codex/agents: ${fields.name}`);
      continue;
    }
    definitions.set(fields.name, { fileName, content, fields });
  }

  const seen = new Set();
  for (const agent of catalog) {
    if (seen.has(agent.id)) {
      errors.push(`id duplicado no catálogo: ${agent.id}`);
      continue;
    }
    seen.add(agent.id);
    const definition = definitions.get(agent.id);
    if (!definition) {
      errors.push(`agente do catálogo sem definição em .codex/agents: ${agent.id}`);
      continue;
    }
    if (agent.description !== definition.fields.description) {
      errors.push(`${agent.id}: description diverge do description de ${definition.fileName}`);
    }
    if (agent.accessMode === "read-only" && !definition.content.includes(READ_ONLY_INVOCATION)) {
      errors.push(`${agent.id}: agente read-only sem a instrução de execução read-only em ${definition.fileName}`);
    }
    errors.push(...validateWriteScope(agent, definition.content));
  }

  for (const name of definitions.keys()) {
    if (!seen.has(name)) errors.push(`definição em .codex/agents sem agente no catálogo: ${name}`);
  }
  return errors;
}

function readCodexAgents() {
  return readdirSync(codexAgentsDir)
    .filter((file) => file.endsWith(".toml"))
    .sort()
    .map((fileName) => ({ fileName, content: readFileSync(path.join(codexAgentsDir, fileName), "utf8") }));
}

// ---------------------------------------------------------------------------
// Dados reais
// ---------------------------------------------------------------------------

test("catálogo do dashboard corresponde às definições em .codex/agents", () => {
  const tomlFiles = readCodexAgents();
  assert.ok(tomlFiles.length > 0, "nenhuma definição encontrada em .codex/agents");
  assert.deepEqual(validateCatalog(agentCatalog, tomlFiles), []);
});

test("catálogo preserva os quatro agentes originais, na ordem original, no início", () => {
  assert.deepEqual(
    agentCatalog.slice(0, 4).map((agent) => agent.id),
    ["coordinator", "developer", "code-reviewer", "security-reviewer"],
  );
});

test("catálogo contém os nove agentes aprovados, na ordem definida", () => {
  assert.deepEqual(
    agentCatalog.map((agent) => agent.id),
    [
      "coordinator", "developer", "code-reviewer", "security-reviewer",
      "architect", "qa-engineer", "devops-engineer", "documentation-engineer", "accessibility-ux-reviewer",
    ],
  );
});

test("modos de acesso dos novos papéis seguem as decisões aprovadas", () => {
  const byId = Object.fromEntries(agentCatalog.map((agent) => [agent.id, agent]));
  assert.equal(byId.architect.accessMode, "read-only");
  assert.equal(byId["accessibility-ux-reviewer"].accessMode, "read-only");
  assert.equal(byId["qa-engineer"].accessMode, "tests-only");
  assert.deepEqual(byId["qa-engineer"].writeScope, [
    "scripts/**/*.test.mjs",
    "!scripts/agent-catalog.test.mjs",
    "!scripts/agent-scope-check.test.mjs",
    "!scripts/security-baseline.test.mjs",
    "scripts/fixtures/**",
    "apps/dashboard/src/**/*.test.ts",
    "apps/dashboard/src/**/*.test.tsx",
  ]);
  assert.deepEqual(byId.architect.writeScope, []);
  assert.deepEqual(byId["accessibility-ux-reviewer"].writeScope, []);
  assert.equal(byId["devops-engineer"].accessMode, "ci-cd-without-publish");
  assert.deepEqual(byId["devops-engineer"].writeScope, [".github/workflows/**"]);
  assert.equal(byId["documentation-engineer"].accessMode, "docs-only");
  assert.deepEqual(byId["documentation-engineer"].writeScope, ["README.md", "docs/**"]);
});

test("campos do catálogo têm valores válidos", () => {
  const teams = new Set(["planning", "build", "quality", "knowledge"]);
  const accessModes = new Set(["read-only", "workspace-write", "tests-only", "ci-cd-without-publish", "docs-only"]);
  for (const agent of agentCatalog) {
    assert.match(agent.id, /^[a-z][a-z0-9-]*$/, `id inválido: ${agent.id}`);
    assert.ok(agent.name.trim() && agent.role.trim(), `${agent.id}: nome e papel são obrigatórios`);
    assert.ok(teams.has(agent.team), `${agent.id}: equipe inválida: ${agent.team}`);
    assert.ok(accessModes.has(agent.accessMode), `${agent.id}: accessMode inválido: ${agent.accessMode}`);
    assert.match(agent.accentColor, /^#[0-9a-f]{6}$/i, `${agent.id}: accentColor inválida`);
    assert.ok(agent.responsibilities.length > 0, `${agent.id}: sem responsabilidades definidas`);
  }
});

// ---------------------------------------------------------------------------
// O validador detecta inconsistências (cenários sintéticos em memória)
// ---------------------------------------------------------------------------

const toml = (name, description = `Descricao de ${name}`, extra = "") =>
  `${extra}name = "${name}"\ndescription = "${description}"\n\ndeveloper_instructions = """\nInstrucoes de ${name}.\n"""\n`;
const agent = (id, overrides = {}) => ({
  id, name: id, role: id, team: "build", accessMode: "workspace-write", writeScope: ["**"], accentColor: "#123456",
  responsibilities: ["x"], description: `Descricao de ${id}`, ...overrides,
});
const file = (name, content = toml(name)) => ({ fileName: `${name}.toml`, content });

test("validador aceita catálogo e definições consistentes", () => {
  assert.deepEqual(validateCatalog([agent("a"), agent("b")], [file("a"), file("b")]), []);
});

test("detecta agente do catálogo sem definição no Codex (agente apenas visual)", () => {
  assert.deepEqual(validateCatalog([agent("a"), agent("visual")], [file("a")]), [
    "agente do catálogo sem definição em .codex/agents: visual",
  ]);
});

test("detecta definição do Codex ausente do catálogo", () => {
  assert.deepEqual(validateCatalog([agent("a")], [file("a"), file("orfao")]), [
    "definição em .codex/agents sem agente no catálogo: orfao",
  ]);
});

test("detecta id duplicado no catálogo", () => {
  assert.deepEqual(validateCatalog([agent("a"), agent("a")], [file("a")]), ["id duplicado no catálogo: a"]);
});

test("detecta name duplicado em .codex/agents", () => {
  const errors = validateCatalog([agent("a")], [file("a"), { fileName: "copia.toml", content: toml("a") }]);
  assert.ok(errors.includes("copia.toml: name \"a\" não corresponde ao nome do arquivo"));
  assert.ok(errors.includes("name duplicado em .codex/agents: a"));
});

test("detecta descrição divergente", () => {
  assert.deepEqual(validateCatalog([agent("a", { description: "outra" })], [file("a")]), [
    "a: description diverge do description de a.toml",
  ]);
});

test("detecta campo obrigatório ausente no TOML", () => {
  const errors = validateCatalog([agent("a")], [{ fileName: "a.toml", content: 'name = "a"\ndescription = "Descricao de a"\n' }]);
  assert.deepEqual(errors, ["a.toml: campo obrigatório ausente: developer_instructions"]);
});

test("detecta agente read-only sem a instrução de execução read-only no TOML", () => {
  const readOnly = agent("r", { accessMode: "read-only", writeScope: [] });
  assert.deepEqual(validateCatalog([readOnly], [file("r")]), [
    "r: agente read-only sem a instrução de execução read-only em r.toml",
  ]);
  const documented = file("r", toml("r", "Descricao de r", `#   ${READ_ONLY_INVOCATION} "<pedido>"\n`));
  assert.deepEqual(validateCatalog([readOnly], [documented]), []);
});

test("leitor de TOML ignora comentários, lê strings multilinha e escapes", () => {
  const fields = parseAgentToml(
    '# comentario com name = "falso"\nname = "x"\ndescription = "tem \\"aspas\\""\ndeveloper_instructions = """\nlinha 1\nlinha 2\n"""\n[tabela]\nname = "ignorado"\n',
  );
  assert.equal(fields.name, "x");
  assert.equal(fields.description, 'tem "aspas"');
  assert.equal(fields.developer_instructions, "linha 1\nlinha 2");
});

// ---------------------------------------------------------------------------
// Coerência entre accessMode, writeScope e instruções do TOML
// ---------------------------------------------------------------------------

const scopeBlock = (globs) =>
  globs.length ? `ESCOPO DE ESCRITA (somente estes caminhos):\n${globs.map((g) => `- ${g}`).join("\n")}\n` : "";
const scopedToml = (id, globs, { extraInstructions = "" } = {}) =>
  `name = "${id}"\ndescription = "Descricao de ${id}"\n\ndeveloper_instructions = """\nInstrucoes de ${id}.\n\n` +
  `${scopeBlock(globs)}\n${extraInstructions}Verificacao: ${scopeCheckCommand(id)}\n"""\n`;

test("aceita papel com escopo restrito coerente com o TOML (inclusive exclusões com !)", () => {
  const scope = ["scripts/**/*.test.mjs", "!scripts/governanca.test.mjs"];
  const qa = agent("qa", { accessMode: "tests-only", writeScope: scope });
  assert.deepEqual(validateCatalog([qa], [file("qa", scopedToml("qa", scope))]), []);
});

test("detecta read-only com writeScope ou com escopo declarado no TOML", () => {
  const ro = agent("ro", { accessMode: "read-only", writeScope: ["docs/**"] });
  const content = toml("ro", "Descricao de ro", `#   ${READ_ONLY_INVOCATION} "<pedido>"\n`);
  assert.deepEqual(validateCatalog([ro], [file("ro", content)]), ["ro: agente read-only não pode ter writeScope"]);
  const declared = agent("rd", { accessMode: "read-only", writeScope: [] });
  const declaredToml = `#   ${READ_ONLY_INVOCATION} "<pedido>"\n${scopedToml("rd", ["docs/**"])}`;
  assert.deepEqual(validateCatalog([declared], [file("rd", declaredToml)]), ["rd: TOML de agente read-only declara escopo de escrita"]);
});

test("detecta workspace-write sem escopo irrestrito explícito", () => {
  assert.deepEqual(validateCatalog([agent("w", { writeScope: ["src/**"] })], [file("w")]), [
    'w: agente workspace-write deve ter writeScope ["**"]',
  ]);
});

test("detecta papel restrito com escopo vazio, só de exclusões, irrestrito ou inseguro", () => {
  const minimum = "modo docs-only exige ao menos um caminho permitido no writeScope";
  assert.ok(validateCatalog([agent("a", { accessMode: "docs-only", writeScope: [] })], [file("a", scopedToml("a", []))]).includes(`a: ${minimum}`));
  const onlyDeny = agent("a2", { accessMode: "docs-only", writeScope: ["!docs/x.md"] });
  assert.ok(validateCatalog([onlyDeny], [file("a2", scopedToml("a2", ["!docs/x.md"]))]).includes(`a2: ${minimum}`));
  for (const wideGlob of ["**", "!**"]) {
    const wide = agent("b", { accessMode: "docs-only", writeScope: ["docs/**", wideGlob] });
    assert.ok(
      validateCatalog([wide], [file("b", scopedToml("b", ["docs/**", wideGlob]))]).includes('b: modo docs-only não pode usar "**" isolado'),
      wideGlob,
    );
  }
  for (const bad of ["../docs/**", "/docs/**", "C:/docs/**", String.raw`docs\**`, "docs//x", "docs/./x", "!!docs/x", "!../x"]) {
    const unsafe = agent("c", { accessMode: "docs-only", writeScope: ["docs/**", bad] });
    assert.ok(
      validateCatalog([unsafe], [file("c", scopedToml("c", ["docs/**", bad]))]).includes(`c: glob inseguro ou inválido no writeScope: ${bad}`),
      `não detectou glob inseguro: ${bad}`,
    );
  }
});

test("F6: glob citado em outro trecho do TOML não conta como escopo declarado", () => {
  // README.md aparece na lista "NAO PODE", mas não no bloco ESCOPO DE ESCRITA.
  const qa = agent("q", { accessMode: "tests-only", writeScope: ["scripts/**/*.test.mjs", "README.md"] });
  const content = scopedToml("q", ["scripts/**/*.test.mjs"], { extraInstructions: "NAO PODE MODIFICAR: README.md e docs/.\n" });
  assert.deepEqual(validateCatalog([qa], [file("q", content)]), [
    'q: ESCOPO DE ESCRITA do TOML difere do writeScope (TOML: ["scripts/**/*.test.mjs"]; catálogo: ["scripts/**/*.test.mjs","README.md"])',
  ]);
});

test("F6: glob ausente, extra, reordenado ou alterado no TOML é detectado", () => {
  const docs = agent("d", { accessMode: "docs-only", writeScope: ["README.md", "docs/**"] });
  for (const declared of [["README.md"], ["README.md", "docs/**", "standards/**"], ["docs/**", "README.md"], ["README.md", "docs/*"]]) {
    const errors = validateCatalog([docs], [file("d", scopedToml("d", declared))]);
    assert.equal(errors.length, 1, JSON.stringify(declared));
    assert.match(errors[0], /ESCOPO DE ESCRITA do TOML difere do writeScope/);
  }
});

test("detecta papel restrito sem bloco ESCOPO DE ESCRITA e sem menção à verificação", () => {
  const devops = agent("e", { accessMode: "ci-cd-without-publish", writeScope: [".github/workflows/**"] });
  assert.deepEqual(validateCatalog([devops], [file("e", toml("e", "Descricao de e", "# Escopo: .github/workflows/**\n"))]), [
    "e: TOML sem bloco ESCOPO DE ESCRITA",
    `e: TOML não menciona a verificação de escopo (${scopeCheckCommand("e")})`,
  ]);
});

test("N8: TOML que instrui o check com a cópia do verificador do workspace é rejeitado", () => {
  const devops = agent("e", { accessMode: "ci-cd-without-publish", writeScope: [".github/workflows/**"] });
  const content = scopedToml("e", [".github/workflows/**"], { extraInstructions: "Rode node scripts/agent-scope-check.mjs check --agent e.\n" });
  assert.deepEqual(validateCatalog([devops], [file("e", content)]), [
    "e: TOML instrui o check com a cópia do verificador do workspace (node scripts/agent-scope-check.mjs check); use a cópia do snapshot",
  ]);
  // O mesmo vale para papéis com escrita irrestrita (por exemplo, o coordinator).
  const coord = agent("c", { accessMode: "workspace-write", writeScope: ["**"] });
  assert.equal(validateCatalog([coord], [file("c", toml("c", "Descricao de c", "# Execute node scripts/agent-scope-check.mjs check depois.\n"))]).length, 1);
});

test("leitor do bloco ESCOPO DE ESCRITA: nenhum, ausente, exclusões e linha inválida", () => {
  assert.deepEqual(tomlWriteScope("ESCOPO DE ESCRITA: nenhum. Nao altere arquivos."), []);
  assert.equal(tomlWriteScope("sem bloco"), null);
  assert.deepEqual(tomlWriteScope("ESCOPO DE ESCRITA (x):\n- a/**\n- !a/b\n\nResto"), ["a/**", "!a/b"]);
  assert.match(tomlWriteScope("ESCOPO DE ESCRITA (x):\n- a/** e mais\n")[0], /linha inválida/);
});

// ---------------------------------------------------------------------------
// Política de agentes (standards/AI-AGENT-POLICY.md, seção 2)
// ---------------------------------------------------------------------------

/** Erros de coerência entre o catálogo e a seção 2 da política. */
function validatePolicySection(catalog, policy) {
  const start = policy.indexOf("## 2. Responsabilidades dos agentes");
  const end = policy.indexOf("\n## 3.", start);
  if (start < 0 || end < 0) return ["seção 2 da política não encontrada"];
  const section = policy.slice(start, end);
  const headings = [...section.matchAll(/^### 2\.\d+ (.+?)\s*$/gm)].map((m) => m[1]);
  const rows = new Map(
    [...section.matchAll(/^\| ([^|]+?) \| [^|]+ \| ([^|]+) \| [^|]+ \|\s*$/gm)].map((m) => [m[1], m[2]]),
  );
  const errors = [];
  for (const agent of catalog) {
    if (headings.filter((h) => h === agent.name).length !== 1) errors.push(`política: seção 2.x ausente ou duplicada para ${agent.name}`);
    const row = rows.get(agent.name);
    if (!row) {
      errors.push(`política: linha da matriz de permissões ausente para ${agent.name}`);
      continue;
    }
    const rowGlobs = [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const expected = agent.writeScope.filter((g) => g !== "**");
    if (JSON.stringify(rowGlobs) !== JSON.stringify(expected)) {
      errors.push(
        `política: escopo de ${agent.name} na matriz difere do catálogo (matriz: ${JSON.stringify(rowGlobs)}; catálogo: ${JSON.stringify(expected)})`,
      );
    }
  }
  for (const heading of headings) {
    if (!catalog.some((agent) => agent.name === heading)) errors.push(`política: seção 2.x sem agente no catálogo: ${heading}`);
  }
  return errors;
}

test("seção 2 da política cobre todos os agentes do catálogo, com a matriz de permissões coerente", () => {
  const policy = readFileSync(path.join(repoRoot, "standards", "AI-AGENT-POLICY.md"), "utf8").replace(/\r\n/g, "\n");
  assert.deepEqual(validatePolicySection(agentCatalog, policy), []);
});

test("validação da política detecta seção ausente, linha ausente, glob ausente e seção órfã", () => {
  const docs = agent("d", { name: "Doc", accessMode: "docs-only", writeScope: ["README.md", "docs/**"] });
  const policy = (body) => `## 2. Responsabilidades dos agentes\n\n${body}\n## 3. Outra`;
  const ok = "| Doc | Doc | `README.md`, `docs/**` | x |\n\n### 2.1 Doc\n";
  assert.deepEqual(validatePolicySection([docs], policy(ok)), []);
  assert.deepEqual(validatePolicySection([docs], policy("| Doc | Doc | `README.md`, `docs/**` | x |\n")), ["política: seção 2.x ausente ou duplicada para Doc"]);
  assert.deepEqual(validatePolicySection([docs], policy("### 2.1 Doc\n")), ["política: linha da matriz de permissões ausente para Doc"]);
  assert.deepEqual(validatePolicySection([docs], policy("| Doc | Doc | `README.md` | x |\n\n### 2.1 Doc\n")), [
    'política: escopo de Doc na matriz difere do catálogo (matriz: ["README.md"]; catálogo: ["README.md","docs/**"])',
  ]);
  // F6: glob extra na matriz também é detectado.
  assert.equal(validatePolicySection([docs], policy("| Doc | Doc | `README.md`, `docs/**`, `standards/**` | x |\n\n### 2.1 Doc\n")).length, 1);
  assert.deepEqual(validatePolicySection([docs], policy(`${ok}### 2.2 Fantasma\n`)), ["política: seção 2.x sem agente no catálogo: Fantasma"]);
});
