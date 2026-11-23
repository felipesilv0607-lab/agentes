/**
 * Event Store em memória, somente de acréscimo (append-only).
 *
 * Cada evento é validado pelo contrato (`packages/contracts`) antes de ser
 * aceito; reentregas idênticas são ignoradas e conflitos são rejeitados sem
 * alterar o estado. Há limite de capacidade: ao atingi-lo, novos eventos são
 * recusados (falha fechada), nunca descartados em silêncio. A interface é a
 * mesma que uma futura implementação em PostgreSQL deverá cumprir.
 */

import { cloneJson, ContractError, createVersionTracker } from "../../../../packages/contracts/src/index.ts";
import type { EventEnvelope, RegisterResult } from "../../../../packages/contracts/src/index.ts";

export interface StoredEvent {
  /** Sequência local (1, 2, 3…), na ordem de gravação. */
  sequence: number;
  /** Momento da gravação pelo runtime (RFC 3339, UTC). */
  recordedAt: string;
  /**
   * Resultado NO MOMENTO DA GRAVAÇÃO: `pending` quando a versão chegou fora de
   * ordem. O registro é imutável e não é atualizado quando a lacuna é preenchida;
   * o estado atual do agregado é a maior versão contígua gravada.
   */
  status: "accepted" | "pending";
  event: EventEnvelope;
}

export type AppendResult =
  | { ok: true; result: RegisterResult; stored: StoredEvent | null }
  | { ok: false; error: string };

export interface EventStore {
  append(event: unknown): AppendResult;
  list(options?: { after?: number; limit?: number }): StoredEvent[];
  size(): number;
  subscribe(listener: (stored: StoredEvent) => void): () => void;
}

export const MAX_LIST_LIMIT = 500;
/** Tamanho máximo de um evento serializado: impede que um produtor esgote a memória com poucos eventos. */
export const MAX_EVENT_BYTES = 64 * 1024;

export function createInMemoryEventStore(options: { maxEvents: number; now?: () => Date }): EventStore {
  const tracker = createVersionTracker();
  const events: StoredEvent[] = [];
  const listeners = new Set<(stored: StoredEvent) => void>();
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    append(candidate: unknown): AppendResult {
      if (events.length >= options.maxEvents) return { ok: false, error: "capacidade do Event Store atingida" };
      // O objeto recebido é lido UMA vez (JSON.stringify); tudo o mais usa a cópia
      // reconstruída: o que é medido, validado, deduplicado e gravado é o mesmo dado.
      // Getters, toJSON, NaN/Infinity e objetos não JSON não conseguem divergir.
      let serialized: string | undefined;
      let parsed: unknown;
      try {
        serialized = JSON.stringify(candidate);
        if (serialized === undefined) return { ok: false, error: "evento ausente ou não serializável como JSON" };
        if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_BYTES) return { ok: false, error: `evento maior que ${MAX_EVENT_BYTES} bytes` };
        parsed = JSON.parse(serialized);
      } catch {
        return { ok: false, error: "evento não serializável como JSON" };
      }
      // Preparar tudo o que pode falhar ANTES de registrar no tracker (que memoriza o evento).
      let stored: StoredEvent;
      try {
        stored = Object.freeze({ sequence: events.length + 1, recordedAt: now().toISOString(), status: "accepted" as const, event: cloneJson(parsed as EventEnvelope) });
      } catch {
        return { ok: false, error: "evento não pôde ser copiado" };
      }
      let result: RegisterResult;
      try {
        result = tracker.register(parsed);
      } catch (error) {
        return { ok: false, error: error instanceof ContractError ? error.message : "evento inválido" };
      }
      if (result === "duplicate") return { ok: true, result, stored: null };
      stored = Object.freeze({ ...stored, status: result });
      events.push(stored);
      for (const listener of listeners) {
        try {
          listener(cloneJson(stored));
        } catch {
          // Um assinante com erro não interrompe a gravação nem os demais assinantes.
        }
      }
      return { ok: true, result, stored: cloneJson(stored) };
    },

    list({ after = 0, limit = 100 } = {}): StoredEvent[] {
      const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIST_LIMIT);
      const start = Math.max(0, Math.trunc(after));
      return events.slice(start, start + safeLimit).map((stored) => cloneJson(stored));
    },

    size: () => events.length,

    subscribe(listener: (stored: StoredEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
