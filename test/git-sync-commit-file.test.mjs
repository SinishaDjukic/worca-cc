// test/git-sync-commit-file.test.mjs — commitFileOnBranch (D25): one file committed on a branch, checked out or not,
// against real repositories.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitFileOnBranch, _testing } from '../src/core/git-sync.mjs';
import { g, GITCONFIG } from './helpers/base-world.mjs';

let root; const saved = {};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'commit-file-'));
  for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.HOME = root; process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => _testing.reset());

let n = 0;
/** A repo on dev with a branch `b` (not checked out) one commit ahead. */
function repo() {
  const dir = join(root, `r${++n}`);
  mkdirSync(dir, { recursive: true });
  g(dir, 'init', '-q');
  writeFileSync(join(dir, 'f.txt'), 'one\n');
  g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init');
  g(dir, 'branch', 'b');
  return dir;
}
const add = (text) => (cur) => `${cur}${text}`;

test('a branch not checked out gets a commit through a temporary index; the main worktree is untouched', async () => {
  const dir = repo();
  writeFileSync(join(dir, 'dirty.txt'), 'staged elsewhere\n'); g(dir, 'add', 'dirty.txt');
  const tip = g(dir, 'rev-parse', 'b');
  let seenText = null;
  const r = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: (t) => { seenText = t; return '# Changelog\n'; }, message: 'Changelog: T' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.via, 'commit-tree');
  assert.equal(seenText, '', 'no file yet: the update gets an empty text');
  assert.equal(g(dir, 'show', 'b:CHANGELOG.md'), '# Changelog');
  assert.equal(g(dir, 'rev-parse', 'b^'), tip);
  assert.equal(g(dir, 'rev-parse', 'b'), r.sha);
  assert.equal(g(dir, 'show', 'b:f.txt'), 'one', 'the rest of the tree is kept');
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), 'dirty.txt', 'the main index is untouched');
  assert.equal(g(dir, 'status', '--porcelain', '--', 'CHANGELOG.md'), '', 'no CHANGELOG.md in the main worktree');
  const r2 = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: (t) => { seenText = t; return `${t}more\n`; }, message: 'again' });
  assert.equal(seenText, '# Changelog\n', 'the update gets the current text on the branch');
  assert.equal(g(dir, 'show', 'b:CHANGELOG.md'), '# Changelog\nmore');
  assert.equal(g(dir, 'rev-parse', 'b^'), r.sha);
  void r2;
});

test('an update that returns its input commits nothing (a retried ship)', async () => {
  const dir = repo();
  await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: () => 'x\n', message: 'one' });
  const tip = g(dir, 'rev-parse', 'b');
  const r = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: (t) => t, message: 'two' });
  assert.deepEqual(r, { ok: true, sha: tip, via: 'unchanged' });
  assert.equal(g(dir, 'rev-parse', 'b'), tip);
});

test('a branch checked out in a clean worktree gets a normal commit there; a dirty one is refused and nothing is written', async () => {
  const dir = repo();
  const wt = join(root, `wt${n}`);
  g(dir, 'worktree', 'add', '-q', wt, 'b');
  const r = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: add('entry\n'), message: 'Changelog: T' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.via, 'commit');
  assert.equal(readFileSync(join(wt, 'CHANGELOG.md'), 'utf8'), 'entry\n');
  assert.equal(g(wt, 'status', '--porcelain'), '');
  assert.equal(g(dir, 'log', '-1', '--format=%s', 'b'), 'Changelog: T');
  writeFileSync(join(wt, 'f.txt'), 'changed\n');
  const tip = g(dir, 'rev-parse', 'b');
  const d = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: add('more\n'), message: 'x' });
  assert.equal(d.ok, false);
  assert.equal(d.kind, 'dirty');
  assert.equal(g(dir, 'rev-parse', 'b'), tip);
  assert.equal(readFileSync(join(wt, 'CHANGELOG.md'), 'utf8'), 'entry\n');
});

test('a branch that moves before the compare-and-swap is not overwritten', async () => {
  const dir = repo();
  g(dir, 'commit', '-q', '--allow-empty', '-m', 'other');           // on dev: a commit the branch can be moved to
  const other = g(dir, 'rev-parse', 'HEAD');
  _testing.setRunner(async (args, opts) => {
    if (args[0] === 'update-ref' && args[args.length - 1] !== other) await _testing.defaultRun(['update-ref', 'refs/heads/b', other], { cwd: dir });
    return _testing.defaultRun(args, opts);
  });
  const r = await commitFileOnBranch(dir, { branch: 'b', path: 'CHANGELOG.md', update: () => 'x\n', message: 'm' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'moved');
  assert.equal(g(dir, 'rev-parse', 'b'), other);
});

test('an unsafe branch or path is a bad request', async () => {
  const dir = repo();
  for (const [branch, path] of [['-x', 'CHANGELOG.md'], ['b', '../x'], ['b', '/abs'], ['b', '']]) {
    const r = await commitFileOnBranch(dir, { branch, path, update: () => 'x', message: 'm' });
    assert.equal(r.kind, 'bad-request', `${branch} ${path}`);
  }
  assert.equal((await commitFileOnBranch(dir, { branch: 'nope', path: 'C.md', update: () => 'x', message: 'm' })).kind, 'bad-request');
});
