import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_STATUSES,
  API_SCHEMA_VERSION,
  ContractError,
  MAX_TASK_SUMMARY_LENGTH,
  SSE_EVENT_NAMES,
  cloneJson,
  createVersionTracker,
  isUriReference,
  jsonEqual,
  parseAgentsSnapshot,
  validateEventEnvelope,
} from "../packages/contracts/src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const event = (overrides = {}) => ({
  event_id: "event-1",
  source: "agente-s.example",
  event_type: "task",
  schema_version: "1.0",
  occurred_at: "2026-11-04T10:00:00-03:00",
  task_id: "task-1",
  root_task_id: "task-1",
  aggregate: { type: "task", id: "task-1", version: 1 },
  payload: { state: "planned" },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Envelope e tracker: comportamento do pacote (complementa contract.test.mjs)
// ---------------------------------------------------------------------------

test("erros de validação são ContractError com mensagem descritiva", () => {
  assert.throws(() => validateEventEnvelope(null), (error) => error instanceof ContractError && /precisa ser um objeto/.test(error.message));
  const { payload: _payload, ...missing } = event();
  assert.throws(() => validateEventEnvelope(missing), /Campo obrigatorio ausente: payload/);
  assert.throws(() => validateEventEnvelope(event({ event_type: "deploy" })), /Tipo de evento desconhecido: deploy/);
  assert.throws(() => validateEventEnvelope(event({ aggregate: { type: "task", id: "task-1", version: 0 } })), /inteiro positivo/);
  assert.throws(() => validateEventEnvelope(event({ aggregate: { type: "task", id: "task-1", version: "1" } })), /inteiro positivo/);
  assert.throws(() => validateEventEnvelope(event({ payload: [] })), /payload precisa ser objeto/);
  assert.throws(() => validateEventEnvelope(event({ recorded_at: "ontem" })), /recorded_at/);
  assert.throws(() => validateEventEnvelope(event({ parent_event_ref: { source: "a", event_id: " " } })), /parent_event_ref.event_id/);
  assert.throws(
    () => validateEventEnvelope(event({ task_id: "child", aggregate: { type: "task", id: "child", version: 1 }, payload: { parent_task_id: "child" } })),
    /pai de si mesma/,
  );
  assert.equal(validateEventEnvelope(event()), true);
});

test("URI-reference rejeita vazio e espaços", () => {
  for (const value of ["", " a", "a b", "a\tb", 1, null]) assert.equal(isUriReference(value), false, String(value));
  for (const value of ["agente-s.example", "urn:agente-s:runtime", "https://agente-s.example/x"]) assert.equal(isUriReference(value), true, value);
});

test("reentrega difere quando uma chave existe somente com valor undefined (igualdade estrita)", () => {
  const tracker = createVersionTracker();
  assert.equal(tracker.register(event()), "accepted");
  assert.throws(() => tracker.register(event({ payload: { state: "planned", extra: undefined } })), /conteúdo diferente/);
  assert.equal(tracker.register(event({ payload: { state: "planned" } })), "duplicate");
});

test("tracker guarda cópia: mutar o evento original não altera a deduplicação", () => {
  const tracker = createVersionTracker();
  const original = event();
  tracker.register(original);
  original.payload.state = "queued";
  assert.throws(() => tracker.register(original), /conteúdo diferente/);
});

test("tracker rejeita versão antiga e versão pendente repetida", () => {
  const tracker = createVersionTracker();
  tracker.register(event({ event_id: "v2", aggregate: { type: "task", id: "task-1", version: 3 } }));
  assert.throws(() => tracker.register(event({ event_id: "v2-bis", aggregate: { type: "task", id: "task-1", version: 3 } })), /já está pendente/);
  tracker.register(event({ event_id: "v1" }));
  tracker.register(event({ event_id: "v2b", aggregate: { type: "task", id: "task-1", version: 2 } }));
  assert.throws(() => tracker.register(event({ event_id: "old", aggregate: { type: "task", id: "task-1", version: 1 } })), /já foi registrada/);
});

test("jsonEqual e cloneJson tratam listas, objetos aninhados e ordem de chaves", () => {
  assert.equal(jsonEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] }), true);
  assert.equal(jsonEqual([1, 2], [2, 1]), false);
  assert.equal(jsonEqual({ a: 1 }, [1]), false);
  assert.equal(jsonEqual({ a: undefined }, {}), false);
  const source = { a: [{ b: 1 }] };
  const copy = cloneJson(source);
  copy.a[0].b = 2;
  assert.equal(source.a[0].b, 1);
});

// ---------------------------------------------------------------------------
// Contrato da API (REST + SSE)
// ---------------------------------------------------------------------------

const known = ["coordinator", "developer"];
const snapshot = (overrides = {}) => ({
  schemaVersion: API_SCHEMA_VERSION,
  source: "runtime",
  updatedAt: "2026-11-23T10:00:00Z",
  agents: [
    { id: "coordinator", status: "working", currentTask: "Planejando", lastActivityAt: "2026-11-23T09:59:00Z" },
    { id: "developer", status: "resting", currentTask: null, lastActivityAt: null },
  ],
  ...overrides,
});

test("parseAgentsSnapshot aceita snapshot válido e devolve cópia", () => {
  const input = snapshot();
  const parsed = parseAgentsSnapshot(input, known);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed.agents, input.agents);
});

test("parseAgentsSnapshot rejeita entradas não confiáveis", () => {
  const agent = (overrides) => snapshot({ agents: [{ id: "coordinator", status: "working", currentTask: null, lastActivityAt: null, ...overrides }] });
  const cases = [
    [null, /precisa ser objeto/],
    [snapshot({ extra: true }), /chave desconhecida: extra/],
    [snapshot({ schemaVersion: "2.0" }), /schemaVersion/],
    [snapshot({ source: "demo" }), /source precisa ser runtime/],
    [snapshot({ updatedAt: "agora" }), /updatedAt/],
    [snapshot({ agents: {} }), /agents precisa ser lista/],
    [agent({ id: "intruso" }), /agente desconhecido: intruso/],
    [agent({ id: "__proto__" }), /agente desconhecido/],
    [agent({ status: "hacking" }), /status inválido/],
    [agent({ currentTask: "" }), /currentTask inválida/],
    [agent({ currentTask: "x".repeat(MAX_TASK_SUMMARY_LENGTH + 1) }), /currentTask inválida/],
    [agent({ currentTask: "linha\nquebrada" }), /currentTask inválida/],
    [agent({ currentTask: 42 }), /currentTask inválida/],
    [agent({ lastActivityAt: "09:18" }), /lastActivityAt inválido/],
    [agent({ html: "<b>" }), /chave desconhecida: html/],
    [snapshot({ agents: [snapshot().agents[0], snapshot().agents[0]] }), /agente duplicado: coordinator/],
    [snapshot({ agents: [...snapshot().agents, snapshot().agents[0]] }), /mais agentes do que o catálogo/],
  ];
  for (const [input, pattern] of cases) assert.throws(() => parseAgentsSnapshot(input, known), pattern, String(pattern));
});

test("estados da API coincidem com os estados do dashboard e nomes SSE são estáveis", () => {
  const types = readFileSync(path.join(repoRoot, "apps/dashboard/src/types/agent.ts"), "utf8");
  const body = types.match(/export type AgentStatus =([^;]+);/)?.[1] ?? "";
  assert.deepEqual([...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]), [...AGENT_STATUSES]);
  assert.deepEqual(SSE_EVENT_NAMES, { agentsSnapshot: "agents.snapshot", heartbeat: "heartbeat" });
});

test("timestamps com data ou hora inexistentes são rejeitados (revisão do Bloco 1)", () => {
  for (const invalid of ["2026-02-29T10:00:00Z", "2026-02-30T10:00:00Z", "2026-04-31T10:00:00Z", "2026-01-01T24:00:00Z", "2026-00-10T10:00:00Z", "2026-01-01T23:59:60Z"]) {
    assert.throws(() => validateEventEnvelope(event({ occurred_at: invalid })), /RFC 3339/, invalid);
  }
  for (const valid of ["2024-02-29T00:00:00Z", "2026-12-31T23:59:59.999-03:00", "2026-04-30T00:00:00+13:00"]) {
    assert.equal(validateEventEnvelope(event({ occurred_at: valid })), true, valid);
  }
});

test("campos opcionais do envelope, quando presentes, precisam ser texto não vazio (revisão)", () => {
  for (const field of ["actor_agent_id", "correlation_id", "trace_id"]) {
    for (const bad of ["", "   ", 42, null, {}]) {
      assert.throws(() => validateEventEnvelope(event({ [field]: bad })), new RegExp(`${field} precisa ser texto`), `${field}=${JSON.stringify(bad)}`);
    }
    assert.equal(validateEventEnvelope(event({ [field]: "valor" })), true);
  }
});

test("anos 0000-0099 usam o calendário correto (revisão B6)", () => {
  assert.equal(validateEventEnvelope(event({ occurred_at: "0000-02-29T00:00:00Z" })), true);
  assert.equal(validateEventEnvelope(event({ occurred_at: "0004-02-29T00:00:00Z" })), true);
  assert.throws(() => validateEventEnvelope(event({ occurred_at: "0001-02-29T00:00:00Z" })), /RFC 3339/);
});
