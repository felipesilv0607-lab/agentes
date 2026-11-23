/**
 * Catálogo neutro dos agentes do Agente.s: tipos e validação.
 *
 * Fonte única: `packages/agent-catalog/agents.json` (metadados) e
 * `packages/agent-catalog/instructions/<id>.md` (instruções). Este módulo é
 * puro (sem acesso a disco, rede ou APIs do Node) e não depende do Codex.
 *
 * O catálogo descreve papéis e permissões DECLARADAS. Ele não é, sozinho, um
 * controle técnico: a aplicação das permissões cabe ao Permission Engine do
 * runtime (Bloco 2) e ao isolamento da Arquitetura B (Bloco 6).
 */

export const CATALOG_SCHEMA_VERSION = 1;

export const AGENT_TEAMS = ["planning", "build", "quality", "knowledge"] as const;
export type AgentTeam = (typeof AGENT_TEAMS)[number];

/**
 * - read-only: não altera arquivos.
 * - workspace-write: altera arquivos dentro do escopo autorizado pela tarefa.
 * - tests-only: somente testes e fixtures autorizados.
 * - ci-cd-without-publish: somente workflows de CI/CD, sem publicar.
 * - docs-only: somente documentação.
 */
export const ACCESS_MODES = ["read-only", "workspace-write", "tests-only", "ci-cd-without-publish", "docs-only"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** Modos cujo `writeScope` é uma lista restrita de globs. */
export const SCOPED_ACCESS_MODES: readonly AccessMode[] = ["tests-only", "ci-cd-without-publish", "docs-only"];

export interface CatalogAgent {
  /** Identificador estável (kebab-case). Também nomeia `instructions/<id>.md`. */
  id: string;
  name: string;
  role: string;
  team: AgentTeam;
  accessMode: AccessMode;
  /**
   * Globs relativos à raiz do repositório (`**` = qualquer subcaminho, `*` =
   * trecho sem `/`; `!` inicial = exclusão). Vazio para `read-only`, `["**"]`
   * para `workspace-write`.
   */
  writeScope: readonly string[];
  accentColor: string;
  responsibilities: readonly string[];
  /** Descrição curta, em uma linha. */
  description: string;
}

export interface AgentCatalogData {
  schemaVersion: number;
  agents: readonly CatalogAgent[];
}

/** Agente do catálogo com as instruções carregadas. */
export interface CatalogAgentWithInstructions extends CatalogAgent {
  instructions: string;
}

const AGENT_KEYS = ["id", "name", "role", "team", "accessMode", "writeScope", "accentColor", "responsibilities", "description"];
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Texto de uma linha, sem espaços nas pontas e sem caracteres de controle (inválidos em strings TOML). */
function isNonEmptyLine(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && !/[\0-\x1f\x7f]/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Glob relativo à raiz, sem `..`, sem `.`, sem caminho absoluto, sem `\`, sem
 * segmentos vazios e sem componente `.git`. Um `!` inicial (exclusão) é aceito
 * uma única vez.
 */
export function isSafeGlob(entry: unknown): boolean {
  if (typeof entry !== "string") return false;
  const glob = entry.startsWith("!") ? entry.slice(1) : entry;
  return (
    glob.length > 0 &&
    !glob.startsWith("!") &&
    !glob.startsWith("/") &&
    !/^[A-Za-z]:/.test(glob) &&
    !glob.includes("\\") &&
    !glob.includes('"') &&
    !/[\0-\x1f]/.test(glob) &&
    glob
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment.toLowerCase() !== ".git")
  );
}

/** Coerência entre `accessMode` e `writeScope`. */
export function validateWriteScope(id: string, accessMode: AccessMode, scope: readonly string[]): string[] {
  const errors: string[] = [];
  if (accessMode === "read-only" && scope.length !== 0) errors.push(`${id}: agente read-only não pode ter writeScope`);
  if (accessMode === "workspace-write" && !(scope.length === 1 && scope[0] === "**")) {
    errors.push(`${id}: agente workspace-write deve ter writeScope ["**"]`);
  }
  if (SCOPED_ACCESS_MODES.includes(accessMode)) {
    if (!scope.some((glob) => !glob.startsWith("!"))) {
      errors.push(`${id}: modo ${accessMode} exige ao menos um caminho permitido no writeScope`);
    }
    for (const glob of scope) {
      if (glob === "**" || glob === "!**") errors.push(`${id}: modo ${accessMode} não pode usar "**" isolado`);
      else if (!isSafeGlob(glob)) errors.push(`${id}: glob inseguro ou inválido no writeScope: ${glob}`);
    }
  }
  if (new Set(scope).size !== scope.length) errors.push(`${id}: writeScope com entradas duplicadas`);
  return errors;
}

/**
 * Valida a estrutura de `agents.json`. Retorna a lista de erros (vazia se válido).
 * Chaves desconhecidas são rejeitadas para evitar campos ignorados em silêncio.
 */
export function validateCatalogData(data: unknown): string[] {
  if (!isRecord(data)) return ["catálogo: raiz precisa ser objeto"];
  const errors: string[] = [];
  for (const key of Object.keys(data)) {
    if (key !== "schemaVersion" && key !== "agents") errors.push(`catálogo: chave desconhecida na raiz: ${key}`);
  }
  if (data.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    errors.push(`catálogo: schemaVersion não suportada: ${String(data.schemaVersion)}`);
  }
  if (!Array.isArray(data.agents) || data.agents.length === 0) return [...errors, "catálogo: agents precisa ser lista não vazia"];

  const ids = new Set<string>();
  const names = new Set<string>();
  data.agents.forEach((raw: unknown, index: number) => {
    if (!isRecord(raw)) {
      errors.push(`catálogo: agente na posição ${index} precisa ser objeto`);
      return;
    }
    const id = typeof raw.id === "string" ? raw.id : `#${index}`;
    for (const key of Object.keys(raw)) {
      if (!AGENT_KEYS.includes(key)) errors.push(`${id}: chave desconhecida: ${key}`);
    }
    if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) errors.push(`${id}: id inválido`);
    else if (ids.has(raw.id)) errors.push(`id duplicado no catálogo: ${raw.id}`);
    else ids.add(raw.id);

    for (const field of ["name", "role", "description"] as const) {
      if (!isNonEmptyLine(raw[field])) errors.push(`${id}: ${field} precisa ser texto de uma linha, não vazio`);
    }
    if (typeof raw.name === "string") {
      if (names.has(raw.name)) errors.push(`nome duplicado no catálogo: ${raw.name}`);
      names.add(raw.name);
    }
    if (!AGENT_TEAMS.includes(raw.team as AgentTeam)) errors.push(`${id}: equipe inválida: ${String(raw.team)}`);
    if (typeof raw.accentColor !== "string" || !HEX_COLOR.test(raw.accentColor)) errors.push(`${id}: accentColor inválida`);
    if (!isStringArray(raw.responsibilities) || raw.responsibilities.length === 0 || !raw.responsibilities.every(isNonEmptyLine)) {
      errors.push(`${id}: responsibilities precisa ser lista não vazia de textos de uma linha`);
    }
    const modeValid = ACCESS_MODES.includes(raw.accessMode as AccessMode);
    if (!modeValid) errors.push(`${id}: accessMode inválido: ${String(raw.accessMode)}`);
    if (!isStringArray(raw.writeScope)) errors.push(`${id}: writeScope precisa ser lista de textos`);
    else if (modeValid) errors.push(...validateWriteScope(id, raw.accessMode as AccessMode, raw.writeScope));
  });
  return errors;
}

/**
 * Valida o conjunto de instruções: exatamente um arquivo por agente, sem órfãos,
 * texto não vazio, terminado por uma única quebra de linha e sem `\r`.
 */
export function validateInstructions(agentIds: readonly string[], instructions: ReadonlyMap<string, string>): string[] {
  const errors: string[] = [];
  for (const id of agentIds) {
    const text = instructions.get(id);
    if (text === undefined) {
      errors.push(`${id}: instruções ausentes (instructions/${id}.md)`);
      continue;
    }
    if (text.trim().length === 0) errors.push(`${id}: instruções vazias`);
    if (text.includes("\r")) errors.push(`${id}: instruções devem usar LF`);
    else if (/[\0-\x08\x0b-\x1f\x7f]/.test(text)) errors.push(`${id}: instruções com caracteres de controle`);
    if (!text.endsWith("\n") || text.endsWith("\n\n")) errors.push(`${id}: instruções devem terminar com exatamente uma quebra de linha`);
    if (text.charCodeAt(0) === 0xfeff) errors.push(`${id}: instruções não podem ter BOM`);
  }
  for (const id of instructions.keys()) {
    if (!agentIds.includes(id)) errors.push(`instruções sem agente no catálogo: ${id}`);
  }
  return errors;
}

/** Erro lançado quando o catálogo é inválido. */
export class CatalogError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`catálogo de agentes inválido:\n- ${errors.join("\n- ")}`);
    this.name = "CatalogError";
    this.errors = errors;
  }
}

/** Valida metadados e instruções e devolve os agentes completos, na ordem do catálogo. */
export function buildCatalog(data: unknown, instructions: ReadonlyMap<string, string>): CatalogAgentWithInstructions[] {
  const dataErrors = validateCatalogData(data);
  if (dataErrors.length > 0) throw new CatalogError(dataErrors);
  const agents = (data as AgentCatalogData).agents;
  const instructionErrors = validateInstructions(
    agents.map((agent) => agent.id),
    instructions,
  );
  if (instructionErrors.length > 0) throw new CatalogError(instructionErrors);
  return agents.map((agent) => ({ ...agent, instructions: instructions.get(agent.id) as string }));
}
