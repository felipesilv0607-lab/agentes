/**
 * Configuração do runtime, lida de variáveis de ambiente e validada antes de
 * qualquer recurso ser aberto (falha fechada).
 *
 * - AGENTES_RUNTIME_TOKEN            obrigatório; 32 a 512 caracteres visíveis (sem espaços)
 * - AGENTES_RUNTIME_HOST             127.0.0.1 (padrão) ou ::1; nesta etapa só loopback
 * - AGENTES_RUNTIME_PORT             1 a 65535 (padrão 8787); 0 só em testes
 * - AGENTES_RUNTIME_ALLOWED_ORIGINS  origens do navegador permitidas, separadas por vírgula
 *                                    (padrão http://127.0.0.1:5173); só http(s) em loopback
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 8787;
export const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173"];
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;
export const MIN_TOKEN_LENGTH = 32;
export const MAX_TOKEN_LENGTH = 512;

export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

export interface RuntimeConfig {
  /** Raiz do repositório, de onde o catálogo neutro é lido (somente leitura). */
  repoRoot: string;
  host: LoopbackHost;
  port: number;
  /** Nunca registrar nem devolver em respostas. */
  token: string;
  allowedOrigins: readonly string[];
  /** Isolamento (Arquitetura B). Sempre desativado nesta etapa: não é configurável por ambiente. */
  isolationEnabled: false;
  heartbeatMs: number;
  maxSseClients: number;
  maxEvents: number;
  /** Conexões TCP simultâneas (inclui não autenticadas). */
  maxConnections: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function parseToken(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) {
    throw new ConfigError("AGENTES_RUNTIME_TOKEN é obrigatório (gere com: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\")");
  }
  if (raw.length < MIN_TOKEN_LENGTH || raw.length > MAX_TOKEN_LENGTH) {
    throw new ConfigError(`AGENTES_RUNTIME_TOKEN precisa ter entre ${MIN_TOKEN_LENGTH} e ${MAX_TOKEN_LENGTH} caracteres`);
  }
  if (!/^[\x21-\x7e]+$/.test(raw)) throw new ConfigError("AGENTES_RUNTIME_TOKEN só pode conter caracteres ASCII visíveis, sem espaços");
  if (new Set(raw).size < 8) throw new ConfigError("AGENTES_RUNTIME_TOKEN tem pouca variedade de caracteres");
  return raw;
}

function parseHost(raw: string | undefined): LoopbackHost {
  const host = raw ?? "127.0.0.1";
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) {
    throw new ConfigError(`AGENTES_RUNTIME_HOST precisa ser loopback (${LOOPBACK_HOSTS.join(" ou ")}); exposição em rede exige etapa própria (VPS)`);
  }
  return host as LoopbackHost;
}

function parsePort(raw: string | undefined, allowEphemeral: boolean): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw)) throw new ConfigError("AGENTES_RUNTIME_PORT inválida");
  const port = Number(raw);
  if (port > 65535 || (port === 0 && !allowEphemeral)) throw new ConfigError("AGENTES_RUNTIME_PORT fora do intervalo 1-65535");
  return port;
}

/** Origem exata `http(s)://<loopback>:<porta>`, sem caminho, credenciais, consulta ou curinga. */
export function parseOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`origem inválida: ${raw}`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !loopback ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.origin !== raw
  ) {
    throw new ConfigError(`origem não permitida (somente http(s) em loopback, sem caminho): ${raw}`);
  }
  return url.origin;
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_ALLOWED_ORIGINS];
  const entries = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return [...new Set(entries.map(parseOrigin))];
}

export interface LoadConfigOptions {
  repoRoot?: string;
  /** Permite porta 0 (efêmera). Usado somente pelos testes. */
  allowEphemeralPort?: boolean;
  heartbeatMs?: number;
  maxSseClients?: number;
  maxConnections?: number;
  maxEvents?: number;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>, options: LoadConfigOptions = {}): RuntimeConfig {
  return Object.freeze({
    repoRoot: options.repoRoot ?? DEFAULT_REPO_ROOT,
    host: parseHost(env.AGENTES_RUNTIME_HOST),
    port: parsePort(env.AGENTES_RUNTIME_PORT, options.allowEphemeralPort === true),
    token: parseToken(env.AGENTES_RUNTIME_TOKEN),
    allowedOrigins: Object.freeze(parseOrigins(env.AGENTES_RUNTIME_ALLOWED_ORIGINS)),
    isolationEnabled: false as const,
    heartbeatMs: options.heartbeatMs ?? 15_000,
    maxSseClients: options.maxSseClients ?? 16,
    maxConnections: options.maxConnections ?? 128,
    maxEvents: options.maxEvents ?? 10_000,
  });
}
