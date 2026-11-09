// src/core/ask/attachment-kind.mjs
// Attachment typing for the Ask Worca chat (issue #398): which extensions are
// accepted, what kind/mime each maps to, and content sniffing for the binary
// ones. Pure and synchronous — the single source of truth for the type table;
// limits.mjs re-exports the two extension lists and ui/server.mjs validates
// uploads with classifyExtension + sniffMime.
//
// Kinds: 'text' (UTF-8, inlineable into the turn prompt, redactable),
// 'image' (fed to the model via its Read tool on the stored file) and
// 'binary' (PDF — same Read-tool path, never inlined — or, with mime
// application/octet-stream, any other file the model gets only as a name and a path).
//
// The extension names the CLAIMED type; for listed binary kinds the claim is verified
// against the leading bytes (magic number). Nothing is refused for its type: a file
// that is not on the lists (or whose bytes contradict its listed extension) is stored
// as text/plain when it is UTF-8, else as generic binary (see attachment-upload.mjs).
// SVG is therefore stored as text (served text/plain, never rendered), and the
// download route serves any non-inline-servable body as an octet-stream attachment.
//
// HTML is safe because it is a TEXT kind: the body is stored as `<id>.txt` and
// the download route serves every text kind as `text/plain; charset=utf-8` with
// `X-Content-Type-Options: nosniff`, so a browser never renders or runs it on the
// worca origin. Its `text/html` mime is only a label — read_attachment uses it to
// offer the markup as readable text (html-text.mjs), never to serve it.

// The extension allowlists + classifyExtension + extensionForAttachment now live
// in the shared, browser-safe src/shared/artifact-kinds.mjs (the viewer needs the
// same tables). This module re-exports them unchanged and keeps sniffMime here,
// which needs Buffer and so cannot live under src/shared.
import {
  TEXT_EXTENSIONS, BINARY_EXTENSIONS, classifyExtension, extensionForAttachment,
  GENERIC_BINARY_MIME, safeAttachmentExt, isGenericBinary, isInlineServableMime,
} from '../../shared/artifact-kinds.mjs';
export {
  TEXT_EXTENSIONS, BINARY_EXTENSIONS, classifyExtension, extensionForAttachment,
  GENERIC_BINARY_MIME, safeAttachmentExt, isGenericBinary, isInlineServableMime,
};

/** ISO 32000-1 §7.5.2 (implementation note 13): the `%PDF-` header may be
 *  preceded by up to 1024 bytes of junk (a UTF-8 BOM, print-driver or mail-
 *  gateway preamble). Acrobat and pdf.js accept such files, so the sniff does too. */
const PDF_HEADER_WINDOW = 1024;

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
  // SOI (FF D8) followed by the first marker's FF and its marker byte (>= 0xC0:
  // APPn/DQT/SOFn/…) — a bare 3-byte FF D8 FF stub is not a JPEG anything can open.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[3] >= 0xc0) return 'image/jpeg';
  if (buf.length >= 6) {
    const head6 = buf.toString('latin1', 0, 6);
    if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12
    && buf.toString('latin1', 0, 4) === 'RIFF'
    && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5) {
    const at = buf.toString('latin1', 0, Math.min(buf.length, PDF_HEADER_WINDOW + 5)).indexOf('%PDF-');
    if (at !== -1 && at <= PDF_HEADER_WINDOW) return 'application/pdf';
  }
  return null;
}
