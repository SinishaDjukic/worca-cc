// src/shared/file-refs.mjs — which words of a chat answer may name a file or folder of the chat's root (issue 1064):
// repo-relative paths (`ui/public/x.mjs`, `src/core/`), with `:120`, `:120-140`, `#L120` or `#L120-L140`, and bare
// file names (`app.js`). These are CANDIDATES only: the server confirms each one (POST /api/ask/files/resolve) and a
// word it does not confirm stays text. Absolute paths, `~`, drive letters and `..` are never candidates; Windows
// backslashes are read as slashes. Pure: no I/O, browser-safe.

/** Paths one resolve request may carry (the route answers 400 above it; the browser sends chunks of this size). */
export const FILE_REFS_MAX = 50;
export const FILE_PATH_MAX = 1024;
export const LINE_MAX = 9_999_999;

// Bounded repeats only: an answer can hold 200 000 characters, and an unbounded class before a literal backtracks.
const SEG = '[A-Za-z0-9_@-][A-Za-z0-9_.-]{0,127}';   // `@` only first (@scope/pkg): never user@host
const LAST = '[A-Za-z0-9_@-](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9_-])?';   // a last segment never ends on a dot
const EXT = '\\.[A-Za-z][A-Za-z0-9_-]{0,15}';
const LINES = '(?::([1-9]\\d{0,6})(?:-([1-9]\\d{0,6}))?|#L([1-9]\\d{0,6})(?:-L?([1-9]\\d{0,6}))?)?';
const PATH = `(?:\\.[\\\\/])?(?:${SEG}[\\\\/]){1,32}(?:${LAST})?|${SEG}${EXT}`;
// Never inside a longer word, an address, a URL path, an e-mail, `~/`, `../` or an absolute path.
const TEXT_RE = new RegExp(`(?<![\\w./\\\\@:#~=?&%-])(${PATH})${LINES}(?![\\w/\\\\-]|\\.[\\w./\\\\])`, 'g');
const CODE_RE = new RegExp(`^(${PATH})${LINES}$`);

const controlChar = (s) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** `{ path, dir }` for a path that stays inside a root (slashes, no `./`, no trailing `/`), or null. */
export function normalizeLinkPath(p) {
  const s = typeof p === 'string' ? p : '';
  if (!s || s.length > FILE_PATH_MAX || controlChar(s)) return null;
  const t = s.replace(/\\/g, '/');
  if (t.startsWith('/') || t.startsWith('~') || /^[A-Za-z]:/.test(t)) return null;
  const dir = t.endsWith('/');
  const parts = t.split('/').filter(Boolean);
  while (parts[0] === '.') parts.shift();
  if (!parts.length || parts.some((x) => x === '..' || x === '.' || /^[A-Za-z]:$/.test(x))) return null;
  return { path: parts.join('/'), dir };
}

function refOf(raw, path, a, b, c, d) {
  const n = normalizeLinkPath(path);
  if (!n) return null;
  const line = Number(a || c) || null;
  const endLine = Number(b || d) || null;
  if (endLine != null && (line == null || endLine < line)) return null;     // `:140-120` is not a range
  const bare = !n.dir && !n.path.includes('/');
  if (bare && !/\.[A-Za-z]/.test(n.path)) return null;
  return { raw, path: n.path, dir: n.dir, bare, key: n.dir ? `${n.path}/` : n.path, line, endLine };
}

/** The candidates in one text node's text: [{ start, end, ref }] in order. `ref.key` is what the server is asked. */
export function fileRefsInText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TEXT_RE)) {
    const ref = refOf(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (ref) out.push({ start: m.index, end: m.index + m[0].length, ref });
  }
  return out;
}

/** An inline code span whose WHOLE text is a path (with an optional line part), or null. */
export function fileRefFromCode(text) {
  const t = String(text || '').trim();
  if (t.length > FILE_PATH_MAX + 24) return null;
  const m = CODE_RE.exec(t);
  return m ? refOf(m[0], m[1], m[2], m[3], m[4], m[5]) : null;
}

/** A line past the end lands on the last line; an end past it is cut there (and dropped when it meets the line). */
export function clampLines(ref, lines) {
  const line = ref && Number.isInteger(ref.line) ? ref.line : null;
  const end = ref && Number.isInteger(ref.endLine) ? ref.endLine : null;
  if (line == null || !Number.isInteger(lines) || lines < 1) return { line, endLine: line == null ? null : end };
  const l = Math.min(line, lines);
  const e = end == null ? null : Math.min(end, lines);
  return { line: l, endLine: e != null && e > l ? e : null };
}
