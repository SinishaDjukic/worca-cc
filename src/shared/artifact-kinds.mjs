// src/shared/artifact-kinds.mjs — the artifact FORMAT kinds keyed by file
// extension. Pure and browser-importable (served under /src/shared): the step
// folder scanner (src/core/step-scan.mjs) labels files with it, the artifact read
// route refuses image/binary kinds by it (artifacts.mjs BINARY_KINDS), and the
// artifact viewer (ui/public/artifact-view.mjs) derives its "never fetch as text"
// set from it — ONE table, so the route and the viewer cannot drift.

/** Extension -> kind. FORMAT kinds only — never the semantic `plan`/`review`/
 *  `result`/`verdict` kinds the engine records for allocated outputs, so a scanned
 *  row can never masquerade as one. Anything else is `text`. */
export const KIND_BY_EXT = Object.freeze({
  md: 'markdown', markdown: 'markdown', json: 'json', diff: 'diff', patch: 'diff',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  pdf: 'binary', zip: 'binary', gz: 'binary', tgz: 'binary', tar: 'binary', woff: 'binary', woff2: 'binary', ttf: 'binary',
});

/** The kinds never read or rendered as text. */
export const BINARY_KINDS = Object.freeze(new Set(['image', 'binary']));

/** The format kind for a file name or path (either separator), by extension —
 *  node's extname semantics without node:path: last segment only, a leading dot
 *  is not an extension (`.env` -> text), case-insensitive. */
export function scanKindFor(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  const ext = i > 0 ? base.slice(i + 1).toLowerCase() : '';
  return KIND_BY_EXT[ext] || 'text';
}
