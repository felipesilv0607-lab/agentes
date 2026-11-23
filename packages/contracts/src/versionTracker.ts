/**
 * Controle de versão por agregado (docs/event-contract.md): deduplicação por
 * `(source, event_id)`, versões sequenciais por `(source, aggregate.type,
 * aggregate.id)` e eventos fora de ordem mantidos como pendentes.
 * Extraído de `scripts/contract.test.mjs`, sem mudança de comportamento.
 */

import { ensure, validateEventEnvelope } from "./events.ts";
import type { EventEnvelope } from "./events.ts";

export type RegisterResult = "accepted" | "pending" | "duplicate";

export interface VersionTracker {
  register(event: unknown): RegisterResult;
}

/** Cópia profunda de dados JSON (objetos simples, listas e primitivos). */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneJson(item);
    return copy as T;
  }
  return value;
}

/**
 * Igualdade estrita de dados JSON: mesmas chaves próprias (inclusive com valor
 * `undefined`), mesmos tipos e mesmos valores, sem depender da ordem das chaves.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  return keysA.every((key) => Object.hasOwn(recordB, key) && jsonEqual(recordA[key], recordB[key]));
}

interface AggregateState {
  currentVersion: number;
  versions: Map<number, EventEnvelope>;
  pending: Map<number, EventEnvelope>;
}

export function createVersionTracker(): VersionTracker {
  const aggregates = new Map<string, AggregateState>();
  const eventsById = new Map<string, EventEnvelope>();

  function register(candidate: unknown): RegisterResult {
    validateEventEnvelope(candidate);
    const event = candidate as EventEnvelope;
    const eventKey = JSON.stringify([event.source, event.event_id]);
    const existingEvent = eventsById.get(eventKey);
    if (existingEvent) {
      ensure(jsonEqual(existingEvent, event), "Mesmo event_id recebido com conteúdo diferente");
      return "duplicate";
    }

    const key = JSON.stringify([event.source, event.aggregate.type, event.aggregate.id]);
    const aggregate = aggregates.get(key) ?? { currentVersion: 0, versions: new Map(), pending: new Map() };
    const version = event.aggregate.version;

    ensure(!aggregate.versions.has(version), `Conflito: aggregate version ${version} já foi registrada`);
    ensure(!aggregate.pending.has(version), `Conflito: aggregate version ${version} já está pendente`);
    ensure(version > aggregate.currentVersion, "Versão antiga ou inválida");

    const result: RegisterResult = version > aggregate.currentVersion + 1 ? "pending" : "accepted";

    // Commit das estruturas somente depois de todas as validações.
    if (!aggregates.has(key)) aggregates.set(key, aggregate);
    eventsById.set(eventKey, cloneJson(event));

    if (result === "pending") {
      aggregate.pending.set(version, cloneJson(event));
      return result;
    }

    aggregate.versions.set(version, cloneJson(event));
    aggregate.currentVersion = version;
    while (aggregate.pending.has(aggregate.currentVersion + 1)) {
      const nextVersion = aggregate.currentVersion + 1;
      const nextEvent = aggregate.pending.get(nextVersion) as EventEnvelope;
      aggregate.pending.delete(nextVersion);
      aggregate.versions.set(nextVersion, nextEvent);
      aggregate.currentVersion = nextVersion;
    }
    return result;
  }

  return { register };
}
