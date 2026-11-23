import test from "node:test";
import assert from "node:assert/strict";

import { ConfigError, DEFAULT_ALLOWED_ORIGINS, DEFAULT_PORT, loadConfig } from "../src/config.ts";
import { TEST_TOKEN } from "./helpers.ts";

const env = (overrides: Record<string, string | undefined> = {}) => ({ AGENTES_RUNTIME_TOKEN: TEST_TOKEN, ...overrides });

test("configuração padrão: loopback, porta padrão, origem do Vite e isolamento desativado", () => {
  const config = loadConfig(env());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, DEFAULT_PORT);
  assert.deepEqual(config.allowedOrigins, DEFAULT_ALLOWED_ORIGINS);
  assert.equal(config.isolationEnabled, false);
  assert.ok(Object.isFrozen(config));
});

test("token ausente, curto, longo, com espaço ou de baixa variedade impede o início", () => {
  for (const token of [undefined, "", "curto", "x".repeat(513), `${"a".repeat(20)} ${"b".repeat(20)}`, "ab".repeat(20), `${"á".repeat(40)}`]) {
    assert.throws(() => loadConfig({ AGENTES_RUNTIME_TOKEN: token }), ConfigError, String(token));
  }
});

test("a mensagem de erro de configuração nunca contém o token", () => {
  const leaked = "segredo segredo segredo segredo segredo";
  try {
    loadConfig({ AGENTES_RUNTIME_TOKEN: leaked });
    assert.fail("deveria falhar");
  } catch (error) {
    assert.ok(!(error as Error).message.includes(leaked));
  }
});

test("somente endereços de loopback são aceitos para escuta", () => {
  assert.equal(loadConfig(env({ AGENTES_RUNTIME_HOST: "::1" })).host, "::1");
  for (const host of ["0.0.0.0", "::", "192.168.0.10", "localhost", "example.com", "127.0.0.2"]) {
    assert.throws(() => loadConfig(env({ AGENTES_RUNTIME_HOST: host })), /loopback/, host);
  }
});

test("porta inválida é recusada; porta 0 só com opção explícita de teste", () => {
  for (const port of ["abc", "-1", "65536", "8080.5", "0x50", "0"]) {
    assert.throws(() => loadConfig(env({ AGENTES_RUNTIME_PORT: port })), ConfigError, port);
  }
  assert.equal(loadConfig(env({ AGENTES_RUNTIME_PORT: "0" }), { allowEphemeralPort: true }).port, 0);
});

test("origens permitidas: somente http(s) em loopback, exatas e sem curinga", () => {
  const ok = loadConfig(env({ AGENTES_RUNTIME_ALLOWED_ORIGINS: "http://127.0.0.1:5173, http://localhost:4173,http://127.0.0.1:5173" }));
  assert.deepEqual(ok.allowedOrigins, ["http://127.0.0.1:5173", "http://localhost:4173"]);
  for (const origin of ["*", "null", "https://example.com", "http://127.0.0.1:5173/", "http://127.0.0.1:5173/app", "http://user@127.0.0.1:5173", "file://x", "http://192.168.0.2:5173", "http://127.0.0.1.nip.io:5173"]) {
    assert.throws(() => loadConfig(env({ AGENTES_RUNTIME_ALLOWED_ORIGINS: origin })), ConfigError, origin);
  }
});

test("isolamento não pode ser ativado por variável de ambiente", () => {
  assert.equal(loadConfig(env({ AGENTES_RUNTIME_ISOLATION: "true" } as Record<string, string>)).isolationEnabled, false);
});
