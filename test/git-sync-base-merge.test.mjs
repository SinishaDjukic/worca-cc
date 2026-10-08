// Base conflicts (#620): git-sync's merge-tree check, Update branch merge, the terminal's started merge and
// the leftover-marker scan, against real repositories (origin.git + project clone + teammate clone).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBaseMerge, mergeBaseInto, startConflictMerge, conflictMarkers, _testing } from '../src/core/git-sync.mjs';
import { g, GITCONFIG, world as makeWorld, teammatePush, commitOnFeat } from './helpers/base-world.mjs';

let root; const saved = {};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'base-merge-'));
  for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.HOME = root; process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => _testing.reset());

const world = () => makeWorld(root);

test('up to date: the feature already contains the base', async () => {
  const w = world();
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.status, 'up-to-date');
  assert.equal(c.baseRef, 'origin/dev');
  assert.equal(c.behind, 0);
});

test('clean: the remote base moved without touching the feature’s files', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n');
  teammatePush(w, 'g.txt', 'upstream\n');
  const devBefore = g(w.a, 'rev-parse', 'dev');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.status, 'clean');
  assert.equal(c.behind, 1, 'the fetch brought origin/dev in (local dev is still behind)');
  assert.match(c.tree, /^[0-9a-f]{40}$/);
  assert.equal(g(w.a, 'rev-parse', 'dev'), devBefore, 'local dev untouched');
  assert.notEqual(g(w.a, 'rev-parse', 'origin/dev'), devBefore, 'origin/dev moved');
});

test('exit 1 without a tree OID is an error, not a conflict (git exits 1 for an unknown object too)', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const real = _testing.defaultRun;
  _testing.setRunner((args, opts) => (args[0] === 'merge-tree'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'merge-tree: abc - not something we can merge', code: 1 })
    : real(args, opts)));
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.status, 'error'); assert.equal(c.kind, 'failed');
  assert.match(c.error, /not something we can merge/);
});

test('conflicts: lists the files, moves no ref and touches no checkout', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n');
  teammatePush(w, 'f.txt', 'upstream\n');
  const headBefore = g(w.a, 'rev-parse', 'HEAD');
  const featBefore = g(w.a, 'rev-parse', 'feat');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.status, 'conflicts');
  assert.deepEqual(c.files, ['f.txt']);
  assert.equal(c.fileCount, 1);
  assert.equal(g(w.a, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(g(w.a, 'rev-parse', 'feat'), featBefore);
  assert.equal(g(w.a, 'status', '--porcelain'), '', 'the project checkout is clean');
  assert.ok(!existsSync(join(w.a, '.git', 'MERGE_HEAD')));
});

test('no remote: falls back to the local base, not stale', async () => {
  const w = world();
  g(w.a, 'remote', 'remove', 'origin');
  commitOnFeat(w, 'f.txt', 'feature\n');
  writeFileSync(join(w.a, 'f.txt'), 'local dev\n'); g(w.a, 'commit', '-qam', 'local');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.baseRef, 'dev');
  assert.equal(c.remote, null);
  assert.equal(c.stale, false);
  assert.equal(c.status, 'conflicts');
});

test('no remote ignores a lingering remote-tracking ref and uses the local base', async () => {
  const w = world();
  const stale = g(w.a, 'rev-parse', 'origin/dev');
  g(w.a, 'remote', 'remove', 'origin');
  g(w.a, 'update-ref', 'refs/remotes/origin/dev', stale);
  writeFileSync(join(w.a, 'local.txt'), 'local base\n'); g(w.a, 'add', 'local.txt'); g(w.a, 'commit', '-qm', 'local base');
  const local = g(w.a, 'rev-parse', 'dev');

  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });

  assert.equal(c.baseRef, 'dev');
  assert.equal(c.baseSha, local);
  assert.equal(c.remote, null);
});

test('a failed fetch uses the last fetched ref and says so', async () => {
  const w = world();
  g(w.a, 'remote', 'set-url', 'origin', join(w.dir, 'gone.git'));
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.stale, true);
  assert.ok(c.fetchError && c.fetchError.kind);
  assert.equal(c.baseRef, 'origin/dev');
});

test('missing branch and missing base', async () => {
  const w = world();
  assert.equal((await checkBaseMerge(w.a, { base: 'dev', feature: 'nope' })).status, 'no-branch');
  const c = await checkBaseMerge(w.a, { base: 'nope', feature: 'feat' });
  assert.equal(c.status, 'error'); assert.equal(c.kind, 'missing-base');
  assert.equal((await checkBaseMerge(w.a, { base: '-x', feature: 'feat' })).kind, 'bad-base');
});

test('git too old: exit 129 maps to kind git-too-old', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const real = _testing.defaultRun;
  _testing.setRunner((args, opts) => (args[0] === 'merge-tree'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'usage: git merge-tree <base-tree> <branch1> <branch2>', code: 129 })
    : real(args, opts)));
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  assert.equal(c.status, 'error'); assert.equal(c.kind, 'git-too-old');
});

test('mergeBaseInto, branch not checked out: a two-parent merge commit via commit-tree + CAS', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'upstream\n');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  const r = await mergeBaseInto(w.a, { feature: 'feat', baseSha: c.baseSha, headSha: c.headSha, baseRef: c.baseRef, tree: c.tree });
  assert.equal(r.ok, true); assert.equal(r.via, 'commit-tree');
  assert.equal(g(w.a, 'rev-parse', 'feat'), r.to);
  assert.equal(g(w.a, 'rev-list', '--parents', '-n', '1', 'feat'), `${r.to} ${c.headSha} ${c.baseSha}`);
  assert.equal(g(w.a, 'log', '-1', '--format=%s', 'feat'), 'Merge origin/dev into feat');
  assert.equal((await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' })).status, 'up-to-date');
});

test('mergeBaseInto refuses when the branch moved since the check (CAS)', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'upstream\n');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  commitOnFeat(w, 'f.txt', 'feature 2\n');
  const r = await mergeBaseInto(w.a, { feature: 'feat', baseSha: c.baseSha, headSha: c.headSha, baseRef: c.baseRef, tree: c.tree });
  assert.equal(r.ok, false); assert.equal(r.kind, 'moved');
});

test('mergeBaseInto in a clean checkout merges there; a dirty one is refused', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'upstream\n');
  const wt = join(w.dir, 'co'); g(w.a, 'worktree', 'add', '-q', wt, 'feat');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  writeFileSync(join(wt, 'f.txt'), 'dirty\n');
  let r = await mergeBaseInto(w.a, { feature: 'feat', baseSha: c.baseSha, headSha: c.headSha, baseRef: c.baseRef, tree: c.tree });
  assert.equal(r.kind, 'dirty');
  g(wt, 'checkout', '--', 'f.txt');
  r = await mergeBaseInto(w.a, { feature: 'feat', baseSha: c.baseSha, headSha: c.headSha, baseRef: c.baseRef, tree: c.tree });
  assert.equal(r.ok, true); assert.equal(r.via, 'merge');
  assert.equal(readFileSync(join(wt, 'g.txt'), 'utf8'), 'upstream\n', 'the checkout has the base change');
});

test('startConflictMerge leaves the merge in progress with the unmerged files; a second call is idempotent', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'f.txt', 'upstream\n');
  const c = await checkBaseMerge(w.a, { base: 'dev', feature: 'feat' });
  const wt = join(w.dir, 'co'); g(w.a, 'worktree', 'add', '-q', wt, 'feat');
  let r = await startConflictMerge(wt, { feature: 'feat', baseSha: c.baseSha, baseRef: c.baseRef });
  assert.deepEqual(r, { ok: true, started: true, files: ['f.txt'] });
  assert.match(readFileSync(join(wt, 'f.txt'), 'utf8'), /^<<<<<<< /m);
  r = await startConflictMerge(wt, { feature: 'feat', baseSha: c.baseSha, baseRef: c.baseRef });
  assert.deepEqual(r, { ok: true, started: false, files: ['f.txt'] });
});

test('conflictMarkers finds leftover markers on a branch tip', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> origin/dev\n');
  assert.deepEqual(await conflictMarkers(w.a, 'feat', ['f.txt', 'g.txt']), ['f.txt']);
  assert.deepEqual(await conflictMarkers(w.a, 'feat', []), []);
});

test('conflictMarkers distinguishes git grep failure from no markers', async () => {
  const w = world();
  const real = _testing.defaultRun;
  _testing.setRunner((args, opts) => (args[0] === 'grep'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: object read failed', code: 128 })
    : real(args, opts)));

  assert.deepEqual(await conflictMarkers(w.a, 'feat', ['f.txt']), {
    ok: false, kind: 'failed', error: 'fatal: object read failed',
  });
});
