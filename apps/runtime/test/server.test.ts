import test from "node:test";
import assert from "node:assert/strict";

import { parseAgentsSnapshot } from "../../../packages/contracts/src/index.ts";
import type { RunningRuntime } from "../src/app.ts";
import { auth, collectSse, rawRequest, startTestRuntime, TEST_TOKEN, validEvent } from "./helpers.ts";

let runtime: RunningRuntime;

test.before(async () => {
  runtime = await startTestRuntime({ AGENTES_RUNTIME_ALLOWED_ORIGINS: "http://127.0.0.1:5173" }, { maxSseClients: 2 });
});
test.after(async () => {
  await runtime.close();
});

const get = (path: string, headers: Record<string, string> = auth()) => rawRequest(runtime.port, path, { headers });

test("escuta somente em 127.0.0.1", () => {
  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("/health responde sem autenticação e sem dados internos", async () => {
  const res = await get("/health", {});
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { status: "ok" });
});

test("cabeçalhos de segurança em todas as respostas, inclusive erros", async () => {
  for (const res of [await get("/health", {}), await get("/api/agents", {}), await get("/nao-existe")]) {
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.match(String(res.headers["content-security-policy"]), /default-src 'none'/);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  }
});

test("sem token, token errado ou esquema errado → 401", async () => {
  const cases: Record<string, string>[] = [
    {},
    auth("x".repeat(40)),
    auth(`${TEST_TOKEN}x`),
    auth(TEST_TOKEN.slice(0, -1)),
    { Authorization: `Basic ${TEST_TOKEN}` },
    { Authorization: TEST_TOKEN },
    { Authorization: `Bearer  ${TEST_TOKEN}` },
    { Authorization: `Bearer ${"a".repeat(2000)}` },
  ];
  for (const headers of cases) {
    for (const path of ["/api/agents", "/api/state", "/api/events", "/api/events/stream", "/api/agents/developer"]) {
      const res = await get(path, headers);
      assert.equal(res.status, 401, `${path} ${JSON.stringify(headers).slice(0, 40)}`);
      assert.match(String(res.headers["www-authenticate"]), /^Bearer/);
      assert.ok(!res.body.includes(TEST_TOKEN));
    }
  }
});

test("Host forjado (DNS rebinding) → 403, mesmo com token", async () => {
  for (const host of ["evil.example", `evil.example:${runtime.port}`, "127.0.0.1:1", `127.0.0.1.nip.io:${runtime.port}`, `LOCALHOST.:${runtime.port}`]) {
    const res = await get("/api/agents", { ...auth(), Host: host });
    assert.equal(res.status, 403, host);
  }
  assert.equal((await get("/api/agents", { ...auth(), Host: `localhost:${runtime.port}` })).status, 200);
});

test("Origin não permitida → 403; permitida recebe CORS somente para ela", async () => {
  for (const origin of ["https://evil.example", "null", "http://127.0.0.1:5174", "http://localhost:5173"]) {
    assert.equal((await get("/api/agents", { ...auth(), Origin: origin })).status, 403, origin);
  }
  const ok = await get("/api/agents", { ...auth(), Origin: "http://127.0.0.1:5173" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  assert.equal(ok.headers["access-control-allow-credentials"], undefined);
});

test("preflight: só GET da origem permitida, sem exigir token", async () => {
  const preflight = (origin: string | undefined, method: string) =>
    rawRequest(runtime.port, "/api/state", {
      method: "OPTIONS",
      headers: { ...(origin ? { Origin: origin } : {}), "Access-Control-Request-Method": method },
    });
  const ok = await preflight("http://127.0.0.1:5173", "GET");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers["access-control-allow-methods"], "GET");
  assert.equal(ok.headers["access-control-allow-headers"], "Authorization");
  assert.equal((await preflight("http://127.0.0.1:5173", "POST")).status, 403);
  assert.equal((await preflight(undefined, "GET")).status, 403);
  assert.equal((await preflight("https://evil.example", "GET")).status, 403);
});

test("métodos que alteram estado → 405; corpo de requisição → 400", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "TRACE"]) {
    const res = await rawRequest(runtime.port, "/api/agents", { method, headers: auth() });
    assert.equal(res.status, 405, method);
    if (method !== "HEAD") assert.equal(res.headers.allow, "GET, OPTIONS");
  }
  const withBody = await rawRequest(runtime.port, "/api/agents", { headers: { ...auth(), "Content-Length": "2" }, body: "{}" });
  assert.equal(withBody.status, 400);
});

test("consulta só onde documentada; parâmetros inválidos → 400", async () => {
  assert.equal((await get("/api/agents?x=1")).status, 400);
  assert.equal((await get("/health?x=1", {})).status, 400);
  for (const query of ["limit=0", "limit=501", "limit=abc", "after=-1", "foo=1", "limit=1&limit=2", "after=1e3"]) {
    assert.equal((await get(`/api/events?${query}`)).status, 400, query);
  }
  assert.equal((await get("/api/events?after=0&limit=10")).status, 200);
});

test("GET /api/agents: nove agentes, sem instruções", async () => {
  const res = await get("/api/agents");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body) as { agents: Array<Record<string, unknown>> };
  assert.equal(body.agents.length, 9);
  for (const agent of body.agents) {
    assert.equal(agent.instructions, undefined);
    assert.ok(Array.isArray(agent.writeScope));
  }
  assert.ok(!res.body.includes("ESCOPO DE ESCRITA"), "instruções não podem ser expostas pela API");
});

test("GET /api/agents/:id e rotas inexistentes ou com caminho manipulado", async () => {
  assert.equal(JSON.parse((await get("/api/agents/qa-engineer")).body).agent.accessMode, "tests-only");
  for (const path of ["/api/agents/inexistente", "/api/agents/Developer", "/api/agents/developer/", "/api/x", "/api/agents/__proto__"]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.includes("at "), "sem pilha de erro");
  }
  for (const path of ["/../health", "/api/./agents", "/api/agents/..%2f..%2fetc", "/api/%2e%2e/agents", "//api/agents", "/api/agents/a%5cb"]) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
    assert.ok(!res.body.includes("at "), "sem pilha de erro");
  }
});

test("GET /api/state segue o contrato da API", async () => {
  const res = await get("/api/state");
  const snapshot = parseAgentsSnapshot(JSON.parse(res.body), runtime.catalog.ids);
  assert.equal(snapshot.agents.length, 9);
  assert.ok(snapshot.agents.every((agent) => agent.status === "resting" && agent.currentTask === null));
});

test("GET /api/events lista eventos gravados no Event Store", async () => {
  assert.ok(runtime.events.append(validEvent({ event_id: "srv-1", task_id: "srv", root_task_id: "srv", aggregate: { type: "task", id: "srv", version: 1 } })).ok);
  const body = JSON.parse((await get("/api/events")).body) as { total: number; events: Array<{ event: { event_id: string } }> };
  assert.ok(body.total >= 1);
  assert.ok(body.events.some((stored) => stored.event.event_id === "srv-1"));
});

test("SSE: snapshot inicial, atualização de estado e heartbeat", async () => {
  const result = await collectSse(runtime.port, 3, {
    onOpen: () => setTimeout(() => runtime.state.update("developer", { status: "thinking" }), 10),
  });
  assert.equal(result.status, 200);
  assert.match(String(result.headers["content-type"]), /^text\/event-stream/);
  const [first, ...rest] = result.events;
  assert.equal(first?.event, "agents.snapshot");
  parseAgentsSnapshot(first?.data, runtime.catalog.ids);
  const update = rest.find((e) => e.event === "agents.snapshot");
  assert.ok(update, "atualização de estado deveria ser transmitida");
  assert.equal(parseAgentsSnapshot(update.data, runtime.catalog.ids).agents.find((a) => a.id === "developer")?.status, "thinking");
  runtime.state.update("developer", { status: "resting" });
  const heartbeat = await collectSse(runtime.port, 2, { timeoutMs: 1000 });
  assert.equal(heartbeat.events[1]?.event, "heartbeat");
});

test("SSE: limite de conexões simultâneas → 503", async () => {
  const opened: Promise<unknown>[] = [];
  let openCount = 0;
  const allOpen = new Promise<void>((resolve) => {
    for (let i = 0; i < 2; i++) {
      opened.push(collectSse(runtime.port, 1000, { timeoutMs: 600, onOpen: () => ++openCount === 2 && resolve() }));
    }
  });
  await allOpen;
  const extra = await get("/api/events/stream");
  assert.equal(extra.status, 503);
  await Promise.all(opened);
});

test("encerramento fecha streams abertos", async () => {
  const local = await startTestRuntime();
  const pending = collectSse(local.port, 1000, { timeoutMs: 2000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = Date.now();
  await local.close();
  await pending;
  assert.ok(Date.now() - started < 1500);
});

test("Host ausente ou vazio (requisição crua) é recusado", async () => {
  const { connect } = await import("node:net");
  const send = (raw: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(runtime.port, "127.0.0.1", () => socket.end(raw));
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (data += chunk));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
  const CRLF = "\r\n";
  const token = `Authorization: Bearer ${TEST_TOKEN}${CRLF}`;
  const rejected = /^HTTP\/1\.1 (400|403)/;
  assert.match(await send(`GET /api/agents HTTP/1.1${CRLF}Host: ${CRLF}${token}Connection: close${CRLF}${CRLF}`), rejected);
  assert.match(await send(`GET /api/agents HTTP/1.0${CRLF}${token}${CRLF}`), rejected);
  assert.match(await send(`GET /api/agents HTTP/1.1${CRLF}${token}Connection: close${CRLF}${CRLF}`), rejected);
});

test("SSE: cliente que não lê é desconectado ao exceder o buffer (revisão do Bloco 2)", async () => {
  const local = await startTestRuntime({}, { heartbeatMs: 60_000 });
  try {
    const { request } = await import("node:http");
    const opened = new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: local.port, path: "/api/events/stream", headers: { Host: `127.0.0.1:${local.port}`, ...auth() } }, (res) => {
        res.pause(); // nunca consome os dados
        resolve(res);
      });
      req.on("error", () => undefined);
      req.end();
      setTimeout(() => reject(new Error("stream não abriu")), 2000);
    });
    const res = await opened;
    assert.equal(local.activeStreams(), 1);
    for (let i = 0; i < 20_000 && local.activeStreams() > 0; i++) {
      local.state.update("developer", { status: i % 2 ? "working" : "thinking", currentTask: `tarefa ${i} ${"x".repeat(400)}` });
      if (i % 500 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(local.activeStreams(), 0, "stream de cliente parado deveria ser encerrado");
    // Revisão independente (B1): não basta liberar a vaga; a conexão precisa ser
    // destruída no servidor, mesmo com o cliente ainda parado (sem ler nem fechar).
    let open = await local.openConnections();
    for (let attempt = 0; open > 0 && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      open = await local.openConnections();
    }
    assert.equal(open, 0, "a conexão do cliente parado deveria ter sido destruída pelo servidor");
    res.destroy();
  } finally {
    await local.close();
  }
});

test("limite de conexões TCP: excedente é encerrado sem resposta; vaga liberada volta a aceitar (revisão)", async () => {
  const { connect } = await import("node:net");
  const local = await startTestRuntime({}, { maxConnections: 3 });
  const sockets: import("node:net").Socket[] = [];
  /** Abre conexão keep-alive e resolve com o texto recebido: na primeira resposta completa ou no fechamento. */
  const openAndRequest = () =>
    new Promise<{ socket: import("node:net").Socket; text: string; closed: boolean }>((resolve) => {
      const socket = connect(local.port, "127.0.0.1");
      sockets.push(socket);
      let text = "";
      let done = false;
      const finish = (closed: boolean) => {
        if (done) return;
        done = true;
        resolve({ socket, text, closed });
      };
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        text += chunk;
        if (text.includes('{"status":"ok"}')) finish(false);
      });
      socket.on("close", () => finish(true));
      socket.on("error", () => finish(true));
      socket.on("connect", () => socket.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${local.port}\r\nConnection: keep-alive\r\n\r\n`));
    });
  try {
    const accepted = [await openAndRequest(), await openAndRequest(), await openAndRequest()];
    for (const r of accepted) assert.match(r.text, /^HTTP\/1\.1 200/);
    const rejected = await openAndRequest();
    assert.equal(rejected.closed, true);
    assert.doesNotMatch(rejected.text, /HTTP\/1\.1/, "conexão excedente não pode receber resposta");
    accepted[0]?.socket.destroy();
    let retried = await openAndRequest();
    for (let attempt = 0; retried.closed && attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      retried = await openAndRequest();
    }
    assert.match(retried.text, /^HTTP\/1\.1 200/, "vaga liberada deveria aceitar nova conexão");
  } finally {
    for (const socket of sockets) socket.destroy();
    await local.close();
  }
});

test("alvo de requisição fora da forma de origem → 400 (revisão)", async () => {
  const { connect } = await import("node:net");
  const send = (target: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(runtime.port, "127.0.0.1", () =>
        socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${runtime.port}\r\nAuthorization: Bearer ${TEST_TOKEN}\r\nConnection: close\r\n\r\n`),
      );
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (data += chunk));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
  assert.match(await send(`http://127.0.0.1:${runtime.port}/api/agents`), /^HTTP\/1\.1 400/);
  assert.match(await send("*"), /^HTTP\/1\.1 400/);
  assert.match(await send(`/${"a".repeat(2100)}`), /^HTTP\/1\.1 414/);
});

// ---------------------------------------------------------------------------
// Revisão independente (fechamento dos Blocos 1 e 2)
// ---------------------------------------------------------------------------

function rawSend(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    import("node:net").then(({ connect }) => {
      const socket = connect(port, "127.0.0.1", () => socket.end(raw));
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (data += chunk));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    }, reject);
  });
}

test("URL que o parser rejeita responde 400, não 500 (revisão B2)", async () => {
  const CRLF = "\r\n";
  const out = await rawSend(runtime.port, `GET //[ HTTP/1.1${CRLF}Host: 127.0.0.1:${runtime.port}${CRLF}Connection: close${CRLF}${CRLF}`);
  assert.match(out, /^HTTP\/1\.1 400/);
  assert.doesNotMatch(out, /internal-error/);
});

test("excesso de cabeçalhos é recusado com 431, sem truncar checagens (revisão B3)", async () => {
  const CRLF = "\r\n";
  const filler = Array.from({ length: 70 }, (_, n) => `X-Filler-${n}: x${CRLF}`).join("");
  const withOrigin = await rawSend(runtime.port, `GET /api/agents HTTP/1.1${CRLF}Host: 127.0.0.1:${runtime.port}${CRLF}Authorization: Bearer ${TEST_TOKEN}${CRLF}${filler}Origin: https://evil.example${CRLF}Connection: close${CRLF}${CRLF}`);
  assert.match(withOrigin, /^HTTP\/1\.1 431/);
  const withBody = await rawSend(runtime.port, `GET /api/agents HTTP/1.1${CRLF}Host: 127.0.0.1:${runtime.port}${CRLF}Authorization: Bearer ${TEST_TOKEN}${CRLF}${filler}Content-Length: 5${CRLF}Connection: close${CRLF}${CRLF}hello`);
  assert.match(withBody, /^HTTP\/1\.1 431/);
});

test("Host, Origin ou Authorization duplicados são recusados (revisão B4)", async () => {
  const CRLF = "\r\n";
  const base = `GET /api/agents HTTP/1.1${CRLF}Host: 127.0.0.1:${runtime.port}${CRLF}Authorization: Bearer ${TEST_TOKEN}${CRLF}`;
  assert.match(await rawSend(runtime.port, `${base}Host: evil.example${CRLF}Connection: close${CRLF}${CRLF}`), /^HTTP\/1\.1 400/);
  assert.match(await rawSend(runtime.port, `${base}Origin: http://127.0.0.1:5173${CRLF}Origin: https://evil.example${CRLF}Connection: close${CRLF}${CRLF}`), /^HTTP\/1\.1 400/);
  assert.match(await rawSend(runtime.port, `${base}Authorization: Bearer outro${CRLF}Connection: close${CRLF}${CRLF}`), /^HTTP\/1\.1 400/);
  assert.match(await rawSend(runtime.port, `${base}Connection: close${CRLF}${CRLF}`), /^HTTP\/1\.1 200/);
});

test("preflight com caminho não canônico é recusado (revisão B5)", async () => {
  const res = await rawRequest(runtime.port, "/nada/../x", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173", "Access-Control-Request-Method": "GET" } });
  assert.equal(res.status, 400);
});
