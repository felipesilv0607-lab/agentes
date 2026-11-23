/**
 * Carrega o catálogo neutro diretamente de `packages/agent-catalog`, sem passar
 * pelos adaptadores do Codex nem pelo catálogo do dashboard.
 *
 * Só lê arquivos regulares dentro do repositório: links simbólicos e junctions
 * (no arquivo ou em qualquer diretório do caminho) são recusados.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { buildCatalog } from "../../../packages/agent-catalog/src/catalog.ts";
import type { CatalogAgentWithInstructions } from "../../../packages/agent-catalog/src/catalog.ts";

export const CATALOG_DIR = path.join("packages", "agent-catalog");

const samePath = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

function readRegularFile(root: string, file: string): string {
  const realRoot = realpathSync(root);
  const expectedParent = path.resolve(realRoot, path.relative(root, path.dirname(file)));
  if (!samePath(realpathSync(path.dirname(file)), expectedParent)) {
    throw new Error(`catálogo: caminho com link simbólico ou junction: ${path.relative(root, file)}`);
  }
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`catálogo: não é arquivo regular: ${path.relative(root, file)}`);
  if (stats.size > 1024 * 1024) throw new Error(`catálogo: arquivo grande demais: ${path.relative(root, file)}`);
  return readFileSync(file, "utf8");
}

export interface RuntimeCatalog {
  agents: readonly Readonly<CatalogAgentWithInstructions>[];
  ids: readonly string[];
  get(id: string): Readonly<CatalogAgentWithInstructions> | undefined;
}

export function loadRuntimeCatalog(repoRoot: string): RuntimeCatalog {
  const dir = path.join(repoRoot, CATALOG_DIR);
  const data: unknown = JSON.parse(readRegularFile(repoRoot, path.join(dir, "agents.json")));
  const instructionsDir = path.join(dir, "instructions");
  const instructions = new Map<string, string>();
  for (const file of readdirSync(instructionsDir).filter((name) => name.endsWith(".md")).sort()) {
    instructions.set(file.slice(0, -3), readRegularFile(repoRoot, path.join(instructionsDir, file)));
  }
  const agents = buildCatalog(data, instructions).map((agent) =>
    Object.freeze({ ...agent, writeScope: Object.freeze([...agent.writeScope]), responsibilities: Object.freeze([...agent.responsibilities]) }),
  );
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return Object.freeze({
    agents: Object.freeze(agents),
    ids: Object.freeze(agents.map((agent) => agent.id)),
    get: (id: string) => byId.get(id),
  });
}
