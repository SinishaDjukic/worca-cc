// Shared helpers for the P3/P4 detectors: line evidence, comment blanking, the output hygiene
// every P3 detector applies (one fact per (file, dir, key, target host), cleaned unresolved items, minified JS
// skipped), and resolving a path / image reference to a workspace member. Pure except for the
// process.platform read in samePathOrInside. Never throws on bad input.
import { resolve, sep, basename } from 'node:path';
import { LIMITS } from '../../../../shared/workspace-map/limits.mjs';
import { isTestPath } from '../../files.mjs';

/** A file under a `docs/`, `examples/` or `samples/` directory (singular too): a sample deployment or config,
 *  never this member's own wiring — the deploy and config detectors read nothing there. */
export const isSamplePath = (rel) => /(?:^|\/)(?:docs?|examples?|samples?|quickstarts?|tutorials?)\//i.test(rel);

/** A sample app's package manifest (M8): under a sample folder at the member root (`examples/checkout-demo/package.json`,
 *  `docs/requirements.txt`), or in a folder of its own below an examples / samples folder anywhere (`sdk/examples/demo/package.json`;
 *  never below a nested `docs/`, a monorepo's grouping folder: Nx's `libs/docs/data-access/package.json`).
 *  A package that IS such a folder below the root (Turborepo's `apps/docs/package.json`, `services/docs/go.mod`) is a
 *  real package of this member. The manifest detectors only: code and API specs there are read. */
export const isSampleManifest = (rel) => /^(?:docs?|examples?|samples?|quickstarts?|tutorials?)\/|(?:^|\/)(?:examples?|samples?|quickstarts?|tutorials?)\/[^/]{1,255}\//i.test(rel);

// Source code a service runs. Tooling a deploy repo carries — Go tool pins (`internal/tools/tools.go`), CI helpers,
// scripts — and test code are no service's code: opentelemetry-demo's root holds `internal/tools/sanitycheck.py`.
const CODE_RE = /\.(?:go|java|kt|kts|scala|sc|groovy|py|ipynb|rb|php|js|mjs|cjs|jsx|ts|mts|cts|tsx|vue|svelte|astro|cs|fs|fsx|vb|rs|c|cc|cpp|cxx|h|hpp|mm|swift|m|ex|exs|erl|gleam|clj|cljs|cljc|dart|lua|pl|pm|hs|ml|jl|r|cr|nim|zig|elm|sol)$/i;
const TOOLING_RE = /(?:^|\/)(?:tools?|hack|scripts?|ci|\.github|\.gitlab|\.circleci|\.buildkite|\.devcontainer|\.husky|\.yarn)\//i;
// Nor are a repository's config and task-runner files (`commitlint.config.js`, `release.config.js`, `.eslintrc.js`, any dotfile,
// `dangerfile.ts`, `Gruntfile.js`, `noxfile.py`, `magefile.go`, `fabfile.py`, `tasks.py`, `conftest.py`, Sphinx's `conf.py`,
// `sentry.conf.example.py`), load and integration tests (`load-test/locustfile.py`, `k6/`, `_integration-test/`) or the
// top-level `docs/` / `examples/` trees (only at the top: `src/main/java/com/example/` is a service's own package).
const TOOL_FILE_RE = /(?:^|\/)(?:\.[^/]+|[\w-]+(?:\.[\w-]+)*\.(?:config|conf)(?:\.example)?\.[a-z]+|(?:dangerfile|gruntfile|gulpfile|jakefile|noxfile|magefile|fabfile|renovate|tasks|conftest|setup|conf)\.[a-z]+)$|(?:^|\/)(?:_?[\w-]*integration[-_]tests?|load[-_]?tests?|perf|k6|locust|benchmarks?)\/|^(?:docs?|examples?|samples?|quickstarts?|tutorials?)\//i;
/** true when the member holds service code (cached in the detector's ctx.state); false for a deploy repo of
 *  compose files, manifests, charts, a `.env` and tooling. */
export function hasCode(ctx) {
  const st = ctx?.state && typeof ctx.state === 'object' ? ctx.state : {};
  st.hasCode ??= Array.isArray(ctx?.files) && ctx.files.some((f) => CODE_RE.test(f) && !isTestPath(f) && !TOOLING_RE.test(f) && !TOOL_FILE_RE.test(f));
  return st.hasCode;
}

/** Whether a manifest at `rel` may alias the member with `name`: never a test-path manifest; a
 *  nested (non-root) manifest only for a multi-word name (`billing-api`, not `api` / `core`,
 *  which would claim every `api.*` host in the workspace). */
export const aliasable = (rel, name) => typeof name === 'string' && !!name.trim() && !isTestPath(rel)
  && (!rel.includes('/') || /[-_.]/.test(name.trim()));

export const splitLines = (text) => String(text ?? '').split(/\r?\n/);

export function clip(s, max = LIMITS.MATCH_MAX) {
  const v = String(s ?? '');
  return v.length > max ? v.slice(0, max) : v;
}

/** offset (0-based, into text) → 1-based line; built once per file (binary search). */
export function lineIndex(text) {
  const starts = [0];
  const t = String(text ?? '');
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** 1-based line of the first line at index >= from (0-based) containing needle; wraps to
 *  the top once; 0 when absent. */
export function locate(lines, needle, from = 0) {
  if (!needle) return 0;
  for (let i = Math.max(0, from); i < lines.length; i += 1) if (lines[i].includes(needle)) return i + 1;
  for (let i = 0; i < Math.min(from, lines.length); i += 1) if (lines[i].includes(needle)) return i + 1;
  return 0;
}

const LONG_LINE = 4096;
const LONG_MISSES = 32;
const CURSOR = new WeakMap(); // lines array → Map(line → { at, misses })

// A cited cut never ends inside a value: extract redacts `match` only AFTER this cut, and a credential
// cut short of its end (`postgres://app:pa…` without its `@host`, `app:pa=…` of a Go DSN without its
// `@tcp(…)`, an unclosed `"Password":"pa,…`) is no longer recognisable (P1's note to P3: keep a match
// short and whole). So a head ends only before whitespace, a double quote, a backtick or `<` / `>` —
// characters no URL, DSN or password holds raw (`= & ; , ( ) '` may all sit inside a password).
const CUT_AT = ' \t"`<>';
/** `s` when it fits in `max` chars; else its longest prefix of at most `max` chars that ends right
 *  before whitespace, `"`, a backtick, `<` or `>`, trimmed; else its first character. Either way the
 *  text stops before its first JSON-escaped URL (`http:\/\/…`: redaction reads `://` only). Never a
 *  prefix that stops inside a quoted or whitespace-delimited value. */
export function clipWhole(s, max = LIMITS.MATCH_MAX) {
  const v = String(s ?? '');
  let head = v.length <= max ? v : null;
  for (let i = max; head === null && i > 0; i -= 1) {
    if (CUT_AT.includes(v[i])) head = v.slice(0, i).trimEnd() || null;
  }
  head ??= v.slice(0, 1);
  // Any backslash escape (`http:\/\/`, YAML `\x2F` / `\x40`, a JSON unicode escape of `@`): the parsed value is not the text, and
  // redaction reads the literal `://` and `@` only — the head stops before the value holding the first one.
  let esc = head.indexOf('\\');
  if (esc === -1) return head;
  while (esc > 0 && !CUT_AT.includes(head[esc - 1])) esc -= 1;
  return head.slice(0, esc).trimEnd() || head.slice(0, 1);
}

// Templates as written in a host or port (`${X}`, `${X:-d}`, `$X`, `$(X)` — Kubernetes —, `{x}`, `{{x}}`, `%X%`); `${PASS:-pa` (a default cut at a '/') is none.
const TEMPLATE_RE = /\$\{[^{}]*\}|\$\(\w+\)|\{\{?[\w.-]*\}?\}|%\w+%|\$\w+/g;
/** true when a host[:port] as written holds a ':' that no port follows (`app:pa` — a userinfo, never a host).
 *  Templates read as a port digit; an IPv6 literal's own colons (`[::1]:8080`) do not count. */
export function notPort(hostish) {
  let h = String(hostish ?? '').replace(TEMPLATE_RE, '0');
  if (h.startsWith('[')) h = h.slice(h.indexOf(']') + 1);
  const c = h.indexOf(':');
  return c !== -1 && !/^\d*$/.test(h.slice(c + 1));
}

/** Index where the authority of `rest` (a URL after its `scheme://`) ends: its first '/', '?' or '#' — or,
 *  for `user:pa/ss@host` (an unencoded '/', '?' or '#' in a password, which SQLAlchemy accepts: the text
 *  before it is `user:<not a port>`, and an '@' follows before any '?' or '#'), the first one after that
 *  '@'. -1 = no path. */
export function authorityEnd(rest) {
  const s = String(rest ?? '');
  const end = s.search(/[/?#]/);
  if (end === -1) return -1;
  const head = s.slice(0, end);
  const at = s.indexOf('@', end);
  // A query / fragment before the '@' (`/invoices?cc=ops@acme.com`) means the '@' is not the end of a userinfo.
  if (at === -1 || head.includes('@') || /[?#]/.test(s.slice(end + 1, at))) return end;
  // Nor does a port (digits, or a template: `${PORT}`, `{port}`) or an IPv6 literal. An EMPTY port is none (`app:/Zq9@db`:
  // a password that starts with '/') — unless the '@' opens a path segment (`billing-api:/v1/items/@x`).
  if (!notPort(head) && (!/^[^[]*:$/.test(head) || s[at - 1] === '/')) return end;
  const next = s.slice(at + 1).search(/[/?#]/);
  return next === -1 ? -1 : at + 1 + next;
}

/** The userinfo as redaction reads it (redact.mjs USERINFO): to the last '@' before a '/', a space or a quote. */
const USERINFO_AT = /^[^\s/:'"`]{0,256}:[^\s/'"`]{0,2048}@/;
/** A needle as cited: itself when it fits in 200 chars; else, for a URL with userinfo (a long token as the
 *  password — a JWT, a SAS signature — would be cut before its `@host`, which leaves it unrecognisable to
 *  redaction), the URL from its host on; else its first 200 chars. The userinfo ends at the later of the
 *  authority's last '@' and the one redaction reads: an e-mail / Azure-style user whose password holds '#' or
 *  '?' (`reports@acme.com:pw#24@billing`) ends past the authority authorityEnd reads. */
function clipNeedle(needle) {
  if (needle.length <= LIMITS.MATCH_MAX) return needle;
  const s = needle.indexOf('://');
  if (s !== -1) {
    const rest = needle.slice(s + 3);
    const end = authorityEnd(rest);
    const u = USERINFO_AT.exec(rest);
    const at = Math.max((end === -1 ? rest : rest.slice(0, end)).lastIndexOf('@'), u ? u[0].length - 1 : -1);
    if (at !== -1) return clip(rest.slice(at + 1)) || needle.slice(0, 1);
  }
  return clip(needle);
}

/** true when `needle` is on line `line`; a line longer than 4 KiB is searched from the previous hit on it
 *  and, after 32 step-backs or misses, no longer searched at all. */
function onLine(lines, line, text, needle) {
  if (text.length <= LONG_LINE) return text.includes(needle);
  let byLine = CURSOR.get(lines);
  if (!byLine) { byLine = new Map(); CURSOR.set(lines, byLine); }
  const c = byLine.get(line) || { at: 0, misses: 0 };
  byLine.set(line, c);
  if (c.misses >= LONG_MISSES) return false;
  let at = text.indexOf(needle, c.at);
  if (at === -1) { c.misses += 1; if (c.at > 0) at = text.indexOf(needle); }
  if (at === -1) return false;
  c.at = at;
  return true;
}

/** {line, match}: match = the needle when it is on that line (`clipNeedle`), else `alt` when that is (a
 *  config value's needle is not on its line when the file escapes it — JSON `http:\/\/…`, a YAML
 *  double-quoted escape —, so the caller passes the key as written), else the trimmed line cut by
 *  `clipWhole` — never inside a token or a URL, since the head of a line may end in the middle of
 *  ANOTHER value. A line longer than 4 KiB (minified JSON, a one-line schema or csproj) is searched from
 *  the previous hit on it, so facts cited in document order cost one pass over the line in total; a
 *  search that has to step back or misses counts, and after 32 of those the line is no longer searched
 *  (its head is cited) — never facts × line length. */
export function evidence(lines, line, needle, alt) {
  const text = lines[line - 1] ?? '';
  for (const n of [needle, alt]) if (typeof n === 'string' && n && onLine(lines, line, text, n)) return { line, match: clipNeedle(n) };
  return { line, match: clipWhole(text.trim()) };
}

/** A PartialFact with clipped match/detail; `needle` (else `alt`) should be on `line` (else the line's
 *  head is cited — `evidence`). */
export function fact({ kind, dir, key, rel, lines, line, needle, alt, detail, target, label, confidence }) {
  const ev = evidence(lines, line, needle, alt);
  const f = { kind, dir, key, file: rel, line: ev.line, match: ev.match };
  if (detail) f.detail = clip(detail, LIMITS.DETAIL_MAX);
  if (label) f.label = clip(label, LIMITS.LABEL_MAX);
  if (target) f.target = String(target);
  if (confidence) f.confidence = confidence;
  return f;
}

/** One fact per (file, dir, key, target host) — the first occurrence (a file naming one host ten
 *  times, or a finish() pass over many files, must not spend the member's 5 000-fact cap). The
 *  target's host is part of the identity (P1's note to P4 about `firstPerKey`, restated): two peers
 *  reached by one path (`BILLING_API_URL=http://localhost:8081/api`, `LEDGER_API_URL=
 *  http://localhost:8082/api`, a gateway's two `/graphql` subgraphs) are two consumes, while one
 *  host written with and without a port (`billing`, `billing:8080`) stays one fact. */
export function onePerKey(facts) {
  const seen = new Set();
  return (Array.isArray(facts) ? facts : []).filter((f) => {
    const host = typeof f.target === 'string' ? f.target.replace(/:\d{1,5}$/, '').toLowerCase() : '';
    const k = JSON.stringify([f.file, f.dir, f.key, host]);
    return !seen.has(k) && seen.add(k);
  });
}

const UNRESOLVED_MAX = 50;
/** The unresolved items a detector hands back, cleaned like P4's code detectors do: none from a
 *  test path (test code never creates edges; its gaps must not lower coverage), one per (file,
 *  trimmed raw text), at most 50 per detector per member (counted in `st` = the detector's
 *  ctx.state). `rel` = the file of a per-file list; null for a finish() list (each item's own
 *  `file` is checked). */
export function cleanUnresolved(st, rel, list) {
  const out = [];
  if (!Array.isArray(list) || !list.length) return out;
  const s = st && typeof st === 'object' ? st : {};
  s.unresolvedSeen ??= new Set();
  for (const u of list) {
    const file = rel ?? u?.file;
    if (typeof file !== 'string' || isTestPath(file)) continue;
    const raw = String(u.raw ?? '').trim();
    const k = `${file}\u0000${raw}`;
    if (!raw || s.unresolvedSeen.has(k)) continue;
    s.unresolvedSeen.add(k);
    s.unresolvedCount = (s.unresolvedCount || 0) + 1;
    if (s.unresolvedCount > UNRESOLVED_MAX) break;
    out.push({ ...u, raw });
  }
  return out;
}

const JS_FAMILY_RE = /\.(?:js|mjs|cjs|jsx|ts|tsx)$/i;
/** A JS-family file whose first 4 KiB holds a line over 1 000 chars is minified / bundled output
 *  (P4's rule, restated here because P3 lands first): api-proto and api-graphql skip it — its
 *  stub names and gql templates belong to third-party code. Never applied to other languages. */
export function isMinified(rel, text) {
  if (!JS_FAMILY_RE.test(rel)) return false;
  const head = String(text ?? '').slice(0, 4096);
  let start = 0;
  for (;;) {
    const nl = head.indexOf('\n', start);
    if ((nl === -1 ? head.length : nl) - start > 1000) return true;
    if (nl === -1) return false;
    start = nl + 1;
  }
}

/** Replace comments with spaces (newlines kept, so offsets and line numbers survive).
 *  String literals are skipped so 'http://x' is never treated as a // comment.
 *  opts: { slash: true } → // and /* *\/; { hash: true } → # to end of line;
 *  { quotes: '"\'`' } → string delimiters honoured. */
export function blankComments(text, { slash = true, hash = false, quotes = '"\'`' } = {}) {
  const t = String(text ?? '');
  let out = '';
  let i = 0;
  const n = t.length;
  const spaces = (s) => s.replace(/[^\r\n]/g, ' ');
  while (i < n) {
    const c = t[i];
    if (quotes.includes(c)) {
      let j = i + 1;
      while (j < n && t[j] !== c) { if (t[j] === '\\') j += 1; else if (t[j] === '\n' && c !== '`') break; j += 1; }
      out += t.slice(i, j + 1); i = j + 1; continue;
    }
    // A backslash outside a string escapes the next char (a JS regex literal: `/^https?:\/\//`, `/\/*$/` open no comment).
    if (c === '\\') { out += t.slice(i, i + 2); i += 2; continue; }
    if (slash && c === '/' && t[i + 1] === '/') { const j = t.indexOf('\n', i); const e = j === -1 ? n : j; out += spaces(t.slice(i, e)); i = e; continue; }
    if (slash && c === '/' && t[i + 1] === '*') { const j = t.indexOf('*/', i + 2); const e = j === -1 ? n : j + 2; out += spaces(t.slice(i, e)); i = e; continue; }
    if (hash && c === '#') { const j = t.indexOf('\n', i); const e = j === -1 ? n : j; out += spaces(t.slice(i, e)); i = e; continue; }
    out += c; i += 1;
  }
  return out;
}

const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const canon = (p) => { const r = resolve(p); return FOLD ? r.toLowerCase() : r; };
/** true when `inner` is `outer` or inside it (case folded on win32/darwin). */
export function samePathOrInside(outer, inner) {
  const o = canon(outer); const i = canon(inner);
  return i === o || i.startsWith(o.endsWith(sep) ? o : o + sep);
}

/** The member whose projectDir is (or contains) the path `ref` written in member file `rel`
 *  (relative refs resolve against the file's directory under the member's projectDir;
 *  backslashes are accepted). Deepest projectDir wins. null when none. */
export function memberForPath(ctx, rel, ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const parts = rel.split('/').slice(0, -1);
  const target = resolve(ctx.member.projectDir, ...parts, ref.trim().replace(/\\/g, '/'));
  let best = null;
  for (const m of ctx.members || []) {
    if (!m?.projectDir || !samePathOrInside(m.projectDir, target)) continue;
    if (!best || resolve(m.projectDir).length > resolve(best.projectDir).length) best = m;
  }
  return best;
}

/** 'ghcr.io/acme/billing-api:1.2@sha256:…' → 'billing-api' (lower-case) | null. */
export function imageRepo(image) {
  if (typeof image !== 'string') return null;
  let v = image.trim();
  const at = v.indexOf('@');
  if (at !== -1) v = v.slice(0, at);
  const slash = v.lastIndexOf('/');
  const colon = v.lastIndexOf(':');
  if (colon > slash) v = v.slice(0, colon);
  const base = v.slice(slash + 1).toLowerCase();
  return /^[a-z0-9][a-z0-9._-]*$/.test(base) ? base : null;
}

/** An official single-name Docker Hub image (`redis:7`, `postgres@sha256:…`,
 *  `docker.io/library/nginx`): infrastructure, never a workspace member's own build. */
export function isLibraryImage(image) {
  if (typeof image !== 'string' || !image.trim()) return false;
  const repo = image.trim().split('@')[0].replace(/^(?:(?:index\.)?docker\.io\/)?library\//i, '');
  // A placeholder (`${IMAGE}`, `IMAGE`, `{{ .Values.image }}`, `$IMAGE_NAME`) is no Docker reference at all.
  return /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*(?::[\w][\w.-]{0,127})?$/.test(repo);
}

/** The member whose key, name, dir basename or projectDir basename equals the image's repo name. */
export function memberForImage(ctx, image) {
  const repo = imageRepo(image);
  if (!repo) return null;
  for (const m of ctx.members || []) {
    const names = [m.key, m.name, m.dir && basename(m.dir), m.projectDir && basename(m.projectDir)];
    if (names.some((x) => typeof x === 'string' && x.toLowerCase() === repo)) return m;
  }
  return null;
}
