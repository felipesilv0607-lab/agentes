import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadRuntimeCatalog } from "../src/catalog.ts";
import { DEFAULT_REPO_ROOT } from "../src/config.ts";

const EXPECTED_IDS = [
  "coordinator", "developer", "code-reviewer", "security-reviewer",
  "architect", "qa-engineer", "devops-engineer", "documentation-engineer", "accessibility-ux-reviewer",
];

test("runtime carrega os nove agentes diretamente de packages/agent-catalog", () => {
  const catalog = loadRuntimeCatalog(DEFAULT_REPO_ROOT);
  assert.deepEqual(catalog.ids, EXPECTED_IDS);
  for (const agent of catalog.agents) {
    const expected = readFileSync(path.join(DEFAULT_REPO_ROOT, "packages/agent-catalog/instructions", `${agent.id}.md`), "utf8");
    assert.equal(agent.instructions, expected, agent.id);
  }
  assert.equal(catalog.get("qa-engineer")?.accessMode, "tests-only");
  assert.equal(catalog.get("inexistente"), undefined);
});

test("catálogo carregado é imutável", () => {
  const catalog = loadRuntimeCatalog(DEFAULT_REPO_ROOT);
  const qa = catalog.get("qa-engineer")!;
  assert.throws(() => (qa.writeScope as string[]).push("**"));
  assert.throws(() => ((qa as { accessMode: string }).accessMode = "workspace-write"));
  assert.throws(() => (catalog.agents as unknown[]).pop());
});

function tempRoot(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentes-runtime-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(DEFAULT_REPO_ROOT, "packages/agent-catalog"), path.join(root, "packages/agent-catalog"), { recursive: true });
  return root;
}

test("catálogo inválido impede o carregamento (falha fechada)", (t) => {
  const root = tempRoot(t);
  const file = path.join(root, "packages/agent-catalog/agents.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.agents[4].writeScope = ["**"];
  writeFileSync(file, JSON.stringify(data));
  assert.throws(() => loadRuntimeCatalog(root), /architect: agente read-only não pode ter writeScope/);
});

test("instrução ausente ou JSON corrompido impedem o carregamento", (t) => {
  const root = tempRoot(t);
  rmSync(path.join(root, "packages/agent-catalog/instructions/developer.md"));
  assert.throws(() => loadRuntimeCatalog(root), /developer: instruções ausentes/);
  writeFileSync(path.join(root, "packages/agent-catalog/agents.json"), "{");
  assert.throws(() => loadRuntimeCatalog(root), SyntaxError);
});

test("runtime consome somente as instruções neutras (sem conceitos operacionais do Codex)", () => {
  const catalog = loadRuntimeCatalog(DEFAULT_REPO_ROOT);
  for (const agent of catalog.agents) {
    assert.doesNotMatch(agent.instructions, /codex|sandbox|approval_policy|app server|snapshot/i, agent.id);
    const legacy = readFileSync(path.join(DEFAULT_REPO_ROOT, "packages/agent-catalog/adapters/codex/instructions", `${agent.id}.md`), "utf8");
    if (/codex/i.test(legacy)) assert.notEqual(agent.instructions, legacy, `${agent.id}: runtime não pode carregar a cópia legada`);
  }
});
