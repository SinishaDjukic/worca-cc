// test/design-place-bytes.test.mjs — Design pictures (P2 Task B3a): placeWorkBytes, placeWorkFile's contract with a
// buffer for a source. A new dot temp in the held folder is renamed over the name, so a file is replaced whole (a new
// inode; an open reader keeps the old bytes), never truncated in place nor written through a link (SPEC D16, §8 item 2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  designWorkDir, ensureDesignFolders, inWorkFolder, placeWorkBytes, placeWorkFile,
} from '../src/core/design/paths.mjs';

useTempHome(after, 'worca-design-place-bytes-');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'place-bytes-')); dirs.push(d); return d; };

const POSIX = process.platform !== 'win32';
const D = 'd_0000000000b1';
ensureDesignFolders(D);
const put = (name, text) => inWorkFolder(D, ['assets'], {}, (base) => placeWorkBytes(D, base, name, Buffer.from(text)));
const A = join(designWorkDir(D), 'assets');

test('1 a new file whole, mode 0660; a remake is renamed over (new inode, an open reader keeps the old bytes); no temp left', () => {
  put('a.bin', 'one'); const p = join(A, 'a.bin'); const ino = statSync(p).ino;
  const fd = POSIX ? openSync(p, 'r') : null;
  put('a.bin', 'two!');
  assert.equal(readFileSync(p, 'utf8'), 'two!'); assert.notEqual(statSync(p).ino, ino);
  if (fd !== null) { assert.equal(readFileSync(fd, 'utf8'), 'one'); closeSync(fd); }
  if (POSIX) assert.equal(statSync(p).mode & 0o777, 0o660);
  assert.deepEqual(readdirSync(A).filter((n) => n.endsWith('.tmp')), []);
});
test('2 a link at the name is replaced, never written through; worca\'s own folder there gives way', { skip: !POSIX }, () => {
  const out = join(tmp(), 'keep.txt'); writeFileSync(out, 'mine'); symlinkSync(out, join(A, 'b.bin'));
  put('b.bin', 'x');
  assert.equal(readFileSync(out, 'utf8'), 'mine'); assert.equal(lstatSync(join(A, 'b.bin')).isFile(), true);
  mkdirSync(join(A, 'c.bin')); put('c.bin', 'y');
  assert.equal(readFileSync(join(A, 'c.bin'), 'utf8'), 'y'); assert.equal(lstatSync(join(A, 'c.bin')).isFile(), true);
});
test('3 a name that is not one part is refused before anything is written; placeWorkFile still refuses a source that is not a file', () => {
  for (const bad of ['../x.bin', 'a/b.bin', '..', '']) {
    assert.throws(() => put(bad, 'z'), { code: 'BAD_REQUEST' }, JSON.stringify(bad));
  }
  assert.equal(existsSync(join(designWorkDir(D), 'x.bin')), false, 'nothing written above assets/');
  assert.deepEqual(readdirSync(A).filter((n) => n.endsWith('.tmp')), []);
  // A folder opens for reading on POSIX, so fstat's check is what refuses it (Windows refuses the open itself).
  if (POSIX) {
    assert.throws(() => inWorkFolder(D, ['assets'], {}, (base) => placeWorkFile(D, base, 'd.bin', tmp())), { code: 'EINVAL' });
    assert.equal(existsSync(join(A, 'd.bin')), false);
  }
});
