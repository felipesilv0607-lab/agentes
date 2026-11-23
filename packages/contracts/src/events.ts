/**
 * Contrato de eventos do Agente.s (docs/event-contract.md, versão 1.0).
 *
 * Validação do envelope comum. Módulo puro: sem acesso a disco, rede, Node ou
 * Codex. As funções lançam `ContractError` com mensagem descritiva quando o
 * evento é inválido. As regras e mensagens foram extraídas, sem mudança de
 * comportamento, de `scripts/contract.test.mjs`.
 */

export const SCHEMA_VERSION = "1.0";

export const EVENT_TYPES = ["task", "assignment", "execution", "result", "evidence", "review", "blocker"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const REQUIRED_ENVELOPE_FIELDS = [
  "event_id",
  "source",
  "event_type",
  "schema_version",
  "occurred_at",
  "task_id",
  "root_task_id",
  "aggregate",
  "payload",
] as const;

export interface EventAggregate {
  type: EventType;
  id: string;
  version: number;
}

export interface ParentEventRef {
  source: string;
  event_id: string;
  [key: string]: unknown;
}

/** Envelope comum (seção 4 do contrato). */
export interface EventEnvelope {
  event_id: string;
  source: string;
  event_type: EventType;
  schema_version: typeof SCHEMA_VERSION;
  occurred_at: string;
  task_id: string;
  root_task_id: string;
  aggregate: EventAggregate;
  payload: Record<string, unknown>;
  recorded_at?: string;
  actor_agent_id?: string;
  parent_event_ref?: ParentEventRef;
  correlation_id?: string;
  trace_id?: string;
}

/** Erro de validação do contrato. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractError(message);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function daysInMonth(year: number, month: number): number {
  // setUTCFullYear evita o mapeamento de anos 0-99 para 1900-1999 feito por Date.UTC.
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/**
 * Timestamp RFC 3339 com offset explícito e data existente no calendário.
 * `Date.parse` sozinho aceita datas inexistentes (por exemplo, 30 de fevereiro
 * ou 24:00:00), por isso os campos são conferidos um a um. Segundos
 * intercalares (`:60`) não são aceitos.
 */
export function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

// `URL` é global no Node e nos navegadores, mas não faz parte da biblioteca
// ES2022 do TypeScript. O acesso tipado evita depender de `lib.dom` ou `@types/node`.
const UrlConstructor = (globalThis as unknown as { URL: new (input: string, base?: string) => unknown }).URL;

/** URI-reference não vazia, sem espaços (relativa resolvida contra uma base fictícia). */
export function isUriReference(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /\s/.test(value)) return false;
  try {
    new UrlConstructor(value, "https://agente-s.invalid");
    return true;
  } catch {
    return false;
  }
}

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

/** Valida o envelope comum e as regras de identidade do agregado. Lança `ContractError`. */
export function validateEventEnvelope(event: unknown): event is EventEnvelope {
  ensure(isObject(event), "Evento precisa ser um objeto");

  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    ensure(Object.hasOwn(event, field), `Campo obrigatorio ausente: ${field}`);
  }

  ensure(typeof event.event_id === "string", "event_id precisa ser texto");
  ensure(event.event_id.trim().length > 0, "event_id nao pode ser vazio");

  ensure(isUriReference(event.source), "source precisa ser URI-reference valida e nao vazia");
  ensure(isEventType(event.event_type), `Tipo de evento desconhecido: ${String(event.event_type)}`);
  ensure(event.schema_version === SCHEMA_VERSION, `schema_version nao suportada; versao esperada: ${SCHEMA_VERSION}`);

  ensure(typeof event.occurred_at === "string", "occurred_at precisa ser texto");
  ensure(isRfc3339Timestamp(event.occurred_at), "occurred_at precisa seguir RFC 3339 com timezone explicito");

  ensure(typeof event.task_id === "string", "task_id precisa ser texto");
  ensure(event.task_id.trim().length > 0, "task_id nao pode ser vazio");
  ensure(typeof event.root_task_id === "string", "root_task_id precisa ser texto");
  ensure(event.root_task_id.trim().length > 0, "root_task_id nao pode ser vazio");

  const aggregate = event.aggregate;
  ensure(isObject(aggregate), "aggregate precisa ser objeto");
  ensure(isEventType(aggregate.type), "aggregate.type invalido");
  ensure(aggregate.type === event.event_type, "aggregate.type deve corresponder a event_type");
  ensure(typeof aggregate.id === "string", "aggregate.id precisa ser texto");
  ensure(aggregate.id.trim().length > 0, "aggregate.id nao pode ser vazio");
  ensure(
    typeof aggregate.version === "number" && Number.isInteger(aggregate.version) && aggregate.version >= 1,
    "aggregate.version precisa ser inteiro positivo",
  );

  const payload = event.payload;
  ensure(isObject(payload), "payload precisa ser objeto");

  const expectedAggregateId = aggregate.type === "task" ? event.task_id : payload[`${aggregate.type}_id`];
  ensure(aggregate.id === expectedAggregateId, "aggregate.id deve corresponder ao identificador da entidade do evento");

  if (event.event_type === "task") {
    const parentTaskId = payload.parent_task_id;
    if (event.task_id === event.root_task_id) {
      ensure(parentTaskId === undefined, "Tarefa raiz nao pode possuir parent_task_id");
    } else {
      ensure(typeof parentTaskId === "string", "Tarefa filha precisa informar parent_task_id");
      ensure(parentTaskId.trim().length > 0, "parent_task_id nao pode ser vazio");
      ensure(parentTaskId !== event.task_id, "Tarefa nao pode ser pai de si mesma");
    }
  }

  for (const field of ["actor_agent_id", "correlation_id", "trace_id"] as const) {
    if (event[field] !== undefined) ensure(isNonEmptyString(event[field]), `${field} precisa ser texto nao vazio quando presente`);
  }

  if (event.recorded_at !== undefined) {
    ensure(isRfc3339Timestamp(event.recorded_at), "recorded_at precisa seguir RFC 3339 com timezone explicito");
  }

  if (event.parent_event_ref !== undefined) {
    const ref = event.parent_event_ref;
    ensure(isObject(ref), "parent_event_ref precisa ser objeto");
    ensure(isUriReference(ref.source), "parent_event_ref.source precisa ser URI-reference valida");
    ensure(typeof ref.event_id === "string", "parent_event_ref.event_id precisa ser texto");
    ensure(ref.event_id.trim().length > 0, "parent_event_ref.event_id nao pode ser vazio");
  }

  return true;
}
