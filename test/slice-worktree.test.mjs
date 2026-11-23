// slice-worktree.mjs: the throwaway-index tree, the per-task change record, and the rule that
// decides whether a finished task's work left the working tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { ABSENT, worktreeTree, treeChanges, idsAt, workLost, earlierContents } from '../src/core/slice-worktree.mjs';

const gitIn = (dir) => async (args, { env } = {}) => {
  try {
    return { ok: true, stdout: execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' }) };
  } catch (err) { return { ok: false, stdout: '', stderr: String(err.stderr || err.message) }; }
};

test('worktreeTree reads new, changed and deleted files without touching the real index; excludes stay out', async () => {
  const dir = gitDir('slicewt');
  writeFileSync(join(dir, 'keep.txt'), 'k0'); writeFileSync(join(dir, 'gone.txt'), 'g0');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'files'], { cwd: dir });
  const git = gitIn(dir);
  const t0 = await worktreeTree(git, dir);
  const indexBefore = readFileSync(join(dir, '.git', 'index'));
  writeFileSync(join(dir, 'keep.txt'), 'k1'); rmSync(join(dir, 'gone.txt'));
  mkdirSync(join(dir, 'sub')); writeFileSync(join(dir, 'sub', 'new file.txt'), 'n');
  writeFileSync(join(dir, 'mount.txt'), 'worca');
  const t1 = await worktreeTree(git, dir, [':(exclude)mount.txt']);
  assert.ok(readFileSync(join(dir, '.git', 'index')).equals(indexBefore), 'the real index is unchanged');
  const changes = await treeChanges(git, t0, t1);
  assert.deepEqual(changes.map(([p, b, a]) => [p, b === ABSENT, a === ABSENT]).sort(),
    [['gone.txt', false, true], ['keep.txt', false, false], ['sub/new file.txt', true, false]]);
  const ids = await idsAt(git, t1, ['keep.txt', 'gone.txt', 'sub/new file.txt']);
  assert.equal(ids.get('keep.txt'), changes.find(([p]) => p === 'keep.txt')[2]);
  assert.equal(ids.has('gone.txt'), false);
  assert.deepEqual(await treeChanges(git, t1, t1), []);
});

test('workLost: a path back at earlier content is lost, new content (a user edit) is not', () => {
  // A changed x0 -> x1, then B (a later phase) changed x1 -> x2.
  const A = { worktree: { p: [['x', 'x0', 'x1']] } };
  const B = { worktree: { p: [['x', 'x1', 'x2']] } };
  const earlier = earlierContents([A, B]);
  const at = (id) => new Map([['p', new Map(id === ABSENT ? [] : [['x', id]])]]);
  assert.equal(workLost(A.worktree, earlier, at('x2')), false, 'nothing reverted');
  assert.equal(workLost(B.worktree, earlier, at('x2')), false);
  assert.equal(workLost(A.worktree, earlier, at('x0')), true, 'checkout back to the start: both lost');
  assert.equal(workLost(B.worktree, earlier, at('x0')), true);
  assert.equal(workLost(A.worktree, earlier, at('x1')), false, 'only B reverted');
  assert.equal(workLost(B.worktree, earlier, at('x1')), true);
  assert.equal(workLost(A.worktree, earlier, at('u')), false, 'the user wrote something new');
  assert.equal(workLost(B.worktree, earlier, at('u')), false);
  // A new file a `git clean` removed.
  const C = { worktree: { p: [['n', ABSENT, 'n1']] } };
  const e2 = earlierContents([C]);
  assert.equal(workLost(C.worktree, e2, new Map([['p', new Map()]])), true);
  assert.equal(workLost({}, e2, new Map()), false, 'a task that changed nothing');
  // `git checkout .` empties an intent-to-add file instead of removing it.
  const empty = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  assert.equal(workLost(C.worktree, e2, new Map([['p', new Map([['n', empty]])]])), true, 'a created file emptied by checkout');
  const T = { worktree: { p: [['t', 't0', 't1']] } };
  assert.equal(workLost(T.worktree, earlierContents([T]), new Map([['p', new Map([['t', empty]])]])), false,
    'a tracked file the user emptied is new content');
  // A SHA-256 repo prints 64 zeros for an absent side.
  const D = { worktree: { p: [['d', '0'.repeat(64), 'd1']] } };
  assert.equal(workLost(D.worktree, earlierContents([D]), new Map([['p', new Map()]])), true);
});
