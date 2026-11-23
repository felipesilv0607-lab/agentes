#!/usr/bin/env node
/**
 * Verificador de escopo de escrita dos agentes do Agente.s.
 *
 * DETECTA, depois de uma tarefa, alterações fora do `writeScope` do agente e
 * alterações em arquivos de governança. NÃO IMPEDE a escrita: o sandbox do
 * Codex em modo workspace-write permite alterar qualquer arquivo do workspace.
 *
 * Fluxo (executado pelo Coordinator ou por um humano; a execução feita pelo
 * próprio agente verificado não vale como evidência):
 *   1. Antes da tarefa, com o repositório no commit-base revisado:
 *        node scripts/agent-scope-check.mjs snapshot --agent <id> --out <diretório novo fora do repositório>
 *      O diretório recebe snapshot.json e uma cópia confiável deste verificador.
 *      Registre os dois SHA-256 impressos fora do alcance do agente.
 *   2. Depois da tarefa, confira o SHA-256 da cópia (por exemplo, Get-FileHash)
 *      e execute SOMENTE essa cópia, a partir da raiz do repositório:
 *        node <diretório do snapshot>/agent-scope-check.mjs check --agent <id> --snapshot <diretório do snapshot>/snapshot.json --sha256 <hash>
 *
 * Garantias de projeto:
 * - O escopo vem do catálogo no commit-base, lido como DADO (análise estática do
 *   texto, sem executar TypeScript) e gravado no snapshot.
 * - O check não lê nada do commit-base: usa somente o snapshot e o disco.
 * - Todo o workspace é comparado por SHA-256 do conteúdo (rastreados, não
 *   rastreados e ignorados), sem depender do índice ou do cache de stat do Git.
 * - O estado sensível de `.git/` é comparado por leitura direta do disco ANTES de
 *   qualquer comando git; se mudou, nenhum comando git é executado.
 * - Os comandos git usados não aplicam filtros (sem diff do workspace) e rodam
 *   sem objetos de substituição e sem configuração global ou de sistema.
 * - O snapshot recusa um estado inicial não confiável: configuração Git
 *   executável, hooks ativos, worktrees, submódulos, alternates, grafts e
 *   arquivos de governança divergentes do commit-base.
 * - `.git/` e o workspace são lidos de novo ao final; mudança no meio da
 *   verificação (processo concorrente) descarta o resultado (saída 2).
 *
 * Saída: 0 = sem violações; 1 = violações; 2 = erro ou resultado ambíguo (falha fechada).
 *
 * Exclusões técnicas (lista exata em EXCLUDED_DIRS e EXCLUDED_FILES):
 * node_modules na raiz e em apps/dashboard, apps/dashboard/dist e
 * apps/dashboard/tsconfig.tsbuildinfo. Um link simbólico ou junction nesses
 * caminhos ainda é detectado.
 * Depois de tarefas de agentes, reinstale dependências com `npm ci` antes de
 * executar build ou testes. Limitações completas no README.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXIT_OK = 0;
export const EXIT_VIOLATION = 1;
export const EXIT_ERROR = 2;
export const SNAPSHOT_VERSION = 2;

export const CATALOG_PATH = "apps/dashboard/src/data/agentCatalog.ts";
export const CHECKER_PATH = "scripts/agent-scope-check.mjs";
export const SNAPSHOT_FILE = "snapshot.json";
export const CHECKER_COPY_FILE = "agent-scope-check.mjs";

/** Arquivos de governança: qualquer alteração é violação, para qualquer agente. */
export const PROTECTED_PATHS = [
  "**/AGENTS.md",
  "**/AGENTS.override.md",
  "standards/**",
  "apps/dashboard/src/data/agentCatalog.ts",
  "apps/dashboard/src/types/agent.ts",
  "scripts/agent-catalog.test.mjs",
  "scripts/agent-scope-check.mjs",
  "scripts/agent-scope-check.test.mjs",
  "scripts/security-baseline.test.mjs",
  ".codex/**",
];

/** Diretórios recriáveis não inventariados (somente nestes caminhos exatos). */
export const EXCLUDED_DIRS = ["node_modules", "apps/dashboard/node_modules", "apps/dashboard/dist"];
/** Arquivos de build recriáveis não inventariados (somente estes caminhos exatos). */
export const EXCLUDED_FILES = ["apps/dashboard/tsconfig.tsbuildinfo"];
export const TECHNICAL_EXCLUSIONS = [...EXCLUDED_DIRS.map((dir) => `${dir}/**`), ...EXCLUDED_FILES];

/** Arquivos de `.git/` que podem ocultar alterações, alterar o histórico ou executar código. */
export const GIT_STATE_FILES = ["config", "config.worktree", "commondir", "objects/info/alternates", "objects/info/http-alternates", "shallow"];
/** Diretórios de `.git/` comparados recursivamente (sem seguir links). */
export const GIT_STATE_DIRS = ["hooks", "info", "worktrees", "modules"];

/**
 * Chaves da configuração local que executam programas, redirecionam o repositório
 * ou incluem outra configuração. Presentes no início, o snapshot é recusado.
 */
export const DANGEROUS_CONFIG_KEYS = [
  /^core\.(fsmonitor|hookspath|sshcommand|pager|editor|askpass|gitproxy|worktree|attributesfile|alternaterefscommand)$/,
  /^(include|includeif)\./,
  /^filter\./,
  /^diff\.external$/,
  /^diff\..+\.(textconv|command)$/,
  /^merge\..+\.driver$/,
  /^pager\./,
  /^alias\./,
  /^credential(\..+)?\.helper$/,
  /^gpg\.(.+\.)?program$/,
  /^sequence\.editor$/,
  /^uploadpack\.packobjectshook$/,
  /^remote\..+\.(uploadpack|receivepack|vcs)$/,
  /^protocol\..*allow$/,
  /^extensions\.worktreeconfig$/,
];
/** Valores de core.fsmonitor que desligam o recurso (aceitos). */
const FSMONITOR_OFF = new Set(["", "false", "no", "off", "0"]);
/** Arquivos de `.git/` que não podem existir no início (objetos ou histórico de fora, config por worktree). */
export const UNTRUSTED_GIT_FILES = ["objects/info/alternates", "objects/info/http-alternates", "info/grafts", "config.worktree", "commondir"];

/** Configurações forçadas em toda chamada ao git. */
const GIT_SAFETY_CONFIG = ["core.quotepath=false", "core.fsmonitor=false", "core.untrackedCache=false", "core.ignoreStat=false"];

export class ScopeCheckError extends Error {}

/** Nome que o Git (no Windows, inclusive variantes NTFS e nome curto 8.3) trata como diretório .git. */
export const isGitDirName = (name) => /^\.git[. ]*$/i.test(name) || /^git~\d+$/i.test(name);

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

/** Converte um glob em expressão regular ancorada (`**` = qualquer subcaminho; `*` = trecho sem `/`). */
export function globToRegExp(glob, { ignoreCase = false } = {}) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      const atStart = i === 0 || glob[i - 1] === "/";
      if (atStart && glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      source += "[^/]*";
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

/** Separa um writeScope em padrões permitidos e exclusões (`!glob`). */
export function compileScope(writeScope, { ignoreCase = false } = {}) {
  const allow = [];
  const deny = [];
  for (const entry of writeScope) {
    if (entry.startsWith("!")) deny.push(globToRegExp(entry.slice(1), { ignoreCase }));
    else allow.push(globToRegExp(entry, { ignoreCase }));
  }
  return (repoPath) => allow.some((re) => re.test(repoPath)) && !deny.some((re) => re.test(repoPath));
}

/** Retorna o motivo pelo qual o caminho é inseguro, ou null se for válido. */
export function unsafePathReason(repoPath) {
  if (typeof repoPath !== "string" || repoPath.length === 0) return "caminho vazio";
  if (repoPath.endsWith("/")) {
    return "diretório não verificável (repositório Git aninhado, worktree ou submódulo); o conteúdo do .git interno não é inspecionado";
  }
  if (/[\u0000-\u001f\u007f]/.test(repoPath)) return "caminho com caractere de controle";
  if (repoPath.split("/").some(isGitDirName)) return "caminho dentro de um diretório .git (metadados Git; inclui variantes de maiúsculas/minúsculas)";
  if (repoPath.includes("\\")) return "caminho com barra invertida";
  if (repoPath.startsWith("/") || /^[A-Za-z]:/.test(repoPath)) return "caminho absoluto";
  const segments = repoPath.split("/");
  if (segments.some((segment) => segment === "..")) return "path traversal (..)";
  if (segments.some((segment) => segment === "" || segment === ".")) return "segmento de caminho vazio ou '.'";
  return null;
}

/** Interpreta `git diff --name-status -z`. Falha diante de qualquer formato inesperado. */
export function parseNameStatusZ(output, source) {
  const tokens = output.split("\0");
  if (tokens[tokens.length - 1] === "") tokens.pop();
  const changes = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++];
    if (/^[RC]\d{0,3}$/.test(status)) {
      const from = tokens[i++];
      const to = tokens[i++];
      if (from === undefined || to === undefined) throw new ScopeCheckError(`saída do git truncada após ${status}`);
      changes.push({ status: status[0], path: from, source, role: "origem" });
      changes.push({ status: status[0], path: to, source, role: "destino" });
    } else if (/^[AMDTU]$/.test(status)) {
      const file = tokens[i++];
      if (file === undefined) throw new ScopeCheckError(`saída do git truncada após ${status}`);
      changes.push({ status, path: file, source });
    } else {
      throw new ScopeCheckError(`status desconhecido na saída do git: ${JSON.stringify(status)}`);
    }
  }
  return changes;
}

/**
 * Lê id, accessMode e writeScope de cada agente do texto do catálogo, SEM executar
 * o TypeScript. Aceita somente literais simples; qualquer outra forma é erro.
 */
export function parseCatalogWriteScopes(source) {
  const text = source.replace(/\r\n/g, "\n");
  if (!/^export const agentCatalog = \[$/m.test(text)) throw new ScopeCheckError("catálogo sem a declaração esperada 'export const agentCatalog = ['");
  const idMatches = [...text.matchAll(/^ {4}id: "([a-z0-9-]+)",$/gm)];
  if (idMatches.length === 0) throw new ScopeCheckError("catálogo sem agentes reconhecíveis");
  const agents = {};
  idMatches.forEach((match, index) => {
    const id = match[1];
    const segment = text.slice(match.index, idMatches[index + 1]?.index ?? text.length);
    const modes = [...segment.matchAll(/^ {4}accessMode: "([a-z-]+)",$/gm)];
    const scopes = [...segment.matchAll(/^ {4}writeScope: \[([^\]]*)\],$/gm)];
    if (modes.length !== 1 || scopes.length !== 1) throw new ScopeCheckError(`catálogo: accessMode/writeScope ausente, duplicado ou fora do formato literal em ${id}`);
    const body = scopes[0][1];
    const entries = [...body.matchAll(/"([^"\\\n]*)"/g)].map((m) => m[1]);
    if (body.replace(/"([^"\\\n]*)"/g, "").replace(/[\s,]/g, "") !== "") throw new ScopeCheckError(`catálogo: writeScope de ${id} não é uma lista literal de strings`);
    if (Object.hasOwn(agents, id)) throw new ScopeCheckError(`catálogo: agente duplicado ${id}`);
    agents[id] = { accessMode: modes[0][1], writeScope: entries };
  });
  return agents;
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

/** Impressão digital de um caminho no disco: hash do conteúdo, alvo de link, diretório ou "ausente". */
export function fingerprint(absPath) {
  let stat;
  try {
    stat = lstatSync(absPath);
  } catch {
    return "ausente";
  }
  if (stat.isSymbolicLink()) return `link:${readlinkSync(absPath)}`;
  if (stat.isDirectory()) return "diretorio";
  if (!stat.isFile()) return "especial";
  return `sha256:${sha256(readFileSync(absPath))}`;
}

/** Retorna o primeiro segmento (arquivo ou diretório pai) que é link simbólico ou junction, ou null. */
export function symlinkSegment(root, repoPath) {
  const segments = repoPath.replace(/\/$/, "").split("/");
  for (let i = 1; i <= segments.length; i++) {
    const partial = segments.slice(0, i).join("/");
    try {
      if (lstatSync(path.join(root, partial)).isSymbolicLink()) return partial;
    } catch {
      return null; // segmento inexistente (exclusão): nada a seguir
    }
  }
  return null;
}

/**
 * Inventário do workspace por leitura direta do disco, sem seguir links:
 * arquivo -> "sha256:<hash>", link/junction -> "link:<alvo>", repositório Git
 * aninhado -> chave "<dir>/" com "repositorio-aninhado". Ignora somente o `.git`
 * da raiz e as exclusões técnicas exatas (que ainda são registradas se forem links).
 */
export function scanWorkspace(root) {
  const entries = {};
  const walk = (relDir) => {
    const absDir = relDir ? path.join(root, relDir) : root;
    for (const name of readdirSync(absDir).sort()) {
      const rel = relDir ? `${relDir}/${name}` : name;
      if (!relDir && name.toLowerCase() === ".git") continue;
      const abs = path.join(absDir, name);
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) {
        entries[rel] = `link:${readlinkSync(abs)}`;
      } else if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.includes(rel)) continue;
        if (isGitDirName(name)) {
          entries[`${relDir}/`] = "repositorio-aninhado";
          continue;
        }
        walk(rel);
      } else if (isGitDirName(name)) {
        entries[`${relDir}/`] = "repositorio-aninhado"; // arquivo .git (worktree ou submódulo)
      } else if (stat.isFile()) {
        if (EXCLUDED_FILES.includes(rel)) continue;
        entries[rel] = `sha256:${sha256(readFileSync(abs))}`;
      } else {
        entries[rel] = "especial";
      }
    }
  };
  walk("");
  return entries;
}

/** Estado sensível de `.git/`, lido diretamente do disco (sem executar git, sem seguir links). */
export function readGitStateFs(root) {
  const gitDir = path.join(root, ".git");
  const state = {};
  for (const name of GIT_STATE_FILES) state[name] = fingerprint(path.join(gitDir, name));
  const walk = (rel) => {
    const kind = fingerprint(path.join(gitDir, rel));
    state[rel] = kind;
    if (kind === "diretorio") for (const name of readdirSync(path.join(gitDir, rel)).sort()) walk(`${rel}/${name}`);
  };
  for (const dirName of GIT_STATE_DIRS) walk(dirName);
  return state;
}

// ---------------------------------------------------------------------------
// Git (somente comandos de baixo nível que não executam filtros)
// ---------------------------------------------------------------------------

/** Ambiente neutralizado: sem variáveis GIT_* herdadas, sem config global/sistema, sem replace. */
export function gitEnv(root) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value;
  Object.assign(env, {
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  });
  if (root) Object.assign(env, { GIT_DIR: path.join(root, ".git"), GIT_WORK_TREE: root });
  return env;
}

function git(cwd, args, { root, allowFailure = false } = {}) {
  const configArgs = GIT_SAFETY_CONFIG.flatMap((entry) => ["-c", entry]);
  try {
    return execFileSync("git", [...configArgs, ...args], {
      cwd,
      env: gitEnv(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) return null;
    const detail = (error.stderr || error.message || "").toString().trim().split("\n")[0];
    throw new ScopeCheckError(`falha ao executar git ${args.join(" ")}: ${detail}`);
  }
}

function assertPlainGitDir(root) {
  if (fingerprint(path.join(root, ".git")) !== "diretorio") {
    throw new ScopeCheckError(".git da raiz não é um diretório comum (link, arquivo ou ausente); não suportado");
  }
}

/** Caminhos com skip-worktree (S) ou assume-unchanged (letra minúscula) no índice. */
export function hiddenIndexEntries(root) {
  return git(root, ["ls-files", "-v", "-z"], { root })
    .split("\0")
    .filter(Boolean)
    .filter((entry) => /^[a-zS]/.test(entry))
    .map((entry) => ({ flag: entry[0], path: entry.slice(2) }));
}

function readRefs(root) {
  const refs = {};
  for (const line of git(root, ["for-each-ref", "--format=%(objectname) %(refname)"], { root }).split("\n").filter(Boolean)) {
    const space = line.indexOf(" ");
    refs[line.slice(space + 1)] = line.slice(0, space);
  }
  refs.HEAD = git(root, ["rev-parse", "--verify", "HEAD^{commit}"], { root }).trim();
  refs["HEAD (ramo)"] = (git(root, ["symbolic-ref", "-q", "HEAD"], { root, allowFailure: true }) ?? "detached").trim();
  return refs;
}

/** Entradas do índice: caminho -> "modo blob estágio" (sem consultar o workspace). */
function readIndex(root) {
  const index = {};
  for (const entry of git(root, ["ls-files", "-s", "-z"], { root }).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const file = entry.slice(tab + 1);
    index[file] = index[file] ? `${index[file]}|${entry.slice(0, tab)}` : entry.slice(0, tab);
  }
  return index;
}

const blobAt = (root, commit, file) => git(root, ["cat-file", "blob", `${commit}:${file}`], { root, allowFailure: true });

function isInside(child, parent) {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const runningScript = () => fileURLToPath(import.meta.url);

const untrustedStart = (reasons) => {
  if (reasons.length) {
    throw new ScopeCheckError(
      `estado inicial não confiável; snapshot recusado. Corrija manualmente e revise antes de delegar tarefas: ${reasons.join("; ")}`,
    );
  }
};

/** Recusa estruturas de `.git/` que o verificador não inspeciona com segurança ou que executam código. */
export function assertTrustedGitState(gitState) {
  const reasons = [];
  for (const file of UNTRUSTED_GIT_FILES) {
    if (gitState[file] !== undefined && gitState[file] !== "ausente") reasons.push(`.git/${file} presente (não suportado)`);
  }
  for (const [name, kind] of Object.entries(gitState)) {
    if (kind.startsWith("link:")) reasons.push(`.git/${name} é link simbólico ou junction`);
    if (/^(worktrees|modules)\//.test(name)) reasons.push(`.git/${name}: worktrees e submódulos não são suportados pelo verificador`);
    if (/^hooks\//.test(name) && !(kind.startsWith("sha256:") && /^hooks\/[^/]+\.sample$/.test(name))) {
      reasons.push(`hook ativo ou não padrão em .git/${name}`);
    }
  }
  untrustedStart(reasons);
}

/** Recusa configuração local que executa programas, inclui outra configuração ou redireciona o repositório. */
export function assertTrustedConfig(root) {
  const output = git(root, ["config", "--local", "--list", "-z", "--no-includes"], { root });
  const reasons = [];
  for (const entry of output.split("\0").filter(Boolean)) {
    const newline = entry.indexOf("\n");
    const key = (newline < 0 ? entry : entry.slice(0, newline)).toLowerCase();
    const value = newline < 0 ? "" : entry.slice(newline + 1);
    if (key === "core.fsmonitor" && FSMONITOR_OFF.has(value.trim().toLowerCase())) continue;
    if (DANGEROUS_CONFIG_KEYS.some((re) => re.test(key))) reasons.push(`configuração Git não confiável: ${key}`);
  }
  untrustedStart(reasons);
}

/**
 * Recusa um workspace em que os arquivos de governança divergem do commit-base
 * (conteúdo, índice, ausência ou arquivo novo), em que o índice tem submódulos
 * ou caminhos dentro de diretórios .git.
 */
export function assertTrustedWorkspace(root, base, files, index) {
  const isProtected = compileScope(PROTECTED_PATHS, { ignoreCase: true });
  const baseTree = {};
  for (const entry of git(root, ["ls-tree", "-r", "-z", "--full-tree", base], { root }).split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const [mode, , blob] = entry.slice(0, tab).split(" ");
    baseTree[entry.slice(tab + 1)] = { mode, blob };
  }
  const reasons = [];
  for (const [file, entry] of Object.entries(index)) {
    if (entry.startsWith("160000")) reasons.push(`submódulo no índice (${file}) não é suportado`);
    if (unsafePathReason(file)) reasons.push(`caminho inseguro no índice: ${file}`);
  }
  const candidates = new Set([...Object.keys(baseTree), ...Object.keys(files), ...Object.keys(index)].filter((p) => isProtected(p)));
  for (const file of [...candidates].sort()) {
    const atBase = baseTree[file];
    const onDisk = files[file];
    if (!atBase) {
      reasons.push(`arquivo de governança ausente do commit-base: ${file}`);
      continue;
    }
    if (!onDisk) {
      reasons.push(`arquivo de governança ausente do workspace: ${file}`);
      continue;
    }
    if (!onDisk.startsWith("sha256:")) {
      reasons.push(`arquivo de governança não é arquivo comum: ${file}`);
      continue;
    }
    const baseContent = blobAt(root, base, file);
    if (baseContent === null || normalizeEol(baseContent) !== normalizeEol(readFileSync(path.join(root, file), "utf8"))) {
      reasons.push(`arquivo de governança difere do commit-base: ${file}`);
    }
    const indexBlob = index[file]?.split(" ")[1];
    if (indexBlob !== atBase.blob) reasons.push(`arquivo de governança com índice diferente do commit-base: ${file}`);
  }
  untrustedStart(reasons);
}

// ---------------------------------------------------------------------------
// Snapshot e verificação
// ---------------------------------------------------------------------------

/** Cria o diretório do snapshot (snapshot.json + cópia do verificador). */
export function createSnapshot({ cwd, agentId, out }) {
  const discovered = git(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (discovered === null) throw new ScopeCheckError("diretório atual não está em um repositório Git");
  const root = path.resolve(discovered.trim());
  assertPlainGitDir(root);
  const outDir = path.resolve(cwd, out);
  if (isInside(outDir, root)) throw new ScopeCheckError("o diretório do snapshot deve ficar fora do repositório");
  if (fingerprint(outDir) !== "ausente") throw new ScopeCheckError("o diretório do snapshot já existe; use um diretório novo (caminho inexistente)");

  // Estado de .git/ lido do disco antes de qualquer outro comando git e validado.
  const gitStateBefore = readGitStateFs(root);
  assertTrustedGitState(gitStateBefore);
  assertTrustedConfig(root);

  const refs = readRefs(root);
  const replaced = Object.keys(refs).filter((name) => name.startsWith("refs/replace/"));
  if (replaced.length) throw new ScopeCheckError(`repositório com objetos de substituição (git replace): ${replaced.join(", ")}`);
  const hidden = hiddenIndexEntries(root);
  if (hidden.length) throw new ScopeCheckError(`índice com skip-worktree/assume-unchanged: ${hidden.map((h) => h.path).join(", ")}`);

  const base = refs.HEAD;
  const checkerAtBase = blobAt(root, base, CHECKER_PATH);
  if (checkerAtBase === null) {
    throw new ScopeCheckError(`${CHECKER_PATH} não existe no commit-base ${base}; o verificador só é válido a partir de um commit que o contenha`);
  }
  const checkerBytes = readFileSync(runningScript());
  if (normalizeEol(checkerBytes.toString("utf8")) !== normalizeEol(checkerAtBase)) {
    throw new ScopeCheckError(`o verificador em execução difere de ${CHECKER_PATH} no commit-base ${base}`);
  }
  const catalogSource = blobAt(root, base, CATALOG_PATH);
  if (catalogSource === null) throw new ScopeCheckError(`${CATALOG_PATH} não existe no commit-base ${base}`);
  const writeScopes = parseCatalogWriteScopes(catalogSource);
  const agent = writeScopes[agentId];
  if (!agent) throw new ScopeCheckError(`agente desconhecido no catálogo do commit-base: ${agentId}`);

  const files = scanWorkspace(root);
  const index = readIndex(root);
  assertTrustedWorkspace(root, base, files, index);
  // Revalidação: nada pode ter mudado durante a criação do snapshot.
  const changedDuring = [];
  const compareInto = (before, after, prefix) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[key] !== after[key]) changedDuring.push(`${prefix}${key}`);
  };
  compareInto(gitStateBefore, readGitStateFs(root), ".git/");
  compareInto(files, scanWorkspace(root), "");
  if (changedDuring.length) {
    throw new ScopeCheckError(`alteração durante a criação do snapshot (processo concorrente?): ${changedDuring.slice(0, 10).join(", ")}`);
  }

  const checkerSha256 = sha256(checkerBytes);
  const snapshot = {
    version: SNAPSHOT_VERSION,
    tool: "agent-scope-check",
    createdAt: new Date().toISOString(),
    root,
    agent: agentId,
    accessMode: agent.accessMode,
    writeScope: agent.writeScope,
    writeScopes,
    base,
    catalogSha256: sha256(catalogSource),
    checker: { file: CHECKER_COPY_FILE, sha256: checkerSha256 },
    protectedPaths: PROTECTED_PATHS,
    technicalExclusions: TECHNICAL_EXCLUSIONS,
    refs,
    gitState: gitStateBefore,
    index,
    files,
  };
  try {
    mkdirSync(outDir); // não recursivo: falha se já existir ou se o pai não existir
  } catch (error) {
    throw new ScopeCheckError(`não foi possível criar o diretório novo do snapshot (${error.code}); use um diretório novo (caminho inexistente)`);
  }
  const checkerFile = path.join(outDir, CHECKER_COPY_FILE);
  const snapshotFile = path.join(outDir, SNAPSHOT_FILE);
  writeFileSync(checkerFile, checkerBytes, { flag: "wx" });
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  writeFileSync(snapshotFile, content, { flag: "wx" });
  return { file: snapshotFile, sha256: sha256(content), checkerFile, checkerSha256, snapshot };
}

/** Lê e valida o snapshot (integridade, versão e agente). Não executa git. */
export function readSnapshot({ file, expectedSha256, agentId }) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) throw new ScopeCheckError("--sha256 inválido (64 caracteres hexadecimais)");
  let content;
  try {
    content = readFileSync(file);
  } catch {
    throw new ScopeCheckError(`snapshot não encontrado: ${file}`);
  }
  if (sha256(content) !== expectedSha256) throw new ScopeCheckError("SHA-256 do snapshot não confere; o snapshot pode ter sido alterado");
  let snapshot;
  try {
    snapshot = JSON.parse(content.toString("utf8"));
  } catch {
    throw new ScopeCheckError("snapshot com JSON inválido");
  }
  if (snapshot.version !== SNAPSHOT_VERSION || snapshot.tool !== "agent-scope-check") throw new ScopeCheckError("versão de snapshot não suportada");
  if (snapshot.agent !== agentId) throw new ScopeCheckError(`snapshot criado para outro agente: ${snapshot.agent}`);
  if (!Array.isArray(snapshot.writeScope) || typeof snapshot.root !== "string") throw new ScopeCheckError("snapshot incompleto");
  return snapshot;
}

/** Verifica as alterações contra o escopo do agente e os caminhos protegidos. */
export function checkScope({ agent, changes, symlinkSegmentOf = () => null }) {
  if (!agent || !Array.isArray(agent.writeScope)) throw new ScopeCheckError("agente sem writeScope definido");
  const inScope = compileScope(agent.writeScope);
  const inScopeIgnoringCase = compileScope(agent.writeScope, { ignoreCase: true });
  const isProtected = compileScope(PROTECTED_PATHS);
  const isProtectedIgnoringCase = compileScope(PROTECTED_PATHS, { ignoreCase: true });
  const violations = [];
  const seen = new Set();

  for (const change of changes) {
    const key = `${change.path}\0${change.source}\0${change.role ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const where = `${change.source}${change.role ? ` (${change.role} de renomeação/cópia)` : ""}`;
    const add = (reason) => violations.push({ path: change.path, source: where, reason });

    if (change.reason) {
      add(change.reason); // alteração de estado do Git (refs, stash, hooks, config)
      continue;
    }
    const unsafe = unsafePathReason(change.path);
    if (unsafe) {
      add(unsafe);
      continue;
    }
    if (isProtected(change.path) || isProtectedIgnoringCase(change.path)) {
      add("arquivo de governança protegido; alteração exige tarefa explicitamente autorizada e revisão humana");
      continue;
    }
    if (agent.writeScope.length === 0) {
      add("agente somente leitura alterou o repositório");
      continue;
    }
    const link = symlinkSegmentOf(change.path);
    if (link) {
      add(`link simbólico ou junction no caminho (${link})`);
      continue;
    }
    if (inScope(change.path)) continue;
    add(
      inScopeIgnoringCase(change.path)
        ? "diferença de maiúsculas/minúsculas em relação ao escopo (ambíguo no Windows)"
        : "fora do escopo de escrita",
    );
  }
  return { violations, checked: seen.size };
}

/**
 * Coleta as alterações desde o snapshot. Ordem: (1) estado de `.git/` por leitura
 * direta; (2) workspace por hash; (3) somente se `.git/` estiver inalterado,
 * comandos git (índice, referências e commits).
 */
export function collectChangesSince({ root, snapshot, afterGitCommands = () => {} }) {
  assertPlainGitDir(root);
  const byPath = new Map();
  const warnings = [];
  const add = (repoPath, source, extra = {}) => {
    const current = byPath.get(repoPath);
    if (current) {
      if (!current.source.split(", ").includes(source)) current.source += `, ${source}`;
      if (extra.reason && !current.reason) current.reason = extra.reason;
    } else byPath.set(repoPath, { path: repoPath, source, ...extra });
  };
  const compare = (before, after, onDiff) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[key] !== after[key]) onDiff(key);
  };

  // 1. Estado de .git/ (antes de qualquer comando git).
  const gitState = readGitStateFs(root);
  let gitStateChanged = false;
  compare(snapshot.gitState, gitState, (name) => {
    gitStateChanged = true;
    add(`.git/${name}`, ".git", { reason: "estado do Git alterado (pode ocultar alterações ou executar código)" });
  });

  // 2. Workspace inteiro, por hash de conteúdo.
  const files = scanWorkspace(root);
  compare(snapshot.files, files, (file) => add(file, "arquivo"));

  // 3. Comandos git, somente com .git/ inalterado.
  let head = null;
  if (gitStateChanged) {
    warnings.push("índice, referências e commits NÃO foram verificados: o estado de .git/ mudou e comandos git poderiam executar código do agente");
  } else {
    const hidden = hiddenIndexEntries(root);
    if (hidden.length) {
      throw new ScopeCheckError(`índice com skip-worktree/assume-unchanged (alteração ocultável): ${hidden.map((h) => `${h.flag} ${h.path}`).join(", ")}`);
    }
    compare(snapshot.index, readIndex(root), (file) => add(file, "índice"));
    const refs = readRefs(root);
    compare(snapshot.refs, refs, (name) =>
      add(name, "refs", { reason: `referência Git alterada (${snapshot.refs[name] ?? "ausente"} -> ${refs[name] ?? "ausente"})` }),
    );
    head = refs.HEAD;
    if (head !== snapshot.base) {
      const isDescendant = git(root, ["merge-base", "--is-ancestor", snapshot.base, head], { root, allowFailure: true }) !== null;
      if (!isDescendant) throw new ScopeCheckError(`commit-base ${snapshot.base} não é ancestral de HEAD; resultado ambíguo`);
      const diff = git(root, ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", snapshot.base, head], { root });
      for (const change of parseNameStatusZ(diff, "commit")) add(change.path, "commit");
    }
  }
  // 4. Revalidação: .git/ e o workspace não podem ter mudado durante a verificação.
  afterGitCommands();
  const changedDuring = [];
  compare(gitState, readGitStateFs(root), (name) => changedDuring.push(`.git/${name}`));
  compare(files, scanWorkspace(root), (file) => changedDuring.push(file));
  if (changedDuring.length) {
    throw new ScopeCheckError(`alteração durante a verificação (processo concorrente?); resultado descartado: ${changedDuring.slice(0, 10).join(", ")}`);
  }
  return { head, changes: [...byPath.values()], warnings };
}

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "snapshot" && command !== "check") throw new ScopeCheckError("comando ausente ou inválido: use snapshot ou check");
  const args = { command, json: false };
  const valued = new Set(["--agent", "--out", "--snapshot", "--sha256"]);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--json") args.json = true;
    else if (valued.has(arg)) {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new ScopeCheckError(`valor ausente para ${arg}`);
      args[arg.slice(2)] = value;
    } else throw new ScopeCheckError(`argumento desconhecido: ${arg}`);
  }
  if (!args.agent) throw new ScopeCheckError("--agent é obrigatório");
  if (command === "snapshot" && !args.out) throw new ScopeCheckError("--out é obrigatório (diretório novo fora do repositório)");
  if (command === "check" && !args.snapshot) throw new ScopeCheckError("--snapshot é obrigatório (crie-o antes da tarefa)");
  if (command === "check" && !args.sha256) throw new ScopeCheckError("--sha256 é obrigatório (hash impresso na criação do snapshot)");
  return args;
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = console } = {}) {
  let json = argv.includes("--json");
  try {
    const args = parseArgs(argv);
    json = args.json;
    if (args.command === "snapshot") {
      const result = createSnapshot({ cwd, agentId: args.agent, out: args.out });
      if (json) {
        out.log(JSON.stringify({ snapshot: result.file, sha256: result.sha256, checker: result.checkerFile, checkerSha256: result.checkerSha256, base: result.snapshot.base }, null, 2));
      } else {
        out.log(`SNAPSHOT: ${result.file}`);
        out.log(`SHA256: ${result.sha256}`);
        out.log(`VERIFICADOR: ${result.checkerFile}`);
        out.log(`VERIFICADOR_SHA256: ${result.checkerSha256}`);
        out.log(`BASE: ${result.snapshot.base} | agente: ${result.snapshot.agent} | arquivos registrados: ${Object.keys(result.snapshot.files).length}`);
        out.log(`Depois da tarefa, confira o hash do verificador e execute: node "${result.checkerFile}" check --agent ${args.agent} --snapshot "${result.file}" --sha256 ${result.sha256}`);
      }
      return EXIT_OK;
    }

    const snapshot = readSnapshot({ file: path.resolve(cwd, args.snapshot), expectedSha256: args.sha256, agentId: args.agent });
    const root = path.resolve(snapshot.root);
    if (!isInside(path.resolve(cwd), root)) throw new ScopeCheckError("execute o check a partir do repositório registrado no snapshot");
    const script = runningScript();
    if (isInside(script, root)) {
      throw new ScopeCheckError("não execute a cópia do verificador do workspace; execute a cópia do diretório do snapshot");
    }
    if (sha256(readFileSync(script)) !== snapshot.checker?.sha256) {
      throw new ScopeCheckError("o verificador em execução não corresponde à cópia registrada no snapshot");
    }
    const agent = { id: snapshot.agent, accessMode: snapshot.accessMode, writeScope: snapshot.writeScope };
    const { head, changes, warnings } = collectChangesSince({ root, snapshot });
    const result = checkScope({ agent, changes, symlinkSegmentOf: (p) => symlinkSegment(root, p) });
    const report = { agent: agent.id, accessMode: agent.accessMode, writeScope: agent.writeScope, base: snapshot.base, head, warnings, ...result };
    if (json) out.log(JSON.stringify(report, null, 2));
    else {
      out.log(`Agente: ${agent.id} (${agent.accessMode}) | escopo (commit-base): ${agent.writeScope.length ? agent.writeScope.join(", ") : "nenhum (somente leitura)"}`);
      out.log(`Base: ${snapshot.base} | HEAD: ${head ?? "não verificado"} | alterações verificadas: ${result.checked}`);
      for (const v of result.violations) out.log(`VIOLAÇÃO: ${v.path} [${v.source}] — ${v.reason}`);
      for (const w of warnings) out.log(`AVISO: ${w}`);
      out.log(result.violations.length ? `RESULTADO: ${result.violations.length} violação(ões)` : "RESULTADO: nenhuma violação");
      out.log("Aviso: este verificador detecta alterações fora do escopo; ele não impede tecnicamente a escrita.");
    }
    return result.violations.length ? EXIT_VIOLATION : EXIT_OK;
  } catch (error) {
    const message = error instanceof ScopeCheckError ? error.message : `erro inesperado: ${error.message}`;
    if (json) out.log(JSON.stringify({ error: message }, null, 2));
    else out.error(`ERRO (falha fechada): ${message}`);
    return EXIT_ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

export const scriptPath = runningScript();
