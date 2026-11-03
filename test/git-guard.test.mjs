// test/git-guard.test.mjs — security G2: worca's own git calls in a project or run checkout never run a hook or
// a config command an agent planted in the shared .git (hooks, core.fsmonitor, filter / diff drivers). A
// fixture repo gets every one of them, each touching a marker file; worca's commit, status, diff, push and
// fast-forward paths then run and no marker may appear. The end-of-run commit keeps the project's hooks on a
// local install (documented), never under agent isolation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { commitStagedWork, createWorktree, createDetachedWorktree } from '../src/core/worktree.mjs';
import { openBranchWorktree } from '../src/core/terminal/worktrees.mjs';
import { pushBranch, diffPatch, diffNumstat } from '../src/core/git-info.mjs';
import { fetchRemote, fastForward } from '../src/core/git-sync.mjs';
import { guardEntries, parseConfigList, safeLocalSshCommand, guardedGitEnv, guardedGitEnvSync, guardedWorktreeAdd, _testing as guardTesting } from '../src/core/git-guard.mjs';
import { existsSync } from 'node:fs';

useTempHome(after);
const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
const POSIX = { skip: process.platform === 'win32' ? 'planted hooks and commands are POSIX shell' : false };
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const tmp = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); created.push(d); return d; };

const HOOKS = ['pre-commit', 'commit-msg', 'post-commit', 'pre-push', 'reference-transaction', 'post-checkout', 'post-merge'];
/** Plant every hook and config command in `repo`'s .git; returns the marker dir they write into. */
function plant(repo) {
  const marks = tmp('worca-cc-g2-marks-');
  const common = join(repo, git(repo, 'rev-parse', '--git-common-dir'));
  mkdirSync(join(common, 'hooks'), { recursive: true });
  for (const h of HOOKS) {
    const f = join(common, 'hooks', h);
    writeFileSync(f, `#!/bin/sh\ntouch '${marks}/hook-${h}'\nexit 0\n`);
    chmodSync(f, 0o755);
  }
  const touch = (name) => `sh -c 'touch "${marks}/${name}"; cat'`;
  git(repo, 'config', 'core.fsmonitor', `sh -c 'touch "${marks}/fsmonitor"'`);
  git(repo, 'config', 'filter.evil.clean', touch('filter-clean'));
  git(repo, 'config', 'filter.evil.smudge', touch('filter-smudge'));
  git(repo, 'config', 'diff.evil.textconv', `sh -c 'touch "${marks}/textconv"; cat "$0"'`);
  git(repo, 'config', 'diff.evil.command', `sh -c 'touch "${marks}/diff-command"'`);
  git(repo, 'config', 'diff.external', `sh -c 'touch "${marks}/diff-external"'`);
  mkdirSync(join(common, 'info'), { recursive: true });
  writeFileSync(join(common, 'info', 'attributes'), '* filter=evil diff=evil\n');
  return marks;
}
const fired = (marks) => readdirSync(marks).sort();
const CONFIG_MARKS = ['diff-command', 'diff-external', 'filter-clean', 'filter-smudge', 'fsmonitor', 'textconv'];
const configFired = (marks) => fired(marks).filter((m) => CONFIG_MARKS.includes(m));

function withEnv(vars, fn) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
}
const ISOLATED = { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/home/worca-agent' };

function repoWithOrigin() {
  const origin = tmp('worca-cc-g2-origin-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const repo = templateRepo('g2', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' } });
  created.push(repo);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  return { repo, origin };
}

test('the end-of-run commit (run-harness _commitWork) runs no planted config command; hooks only without agent isolation', POSIX, async () => {
  for (const isolated of [false, true]) {
    const { repo } = repoWithOrigin();
    writeFileSync(join(repo, 'seed.txt'), 'seed\nchanged\n');
    writeFileSync(join(repo, 'work.txt'), 'agent work\n');
    const marks = plant(repo);
    await withEnv(isolated ? ISOLATED : {}, async () => {
      const orch = createOrchestrator({ projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' } });
      const res = await orch._commitWork({ worktreeDir: repo, branch: 'main' });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.committed, true);
    });
    assert.deepEqual(configFired(marks), [], `isolated=${isolated}`);
    if (isolated) assert.deepEqual(fired(marks), [], 'no hook runs under agent isolation');
    else assert.ok(fired(marks).includes('hook-pre-commit'), 'a local install keeps the project commit hooks');
  }
});

test('Apply to branch (commitStagedWork) runs no planted config command; hooks only without agent isolation', POSIX, async () => {
  for (const isolated of [false, true]) {
    const { repo } = repoWithOrigin();
    writeFileSync(join(repo, 'work.txt'), 'agent work\n');
    const marks = plant(repo);
    const r = await withEnv(isolated ? ISOLATED : {}, () => commitStagedWork(repo, { message: 'worca: t' }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(configFired(marks), [], `isolated=${isolated}`);
    if (isolated) assert.deepEqual(fired(marks), []);
  }
});

test('push (git-info pushBranch) runs no planted hook or config command', POSIX, async () => {
  const { repo, origin } = repoWithOrigin();
  git(repo, 'checkout', '-q', '-b', 'worca/feat');
  writeFileSync(join(repo, 'work.txt'), 'x\n');
  git(repo, 'add', 'work.txt');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'work');
  writeFileSync(join(repo, 'dirty.txt'), 'untracked\n');
  const marks = plant(repo);
  const r = await pushBranch(repo, 'worca/feat');
  assert.equal(r.ok, true, r.stderr);
  assert.equal(git(origin, 'rev-parse', 'worca/feat'), git(repo, 'rev-parse', 'HEAD'));
  assert.deepEqual(fired(marks), []);
});

test('diffs (git-info diffPatch / diffNumstat) run no textconv or diff driver', POSIX, async () => {
  const { repo } = repoWithOrigin();
  writeFileSync(join(repo, 'seed.txt'), 'seed\nchanged\n');
  const marks = plant(repo);
  assert.match(await diffPatch(repo, 'HEAD'), /\+changed/);
  await diffNumstat(repo, 'HEAD');
  assert.deepEqual(fired(marks), []);
});

test('fetch + fast-forward (git-sync) run no planted smudge filter or hook', POSIX, async () => {
  const { repo, origin } = repoWithOrigin();
  const other = tmp('worca-cc-g2-other-');
  git(other, 'clone', '-q', origin, '.');
  writeFileSync(join(other, 'new.txt'), 'upstream\n');
  git(other, 'add', 'new.txt');
  git(other, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'up');
  git(other, 'push', '-q', 'origin', 'main');
  const marks = plant(repo);
  assert.equal((await fetchRemote(repo)).ok, true);
  const ff = await fastForward(repo, { base: 'main' });
  assert.equal(ff.ok, true, JSON.stringify(ff));
  assert.deepEqual(fired(marks), []);
});

/** A filter driver the project listing never sees: a conditional include that matches only inside a linked
 *  worktree (`gitdir:` on .git/worktrees, or `onbranch:`), applied by `.git/info/attributes` (no tracked file,
 *  no commit). Returns the marker dir. */
function plantConditional(repo, kind) {
  const marks = tmp('worca-cc-g2-marks-');
  const common = join(repo, git(repo, 'rev-parse', '--git-common-dir'));
  const inc = join(marks, '..', `${marks.split('/').pop()}.cfg`);
  writeFileSync(inc, `[filter "pwn"]\n\tsmudge = "touch '${marks}/smudge' && cat"\n\tclean = cat\n`);
  created.push(inc);
  git(repo, 'config', '--add', kind === 'gitdir' ? 'includeIf.gitdir:**/.git/worktrees/**.path' : 'includeIf.onbranch:feature.path', inc);
  mkdirSync(join(common, 'info'), { recursive: true });
  writeFileSync(join(common, 'info', 'attributes'), '* filter=pwn\n');
  return marks;
}

test('every worktree add runs no filter from a conditional include the project listing cannot see', POSIX, async () => {
  for (const kind of ['gitdir', 'onbranch']) {
    const adds = {
      helper: (repo, dir) => guardedWorktreeAdd(repo, dir, 'feature').then((r) => { assert.equal(r.ok, true, r.stderr); return dir; }),
      'createWorktree (new branch)': (repo, dir) => createWorktree({ projectDir: repo, pipelineId: 'p1', featureBranch: 'feature-2', sourceBranch: 'feature', baseDir: dir }).then((r) => r.worktreeDir),
      'createWorktree (existing branch)': (repo, dir) => createWorktree({ projectDir: repo, pipelineId: 'p1', featureBranch: 'feature', sourceBranch: 'main', baseDir: dir }).then((r) => r.worktreeDir),
      createDetachedWorktree: (repo, dir) => createDetachedWorktree({ projectDir: repo, worktreeDir: dir, ref: 'feature' }).then(() => dir),
      'terminal openBranchWorktree': (repo) => openBranchWorktree({ projectKey: 'g2', projectDir: repo, branch: 'feature' }).then((r) => r.dir),
    };
    for (const [name, add] of Object.entries(adds)) {
      const { repo } = repoWithOrigin();
      git(repo, 'branch', 'feature');
      const marks = plantConditional(repo, kind);
      const dir = join(tmp('worca-cc-g2-wt-'), 'wt');
      const wt = await add(repo, dir);
      assert.ok(existsSync(join(wt, 'seed.txt')), `${kind} / ${name}: the files are checked out`);
      assert.deepEqual(fired(marks), [], `${kind} / ${name}: the planted smudge ran`);
    }
  }
});

// ── the override set, pure ────────────────────────────────────────────────────────────
const map = (entries) => entries.reduce((m, [k, v]) => (m.set(k, [...(m.get(k) || []), v]), m), new Map());
const L = (key, value) => ({ scope: 'local', key, value });
const G = (key, value) => ({ scope: 'global', key, value });

test('guardEntries: hooks off and every static command key pinned, whatever the repository says', () => {
  const { entries, refused } = guardEntries([], { env: {}, isolated: false });
  assert.equal(refused, null);
  const m = map(entries);
  assert.ok(m.get('core.hooksPath'));
  assert.deepEqual(m.get('core.fsmonitor'), ['false']);
  assert.deepEqual(m.get('core.sshCommand'), ['ssh']);
  assert.equal(m.has('diff.external'), false, 'no value turns it off: pinned only when the repository sets it');
  assert.deepEqual(map(guardEntries([L('diff.external', 'evil')], { env: {}, isolated: false }).entries).get('diff.external'), ['']);
  assert.deepEqual(m.get('credential.helper'), ['']);
  assert.deepEqual(m.get('protocol.ext.allow'), ['never']);
  assert.equal(map(guardEntries([], { env: {}, hooks: true, isolated: false }).entries).has('core.hooksPath'), false);
  assert.ok(map(guardEntries([], { env: {}, hooks: true, isolated: true }).entries).has('core.hooksPath'));
});

test('guardEntries: trusted scopes keep their values; local ones are replaced', () => {
  const list = [
    G('core.fsmonitor', 'true'), L('core.fsmonitor', '/tmp/evil'),
    G('credential.helper', 'osxkeychain'), { scope: 'command', key: 'credential.https://github.com.helper', value: '!worca' },
    L('credential.helper', '!evil'),
    G('filter.lfs.smudge', 'git-lfs smudge -- %f'), L('filter.lfs.smudge', 'evil'),
    L('filter.Evil.clean', 'evil'), L('merge.x.driver', 'evil'), L('http.https://x.example.proxy', 'http://evil'),
    L('http.https://x.example.sslVerify', 'false'), G('gpg.program', '/opt/gpg2'), L('gpg.openpgp.program', 'evil'),
  ];
  const m = map(guardEntries(list, { env: {}, isolated: false }).entries);
  assert.deepEqual(m.get('core.fsmonitor'), ['true']);
  assert.deepEqual(m.get('credential.helper'), ['', 'osxkeychain']);
  assert.deepEqual(m.get('credential.https://github.com.helper'), ['!worca']);
  assert.deepEqual(m.get('filter.lfs.smudge'), ['git-lfs smudge -- %f']);
  assert.deepEqual(m.get('filter.Evil.clean'), ['']);
  assert.deepEqual(m.get('merge.x.driver'), ['git merge-file --marker-size=%L %A %O %B']);
  assert.deepEqual(m.get('http.https://x.example.proxy'), ['']);
  assert.deepEqual(m.get('http.https://x.example.sslverify'), ['true']);
  assert.deepEqual(m.get('gpg.program'), ['/opt/gpg2']);
  assert.deepEqual(m.get('gpg.openpgp.program'), ['/opt/gpg2']);
});

test('guardEntries: safe local shapes are kept, pinned; first-wins keys refuse the call', () => {
  const m = map(guardEntries([L('core.sshCommand', 'ssh -i ~/.ssh/deploy -o IdentitiesOnly=yes'), L('filter.lfs.process', 'git-lfs filter-process')],
    { env: {}, isolated: false }).entries);
  assert.deepEqual(m.get('core.sshCommand'), ['ssh -i ~/.ssh/deploy -o IdentitiesOnly=yes']);
  assert.deepEqual(m.get('filter.lfs.process'), ['git-lfs filter-process']);
  assert.deepEqual(map(guardEntries([L('core.sshCommand', 'ssh -o ProxyCommand=evil')], { env: {}, isolated: false }).entries).get('core.sshCommand'), ['ssh']);
  for (const v of ['ssh -i k; evil', 'sh -c evil', 'ssh -F cfg', 'ssh $(evil)']) assert.equal(safeLocalSshCommand(v), false, v);
  assert.equal(guardEntries([L('remote.origin.uploadpack', 'evil')], { env: {} }).refused, 'remote.origin.uploadpack');
  assert.equal(guardEntries([L('core.gitProxy', 'evil')], { env: {} }).refused, 'core.gitproxy');
  // core.worktree moves the work tree, so a checkout or reset writes files wherever the repository says, as worca.
  assert.deepEqual(guardEntries([L('core.worktree', '/tmp/elsewhere')], { env: {} }).worktrees, [{ scope: 'local', value: '/tmp/elsewhere' }]);
  assert.deepEqual(guardEntries([{ scope: 'worktree', key: 'core.worktree', value: '/x' }], { env: {} }).worktrees, [{ scope: 'worktree', value: '/x' }]);
  assert.deepEqual(guardEntries([G('core.worktree', '/x')], { env: {} }).worktrees, [], 'a person\'s own global config is theirs');
  // extensions.worktreeConfig decides whether a linked worktree reads the shared core.worktree; git's boolean spelling.
  for (const v of [null, 'true', 'YES', 'on', '1', '2']) assert.equal(guardEntries([L('extensions.worktreeConfig', v)], { env: {} }).worktreeConfig, true, String(v));
  for (const v of ['false', 'No', 'off', '0', '']) assert.equal(guardEntries([L('extensions.worktreeConfig', v)], { env: {} }).worktreeConfig, false, v);
  assert.equal(guardEntries([], { env: {} }).worktreeConfig, false);
  // Git reads the flag from the shared config file's own lines only, so a later `false` (an include, a worktree's
  // config.worktree) does not turn it off there: any row that turns it on counts.
  assert.equal(guardEntries([L('extensions.worktreeConfig', 'true'), L('extensions.worktreeConfig', 'false')], { env: {} }).worktreeConfig, true);
  assert.equal(guardEntries([L('extensions.worktreeConfig', 'true'), { scope: 'worktree', key: 'extensions.worktreeConfig', value: 'false' }],
    { env: {} }).worktreeConfig, true);
});

test('core.worktree naming the checkout itself (a submodule) is no refusal; anywhere else is', POSIX, async () => {
  const { repo } = repoWithOrigin();
  const sub = tmp('worca-cc-g2-sub-');
  git(sub, 'init', '-q');
  git(sub, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', repo, 'vendor/lib');
  const lib = join(sub, 'vendor', 'lib');
  assert.match(git(lib, 'config', '--local', 'core.worktree'), /vendor\/lib/, 'git set core.worktree for the submodule');
  assert.ok(Number(guardedGitEnvSync(lib).GIT_CONFIG_COUNT) > 0, 'a submodule checkout is guarded, not refused');
  assert.ok(Number((await guardedGitEnv(lib)).GIT_CONFIG_COUNT) > 0);
  git(repo, 'config', 'core.worktree', '.');   // relative to the git dir: the .git folder itself
  assert.throws(() => guardedGitEnvSync(repo), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' });
  git(repo, 'config', 'core.worktree', '..');  // the checkout itself
  assert.ok(Number(guardedGitEnvSync(repo).GIT_CONFIG_COUNT) > 0);
});

test('core.worktree from a conditional include or a worktree\'s config.worktree never moves a checkout', POSIX, async () => {
  for (const kind of ['gitdir', 'onbranch']) {
    const { repo } = repoWithOrigin();
    git(repo, 'branch', 'feature');
    const victim = tmp('worca-cc-g2-victim-');
    const inc = join(victim, '..', `${victim.split('/').pop()}.cfg`);
    writeFileSync(inc, `[core]\n\tworktree = ${victim}\n`);
    created.push(inc);
    git(repo, 'config', '--add', kind === 'gitdir' ? 'includeIf.gitdir:**/.git/worktrees/**.path' : 'includeIf.onbranch:feature.path', inc);
    // Git finds the work tree before it follows includes, so an included value is listed but never used.
    const dir = join(tmp('worca-cc-g2-wt-'), 'wt');
    const r = await guardedWorktreeAdd(repo, dir, 'feature');
    assert.equal(r.ok, true, `${kind}: ${r.stderr}`);
    assert.ok(existsSync(join(dir, 'seed.txt')), `${kind}: the files are checked out where worca asked`);
    assert.deepEqual(readdirSync(victim), [], `${kind}: nothing written where the include points`);
    // A linked worktree's own config.worktree IS read: it is refused before any git call runs there.
    git(repo, 'config', 'extensions.worktreeConfig', 'true');
    writeFileSync(join(git(dir, 'rev-parse', '--absolute-git-dir'), 'config.worktree'), `[core]\n\tworktree = ${victim}\n`);
    await assert.rejects(guardedGitEnv(dir), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' });
    assert.throws(() => guardedGitEnvSync(dir), /sets core\.worktree, which would make git write files outside the checkout/);
  }
});

test('a shared core.worktree moves a linked worktree once extensions.worktreeConfig is on: refused there too', POSIX, async () => {
  const { repo } = repoWithOrigin();
  git(repo, 'branch', 'feature');
  const dir = join(tmp('worca-cc-g2-wt-'), 'wt');
  assert.equal((await guardedWorktreeAdd(repo, dir, 'feature')).ok, true);
  const own = git(dir, 'rev-parse', '--absolute-git-dir');
  const victim = tmp('worca-cc-g2-victim-');
  git(repo, 'config', 'core.worktree', victim);
  // worktreeConfig off: a linked worktree reads only its own config.worktree, so the shared value cannot move it.
  assert.equal(git(dir, 'rev-parse', '--show-toplevel'), dir);
  assert.ok(Number(guardedGitEnvSync(dir).GIT_CONFIG_COUNT) > 0, 'worktreeConfig off: the linked checkout is guarded, not refused');
  // An agent turns it on in the shared config: git now applies the shared value in every linked worktree.
  git(repo, 'config', 'core.repositoryformatversion', '1');
  git(repo, 'config', 'extensions.worktreeConfig', 'true');
  assert.equal(git(dir, 'rev-parse', '--show-toplevel'), victim, 'this git moves the linked worktree to the shared value');
  await assert.rejects(guardedGitEnv(dir), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' });
  assert.throws(() => guardedGitEnvSync(dir), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' });
  // Git reads the flag only from the shared file's own lines. A later `false` in the worktree's config.worktree or in
  // an include is listed after the `true`, yet git keeps the flag on and still moves the worktree: still refused.
  const off = join(victim, '..', `${victim.split('/').pop()}.off.cfg`);
  writeFileSync(off, '[extensions]\n\tworktreeConfig = false\n');
  created.push(off);
  for (const leg of ['config.worktree', 'include']) {
    if (leg === 'config.worktree') writeFileSync(join(own, 'config.worktree'), '[extensions]\n\tworktreeConfig = false\n');
    else { rmSync(join(own, 'config.worktree')); git(repo, 'config', '--add', 'include.path', off); }
    assert.equal(git(dir, 'rev-parse', '--show-toplevel'), victim, `${leg}: git still moves the linked worktree`);
    await assert.rejects(guardedGitEnv(dir), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' }, leg);
    assert.throws(() => guardedGitEnvSync(dir), { code: 'GIT_CONFIG_REFUSED', key: 'core.worktree' }, leg);
  }
});

test('parseConfigList reads -z output, keys without a value included', () => {
  assert.deepEqual(parseConfigList('global\0user.name\nA B\0local\0diff.Foo.textconv\0'),
    [{ scope: 'global', key: 'user.name', value: 'A B' }, { scope: 'local', key: 'diff.Foo.textconv', value: null }]);
});

test('guardedGitEnv refuses a repository whose config sets a first-wins command key', POSIX, async () => {
  const { repo } = repoWithOrigin();
  git(repo, 'config', 'remote.origin.receivepack', 'evil');
  await assert.rejects(guardedGitEnv(repo), { code: 'GIT_CONFIG_REFUSED' });
  assert.throws(() => guardedGitEnvSync(repo), { code: 'GIT_CONFIG_REFUSED' });
  const missing = guardedGitEnvSync(join(repo, 'no-such-dir'));
  assert.ok(Number(missing.GIT_CONFIG_COUNT) > 0);
});

test('parseConfigList with origin: scope, origin, then key and value', () => {
  assert.deepEqual(parseConfigList('local\0file:.git/config\0core.bare\nfalse\0command line:\0\0x.y\0', { origin: true }),
    [{ scope: 'local', origin: 'file:.git/config', key: 'core.bare', value: 'false' },
      { scope: 'command line:', origin: '', key: 'x.y', value: null }]);
});

// The listing memo (perf): one listing per repository while nothing it reads changed. It sits on the trust
// boundary, so every way an agent can change what git would read must list again.
const settle = () => new Promise((r) => setTimeout(r, 5));
async function memoRepo(t) {
  guardTesting.clearMemo();
  const prev = guardTesting.setRacyMs(0);   // fixtures are seconds old at most; the racy rule has its own test
  t.after(() => { guardTesting.setRacyMs(prev); guardTesting.clearMemo(); });
  const { repo } = repoWithOrigin();
  await settle();
  return repo;
}
const listingsFor = async (fn) => { const n = guardTesting.listings(); await fn(); return guardTesting.listings() - n; };
const pinsFilter = (env) => Object.entries(env).some(([k, v]) => k.startsWith('GIT_CONFIG_KEY_') && v === 'filter.evil.clean');

test('memo: a second call in an unchanged repository lists nothing; async and sync share it', POSIX, async (t) => {
  const repo = await memoRepo(t);
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 1);
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 0);
  assert.equal(await listingsFor(() => guardedGitEnvSync(repo)), 0);
  // Another env that names config files is another key.
  assert.equal(await listingsFor(() => guardedGitEnv(repo, { env: { ...process.env, GIT_CONFIG_GLOBAL: join(repo, 'g') } })), 1);
});

test('memo: a local config write lists again and the new driver is pinned', POSIX, async (t) => {
  const repo = await memoRepo(t);
  assert.equal(pinsFilter(await guardedGitEnv(repo)), false);
  git(repo, 'config', 'filter.evil.clean', 'touch /tmp/x');
  assert.equal(await listingsFor(async () => assert.equal(pinsFilter(await guardedGitEnv(repo)), true)), 1);
});

test('memo: a config rewritten with its old mtime put back still lists again (ctime)', POSIX, async (t) => {
  const repo = await memoRepo(t);
  await guardedGitEnv(repo);
  const cfg = join(repo, '.git', 'config');
  const before = statSync(cfg);
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}[filter "evil"]\n\tclean = touch /tmp/x\n`);
  utimesSync(cfg, before.atime, before.mtime);
  assert.equal(await listingsFor(async () => assert.equal(pinsFilter(await guardedGitEnv(repo)), true)), 1);
});

test('memo: creating or changing an include target lists again, even one that did not exist', POSIX, async (t) => {
  const repo = await memoRepo(t);
  git(repo, 'config', 'include.path', '../extra.inc');
  git(repo, 'config', 'includeIf.onbranch:main.path', join(repo, 'branch.inc'));
  await settle();
  await guardedGitEnv(repo);
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 0);
  writeFileSync(join(repo, 'extra.inc'), '[filter "evil"]\n\tclean = touch /tmp/x\n');
  await settle();
  assert.equal(await listingsFor(async () => assert.equal(pinsFilter(await guardedGitEnv(repo)), true)), 1);
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 0);
  writeFileSync(join(repo, 'branch.inc'), '[diff "evil"]\n\ttextconv = touch /tmp/y\n');
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 1);
});

test('memo: a HEAD change (includeIf.onbranch) lists again', POSIX, async (t) => {
  const repo = await memoRepo(t);
  await guardedGitEnv(repo);
  git(repo, 'checkout', '-q', '-b', 'other');
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 1);
});

test('memo: a linked worktree\'s own config.worktree appearing lists again there', POSIX, async (t) => {
  const repo = await memoRepo(t);
  const dir = join(tmp('worca-cc-g2-memo-wt-'), 'wt');
  git(repo, 'worktree', 'add', '-q', '--detach', dir);
  await settle();
  await guardedGitEnv(dir);
  assert.equal(await listingsFor(() => guardedGitEnv(dir)), 0);
  git(repo, 'config', 'extensions.worktreeConfig', 'true');
  git(dir, 'config', '--worktree', 'filter.evil.clean', 'touch /tmp/x');
  assert.equal(await listingsFor(async () => assert.equal(pinsFilter(await guardedGitEnv(dir)), true)), 1);
});

test('memo: a config changed just before the listing is never reused (racy window)', POSIX, async (t) => {
  guardTesting.clearMemo();
  t.after(() => guardTesting.clearMemo());
  const { repo } = repoWithOrigin();
  git(repo, 'config', 'x.y', '1');
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 1);
  assert.equal(await listingsFor(() => guardedGitEnv(repo)), 1);
});
