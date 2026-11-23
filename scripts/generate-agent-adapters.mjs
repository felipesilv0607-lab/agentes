#!/usr/bin/env node
/**
 * Gera ou confere os adaptadores do catálogo neutro de agentes.
 *
 *   node scripts/generate-agent-adapters.mjs --check   (padrão) confere sem gravar; saída 1 se houver divergência
 *   node scripts/generate-agent-adapters.mjs --write   grava os adaptadores
 *
 * Fontes (packages/agent-catalog):
 *   - agents.json e instructions/<id>.md: catálogo neutro (o runtime usa somente estes);
 *   - adapters/codex/instructions/<id>.md: cópia CONGELADA das instruções legadas, fonte dos TOMLs;
 *   - adapters/codex/layout.json: cabeçalhos e final de arquivo dos TOMLs legados;
 *   - adapters/codex/instruction-differences.json: diferenças aprovadas entre legado e neutro
 *     (conferidas parágrafo a parágrafo, por SHA-256; qualquer outra diferença é erro).
 * Destinos:
 *   - .codex/agents/<id>.toml                  (adaptador TEMPORÁRIO do Codex)
 *   - apps/dashboard/src/data/agentCatalog.ts  (cópia para o dashboard, sem instruções)
 *
 * O gerador só lê e grava esses caminhos fixos; não executa comandos nem acessa a rede.
 * Em --write, também recusa gravar se existir em .codex/agents um TOML sem agente
 * no catálogo (não apaga nada: a remoção de adaptadores é decisão humana).
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCatalog, validateInstructions } from "../packages/agent-catalog/src/catalog.ts";
import { renderCodexToml, renderDashboardCatalog, validateCodexLayout } from "../packages/agent-catalog/src/adapters.ts";

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CATALOG_DIR = "packages/agent-catalog";
export const CODEX_DIR = ".codex/agents";
export const DASHBOARD_CATALOG = "apps/dashboard/src/data/agentCatalog.ts";

const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Garante que nenhum componente do caminho, da raiz até `target` (exclusive),
 * seja link simbólico ou junction: o caminho real precisa coincidir com o lógico.
 */
function assertNoLinkedParents(root, target) {
  const realRoot = realpathSync(root);
  const relativeParent = path.relative(root, path.dirname(target));
  const realParent = realpathSync(path.dirname(target));
  if (!samePath(realParent, path.resolve(realRoot, relativeParent))) {
    throw new Error(`caminho com link simbólico ou junction: ${path.relative(root, target)}`);
  }
}

/** Tipo da entrada sem seguir links: "missing", "file", "link" ou "other". */
function entryKind(file) {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (!stats) return "missing";
  if (stats.isSymbolicLink()) return "link";
  return stats.isFile() ? "file" : "other";
}

/** Lê somente arquivo regular dentro da raiz, sem seguir links. */
function readRegularText(root, file) {
  assertNoLinkedParents(root, file);
  if (entryKind(file) !== "file") throw new Error(`não é arquivo regular: ${path.relative(root, file)}`);
  return readFileSync(file, "utf8");
}

/** Lê e valida o catálogo neutro do disco. Lança erro se for inválido. */
export function loadCatalog(root = DEFAULT_ROOT) {
  const dir = path.join(root, CATALOG_DIR);
  const readText = (file) => readRegularText(root, file);
  const data = JSON.parse(readText(path.join(dir, "agents.json")));
  const readInstructionDir = (instructionsDir) =>
    new Map(
      readdirSync(instructionsDir)
        .filter((file) => file.endsWith(".md"))
        .sort()
        .map((file) => [file.slice(0, -3), readText(path.join(instructionsDir, file))]),
    );
  const agents = buildCatalog(data, readInstructionDir(path.join(dir, "instructions")));
  const ids = agents.map((agent) => agent.id);
  const legacyInstructions = readInstructionDir(path.join(dir, "adapters", "codex", "instructions"));
  const legacyErrors = validateInstructions(ids, legacyInstructions).map((error) => `legado: ${error}`);
  if (legacyErrors.length > 0) throw new Error(`instruções legadas inválidas:\n- ${legacyErrors.join("\n- ")}`);
  const differences = JSON.parse(readText(path.join(dir, "adapters", "codex", "instruction-differences.json")));
  const differenceErrors = validateInstructionDifferences(
    new Map(agents.map((agent) => [agent.id, agent.instructions])),
    legacyInstructions,
    differences,
  );
  if (differenceErrors.length > 0) throw new Error(`instruções neutras divergem do legado fora das diferenças aprovadas:\n- ${differenceErrors.join("\n- ")}`);
  const layout = JSON.parse(readText(path.join(dir, "adapters", "codex", "layout.json")));
  const layoutErrors = validateCodexLayout(
    layout,
    agents.map((agent) => agent.id),
  );
  if (layoutErrors.length > 0) throw new Error(`layout Codex inválido:\n- ${layoutErrors.join("\n- ")}`);
  return { agents, legacyInstructions, layout };
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Compara instruções neutras e legadas parágrafo a parágrafo (separados por linha
 * em branco). Parágrafos iguais não podem constar da lista; parágrafos diferentes
 * precisam constar dela com os dois SHA-256 exatos e uma justificativa.
 */
export function validateInstructionDifferences(neutral, legacy, differences) {
  const errors = [];
  if (differences?.schemaVersion !== 1 || differences.agents === null || typeof differences.agents !== "object") {
    return ["lista de diferenças: formato inválido"];
  }
  for (const id of Object.keys(differences.agents)) {
    if (!neutral.has(id)) errors.push(`lista de diferenças: agente desconhecido: ${id}`);
  }
  for (const [id, neutralText] of neutral) {
    const legacyText = legacy.get(id);
    if (legacyText === undefined) continue;
    const a = legacyText.split("\n\n");
    const b = neutralText.split("\n\n");
    const approved = Object.hasOwn(differences.agents, id) ? differences.agents[id] : [];
    if (!Array.isArray(approved)) {
      errors.push(`${id}: lista de diferenças inválida`);
      continue;
    }
    if (a.length !== b.length) errors.push(`${id}: número de parágrafos difere (legado ${a.length}, neutro ${b.length})`);
    const used = new Set();
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const entry = approved.find((item) => item?.paragraph === i + 1);
      if (!entry) {
        errors.push(`${id}: parágrafo ${i + 1} difere sem aprovação`);
        continue;
      }
      used.add(entry);
      if (entry.legacySha256 !== sha256(a[i] ?? "")) errors.push(`${id}: parágrafo ${i + 1}: texto legado não corresponde ao aprovado`);
      if (entry.neutralSha256 !== sha256(b[i] ?? "")) errors.push(`${id}: parágrafo ${i + 1}: texto neutro não corresponde ao aprovado`);
      if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) errors.push(`${id}: parágrafo ${i + 1}: justificativa ausente`);
    }
    for (const entry of approved) {
      if (!used.has(entry)) errors.push(`${id}: diferença aprovada sem efeito (parágrafo ${entry?.paragraph} é igual ou inexistente)`);
    }
  }
  return errors;
}

/** Conteúdo esperado de cada adaptador, indexado pelo caminho relativo à raiz. */
export function renderAdapters({ agents, legacyInstructions, layout }) {
  const outputs = new Map();
  for (const agent of agents) {
    // O adaptador Codex usa SEMPRE as instruções legadas congeladas (paridade byte a byte).
    const legacyAgent = { ...agent, instructions: legacyInstructions.get(agent.id) };
    outputs.set(`${CODEX_DIR}/${agent.id}.toml`, renderCodexToml(legacyAgent, layout.agents[agent.id]));
  }
  outputs.set(DASHBOARD_CATALOG, renderDashboardCatalog(agents));
  return outputs;
}

/** Compara os adaptadores esperados com o disco, byte a byte. */
export function checkAdapters(root = DEFAULT_ROOT) {
  const catalog = loadCatalog(root);
  const outputs = renderAdapters(catalog);
  const problems = [];
  for (const [relative, expected] of outputs) {
    const file = path.join(root, relative);
    assertNoLinkedParents(root, file);
    const kind = entryKind(file);
    if (kind === "missing") problems.push(`ausente: ${relative}`);
    else if (kind !== "file") problems.push(`não é arquivo regular (link, junction ou diretório): ${relative}`);
    else if (!readFileSync(file).equals(Buffer.from(expected, "utf8"))) problems.push(`divergente: ${relative}`);
  }
  const codexDir = path.join(root, CODEX_DIR);
  if (entryKind(codexDir) !== "missing") {
    for (const file of readdirSync(codexDir).filter((name) => name.endsWith(".toml"))) {
      if (!outputs.has(`${CODEX_DIR}/${file}`)) problems.push(`órfão (sem agente no catálogo): ${CODEX_DIR}/${file}`);
    }
  }
  return { outputs, problems };
}

/**
 * Grava os adaptadores. Recusa tudo (sem gravar nada) se houver TOML órfão ou
 * destino que não seja arquivo regular: nunca segue links para fora do repositório.
 */
export function writeAdapters(root = DEFAULT_ROOT) {
  const { outputs, problems } = checkAdapters(root);
  const blocking = problems.filter((problem) => problem.startsWith("órfão") || problem.startsWith("não é arquivo regular"));
  if (blocking.length > 0) throw new Error(`gravação recusada:\n- ${blocking.join("\n- ")}`);
  const written = [];
  for (const [relative, content] of outputs) {
    const file = path.join(root, relative);
    if (entryKind(file) === "file" && readFileSync(file).equals(Buffer.from(content, "utf8"))) continue;
    writeFileSync(file, content, { encoding: "utf8", flag: entryKind(file) === "missing" ? "wx" : "w" });
    written.push(relative);
  }
  return written;
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--check" && arg !== "--write");
  if (unknown.length > 0 || (args.includes("--check") && args.includes("--write"))) {
    console.error("uso: node scripts/generate-agent-adapters.mjs [--check | --write]");
    return 2;
  }
  try {
    if (args.includes("--write")) {
      const written = writeAdapters();
      console.log(written.length ? `gravados:\n- ${written.join("\n- ")}` : "adaptadores já atualizados");
      return 0;
    }
    const { outputs, problems } = checkAdapters();
    if (problems.length > 0) {
      console.error(`adaptadores divergentes do catálogo:\n- ${problems.join("\n- ")}`);
      return 1;
    }
    console.log(`ok: ${outputs.size} adaptadores idênticos ao catálogo neutro`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
