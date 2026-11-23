/**
 * Contrato da API do runtime para o dashboard (REST + SSE), versão 1.0.
 *
 * Define somente o estado observável dos agentes; não inclui instruções,
 * prompts, respostas de modelos nem argumentos de ferramentas. Módulo puro.
 *
 * - `GET /api/state` → `AgentsSnapshotDto` (rota própria, sem colidir com `/api/agents/:id`)
 * - SSE `GET /api/events/stream` → evento `agents.snapshot` (dados: `AgentsSnapshotDto`)
 *   e `heartbeat` (sem dados úteis).
 *
 * O consumidor DEVE validar os dados com `parseAgentsSnapshot` antes de usá-los:
 * a resposta do runtime é tratada como entrada não confiável.
 */

import { ensure, isObject, isRfc3339Timestamp } from "./events.ts";

export const API_SCHEMA_VERSION = "1.0";

export const AGENT_STATUSES = ["working", "thinking", "waiting", "paused", "resting", "completed", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const SSE_EVENT_NAMES = {
  agentsSnapshot: "agents.snapshot",
  heartbeat: "heartbeat",
} as const;

/** Limite do texto de tarefa exibido, para evitar respostas desproporcionais. */
export const MAX_TASK_SUMMARY_LENGTH = 500;

export interface AgentStateDto {
  id: string;
  status: AgentStatus;
  /** Resumo curto da tarefa atual, ou `null`. Texto simples, nunca HTML. */
  currentTask: string | null;
  /** Momento da última atividade observada (RFC 3339), ou `null` se nunca houve. */
  lastActivityAt: string | null;
}

export interface AgentsSnapshotDto {
  schemaVersion: typeof API_SCHEMA_VERSION;
  /** Origem dos dados. O runtime nunca declara `demo`. */
  source: "runtime";
  updatedAt: string;
  agents: AgentStateDto[];
}

const SNAPSHOT_KEYS = ["schemaVersion", "source", "updatedAt", "agents"];
const AGENT_KEYS = ["id", "status", "currentTask", "lastActivityAt"];

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) ensure(allowed.includes(key), `${where}: chave desconhecida: ${key}`);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Valida e devolve uma cópia do snapshot. `knownAgentIds` restringe os ids
 * aceitos aos do catálogo. Lança `ContractError` diante de qualquer desvio.
 */
export function parseAgentsSnapshot(value: unknown, knownAgentIds: readonly string[]): AgentsSnapshotDto {
  ensure(isObject(value), "snapshot precisa ser objeto");
  rejectUnknownKeys(value, SNAPSHOT_KEYS, "snapshot");
  ensure(value.schemaVersion === API_SCHEMA_VERSION, `snapshot: schemaVersion não suportada: ${String(value.schemaVersion)}`);
  ensure(value.source === "runtime", "snapshot: source precisa ser runtime");
  ensure(isRfc3339Timestamp(value.updatedAt), "snapshot: updatedAt precisa seguir RFC 3339");
  ensure(Array.isArray(value.agents), "snapshot: agents precisa ser lista");
  ensure(value.agents.length <= knownAgentIds.length, "snapshot: mais agentes do que o catálogo");

  const seen = new Set<string>();
  const agents = value.agents.map((raw: unknown, index: number): AgentStateDto => {
    ensure(isObject(raw), `snapshot: agente na posição ${index} precisa ser objeto`);
    rejectUnknownKeys(raw, AGENT_KEYS, `snapshot: agente na posição ${index}`);
    const id = raw.id;
    ensure(typeof id === "string" && knownAgentIds.includes(id), `snapshot: agente desconhecido: ${String(id)}`);
    ensure(!seen.has(id), `snapshot: agente duplicado: ${id}`);
    seen.add(id);
    ensure(isAgentStatus(raw.status), `snapshot: status inválido em ${id}`);
    const task = raw.currentTask;
    ensure(
      task === null ||
        (typeof task === "string" && task.length > 0 && task.length <= MAX_TASK_SUMMARY_LENGTH && !/[\0-\x1f\x7f]/.test(task)),
      `snapshot: currentTask inválida em ${id}`,
    );
    ensure(raw.lastActivityAt === null || isRfc3339Timestamp(raw.lastActivityAt), `snapshot: lastActivityAt inválido em ${id}`);
    return { id, status: raw.status, currentTask: task as string | null, lastActivityAt: raw.lastActivityAt as string | null };
  });

  return { schemaVersion: API_SCHEMA_VERSION, source: "runtime", updatedAt: value.updatedAt, agents };
}
