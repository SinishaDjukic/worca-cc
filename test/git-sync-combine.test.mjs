// test/git-sync-combine.test.mjs — one ship flow, slice 3: a user group's combine check (git merge-tree over every
// member branch) and the combined branch One ships from, against real repositories. No checkout ever moves.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCombine, writeCombinedBranch, _testing } from '../src/core/git-sync.mjs';
import { g, GITCONFIG, world as makeWorld, commitOnFeat } from './helpers/base-world.mjs';

let root; const saved = {};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'combine-'));
  for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.HOME = root; process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => _testing.reset());

/** dev with f.txt, g.txt and h.txt; branches b1..bN at dev, each committing `edits[i]` = [file, text]. */
function groupWorld(edits) {
  const w = makeWorld(root, { feature: 'b1' });
  writeFileSync(join(w.a, 'h.txt'), 'h\n'); g(w.a, 'add', 'h.txt'); g(w.a, 'commit', '-qm', 'h');
  edits.forEach(([file, text], i) => {
    const b = `b${i + 1}`;
    g(w.a, 'branch', '-f', b, 'dev');                  // b1 exists (world's feature) and is not checked out
    commitOnFeat(w, file, text, b);
  });
  return w;
}
/** HEAD, the named branches and the checkout's status: nothing of it may change. */
const snapshot = (w, branches) => [g(w.a, 'rev-parse', 'HEAD'), ...branches.map((b) => g(w.a, 'rev-parse', b)),
  g(w.a, 'status', '--porcelain')];

test('two branches touching different files combine clean; nothing is checked out or moved', async () => {
  const w = groupWorld([['f.txt', 'one from b1\n'], ['g.txt', 'g from b2\n']]);
  const heads0 = snapshot(w, ['b1', 'b2']);
  const c = await checkCombine(w.a, { branches: ['b1', 'b2'] });
  assert.equal(c.status, 'clean');
  assert.match(c.tree, /^[0-9a-f]{40}$/);
  assert.deepEqual(c.heads, heads0.slice(1, 3));
  assert.deepEqual(snapshot(w, ['b1', 'b2']), heads0);
  assert.equal(heads0[3], '', 'the checkout is clean');
});

test('two branches editing the same line report a conflict naming the file', async () => {
  const w = groupWorld([['f.txt', 'b1 says\n'], ['f.txt', 'b2 says\n']]);
  const c = await checkCombine(w.a, { branches: ['b1', 'b2'] });
  assert.equal(c.status, 'conflicts');
  assert.deepEqual(c.files, ['f.txt']);
  assert.equal(c.fileCount, 1);
  assert.equal(c.branch, 'b2');
});

test('three branches fold: the third conflicting with the first is caught after the first merge', async () => {
  const clean = groupWorld([['f.txt', 'b1\n'], ['g.txt', 'b2\n'], ['h.txt', 'b3\n']]);
  assert.equal((await checkCombine(clean.a, { branches: ['b1', 'b2', 'b3'] })).status, 'clean');
  const bad = groupWorld([['f.txt', 'b1\n'], ['g.txt', 'b2\n'], ['f.txt', 'b3\n']]);
  const c = await checkCombine(bad.a, { branches: ['b1', 'b2', 'b3'] });
  assert.deepEqual([c.status, c.files, c.branch], ['conflicts', ['f.txt'], 'b3']);
});

test('a missing branch is no-branch; fewer than two or an unsafe name is a bad request', async () => {
  const w = groupWorld([['f.txt', 'x\n'], ['g.txt', 'y\n']]);
  assert.deepEqual(await checkCombine(w.a, { branches: ['b1', 'nope'] }), { status: 'no-branch', branch: 'nope', files: [], fileCount: 0 });
  assert.equal((await checkCombine(w.a, { branches: ['b1'] })).kind, 'bad-request');
  assert.equal((await checkCombine(w.a, { branches: ['b1', '-x'] })).kind, 'bad-branch');
});

test('writeCombinedBranch: one commit, every member head a parent, both changes in its tree; a retry reuses it; nothing else moves', async () => {
  const w = groupWorld([['f.txt', 'one from b1\n'], ['g.txt', 'g from b2\n']]);
  const c = await checkCombine(w.a, { branches: ['b1', 'b2'] });
  const heads0 = snapshot(w, ['b1', 'b2', 'dev']);
  const made = await writeCombinedBranch(w.a, { branch: 'worca-cc/polish-a1b2c3d4', combine: c, message: 'Combine 2 runs: Polish' });
  assert.deepEqual([made.ok, made.via], [true, 'created']);
  assert.equal(g(w.a, 'rev-list', '--parents', '-n', '1', 'worca-cc/polish-a1b2c3d4').split(' ').slice(1).join(' '), c.heads.join(' '));
  assert.equal(g(w.a, 'show', 'worca-cc/polish-a1b2c3d4:f.txt'), 'one from b1');
  assert.equal(g(w.a, 'show', 'worca-cc/polish-a1b2c3d4:g.txt'), 'g from b2');
  assert.deepEqual(snapshot(w, ['b1', 'b2', 'dev']), heads0, 'only the new group branch ref appears');
  const again = await writeCombinedBranch(w.a, { branch: 'worca-cc/polish-a1b2c3d4', combine: c, message: 'Combine 2 runs: Polish' });
  assert.deepEqual([again.ok, again.via, again.sha], [true, 'reused', made.sha]);
});

test('writeCombinedBranch refuses a branch that exists with other commits, and a result that is not clean', async () => {
  const w = groupWorld([['f.txt', 'x\n'], ['g.txt', 'y\n']]);
  g(w.a, 'branch', 'worca-cc/taken', 'dev');
  const c = await checkCombine(w.a, { branches: ['b1', 'b2'] });
  const r = await writeCombinedBranch(w.a, { branch: 'worca-cc/taken', combine: c, message: 'm' });
  assert.deepEqual([r.ok, r.kind], [false, 'exists']);
  assert.match(r.error, /already exists with other commits/);
  assert.equal((await writeCombinedBranch(w.a, { branch: 'worca-cc/x', combine: { status: 'conflicts' }, message: 'm' })).kind, 'bad-request');
});
