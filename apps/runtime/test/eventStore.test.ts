import test from "node:test";
import assert from "node:assert/strict";

import { createInMemoryEventStore, MAX_EVENT_BYTES, MAX_LIST_LIMIT } from "../src/events/eventStore.ts";
import type { StoredEvent } from "../src/events/eventStore.ts";
import { createAgentStateStore } from "../src/state/agentState.ts";
import { validEvent } from "./helpers.ts";

const fixedNow = () => new Date("2026-11-23T12:00:00Z");

test("grava evento válido com sequência e horário do runtime", () => {
  const store = createInMemoryEventStore({ maxEvents: 10, now: fixedNow });
  const result = store.append(validEvent());
  assert.ok(result.ok && result.result === "accepted");
  assert.deepEqual(store.list().map((e) => [e.sequence, e.recordedAt, e.status]), [[1, "2026-11-23T12:00:00.000Z", "accepted"]]);
});

test("evento inválido é rejeitado sem alterar o armazenamento", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  for (const bad of [null, "x", validEvent({ schema_version: "9" }), validEvent({ occurred_at: "2026-02-30T00:00:00Z" }), validEvent({ event_type: "shell" })]) {
    const result = store.append(bad);
    assert.equal(result.ok, false);
  }
  assert.equal(store.size(), 0);
});

test("reentrega idêntica não duplica; mesmo id com conteúdo diferente é rejeitado", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  store.append(validEvent());
  const again = store.append(validEvent());
  assert.ok(again.ok && again.result === "duplicate" && again.stored === null);
  const changed = store.append(validEvent({ payload: { state: "queued" } }));
  assert.ok(!changed.ok && /conteúdo diferente/.test(changed.error));
  assert.equal(store.size(), 1);
});

test("versão fora de ordem fica pendente e é gravada", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  const result = store.append(validEvent({ event_id: "e2", aggregate: { type: "task", id: "task-1", version: 2 } }));
  assert.ok(result.ok && result.result === "pending");
  assert.equal(store.list()[0]?.status, "pending");
});

test("capacidade atingida recusa novos eventos (sem descarte silencioso)", () => {
  const store = createInMemoryEventStore({ maxEvents: 2 });
  store.append(validEvent({ event_id: "a", task_id: "a", root_task_id: "a", aggregate: { type: "task", id: "a", version: 1 } }));
  store.append(validEvent({ event_id: "b", task_id: "b", root_task_id: "b", aggregate: { type: "task", id: "b", version: 1 } }));
  const third = store.append(validEvent({ event_id: "c", task_id: "c", root_task_id: "c", aggregate: { type: "task", id: "c", version: 1 } }));
  assert.ok(!third.ok && /capacidade/.test(third.error));
  assert.equal(store.size(), 2);
});

test("listagem paginada com limites e cópias isoladas", () => {
  const store = createInMemoryEventStore({ maxEvents: 1000 });
  for (let i = 1; i <= 5; i++) store.append(validEvent({ event_id: `e${i}`, task_id: `t${i}`, root_task_id: `t${i}`, aggregate: { type: "task", id: `t${i}`, version: 1 } }));
  assert.deepEqual(store.list({ after: 2, limit: 2 }).map((e) => e.sequence), [3, 4]);
  assert.equal(store.list({ limit: 10_000 }).length, Math.min(5, MAX_LIST_LIMIT));
  assert.equal(store.list({ limit: 0 }).length, 1);
  const first = store.list()[0] as StoredEvent;
  (first.event.payload as Record<string, unknown>).state = "adulterado";
  assert.equal((store.list()[0]?.event.payload as Record<string, unknown>).state, "planned");
});

test("assinantes recebem eventos; erro de um assinante não afeta gravação nem os demais", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  const received: number[] = [];
  store.subscribe(() => {
    throw new Error("assinante defeituoso");
  });
  const unsubscribe = store.subscribe((stored) => received.push(stored.sequence));
  assert.ok(store.append(validEvent()).ok);
  unsubscribe();
  store.append(validEvent({ event_id: "e2", aggregate: { type: "task", id: "task-1", version: 2 } }));
  assert.deepEqual(received, [1]);
});

test("estado dos agentes começa em repouso e só aceita atualizações válidas pelo contrato", () => {
  const state = createAgentStateStore(["coordinator", "developer"], fixedNow);
  assert.deepEqual(state.snapshot().agents.map((a) => a.status), ["resting", "resting"]);
  const seen: string[] = [];
  state.subscribe((s) => seen.push(s.agents[0]?.status ?? ""));
  state.update("coordinator", { status: "working", currentTask: "Planejando", lastActivityAt: "2026-11-23T12:00:00Z" });
  assert.deepEqual(seen, ["working"]);
  assert.throws(() => state.update("intruso", { status: "working" }), /desconhecido/);
  assert.throws(() => state.update("developer", { status: "hacking" as "working" }), /status inválido/);
  assert.throws(() => state.update("developer", { currentTask: "<script>\n" }), /currentTask inválida/);
  assert.equal(state.snapshot().agents[1]?.status, "resting");
});

test("evento maior que o limite ou não serializável é recusado (revisão do Bloco 2)", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  const huge = store.append(validEvent({ payload: { state: "planned", blob: "x".repeat(MAX_EVENT_BYTES) } }));
  assert.ok(!huge.ok && /maior que/.test(huge.error));
  const bigint = store.append(validEvent({ payload: { n: 1n } }));
  assert.ok(!bigint.ok && /serializável/.test(bigint.error));
  const cyclic: Record<string, unknown> = validEvent();
  (cyclic.payload as Record<string, unknown>).self = cyclic;
  assert.equal(store.append(cyclic).ok, false);
  assert.equal(store.size(), 0);
});

test("o que é gravado é exatamente o que foi validado: toJSON, getters e valores não JSON (revisão M2)", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  // toJSON não fura o limite: o objeto gravado é o serializado (pequeno), não o vivo (5 MB).
  const withToJson = { ...validEvent(), payload: { state: "planned", blob: "x".repeat(5_000_000) }, toJSON: () => validEvent({ event_id: "tojson" }) };
  const r1 = store.append(withToJson);
  assert.ok(r1.ok && r1.stored);
  assert.equal(JSON.stringify(r1.stored.event).length < 2000, true);
  // Getter que muda de valor: a validação e a gravação usam a mesma leitura.
  let reads = 0;
  const shifting = validEvent({ event_id: "getter", task_id: "g", root_task_id: "g", aggregate: { type: "task", id: "g", version: 1 } });
  Object.defineProperty(shifting, "schema_version", { enumerable: true, get: () => (++reads <= 1 ? "1.0" : "9.9") });
  const r2 = store.append(shifting);
  assert.ok(r2.ok && r2.stored);
  assert.equal(r2.stored.event.schema_version, "1.0");
  for (const stored of store.list()) assert.equal(stored.event.schema_version, "1.0");
  // NaN vira null já na validação (sem divergência entre o gravado e o devolvido pela API).
  const r3 = store.append(validEvent({ event_id: "nan", task_id: "n", root_task_id: "n", aggregate: { type: "task", id: "n", version: 1 }, payload: { state: "planned", score: Number.NaN } }));
  assert.ok(r3.ok && r3.stored);
  assert.equal((r3.stored.event.payload as Record<string, unknown>).score, null);
});

test("erros internos não vazam para o chamador (revisão B6)", () => {
  const store = createInMemoryEventStore({ maxEvents: 10 });
  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let i = 0; i < 20_000; i++) deep = (deep.next = {}) as Record<string, unknown>;
  const result = store.append(validEvent({ payload: { state: "planned", root } }));
  assert.equal(result.ok, false);
  assert.doesNotMatch((result as { error: string }).error, /call stack/i);
});
