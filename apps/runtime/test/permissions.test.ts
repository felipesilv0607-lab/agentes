import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadRuntimeCatalog } from "../src/catalog.ts";
import { DEFAULT_REPO_ROOT } from "../src/config.ts";
import { createPermissionEngine, GOVERNANCE_GLOBS, PUBLISH_OPERATIONS } from "../src/permissions/engine.ts";
import { compileScope, unsafePathReason } from "../src/permissions/paths.ts";

const catalog = loadRuntimeCatalog(DEFAULT_REPO_ROOT);
const production = createPermissionEngine(catalog.agents, { isolationEnabled: false });
/** Somente para exercitar as regras de escopo que valerão quando o isolamento for aprovado. */
const isolated = createPermissionEngine(catalog.agents, { isolationEnabled: true });

const write = (p: string, target = "isolated-workspace") => ({ kind: "write", target, path: p });

test("nenhum dos nove agentes escreve no repositório original, nem com isolamento ativo", () => {
  for (const id of catalog.ids) {
    for (const engine of [production, isolated]) {
      for (const p of ["README.md", "docs/x.md", "scripts/x.test.mjs", ".github/workflows/deploy.yml", "apps/dashboard/src/App.tsx"]) {
        const decision = engine.evaluate(id, write(p, "original-repository"));
        assert.equal(decision.allowed, false, `${id} ${p}`);
        assert.equal(decision.rule, "original-repository-read-only");
      }
    }
  }
});

test("com o isolamento desativado (padrão desta etapa), nenhuma escrita é permitida", () => {
  for (const id of catalog.ids) {
    const decision = production.evaluate(id, write("docs/novo.md"));
    assert.deepEqual([decision.allowed, decision.rule], [false, "isolation-unavailable"], id);
  }
});

test("publicação é sempre negada para todos os agentes", () => {
  for (const id of catalog.ids) {
    for (const operation of [...PUBLISH_OPERATIONS, "qualquer-outra"]) {
      const decision = isolated.evaluate(id, { kind: "publish", operation });
      assert.deepEqual([decision.allowed, decision.rule], [false, "publish-forbidden"], `${id} ${operation}`);
    }
  }
});

test("execução de comandos, rede e modelos ficam negados nesta etapa", () => {
  for (const id of catalog.ids) {
    for (const action of [{ kind: "execute", command: "npm test" }, { kind: "network", host: "api.example.com" }, { kind: "model", provider: "ollama" }]) {
      assert.deepEqual([isolated.evaluate(id, action).allowed, isolated.evaluate(id, action).rule], [false, "capability-disabled"]);
    }
  }
});

test("negação por padrão: agente desconhecido, ação desconhecida ou malformada", () => {
  const cases: Array<[unknown, unknown, string]> = [
    ["intruso", { kind: "read", path: "README.md" }, "unknown-agent"],
    [undefined, { kind: "read", path: "README.md" }, "unknown-agent"],
    ["__proto__", { kind: "read", path: "README.md" }, "unknown-agent"],
    ["developer", null, "malformed-action"],
    ["developer", "read", "malformed-action"],
    ["developer", { kind: "delete", path: "README.md" }, "unknown-action"],
    ["developer", { kind: "write", target: "../outro", path: "x" }, "malformed-action"],
    ["developer", { kind: "write", path: "x" }, "malformed-action"],
  ];
  for (const [agent, action, rule] of cases) {
    const decision = isolated.evaluate(agent, action);
    assert.deepEqual([decision.allowed, decision.rule], [false, rule], JSON.stringify([agent, action]));
  }
});

test("erro interno na avaliação resulta em negação (falha fechada)", () => {
  const hostile = { kind: "read", get path(): string { throw new Error("boom"); } };
  assert.deepEqual(isolated.evaluate("developer", hostile).rule, "evaluation-error");
});

test("agentes somente leitura nunca escrevem, mesmo com isolamento", () => {
  for (const id of ["code-reviewer", "security-reviewer", "architect", "accessibility-ux-reviewer"]) {
    assert.equal(isolated.evaluate(id, write("docs/x.md")).rule, "read-only-agent", id);
  }
});

test("escopos dos papéis restritos (com isolamento ativo)", () => {
  const expectations: Array<[string, string, boolean]> = [
    ["qa-engineer", "scripts/novo.test.mjs", true],
    ["qa-engineer", "scripts/sub/novo.test.mjs", true],
    ["qa-engineer", "scripts/fixtures/a.json", true],
    ["qa-engineer", "apps/dashboard/src/x/y.test.tsx", true],
    ["qa-engineer", "scripts/agent-catalog.test.mjs", false],
    ["qa-engineer", "scripts/agent-adapters.test.mjs", false],
    ["qa-engineer", "scripts/generate-agent-adapters.mjs", false],
    ["qa-engineer", "apps/dashboard/src/App.tsx", false],
    ["qa-engineer", "README.md", false],
    ["devops-engineer", ".github/workflows/ci.yml", true],
    ["devops-engineer", "apps/dashboard/vite.config.ts", false],
    ["devops-engineer", "package.json", false],
    ["documentation-engineer", "README.md", true],
    ["documentation-engineer", "docs/a/b.md", true],
    ["documentation-engineer", "standards/AI-AGENT-POLICY.md", false],
    ["documentation-engineer", "AGENTS.md", false],
    ["developer", "apps/runtime/src/http/server.ts", true],
    ["developer", "apps/dashboard/src/App.tsx", true],
  ];
  for (const [id, p, allowed] of expectations) assert.equal(isolated.evaluate(id, write(p)).allowed, allowed, `${id} ${p}`);
});

test("governança é protegida para todos, inclusive escritores amplos e variações de caixa", () => {
  const governance = [
    "AGENTS.md", "apps/AGENTS.md", "x/AGENTS.override.md", "standards/SECURITY-BASELINE.md", "Standards/x.md",
    "packages/agent-catalog/agents.json", "packages/agent-catalog/instructions/developer.md", "PACKAGES/AGENT-CATALOG/agents.json",
    "packages/contracts/src/api.ts", ".codex/agents/developer.toml", ".CODEX/agents/x.toml",
    "apps/dashboard/src/data/agentCatalog.ts", "apps/dashboard/src/types/agent.ts",
    "apps/runtime/src/permissions/engine.ts", "apps/runtime/src/config.ts", "apps/runtime/test/permissions.test.ts",
    "scripts/agent-scope-check.mjs", "scripts/security-baseline.test.mjs",
  ];
  for (const id of ["developer", "coordinator"]) {
    for (const p of governance) assert.equal(isolated.evaluate(id, write(p)).rule, "governance-path", `${id} ${p}`);
  }
});

test("escrita que difere do escopo só na caixa é negada", () => {
  assert.equal(isolated.evaluate("documentation-engineer", write("readme.md")).rule, "case-mismatch");
  assert.equal(isolated.evaluate("documentation-engineer", write("Docs/x.md")).rule, "case-mismatch");
});

test("caminhos inseguros são negados para leitura e escrita", () => {
  const unsafe = [
    "", "../x", "docs/../../x", "/etc/passwd", "C:/Windows/x", "c:x", "docs\\x.md", "docs//x", "./docs/x", "docs/./x",
    ".git/config", "a/.GIT/hooks/x", "GIT~1/config", "docs~1/x", "docs./x", "docs /x", "README.md:oculto",
    "CON", "docs/nul.txt", "docs/x\u0000", "docs/\nx", "a".repeat(1025),
  ];
  for (const p of unsafe) {
    assert.notEqual(unsafePathReason(p), null, JSON.stringify(p));
    assert.equal(isolated.evaluate("developer", { kind: "read", path: p }).rule, "unsafe-path", JSON.stringify(p));
    assert.equal(isolated.evaluate("developer", write(p)).allowed, false, JSON.stringify(p));
  }
  assert.equal(isolated.evaluate("developer", { kind: "read", path: 42 }).rule, "unsafe-path");
});

test("leitura de segredos e dependências é negada; leitura comum é permitida", () => {
  for (const p of [".env", "apps/runtime/.env.local", "certs/server.pem", "a/b.key", "home/.npmrc", "apps/dashboard/node_modules/x/index.js", "config/credentials.json"]) {
    assert.equal(production.evaluate("code-reviewer", { kind: "read", path: p }).rule, "secret-path", p);
  }
  for (const p of ["README.md", "apps/dashboard/src/App.tsx", "packages/agent-catalog/agents.json", ".github/workflows/deploy.yml"]) {
    assert.equal(production.evaluate("code-reviewer", { kind: "read", path: p }).allowed, true, p);
  }
});

test("semântica de glob equivale à do verificador de escopo (sem depender dele em produção)", async () => {
  const checker = (await import(pathToFileURL(path.join(DEFAULT_REPO_ROOT, "scripts/agent-scope-check.mjs")).href)) as {
    compileScope: (scope: readonly string[], options?: { ignoreCase?: boolean }) => (p: string) => boolean;
  };
  const scopes = [...catalog.agents.map((agent) => agent.writeScope), GOVERNANCE_GLOBS, ["a/*.md", "!a/x.md"], ["**/b/**"]];
  const paths = [
    "README.md", "readme.md", "docs/a.md", "docs/a/b/c.md", "scripts/x.test.mjs", "scripts/a/b/x.test.mjs", "scripts/agent-catalog.test.mjs",
    "scripts/fixtures/x", ".github/workflows/a.yml", "apps/dashboard/src/a.test.tsx", "AGENTS.md", "x/AGENTS.md", "a/x.md", "a/y.md",
    "a/b/c", "b/c", "x/b", "standards/x", "Standards/x",
  ];
  for (const scope of scopes) {
    for (const ignoreCase of [false, true]) {
      const ours = compileScope(scope, ignoreCase);
      const theirs = checker.compileScope(scope, { ignoreCase });
      for (const p of paths) assert.equal(ours(p), theirs(p), `${JSON.stringify(scope)} ${p} ${ignoreCase}`);
    }
  }
});

test("caminho é lido uma única vez: getter não troca o valor entre validação e uso (revisão M1)", () => {
  let reads = 0;
  const hostile = {
    kind: "write",
    target: "isolated-workspace",
    get path(): string {
      reads += 1;
      return reads === 1 ? "docs/x.md" : "../../../Windows/x.txt";
    },
  };
  const decision = isolated.evaluate("developer", hostile);
  assert.equal(reads, 1, "o caminho deve ser lido uma única vez");
  assert.deepEqual([decision.allowed, decision.path], [true, "docs/x.md"]);
  let readReads = 0;
  const hostileRead = { kind: "read", get path(): string { readReads += 1; return readReads === 1 ? "README.md" : ".env"; } };
  const readDecision = isolated.evaluate("code-reviewer", hostileRead);
  assert.deepEqual([readReads, readDecision.path], [1, "README.md"]);
});

test("decisões negadas não trazem caminho aprovado; permitidas trazem o caminho exato", () => {
  assert.equal(isolated.evaluate("developer", write("README.md", "original-repository")).path, undefined);
  assert.equal(isolated.evaluate("documentation-engineer", write("docs/a.md")).path, "docs/a.md");
  assert.equal(production.evaluate("code-reviewer", { kind: "read", path: "README.md" }).path, "README.md");
});
