// test/workflow-test-project-copy.test.mjs — workflow tests 3a, Task 3 (D42, D53, D54, D60, D61): Worca's copy of a
// project. The person's repository is only read, the start commit is the same every time, removal never follows a
// junction, and a busy file is retried.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${p.startCommit}`), p.startCommit, 'the start commit is pinned');
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${head}`), head, 'and so is the commit it sits on (D53: both)');
  const again = await copy.pinStart({ key, name: 'real', projectDir: real, includeChanges: true });
  assert.equal(again.startCommit, p.startCommit, 'deterministic (D53)');
  assert.equal(repoSnapshot(real), was, 'scratch objects: the project gets no new object');
});

test('uncommitted changes: scratch objects leave the project\'s object store unchanged (without them, blobs land there)', async () => {
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
  mkdirSync(join(real, 'art', 'psd'), { recursive: true });
  writeFileSync(join(real, 'art', 'psd', '.gitattributes'), '# not lfs: *.txt filter=lfs\n*.psd filter=lfs diff=lfs merge=lfs -text\n');
  git(real, 'add', 'art'); commit(real, 'nested lfs');
  await assert.rejects(copy.pinStart({ key, name: 'design-assets', projectDir: real }), { code: 'NOT_READY', message: /Git LFS/ }, 'a nested .gitattributes counts');
  writeFileSync(join(real, 'art', 'psd', '.gitattributes'), '# *.psd filter=lfs diff=lfs merge=lfs -text\n  #*.ai filter=lfs\n');
  commit(real, 'lfs commented out');
  assert.equal(await copy.projectUnsupported({ projectDir: real, sha: git(real, 'rev-parse', 'HEAD') }), null, 'a commented line is not LFS');
  await assert.rejects(copy.projectUnsupported({ projectDir: real, sha: 'f'.repeat(40) }), { code: 'NOT_READY' }, 'a git error is not "supported"');
  git(real, 'rm', '-q', '-r', 'art'); commit(real, 'no art');
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

// Review fix 1 (items 1, 2, 7, 9).
const fold = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));

test('an enclosing repository is never written: a copy whose .git is an empty folder is made again; removal and the sweep skip a broken copy', async () => {
  // The test's worcaHome sits inside a scratch repository, so git run in a broken copy would walk up into it.
  git(home, 'init', '-q', '-b', 'main');
  writeFileSync(join(home, '.gitignore'), '.worca-cc/\n');
  git(home, 'add', '.gitignore'); git(home, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'outer');
  const outer = repoSnapshot(home);
  const dir = join(wh, 'workflow-tests', 'repos', key);
  mkdirSync(join(dir, '.git'), { recursive: true });
  assert.equal(fold(git(dir, 'rev-parse', '--absolute-git-dir')), fold(join(home, '.git')), 'the trap: plain git walks up');
  assert.throws(() => execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dir, stdio: 'pipe',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: join(wh, 'workflow-tests', 'repos') } }), 'the ceiling stops the walk on this platform');
  const head = git(real, 'rev-parse', 'HEAD');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  assert.equal(fold(git(dir, 'rev-parse', '--absolute-git-dir')), fold(join(dir, '.git')), 'made again as a repository of its own');
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${head}`), head);
  const wt = join(wh, 'runs', 'cafe0001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-cafe0001', '--', wt, p.startCommit);
  assert.deepEqual(await copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt, branch: 'worca-cc/try-cafe0001',
    runRoot: join(wh, 'runs', 'cafe0001'), pipelineId: 'cafe0001' }), { removed: true, error: null });
  assert.deepEqual(await copy.sweepTestCopies(), { copies: 1, branches: 0 });
  rmSync(join(dir, '.git'), { recursive: true, force: true }); mkdirSync(join(dir, '.git'));   // broken again
  const r = await copy.removeTryCheckout({ copyDir: dir, branch: 'worca-cc/try-cafe0002' });
  assert.equal(r.removed, false);
  assert.match(r.error, /not a usable copy/);
  const logged = [];
  assert.deepEqual(await copy.sweepTestCopies({ log: (...a) => logged.push(a) }), { copies: 0, branches: 0 });
  assert.ok(logged.some(([level, msg]) => level === 'warn' && msg.includes(key)), 'the skipped copy is reported');
  assert.equal(repoSnapshot(home), outer, 'the enclosing repository got nothing');
});

test('a copy that got a remote is repaired in place (pins, branches and live worktrees kept); a failed clone leaves nothing behind', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'd00d0001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-d00d0001', '--', wt, p.startCommit);   // a live try
  git(wt, 'remote', 'add', 'origin', real);   // an agent in its checkout: worktrees share the copy's config
  git(dir, 'remote', 'add', 'upstream', real);
  git(dir, 'config', 'gc.auto', '1');
  const b = await copy.ensureTestCopy(key, { projectDir: real });
  assert.deepEqual(b, { dir, created: false }, 'repaired, not made again');
  assert.equal(git(dir, 'remote'), '');
  assert.equal(git(dir, 'config', 'gc.auto'), '0', 'the settings are set again');
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${p.startCommit}`), p.startCommit, 'the pin is kept');
  assert.equal(git(dir, 'rev-parse', 'refs/heads/worca-cc/try-d00d0001'), p.startCommit, 'the try branch is kept');
  assert.ok(existsSync(join(wt, 'README.md')), 'the live checkout is kept');
  const bad = mkdtempSync(join(tmpdir(), 'worca-cc-wftnotrepo-'));
  dirs.push(bad);
  await assert.rejects(copy.ensureTestCopy('not-a-repo-0badc0de', { projectDir: bad }), { code: 'NOT_READY' });
  assert.deepEqual(readdirSync(join(wh, 'workflow-tests', 'repos')), [key], 'no temporary clone folder is left');
});

test('a start point the copy does not have yet is fetched; a start SHA is pinned exactly; ensureStartCommit without changes', async () => {
  await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  writeFileSync(join(real, 'README.md'), '# one\n'); commit(real, 'one');
  const mid = git(real, 'rev-parse', 'HEAD');
  writeFileSync(join(real, 'README.md'), '# two\n'); commit(real, 'two');
  const tip = git(real, 'rev-parse', 'HEAD');
  const was = repoSnapshot(real);
  assert.throws(() => execFileSync('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: dir, stdio: 'pipe' }), 'not in the copy yet');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  assert.deepEqual([p.startSha, p.startCommit, p.startRef], [tip, tip, 'main']);
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${tip}`), tip);
  const bySha = await copy.pinStart({ key, name: 'real', projectDir: real, sha: mid });
  assert.deepEqual([bySha.startSha, bySha.startCommit, bySha.startRef, bySha.changes], [mid, mid, null, null]);
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${mid}`), mid);
  await assert.rejects(copy.pinStart({ key, name: 'real', projectDir: real, sha: 'a'.repeat(40) }), { code: 'NOT_READY', message: /no longer in the project/ });
  rmSync(join(wh, 'workflow-tests'), { recursive: true, force: true });
  assert.deepEqual(await copy.ensureStartCommit({ key, projectDir: real, project: bySha }), { copyDir: dir, startCommit: mid });
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${mid}`), mid);
  assert.equal(repoSnapshot(real), was);
});

test('removal waits for the job that holds the copy, and a branch that cannot be deleted is reported', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'beef0001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/held-beef0001', '--', wt, p.startCommit);   // a branch git refuses to delete
  const wt2 = join(wh, 'runs', 'beef0002', 'repos', key);
  mkdirSync(dirname(wt2), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-beef0002', '--', wt2, p.startCommit);
  let release;
  const held = copy.withKeyLock(key, () => new Promise((r) => { release = r; }));
  let done = false;
  const removing = copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt2, branch: 'worca-cc/held-beef0001' }).then((r) => { done = true; return r; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(done, false, 'it waits for the lock');
  assert.equal(existsSync(wt2), false, 'the checkout folder goes before the lock: only the copy writes wait');
  release(); await held;
  const r = await removing;
  assert.equal(r.removed, false);
  assert.match(r.error, /worca-cc\/held-beef0001/);
  assert.equal(git(dir, 'rev-parse', '--verify', '-q', 'refs/heads/worca-cc/held-beef0001'), p.startCommit);
});

test('the boot sweep removes a clone folder left half made by a crash', async () => {
  await copy.pinStart({ key, name: 'real', projectDir: real });
  const left = join(wh, 'workflow-tests', 'repos', `.clone-${key}-AbC123`);
  mkdirSync(join(left, '.git', 'objects'), { recursive: true });
  writeFileSync(join(left, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const logged = [];
  assert.deepEqual(await copy.sweepTestCopies({ log: (...a) => logged.push(a) }), { copies: 1, branches: 0 });
  assert.equal(existsSync(left), false);
  assert.ok(existsSync(join(wh, 'workflow-tests', 'repos', key, '.git')), 'the copy itself stays');
});
