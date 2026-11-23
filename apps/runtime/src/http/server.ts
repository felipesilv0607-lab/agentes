/**
 * API local do runtime: REST + SSE, somente leitura nesta etapa.
 *
 * Defesas (ordem de aplicação):
 * 1. cabeçalhos de segurança em todas as respostas;
 * 2. `Host` precisa ser o endereço de loopback da porta em uso (anti DNS rebinding);
 * 3. `Origin`, quando presente, precisa estar na lista configurada (CORS só para ela);
 * 4. somente GET (e OPTIONS de preflight); corpo de requisição é recusado;
 * 5. token Bearer obrigatório (comparação em tempo constante), exceto em /health;
 * 6. consulta (query) só onde documentada, com validação estrita.
 *
 * Rotas:
 *   GET /health                     sem autenticação; não revela dados
 *   GET /api/agents                 metadados públicos do catálogo (sem instruções)
 *   GET /api/agents/:id             idem, um agente
 *   GET /api/state                  AgentsSnapshotDto (packages/contracts)
 *   GET /api/events?after=&limit=   eventos gravados no Event Store
 *   GET /api/events/stream          SSE: `agents.snapshot` e `heartbeat`
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { SSE_EVENT_NAMES } from "../../../../packages/contracts/src/index.ts";
import type { RuntimeCatalog } from "../catalog.ts";
import type { RuntimeConfig } from "../config.ts";
import type { EventStore } from "../events/eventStore.ts";
import { MAX_LIST_LIMIT } from "../events/eventStore.ts";
import type { AgentStateStore } from "../state/agentState.ts";

export interface HttpDependencies {
  config: RuntimeConfig;
  catalog: RuntimeCatalog;
  events: EventStore;
  state: AgentStateStore;
}

export interface RuntimeHttpServer {
  server: Server;
  /** Encerra streams SSE e conexões abertas. */
  closeStreams(): void;
  activeStreams(): number;
}

const MAX_URL_LENGTH = 2048;
const MAX_AUTH_HEADER_LENGTH = 1024;
/** Máximo de cabeçalhos aceitos; acima disso a requisição é recusada com 431. */
export const MAX_HEADER_COUNT = 64;
/** Cabeçalhos que não podem aparecer repetidos (o Node manteria só o primeiro). */
const SINGLE_HEADERS = new Set(["host", "origin", "authorization", "content-length", "transfer-encoding"]);
/** Limite do buffer de saída de um stream SSE antes de encerrá-lo (cliente lento ou parado). */
export const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const AGENT_ROUTE = /^\/api\/agents\/([a-z][a-z0-9-]{0,63})$/;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-site",
  "Cache-Control": "no-store",
};

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

const sendError = (res: ServerResponse, status: number, error: string, extraHeaders: Record<string, string> = {}): void =>
  sendJson(res, status, { error }, extraHeaders);

function publicAgent(agent: RuntimeCatalog["agents"][number]) {
  const { instructions: _instructions, ...metadata } = agent;
  return metadata;
}

function parseEventQuery(search: URLSearchParams): { after: number; limit: number } | null {
  let after = 0;
  let limit = 100;
  for (const [key, value] of search) {
    if (!/^\d{1,9}$/.test(value)) return null;
    if (key === "after") after = Number(value);
    else if (key === "limit" && Number(value) >= 1 && Number(value) <= MAX_LIST_LIMIT) limit = Number(value);
    else return null;
  }
  if ([...search.keys()].length !== new Set(search.keys()).size) return null;
  return { after, limit };
}

export function createRuntimeHttpServer(deps: HttpDependencies): RuntimeHttpServer {
  const { config, catalog, events, state } = deps;
  const tokenDigest = createHash("sha256").update(config.token, "utf8").digest();
  const streams = new Set<() => void>();
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 });
  // O Node trunca cabeçalhos acima de maxHeadersCount; com o dobro do limite
  // aceito, um excesso fica visível em rawHeaders e é recusado (431).
  server.maxHeadersCount = MAX_HEADER_COUNT * 2;
  // Conexões além do limite são encerradas pelo Node ao serem aceitas (sem resposta HTTP).
  server.maxConnections = config.maxConnections;

  function allowedHosts(): Set<string> {
    const port = (server.address() as AddressInfo | null)?.port;
    return new Set(["127.0.0.1", "localhost", "[::1]"].map((host) => `${host}:${port}`));
  }

  function isAuthorized(header: string | undefined): boolean {
    if (typeof header !== "string" || header.length > MAX_AUTH_HEADER_LENGTH) return false;
    const match = /^Bearer ([\x21-\x7e]+)$/i.exec(header);
    if (!match) return false;
    const candidate = createHash("sha256").update(match[1] as string, "utf8").digest();
    return timingSafeEqual(candidate, tokenDigest);
  }

  function openStream(req: IncomingMessage, res: ServerResponse): void {
    if (streams.size >= config.maxSseClients) return sendError(res, 503, "too-many-streams", { "Retry-After": "5" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown): void => {
      if (closed) return;
      // Cliente que não lê: o buffer de saída não cresce sem limite; o stream é encerrado.
      if (res.writableLength > MAX_SSE_BUFFER_BYTES) return close(true);
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let closed = false;
    res.write("retry: 5000\n\n");
    send(SSE_EVENT_NAMES.agentsSnapshot, state.snapshot());
    const unsubscribe = state.subscribe((snapshot) => send(SSE_EVENT_NAMES.agentsSnapshot, snapshot));
    const heartbeat = setInterval(() => send(SSE_EVENT_NAMES.heartbeat, { at: new Date().toISOString() }), config.heartbeatMs);
    heartbeat.unref();
    function close(destroy = false): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(closeStream);
      // Cliente parado: o buffer pendente não pode ficar retido; a conexão é destruída.
      if (destroy) res.destroy();
      else if (!res.writableEnded) res.end();
    }
    const closeStream = (): void => close(false);
    streams.add(closeStream);
    req.on("close", closeStream);
    res.on("error", () => close(true));
  }

  function route(req: IncomingMessage, res: ServerResponse): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    if (req.rawHeaders.length / 2 > MAX_HEADER_COUNT) return sendError(res, 431, "too-many-headers");
    const seen = new Set<string>();
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = (req.rawHeaders[index] as string).toLowerCase();
      if (SINGLE_HEADERS.has(name)) {
        if (seen.has(name)) return sendError(res, 400, "duplicate-header");
        seen.add(name);
      }
    }

    const host = req.headers.host?.toLowerCase();
    if (!host || !allowedHosts().has(host)) return sendError(res, 403, "host-not-allowed");

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!config.allowedOrigins.includes(origin)) return sendError(res, 403, "origin-not-allowed");
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    const rawUrl = req.url ?? "";
    if (rawUrl.length > MAX_URL_LENGTH) return sendError(res, 414, "url-too-long");
    if (!rawUrl.startsWith("/")) return sendError(res, 400, "invalid-request-target");
    let url: URL;
    try {
      url = new URL(rawUrl, "http://runtime.invalid");
    } catch {
      return sendError(res, 400, "invalid-request-target");
    }
    const path = url.pathname;
    // Recusa caminhos não canônicos (`/../x`, `/a/./b`, `%2e%2e`, `//x`): o caminho
    // recebido precisa ser exatamente o caminho normalizado. Vale também para OPTIONS.
    const rawPath = rawUrl.split(/[?#]/, 1)[0];
    if (rawPath !== path || /%2e|%2f|%5c/i.test(rawPath) || path.includes("//")) return sendError(res, 400, "non-canonical-path");
    const hasQuery = url.search.length > 0;

    if (req.method === "OPTIONS") {
      if (origin === undefined || req.headers["access-control-request-method"] !== "GET") return sendError(res, 403, "preflight-not-allowed");
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Max-Age": "600",
      });
      return void res.end();
    }
    if (req.method !== "GET") return sendError(res, 405, "method-not-allowed", { Allow: "GET, OPTIONS" });

    const contentLength = req.headers["content-length"];
    if ((contentLength !== undefined && contentLength !== "0") || req.headers["transfer-encoding"] !== undefined) {
      return sendError(res, 400, "body-not-allowed");
    }

    if (path === "/health") {
      if (hasQuery) return sendError(res, 400, "query-not-allowed");
      return sendJson(res, 200, { status: "ok" });
    }

    if (!isAuthorized(req.headers.authorization)) {
      return sendError(res, 401, "unauthorized", { "WWW-Authenticate": 'Bearer realm="agentes-runtime"' });
    }

    if (path === "/api/events") {
      const query = parseEventQuery(url.searchParams);
      if (!query) return sendError(res, 400, "invalid-query");
      return sendJson(res, 200, { total: events.size(), events: events.list(query) });
    }
    if (hasQuery) return sendError(res, 400, "query-not-allowed");

    if (path === "/api/agents") return sendJson(res, 200, { agents: catalog.agents.map(publicAgent) });
    if (path === "/api/state") return sendJson(res, 200, state.snapshot());
    if (path === "/api/events/stream") return openStream(req, res);

    const agentMatch = AGENT_ROUTE.exec(path);
    if (agentMatch) {
      const agent = catalog.get(agentMatch[1] as string);
      return agent ? sendJson(res, 200, { agent: publicAgent(agent) }) : sendError(res, 404, "agent-not-found");
    }
    return sendError(res, 404, "not-found");
  }

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    try {
      route(req, res);
    } catch {
      // Sem detalhes na resposta: nada de pilha, caminhos ou configuração.
      if (!res.headersSent) sendError(res, 500, "internal-error");
      else res.destroy();
    }
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    else socket.destroy();
  });

  return {
    server,
    closeStreams(): void {
      for (const close of [...streams]) close();
    },
    activeStreams: () => streams.size,
  };
}
