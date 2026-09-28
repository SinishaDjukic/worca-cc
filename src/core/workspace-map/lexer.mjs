// src/core/workspace-map/lexer.mjs
// ONE generic lexer for every text file (spec D13): the candidate search is language-agnostic,
// so it reads string literals and config values the same way in Kotlin, Go, YAML or .env.
// Single-line only: a literal that spans lines is not a URL, a topic or a package name.
// Linear in the line: no regex backtracks over a run, and a quote whose scan ran off the line is
// never re-scanned (a 1 MiB line of `\"` or `${` used to take minutes).

import { redactLines } from '../../shared/workspace-map/redact.mjs';

const MAX_LITERAL = 500;
const MAX_PER_LINE = 50;
const COMMENT_RE = /^(\/\/|#|\/\*|\*(\s|\/|$)|<!--|--\s|;)/;
const KV_RE = /^\s*(?:export\s+)?[A-Za-z_][\w.[\]-]*\s*[:=]\s*(.*)/;
const LIST_RE = /^\s*-\s+(.*)/;

/** Scans a quoted literal starting at `line[start]` (the quote). → { end, raw, value } | null */
function scanQuoted(line, start) {
  const q = line[start];
  let value = '';
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') { value += line.slice(i, i + 2); i += 2; continue; }
    if (ch === q) return { end: i, raw: line.slice(start + 1, i), value };
    if (q === '`' && ch === '$' && line[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < line.length && depth > 0) {
        if (line[j] === '{') depth += 1;
        else if (line[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth > 0) return null;
      value += '{}';
      i = j;
      continue;
    }
    value += ch;
    i += 1;
  }
  return null;
}

function cleanValue(v) {
  const hash = v.search(/\s#/);
  let s = (hash >= 0 ? v.slice(0, hash) : v).trimEnd().replace(/[,;]$/, '').trim();
  if (/^["'`]/.test(s) || /^[{[|>]/.test(s)) return '';
  return s;
}

/** Skips obvious comments only when trivially detectable (the line starts with one). Every line
 *  is redacted (redactLines: redactSecrets per line, PEM bodies blanked) BEFORE it is lexed, so
 *  no literal carries a secret.
 *  @returns {Array<{value:string, raw:string, line:number, via:'quoted'|'template'|'kv'}>}
 *  `value` is what matching sees (`${…}` → '{}'); `raw` is the literal text as it stands in the
 *  (redacted) line, so a candidate's `match` is always a substring of what verifyFact compares. */
export function extractLiterals(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  const redacted = redactLines(lines);
  for (let n = 0; n < lines.length; n += 1) {
    if (!lines[n] || COMMENT_RE.test(lines[n].trimStart())) continue;
    const line = redacted[n];
    const seen = new Set();
    const dead = new Set(); // a quote char whose scan ran off the line: every later one would too
    const push = (value, raw, via) => {
      if (!value || value === '***' || value.length > MAX_LITERAL || seen.has(value) || seen.size >= MAX_PER_LINE) return;
      seen.add(value);
      out.push({ value, raw, line: n + 1, via });
    };
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if ((ch !== '"' && ch !== "'" && ch !== '`') || dead.has(ch)) continue;
      const lit = scanQuoted(line, i);
      if (!lit) { dead.add(ch); continue; }
      push(lit.value.trim() === lit.value ? lit.value : lit.value.trim(), lit.raw, ch === '`' ? 'template' : 'quoted');
      i = lit.end;
    }
    const kv = KV_RE.exec(line) || LIST_RE.exec(line);
    if (kv) {
      const v = cleanValue(kv[1]);
      if (v) push(v, v, 'kv');
    }
  }
  return out;
}
