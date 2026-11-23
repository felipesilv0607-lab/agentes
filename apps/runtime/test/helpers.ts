import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";

import { startRuntime } from "../src/app.ts";
import type { RunningRuntime } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { LoadConfigOptions } from "../src/config.ts";

export const TEST_TOKEN = "teste-token-local-0123456789abcdefghijklmnopqrstuv";

export async function startTestRuntime(env: Record<string, string> = {}, options: LoadConfigOptions = {}): Promise<RunningRuntime> {
  const config = loadConfig(
    { AGENTES_RUNTIME_TOKEN: TEST_TOKEN, AGENTES_RUNTIME_PORT: "0", ...env },
    { allowEphemeralPort: true, heartbeatMs: 50, ...options },
  );
  return startRuntime(config);
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Requisição HTTP crua (permite forjar Host, Origin e métodos). */
export function rawRequest(
  port: number,
  path: string,
  { method = "GET", headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const auth = (token = TEST_TOKEN): Record<string, string> => ({ Authorization: `Bearer ${token}` });

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Abre um stream SSE e coleta eventos até `count` ou até o tempo-limite. */
export function collectSse(
  port: number,
  count: number,
  { headers = auth(), timeoutMs = 3000, onOpen }: { headers?: Record<string, string>; timeoutMs?: number; onOpen?: () => void } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; events: SseEvent[] }> {
  return new Promise((resolve, reject) => {
    const events: SseEvent[] = [];
    const req = request({ host: "127.0.0.1", port, path: "/api/events/stream", headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let buffer = "";
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        req.destroy();
        resolve({ status: res.statusCode ?? 0, headers: res.headers, events });
      };
      const timer = setTimeout(finish, timeoutMs);
      if (res.statusCode !== 200) {
        res.resume();
        res.on("end", finish);
        return;
      }
      onOpen?.();
      res.setEncoding("utf8");
      res.on("end", finish);
      res.on("close", finish);
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
          if (events.length >= count) return finish();
        }
      });
    });
    req.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
    req.end();
  });
}

export const validEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  event_id: "event-1",
  source: "urn:agentes:test",
  event_type: "task",
  schema_version: "1.0",
  occurred_at: "2026-11-23T10:00:00Z",
  task_id: "task-1",
  root_task_id: "task-1",
  aggregate: { type: "task", id: "task-1", version: 1 },
  payload: { state: "planned" },
  ...overrides,
});
