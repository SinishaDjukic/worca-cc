// test/git-guard.test.mjs — security G2: worca's own git calls in a project or run checkout never run a hook or
// a config command an agent planted in the shared .git (hooks, core.fsmonitor, filter / diff drivers). A
// fixture repo gets every one of them, each touching a marker file; worca's commit, status, diff, push and
// fast-forward paths then run and no marker may appear. The end-of-run commit keeps the project's hooks on a
// local install (documented), never under agent isolation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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
import { guardEntries, parseConfigList, safeLocalSshCommand, guardedGitEnv, guardedGitEnvSync, guardedWorktreeAdd } from '../src/core/git-guard.mjs';
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
