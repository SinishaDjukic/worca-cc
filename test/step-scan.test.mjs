// The post-execution scan (spec §6.1, D7): recursive, bounded, format-only kinds,
// symlinks neither followed nor descended, rel paths /-joined on every OS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanStepFolder, scanKindFor, SCAN_LIMITS, KIND_BY_EXT } from '../src/core/step-scan.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlink creation needs a privilege on Windows' : false };
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** A run dir with one step folder holding `files` ({ 'rel/with/slashes': text }). */
function stepDir(files = {}) {
  const run = tmp('worca-scan-run-');
  const dir = join(run, 'steps', 'n_x-c1');
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const parts = rel.split('/');
    mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...parts), text);
  }
  return { run, dir };
}

test('scanKindFor is extension-only, case-insensitive, format-only', () => {
  assert.equal(scanKindFor('DEVIATIONS.md'), 'markdown');
  assert.equal(scanKindFor('x.MD'), 'markdown');
  assert.equal(scanKindFor('verdict.json'), 'json');
  assert.equal(scanKindFor('a.patch'), 'diff');
  assert.equal(scanKindFor('a.diff'), 'diff');
  assert.equal(scanKindFor('shot.png'), 'image');
  assert.equal(scanKindFor('a.zip'), 'binary');
  assert.equal(scanKindFor('notes.txt'), 'text');
  assert.equal(scanKindFor('Makefile'), 'text');
  for (const k of new Set(Object.values(KIND_BY_EXT))) {
    assert.ok(['markdown', 'json', 'diff', 'image', 'binary'].includes(k), `${k} is a format kind, never plan/review/result/verdict`);
  }
});

test('lists files recursively, sorted, with /-joined run-dir-relative paths; dot entries skipped', async () => {
  const { run, dir } = stepDir({
    'DEVIATIONS.md': '# d', 'tasks/p1-t1-a.md': 'a', 'tasks/p1-t2-b.md': 'b', 'shots/one.png': 'p',
    '.hidden.md': 'h', '.git/config': 'x',
  });
  const { files, warnings } = await scanStepFolder(dir, { pipelineDir: run });
  assert.deepEqual(warnings, []);
  assert.deepEqual(files.map((f) => [f.relPath, f.kind, f.bytes]), [
    ['steps/n_x-c1/DEVIATIONS.md', 'markdown', 3],
    ['steps/n_x-c1/shots/one.png', 'image', 1],
    ['steps/n_x-c1/tasks/p1-t1-a.md', 'markdown', 1],
    ['steps/n_x-c1/tasks/p1-t2-b.md', 'markdown', 1],
  ]);
  for (const f of files) assert.equal(f.path, join(run, ...f.relPath.split('/')), 'path is the absolute file');
});

test('a symlinked file and a symlinked dir are neither listed nor descended', POSIX, async () => {
  const { run, dir } = stepDir({ 'real.md': 'r' });
  const outside = tmp('worca-scan-outside-');
  writeFileSync(join(outside, 'secret.md'), 'S');
  symlinkSync(join(outside, 'secret.md'), join(dir, 'link.md'));
  symlinkSync(outside, join(dir, 'linkdir'), 'dir');
  const { files } = await scanStepFolder(dir, { pipelineDir: run });
  assert.deepEqual(files.map((f) => f.relPath), ['steps/n_x-c1/real.md']);
});

test('depth cap: a file 8 levels down is listed, 9 levels down is not', async () => {
  const { run, dir } = stepDir({ [`${'d/'.repeat(8)}deep.md`]: 'x', [`${'d/'.repeat(9)}deeper.md`]: 'y' });
  const { files } = await scanStepFolder(dir, { pipelineDir: run });
  assert.deepEqual(files.map((f) => f.relPath), [`steps/n_x-c1/${'d/'.repeat(8)}deep.md`]);
});

test('file cap: 50 files are returned, then ONE warning and the rest are dropped', async () => {
  const files = {};
  for (let i = 0; i < 60; i++) files[`f${String(i).padStart(2, '0')}.txt`] = 'x';
  const { run, dir } = stepDir(files);
  const r = await scanStepFolder(dir, { pipelineDir: run });
  assert.equal(r.files.length, 50);
  assert.deepEqual(r.warnings, ['step folder: more than 50 files, the rest are not indexed']);
});

test('size cap: a file above 5 MB is skipped with one warning (sparse file)', async () => {
  const { run, dir } = stepDir({ 'small.md': 's' });
  writeFileSync(join(dir, 'huge.bin'), '');
  await truncate(join(dir, 'huge.bin'), SCAN_LIMITS.maxBytes + 1);
  const r = await scanStepFolder(dir, { pipelineDir: run });
  assert.deepEqual(r.files.map((f) => f.relPath), ['steps/n_x-c1/small.md']);
  assert.deepEqual(r.warnings, ['step folder: skipped steps/n_x-c1/huge.bin (5.0 MB > 5 MB)']);
});

test('skip drops already-indexed rel paths; a missing folder is empty; custom limits apply', async () => {
  const { run, dir } = stepDir({ 'a.md': 'a', 'b.md': 'b' });
  const r = await scanStepFolder(dir, { pipelineDir: run, skip: new Set(['steps/n_x-c1/a.md']) });
  assert.deepEqual(r.files.map((f) => f.relPath), ['steps/n_x-c1/b.md']);
  assert.deepEqual(await scanStepFolder(join(run, 'steps', 'nope-c1'), { pipelineDir: run }), { files: [], warnings: [] });
  const capped = await scanStepFolder(dir, { pipelineDir: run, limits: { ...SCAN_LIMITS, maxFiles: 1 } });
  assert.equal(capped.files.length, 1);
  assert.deepEqual(capped.warnings, ['step folder: more than 1 files, the rest are not indexed']);
});
