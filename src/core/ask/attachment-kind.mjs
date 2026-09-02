// src/core/ask/attachment-kind.mjs
// Attachment typing for the Ask Worca chat (issue #398): which extensions are
// accepted, what kind/mime each maps to, and content sniffing for the binary
// ones. Pure and synchronous — the single source of truth for the type table;
// limits.mjs re-exports the two extension lists and ui/server.mjs validates
// uploads with classifyExtension + sniffMime.
//
// Kinds: 'text' (UTF-8, inlineable into the turn prompt, redactable),
// 'image' (fed to the model via its Read tool on the stored file) and
// 'binary' (today only PDF — same Read-tool path, never inlined).
//
// The extension names the CLAIMED type; for binary kinds the claim is verified
// against the leading bytes (magic number) so a mislabeled body is refused at
// upload rather than stored wrong. SVG is deliberately absent: it is scriptable
// markup, and the download route serves attachment bodies with their real mime.

/** Extension -> {kind, mime} for the text kinds (the pre-#398 allowlist). */
const TEXT_TYPES = Object.freeze({
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
});

/** Extension -> mime for the binary kinds. Every mime here MUST be sniffable. */
const BINARY_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
});

export const TEXT_EXTENSIONS = Object.freeze(Object.keys(TEXT_TYPES));
export const BINARY_EXTENSIONS = Object.freeze(Object.keys(BINARY_TYPES));

const kindForMime = (mime) => (mime.startsWith('image/') ? 'image' : 'binary');

/**
 * Classify a lower-cased extension (with the leading dot) into {kind, mime},
 * or null when it is not on either allowlist.
 */
export function classifyExtension(ext) {
  if (typeof ext !== 'string') return null;
  const e = ext.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TEXT_TYPES, e)) return { kind: 'text', mime: TEXT_TYPES[e] };
  if (Object.prototype.hasOwnProperty.call(BINARY_TYPES, e)) return { kind: kindForMime(BINARY_TYPES[e]), mime: BINARY_TYPES[e] };
  return null;
}

/**
 * Sniff the real mime of a binary body from its magic number, or null when the
 * bytes match none of the accepted binary types. Text kinds are validated by
 * UTF-8 decoding instead (ui/server.mjs), never sniffed here.
 */
export function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 3) return null;
  if (buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6) {
    const head6 = buf.toString('latin1', 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12
    && buf.toString('latin1', 0, 4) === 'RIFF'
    && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** The on-disk extension for a stored body: derived from the SNIFFED mime (or
 *  '.txt' for text kinds), never from the user-supplied name — the path stays a
 *  function of row data the store minted (store.mjs traversal guard). */
export function extensionForAttachment(kind, mime) {
  if (kind === 'text' || kind == null) return '.txt';
  for (const [ext, m] of Object.entries(BINARY_TYPES)) {
    if (m === mime) return ext; // first match: '.jpg' wins over '.jpeg' for image/jpeg
  }
  return '.bin';
}
