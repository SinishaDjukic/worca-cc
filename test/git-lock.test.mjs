// test/git-lock.test.mjs
// clearStaleGitLocks: a git killed while holding a lock (SIGKILL skips git's own cleanup)
// leaves index.lock, HEAD.lock or the branch's ref lock behind, and every later add/commit
// in that checkout fails with "File exists". The helper removes a lock only when it is old
// enough that no live git can still own it. Run teardown is the real case, so the
// linked-worktree gitdir and the common dir it shares with every worktree are covered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes, realpath, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearStaleGitLocks, staleGitLockNote, STALE_INDEX_LOCK_MS } from '../src/core/git-lock.mjs';
import { snapshotWorktreePatch, commitStagedWork } from '../src/core/worktree.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const created = [];
after(async () => { for (const d of created) await rm(d, { recursive: true, force: true }); });

async function tmp() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-git-lock-')));
  created.push(dir);
  return dir;
}

const g = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const STALE = STALE_INDEX_LOCK_MS + 60_000;

function freshRepo() {
  const dir = realpathSync(templateRepo('git-lock', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } }));
  created.push(dir);
  return dir;
}

/** A linked worktree on `feature`. Its index and HEAD locks live under <repo>/.git/worktrees/<name>/,
 *  the branch ref and packed-refs locks in the common <repo>/.git that every worktree shares. */
async function linkedWorktree() {
  const repo = await freshRepo();
  const wt = join(await tmp(), 'wt');
  g(repo, ['worktree', 'add', '-q', '-b', 'feature', wt]);
  const admin = join(repo, '.git', 'worktrees', 'wt');
  return {
    repo, wt,
    lock: join(admin, 'index.lock'),
    headLock: join(admin, 'HEAD.lock'),
    refLock: join(repo, '.git', 'refs', 'heads', 'feature.lock'),
    packedLock: join(repo, '.git', 'packed-refs.lock'),
  };
}

async function plantLock(path, ageMs) {
  await writeFile(path, '');
  const t = (Date.now() - ageMs) / 1000;
  await utimes(path, t, t);
}

const treeOf = (dir, ref) => g(dir, ['ls-tree', '-r', '--name-only', ref]).stdout.split('\n').filter(Boolean);

// One repo: nothing to clear before any lock exists, then a fresh lock is planted
// and must survive.
test('nothing to clear: no lock, a fresh lock (kept), not a git checkout', async () => {
  const repo = await freshRepo();
  await checkRows([
    { name: 'no lock, or not a git checkout: nothing to clear', run: async () => {
      assert.deepEqual(await clearStaleGitLocks(repo), []);
      assert.deepEqual(await clearStaleGitLocks(await tmp()), []);
    } },
    { name: 'keeps a fresh index.lock: a live git may still own it', run: async () => {
      const lock = join(repo, '.git', 'index.lock');
      await plantLock(lock, 5_000);
      assert.deepEqual(await clearStaleGitLocks(repo), []);
      assert.equal(existsSync(lock), true);
    } },
  ]);
});

// One linked worktree: snapshot with no lock, then plant a stale lock and snapshot
// again to a second path, then plant what a killed `git commit` leaves and snapshot a third time.
test('snapshotWorktreePatch: no clearedLocks without a lock; past stale locks it saves the work and reports each removal', async () => {
  const { wt, lock, headLock, refLock } = await linkedWorktree();
  await writeFile(join(wt, 'feature.mjs'), 'export {};\n');
  await checkRows([
    { name: 'snapshotWorktreePatch reports no clearedLocks when there was no lock', run: async () => {
      const res = await snapshotWorktreePatch(wt, join(await tmp(), 'retained.patch'));
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal('clearedLocks' in res, false);
    } },
    { name: 'snapshotWorktreePatch saves the work past a stale lock (retained-run discard/delete)', run: async () => {
      await plantLock(lock, STALE);
      const out = join(await tmp(), 'retained.patch');
      const res = await snapshotWorktreePatch(wt, out);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.file, out);
      assert.equal(existsSync(lock), false);
      // the caller turns each one into a run warning / audit line, so the removal leaves a trace
      assert.deepEqual(res.clearedLocks.map((l) => l.path), [lock]);
      assert.ok(res.clearedLocks[0].ageMs >= STALE_INDEX_LOCK_MS);
      assert.match(staleGitLockNote(res.clearedLocks[0]), /removed a stale git index lock \(\d+ min old/);
    } },
    { name: 'a git commit killed while it updated the branch leaves the index, HEAD and ref locks: all are removed and reported', run: async () => {
      for (const p of [lock, headLock, refLock]) await plantLock(p, STALE);
      const out = join(await tmp(), 'retained.patch');
      const res = await snapshotWorktreePatch(wt, out);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.file, out);
      assert.deepEqual([lock, headLock, refLock].filter((p) => existsSync(p)), []);
      assert.deepEqual(res.clearedLocks.map((l) => [l.kind, l.path]), [['index', lock], ['HEAD', headLock], ['branch ref', refLock]]);
    } },
  ]);
});

test('HEAD and branch ref locks in a linked worktree: stale ones are removed and the commit goes through; a fresh ref lock is kept', async () => {
  await checkRows([
    { name: 'every stale lock is removed and returned, each resolved to its own folder, each with its own note', run: async () => {
      const { wt, lock, headLock, refLock, packedLock } = await linkedWorktree();
      for (const p of [lock, headLock, refLock, packedLock]) await plantLock(p, STALE);
      const cleared = await clearStaleGitLocks(wt);
      assert.deepEqual(cleared.map((l) => [l.kind, l.path]),
        [['index', lock], ['HEAD', headLock], ['branch ref', refLock], ['packed-refs', packedLock]]);
      assert.deepEqual([lock, headLock, refLock, packedLock].filter((p) => existsSync(p)), []);
      for (const l of cleared) {
        assert.ok(l.ageMs >= STALE_INDEX_LOCK_MS);
        assert.equal(staleGitLockNote(l),
          `removed a stale git ${l.kind} lock (${Math.round(l.ageMs / 60_000)} min old, left by a killed git process): ${l.path}`);
      }
    } },
    { name: 'a stale HEAD.lock and branch ref lock: the end-of-run commit goes through', run: async () => {
      const { repo, wt, headLock, refLock } = await linkedWorktree();
      await writeFile(join(wt, 'feature.mjs'), 'export {};\n');
      await plantLock(headLock, STALE);
      await plantLock(refLock, STALE);
      const res = await commitStagedWork(wt, { message: 'worca: x', branch: 'feature' });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.committed, true);
      assert.deepEqual([headLock, refLock].filter((p) => existsSync(p)), []);
      assert.ok(treeOf(repo, 'feature').includes('feature.mjs'));
    } },
    { name: 'a fresh branch ref lock is kept (another worktree\'s live commit may hold it) and the commit fails as before', run: async () => {
      const { repo, wt, refLock } = await linkedWorktree();
      await writeFile(join(wt, 'feature.mjs'), 'export {};\n');
      await plantLock(refLock, 5_000);
      assert.deepEqual(await clearStaleGitLocks(wt), []);
      const res = await commitStagedWork(wt, { message: 'worca: x', branch: 'feature' });
      assert.equal(res.ok, false);
      assert.equal(res.step, 'commit');
      assert.match(res.message, /feature\.lock/);
      assert.equal(existsSync(refLock), true);
      assert.equal(treeOf(repo, 'feature').includes('feature.mjs'), false);
    } },
    { name: 'a detached HEAD has no branch ref lock to check; its HEAD.lock is still removed', run: async () => {
      const { wt, headLock, refLock } = await linkedWorktree();
      g(wt, ['checkout', '-q', '--detach']);
      await plantLock(headLock, STALE);
      await plantLock(refLock, STALE);
      assert.deepEqual((await clearStaleGitLocks(wt)).map((l) => l.path), [headLock]);
      assert.equal(existsSync(refLock), true);
    } },
  ]);
});
