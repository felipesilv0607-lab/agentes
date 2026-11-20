import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Detecta texto UTF-8 que foi decodificado como Latin-1 (ISO-8859-1) ou
// Windows-1252 (mojibake). Todos os caracteres do padrão são montados a partir
// de code points numéricos, para que este arquivo não contenha as sequências
// que procura.
//
// Cobertura: caracteres UTF-8 de 2 bytes iniciados por 0xC2/0xC3 (todas as
// letras acentuadas do português, "·", "º", "ª"), as sequências de 3 bytes
// iniciadas por 0xE2 0x80 (aspas curvas, travessões, reticências) e o
// caractere de substituição U+FFFD.
// Fora da cobertura (aceito para texto em português): outros caracteres de
// 3 bytes (ex.: setas, "✓"), emojis (4 bytes) e letras iniciadas por 0xC4-0xDF.
const cp = (...codes) => String.fromCodePoint(...codes);
// Nenhum dos caracteres usados é especial dentro de uma classe de regex
// (`]`, `\`, `^`, `-`); por isso são inseridos diretamente na fonte montada.
const escapeClass = (chars) => chars;

// Bytes de continuação UTF-8 (0x80-0xBF) vistos como Latin-1: U+0080-U+00BF.
// Os bytes 0x80-0x9F vistos como Windows-1252 viram estes caracteres:
const windows1252High = cp(
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
);
const continuation = `[${cp(0x80)}-${cp(0xbf)}${escapeClass(windows1252High)}]`;
const leadBytes = escapeClass(cp(0xc2, 0xc3)); // bytes iniciais de 2 bytes mais comuns em português
const MOJIBAKE = new RegExp(
  [
    `[${leadBytes}]${continuation}`, // ex.: letra acentuada de 2 bytes
    // Aspas, travessões e reticências de 3 bytes (E2 80 xx): o byte 0x80 vira
    // U+0080 em ISO-8859-1 e "€" (U+20AC) em Windows-1252.
    `${escapeClass(cp(0xe2))}[${escapeClass(cp(0x80, 0x20ac))}]`,
    escapeClass(cp(0xfffd)), // caractere de substituição
  ].join("|"),
  "u",
);

// Arquivos de texto rastreados e também os novos ainda não rastreados (exceto os
// ignorados pelo .gitignore), para que um arquivo novo seja verificado antes do commit.
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".md", ".toml", ".yml", ".yaml",
]);
const EXCLUDED = new Set(["apps/dashboard/package-lock.json"]);

function repositoryTextFiles() {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || file === ".gitignore")
    .filter((file) => !EXCLUDED.has(file))
    // Arquivo removido localmente, mas ainda no índice do Git, não existe para leitura.
    .filter((file) => existsSync(path.join(repoRoot, file)));
}

function findMojibake(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (MOJIBAKE.test(line)) findings.push({ line: index + 1, text: line.trim().slice(0, 120) });
  });
  return findings;
}

// Gera mojibake em tempo de execução: bytes UTF-8 decodificados como outra codificação.
// Atenção: `new TextDecoder("latin1")` NÃO é ISO-8859-1. Pelo padrão WHATWG Encoding,
// o rótulo "latin1" é um alias de windows-1252. O ISO-8859-1 real (cada byte vira o
// code point de mesmo valor, U+0000-U+00FF) é obtido com Buffer#toString("latin1").
const DECODERS = {
  "iso-8859-1": (bytes) => bytes.toString("latin1"),
  "windows-1252": (bytes) => new TextDecoder("windows-1252").decode(bytes),
};
const corrupt = (word, encoding) => DECODERS[encoding](Buffer.from(word, "utf8"));
const LEGIT_WORDS = [
  "não", "Coordenação", "Revisão de código", "SIMULAÇÃO", "OPERAÇÕES", "ÚLTIMA", "É", "Ó", "Õ", "Á",
  "ação · item", "texto — travessão", "“aspas”", "reticências…",
];

test("os dois decodificadores de teste são realmente diferentes", () => {
  // "Ç" = UTF-8 C3 87. O byte 0x87 vira U+0087 em ISO-8859-1 e "‡" (U+2021) em Windows-1252.
  assert.equal(corrupt("Ç", "iso-8859-1"), cp(0xc3, 0x87));
  assert.equal(corrupt("Ç", "windows-1252"), cp(0xc3, 0x2021));
  assert.equal(new TextDecoder("latin1").encoding, "windows-1252", "alias WHATWG documentado acima");
});

test("detector reconhece mojibake gerado a partir de ISO-8859-1 e Windows-1252", () => {
  for (const encoding of Object.keys(DECODERS)) {
    for (const word of LEGIT_WORDS) {
      const broken = corrupt(word, encoding);
      assert.ok(findMojibake(broken).length > 0, `não detectou ${encoding}: ${JSON.stringify(broken)}`);
    }
  }
  assert.ok(findMojibake(`x${cp(0xfffd)}y`).length > 0, "não detectou o caractere de substituição");
});

test("detector não acusa português legítimo", () => {
  assert.deepEqual(findMojibake(LEGIT_WORDS.join(" | ")), []);
  assert.deepEqual(findMojibake("Â isolado · ÃO · NÃO — “SIMULAÇÃO”"), []);
});

test("arquivos de texto do repositório não contêm mojibake", () => {
  const files = repositoryTextFiles();
  assert.ok(files.includes("scripts/encoding.test.mjs"), "o próprio teste deve estar no escopo verificado");

  const problems = [];
  for (const file of files) {
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    for (const finding of findMojibake(text)) problems.push(`${file}:${finding.line}: ${finding.text}`);
  }

  assert.deepEqual(problems, [], `Possível mojibake encontrado:\n${problems.join("\n")}`);
});
