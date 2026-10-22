// test/helpers/tar-writer.mjs — a minimal ustar + gzip writer for crafted archives (P6). '0' file, '1' hardlink,
// '2' symlink, '3' char device, '5' directory, 'g' / 'x' a global / per-entry pax header (its body: pax records).
// Paths ≤ 100 bytes (no long-path records), which every caller here keeps to.
import { gzipSync } from 'node:zlib';

function header({ path, type = '0', size = 0, linkpath = '', mode = type === '5' ? 0o755 : 0o644 }) {
  const b = Buffer.alloc(512);
  b.write(path, 0, 100, 'utf8');
  b.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii');
  b.write('0000000\0', 108, 8, 'ascii');
  b.write('0000000\0', 116, 8, 'ascii');
  b.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  b.write('00000000000\0', 136, 12, 'ascii');
  b.fill(' ', 148, 156);
  b.write(type, 156, 1, 'ascii');
  b.write(linkpath, 157, 100, 'utf8');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const x of b) sum += x;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return b;
}

export function tarGz(entries) {
  const parts = [];
  for (const e of entries) {
    const type = e.type ?? '0';
    const body = type === '0' || type === 'g' || type === 'x' ? Buffer.from(e.body ?? '') : Buffer.alloc(0);
    parts.push(header({ ...e, type, size: body.length }));
    if (body.length) parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
