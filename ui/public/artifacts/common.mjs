// ui/public/artifacts/common.mjs — pure helpers the artifact browser and the popup viewer share (Chat P5): what a row
// is called, how big it is, which preview it gets, and a small CSV reader. No DOM, nothing runs at import.
import { viewerKindFor } from '../artifact-view-c4.mjs';
import { langForPath } from '../syntax-highlight.mjs';

/** Text previews are fetched whole (GET …/artifact?rel=, decoded JSON); past this a file opens on the info view. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** A CSV/TSV is a table only when it is this small; otherwise it reads as text. */
export const CSV_MAX_BYTES = 256 * 1024;
export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLS = 50;
/** Preview kinds whose bytes the viewer frames from the raw route (probed with HEAD first). */
export const RAW_PREVIEW_KINDS = Object.freeze(new Set(['image', 'pdf', 'html', 'audio', 'video']));
/** Byte formats no kind table names (the chain reads an unknown extension as text): media the raw route does not
 *  serve, archives, executables, databases. They open on the info view, never as a page of decoded bytes. */
export const NO_PREVIEW_EXT = /\.(mov|m4v|mkv|avi|ogv|oga|opus|flac|aac|wma|gz|tgz|bz2|xz|7z|rar|jar|exe|dll|so|dylib|wasm|class|sqlite|db)$/i;

/** The path an artifact row names: server rows carry a run-relative `relPath`, live WS events an absolute `path`. */
export function relOf(a) {
  return String((a && (a.relPath || a.path)) || '');
}

/** POSIX root, a Windows drive, or a UNC share. */
export function isAbsolutePath(p) {
  return /^(\/|\\\\|[A-Za-z]:[\\/])/.test(String(p || ''));
}

/** The last path segment, either separator (a Windows live path uses `\`). */
export function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

/** What a tooltip or the info view may show: a run-relative path as it is, an absolute one as its file name — never
 *  the user's home directory. */
export function displayPath(p) {
  return isAbsolutePath(p) ? baseName(p) : String(p || '');
}

/** Compact byte size: "0 B", "1.5 KB", "26.0 MB". */
export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** A long file name cut in the middle, its extension kept: "a-very-long-na…ing-name.md". */
export function midTruncate(name, max = 44) {
  const s = String(name ?? '');
  const cs = Array.from(s);                      // by code point: a cut never splits a surrogate pair
  if (cs.length <= max) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
  const extLen = Array.from(ext).length;
  const keep = Math.max(2, max - 1 - extLen);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${cs.slice(0, head).join('')}…${cs.slice(cs.length - extLen - tail).join('')}`;
}

/**
 * Which preview the viewer gives a file: the existing chain's answer (artifact-view-c4 → -media → base: the extension
 * first, a plan/review/result the extension says nothing about by its kind), widened with `code` (a text file hljs
 * knows), `csv` (.csv/.tsv) and `none` (opaque documents, archives, fonts — no preview). An extension that names a
 * table, a language or a byte format wins over the kind: a `result` that is `data.csv` is a table, not a diff.
 * @returns {'markdown'|'json'|'diff'|'text'|'code'|'csv'|'image'|'pdf'|'html'|'c4'|'audio'|'video'|'none'}
 */
export function previewKindFor(kind, relPath = '') {
  const rel = String(relPath);
  if (viewerKindFor(null, rel) === 'text') {
    if (NO_PREVIEW_EXT.test(rel)) return 'none';
    if (/\.(csv|tsv)$/i.test(rel)) return 'csv';
    if (/\.[^./\\]+$/.test(rel) && langForPath(rel)) return 'code';
  }
  const v = viewerKindFor(kind ?? null, rel);
  if (v === 'binary') return 'none';
  if (v !== 'text') return v;
  return langForPath(rel) ? 'code' : 'text';
}

/**
 * CSV/TSV with RFC 4180 quoting ("a, b", "say ""hi""", CRLF or LF) → rows of cells. null when it is not a small,
 * well-formed table: an unclosed quote, more than `maxRows` rows or more than `maxCols` columns.
 */
export function parseDelimited(text, sep = ',', { maxRows = CSV_MAX_ROWS, maxCols = CSV_MAX_COLS } = {}) {
  const raw = String(text ?? '');
  const s = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;   // a byte-order mark (Excel's "CSV UTF-8") is not text
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(cell); cell = ''; return row.length <= maxCols; };
  const endRow = () => { rows.push(row); row = []; return rows.length <= maxRows; };
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      continue;
    }
    if (c === '"' && cell === '') { quoted = true; continue; }
    if (c === sep) { if (!endCell()) return null; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      if (!endCell() || !endRow()) return null;
      continue;
    }
    cell += c;
  }
  if (quoted) return null;
  if ((cell !== '' || row.length) && (!endCell() || !endRow())) return null;
  return rows;
}
