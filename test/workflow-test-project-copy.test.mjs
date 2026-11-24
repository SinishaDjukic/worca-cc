// test/workflow-test-project-copy.test.mjs — workflow tests 3a, Task 3 (D42, D53, D54, D60, D61): Worca's copy of a
// project. The person's repository is only read, the start commit is the same every time, removal never follows a
// junction, and a busy file is retried.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { projectKey } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { uncommittedPatch } from '../src/core/git-info.mjs';
import * as copy from '../src/core/workflow-tests/project-copy.mjs';
import { guardedGitEnv } from '../src/core/git-guard.mjs';

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
  getDb().prepare("INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('d00d0001', ?, 'running', 1)").run(key);   // round 5: its row
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

test('final review I2: the copy repair always unsets the settings that run a program, and sets COPY_SETTINGS again (no remote needed)', async () => {
  await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  git(dir, 'config', 'core.hooksPath', join(home, 'evil-hooks'));   // what a setup (husky) or an agent can leave in the shared config
  git(dir, 'config', 'core.fsmonitor', join(home, 'evil-fsmonitor'));
  git(dir, 'config', 'extensions.worktreeConfig', 'true');
  git(dir, 'config', 'gc.auto', '1');
  git(dir, 'config', 'core.longpaths', 'false');
  const b = await copy.ensureTestCopy(key, { projectDir: real });
  assert.deepEqual(b, { dir, created: false });
  for (const k of ['core.hooksPath', 'core.fsmonitor', 'extensions.worktreeConfig']) {
    assert.throws(() => git(dir, 'config', '--get', k), undefined, `${k} is unset`);
  }
  assert.equal(git(dir, 'config', 'gc.auto'), '0');
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
  assert.deepEqual(await copy.ensureTestCopy(key, { projectDir: real }), { dir, created: false }, 'a clean copy repairs as a no-op');
});

test('final review: removing a try checkout refuses a recorded folder outside the try\'s run folder', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const outside = mkdtempSync(join(tmpdir(), 'worca-cc-wftoutside-'));
  dirs.push(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  const r = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: outside, runRoot: join(wh, 'runs', 'abcd0001'), pipelineId: 'abcd0001' });
  assert.equal(r.removed, false);
  assert.match(r.error, /outside/);
  assert.equal(existsSync(join(outside, 'keep.txt')), true, 'never removed');
  const other = join(wh, 'runs', 'abcd0002', 'repos', key);   // another try's run folder
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'x.txt'), 'x');
  const r2 = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: other, pipelineId: 'abcd0001' });
  assert.equal(r2.removed, false);
  assert.equal(existsSync(join(other, 'x.txt')), true, 'not another try\'s');
  const wt = join(wh, 'runs', 'abcd0001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-abcd0001', '--', wt, p.startCommit);
  const ok = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt, branch: 'worca-cc/try-abcd0001', runRoot: join(wh, 'runs', 'abcd0001'), pipelineId: 'abcd0001' });
  assert.deepEqual(ok, { removed: true, error: null });
});

test('final review: a start that names a remote-tracking branch (origin/main, as a past run records it) is read from refs/remotes', async () => {
  const origin = mkdtempSync(join(tmpdir(), 'worca-cc-wftorigin-'));
  dirs.push(origin);
  const bare = join(origin, 'o.git');
  git(origin, 'init', '-q', '--bare', '-b', 'main', bare);
  git(real, 'remote', 'add', 'origin', bare);
  git(real, 'push', '-q', 'origin', 'main');
  git(real, 'fetch', '-q', 'origin');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real, ref: 'origin/main' });
  assert.equal(p.startRef, 'origin/main');
  assert.equal(p.startSha, git(real, 'rev-parse', 'refs/remotes/origin/main'));
  const team = join(origin, 'team');
  git(origin, 'clone', '-q', bare, team);
  writeFileSync(join(team, 'README.md'), '# team\n');
  commit(team, 'team');
  git(team, 'push', '-q', 'origin', 'HEAD:main');
  git(real, 'fetch', '-q', 'origin');   // the person fetched; Worca never does
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'origin/main' }), 1, 'drift is known');
  const latest = await copy.pinStart({ key, name: 'real', projectDir: real, ref: 'origin/main' });
  assert.equal(latest.startSha, git(real, 'rev-parse', 'refs/remotes/origin/main'), 'Start from the latest follows it');
  assert.equal(await copy.behindCount({ projectDir: real, startSha: p.startSha, startRef: 'main' }), 0, 'a local branch still reads refs/heads');
});

test('round 3: before each test the copy\'s config is rewritten from an allowlist; per-checkout config and hooks a try left are gone; the copy still works', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r3000001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r3000001', '--', wt, p.startCommit);   // a try (it ends below)
  // What a try's setup or agent can leave behind (worktrees share the copy's config).
  for (const [k, v] of [['filter.x.clean', 'evil-clean'], ['filter.x.required', 'true'], ['diff.x.textconv', 'evil-textconv'], ['merge.x.driver', 'evil-merge'],
    ['include.path', join(home, 'evil.gitconfig')], ['includeIf.gitdir:/.path', join(home, 'evil2.gitconfig')], ['alias.co', '!evil'],
    ['url.https://evil.example/.insteadOf', 'https://github.com/'], ['http.extraHeader', 'Authorization: token x'], ['credential.helper', 'evil'],
    ['core.sshCommand', 'evil-ssh'], ['core.hooksPath', join(home, 'hooks')], ['core.fsmonitor', 'evil-fsmonitor'], ['branch.foo.remote', 'origin'],
    ['user.name', 'Evil'], ['extensions.worktreeConfig', 'true']]) git(wt, 'config', k, v);
  git(wt, 'config', '--worktree', 'core.hooksPath', join(home, 'wt-hooks'));
  git(dir, 'remote', 'add', 'upstream', real);
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
  writeFileSync(join(dir, '.git', 'config.worktree'), '[core]\n\thooksPath = /evil\n');
  const wtConfig = git(wt, 'rev-parse', '--git-path', 'config.worktree');
  assert.ok(existsSync(resolve(wt, wtConfig)), 'the per-checkout config is real');
  const wtConfigAbs = resolve(wt, wtConfig);
  rmSync(wt, { recursive: true, force: true });   // round 4 (P39): the try ended; the reset runs when no checkout is live

  assert.deepEqual(await copy.ensureTestCopy(key, { projectDir: real }), { dir, created: false });
  const keys = git(dir, 'config', '--local', '--list', '--name-only').split(/\r?\n/).filter(Boolean).map((k) => k.toLowerCase());
  const allowed = new Set(['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.symlinks', 'core.ignorecase',
    'core.precomposeunicode', 'core.longpaths', 'gc.auto', 'maintenance.auto', 'extensions.objectformat', 'extensions.refstorage']);
  assert.deepEqual(keys.filter((k) => !allowed.has(k)), [], `only Worca's settings are left: ${keys.join(', ')}`);
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
  assert.equal(git(dir, 'config', 'gc.auto'), '0');
  assert.equal(git(dir, 'config', 'maintenance.auto'), 'false');
  assert.equal(git(dir, 'config', 'core.bare'), 'false');
  assert.equal(existsSync(wtConfigAbs), false, 'the ended checkout\'s config.worktree is gone');
  assert.equal(existsSync(join(dir, '.git', 'config.worktree')), false);
  assert.equal(existsSync(join(dir, '.git', 'hooks', 'pre-commit')), false, 'a hook a try installed is gone');
  assert.equal(git(dir, 'remote'), '');
  // The copy still works: pins and branches kept; a new checkout, a commit and a diff.
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${p.startCommit}`), p.startCommit);
  const wt2 = join(wh, 'runs', 'r3000002', 'repos', key);
  mkdirSync(dirname(wt2), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r3000002', '--', wt2, p.startCommit);
  writeFileSync(join(wt2, 'README.md'), '# changed\n');
  git(wt2, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'try');
  assert.match(git(wt2, 'diff', '--stat', p.startCommit, 'HEAD'), /README\.md/);
  assert.deepEqual(await copy.ensureTestCopy(key, { projectDir: real }), { dir, created: false }, 'a clean copy is rewritten again as a no-op');
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
});

test('round 4 (P39): a live sibling checkout keeps the shared settings; with none live the reset runs (config, hooks, .git/info, replace refs, alternates); pinning never resets', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const project = { key, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt };
  const wt = join(wh, 'runs', 'r4000001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r4000001', '--', wt, p.startCommit);   // a try still running
  getDb().prepare("INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('r4000001', ?, 'running', 1)").run(key);   // round 5: its try
  git(wt, 'config', 'core.hooksPath', '.husky/_');   // its setup (husky)
  git(wt, 'config', 'filter.nb.clean', 'nbstripout');   // and a filter it relies on
  writeFileSync(join(dir, '.git', 'info', 'attributes'), '* filter=lfs\n');
  await copy.ensureStartCommit({ key, projectDir: real, project });   // a second try of the same example starts
  copy.releaseCopy(key);   // U-T1: the runner releases a try's hold once it is cleaned up
  assert.equal(git(dir, 'config', 'core.hooksPath'), '.husky/_', 'the live try keeps its hooks path');
  assert.equal(git(dir, 'config', 'filter.nb.clean'), 'nbstripout', 'and its filter');
  assert.ok(existsSync(join(dir, '.git', 'info', 'attributes')), 'nothing is reset while a checkout is live');

  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'r4000001'").run();   // that try ended
  rmSync(wt, { recursive: true, force: true });   // and its checkout folder is gone; the registration is stale
  git(dir, 'config', 'alias.co', '!evil');
  await copy.pinStart({ key, name: 'real', projectDir: real });   // pinning needs no reset
  assert.equal(git(dir, 'config', 'alias.co'), '!evil', 'pinStart leaves the settings as they are');

  git(dir, 'update-ref', `refs/replace/${p.startCommit}`, p.startCommit);
  mkdirSync(join(dir, '.git', 'objects', 'info'), { recursive: true });
  writeFileSync(join(dir, '.git', 'objects', 'info', 'alternates'), `${join(home, 'elsewhere')}\n`);
  const initExclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  writeFileSync(join(dir, '.git', 'info', 'exclude'), `${initExclude}secret/\n`);
  await copy.ensureStartCommit({ key, projectDir: real, project });   // the next try, with no checkout live: prune, then reset
  for (const k of ['core.hooksPath', 'filter.nb.clean', 'alias.co']) assert.throws(() => git(dir, 'config', '--get', k), undefined, `${k} is gone`);
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
  assert.equal(existsSync(join(dir, '.git', 'info', 'attributes')), false, '.git/info as git init makes it');
  assert.doesNotMatch(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /secret\//);
  assert.equal(git(dir, 'for-each-ref', 'refs/replace/'), '', 'no replace refs');
  assert.equal(existsSync(join(dir, '.git', 'objects', 'info', 'alternates')), false, 'no alternates');
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${p.startCommit}`), p.startCommit, 'the pin is kept');
});

test('round 4: a linked .git/worktrees is never followed out of the copy', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const outside = mkdtempSync(join(tmpdir(), 'worca-cc-wftwtlink-'));
  dirs.push(outside);
  mkdirSync(join(outside, 'x'));
  writeFileSync(join(outside, 'x', 'config.worktree'), 'keep');
  writeFileSync(join(outside, 'x', 'gitdir'), join(home, 'gone', '.git'));   // what prune would take as stale
  rmSync(join(dir, '.git', 'worktrees'), { recursive: true, force: true });
  symlinkSync(outside, join(dir, '.git', 'worktrees'), process.platform === 'win32' ? 'junction' : 'dir');
  await copy.ensureStartCommit({ key, projectDir: real, project: { key, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt } });
  assert.equal(readFileSync(join(outside, 'x', 'config.worktree'), 'utf8'), 'keep', 'nothing outside the copy is touched');
  assert.ok(existsSync(join(outside, 'x', 'gitdir')), 'not even by prune');
});

test('round 4: Worca removes a checkout of its copy under the try env (no hook of the copy runs, as in an archive or the boot sweep)', async () => {
  const { removeWorktree } = await import('../src/core/worktree.mjs');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r4000003', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r4000003', '--', wt, p.startCommit);
  const marker = join(home, 'hook-ran.txt').replaceAll(String.fromCharCode(92), '/');
  writeFileSync(join(dir, '.git', 'hooks', 'reference-transaction'), `#!/bin/sh\necho "ran $GH_TOKEN" >> "${marker}"\n`);
  const prev = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'secret-token';
  try {
    const r = await removeWorktree({ projectDir: dir, worktreeDir: wt, branch: 'worca-cc/try-r4000003', force: true });
    assert.ok(r.ok, JSON.stringify(r.steps));
  } finally { if (prev === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prev; }
  assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '', 'the copy\'s reference-transaction hook never ran');
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/try-r4000003'), undefined, 'the branch went');
});

/** A project that borrows its objects (`git clone --shared`: objects/info/alternates), as shared object caches do. */
function sharedProject() {
  const base = templateRepo('wftbase', { branch: 'main', user: true, files: { 'README.md': '# base\n', 'src/a.mjs': 'export const a = 1;\n' } });
  const parent = mkdtempSync(join(tmpdir(), 'worca-cc-wftshared-'));
  dirs.push(base, parent);
  const person = join(parent, 'person');
  execFileSync('git', ['clone', '-q', '--shared', base, person]);
  assert.ok(existsSync(join(person, '.git', 'objects', 'info', 'alternates')), 'the project borrows its objects');
  // A commit of its own on top: the commit and its tree are local, src/a.mjs's blob is only in the borrowed store. A copy that
  // loses its alternates then still "has" the start commit, so a fetch would never bring the blob back.
  writeFileSync(join(person, 'README.md'), '# person\n');
  git(person, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'own');
  return { person, key: projectKey(person) };
}
const fsckOk = (dir) => { try { git(dir, 'fsck', '--connectivity-only', '--no-dangling'); return true; } catch { return false; } };

test('round 5: an alternates-backed project gets a copy with its own objects; a reset keeps it whole; the pin checks out', async () => {
  const { person, key: k } = sharedProject();
  const p = await copy.pinStart({ key: k, name: 'person', projectDir: person });
  const dir = join(wh, 'workflow-tests', 'repos', k);
  assert.equal(existsSync(join(dir, '.git', 'objects', 'info', 'alternates')), false, 'made with --dissociate');
  await copy.ensureStartCommit({ key: k, projectDir: person, project: { key: k, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt } });
  assert.ok(fsckOk(dir), 'fsck is clean after the reset');
  const wt = join(wh, 'runs', 'r5000001', 'repos', k);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000001', '--', wt, p.startCommit);
  assert.ok(existsSync(join(wt, 'src', 'a.mjs')), 'the pin checks out');
});

test('round 5: an existing copy that still borrows objects is repacked, then its alternates go; a damaged copy is made again', async () => {
  const { person, key: k } = sharedProject();
  const dir = join(wh, 'workflow-tests', 'repos', k);
  mkdirSync(dirname(dir), { recursive: true });
  // A copy made before round 5: `clone --local` copied the alternates file.
  execFileSync('git', ['clone', '-q', '--local', '--no-checkout', '--no-tags', person, dir]);
  git(dir, 'remote', 'remove', 'origin');
  assert.ok(existsSync(join(dir, '.git', 'objects', 'info', 'alternates')));
  const sha = git(person, 'rev-parse', 'HEAD');
  const at = new Date(Date.parse(git(person, 'show', '-s', '--format=%cI', sha))).toISOString();
  const project = { key: k, startSha: sha, startCommit: sha, startAt: at };
  await copy.ensureStartCommit({ key: k, projectDir: person, project });
  copy.releaseCopy(k);   // U-T1: that try was cleaned up
  assert.equal(existsSync(join(dir, '.git', 'objects', 'info', 'alternates')), false, 'repacked, then its alternates removed');
  assert.ok(fsckOk(dir), 'and nothing is missing');
  const wt = join(wh, 'runs', 'r5000002', 'repos', k);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000002', '--', wt, sha);
  assert.ok(existsSync(join(wt, 'README.md')));
  rmSync(wt, { recursive: true, force: true });

  // A copy damaged the round 4 way (alternates removed without a repack): its start commit is no longer whole.
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['clone', '-q', '--local', '--no-checkout', '--no-tags', person, dir]);
  git(dir, 'remote', 'remove', 'origin');
  rmSync(join(dir, '.git', 'objects', 'info', 'alternates'));
  assert.equal(fsckOk(dir), false, 'the copy is damaged');
  await copy.ensureStartCommit({ key: k, projectDir: person, project });
  assert.ok(fsckOk(dir), 'a damaged copy is made again, never used as it is');
  const wt2 = join(wh, 'runs', 'r5000003', 'repos', k);
  mkdirSync(dirname(wt2), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000003', '--', wt2, sha);
  assert.ok(existsSync(join(wt2, 'README.md')));
});

test('round 5: a locked try checkout and a checkout added outside the run folder never switch the reset off; the outside folder is kept', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const project = { key, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt };
  // A try locked its checkout; the teardown's remove refused it and the fallback removed the folder.
  const wt = join(wh, 'runs', 'r5000004', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000004', '--', wt, p.startCommit);
  git(dir, 'worktree', 'lock', wt);
  rmSync(wt, { recursive: true, force: true });
  // An agent added a checkout elsewhere.
  const outside = join(mkdtempSync(join(tmpdir(), 'worca-cc-wftoutwt-')), 'elsewhere');
  dirs.push(dirname(outside));
  git(dir, 'worktree', 'add', '-q', '--detach', outside, p.startCommit);
  git(dir, 'config', 'filter.x.clean', 'evil');
  await copy.ensureStartCommit({ key, projectDir: real, project });
  copy.releaseCopy(key);   // U-T1: that try was cleaned up (the sweep below sees no try)
  assert.throws(() => git(dir, 'config', '--get', 'filter.x.clean'), undefined, 'the reset ran');
  assert.equal(git(dir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length, 1, 'only the copy itself is registered');
  assert.ok(existsSync(join(outside, 'README.md')), 'a folder outside Worca\'s run folders is never removed');

  // The boot sweep does the same: a locked registration no longer holds a leftover try branch.
  const wt2 = join(wh, 'runs', 'r5000005', 'repos', key);
  mkdirSync(dirname(wt2), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000005', '--', wt2, p.startCommit);
  git(dir, 'worktree', 'lock', wt2);
  rmSync(wt2, { recursive: true, force: true });
  await copy.sweepTestCopies();
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/try-r5000005'), undefined, 'the leftover branch went');
});

test('round 5: removing a locked checkout of the copy unlocks it first, so no registration is left behind', async () => {
  const { removeWorktree } = await import('../src/core/worktree.mjs');
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r5000006', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000006', '--', wt, p.startCommit);
  git(dir, 'worktree', 'lock', wt);
  const r = await removeWorktree({ projectDir: dir, worktreeDir: wt, branch: null, force: true });
  assert.ok(r.ok, JSON.stringify(r.steps));
  assert.equal(git(dir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length, 1);
});

test('round 5: a try that has not settled keeps its registration even before its folder exists (its checkout is being made)', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r5000007', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r5000007', '--', wt, p.startCommit);
  getDb().prepare("INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('r5000007', ?, 'starting', 1)").run(key);
  git(dir, 'worktree', 'lock', '--reason', 'initializing', wt);   // what `git worktree add` holds while it makes the checkout
  rmSync(wt, { recursive: true, force: true });   // as if git had registered it but not yet written the folder
  git(dir, 'config', 'filter.y.clean', 'kept');
  await copy.ensureStartCommit({ key, projectDir: real, project: { key, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt } });
  assert.equal(git(dir, 'config', 'filter.y.clean'), 'kept', 'no reset while that try runs');
  assert.ok(existsSync(join(dir, '.git', 'worktrees')) && readdirSync(join(dir, '.git', 'worktrees')).length > 0, 'its registration is kept');
});

// ── Round 6 (P40): a copy is busy while any test try of its project has not settled; then nothing is touched. ──
const runRow = (id, k, status = 'running') => getDb().prepare('INSERT INTO pipelines (id, project_key, status, is_test) VALUES (?, ?, ?, 1)').run(id, k, status);
const startOf = (p) => ({ key, startSha: p.startSha, startCommit: p.startCommit, startAt: p.startAt });
const registered = (dir) => git(dir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length;

test('round 6: with Worca\'s home behind a link, a running try\'s checkout survives another try\'s start', async () => {
  const realHome = mkdtempSync(join(tmpdir(), 'worca-cc-wftrealhome-'));
  const linkParent = mkdtempSync(join(tmpdir(), 'worca-cc-wftlinkhome-'));
  dirs.push(realHome, linkParent);
  const link = join(linkParent, 'home');
  symlinkSync(realHome, link, process.platform === 'win32' ? 'junction' : 'dir');
  _resetForTests(); process.env.WORCA_HOME = link; wh = worcaHome();
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r6000001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r6000001', '--', wt, p.startCommit);   // git records the real path
  runRow('r6000001', key);
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });
  assert.ok(existsSync(join(wt, 'README.md')), 'the running try\'s checkout is kept');
  assert.equal(registered(dir), 2, 'and so is its registration');
  assert.equal(git(wt, 'status', '--porcelain'), '', 'it is still a working checkout');
});

test('round 6: an agent\'s own worktree inside a running try survives; locked and outside registrations are cleaned once nothing is unsettled', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'r6000002', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r6000002', '--', wt, p.startCommit);
  runRow('r6000002', key);
  const nested = join(wt, '.claude', 'worktrees', 'x');
  git(wt, 'worktree', 'add', '-q', '--detach', nested, p.startCommit);   // the agent's own
  const outside = join(mkdtempSync(join(tmpdir(), 'worca-cc-wftout6-')), 'elsewhere');
  dirs.push(dirname(outside));
  git(dir, 'worktree', 'add', '-q', '--detach', outside, p.startCommit);
  git(dir, 'worktree', 'lock', outside);
  git(dir, 'config', 'filter.z.clean', 'kept');
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });   // another try starts: the copy is busy
  copy.releaseCopy(key);   // U-T1: the second try was cleaned up; the first still runs (its row)
  assert.ok(existsSync(join(nested, 'README.md')), 'the nested worktree is kept');
  assert.equal(registered(dir), 4, 'no registration is touched while a try runs');
  assert.equal(git(dir, 'config', 'filter.z.clean'), 'kept', 'and no reset');
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'r6000002'").run();   // the try ended
  rmSync(wt, { recursive: true, force: true });
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });
  assert.equal(registered(dir), 1, 'locked, outside and ended registrations are gone');
  assert.ok(existsSync(join(outside, 'README.md')), 'the folder outside Worca\'s run folders is kept');
  assert.throws(() => git(dir, 'config', '--get', 'filter.z.clean'), undefined, 'the reset ran');
});

test('round 6: the whole-commit check is quiet and only "missing" objects mean damage', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  assert.equal(await copy._testing.commitWhole(dir, p.startCommit), 'whole');
  assert.equal(await copy._testing.commitWhole(join(home, 'no-such-copy'), p.startCommit), 'unknown', 'a git failure is not damage');
  const src = readFileSync(new URL('../src/core/workflow-tests/project-copy.mjs', import.meta.url), 'utf8');
  assert.match(src, /'rev-list', '--objects', '--no-walk', '--missing=error', '--quiet'/, 'never prints every object');
});

test('round 6: an alternates file a crash left aside is put back; a repack that failed is not retried within a day', async () => {
  const { person, key: k } = sharedProject();
  const dir = join(wh, 'workflow-tests', 'repos', k);
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync('git', ['clone', '-q', '--local', '--no-checkout', '--no-tags', person, dir]);   // an old-style copy (borrows)
  git(dir, 'remote', 'remove', 'origin');
  const alt = join(dir, '.git', 'objects', 'info', 'alternates');
  const sha = git(person, 'rev-parse', 'HEAD');
  const at = new Date(Date.parse(git(person, 'show', '-s', '--format=%cI', sha))).toISOString();
  const project = { key: k, startSha: sha, startCommit: sha, startAt: at };
  // A crash between setting the file aside and the check:
  writeFileSync(`${alt}.worca-off`, readFileSync(alt));
  rmSync(alt);
  writeFileSync(join(dir, '.git', 'worca-repack-failed'), new Date().toISOString());   // and a repack failed today
  await copy.ensureStartCommit({ key: k, projectDir: person, project });
  copy.releaseCopy(k);   // U-T1: that try was cleaned up
  assert.ok(existsSync(alt), 'the alternates file is back');
  assert.equal(existsSync(`${alt}.worca-off`), false);
  assert.ok(fsckOk(dir), 'the copy is whole');
  writeFileSync(join(dir, '.git', 'worca-repack-failed'), new Date(Date.now() - 2 * 86_400_000).toISOString());   // two days ago
  await copy.ensureStartCommit({ key: k, projectDir: person, project });
  assert.equal(existsSync(alt), false, 'retried after a day: repacked, then its alternates removed');
  assert.ok(fsckOk(dir));
});

test('round 6: a damaged copy made again keeps the pinned start commits that were still whole', async () => {
  const { person, key: k } = sharedProject();
  const y = git(person, 'rev-parse', 'HEAD');   // its tree borrows src/a.mjs from the shared store
  git(person, 'checkout', '-q', '--orphan', 'xbranch');
  git(person, 'rm', '-q', '-rf', '.');
  writeFileSync(join(person, 'only-x.txt'), 'x only' + String.fromCharCode(10));
  git(person, 'add', '-A'); commit(person, 'x');
  const x = git(person, 'rev-parse', 'HEAD');   // every object of X is the project's own
  const dir = join(wh, 'workflow-tests', 'repos', k);
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync('git', ['clone', '-q', '--local', '--no-checkout', '--no-tags', person, dir]);   // an old-style copy
  git(dir, 'remote', 'remove', 'origin');
  git(dir, 'fetch', '-q', '--no-tags', '--no-write-fetch-head', person, x);
  for (const s2 of [x, y]) git(dir, 'update-ref', `refs/worca-tests/${s2}`, s2);
  rmSync(join(dir, '.git', 'objects', 'info', 'alternates'));   // damaged the round 4 way: Y is no longer whole, X is
  git(person, 'checkout', '-q', 'main');
  git(person, 'branch', '-q', '-D', 'xbranch');
  git(person, 'reflog', 'expire', '--expire=now', '--all');
  git(person, 'gc', '-q', '--prune=now');
  assert.throws(() => git(person, 'cat-file', '-e', `${x}^{commit}`), undefined, 'the project no longer has X');
  const at = (sha, from) => new Date(Date.parse(git(from, 'show', '-s', '--format=%cI', sha))).toISOString();
  await copy.ensureStartCommit({ key: k, projectDir: person, project: { key: k, startSha: y, startCommit: y, startAt: at(y, person) } });
  copy.releaseCopy(k);   // U-T1: that try was cleaned up
  assert.ok(fsckOk(dir), 'made again, whole');
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${x}`), x, 'X was carried over from the damaged copy');
  const r = await copy.ensureStartCommit({ key: k, projectDir: person, project: { key: k, startSha: x, startCommit: x, startAt: '2026-10-28T09:00:00.000Z' } });
  assert.equal(r.startCommit, x, 'so example 1 still starts (no START_GONE)');
  assert.equal(await copy._testing.commitWhole(dir, x), 'whole');
});

// ── Round 7: an 8.3 short-name home (Windows); stale try rows; the damage pattern; a failed remake keeps the old copy. ──
/** The 8.3 short form of `dir`, or null when the volume makes none (or not on Windows). */
function shortName(dir) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"for %I in ("${dir}") do @echo %~sI"`],
      { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
    return out && out.toLowerCase() !== dir.toLowerCase() ? out : null;
  } catch { return null; }
}

test('round 7: with an 8.3 short-name home, the copy is never made again under a running try', async (t) => {
  const longHome = mkdtempSync(join(tmpdir(), 'worca-cc-longnamehome-'));
  dirs.push(longHome);
  const short = shortName(longHome);
  if (!short) { t.skip('no 8.3 short names on this volume (or not Windows)'); return; }
  _resetForTests(); process.env.WORCA_HOME = short; wh = worcaHome();
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  writeFileSync(join(dir, '.git', 'worca-was-here'), 'x');   // gone if the copy were made again
  const wt = join(wh, 'runs', 'r7000001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-r7000001', '--', wt, p.startCommit);
  runRow('r7000001', key);
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });
  copy.releaseCopy(key);   // U-T1: that try was cleaned up
  assert.ok(existsSync(join(dir, '.git', 'worca-was-here')), 'the copy was kept, not made again');
  assert.equal(git(wt, 'status', '--porcelain'), '', 'the running try\'s checkout still works');
  const { testCopyKeyOf } = await import('../src/core/store.mjs');
  assert.equal(testCopyKeyOf(git(dir, 'rev-parse', '--show-toplevel')), key, 'git\'s long path of the copy is still the copy');
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'r7000001'").run();
  rmSync(wt, { recursive: true, force: true });
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });
  assert.ok(existsSync(join(dir, '.git', 'worca-was-here')), 'nor once nothing runs');
});

test('round 7: a copy Worca cannot read is never removed while a try of the project runs', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  runRow('r7000002', key);
  rmSync(join(dir, '.git', 'HEAD'));   // no longer a repository git can read
  await assert.rejects(copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) }), { code: 'NOT_READY' });
  assert.ok(existsSync(join(dir, '.git', 'config')), 'kept: a running try may still use it');
});

test('round 7: an interrupted try is settled; the damage pattern ignores a "--missing" usage error', async () => {
  getDb().prepare("INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('r7000003', ?, 'interrupted', 1)").run(key);
  assert.equal(copy._testing.copyBusy(key), false);
  assert.equal(copy._testing.isDamage('error: unrecognized argument: --missing=error'), false);
  assert.equal(copy._testing.isDamage('fatal: missing blob object 7898'), true);
  assert.equal(copy._testing.isDamage('fatal: bad tree object 4b2e'), true);
});

test('round 7: a remake whose new clone fails puts the old copy back, with its pins', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  await assert.rejects(copy._testing.remakeCopy(key, dir, join(home, 'no-such-project')), { code: 'NOT_READY' });
  assert.equal(git(dir, 'rev-parse', `refs/worca-tests/${p.startCommit}`), p.startCommit, 'the old copy and its pins are back');
  assert.deepEqual(readdirSync(join(wh, 'workflow-tests', 'repos')).filter((n) => n.startsWith('.clone-')), [], 'nothing left aside');
});

// ── U-T1 (F1): on Windows, parallel tries raced on the copy's shared .git/config. Worca writes it only when a value differs,
// retries a write that meets a lock, deletes a try branch without touching it, and holds the copy busy from a try's start. ──
const cfgId = (dir) => { const s = statSync(join(dir, '.git', 'config')); return [s.ino, s.mtimeMs]; };
const isConfigWrite = (args) => (args[0] === 'config' && !args.includes('--list') && !args.includes('--get')) || (args[0] === 'remote' && args[1] === 'remove');

test('U-T1 (F1): a second try\'s start writes nothing to a copy already set up; a copy with core.longpaths false gets one write', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });   // the first try: none live, so the reset runs; then it holds the copy
  try {
    const was = cfgId(dir);
    await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });   // a second try starts while the first runs
    copy.releaseCopy(key);
    assert.deepEqual(cfgId(dir), was, '.git/config is the same file, not written again');
  } finally { copy.releaseCopy(key); }

  runRow('ut1a0001', key);   // a try is live: no reset, only the repair
  git(dir, 'config', 'core.longpaths', 'false');
  const writes = [];
  const restore = copy._testing.seamGit((_d, args) => { if (isConfigWrite(args)) writes.push(args.join(' ')); return null; });
  try { await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) }); }
  finally { restore(); copy.releaseCopy(key); }
  assert.deepEqual(writes, ['config core.longpaths true'], 'only the value that differs is written');
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true');
});

test('U-T1 (F1): removing a try deletes its branch and leaves .git/config alone; so does the boot sweep', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const runRoot = join(wh, 'runs', 'ut1b0001');
  const wt = join(runRoot, 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-ut1b0001', '--', wt, p.startCommit);
  const was = cfgId(dir);
  const r = await copy.removeTryCheckout({ copyDir: dir, worktreeDir: wt, branch: 'worca-cc/try-ut1b0001', runRoot, pipelineId: 'ut1b0001' });
  assert.deepEqual(r, { removed: true, error: null });
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/try-ut1b0001'), undefined, 'the branch went');
  assert.deepEqual(cfgId(dir), was, '.git/config is the same file');

  const wt2 = join(wh, 'runs', 'ut1b0002', 'repos', key);
  mkdirSync(dirname(wt2), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/left-ut1b0002', '--', wt2, p.startCommit);
  rmSync(join(wh, 'runs'), { recursive: true, force: true });
  const was2 = cfgId(dir);
  assert.deepEqual(await copy.sweepTestCopies(), { copies: 1, branches: 1 });
  assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/worca-cc/left-ut1b0002'));
  assert.deepEqual(cfgId(dir), was2, 'the sweep leaves .git/config alone too');
});

test('U-T1 (F1): a config write that meets a Windows lock is tried again, and the try still gets its copy; any other error is not', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  runRow('ut1c0001', key);   // a try is live: the repair writes, no reset
  git(dir, 'config', 'core.longpaths', 'false');
  let failed = 0;
  const warned = [];
  const restore = copy._testing.seamGit((_d, args) => {
    if (args[0] === 'config' && args[1] === 'core.longpaths' && !failed) {
      failed += 1;
      return { ok: false, code: 255, stdout: '', stderr: 'error: could not write config file .git/config: Permission denied' };
    }
    return null;
  });
  const warn = console.warn;
  console.warn = (...a) => { warned.push(a.join(' ')); };
  let r;
  try { r = await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) }); }
  finally { restore(); console.warn = warn; copy.releaseCopy(key); }
  assert.equal(r.startCommit, p.startCommit, 'no NOT_READY');
  assert.equal(failed, 1);
  assert.equal(git(dir, 'config', 'core.longpaths'), 'true', 'written on the second attempt');
  assert.ok(warned.includes(`workflow tests: .git/config was busy in ${dir}; written on attempt 2`), warned.join('\n'));

  git(dir, 'config', 'core.longpaths', 'false');
  let calls = 0;
  const restore2 = copy._testing.seamGit((_d, args) => {
    if (args[0] === 'config' && args[1] === 'core.longpaths') { calls += 1; return { ok: false, code: 1, stdout: '', stderr: 'error: invalid key: core.longpaths' }; }
    return null;
  });
  try { await assert.rejects(copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) }), { code: 'NOT_READY' }); }
  finally { restore2(); }
  assert.equal(calls, 1, 'an error that is not a lock is not tried again');
  assert.equal(copy._testing.copyBusy(key), true, 'the live row still counts');
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'ut1c0001'").run();
  assert.equal(copy._testing.copyBusy(key), false, 'a start that failed holds nothing');
});

test('U-T1 (F1): a try that has its copy but no pipelines row yet keeps the copy busy; released, it is not', async () => {
  const p = await copy.pinStart({ key, name: 'real', projectDir: real });
  const dir = join(wh, 'workflow-tests', 'repos', key);
  const wt = join(wh, 'runs', 'ut1d0001', 'repos', key);
  mkdirSync(dirname(wt), { recursive: true });
  git(dir, 'worktree', 'add', '-q', '-b', 'worca-cc/try-ut1d0001', '--', wt, p.startCommit);   // its checkout, no row yet
  git(dir, 'config', 'filter.d.clean', 'kept');
  copy.holdCopy(key);
  try {
    assert.equal(copy._testing.copyBusy(key), true);
    assert.deepEqual(await copy.ensureTestCopy(key, { projectDir: real }), { dir, created: false });
    assert.equal(registered(dir), 2, 'no registration is cleared (clearCheckouts did not run)');
    assert.equal(git(dir, 'config', 'filter.d.clean'), 'kept', 'and no reset');
  } finally { copy.releaseCopy(key); }
  assert.equal(copy._testing.copyBusy(key), false);
  copy.releaseCopy(key);   // one release too many never counts below zero
  copy.holdCopy(key);
  assert.equal(copy._testing.copyBusy(key), true);
  copy.releaseCopy(key);
  await copy.ensureTestCopy(key, { projectDir: real });
  assert.equal(registered(dir), 1, 'released: the reset runs again');
  assert.throws(() => git(dir, 'config', '--get', 'filter.d.clean'));
});

// 3 rounds by default (about a minute under load); WORCA_STRESS=1 runs the full 20.
const STRESS_ROUNDS = process.env.WORCA_STRESS === '1' ? 20 : 3;
test('U-T1 (F1): Windows stress: three tries start at once while the others read the config, several rounds, no failure',
  { skip: process.platform !== 'win32' ? 'Windows only: there an open reader makes a config replace fail' : false, timeout: process.env.WORCA_STRESS === '1' ? 1_800_000 : 600_000 }, async () => {
    const p = await copy.pinStart({ key, name: 'real', projectDir: real });
    const dir = join(wh, 'workflow-tests', 'repos', key);
    const wts = [1, 2, 3].map((i) => join(wh, 'runs', `ut1e000${i}`, 'repos', key));
    for (const wt of wts) { mkdirSync(dirname(wt), { recursive: true }); git(dir, 'worktree', 'add', '-q', '--detach', '--', wt, p.startCommit); }
    copy.holdCopy(key);   // a try is live throughout
    try {
      for (let round = 0; round < STRESS_ROUNDS; round += 1) {
        await Promise.all(wts.map(async (wt) => {
          const r = await copy.ensureStartCommit({ key, projectDir: real, project: startOf(p) });
          try { await guardedGitEnv(wt); } finally { copy.releaseCopy(key); }
          assert.equal(r.startCommit, p.startCommit);
        }));
      }
    } finally { copy.releaseCopy(key); }
  });
