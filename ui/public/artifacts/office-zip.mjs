// ui/public/artifacts/office-zip.mjs — capped reading of an Office package for the simplified in-browser preview. No DOM, and
// nothing runs at import. Every cap (compressed bytes, total inflated bytes, parts) is checked from the central directory,
// read here with unsigned DataView reads, BEFORE JSZip sees the archive; then every entry is counted again WHILE it
// inflates, against its declared size and the one remaining budget. JSZip alone checks sizes only after a whole entry
// is buffered, and its readInt overflows to negative values.
import { assertNoDtd, parseXml } from './office-xml.mjs';

export class OfficeLiteError extends Error {
  /** @param {'TOO_LARGE'|'TOO_MANY'|'EXPANDS'|'UNREADABLE'|'NOT_FOUND'|'LOAD_FAILED'} code */
  constructor(code, detail) {
    super(code);
    this.name = 'OfficeLiteError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail) => new OfficeLiteError(code, detail);
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** GET `url` into bytes, refusing past `maxBytes`: from Content-Length before reading, and again while streaming.
 *  (The caller re-checks its `live()` after the await; nothing here can be stale.) */
export async function fetchCapped(fetchFn, url, { maxBytes } = {}) {
  let res;
  try { res = await fetchFn(url); } catch { throw fail('UNREADABLE', 0); }
  if (!res || !res.ok) {
    const status = (res && res.status) || 0;
    throw status === 404 ? fail('NOT_FOUND', 404) : fail('UNREADABLE', status);
  }
  const head = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
  if (head != null && head !== '' && Number(head) > maxBytes) throw fail('TOO_LARGE', Number(head));
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxBytes) {
        try { await reader.cancel(); } catch { /* the refusal stands */ }
        throw fail('TOO_LARGE', n);
      }
      chunks.push(value);
    }
    return concat(chunks, n);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw fail('TOO_LARGE', buf.length);
  return buf;
}

/** Read the central directory → {entries: Map<rawName, {compressed, size, method, encrypted}>, total, count}. `count` is
 *  the number of headers walked (duplicate names included). Throws TOO_LARGE / TOO_MANY / EXPANDS past a cap, UNREADABLE
 *  for anything malformed, ZIP64, split over disks, encrypted or not stored/deflated. The directory must end exactly where
 *  the end record starts: JSZip shifts every offset by any bytes in between or in front, and would read another
 *  directory than this one. */
export function scanZip(bytes, limits) {
  if (bytes.length > limits.maxBytes) throw fail('TOO_LARGE', bytes.length);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22, stop = Math.max(0, bytes.length - 22 - 65535); i >= stop; i--) {
    if (v.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('UNREADABLE', 'no end record');
  const count = v.getUint16(eocd + 10, true);
  if (count > limits.maxEntries) throw fail('TOO_MANY', count);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || v.getUint16(eocd + 8, true) === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw fail('UNREADABLE', 'zip64');
  if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0) throw fail('UNREADABLE', 'split archive');
  if (cdOffset + cdSize !== eocd) throw fail('UNREADABLE', 'central directory not where the end record says');
  const dec = new TextDecoder('utf-8');
  const entries = new Map();
  let total = 0;
  let walked = 0;
  for (let p = cdOffset; p < cdOffset + cdSize;) {
    if (p + 46 > eocd || v.getUint32(p, true) !== CENTRAL) throw fail('UNREADABLE', 'bad central header');
    walked += 1;
    if (walked > limits.maxEntries) throw fail('TOO_MANY', walked);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const compressed = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const end = p + 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    if (end > eocd) throw fail('UNREADABLE', 'central header out of bounds');
    if (compressed === 0xffffffff || size === 0xffffffff || v.getUint32(p + 42, true) === 0xffffffff) throw fail('UNREADABLE', 'zip64');
    if (flags & 1) throw fail('UNREADABLE', 'encrypted');
    if (method !== 0 && method !== 8) throw fail('UNREADABLE', 'method');
    if (size > limits.maxTotal) throw fail('EXPANDS', size);
    total += size;
    if (total > limits.maxTotal) throw fail('EXPANDS', total);
    entries.set(dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)), { compressed, size, method, encrypted: false });
    p = end;
  }
  return { entries, total, count: walked };
}

/** scanZip, then JSZip.loadAsync (nothing inflates yet) → a CappedZip whose reads all spend ONE budget. JSZip must have
 *  read the same entries scanZip counted: as many, and each file's raw name among the scanned ones (a Unicode Path extra
 *  field or two raw names JSZip resolves to one would otherwise escape the declared sizes). */
export async function openCappedZip(JSZip, bytes, limits) {
  const scan = scanZip(bytes, limits);
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw fail('UNREADABLE', 'jszip'); }
  const read = Object.values(zip.files);
  if (read.length !== scan.count || read.some((f) => !f.dir && !scan.entries.has(f.unsafeOriginalName ?? f.name))) {
    throw fail('UNREADABLE', 'directory mismatch');
  }
  const budget = { left: limits.maxTotal };
  const fileOf = (name) => {
    const f = Object.prototype.hasOwnProperty.call(zip.files, name) ? zip.files[name] : null;
    return f && !f.dir ? f : null;
  };
  const declared = (f) => scan.entries.get(f.unsafeOriginalName ?? f.name);

  function bytesOf(name) {
    const file = fileOf(name);
    if (!file) return Promise.reject(fail('UNREADABLE', 'missing part'));
    const d = declared(file);
    const limit = d ? Math.min(d.size, budget.left) : budget.left;
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      let done = false;
      let stream;
      try { stream = file.internalStream('uint8array'); } catch { reject(fail('UNREADABLE', 'stream')); return; }
      stream.on('data', (chunk) => {
        if (done) return;                        // pause() does not stop chunks already in flight
        if (n + chunk.length > limit) {
          done = true;
          stream.pause();
          reject(fail('EXPANDS', n));
          return;
        }
        n += chunk.length;
        chunks.push(chunk);
      });
      stream.on('error', () => {
        if (done) return;
        done = true;
        reject(fail('UNREADABLE', 'inflate'));
      });
      stream.on('end', () => {
        if (done) return;
        done = true;
        budget.left -= n;
        resolve(concat(chunks, n));
      });
      stream.resume();
    });
  }
  const textOf = async (name) => new TextDecoder('utf-8').decode(await bytesOf(name));

  return {
    budget,
    names: () => Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name),
    has: (name) => Boolean(fileOf(name)),
    bytes: bytesOf,
    text: textOf,
    xml: async (name, DOMParserCtor) => parseXml(await textOf(name), DOMParserCtor),
    size: (name) => { const f = fileOf(name); const d = f && declared(f); return d ? d.size : 0; },
    /** Every part through the capped reader, XML parts DTD-checked and kept as text, repacked STORED (nothing to inflate).
     *  `prepare(parts)` (Map<name, bytes>, every part read) may return Map<name, text>: parts to replace or add before the
     *  repack (the .docx path rewrites [Content_Types].xml). */
    async restore({ prepare } = {}) {
      const out = new JSZip();
      const xmlTexts = new Map();
      const parts = new Map();
      for (const name of Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)) {
        const b = await bytesOf(name);
        if (/\.(xml|rels)$/i.test(name)) {
          const t = new TextDecoder('utf-8').decode(b);
          assertNoDtd(t);
          xmlTexts.set(name, t);
        }
        parts.set(name, b);
      }
      const swap = typeof prepare === 'function' ? prepare(parts) : null;
      for (const [name, text] of swap || []) {
        assertNoDtd(text);
        parts.set(name, new TextEncoder().encode(text));
        xmlTexts.set(name, text);
      }
      for (const [name, b] of parts) out.file(name, b, { binary: true, date: FIXED_DATE, compression: 'STORE', createFolders: false });
      return { bytes: await out.generateAsync({ type: 'uint8array', compression: 'STORE' }), xmlTexts };
    },
  };
}
