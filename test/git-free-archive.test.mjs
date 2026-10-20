// test/git-free-archive.test.mjs — safe .tar.gz extraction for the git-free transports (P6 Task 1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { gzipSync, gunzipSync } from 'node:zlib';
import { extractTarGz, isSafeRelPath, ARCHIVE_LIMITS } from '../src/core/git-free/archive.mjs';
import { tarGz } from './helpers/tar-writer.mjs';

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'worca-gf-arch-')); roots.push(d); return d; };
const TOP = 'acme-tools-abc1234';

test('extracts under the top folder, strips it and a prefix, keeps the exec bit; include decides what lands', async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([
    { path: `${TOP}/`, type: '5' },
    { path: `${TOP}/plugins/aa/`, type: '5' },
    { path: `${TOP}/plugins/aa/index.mjs`, body: 'export default 1;\n' },
    { path: `${TOP}/plugins/aa/bin/run.sh`, body: '#!/bin/sh\n', mode: 0o755 },
    { path: `${TOP}/README.md`, body: 'readme\n' },
  ]), dest, { include: (p) => p === 'plugins/aa' || p.startsWith('plugins/aa/'), stripPrefix: 'plugins/aa' });
  assert.deepEqual(readdirSync(dest).sort(), ['bin', 'index.mjs']);
  assert.equal(readFileSync(join(dest, 'index.mjs'), 'utf8'), 'export default 1;\n');
  if (process.platform !== 'win32') assert.equal(statSync(join(dest, 'bin', 'run.sh')).mode & 0o100, 0o100);
  assert.deepEqual([r.files, r.bytes, r.skipped], [2, 28, []]);
});

test('a path that leaves the folder is never written: .., absolute, backslash, drive letter', async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([
    { path: `${TOP}/../gf-escape.txt`, body: 'x' },
    { path: '/etc/gf-abs.txt', body: 'x' },
    { path: `${TOP}/a\\..\\..\\gf-bs.txt`, body: 'x' },
    { path: `${TOP}/C:gf-drive.txt`, body: 'x' },
    { path: `${TOP}/ok.txt`, body: 'ok' },
  ]), dest);
  assert.deepEqual(readdirSync(dest), ['ok.txt']);
  assert.equal(existsSync(join(dest, '..', 'gf-escape.txt')), false);
  assert.deepEqual(r.skipped.map((s) => s.why), ['unsafe', 'unsafe', 'unsafe', 'unsafe']);
});

test('hardlinks and devices are never created; symlinks: verbatim with links on POSIX, skipped otherwise', async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([
    { path: `${TOP}/ok.txt`, body: 'ok' },
    { path: `${TOP}/hard`, type: '1', linkpath: `${TOP}/ok.txt` },
    { path: `${TOP}/dev`, type: '3' },
  ]), dest);
  assert.deepEqual(readdirSync(dest), ['ok.txt']);
  assert.deepEqual(r.skipped, [{ path: `${TOP}/hard`, why: 'type' }, { path: `${TOP}/dev`, why: 'type' }]);
  const entries = [{ path: `${TOP}/target.txt`, body: 't' }, { path: `${TOP}/link`, type: '2', linkpath: 'target.txt' }];
  if (process.platform !== 'win32') {
    const a = fresh();
    await extractTarGz(tarGz(entries), a);
    assert.equal(readlinkSync(join(a, 'link')), 'target.txt');
  }
  const b = fresh();
  assert.deepEqual((await extractTarGz(tarGz(entries), b, { links: false })).skipped, [{ path: `${TOP}/link`, why: 'type' }]);
  assert.equal(existsSync(join(b, 'link')), false);
  const c = fresh();
  assert.deepEqual((await extractTarGz(tarGz(entries), c, { platform: 'win32' })).skipped, [{ path: `${TOP}/link`, why: 'windows-link' }]);
  assert.equal(existsSync(join(c, 'link')), false);
});

test('a symlink whose target leaves the folder is never written (absolute, drive, .. past the root, backslashes); one inside it is', { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege on Windows' : false }, async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([
    { path: `${TOP}/README.md`, body: 'r' },
    { path: `${TOP}/docs/`, type: '5' },
    { path: `${TOP}/docs/in`, type: '2', linkpath: '../README.md' },
    { path: `${TOP}/docs/up`, type: '2', linkpath: '../../outside' },
    { path: `${TOP}/abs`, type: '2', linkpath: '/etc/hosts' },
    { path: `${TOP}/drive`, type: '2', linkpath: 'C:/x' },
    { path: `${TOP}/bs`, type: '2', linkpath: '..\\x' },
    { path: `${TOP}/loop`, type: '2', linkpath: 'docs/../../x' },
  ]), dest);
  assert.equal(readlinkSync(join(dest, 'docs', 'in')), '../README.md');
  assert.deepEqual(readdirSync(dest).sort(), ['README.md', 'docs']);
  assert.deepEqual(r.skipped, ['docs/up', 'abs', 'drive', 'bs', 'loop'].map((p) => ({ path: `${TOP}/${p}`, why: 'escaping-link' })));
  const sub = fresh();
  const s2 = await extractTarGz(tarGz([
    { path: `${TOP}/skills/a/SKILL.md`, body: 's' },
    { path: `${TOP}/skills/a/ok`, type: '2', linkpath: 'SKILL.md' },
    { path: `${TOP}/skills/a/out`, type: '2', linkpath: '../b/SKILL.md' },
  ]), sub, { stripPrefix: 'skills/a' });
  assert.deepEqual([readdirSync(sub).sort(), s2.skipped], [['SKILL.md', 'ok'], [{ path: `${TOP}/skills/a/out`, why: 'escaping-link' }]]);
});

test('a link to a link, and a link through a linked folder, land as git extracts them; a link under a link fails the extraction', { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege on Windows' : false }, async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([
    { path: `${TOP}/AGENTS.md`, body: 'a\n' },
    { path: `${TOP}/CLAUDE.md`, type: '2', linkpath: 'AGENTS.md' },
    { path: `${TOP}/GEMINI.md`, type: '2', linkpath: 'CLAUDE.md' },
    { path: `${TOP}/docs/latest`, type: '2', linkpath: 'v2' },
    { path: `${TOP}/docs/v2/README.md`, body: 'r\n' },
    { path: `${TOP}/x`, type: '2', linkpath: 'docs/latest/README.md' },
    { path: `${TOP}/deep/er/ln`, type: '2', linkpath: '../../AGENTS.md' },
  ]), dest);
  assert.deepEqual([readlinkSync(join(dest, 'GEMINI.md')), readFileSync(join(dest, 'GEMINI.md'), 'utf8'), readFileSync(join(dest, 'x'), 'utf8'),
    readFileSync(join(dest, 'deep', 'er', 'ln'), 'utf8'), r.files, r.skipped], ['CLAUDE.md', 'a\n', 'r\n', 'a\n', 2, []]);
  const under = fresh();
  await assert.rejects(extractTarGz(tarGz([
    { path: `${TOP}/v2/`, type: '5' },
    { path: `${TOP}/latest`, type: '2', linkpath: 'v2' },
    { path: `${TOP}/latest/y`, type: '2', linkpath: '../a' },
  ]), under), { code: 'TAR_SYMLINK_ERROR' });
  assert.deepEqual(readdirSync(join(under, 'v2')), []);
  // archive order decides as tar decides it: a later file or folder at a link's path replaces it, a later link replaces a file
  const order = fresh();
  await extractTarGz(tarGz([
    { path: `${TOP}/f`, type: '2', linkpath: 'g' },
    { path: `${TOP}/f`, body: 'file\n' },
    { path: `${TOP}/d`, type: '2', linkpath: 'g' },
    { path: `${TOP}/d/`, type: '5' },
    { path: `${TOP}/l`, body: 'file\n' },
    { path: `${TOP}/l`, type: '2', linkpath: 'f' },
  ]), order);
  assert.deepEqual([readFileSync(join(order, 'f'), 'utf8'), statSync(join(order, 'd')).isDirectory(), readlinkSync(join(order, 'l'))], ['file\n', true, 'f']);
  // a link AT the stripped prefix is the folder itself: never written, as tar never replaces its cwd
  const at = fresh();
  await extractTarGz(tarGz([{ path: `${TOP}/sk`, type: '2', linkpath: 'other' }, { path: `${TOP}/other/SKILL.md`, body: 's' }]), at, { stripPrefix: 'sk' });
  assert.deepEqual(readdirSync(at), []);
  const links = tarGz([{ path: `${TOP}/a`, body: 'a' }, { path: `${TOP}/b`, type: '2', linkpath: 'a' }, { path: `${TOP}/c`, type: '2', linkpath: 'b' }]);
  await assert.rejects(extractTarGz(links, fresh(), { limits: { ...ARCHIVE_LIMITS, entries: 2 } }), { code: 'TOO_LARGE', limit: 'entries' });
});

test('the caps judge the bytes tar writes: a global pax size never shrinks a per-entry one', async () => {
  const lying = tarGz([{ path: 'pax_global_header', type: 'g', body: '10 size=1\n' },
    { path: `${TOP}/PaxHeaders/a`, type: 'x', body: '13 size=3000\n' }, { path: `${TOP}/a`, body: 'x'.repeat(3000) }]);
  await assert.rejects(extractTarGz(lying, fresh(), { limits: { ...ARCHIVE_LIMITS, fileBytes: 1000 } }), { code: 'TOO_LARGE', limit: 'fileBytes' });
  await assert.rejects(extractTarGz(lying, fresh(), { limits: { ...ARCHIVE_LIMITS, extractBytes: 1000 } }), { code: 'TOO_LARGE', limit: 'extractBytes' });
});

test('a folder that cannot be made fails the extraction and destroys the source: a later stream error has no one to crash', async () => {
  const file = join(fresh(), 'file');
  writeFileSync(file, 'x');
  const source = new PassThrough();
  await assert.rejects(extractTarGz(source, join(file, 'dest')));
  assert.equal(source.destroyed, true);
});

test('caps: total bytes, entries, one file, and the compressed download', async () => {
  const big = tarGz([{ path: `${TOP}/a`, body: 'x'.repeat(10) }, { path: `${TOP}/b`, body: 'y'.repeat(10) }]);
  await assert.rejects(extractTarGz(big, fresh(), { limits: { ...ARCHIVE_LIMITS, extractBytes: 15 } }), { code: 'TOO_LARGE', limit: 'extractBytes' });
  await assert.rejects(extractTarGz(big, fresh(), { limits: { ...ARCHIVE_LIMITS, entries: 1 } }), { code: 'TOO_LARGE', limit: 'entries' });
  await assert.rejects(extractTarGz(big, fresh(), { limits: { ...ARCHIVE_LIMITS, fileBytes: 9 } }), { code: 'TOO_LARGE', limit: 'fileBytes' });
  await assert.rejects(extractTarGz(Readable.from([big]), fresh(), { limits: { ...ARCHIVE_LIMITS, downloadBytes: big.length - 1 } }),
    { code: 'TOO_LARGE', limit: 'downloadBytes' });
});

test('isSafeRelPath', () => {
  for (const p of ['a', 'a/b.txt', '.worca-metrics/runs/2026/09/x.jsonl', 'a b/ç.md']) assert.equal(isSafeRelPath(p), true, p);
  for (const p of ['', '/a', '../a', 'a/../b', 'a/./b', 'a//b', 'a\\b', 'C:a', 'c:/a', 'a\0b']) assert.equal(isSafeRelPath(p), false, p);
});

test('stripPrefix alone keeps only its own folder; include alone decides; every cap holds AT its limit', async () => {
  const entries = [
    { path: `${TOP}/plugins/aa/index.mjs`, body: 'a' },
    { path: `${TOP}/plugins/aaa/other.mjs`, body: 'b' },
    { path: `${TOP}/plugins/bb/x/other.mjs`, body: 'c' },
  ];
  const d1 = fresh();
  await extractTarGz(tarGz(entries), d1, { stripPrefix: 'plugins/aa' });
  assert.deepEqual(readdirSync(d1), ['index.mjs']);
  const d2 = fresh();
  await extractTarGz(tarGz(entries), d2, { include: (p) => !p.startsWith('plugins/bb') });
  assert.deepEqual(readdirSync(join(d2, 'plugins')).sort(), ['aa', 'aaa']);
  const two = tarGz([{ path: `${TOP}/a`, body: 'x'.repeat(10) }, { path: `${TOP}/b`, body: 'y'.repeat(10) }]);
  const r = await extractTarGz(two, fresh(), { limits: { downloadBytes: two.length, extractBytes: 20, entries: 2, fileBytes: 10 } });
  assert.deepEqual([r.files, r.bytes], [2, 20]);
  for (const p of [undefined, null, 1]) assert.equal(isSafeRelPath(p), false, String(p));
});

test('a crafted first entry cannot make an absolute or .. path the top folder; a failed entry write fails the extraction', async () => {
  for (const first of ['/etc/gf-a.txt', '../gf-b.txt']) {
    const dest = fresh();
    const r = await extractTarGz(tarGz([{ path: first, body: 'x' }, { path: first.replace('gf-', 'gf-2-'), body: 'y' }, { path: `${TOP}/ok.txt`, body: 'ok' }]), dest);
    assert.deepEqual([readdirSync(dest), r.skipped.map((s) => s.why)], [[], ['unsafe', 'unsafe', 'unsafe']], first);
  }
  if (process.platform !== 'win32') {
    await assert.rejects(extractTarGz(tarGz([{ path: `${TOP}/sub/`, type: '5' }, { path: `${TOP}/ln`, type: '2', linkpath: 'sub' }, { path: `${TOP}/ln/y.txt`, body: 'y' }]), fresh()),
      { code: 'TAR_SYMLINK_ERROR' });
  }
});

test('an archive that stops before tar\'s end-of-archive marker fails the extraction: never a partial tree', async () => {
  const whole = gunzipSync(tarGz([{ path: `${TOP}/`, type: '5' }, { path: `${TOP}/a.md`, body: 'a' }, { path: `${TOP}/b.md`, body: 'b' }]));
  // a whole gzip member around a tar cut at an entry boundary: the top folder and a.md (header + one block); b.md never arrives
  await assert.rejects(extractTarGz(gzipSync(whole.subarray(0, 512 * 3)), fresh()), { code: 'TAR_BAD_ARCHIVE', message: 'archive truncated (no end-of-archive marker)' });
  // every entry and ONE zero block: the marker is two
  await assert.rejects(extractTarGz(gzipSync(whole.subarray(0, 512 * 6)), fresh()), { code: 'TAR_BAD_ARCHIVE' });
});

test('the path tar writes is judged: a drive letter that appears only once a prefix is stripped is unsafe, not a failed extraction; one stripped away is never written', async () => {
  const dest = fresh();
  const r = await extractTarGz(tarGz([{ path: `${TOP}/sk/SKILL.md`, body: 's' }, { path: `${TOP}/sk/C:x.md`, body: 'c' }]), dest, { stripPrefix: 'sk' });
  assert.deepEqual([readdirSync(dest), r.skipped], [['SKILL.md'], [{ path: `${TOP}/sk/C:x.md`, why: 'unsafe' }]]);
  const d2 = fresh();
  const r2 = await extractTarGz(tarGz([{ path: `${TOP}/a:b/`, type: '5' }, { path: `${TOP}/a:b/SKILL.md`, body: 's' }]), d2, { stripPrefix: 'a:b' });
  assert.deepEqual([readdirSync(d2), r2.skipped], [['SKILL.md'], []]);
});
