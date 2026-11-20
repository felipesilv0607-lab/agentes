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
    if (agent.codexDescription !== definition.fields.description) {
      errors.push(`${agent.id}: codexDescription diverge do description de ${definition.fileName}`);
    }
    if (agent.accessMode === "read-only" && !definition.content.includes(READ_ONLY_INVOCATION)) {
      errors.push(`${agent.id}: agente read-only sem a instrução de execução read-only em ${definition.fileName}`);
    }
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

test("catálogo preserva os quatro agentes existentes, na ordem original", () => {
  assert.deepEqual(
    agentCatalog.map((agent) => agent.id),
    ["coordinator", "developer", "code-reviewer", "security-reviewer"],
  );
});

test("campos do catálogo têm valores válidos", () => {
  const teams = new Set(["planning", "build", "quality", "knowledge"]);
  const accessModes = new Set(["read-only", "workspace-write", "tests-only", "ci-cd-without-publish"]);
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
  id, name: id, role: id, team: "build", accessMode: "workspace-write", accentColor: "#123456",
  responsibilities: ["x"], codexDescription: `Descricao de ${id}`, ...overrides,
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
  assert.deepEqual(validateCatalog([agent("a", { codexDescription: "outra" })], [file("a")]), [
    "a: codexDescription diverge do description de a.toml",
  ]);
});

test("detecta campo obrigatório ausente no TOML", () => {
  const errors = validateCatalog([agent("a")], [{ fileName: "a.toml", content: 'name = "a"\ndescription = "Descricao de a"\n' }]);
  assert.deepEqual(errors, ["a.toml: campo obrigatório ausente: developer_instructions"]);
});

test("detecta agente read-only sem a instrução de execução read-only no TOML", () => {
  const readOnly = agent("r", { accessMode: "read-only" });
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
