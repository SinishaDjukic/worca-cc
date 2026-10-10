// ui/public/attach-files.mjs
// Chat attachments in the browser, shared by the Ask panel (ask-panel.mjs) and the Workflows chat dock
// (workflows/chat-dock.mjs): the type tables and caps, the early checks with their messages, base64, and the drag and
// paste helpers. Pure: no DOM, no state beyond a paste namer's own counter.
// Mirrors src/shared/artifact-kinds.mjs (the allowlists) + src/core/ask/limits.mjs (the caps, #398): text kinds are
// UTF-8 capped at 512 KB, binary kinds (images + PDF) at 32 MB, 8 files and 48 MB per message. The server re-validates
// everything; these are just early clear messages (test/attach-files.test.mjs pins the mirror).
import { attachRefusal } from './ask-engine.mjs';

export const ATTACH_TEXT_EXT = Object.freeze(['.md', '.markdown', '.txt', '.json', '.csv', '.log', '.html', '.htm']);
export const ATTACH_BINARY = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
});
export const ATTACH_MAX_TEXT_BYTES = 524_288;
export const ATTACH_MAX_BINARY_BYTES = 32 * 1024 * 1024;
export const ATTACH_MAX_MESSAGE_BYTES = 48 * 1024 * 1024;
export const ATTACH_MAX_FILES = 8;
/** The file picker's accept list: every allowed extension, then text/*. */
export const ATTACH_ACCEPT = `${ATTACH_TEXT_EXT.join(',')},${Object.keys(ATTACH_BINARY).join(',')},text/*`;

/** The lower-cased extension WITH its dot, or '' when the name has no dot. */
export function extOf(name) {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot).toLowerCase() : '';
}

/**
 * Ask's early checks for one file `{name, size}`, in Ask's order and with its messages, against the files already
 * pending for the message (`{name, bytes}`). A pending file of the same name is replaced (newest wins), so it counts
 * toward neither cap. `engine` is the engine the message will run on: a Codex chat refuses PDFs (D16).
 * @returns {{ok: true, name: string, ext: string, mime: string|null, attKind: 'text'|'image'|'binary', others: object[]}
 *   | {ok: false, error: string}}
 */
export function checkAttachment(file, { pending = [], engine = null } = {}) {
  const name = String((file && file.name) || '');
  const ext = extOf(name);
  const binMime = ATTACH_BINARY[ext];
  if (!ATTACH_TEXT_EXT.includes(ext) && !binMime) return { ok: false, error: `attachment type not allowed: ${name}` };
  const refused = attachRefusal({ ext, engine });
  if (refused) return { ok: false, error: `${refused}: ${name}` };
  const cap = binMime ? ATTACH_MAX_BINARY_BYTES : ATTACH_MAX_TEXT_BYTES;
  if (file.size > cap) return { ok: false, error: `attachment over ${cap} bytes: ${name}` };
  const others = (Array.isArray(pending) ? pending : []).filter((p) => p.name !== name);   // dedupe by name, newest wins
  if (others.length >= ATTACH_MAX_FILES) return { ok: false, error: `at most ${ATTACH_MAX_FILES} attachments per message` };
  const pendingBytes = others.reduce((n, p) => n + p.bytes, 0);
  if (pendingBytes + file.size > ATTACH_MAX_MESSAGE_BYTES) return { ok: false, error: `attachments over ${ATTACH_MAX_MESSAGE_BYTES} bytes per message` };
  const attKind = binMime ? (binMime.startsWith('image/') ? 'image' : 'binary') : 'text';
  return { ok: true, name, ext, mime: binMime || null, attKind, others };
}

/** Bytes (a Uint8Array view) → base64, 32 KB at a time (String.fromCharCode.apply caps its argument count). */
export function bytesToBase64(bytes, btoa = globalThis.btoa) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A drag that carries files (the desktop, a file manager). Text and element drags keep their defaults. */
export const carriesFiles = (dt) => !!dt && Array.from(dt.types || []).includes('Files');

/** The files a paste should attach, or null to let the paste go ahead natively. Excel/Word/browser copies carry the
 *  text plus a rendered image of it, and the text is what was meant. Screenshots (no text) and real files attach. */
export function pastedFiles(cd) {
  if (!cd || !cd.files || !cd.files.length) return null;
  const text = typeof cd.getData === 'function' ? cd.getData('text/plain') : '';
  if (text && [...cd.files].every((f) => String(f.type || '').startsWith('image/'))) return null;
  return [...cd.files];
}

/**
 * The browser names a clipboard image "image.png" (or nothing), so every paste would replace the last one through
 * the name dedupe. Such files get a unique "pasted-<timestamp>.<ext>"; real copied files keep their names. A nameless
 * file of an unlisted non-text type gets no extension, so the checks reject it as the file picker would.
 * `makeFile(parts, name, opts)` builds a File in the caller's window.
 */
export function createPasteNamer(makeFile, now = () => Date.now()) {
  let last = 0;
  return (files) => [...files].map((f) => {
    const name = String(f.name || '');
    if (name && !/^image\.[a-z0-9]+$/i.test(name)) return f;
    const dot = name.lastIndexOf('.');
    const type = String(f.type || '');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase()
      : (Object.keys(ATTACH_BINARY).find((k) => ATTACH_BINARY[k] === type) || (type.startsWith('text/') ? '.txt' : ''));
    last = Math.max(now(), last + 1);
    return makeFile([f], `pasted-${last}${ext}`, { type: f.type });
  });
}
