// test/office-preview.test.mjs — Office documents as PDF (src/core/office-preview.mjs): where LibreOffice is found, a
// conversion through a fake `soffice`, the cache by content hash, one job per hash, and every refusal.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSoffice, officePdf, OfficePreviewError, OFFICE_LIMITS } from '../src/core/office-preview.mjs';
import { makeFakeSoffice } from './helpers/fake-soffice.mjs';

const posix = process.platform !== 'win32';
const fake = posix ? makeFakeSoffice() : null;
const cacheDir = mkdtempSync(join(tmpdir(), 'worca-office-cache-'));
after(() => { fake?.cleanup(); rmSync(cacheDir, { recursive: true, force: true }); });
const doc = (s) => Buffer.from(`PK\u0003\u0004 ${s}`);
// A killed process may linger as a zombie until something reaps it (a container whose pid 1 does not): count that as gone.
const gone = (pid) => {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'ESRCH'; }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return ps.status === 0 && /^Z/.test(ps.stdout.trim());
};

test('findSoffice: soffice then libreoffice on PATH, then the standard install of each platform, else null', () => {
  const isFile = (set) => (p) => set.has(p);
  assert.equal(findSoffice({ env: { PATH: '/a:/b' }, platform: 'linux', isFile: isFile(new Set(['/b/soffice'])) }), '/b/soffice');
  assert.equal(findSoffice({ env: { PATH: '/a' }, platform: 'linux', isFile: isFile(new Set(['/a/libreoffice'])) }), '/a/libreoffice');
  assert.equal(findSoffice({ env: { PATH: '/a' }, platform: 'darwin',
    isFile: isFile(new Set(['/Applications/LibreOffice.app/Contents/MacOS/soffice'])) }), '/Applications/LibreOffice.app/Contents/MacOS/soffice');
  assert.equal(findSoffice({ env: { PATH: 'C:\\x', ProgramFiles: 'C:\\Program Files', PATHEXT: '.EXE' }, platform: 'win32',
    isFile: isFile(new Set(['C:\\Program Files\\LibreOffice\\program\\soffice.exe'])) }), 'C:\\Program Files\\LibreOffice\\program\\soffice.exe');
  assert.equal(findSoffice({ env: { PATH: '/a' }, platform: 'linux', isFile: () => false }), null);
});

test('no LibreOffice and nothing cached: NO_CONVERTER with the install text', async () => {
  await assert.rejects(officePdf(doc('none'), 'a.docx', { bin: null, cacheDir }), (e) => e instanceof OfficePreviewError && e.code === 'NO_CONVERTER'
    && e.message === 'Install LibreOffice to preview Office files.');
});

test('refusals before any spawn: not Office, too large', async () => {
  await assert.rejects(officePdf(doc('x'), 'a.zip', { bin: '/nope', cacheDir }), { code: 'NOT_OFFICE' });
  const big = Buffer.alloc(OFFICE_LIMITS.maxBytes + 1);
  await assert.rejects(officePdf(big, 'a.docx', { bin: '/nope', cacheDir }), { code: 'TOO_LARGE' });
});

test('a soffice that cannot be started is CONVERT_FAILED (a missing binary, or one spawn() refuses outright)', async () => {
  await assert.rejects(officePdf(doc('gone'), 'g.docx', { bin: join(cacheDir, 'no-such-soffice'), cacheDir }), { code: 'CONVERT_FAILED' });
  await assert.rejects(officePdf(doc('nul'), 'n.docx', { bin: '/no\u0000pe', cacheDir }), { code: 'CONVERT_FAILED' });
  assert.deepEqual(readdirSync(cacheDir).filter((n) => n.startsWith('job-')), [], 'no job folder is left behind');
});

test('converts through soffice into the cache by content hash; the same bytes never convert twice', { skip: !posix }, async () => {
  fake.mode(null);
  const before = fake.calls();
  const a = await officePdf(doc('one'), 'Quarterly Report.docx', { bin: fake.bin, cacheDir });
  assert.equal(a.cached, false);
  assert.match(a.path, /[0-9a-f]{64}\.pdf$/);
  assert.match(readFileSync(a.path, 'utf8'), /^%PDF-1\.4\n% fake from in\.docx/, 'soffice saw a private copy named in<ext>');
  const b = await officePdf(doc('one'), 'renamed.docx', { bin: fake.bin, cacheDir });
  assert.deepEqual([b.cached, b.path], [true, a.path]);
  assert.equal(fake.calls() - before, 1);
  assert.deepEqual(readdirSync(cacheDir).filter((n) => n.startsWith('job-')), [], 'no job folder is left behind');
  const c = await officePdf(doc('one'), 'x.docx', { bin: null, cacheDir });
  assert.equal(c.cached, true, 'a cached PDF still previews after LibreOffice is gone');
});

test('two requests for one document share ONE conversion', { skip: !posix }, async () => {
  fake.mode(null);
  const before = fake.calls();
  const [x, y] = await Promise.all([officePdf(doc('pair'), 'p.pptx', { bin: fake.bin, cacheDir }), officePdf(doc('pair'), 'p.pptx', { bin: fake.bin, cacheDir })]);
  assert.equal(x.path, y.path);
  assert.equal(fake.calls() - before, 1);
});

test('a failing soffice is CONVERT_FAILED; a hung one is killed at the limit (TIMEOUT); the next job still runs', { skip: !posix }, async () => {
  fake.mode('fail');
  await assert.rejects(officePdf(doc('bad'), 'b.xlsx', { bin: fake.bin, cacheDir }), { code: 'CONVERT_FAILED' });
  fake.mode('hang');
  const t0 = Date.now();
  await assert.rejects(officePdf(doc('hang'), 'h.odt', { bin: fake.bin, cacheDir, timeoutMs: 300 }), { code: 'TIMEOUT' });
  assert.ok(Date.now() - t0 < 5000, 'the time limit, not sleep 30');
  await new Promise((r) => setTimeout(r, 200));
  const pid = fake.hangPid();
  assert.ok(pid, 'the hung fake started its child');
  const alive = !gone(pid);
  if (alive) try { process.kill(pid, 'SIGKILL'); } catch { /* raced */ }
  assert.equal(alive, false, 'the hung soffice\'s child sleep was killed with its process group');
  fake.mode(null);
  assert.equal((await officePdf(doc('after'), 'ok.ods', { bin: fake.bin, cacheDir })).cached, false, 'the queue is not stuck');
});

test('soffice runs with the scrubbed env: a secret in the server\'s env never reaches it', { skip: !posix }, async () => {
  fake.mode(null);
  process.env.WORCA_OFFICE_TEST_SECRET = 'sk-not-for-soffice';
  try {
    await officePdf(doc('env'), 'e.docx', { bin: fake.bin, cacheDir });
  } finally { delete process.env.WORCA_OFFICE_TEST_SECRET; }
  const names = fake.envNames();
  assert.ok(names.includes('PATH'), 'the fake recorded its env');
  assert.equal(names.includes('WORCA_OFFICE_TEST_SECRET'), false);
});

test('a failed conversion is not remembered: the same bytes convert once soffice works again', { skip: !posix }, async () => {
  fake.mode('fail');
  await assert.rejects(officePdf(doc('retry'), 'r.docx', { bin: fake.bin, cacheDir }), { code: 'CONVERT_FAILED' });
  fake.mode(null);
  const again = await officePdf(doc('retry'), 'r.docx', { bin: fake.bin, cacheDir });
  assert.equal(again.cached, false);
  assert.match(readFileSync(again.path, 'utf8'), /^%PDF-1\.4/);
});
