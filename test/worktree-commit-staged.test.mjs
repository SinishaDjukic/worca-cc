// test/worktree-commit-staged.test.mjs — Apply to branch's commit: the teardown commit (run-harness
// _commitWork) again — the memory mount excluded and unstaged, the repo identity then a local one, and
// the hook bypass ONLY when asked (detached runs, as at teardown).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorktree, commitStagedWork } from '../src/core/worktree.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const POSIX = { skip: process.platform === 'win32' ? 'hook scripts are POSIX shell' : false };
let n = 0;
async function worktree() {
  const repo = templateRepo('cswork', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(repo);
  const wt = await createWorktree({ projectDir: repo, pipelineId: `cs${++n}`, sourceBranch: 'main', featureBranch: `worca-cc/cs${n}` });
  return { repo, wt };
}
const MOUNT = '.claude/rules/worca';

test('commits the staged work and anything new, without the memory mount', async () => {
  const { wt } = await worktree();
  await writeFile(join(wt.worktreeDir, 'work.txt'), 'agent work\n');
  git(wt.worktreeDir, ['add', '-A']);
  await writeFile(join(wt.worktreeDir, 'later.txt'), 'edited after the failure\n');
  await mkdir(join(wt.worktreeDir, MOUNT), { recursive: true });
  await writeFile(join(wt.worktreeDir, MOUNT, 'rule.md'), 'memory\n');
  git(wt.worktreeDir, ['add', '-f', MOUNT]);
  const r = await commitStagedWork(wt.worktreeDir, { message: 'worca: t\n\nPipeline x', exclude: [MOUNT] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.committed, true);
  assert.equal(r.hooksBypassed, false);
  assert.equal(r.sha, git(wt.worktreeDir, ['rev-parse', `refs/heads/${wt.branch}`]).stdout.trim());
  const files = git(wt.worktreeDir, ['show', '--name-only', '--format=', 'HEAD']).stdout.trim().split('\n').sort();
  assert.deepEqual(files, ['later.txt', 'work.txt']);
  assert.equal(git(wt.worktreeDir, ['log', '-1', '--format=%s']).stdout.trim(), 'worca: t');
});

test('nothing to commit is success with committed:false', async () => {
  const { wt } = await worktree();
  assert.deepEqual(await commitStagedWork(wt.worktreeDir, { message: 'm', exclude: [MOUNT] }),
    { ok: true, committed: false, sha: null, hooksBypassed: false });
});

test('a failing hook fails the commit with its message, and only bypassHooks retries without hooks', POSIX, async () => {
  const { repo, wt } = await worktree();
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\necho "lint failed: 3 errors" >&2\nexit 1\n');
  await chmod(hook, 0o755);
  await writeFile(join(wt.worktreeDir, 'work.txt'), 'x\n');
  const failed = await commitStagedWork(wt.worktreeDir, { message: 'm' });
  assert.equal(failed.ok, false);
  assert.equal(failed.step, 'commit');
  assert.match(failed.message, /lint failed: 3 errors/);
  assert.match(git(wt.worktreeDir, ['diff', '--cached', '--name-only']).stdout, /work\.txt/, 'the work stays staged');
  const bypassed = await commitStagedWork(wt.worktreeDir, { message: 'm', bypassHooks: true });
  assert.equal(bypassed.ok, true, JSON.stringify(bypassed));
  assert.equal(bypassed.hooksBypassed, true);
});

test('a worktree that is not on the asked branch is refused before anything is committed', async () => {
  const { wt } = await worktree();
  await writeFile(join(wt.worktreeDir, 'work.txt'), 'x\n');
  git(wt.worktreeDir, ['add', '-A']);
  git(wt.worktreeDir, ['checkout', '-q', '--detach']);
  const detached = await commitStagedWork(wt.worktreeDir, { message: 'm', branch: wt.branch });
  assert.equal(detached.ok, false);
  assert.equal(detached.step, 'branch');
  assert.match(detached.message, /detached HEAD/);
  git(wt.worktreeDir, ['switch', '-q', '-c', 'side']);
  const side = await commitStagedWork(wt.worktreeDir, { message: 'm', branch: wt.branch });
  assert.equal(side.step, 'branch');
  assert.match(side.message, /on side, not /);
  assert.match(git(wt.worktreeDir, ['diff', '--cached', '--name-only']).stdout, /work\.txt/, 'nothing committed: the work stays staged');
  const back = git(wt.worktreeDir, ['switch', '-q', wt.branch]);
  assert.equal(back.status, 0, back.stderr);
  const r = await commitStagedWork(wt.worktreeDir, { message: 'm', branch: wt.branch });
  assert.equal(r.committed, true, JSON.stringify(r));
});

test('a worktree that is gone fails at status', async () => {
  const r = await commitStagedWork(join(created[0] || '/nonexistent', 'no-such-dir'), { message: 'm' });
  assert.equal(r.ok, false);
  assert.equal(r.step, 'status');
});

test('unresolved conflicts are refused before anything is staged or committed', async () => {
  const { wt } = await worktree();
  const g = (args) => git(wt.worktreeDir, args);
  g(['switch', '-q', '-c', 'other']);
  await writeFile(join(wt.worktreeDir, 'README.md'), 'other\n');
  g(['-c', 'commit.gpgsign=false', 'commit', '-qam', 'other']);
  g(['switch', '-q', wt.branch]);
  await writeFile(join(wt.worktreeDir, 'README.md'), 'mine\n');
  g(['-c', 'commit.gpgsign=false', 'commit', '-qam', 'mine']);
  g(['merge', '--no-edit', 'other']);                         // stops with a conflict in README.md
  const unresolved = () => g(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
  assert.equal(unresolved(), 'README.md');
  const r = await commitStagedWork(wt.worktreeDir, { message: 'm', branch: wt.branch });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.step, 'add');
  assert.match(r.message, /unresolved conflicts \(README\.md\)/);
  assert.equal(unresolved(), 'README.md', 'the conflict is still unresolved');
  assert.equal(g(['log', '-1', '--format=%s']).stdout.trim(), 'mine', 'nothing committed');
});
