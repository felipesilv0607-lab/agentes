import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCESS_MODES,
  AGENT_TEAMS,
  buildCatalog,
  isSafeGlob,
  validateCatalogData,
  validateInstructions,
} from "../packages/agent-catalog/src/catalog.ts";
import { renderCodexToml, validateCodexLayout } from "../packages/agent-catalog/src/adapters.ts";
import { agentCatalog } from "../apps/dashboard/src/data/agentCatalog.ts";
import { parseCatalogWriteScopes } from "./agent-scope-check.mjs";
import {
  CATALOG_DIR,
  CODEX_DIR,
  DASHBOARD_CATALOG,
  DEFAULT_ROOT,
  checkAdapters,
  loadCatalog,
  validateInstructionDifferences,
  writeAdapters,
} from "./generate-agent-adapters.mjs";

const EXPECTED_IDS = [
  "coordinator", "developer", "code-reviewer", "security-reviewer",
  "architect", "qa-engineer", "devops-engineer", "documentation-engineer", "accessibility-ux-reviewer",
];

// ---------------------------------------------------------------------------
// Dados reais: catálogo neutro e paridade com os adaptadores
// ---------------------------------------------------------------------------

test("catálogo neutro é válido e contém os nove agentes, na ordem aprovada", () => {
  const { agents } = loadCatalog();
  assert.deepEqual(agents.map((agent) => agent.id), EXPECTED_IDS);
});

test("adaptadores no disco são idênticos, byte a byte, aos gerados pelo catálogo neutro", () => {
  const { outputs, problems } = checkAdapters();
  assert.deepEqual(problems, []);
  assert.equal(outputs.size, EXPECTED_IDS.length + 1);
});

test("leitura independente dos TOMLs confere descrição com o catálogo e instruções com a cópia legada congelada", () => {
  const { agents, legacyInstructions } = loadCatalog();
  for (const agent of agents.map((item) => ({ ...item, instructions: legacyInstructions.get(item.id) }))) {
    const content = readFileSync(path.join(DEFAULT_ROOT, CODEX_DIR, `${agent.id}.toml`), "utf8");
    assert.match(content, new RegExp(`^name = "${agent.id}"$`, "m"), agent.id);
    const description = content.match(/^description = "((?:[^"\\]|\\.)*)"$/m);
    assert.equal(description?.[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"), agent.description, agent.id);
    const instructions = content.match(/^developer_instructions = """\n([\s\S]*?)\n"""\n?$/m);
    assert.equal(`${instructions?.[1]}\n`, agent.instructions, agent.id);
  }
});

test("catálogo do dashboard é a projeção do catálogo neutro, sem instruções", () => {
  const { agents } = loadCatalog();
  assert.deepEqual(
    agentCatalog.map((agent) => ({ ...agent })),
    agents.map(({ instructions: _instructions, ...rest }) => rest),
  );
  const dashboardSource = readFileSync(path.join(DEFAULT_ROOT, DASHBOARD_CATALOG), "utf8");
  const { legacyInstructions } = loadCatalog();
  for (const agent of agents) {
    for (const text of [agent.instructions, legacyInstructions.get(agent.id)]) {
      const longest = text.split("\n").sort((a, b) => b.length - a.length)[0];
      assert.ok(!dashboardSource.includes(longest), `${agent.id}: instruções vazaram para o catálogo do dashboard`);
    }
  }
});

test("leitor estático do verificador de escopo obtém o mesmo writeScope do catálogo neutro", () => {
  const { agents } = loadCatalog();
  const parsed = parseCatalogWriteScopes(readFileSync(path.join(DEFAULT_ROOT, DASHBOARD_CATALOG), "utf8"));
  assert.deepEqual(
    parsed,
    Object.fromEntries(agents.map((agent) => [agent.id, { accessMode: agent.accessMode, writeScope: [...agent.writeScope] }])),
  );
});

test("enums do dashboard coincidem com os do catálogo neutro", () => {
  const types = readFileSync(path.join(DEFAULT_ROOT, "apps/dashboard/src/types/agent.ts"), "utf8");
  const union = (name) => {
    const body = types.match(new RegExp(`export type ${name} =([^;]+);`))?.[1] ?? "";
    return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  };
  assert.deepEqual(union("AgentTeam"), [...AGENT_TEAMS]);
  assert.deepEqual(union("AgentAccessMode"), [...ACCESS_MODES]);
});

test("existe exatamente um arquivo de instruções neutras e um legado por agente", () => {
  for (const sub of ["instructions", "adapters/codex/instructions"]) {
    const files = readdirSync(path.join(DEFAULT_ROOT, CATALOG_DIR, sub)).sort();
    assert.deepEqual(files, [...EXPECTED_IDS].sort().map((id) => `${id}.md`), sub);
  }
});

// ---------------------------------------------------------------------------
// Validação do catálogo neutro (cenários sintéticos)
// ---------------------------------------------------------------------------

const base = (overrides = {}) => ({
  id: "a", name: "A", role: "Papel", team: "build", accessMode: "workspace-write", writeScope: ["**"],
  accentColor: "#123456", responsibilities: ["Fazer algo"], description: "Descricao", ...overrides,
});
const data = (...agents) => ({ schemaVersion: 1, agents });

test("validador aceita catálogo mínimo coerente", () => {
  assert.deepEqual(validateCatalogData(data(base(), base({ id: "b", name: "B" }))), []);
});

test("validador rejeita estrutura, chaves e versões inválidas", () => {
  assert.deepEqual(validateCatalogData(null), ["catálogo: raiz precisa ser objeto"]);
  assert.ok(validateCatalogData({ ...data(base()), extra: 1 }).includes("catálogo: chave desconhecida na raiz: extra"));
  assert.ok(validateCatalogData({ schemaVersion: 2, agents: [base()] }).includes("catálogo: schemaVersion não suportada: 2"));
  assert.ok(validateCatalogData(data()).includes("catálogo: agents precisa ser lista não vazia"));
  assert.ok(validateCatalogData(data(base({ instructions: "x" }))).includes("a: chave desconhecida: instructions"));
});

test("validador rejeita id, nome, textos, equipe, cor e responsabilidades inválidos", () => {
  const cases = [
    [base({ id: "A b" }), "A b: id inválido"],
    [base({ id: "-a" }), "-a: id inválido"],
    [base({ description: "linha 1\nlinha 2" }), "a: description precisa ser texto de uma linha, não vazio"],
    [base({ role: " " }), "a: role precisa ser texto de uma linha, não vazio"],
    [base({ team: "ops" }), "a: equipe inválida: ops"],
    [base({ accentColor: "red" }), "a: accentColor inválida"],
    [base({ responsibilities: [] }), "a: responsibilities precisa ser lista não vazia de textos de uma linha"],
    [base({ accessMode: "root" }), "a: accessMode inválido: root"],
    [base({ writeScope: "**" }), "a: writeScope precisa ser lista de textos"],
  ];
  for (const [agent, expected] of cases) assert.ok(validateCatalogData(data(agent)).includes(expected), expected);
  assert.ok(validateCatalogData(data(base(), base())).includes("id duplicado no catálogo: a"));
  assert.ok(validateCatalogData(data(base(), base({ id: "b" }))).includes("nome duplicado no catálogo: A"));
});

test("validador exige writeScope coerente com o modo de acesso", () => {
  assert.ok(validateCatalogData(data(base({ accessMode: "read-only", writeScope: ["docs/**"] }))).includes("a: agente read-only não pode ter writeScope"));
  assert.ok(validateCatalogData(data(base({ writeScope: ["src/**"] }))).includes('a: agente workspace-write deve ter writeScope ["**"]'));
  assert.ok(validateCatalogData(data(base({ accessMode: "docs-only", writeScope: ["!docs/x.md"] }))).includes("a: modo docs-only exige ao menos um caminho permitido no writeScope"));
  assert.ok(validateCatalogData(data(base({ accessMode: "docs-only", writeScope: ["docs/**", "**"] }))).includes('a: modo docs-only não pode usar "**" isolado'));
  assert.ok(validateCatalogData(data(base({ accessMode: "docs-only", writeScope: ["docs/**", "docs/**"] }))).includes("a: writeScope com entradas duplicadas"));
  for (const bad of ["../docs/**", "/docs/**", "C:/docs/**", "docs\\**", "docs//x", "docs/./x", "!!docs/x", ".git/config", "a/.GIT/x", 'docs/"x', "docs/\u0001"]) {
    assert.equal(isSafeGlob(bad), false, bad);
    assert.ok(
      validateCatalogData(data(base({ accessMode: "docs-only", writeScope: ["docs/**", bad] }))).includes(`a: glob inseguro ou inválido no writeScope: ${bad}`),
      bad,
    );
  }
});

test("validador de instruções detecta ausência, órfão, vazio, CRLF, BOM e final incorreto", () => {
  const ok = "Instrucoes.\n";
  assert.deepEqual(validateInstructions(["a"], new Map([["a", ok]])), []);
  assert.deepEqual(validateInstructions(["a"], new Map()), ["a: instruções ausentes (instructions/a.md)"]);
  assert.deepEqual(validateInstructions(["a"], new Map([["a", ok], ["b", ok]])), ["instruções sem agente no catálogo: b"]);
  assert.ok(validateInstructions(["a"], new Map([["a", "\n"]])).includes("a: instruções vazias"));
  assert.ok(validateInstructions(["a"], new Map([["a", "x\r\n"]])).includes("a: instruções devem usar LF"));
  assert.ok(validateInstructions(["a"], new Map([["a", "x"]])).includes("a: instruções devem terminar com exatamente uma quebra de linha"));
  assert.ok(validateInstructions(["a"], new Map([["a", "x\n\n"]])).includes("a: instruções devem terminar com exatamente uma quebra de linha"));
  assert.ok(validateInstructions(["a"], new Map([["a", "\ufeffx\n"]])).includes("a: instruções não podem ter BOM"));
  assert.throws(() => buildCatalog(data(base()), new Map()), /instruções ausentes/);
});

// ---------------------------------------------------------------------------
// Adaptador Codex (temporário)
// ---------------------------------------------------------------------------

test("layout Codex exige cabeçalho só de comentários e um layout por agente", () => {
  const layout = (agents) => ({ schemaVersion: 1, agents });
  assert.deepEqual(validateCodexLayout(layout({ a: { header: "# x\n", trailingNewline: true } }), ["a"]), []);
  assert.deepEqual(validateCodexLayout(layout({ a: { header: "", trailingNewline: false } }), ["a"]), []);
  assert.deepEqual(validateCodexLayout(layout({}), ["a"]), ["layout Codex: agente sem layout: a"]);
  assert.ok(validateCodexLayout(layout({ a: { header: "", trailingNewline: true }, b: { header: "", trailingNewline: true } }), ["a"]).includes("layout Codex: layout sem agente no catálogo: b"));
  assert.ok(validateCodexLayout(layout({ a: { header: 'sandbox_mode = "danger-full-access"\n', trailingNewline: true } }), ["a"]).includes("layout Codex: header de a precisa conter somente linhas de comentário"));
});

test("renderização do TOML escapa a descrição e recusa instruções não literais", () => {
  const agent = { ...base(), description: 'tem "aspas"', instructions: "Linha.\n" };
  assert.equal(
    renderCodexToml(agent, { header: "# c\n", trailingNewline: true }),
    '# c\nname = "a"\ndescription = "tem \\"aspas\\""\n\ndeveloper_instructions = """\nLinha.\n"""\n',
  );
  assert.throws(() => renderCodexToml({ ...agent, instructions: 'x """ y\n' }, { header: "", trailingNewline: true }), /literalmente/);
  assert.throws(() => renderCodexToml({ ...agent, instructions: "x \\n y\n" }, { header: "", trailingNewline: true }), /literalmente/);
});

// ---------------------------------------------------------------------------
// Gerador: conferência e gravação em diretório temporário
// ---------------------------------------------------------------------------

function tempRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentes-adapters-"));
  cpSync(path.join(DEFAULT_ROOT, CATALOG_DIR), path.join(root, CATALOG_DIR), { recursive: true });
  mkdirSync(path.join(root, CODEX_DIR), { recursive: true });
  mkdirSync(path.dirname(path.join(root, DASHBOARD_CATALOG)), { recursive: true });
  return root;
}

test("gerador grava adaptadores ausentes e depois confere sem divergências", (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(checkAdapters(root).problems.length, EXPECTED_IDS.length + 1);
  assert.equal(writeAdapters(root).length, EXPECTED_IDS.length + 1);
  assert.deepEqual(checkAdapters(root).problems, []);
  assert.deepEqual(writeAdapters(root), []);
  for (const id of EXPECTED_IDS) {
    assert.ok(readFileSync(path.join(root, CODEX_DIR, `${id}.toml`)).equals(readFileSync(path.join(DEFAULT_ROOT, CODEX_DIR, `${id}.toml`))), id);
  }
});

test("gerador detecta adaptador editado à mão e TOML órfão; gravação recusa órfão sem apagar", (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeAdapters(root);
  const edited = path.join(root, CODEX_DIR, "developer.toml");
  writeFileSync(edited, `${readFileSync(edited, "utf8")}sandbox_mode = "danger-full-access"\n`);
  assert.deepEqual(checkAdapters(root).problems, [`divergente: ${CODEX_DIR}/developer.toml`]);
  const orphan = path.join(root, CODEX_DIR, "fantasma.toml");
  writeFileSync(orphan, 'name = "fantasma"\n');
  assert.ok(checkAdapters(root).problems.includes(`órfão (sem agente no catálogo): ${CODEX_DIR}/fantasma.toml`));
  assert.throws(() => writeAdapters(root), /gravação recusada/);
  assert.equal(readFileSync(orphan, "utf8"), 'name = "fantasma"\n');
});

test("gerador falha diante de catálogo neutro inválido", (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, CATALOG_DIR, "agents.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.agents[2].writeScope = ["**"];
  writeFileSync(file, JSON.stringify(json));
  assert.throws(() => loadCatalog(root), /code-reviewer: agente read-only não pode ter writeScope/);
  rmSync(path.join(root, CATALOG_DIR, "instructions", "architect.md"));
  json.agents[2].writeScope = [];
  writeFileSync(file, JSON.stringify(json));
  assert.throws(() => loadCatalog(root), /architect: instruções ausentes/);
});

// ---------------------------------------------------------------------------
// Revisão do Bloco 1: caracteres de controle e links simbólicos/junctions
// ---------------------------------------------------------------------------

test("validador rejeita caracteres de controle nos textos e nas instruções (TOML inválido)", () => {
  for (const field of ["name", "role", "description"]) {
    assert.ok(
      validateCatalogData(data(base({ [field]: "a\u0001b" }))).includes(`a: ${field} precisa ser texto de uma linha, não vazio`),
      field,
    );
  }
  assert.ok(validateCatalogData(data(base({ responsibilities: ["x\ty"] }))).length > 0);
  assert.ok(validateInstructions(["a"], new Map([["a", "x\u0007y\n"]])).includes("a: instruções com caracteres de controle"));
  assert.deepEqual(validateInstructions(["a"], new Map([["a", "tab\tpermitido\n"]])), []);
});

/** Cria link; devolve false se o sistema não permitir (por exemplo, Windows sem privilégio de symlink). */
function tryLink(target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return false;
    throw error;
  }
}

test("gerador não grava através de diretório substituído por junction/link", (t) => {
  const root = tempRepo();
  const outside = mkdtempSync(path.join(os.tmpdir(), "agentes-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  rmSync(path.join(root, CODEX_DIR), { recursive: true });
  assert.ok(tryLink(outside, path.join(root, CODEX_DIR), "junction"), "junction deveria ser criada");
  assert.throws(() => writeAdapters(root), /link simbólico ou junction/);
  assert.deepEqual(readdirSync(outside), []);
});

test("gerador recusa destino que é link simbólico para arquivo fora do repositório", (t) => {
  const root = tempRepo();
  const outside = mkdtempSync(path.join(os.tmpdir(), "agentes-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  writeAdapters(root);
  const victim = path.join(outside, "alvo.txt");
  writeFileSync(victim, "original");
  const destination = path.join(root, CODEX_DIR, "developer.toml");
  rmSync(destination);
  if (!tryLink(victim, destination, "file")) {
    t.skip("sem privilégio para criar link simbólico de arquivo neste sistema");
    return;
  }
  assert.ok(checkAdapters(root).problems.includes(`não é arquivo regular (link, junction ou diretório): ${CODEX_DIR}/developer.toml`));
  assert.throws(() => writeAdapters(root), /gravação recusada/);
  assert.equal(readFileSync(victim, "utf8"), "original");
});

test("carregador recusa instruções vindas de link simbólico ou de diretório ligado", (t) => {
  const root = tempRepo();
  const outside = mkdtempSync(path.join(os.tmpdir(), "agentes-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const instructionsDir = path.join(root, CATALOG_DIR, "instructions");
  const moved = path.join(outside, "instructions");
  renameSync(instructionsDir, moved);
  assert.ok(tryLink(moved, instructionsDir, "junction"));
  assert.throws(() => loadCatalog(root), /link simbólico ou junction/);
  rmSync(instructionsDir);
  cpSync(moved, instructionsDir, { recursive: true });
  const secret = path.join(outside, "segredo.txt");
  writeFileSync(secret, "TOKEN=nao-deveria-vazar\n");
  rmSync(path.join(instructionsDir, "developer.md"));
  if (!tryLink(secret, path.join(instructionsDir, "developer.md"), "file")) {
    t.skip("sem privilégio para criar link simbólico de arquivo neste sistema");
    return;
  }
  assert.throws(() => loadCatalog(root), /não é arquivo regular/);
});

// ---------------------------------------------------------------------------
// Instruções neutras (runtime) × legadas (adaptador Codex)
// ---------------------------------------------------------------------------

const CODEX_OPERATIONAL_TERMS = /codex|sandbox|approval_policy|app server|snapshot|sessao pai|agent-scope-check\.mjs (check|snapshot)|\.codex\//i;

test("instruções neutras não dependem de conceitos operacionais do Codex", () => {
  const { agents } = loadCatalog();
  for (const agent of agents) {
    const match = agent.instructions.match(CODEX_OPERATIONAL_TERMS);
    assert.equal(match, null, `${agent.id}: referência ao Codex: ${match?.[0]}`);
  }
});

test("instruções neutras não declaram como existente o que ainda não está implementado", () => {
  const { agents } = loadCatalog();
  for (const agent of agents.filter((item) => /workspace isolado/.test(item.instructions))) {
    assert.ok(
      agent.instructions.includes(
        "enquanto o isolamento (workspace isolado com coleta das alteracoes e aprovacao humana) nao estiver implementado, decide negar qualquer escrita de agente",
      ),
      agent.id,
    );
  }
  // Nenhuma instrução neutra descreve como vigente um mecanismo ainda não implementado.
  for (const agent of agents) {
    assert.doesNotMatch(agent.instructions, /devem ser produzidas em workspace isolado|coletadas como patch|permissao de leitura concedida pelo runtime|o runtime aplica as permissoes/, agent.id);
  }
  // Lista POSITIVA (revisão independente B2): a única menção permitida a workspace
  // isolado, coleta de alterações, patch ou aprovação automatizada é a frase aprovada,
  // que os apresenta como ainda não implementados. Paráfrases falham.
  const APPROVED = "enquanto o isolamento (workspace isolado com coleta das alteracoes e aprovacao humana) nao estiver implementado, decide negar qualquer escrita de agente";
  for (const agent of agents) {
    const residual = agent.instructions.split(APPROVED).join("");
    assert.doesNotMatch(residual, /workspace isolad|coleta d[ao]s? altera|\bpatch(es)?\b|aprovacao automat/i, agent.id);
  }
});

test("bloco ESCOPO DE ESCRITA das instruções neutras coincide com o writeScope do catálogo", () => {
  const { agents } = loadCatalog();
  for (const agent of agents) {
    const lines = agent.instructions.split("\n");
    const start = lines.findIndex((line) => line.startsWith("ESCOPO DE ESCRITA"));
    if (agent.accessMode === "workspace-write") continue;
    // Mesma regra do teste legado: agente somente leitura pode omitir o bloco; se o declarar, deve ser "nenhum".
    if (agent.accessMode === "read-only") {
      if (start >= 0) assert.match(lines[start], /^ESCOPO DE ESCRITA: nenhum\b/, agent.id);
      continue;
    }
    assert.ok(start >= 0, `${agent.id}: sem bloco ESCOPO DE ESCRITA`);
    const globs = [];
    for (let i = start + 1; i < lines.length && lines[i].trim() !== ""; i++) globs.push(lines[i].replace(/^- /, ""));
    assert.deepEqual(globs, [...agent.writeScope], agent.id);
  }
});

test("diferenças aprovadas: 14 parágrafos, todos justificados; agentes sem referência ao Codex ficam idênticos", () => {
  const differences = JSON.parse(readFileSync(path.join(DEFAULT_ROOT, CATALOG_DIR, "adapters/codex/instruction-differences.json"), "utf8"));
  assert.equal(Object.values(differences.agents).flat().length, 14);
  const { agents, legacyInstructions } = loadCatalog();
  for (const id of ["developer", "code-reviewer", "accessibility-ux-reviewer"]) {
    assert.equal(agents.find((agent) => agent.id === id).instructions, legacyInstructions.get(id), id);
  }
});

test("validação de diferenças rejeita mudança não aprovada, aprovação obsoleta, hash divergente e falta de justificativa", () => {
  const legacy = new Map([["a", "P1.\n\nP2 legado.\n"]]);
  const neutral = new Map([["a", "P1.\n\nP2 neutro.\n"]]);
  const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
  const entry = { paragraph: 2, legacySha256: sha("P2 legado.\n"), neutralSha256: sha("P2 neutro.\n"), reason: "Justificativa suficiente." };
  const ok = { schemaVersion: 1, agents: { a: [entry] } };
  assert.deepEqual(validateInstructionDifferences(neutral, legacy, ok), []);
  assert.deepEqual(validateInstructionDifferences(neutral, legacy, { schemaVersion: 1, agents: {} }), ["a: parágrafo 2 difere sem aprovação"]);
  assert.ok(validateInstructionDifferences(new Map([["a", "P1.\n\nP2 neutro editado.\n"]]), legacy, ok).includes("a: parágrafo 2: texto neutro não corresponde ao aprovado"));
  assert.ok(validateInstructionDifferences(neutral, new Map([["a", "P1.\n\nP2 legado mexido.\n"]]), ok).includes("a: parágrafo 2: texto legado não corresponde ao aprovado"));
  assert.ok(validateInstructionDifferences(neutral, legacy, { schemaVersion: 1, agents: { a: [{ ...entry, reason: "" }] } }).includes("a: parágrafo 2: justificativa ausente"));
  assert.ok(validateInstructionDifferences(legacy, legacy, ok).includes("a: diferença aprovada sem efeito (parágrafo 2 é igual ou inexistente)"));
  assert.ok(validateInstructionDifferences(new Map([["a", "P1.\n\nP2 neutro.\n\nP3 extra.\n"]]), legacy, ok).some((e) => /número de parágrafos/.test(e)));
  assert.deepEqual(validateInstructionDifferences(neutral, legacy, { schemaVersion: 1, agents: { a: [entry], b: [] } }), ["lista de diferenças: agente desconhecido: b"]);
  assert.deepEqual(validateInstructionDifferences(neutral, legacy, null), ["lista de diferenças: formato inválido"]);
});

test("gerador falha se a instrução neutra mudar sem atualizar a lista aprovada", (t) => {
  const root = tempRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, CATALOG_DIR, "instructions", "developer.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("Atue como", "Atue livremente como"));
  assert.throws(() => loadCatalog(root), /developer: parágrafo 1 difere sem aprovação/);
});

// ---------------------------------------------------------------------------
// B-M1: decisão do Permission Engine não é execução (instruções e documentação)
// ---------------------------------------------------------------------------

/** Afirmações de proteção APLICADA pelo Permission Engine (incompatíveis com o estado real: não há executor). */
const ENFORCEMENT_CLAIM = /Permission Engine(?: do runtime)?(?: sempre)? (?:nega|bloqueia|impede|aplica|garante|concede)\b|Permission Engine[^.\n]{0,40}\bnunca concede\b|é a barreira técnica de permissões do runtime/i;
const NO_EXECUTOR = /ainda n[aã]o existe executor que aplique essas decis[oõ]es/i;

test("B-M1: instruções neutras tratam o Permission Engine como decisão, sem executor que a aplique", () => {
  const { agents } = loadCatalog();
  let citing = 0;
  for (const agent of agents) {
    if (!/Permission Engine/.test(agent.instructions)) continue;
    citing += 1;
    assert.doesNotMatch(agent.instructions, ENFORCEMENT_CLAIM, agent.id);
    assert.match(agent.instructions, NO_EXECUTOR, agent.id);
    if (/VERIFICACAO DE ESCOPO: /.test(agent.instructions)) {
      assert.match(agent.instructions, /a execucao de agentes escritores permanece desabilitada/, agent.id);
    }
  }
  assert.equal(citing, 4, "coordinator, qa-engineer, devops-engineer e documentation-engineer citam o Permission Engine");
});

test("B-M1: documentação não apresenta o Permission Engine como proteção aplicada", () => {
  const docs = ["README.md", "docs/architecture/adr-0001-runtime-proprio.md", "docs/project-map.md", "standards/AI-AGENT-POLICY.md"];
  for (const doc of docs) {
    const text = readFileSync(path.join(DEFAULT_ROOT, doc), "utf8");
    assert.doesNotMatch(text, ENFORCEMENT_CLAIM, doc);
  }
  for (const doc of ["README.md", "standards/AI-AGENT-POLICY.md"]) {
    assert.match(readFileSync(path.join(DEFAULT_ROOT, doc), "utf8"), NO_EXECUTOR, doc);
  }
});

test("B-M1: o detector reconhece afirmações incompatíveis e aceita a redação aprovada", () => {
  for (const bad of [
    "o Permission Engine do runtime nega toda escrita",
    "O Permission Engine nunca concede escrita",
    "O Permission Engine bloqueia a escrita",
    "o Permission Engine aplica as permissoes",
    "é a barreira técnica de permissões do runtime",
  ]) {
    assert.match(bad, ENFORCEMENT_CLAIM, bad);
  }
  for (const ok of [
    "o Permission Engine do runtime decide negar escrita de agentes",
    "O Permission Engine nunca decide conceder escrita a agentes somente leitura",
    "permissoes decididas pelo Permission Engine, mas ainda nao existe executor que aplique essas decisoes",
  ]) {
    assert.doesNotMatch(ok, ENFORCEMENT_CLAIM, ok);
  }
});

test("documentação comunica o estado real: decisão sem executor, escritores desabilitados, A-M3 adiado, Docker não implementado", () => {
  const required = {
    "Permission Engine decide": /decide negar|decididas pelo Permission Engine|só decide|decide e é testado|decide, com negação/i,
    "sem executor": /não existe executor|nenhum executor|sem executor/i,
    "escritores desabilitados": /escritores permanece desabilitad/i,
    "A-M3 adiado": /A-M3[^\n]{0,200}adiad|adiad[^\n]{0,200}A-M3/i,
    "Docker não implementado": /Docker[^\n]{0,200}(não implementad|desativad|não iniciad)|(não implementad|planejad)[^\n]{0,200}Docker/i,
  };
  for (const doc of ["README.md", "standards/AI-AGENT-POLICY.md", "docs/project-map.md", "docs/architecture/adr-0001-runtime-proprio.md"]) {
    const text = readFileSync(path.join(DEFAULT_ROOT, doc), "utf8");
    for (const [label, pattern] of Object.entries(required)) assert.match(text, pattern, `${doc}: ${label}`);
    // Em prosa, toda oração que cita A-M3 junto de "corrigido"/"resolvido" precisa negá-lo
    // ("não corrigido"). Linhas da tabela de achados são verificadas no teste da tabela.
    const prose = text.split("\n").filter((l) => !/^\| [AB]-[A-Z]+\d+ \|/.test(l)).join("\n");
    for (const clause of prose.split(/[.;]\s|\n/).filter((c) => /A-M3/.test(c) && /corrigid|resolvid/i.test(c))) {
      assert.match(clause, /n[ãa]o (?:corrigid|resolvid)/i, `${doc}: A-M3 não pode constar como corrigido: ${clause.slice(0, 120)}`);
    }
  }
});

test("tabela de achados do ADR: uma única linha por achado; A-M3 adiado e B-M1 corrigido", () => {
  const adr = readFileSync(path.join(DEFAULT_ROOT, "docs/architecture/adr-0001-runtime-proprio.md"), "utf8");
  const ids = [...adr.matchAll(/^\| ([AB]-[A-Z]+\d+) \|/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 10, "tabela de achados encontrada");
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "IDs duplicados na tabela");
  const row = (id) => adr.split("\n").find((line) => line.startsWith(`| ${id} |`));
  assert.match(row("A-M3"), /Adiado por decisão humana; NÃO corrigido/);
  assert.match(row("B-M1"), /\*\*Corrigido por decisão humana\*\*/);
  assert.match(adr, /### Pendência adiada: A-M3/);
  for (const item of ["Situação: adiado, não corrigido", "Lacunas na lista de governança", "Lacunas na leitura", "Impacto da correção", "Efeito hoje", "Antes de qualquer mudança"]) {
    assert.ok(adr.includes(item), `seção A-M3 sem: ${item}`);
  }
});
