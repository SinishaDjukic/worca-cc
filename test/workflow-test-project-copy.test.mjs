// test/workflow-test-project-copy.test.mjs — workflow tests 3a, Task 3 (D42, D53, D54, D60, D61): Worca's copy of a
// project. The person's repository is only read, the start commit is the same every time, removal never follows a
// junction, and a busy file is retried.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { uncommittedPatch } from '../src/core/git-info.mjs';
import * as copy from '../src/core/workflow-tests/project-copy.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (cwd, msg) => git(cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', msg);
const dirs = [];
let home, wh, real, key;   // wh: worcaHome(), which is <WORCA_HOME>/.worca-cc
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'worca-cc-wftcopy-'));
  _resetForTests(); process.env.WORCA_HOME = home; wh = worcaHome();
  real = templateRepo('wftcopy', { branch: 'main', user: true, files: { 'README.md': '# hi\n', 'src/a.mjs': 'export const a = 1;\n' } });
  dirs.push(home, real);
  key = projectKey(real);
});
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('the copy has no remote, long paths on, and making it only reads the project', async () => {
  const was = repoSnapshot(real);
  const a = await copy.ensureTestCopy(key, { projectDir: real });
  assert.equal(a.created, true);
  assert.equal(a.dir, join(wh, 'workflow-tests', 'repos', key));
  assert.equal(git(a.dir, 'remote'), '');
  assert.equal(git(a.dir, 'config', 'core.longpaths'), 'true');
  assert.equal((await copy.ensureTestCopy(key, { projectDir: real })).created, false, 'made once');
  assert.equal(repoSnapshot(real), was);
});

test('a start point: HEAD of the branch the folder is on, pinned in the copy', async () => {
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  assert.deepEqual([p.startSha, p.startRef, p.startCommit, p.changes], [head, 'main', head, null]);
  assert.ok(Number.isFinite(Date.parse(p.startAt)));
  const dir = join(wh, 'workflow-tests', 'repos', key);
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${head}`), head);
  assert.equal(repoSnapshot(real), was);
});

test('uncommitted changes: one start commit on top, the same every time, and nothing written to the project', async () => {
  writeFileSync(join(real, 'src', 'a.mjs'), 'export const a = 2;\n');
  writeFileSync(join(real, 'notes.md'), 'new file\n');
  const was = repoSnapshot(real);
  const head = git(real, 'rev-parse', 'HEAD');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  assert.ok(p.changes && p.changes.length);
  assert.notEqual(p.startCommit, head);
  const dir = join(wh, 'workflow-tests', 'repos', key);
  assert.equal(git(dir, 'rev-parse', `${p.startCommit}^`), head, 'its parent is the start commit');
  assert.equal(git(dir, 'show', `${p.startCommit}:src/a.mjs`), 'export const a = 2;');
  assert.equal(git(dir, 'show', `${p.startCommit}:notes.md`), 'new file');
  const again = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  assert.equal(again.startCommit, p.startCommit, 'deterministic (D53)');
  assert.equal(repoSnapshot(real), was, 'scratch objects: the project gets no new object');
});

test('the brief was wrong: without scratch objects, reading the changes writes objects into the project', async () => {
  writeFileSync(join(real, 'brand-new.md'), 'x\n');
  const out = join(home, 'p.patch');
  const before = repoSnapshot(real);
  await uncommittedPatch(real, { base: 'HEAD', outFile: out });
  assert.notEqual(repoSnapshot(real), before, 'blobs were hashed into .git/objects');
  const before2 = repoSnapshot(real);
  await uncommittedPatch(real, { base: 'HEAD', outFile: out, scratchObjects: true });
  assert.equal(repoSnapshot(real), before2);
  assert.match(readFileSync(out, 'utf8'), /brand-new\.md/);
});

test('a copy that is gone is made again, with the same start commit', async () => {
  writeFileSync(join(real, 'src', 'a.mjs'), 'export const a = 3;\n');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  rmSync(join(wh, 'workflow-tests'), { recursive: true, force: true });
  const r = await copy.ensureStartCommit({ key, projectDir: real, project: p, changes: p.changes });
  assert.equal(r.startCommit, p.startCommit);
  assert.equal(r.copyDir, join(wh, 'workflow-tests', 'repos', key));
});

test('LFS and submodules are refused with the board 39 sentences; changes only on the checked-out branch', async () => {
  writeFileSync(join(real, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');
  git(real, 'add', '.gitattributes'); commit(real, 'lfs');
  await assert.rejects(copy.pinStart({ key, name: 'design-assets', projectDir: real }),
    { code: 'NOT_READY', message: "design-assets keeps large files with Git LFS. Worca's own copy of the project would not have them, so tries could go wrong." });
  git(real, 'rm', '-q', '.gitattributes'); commit(real, 'no lfs');
  writeFileSync(join(real, '.gitmodules'), '[submodule "x"]\n\tpath = x\n\turl = ../x\n');
  git(real, 'add', '.gitmodules'); commit(real, 'sub');
  await assert.rejects(copy.pinStart({ key, name: 'mobile-app', projectDir: real }),
    { code: 'NOT_READY', message: "mobile-app holds other projects inside it (submodules). Worca's own copy of the project would not have them, so tries could go wrong." });
  git(real, 'rm', '-q', '.gitmodules'); commit(real, 'no sub');
  git(real, 'branch', 'side');
  await assert.rejects(copy.pinStart({ key, name: 'real', projectDir: real, ref: 'side', includeChanges: true }), /only for the branch your project folder is on/);
});

test('behind, tree size and the branch list', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  writeFileSync(join(real, 'README.md'), '# one\n'); commit(real, 'one');
  writeFileSync(join(real, 'README.md'), '# two\n'); commit(real, 'two');
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'main' }), 2);
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'gone' }), null);
  assert.equal(await copy.treeBytes({ projectDir: real, sha: p.startSha }), '# hi\n'.length + 'export const a = 1;\n'.length);
  git(real, 'branch', 'older', p.startSha);
  const branches = await copy.listBranches(real);
  assert.deepEqual(branches.map((b) => [b.name, b.current]), [['main', true], ['older', false]]);
  assert.ok(Number.isFinite(await copy.freeDiskBytes(home)));
});

test('removing a try checkout: the folder, its branch and its run root go; a junction is never followed', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const runRoot = join(wh, 'runs', 'abcd1234');
  const wt = join(runRoot, 'repos', key);
  mkdirSync(join(runRoot, 'repos'), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-abcd1234', '--', wt, p.startCommit);
  const outside = mkdtempSync(join(tmpdir(), 'worca-cc-wftstore-'));   // a pnpm store, say
  dirs.push(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  mkdirSync(join(wt, 'node_modules'));
  symlinkSync(outside, join(wt, 'node_modules', '.pnpm-store'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok((await copy.dirBytes(wt)) < 10_000, 'the size walk does not follow the junction either');
  const r = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt, branch: 'worca-cc/try-abcd1234', runRoot, pipelineId: 'abcd1234' });
  assert.deepEqual(r, { removed: true, error: null });
  assert.equal(existsSync(wt), false);
  assert.equal(existsSync(runRoot), false);
  assert.equal(existsSync(join(outside, 'keep.txt')), true, 'never through the junction');
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/try-abcd1234'));
  assert.equal(git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
});

test('a busy file is retried; one that stays busy is reported, not thrown', async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  assert.equal(await copy.removeTree(join(home, 'x'), { rmImpl: flaky, waitMs: 1 }), null);
  assert.equal(calls, 3);
  const stuck = async () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };
  assert.match(await copy.removeTree(join(home, 'x'), { rmImpl: stuck, waitMs: 1, attempts: 2 }), /EBUSY/);
});

test('Windows long paths: a checkout with paths over 260 characters is removed', async () => {
  const top = join(home, 'deep');
  const deep = join(top, ...Array.from({ length: 12 }, (_, i) => `node_modules_level_${i}_xxxxxxxxxxxxxxxx`));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'index.js'), 'x');
  assert.ok(join(deep, 'index.js').length > 260, 'longer than MAX_PATH');
  assert.ok((await copy.dirBytes(top)) >= 1);
  assert.equal(await copy.removeTree(top), null);
  assert.equal(existsSync(top), false);
});

test('the boot sweep prunes leftover worktrees and deletes leftover try branches', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'feed0001', 'repos', key);
  mkdirSync(join(wh, 'runs', 'feed0001', 'repos'), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/left-feed0001', '--', wt, p.startCommit);
  rmSync(join(wh, 'runs'), { recursive: true, force: true });   // a restart's run-root sweep took the folder
  assert.deepEqual(await copy.sweepTestCopies(), { copies: 1, branches: 1 });
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/left-feed0001'));
});
