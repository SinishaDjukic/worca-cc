// test/helpers/office-lite-fixtures.mjs — the Office fixtures (test/fixtures/office, built by make-fixtures.mjs) and the
// small builders the simplified-preview tests share: an n-entry zip, a central-directory patcher for "lie" fixtures,
// and a fetch-Response-like answer with a counted, cancellable stream.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const JSZip = createRequire(import.meta.url)('jszip');
const DIR = new URL('../fixtures/office/', import.meta.url);

/** The committed fixture's bytes. */
export function fixture(name) {
  return new Uint8Array(readFileSync(new URL(name, DIR)));
}

/** An honest zip of `n` one-byte entries. */
export async function manyEntries(n) {
  const zip = new JSZip();
  const date = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < n; i++) zip.file(`p/${i}.txt`, 'x', { date, createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

/** A copy of `bytes` with the end record's entry counts set to `eocdCount`, and/or each named entry's uncompressed size
 *  set (in its central-directory header AND its local header) to `sizes[name]`. */
export function patchZip(bytes, { eocdCount, sizes = {} } = {}) {
  const out = new Uint8Array(bytes);
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let eocd = -1;
  for (let i = out.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('no end record');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const nameLen = v.getUint16(p + 28, true);
    const name = dec.decode(out.subarray(p + 46, p + 46 + nameLen));
    if (Object.hasOwn(sizes, name)) {
      v.setUint32(p + 24, sizes[name], true);
      v.setUint32(v.getUint32(p + 42, true) + 22, sizes[name], true);
    }
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  if (eocdCount != null) { v.setUint16(eocd + 8, eocdCount, true); v.setUint16(eocd + 10, eocdCount, true); }
  return out;
}

/** A fetch answer over `bytes`: `contentLength` false drops the header (or a number lies about it), `stream` false
 *  leaves no body (arrayBuffer only). `stats` counts the reader's read() calls and whether it was cancelled. */
export function respond(bytes, { contentLength = true, stream = true, status = 200, chunk = 64 * 1024 } = {}) {
  const stats = { reads: 0, cancelled: false, arrayBuffer: 0 };
  const len = contentLength === true ? String(bytes.length) : typeof contentLength === 'number' ? String(contentLength) : null;
  let at = 0;
  const body = stream ? {
    getReader: () => ({
      read: async () => {
        stats.reads += 1;
        if (at >= bytes.length) return { done: true, value: undefined };
        const value = bytes.subarray(at, Math.min(at + chunk, bytes.length));
        at += value.length;
        return { done: false, value };
      },
      cancel: async () => { stats.cancelled = true; },
      releaseLock() {},
    }),
  } : null;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? len : null) },
    body,
    arrayBuffer: async () => { stats.arrayBuffer += 1; return bytes.slice().buffer; },
    json: async () => ({}),
    stats,
  };
}
