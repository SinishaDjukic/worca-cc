// test/design-picture-files.test.mjs — Design pictures (P2 Task B3b): the design's file of a made picture
// (`work/assets/made/<name>.<ext>`, one per name) and the copy worca keeps of it by row id in `<design>/made/` (SPEC D10a):
// beside versions/, outside work/, worca's alone, and read back whatever happens to the file in work/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { designDir, ensureDesignFolders, madeDir, madeKeptDir } from '../src/core/design/paths.mjs';
import { keepPicture, PICTURE_BYTES_MAX, readKeptPicture, savePicture } from '../src/core/design/pictures.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';

useTempHome(after, 'worca-design-picture-files-');
const POSIX = process.platform !== 'win32';
const D = 'd_0000000000c1';
ensureDesignFolders(D);
const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

test('1 savePicture: the design\'s file by name, with /; another type removes the old one', () => {
  assert.equal(savePicture({ designId: D, name: 'hero', ext: 'png', bytes: png(8, 8) }), 'assets/made/hero.png');
  assert.equal(savePicture({ designId: D, name: 'hero', ext: 'jpg', bytes: jpg(8, 8) }), 'assets/made/hero.jpg');
  assert.deepEqual(readdirSync(madeDir(D)), ['hero.jpg']);
});
test('2 the kept copy: one per row id in <design>/made, worca\'s alone, read back whatever happens in work/', () => {
  assert.equal(madeKeptDir(D), join(designDir(D), 'made'));
  keepPicture({ designId: D, id: 1, ext: 'png', bytes: png(8, 8) }); keepPicture({ designId: D, id: 2, ext: 'jpg', bytes: jpg(8, 8) });
  assert.deepEqual(readdirSync(madeKeptDir(D)).sort(), ['1.png', '2.jpg']);
  if (POSIX) { assert.equal(statSync(madeKeptDir(D)).mode & 0o777, 0o700); assert.equal(statSync(join(madeKeptDir(D), '1.png')).mode & 0o777, 0o600); }
  rmSync(madeDir(D), { recursive: true, force: true });
  assert.deepEqual(readKeptPicture(D, { id: 1, ext: 'png' }), png(8, 8));
  assert.equal(readKeptPicture(D, { id: 3, ext: 'png' }), null);
  for (const bad of [{ id: 0, ext: 'png' }, { id: 1.5, ext: 'png' }, { id: 1, ext: 'gif' }]) assert.throws(() => keepPicture({ designId: D, ...bad, bytes: png(1, 1) }));
});
test('3 claim closes <design>/made to worca, as versions/', { skip: !POSIX }, () => {
  chmodSync(madeKeptDir(D), 0o755);
  createDesignBuilds({ broadcast: () => {}, claimDir: () => {} }).claim(D);
  assert.equal(statSync(madeKeptDir(D)).mode & 0o777, 0o700);
});
test('4 a name or type that is not one is refused before any path; a failed keep leaves no temp; a deleted design stays gone', () => {
  for (const bad of [{ name: '../x', ext: 'png' }, { name: 'Hero', ext: 'png' }, { name: 'hero', ext: 'gif' }, { name: 'hero', ext: 'png/x' }]) {
    assert.throws(() => savePicture({ designId: D, ...bad, bytes: png(1, 1) }), { code: 'BAD_REQUEST' }, JSON.stringify(bad));
  }
  assert.equal(existsSync(madeDir(D)), false, 'nothing made in work/');
  mkdirSync(join(madeKeptDir(D), '7.png'));
  assert.throws(() => keepPicture({ designId: D, id: 7, ext: 'png', bytes: png(1, 1) }));
  assert.deepEqual(readdirSync(madeKeptDir(D)).filter((n) => n.endsWith('.tmp')), []);
  const E = 'd_0000000000c2'; ensureDesignFolders(E);
  assert.equal(statSync(madeKeptDir(E)).isDirectory(), true, 'ensureDesignFolders makes made/');
  if (POSIX) assert.equal(statSync(madeKeptDir(E)).mode & 0o777, 0o700);
  rmSync(designDir(E), { recursive: true });
  assert.throws(() => keepPicture({ designId: E, id: 1, ext: 'png', bytes: png(1, 1) }), { code: 'ENOENT' });
  assert.equal(existsSync(designDir(E)), false);
});
test('5 readKeptPicture: a regular file of at most PICTURE_BYTES_MAX, never through a link; a bad id or type, or an open that fails, reads nothing', () => {
  const at = (n) => join(madeKeptDir(D), n);
  assert.equal(readKeptPicture(D, { id: 7, ext: 'png' }), null, 'a folder');
  writeFileSync(at('8.png'), ''); truncateSync(at('8.png'), PICTURE_BYTES_MAX + 1);
  // `=== null`: a failing row must not carry a 20 MiB `actual` into the report.
  assert.equal(readKeptPicture(D, { id: 8, ext: 'png' }) === null, true, 'one byte too many reads nothing');
  truncateSync(at('8.png'), PICTURE_BYTES_MAX);
  assert.equal(readKeptPicture(D, { id: 8, ext: 'png' }).length, PICTURE_BYTES_MAX);
  if (POSIX) { symlinkSync(at('1.png'), at('9.png')); assert.equal(readKeptPicture(D, { id: 9, ext: 'png' }), null, 'a link'); }
  // Any failed open is null, never a throw: the bytes route answers 404, and an fs error's message carries the path.
  if (POSIX && process.getuid?.() !== 0) {
    chmodSync(at('1.png'), 0);
    try { assert.equal(readKeptPicture(D, { id: 1, ext: 'png' }), null, 'an open refused (EACCES)'); } finally { chmodSync(at('1.png'), 0o600); }
  }
  for (const bad of [{ id: '1', ext: 'png' }, { id: 0, ext: 'png' }, { id: 1, ext: 'gif' }, { id: 1, ext: 'png/../1' }]) {
    assert.equal(readKeptPicture(D, bad), null, JSON.stringify(bad));
  }
});
/** Every folder below `dir` writable again, so the temp home can be removed. */
function unlockAll(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    chmodSync(join(dir, e.name), 0o755);
    unlockAll(join(dir, e.name));
  }
}
test('6 savePicture: the new file stands when an old type cannot be removed: set aside, or left, and logged', { skip: !POSIX || process.getuid?.() === 0 }, () => {
  const F = 'd_0000000000c3'; ensureDesignFolders(F);
  // hero.webp: a locked folder holding a file, which no removal empties or moves out of made/ (set aside in it).
  // hero.jpg on macOS: an immutable file, which neither a removal nor the set-aside rename moves (left in place).
  const locked = join(madeDir(F), 'hero.webp');
  mkdirSync(locked, { recursive: true }); writeFileSync(join(locked, 'f'), 'x'); chmodSync(locked, 0o555);
  const MAC = process.platform === 'darwin'; const jpgAt = join(madeDir(F), 'hero.jpg');
  if (MAC) { writeFileSync(jpgAt, jpg(8, 8)); assert.equal(spawnSync('chflags', ['uchg', jpgAt]).status, 0); }
  const lines = []; const warn = console.warn; console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    assert.equal(savePicture({ designId: F, name: 'hero', ext: 'png', bytes: png(8, 8) }), 'assets/made/hero.png');
    assert.deepEqual(readFileSync(join(madeDir(F), 'hero.png')), png(8, 8));
    assert.deepEqual(readdirSync(madeDir(F)).filter((n) => !n.startsWith('.')).sort(), MAC ? ['hero.jpg', 'hero.png'] : ['hero.png']);
    assert.equal(lines.some((t) => t.includes('hero.webp')), true, 'logged');
    if (MAC) assert.equal(lines.some((t) => t.includes('hero.jpg could not be removed') && t.endsWith('left in place')), true, 'logged');
  } finally {
    console.warn = warn;
    if (MAC) spawnSync('chflags', ['nouchg', jpgAt]);
    unlockAll(designDir(F)); rmSync(designDir(F), { recursive: true, force: true });
  }
});
