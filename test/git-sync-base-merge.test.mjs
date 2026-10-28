// Base conflicts (#620): git-sync's merge-tree check, Update branch merge, the terminal's started merge and
// the leftover-marker scan, against real repositories (origin.git + project clone + teammate clone).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBaseMerge, mergeBaseInto, startConflictMerge, mergeBaseBeforeRun, baseMovedAudit, _testing } from '../src/core/git-sync.mjs';
import { buildDecisionLog } from '../src/shared/shape/feature-log.mjs';
import { leftoverMarkers, _testing as gitInfo } from '../src/core/git-info.mjs';
import { g, GITCONFIG, world as makeWorld, teammatePush, commitOnFeat } from './helpers/base-world.mjs';
import { withEnv } from './helpers/with-env.mjs';

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

test('a Bitbucket base: the merge-tree check reads with the Bitbucket read helper (Resolve on Bitbucket)', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n'); teammatePush(w, 'g.txt', 'u\n');
  const real = _testing.defaultRun;
  let mergeTreeEnv;
  _testing.setRunner((args, opts) => {
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return Promise.resolve({ ok: true, stdout: 'https://bitbucket.org/acme/api.git\n', stderr: '', code: 0, timedOut: false });
    }
    if (args[0] === 'merge-tree') mergeTreeEnv = opts.env;
    return real(args, opts);
  });
  const c = await withEnv({ WORCA_BB_TOKEN: 'bbtok', WORCA_BB_READ_TOKEN: undefined, WORCA_BB_WRITE_TOKEN: undefined, WORCA_BB_EMAIL: undefined },
    () => checkBaseMerge(w.a, { base: 'dev', feature: 'feat' }));
  assert.equal(c.status, 'clean', JSON.stringify(c));
  assert.equal(mergeTreeEnv?.WORCA_BB_GIT_TOKEN, 'bbtok');
  assert.equal(mergeTreeEnv?.WORCA_BB_TOKEN, undefined);
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

test('a remote-tracking source (origin/dev) checks against dev on origin; a local branch named origin/dev stays', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'feature\n');
  teammatePush(w, 'f.txt', 'upstream\n');
  const c = await checkBaseMerge(w.a, { base: 'origin/dev', feature: 'feat' });
  assert.equal(c.status, 'conflicts', 'not missing-base');
  assert.deepEqual([c.base, c.baseRef, c.remote], ['dev', 'origin/dev', 'origin']);
  assert.equal(c.baseSha, g(w.a, 'rev-parse', 'refs/remotes/origin/dev'));

  const initSha = g(w.a, 'rev-parse', 'dev');
  g(w.a, 'branch', 'origin/dev', initSha);
  const k = await checkBaseMerge(w.a, { base: 'origin/dev', feature: 'feat' });
  assert.deepEqual([k.status, k.base, k.baseRef, k.baseSha], ['up-to-date', 'origin/dev', 'origin/dev', initSha], 'the local branch is the base');
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

test('leftoverMarkers names markers added between two commits, narrowed to the given files', async () => {
  const w = world();
  const from = g(w.a, 'rev-parse', 'feat');
  commitOnFeat(w, 'f.txt', '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> origin/dev\n');
  const to = g(w.a, 'rev-parse', 'feat');
  const all = await leftoverMarkers(w.a, { from, to });
  assert.equal(all.ok, true);
  assert.deepEqual([...new Set(all.markers.map((x) => x.replace(/:\d+$/, '')))], ['f.txt']);
  assert.deepEqual((await leftoverMarkers(w.a, { from, to, files: ['g.txt'] })).markers, []);
  assert.deepEqual((await leftoverMarkers(w.a, { from: to, to })).markers, []);
});

test('leftoverMarkers reports a git failure instead of no markers', async () => {
  const w = world();
  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: bad object', code: 128 }));
  try {
    assert.deepEqual(await leftoverMarkers(w.a, { from: 'a', to: 'b' }), { ok: false, error: 'fatal: bad object' });
  } finally { gitInfo.reset(); }
});

test('s5: dev moved after run 2 started → run 3 merges the base before it starts; the feature log says so', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'run 2\n');                    // run 2's branch: feat
  teammatePush(w, 'g.txt', 'hotfix on dev\n');            // dev moves while run 2 runs
  g(w.a, 'branch', 'run-3', 'feat');                      // run 3 is cut from run 2's branch (sourceFromPrevious)
  const feat = g(w.a, 'rev-parse', 'feat');
  const r = await mergeBaseBeforeRun(w.a, { base: 'dev', feature: 'run-3' });
  assert.equal(r.merged, true);
  assert.equal(r.behind, 1);
  assert.equal(g(w.a, 'show', 'run-3:g.txt'), 'hotfix on dev', 'run 3 starts from the moved base');
  assert.equal(g(w.a, 'rev-parse', 'run-3'), r.to);
  assert.equal(g(w.a, 'rev-parse', 'feat'), feat, 'run 2\'s branch is not touched');
  const line = baseMovedAudit('dev', 'run-3', r);
  assert.equal(line, 'Base `dev` moved: merged into `run-3` (1 commit).');
  const log = buildDecisionLog({ sliced: true, slices: [], runs: [{ index: 3, events: [line] }] });
  assert.equal(log[0].text, 'dev moved · run 3 starts from it');
});

test('s5: dev did not move → nothing merged, no audit line', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'run 2\n');
  g(w.a, 'branch', 'run-3', 'feat');
  const r = await mergeBaseBeforeRun(w.a, { base: 'dev', feature: 'run-3' });
  assert.deepEqual([r.merged, r.status], [false, 'up-to-date']);
  assert.equal(baseMovedAudit('dev', 'run-3', r), null);
});

test('s5: a clash with dev → the branch is left as is and the audit line names the files', async () => {
  const w = world();
  commitOnFeat(w, 'f.txt', 'run 2\n');
  teammatePush(w, 'f.txt', 'dev\n');
  g(w.a, 'branch', 'run-3', 'feat');
  const before = g(w.a, 'rev-parse', 'run-3');
  const r = await mergeBaseBeforeRun(w.a, { base: 'dev', feature: 'run-3' });
  assert.deepEqual([r.merged, r.status, r.files], [false, 'conflicts', ['f.txt']]);
  assert.equal(g(w.a, 'rev-parse', 'run-3'), before);
  assert.equal(baseMovedAudit('dev', 'run-3', r), 'Base `dev` moved: conflicts in 1 file.');
});
