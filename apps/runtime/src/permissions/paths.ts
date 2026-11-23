/**
 * Validação de caminhos e globs do Permission Engine. Independente de
 * `scripts/agent-scope-check.mjs` (que não é barreira de segurança); a
 * semântica de glob é a mesma, conferida por teste de equivalência.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
export const MAX_PATH_LENGTH = 1024;

/**
 * Motivo pelo qual um caminho relativo à raiz é inseguro, ou `null` se for válido.
 * Rejeita tudo o que possa escapar da raiz, apontar para metadados do Git ou
 * ter significado especial no Windows (fluxos alternativos `:`, nomes curtos
 * `~1`, pontos e espaços finais, nomes de dispositivo).
 */
export function unsafePathReason(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return "caminho vazio ou não textual";
  if (candidate.length > MAX_PATH_LENGTH) return "caminho longo demais";
  if (/[\0-\x1f\x7f]/.test(candidate)) return "caminho com caractere de controle";
  if (candidate.includes("\\")) return "caminho com barra invertida";
  if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return "caminho absoluto";
  if (candidate.includes(":")) return "caminho com ':' (fluxo alternativo ou unidade)";
  const segments = candidate.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === ".") return "segmento vazio ou '.'";
    if (segment === "..") return "path traversal (..)";
    if (/[. ]$/.test(segment)) return "segmento terminado em ponto ou espaço (alias no Windows)";
    if (/~\d/.test(segment)) return "nome curto do Windows (~N)";
    if (segment.toLowerCase() === ".git") return "metadados do Git (.git)";
    if (WINDOWS_RESERVED.test(segment)) return "nome de dispositivo reservado do Windows";
  }
  return null;
}

/** Glob → expressão regular ancorada (`**` = qualquer subcaminho; `*` = trecho sem `/`). */
export function globToRegExp(glob: string, ignoreCase = false): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
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

/** Compila uma lista de globs com exclusões (`!glob`) em um predicado. */
export function compileScope(globs: readonly string[], ignoreCase = false): (repoPath: string) => boolean {
  const allow: RegExp[] = [];
  const deny: RegExp[] = [];
  for (const entry of globs) {
    if (entry.startsWith("!")) deny.push(globToRegExp(entry.slice(1), ignoreCase));
    else allow.push(globToRegExp(entry, ignoreCase));
  }
  return (repoPath) => allow.some((re) => re.test(repoPath)) && !deny.some((re) => re.test(repoPath));
}
