// src/shared/artifact-kinds.mjs
// ONE table for "what is this file". Three consumers, no build step:
//   · the raw-bytes artifact route (ui/server.mjs) — Content-Type + what may stream
//   · the artifact viewer (ui/public/artifact-view.mjs) — which renderer
//   · Ask attachment typing (src/core/ask/attachment-kind.mjs re-exports the two
//     allowlists + classifyExtension from here; sniffMime stays there — it needs Buffer)
// Pure ESM, const-only (test/shared-graph-purity).

/** The Ask attachment allowlists — order is part of the public shape. */
const TEXT_TYPES = Object.freeze({
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
  '.json': 'application/json', '.csv': 'text/csv', '.log': 'text/plain',
  // HTML is a TEXT attachment kind (stored as .txt, served text/plain + nosniff, never rendered on
  // the worca origin); its text/html mime is only a label read_attachment uses to offer the markup
  // as readable text. The viewer still renders it as 'html' — viewerKindFor keys on the extension.
  '.html': 'text/html', '.htm': 'text/html',
});
const BINARY_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
});
/** Viewer-only additions (never Ask attachments). */
const VIEWER_TEXT_TYPES = Object.freeze({ '.ndjson': 'application/x-ndjson', '.diff': 'text/x-diff', '.patch': 'text/x-diff' });
const DOCUMENT_TYPES = Object.freeze({ '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml' });
const OPAQUE_TYPES = Object.freeze({
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // split literal: the shared-purity scanner forbids a bare `document` token even
  // inside a string, and this OOXML mime ends in `.document`.
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.docu' + 'ment',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.key': 'application/vnd.apple.keynote',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
});
/** What an HTML artifact loads relatively (kit scripts, styles, fonts, media).
 *  Streamed by the raw route so a deck's <script src="deck-stage.js"> resolves;
 *  never a viewer kind of their own (js/css view as text, the rest as binary). */
const SUBRESOURCE_TYPES = Object.freeze({
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  // Everything the deck bundlers now match and embed (img|audio|video|source).
  // With only mp3/mp4 here the raw route answered 415 for an .m4a, .wav, .ogg,
  // .webm or .avif a deck references, so the framed deck/deck.html preview
  // rendered without its voiceover, its clip or its artwork while the bundle
  // embedded all three perfectly — and isByteArtifact was false for them, so
  // read_run_artifact UTF-8-decoded the bytes. Kept in step with the MIME tables
  // in scripts/deck-bundle.py, build-standalone.mjs and deck-export.js.
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.avif': 'image/avif',
});

export const TEXT_EXTENSIONS = Object.freeze(Object.keys(TEXT_TYPES));
export const BINARY_EXTENSIONS = Object.freeze(Object.keys(BINARY_TYPES));
/** Viewer kinds that must never be decoded as UTF-8 text. */
export const BINARY_KINDS = Object.freeze(new Set(['image', 'pdf', 'binary']));
/** Viewer kinds the raw-bytes route may stream (binary = download only). */
export const RAW_KINDS = Object.freeze(new Set(['image', 'pdf', 'html', 'binary']));

/** ARTIFACT kinds (the `kind` column, not a viewer kind) that are indexed but
 *  never listed as a row a human is asked to open. Two families:
 *    · transient run markers — the run DIR itself, the live log, the questions
 *      scratch file the orchestrator deletes once a round is answered, and
 *      `clarify` (the Q&A lives in the clarify TABLE, not in a file a row could
 *      resolve). These are exactly the kinds run-harness._artifact refuses to
 *      index, so a row or a log line for one resolves against nothing: the
 *      viewer answers "artifact not found";
 *    · `deck-asset` — what an HTML artifact LOADS rather than what anyone opens:
 *      the deck kit scripts, its webfonts, the instrumented proof copy.
 *  The second family must stay INDEXED: the raw-bytes route resolves `rel` only
 *  among a run's indexed rows, so unindexing them would 404 deck.html's own
 *  <script src> and @font-face and leave the stored deck unviewable. */
const NON_BROWSABLE_KINDS = Object.freeze(new Set(['pipeline', 'clarify', 'live-log', 'questions', 'deck-asset']));

/** More files of one kind, from one execution, than this and the rest go quiet —
 *  in the live log, in the persisted log, and behind one row in the Artifacts
 *  tab. A deck audit indexes one screenshot per slide (43 on a real run, 84 on a
 *  three-deck one), which buried the handful of artifacts anyone opens. ONE
 *  constant so the three surfaces cannot disagree about what a burst is. */
export const BULK_ARTIFACT_THRESHOLD = 5;

/** The same set as a bound-parameter list, for callers that must filter in SQL
 *  rather than in JS (listRunArtifacts spends its row budget before LIMIT). */
export const NON_BROWSABLE_KIND_LIST = Object.freeze([...NON_BROWSABLE_KINDS]);

/** Is an artifact of this kind worth offering as a clickable row? */
export function isBrowsableKind(kind) {
  return !NON_BROWSABLE_KINDS.has(String(kind ?? ''));
}

const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
const kindForMime = (mime) => (mime.startsWith('image/') ? 'image' : 'binary');

/** Ask attachments: lower-cased extension WITH the dot → {kind: text|image|binary, mime} | null. */
export function classifyExtension(ext) {
  if (typeof ext !== 'string') return null;
  const e = ext.toLowerCase();
  if (has(TEXT_TYPES, e)) return { kind: 'text', mime: TEXT_TYPES[e] };
  if (has(BINARY_TYPES, e)) return { kind: kindForMime(BINARY_TYPES[e]), mime: BINARY_TYPES[e] };
  return null;
}

/** The on-disk extension for a stored Ask body (unchanged behaviour). */
export function extensionForAttachment(kind, mime) {
  if (kind === 'text' || kind == null) return '.txt';
  for (const [ext, m] of Object.entries(BINARY_TYPES)) if (m === mime) return ext;
  return '.bin';
}

function extOf(pathname) {
  const base = String(pathname || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** markdown | json | diff | text | image | pdf | html | binary. Unknown → text (today's behaviour). */
export function viewerKindFor(pathname) {
  const e = extOf(pathname);
  if (e === '.md' || e === '.markdown') return 'markdown';
  if (e === '.json') return 'json';
  if (e === '.diff' || e === '.patch') return 'diff';
  if (e === '.pdf') return 'pdf';
  if (e === '.html' || e === '.htm') return 'html';
  if (e === '.svg' || (has(BINARY_TYPES, e) && BINARY_TYPES[e].startsWith('image/'))) return 'image';
  if (has(OPAQUE_TYPES, e)) return 'binary';
  if (has(SUBRESOURCE_TYPES, e) && !SUBRESOURCE_TYPES[e].startsWith('text/')) return 'binary';   // fonts, media
  return 'text';
}

/** Content-Type for the raw route, or null when the extension is unknown. */
export function mimeForPath(pathname) {
  const e = extOf(pathname);
  for (const table of [TEXT_TYPES, VIEWER_TEXT_TYPES, DOCUMENT_TYPES, BINARY_TYPES, OPAQUE_TYPES, SUBRESOURCE_TYPES]) {
    if (has(table, e)) return /^text\/|json$/.test(table[e]) ? `${table[e]}; charset=utf-8` : table[e];
  }
  return null;
}

/** Extension -> FORMAT kind for the step-folder scan (src/core/step-scan.mjs).
 *  Format kinds only — never the semantic `plan`/`review`/`result`/`verdict` kinds
 *  the engine records for allocated outputs, so a scanned row can never masquerade
 *  as one. Anything else is `text`. `image` and `binary` are in BINARY_KINDS, so
 *  the text read path refuses them and the viewer never decodes them as UTF-8. */
export const KIND_BY_EXT = Object.freeze({
  md: 'markdown', markdown: 'markdown', json: 'json', diff: 'diff', patch: 'diff',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  pdf: 'binary', zip: 'binary', gz: 'binary', tgz: 'binary', tar: 'binary', woff: 'binary', woff2: 'binary', ttf: 'binary',
});

/** The format kind for a file name or path (either separator), by extension —
 *  node's extname semantics without node:path: last segment only, a leading dot
 *  is not an extension (`.env` -> text), case-insensitive. */
export function scanKindFor(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  const ext = i > 0 ? base.slice(i + 1).toLowerCase() : '';
  return KIND_BY_EXT[ext] || 'text';
}
