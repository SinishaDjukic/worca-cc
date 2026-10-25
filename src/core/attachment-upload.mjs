// src/core/attachment-upload.mjs
// Uploads that ride base64 inside a JSON body, validated before any write (Ask's §7.3 rule, extracted from
// POST /api/ask/threads/:id/messages for the Requirements page, plans/requirements-a8-design.md D10). The extension
// claims a type through Ask's tables; text kinds are proven by UTF-8 decoding and the absence of NUL bytes, binary
// kinds (images, PDF) by their magic number. Ask's messages are the defaults, byte for byte, and Ask's order holds:
// the list, its length, each file in turn, then the total.
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

export function validateAttachmentUploads(list, { maxFiles, maxBytesPerFile, maxBytesPerBinaryFile, maxBytesTotal,
  refuse = () => null, notAllowed = askNotAllowed, messages = {} } = {}) {
  const m = { ...ASK_MESSAGES, ...messages };
  const no = (status, error) => ({ ok: false, status, error });
  if (!Array.isArray(list)) return no(400, m.notArray());
  if (list.length > maxFiles) return no(400, m.tooMany(maxFiles, nameOf(list[maxFiles])));
  const dec = new TextDecoder('utf-8', { fatal: true });
  const files = [];
  for (const a of list) {
    const name = nameOf(a);
    const dot = name.lastIndexOf('.');
    const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
    const cls = classifyExtension(ext);
    if (!cls) return no(400, notAllowed(name, ext));
    const refused = refuse(cls, name);
    if (refused) return no(400, refused);
    const raw = a && typeof a.dataBase64 === 'string' ? a.dataBase64 : '';
    const buf = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (!buf.length) return no(400, m.empty(name));
    const cap = cls.kind === 'text' ? maxBytesPerFile : maxBytesPerBinaryFile;
    if (buf.length > cap) return no(413, m.tooBig(name, cap));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    if (cls.kind !== 'text') {
      if (sniffMime(buf) !== cls.mime) return no(400, m.mismatch(name));
      files.push({ name, kind: cls.kind, mime: cls.mime, data: buf, bytes: buf.length, sha256 });
      continue;
    }
    let text;
    try { text = dec.decode(buf); } catch { return no(400, m.notUtf8(name)); }
    if (text.includes('\u0000')) return no(400, m.nul(name));
    files.push({ name, kind: 'text', mime: cls.mime, data: buf, text, bytes: buf.length, sha256 });
  }
  let total = 0;
  for (const f of files) {
    total += f.bytes;
    if (total > maxBytesTotal) return no(413, m.totalTooBig(maxBytesTotal, f.name));
  }
  return { ok: true, files };
}
