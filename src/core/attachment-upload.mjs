// src/core/attachment-upload.mjs
// Uploads that ride base64 inside a JSON body, validated before any write (Ask's §7.3 rule, extracted from
// POST /api/ask/threads/:id/messages for the Requirements page, plans/requirements-a8-design.md D10). No file is
// refused for its extension or its content: the extension only proposes a type through Ask's tables. A listed
// text type is proven by UTF-8 decoding with no NUL bytes, a listed image/PDF type by its magic number. Anything
// else (an unlisted or missing extension, or bytes that contradict the listed one) is stored as text/plain when it
// decodes as UTF-8 without NUL, otherwise as generic binary (application/octet-stream). The remaining refusals are the
// list shape, its length, the engine's `refuse` (listed extensions only), an empty file and the caps. Ask's messages
// are the defaults, byte for byte, and Ask's order holds: the list, its length, each file in turn, then the total.
// A file is hashed (sha256) only once it has passed every check, and not at all with `hash: false` (Ask).
import { createHash } from 'node:crypto';
import { classifyExtension, sniffMime, GENERIC_BINARY_MIME } from './ask/attachment-kind.mjs';

const ASK_MESSAGES = Object.freeze({
  notArray: () => 'attachments must be an array',
  tooMany: (max) => `at most ${max} attachments per message`,
  tooBig: (name, cap) => `attachment over ${cap} bytes: ${name}`,
  totalTooBig: (cap) => `attachments over ${cap} bytes per message`,
  empty: (name) => `attachment is empty or not valid base64: ${name}`,
});
const nameOf = (a) => (a && typeof a.name === 'string' ? a.name : '');

/** One file's checks, in Ask's order: the caller's refusal (listed extensions only), a non-empty body, the per-kind cap,
 *  then its content: a listed image/PDF proven by its magic number, else text/plain or generic binary by UTF-8 decoding
 *  (see the header). {ok:true, file} | {ok:false, status, error}. Shared by the upload list below and the chat files
 *  the host downloads (chat/inbound-context.mjs). */
export function validateAttachmentBuffer(name, buf, { maxBytesPerFile, maxBytesPerBinaryFile, refuse = () => null,
  messages = {} } = {}) {
  const m = { ...ASK_MESSAGES, ...messages };
  const no = (status, error) => ({ ok: false, status, error });
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
  const listed = classifyExtension(ext);
  if (listed) {
    const refused = refuse(listed, name);
    if (refused) return no(400, refused);
  }
  if (!Buffer.isBuffer(buf) || !buf.length) return no(400, m.empty(name));
  const cap = listed && listed.kind === 'text' ? maxBytesPerFile : maxBytesPerBinaryFile;
  if (buf.length > cap) return no(413, m.tooBig(name, cap));
  if (listed && listed.kind !== 'text' && sniffMime(buf) === listed.mime) {
    return { ok: true, file: { name, kind: listed.kind, mime: listed.mime, data: buf, bytes: buf.length } };
  }
  let text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = null; }
  if (text !== null && text.includes('\u0000')) text = null;
  if (text === null) return { ok: true, file: { name, kind: 'binary', mime: GENERIC_BINARY_MIME, data: buf, bytes: buf.length } };
  const mime = listed && listed.kind === 'text' ? listed.mime : 'text/plain';
  return { ok: true, file: { name, kind: 'text', mime, data: buf, text, bytes: buf.length } };
}

export function validateAttachmentUploads(list, { maxFiles, maxBytesPerFile, maxBytesPerBinaryFile, maxBytesTotal,
  refuse = () => null, messages = {}, hash = true } = {}) {
  const m = { ...ASK_MESSAGES, ...messages };
  const no = (status, error) => ({ ok: false, status, error });
  if (!Array.isArray(list)) return no(400, m.notArray());
  if (list.length > maxFiles) return no(400, m.tooMany(maxFiles, nameOf(list[maxFiles])));
  const files = [];
  const digest = (buf) => (hash ? { sha256: createHash('sha256').update(buf).digest('hex') } : {});
  for (const a of list) {
    const raw = a && typeof a.dataBase64 === 'string' ? a.dataBase64 : '';
    const v = validateAttachmentBuffer(nameOf(a), raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0),
      { maxBytesPerFile, maxBytesPerBinaryFile, refuse, messages });
    if (!v.ok) return v;
    files.push({ ...v.file, ...digest(v.file.data) });
  }
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    if (total > maxBytesTotal) return no(413, m.totalTooBig(maxBytesTotal, f.name));
  }
  return { ok: true, files };
}
