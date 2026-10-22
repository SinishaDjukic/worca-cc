// test/no-project-work.test.mjs — P3: a run's work/ folder moves into its pipeline dir and lists what to index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, rename } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harvestWork, WORK_INDEX_MAX } from '../src/core/no-project-work.mjs';
import { RUN_ROOT_KNOWN_SET, RETAIN_REASONS, scanStrayEntries, writeRunManifest } from '../src/core/run-manifest.mjs';

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'worca-np-work-'));
  const workDir = join(base, 'runs', 'abcd1234', 'work');
  const pipelineDir = join(base, 'store', 'p');
  await mkdir(join(workDir, 'charts'), { recursive: true });
  await mkdir(join(workDir, 'node_modules', 'x'), { recursive: true });
  await mkdir(join(workDir, '.claude', 'rules', 'worca'), { recursive: true });
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(join(workDir, 'deck.html'), '<html></html>');            // 13 bytes
  await writeFile(join(workDir, 'charts', 'headcount.svg'), '<svg/>');    // 6 bytes
  await writeFile(join(workDir, 'node_modules', 'x', 'i.js'), 'x');
  await writeFile(join(workDir, '.claude', 'rules', 'worca', 'r.md'), 'r');
  return { base, workDir, pipelineDir };
}

test('the work folder MOVES; deps and worca mounts stay unindexed; rel paths are POSIX on every OS', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  const h = await harvestWork({ workDir, pipelineDir });
  assert.deepEqual(h, { ok: true, moved: true, files: ['work/charts/headcount.svg', 'work/deck.html'], bytes: 19, unindexed: 0 });
  assert.equal(existsSync(workDir), false);
  assert.ok(existsSync(join(pipelineDir, 'work', 'node_modules', 'x', 'i.js')), 'kept on disk, just not indexed');
  await rm(base, { recursive: true, force: true });
});

test('a rename that fails across volumes (or on a held handle) falls back to a copy; a failed copy keeps the source', async () => {
  for (const code of ['EXDEV', 'EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST']) {
    const { base, workDir, pipelineDir } = await fixture();
    const h = await harvestWork({ workDir, pipelineDir }, { rename: async () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(h.ok, true, code); assert.equal(h.moved, false, code);
    assert.deepEqual(h.files, ['work/charts/headcount.svg', 'work/deck.html']);
    assert.ok(existsSync(join(pipelineDir, 'work', 'deck.html')));
    await rm(base, { recursive: true, force: true });
  }
  const { base, workDir, pipelineDir } = await fixture();
  const h = await harvestWork({ workDir, pipelineDir }, {
    rename: async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); },
    cp: async () => { throw Object.assign(new Error('ENAMETOOLONG: name too long'), { code: 'ENAMETOOLONG' }); },
  });
  assert.deepEqual([h.ok, h.moved, h.error], [false, false, 'ENAMETOOLONG: name too long']);
  assert.ok(existsSync(join(workDir, 'deck.html')), 'the source is never removed on failure');
  await rm(base, { recursive: true, force: true });
});

test('a FIFO (or socket) in work/ never fails the copy fallback', { skip: process.platform === 'win32' }, async () => {
  const { base, workDir, pipelineDir } = await fixture();
  execFileSync('mkfifo', [join(workDir, 'dev.pipe')]);   // a dev server's pipe; fs.cp throws "Cannot copy a FIFO pipe" on it
  const h = await harvestWork({ workDir, pipelineDir }, { rename: async () => { throw Object.assign(new Error('x'), { code: 'EXDEV' }); } });
  assert.deepEqual([h.ok, h.files], [true, ['work/charts/headcount.svg', 'work/deck.html']]);
  await rm(base, { recursive: true, force: true });
});

test('a runs/<id> that is a link is not the run\'s own folder: nothing moves, nothing is indexed (P3-D13)', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  const real = join(base, 'elsewhere');
  await rename(join(base, 'runs', 'abcd1234'), real);
  try { await symlink(real, join(base, 'runs', 'abcd1234'), 'dir'); } catch (e) { if (e.code === 'EPERM') { await rm(base, { recursive: true, force: true }); return; } throw e; }
  const h = await harvestWork({ workDir, pipelineDir });
  assert.deepEqual([h.ok, h.moved, h.error], [false, false, 'work/ is not the run\'s own folder']);
  assert.ok(existsSync(join(real, 'work', 'deck.html')), 'the linked folder is untouched');
  assert.equal(existsSync(join(pipelineDir, 'work')), false);
  await rm(base, { recursive: true, force: true });
});

test('symlinks are never indexed; the cap counts what it leaves out; a missing folder is fine', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  try { await symlink(tmpdir(), join(workDir, 'leak')); } catch (e) { if (e.code !== 'EPERM') throw e; }   // Windows without the privilege: skip that half
  const h = await harvestWork({ workDir, pipelineDir }, { max: 1 });
  assert.deepEqual([h.files, h.unindexed, h.bytes], [['work/charts/headcount.svg'], 1, 6], 'bytes count indexed files only');
  assert.equal(WORK_INDEX_MAX, 2000);
  assert.deepEqual(await harvestWork({ workDir: join(base, 'nope'), pipelineDir: join(base, 'empty') }), { ok: true, moved: false, files: [], bytes: 0, unindexed: 0 });
  await rm(base, { recursive: true, force: true });
});

test('a harvest that moved work/ but died before indexing it: the next harvest lists what already landed', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  await rename(workDir, join(pipelineDir, 'work'));   // the move happened; the index rows and the run.json stamp did not
  assert.deepEqual(await harvestWork({ workDir, pipelineDir }), { ok: true, moved: false, files: ['work/charts/headcount.svg', 'work/deck.html'], bytes: 19, unindexed: 0 });
  await rm(base, { recursive: true, force: true });
});

test('a re-harvest into an existing <pipelineDir>/work copies over it and never renames', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  await mkdir(join(pipelineDir, 'work'), { recursive: true });
  await writeFile(join(pipelineDir, 'work', 'deck.html'), 'old');
  let renamed = 0;
  const h = await harvestWork({ workDir, pipelineDir }, { rename: async () => { renamed += 1; } });
  assert.deepEqual([renamed, h.ok, h.moved, h.files, h.bytes], [0, true, false, ['work/charts/headcount.svg', 'work/deck.html'], 19]);
  await rm(base, { recursive: true, force: true });
});

test('work/ is worca\'s own entry at a no-project run root (an agent\'s stray at any other), and a failed copy has a retain reason', async () => {
  assert.ok(RUN_ROOT_KNOWN_SET.has('work'));
  assert.equal(RETAIN_REASONS.WORK_COPY_FAILED, 'work_copy_failed');
  const { base, workDir } = await fixture();
  const runRoot = join(workDir, '..');
  assert.equal((await scanStrayEntries({ runRoot, pipelineDir: null })).length, 1, 'a workspace run (cwd = the run root) keeps its work/ rescued');
  await writeRunManifest(runRoot, { pipelineId: 'abcd1234', runRootMode: 'detached', isWorkspace: false, workMode: 'none', members: [] });
  assert.deepEqual(await scanStrayEntries({ runRoot, pipelineDir: null }), []);
  await rm(base, { recursive: true, force: true });
});

test('a work/ the agent swapped for a link is never moved or indexed: the root is kept', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  const outside = join(base, 'server-only');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'canary.txt'), 'secret');
  await rm(workDir, { recursive: true, force: true });
  try { await symlink(outside, workDir, 'dir'); } catch (e) { if (e.code === 'EPERM') { await rm(base, { recursive: true, force: true }); return; } throw e; }   // Windows without the privilege
  const h = await harvestWork({ workDir, pipelineDir });
  assert.deepEqual([h.ok, h.moved, h.error], [false, false, 'work/ is not the run\'s own folder']);
  assert.equal(existsSync(join(pipelineDir, 'work')), false, 'nothing moved into the pipeline folder');
  assert.ok(existsSync(join(outside, 'canary.txt')));
  await rm(base, { recursive: true, force: true });
});

test('the copy fallback never recreates a link (EPERM on Windows without the privilege; ENOENT re-copying a dangling one): the files still land', async () => {
  const { base, workDir, pipelineDir } = await fixture();
  try {
    await symlink('missing-target', join(workDir, 'dangling'));
    await symlink(join(workDir, 'charts'), join(workDir, 'latest'), 'junction');
  } catch (e) { if (e.code === 'EPERM') { await rm(base, { recursive: true, force: true }); return; } throw e; }
  const held = { rename: async () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } };   // a shell's cwd in work/ on Windows
  const h = await harvestWork({ workDir, pipelineDir }, held);
  assert.deepEqual([h.ok, h.moved, h.files], [true, false, ['work/charts/headcount.svg', 'work/deck.html']]);
  for (const l of ['dangling', 'latest']) assert.equal(lstatSync(join(pipelineDir, 'work', l), { throwIfNoEntry: false }), undefined, l);
  const again = await harvestWork({ workDir, pipelineDir });   // the copy landed, the workHarvested stamp did not: the sweep copies again
  assert.deepEqual([again.ok, again.files], [true, ['work/charts/headcount.svg', 'work/deck.html']], again.error);
  await rm(base, { recursive: true, force: true });
});
