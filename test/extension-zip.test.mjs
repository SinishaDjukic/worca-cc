import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { zipDirectory } from '../tools/zip.mjs';

function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28); const extra = buf.readUInt16LE(p + 30); const comment = buf.readUInt16LE(p + 32);
    const comp = buf.readUInt32LE(p + 20); const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lnl = buf.readUInt16LE(local + 26); const lex = buf.readUInt16LE(local + 28);
    out[name] = inflateRawSync(buf.subarray(local + 30 + lnl + lex, local + 30 + lnl + lex + comp)).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
test('zipDirectory round-trips and is byte-for-byte reproducible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wx-zip-'));
  mkdirSync(join(dir, 'icons'));
  writeFileSync(join(dir, 'manifest.json'), '{"a":1}');
  writeFileSync(join(dir, 'icons', 'x.txt'), 'é'.repeat(1000));
  const a = join(tmpdir(), `a-${process.pid}.zip`); const b = join(tmpdir(), `b-${process.pid}.zip`);
  zipDirectory(dir, a); zipDirectory(dir, b);
  assert.ok(readFileSync(a).equals(readFileSync(b)));
  assert.deepEqual(unzip(readFileSync(a)), { 'icons/x.txt': 'é'.repeat(1000), 'manifest.json': '{"a":1}' });
});
