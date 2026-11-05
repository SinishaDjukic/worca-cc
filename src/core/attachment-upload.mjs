// src/core/attachment-upload.mjs
// Uploads that ride base64 inside a JSON body, validated before any write (Ask's §7.3 rule, extracted from
// POST /api/ask/threads/:id/messages for the Requirements page, plans/requirements-a8-design.md D10). The extension
// claims a type through Ask's tables; text kinds are proven by UTF-8 decoding and the absence of NUL bytes, binary
// kinds (images, PDF) by their magic number. Ask's messages are the defaults, byte for byte, and Ask's order holds:
// the list, its length, each file in turn, then the total. A file is hashed (sha256) only once it has passed every
// check, and not at all with `hash: false` (Ask, which keeps no hash).
import { createHash } from 'node:crypto';
import { classifyExtension, sniffMime } from './ask/attachment-kind.mjs';

const ASK_MESSAGES = Object.freeze({
  notArray: () => 'attachments must be an array',
  tooMany: (max) => `at most ${max} attachments per message`,
  tooBig: (name, cap) => `attachment over ${cap} bytes: ${name}`,
  totalTooBig: (cap) => `attachments over ${cap} bytes per message`,
  empty: (name) => `attachment is empty or not valid base64: ${name}`,
  mismatch: (name) => `attachment content does not match its extension: ${name}`,
  notUtf8: (name) => `attachment is not valid UTF-8: ${name}`,
  nul: (name) => `attachment contains NUL bytes: ${name}`,
});
const askNotAllowed = (name) => `attachment type not allowed: ${name || '(unnamed)'}`;
const nameOf = (a) => (a && typeof a.name === 'string' ? a.name : '');

/** One file's checks, in Ask's order: the extension's class, the caller's refusal, a non-empty body, the per-kind cap,
 *  then the magic number (binary kinds) or strict UTF-8 without NUL (text kinds). {ok:true, file} | {ok:false, status,
 *  error}. Shared by the upload list below and the chat files the host downloads (chat/inbound-context.mjs). */
export function validateAttachmentBuffer(name, buf, { maxBytesPerFile, maxBytesPerBinaryFile, refuse = () => null,
  notAllowed = askNotAllowed, messages = {} } = {}) {
  const m = { ...ASK_MESSAGES, ...messages };
  const no = (status, error) => ({ ok: false, status, error });
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
  const cls = classifyExtension(ext);
  if (!cls) return no(400, notAllowed(name, ext));
  const refused = refuse(cls, name);
  if (refused) return no(400, refused);
  if (!Buffer.isBuffer(buf) || !buf.length) return no(400, m.empty(name));
  const cap = cls.kind === 'text' ? maxBytesPerFile : maxBytesPerBinaryFile;
  if (buf.length > cap) return no(413, m.tooBig(name, cap));
  if (cls.kind !== 'text') {
    if (sniffMime(buf) !== cls.mime) return no(400, m.mismatch(name));
    return { ok: true, file: { name, kind: cls.kind, mime: cls.mime, data: buf, bytes: buf.length } };
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return no(400, m.notUtf8(name)); }
  if (text.includes(String.fromCharCode(0))) return no(400, m.nul(name));
  return { ok: true, file: { name, kind: 'text', mime: cls.mime, data: buf, text, bytes: buf.length } };
}

export function validateAttachmentUploads(list, { maxFiles, maxBytesPerFile, maxBytesPerBinaryFile, maxBytesTotal,
  refuse = () => null, notAllowed = askNotAllowed, messages = {}, hash = true } = {}) {
  const m = { ...ASK_MESSAGES, ...messages };
  const no = (status, error) => ({ ok: false, status, error });
  if (!Array.isArray(list)) return no(400, m.notArray());
  if (list.length > maxFiles) return no(400, m.tooMany(maxFiles, nameOf(list[maxFiles])));
  const files = [];
  const digest = (buf) => (hash ? { sha256: createHash('sha256').update(buf).digest('hex') } : {});
  for (const a of list) {
    const raw = a && typeof a.dataBase64 === 'string' ? a.dataBase64 : '';
    const v = validateAttachmentBuffer(nameOf(a), raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0),
      { maxBytesPerFile, maxBytesPerBinaryFile, refuse, notAllowed, messages });
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
