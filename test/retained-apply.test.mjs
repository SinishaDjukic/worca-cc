// test/retained-apply.test.mjs — Apply to branch (core): commit the work a failed end-of-run commit left
// in the retained worktree, then do what teardown does after a good commit — record it, finish the merge
// back of a run on its source branch (fast-forward only), release the worktree. A commit that fails again
// keeps everything, with git's new message on the stamp.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline, seedPipelineRow } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { createWorktree, listLocalBranches } from '../src/core/worktree.mjs';
import { lookupPipelineRow, retainedWorkFor, branchRecordsOf } from '../src/core/artifacts.mjs';
import { updateBranchRecords } from '../src/core/checkout.mjs';
import { applyRetainedWork } from '../src/core/pipeline-delete.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { writeRunManifest, readRunManifest } from '../src/core/run-manifest.mjs';

useTempHome(after, 'worca-cc-apply-');
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const POSIX = { skip: process.platform === 'win32' ? 'hook scripts are POSIX shell' : false };
const FAILED = { code: 'commit_failed', step: 'commit', message: 'hook failed', at: '2026-10-14T10:00:00Z' };

/** A finished run whose end-of-run commit failed: the worktree holds staged work, the record the stamp. */
async function retainedRun({ status = 'done', sameAsSource = false, runRootMode = 'legacy', files = {} } = {}) {
  const repo = templateRepo('apply', { branch: 'main', user: true, files: { 'README.md': '# hi\n', ...files } });
  created.push(repo);
  const { id, key } = await seedPipeline(repo, { status, title: 'Add login',
    branch: { source: 'main', ...(sameAsSource ? { sameAsSource: true } : {}), runRootMode } });
  const wt = await createWorktree({ projectDir: repo, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/apply-${id}` });
  await writeFile(join(wt.worktreeDir, 'login.js'), 'export const login = () => true;\n');
  git(wt.worktreeDir, ['add', '-A']);
  updateBranchRecords(id, [key], (br) => {
    Object.assign(br, { feature: wt.branch, worktreeDir: wt.worktreeDir, worktreeRemoved: false, branchKept: true, commitFailed: { ...FAILED } });
    if (sameAsSource) br.mergeBack = { merged: false, kind: 'commit-failed', reason: "the run's last changes could not be committed", at: FAILED.at };
  });
  return { repo, id, key, wt };
}
const recordOf = (key, id) => branchRecordsOf(lookupPipelineRow(key, id))[0][1];

test('applies: commits on the branch, clears the stamp, releases the worktree, keeps the branch', async () => {
  const { repo, id, key, wt } = await retainedRun();
  const report = await applyRetainedWork({ key, id });
  assert.equal(report.failed.length, 0, JSON.stringify(report));
  assert.equal(report.applied.length, 1);
  const [a] = report.applied;
  assert.equal(a.committed, true);
  assert.equal(a.sha, git(repo, ['rev-parse', `refs/heads/${wt.branch}`]).stdout.trim());
  assert.match(git(repo, ['log', '-1', '--format=%B', wt.branch]).stdout, /^worca: Add login\n\nPipeline /);
  assert.equal(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0, 'the work is on the branch');
  assert.equal(existsSync(wt.worktreeDir), false, 'the worktree is released');
  assert.ok((await listLocalBranches(repo)).includes(wt.branch), 'the branch is kept');
  const br = recordOf(key, id);
  assert.equal(br.commitFailed, undefined);
  assert.equal(br.commit, a.sha);
  assert.equal(br.worktreeRemoved, true);
  assert.equal(br.branchKept, true);
  assert.equal(br.retainedApplied.sha, a.sha);
  assert.equal(retainedWorkFor(lookupPipelineRow(key, id)), null);
});

test('a run on its source branch is merged back (fast-forward) and its hidden branch dropped', async () => {
  const { repo, id, key, wt } = await retainedRun({ sameAsSource: true });
  const report = await applyRetainedWork({ key, id });
  const [a] = report.applied;
  assert.equal(a.mergeBack.merged, true, JSON.stringify(report));
  assert.equal(a.mergeBack.source, 'main');
  assert.equal(git(repo, ['rev-parse', 'refs/heads/main']).stdout.trim(), a.sha, 'main now holds the work');
  assert.ok(!(await listLocalBranches(repo)).includes(wt.branch), 'the hidden branch is deleted');
  const br = recordOf(key, id);
  assert.equal(br.mergeBack.merged, true);
  assert.equal(br.branchKept, false);
});

test('a source that moved on is not merged back: the reason replaces "could not be committed"', async () => {
  const { repo, id, key, wt } = await retainedRun({ sameAsSource: true });
  await writeFile(join(repo, 'other.txt'), 'someone else\n');
  git(repo, ['add', 'other.txt']);
  git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'moved on']);
  const report = await applyRetainedWork({ key, id });
  const [a] = report.applied;
  assert.equal(a.mergeBack.merged, false);
  assert.equal(a.mergeBack.kind, 'diverged');
  const br = recordOf(key, id);
  assert.equal(br.mergeBack.kind, 'diverged');
  assert.equal(br.branchKept, true);
  assert.ok((await listLocalBranches(repo)).includes(wt.branch), 'the work stays on the hidden branch');
  assert.equal(existsSync(wt.worktreeDir), false);
});

test('a stopped run on its source branch is committed but not merged back (not-done, as teardown)', async () => {
  const { id, key } = await retainedRun({ status: 'stopped', sameAsSource: true });
  const [a] = (await applyRetainedWork({ key, id })).applied;
  assert.equal(a.mergeBack.merged, false);
  assert.equal(a.mergeBack.kind, 'not-done');
});

test('a commit that fails again keeps the worktree and the stamp, with git\'s new message', POSIX, async () => {
  const { repo, id, key, wt } = await retainedRun();
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\necho "still failing: tests" >&2\nexit 1\n');
  await chmod(hook, 0o755);
  const report = await applyRetainedWork({ key, id });
  assert.equal(report.applied.length, 0);
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].message, /still failing: tests/);
  assert.equal(report.remaining, 1);
  assert.equal(existsSync(wt.worktreeDir), true);
  const br = recordOf(key, id);
  assert.match(br.commitFailed.message, /still failing: tests/);
  assert.equal(br.commitFailed.code, 'commit_failed');
  assert.ok(retainedWorkFor(lookupPipelineRow(key, id)), 'still retained');
});

test('a detached run retries without hooks, as its teardown did', POSIX, async () => {
  const { repo, id, key } = await retainedRun({ runRootMode: 'detached' });
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  const [a] = (await applyRetainedWork({ key, id })).applied;
  assert.equal(a.hooksBypassed, true);
  assert.equal(recordOf(key, id).retainedApplied.hooksBypassed, true);
});

test('a retained worktree switched off the run\'s branch is not applied: nothing committed, the worktree and stamp stay', async () => {
  const { repo, id, key, wt } = await retainedRun();
  git(wt.worktreeDir, ['checkout', '-q', '--detach']);
  const report = await applyRetainedWork({ key, id });
  assert.equal(report.applied.length, 0, JSON.stringify(report));
  assert.equal(report.failed[0].step, 'branch');
  assert.equal(existsSync(wt.worktreeDir), true, 'never released: the work is on no branch');
  assert.notEqual(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0);
  const br = recordOf(key, id);
  assert.equal(br.commitFailed.step, 'branch');
  assert.match(br.commitFailed.message, /detached HEAD/);
  assert.ok(retainedWorkFor(lookupPipelineRow(key, id)), 'still retained');
});

test('a project that tracks .claude/rules/worca keeps those files: Apply commits them as teardown would, never their deletion', async () => {
  const { repo, id, key, wt } = await retainedRun({ files: { '.claude/rules/worca/team.md': '# team\n' } });
  await writeFile(join(wt.worktreeDir, '.claude', 'rules', 'worca', 'team.md'), '# team, edited by the run\n');
  const report = await applyRetainedWork({ key, id });
  assert.equal(report.applied.length, 1, JSON.stringify(report));
  const stat = git(repo, ['show', '--name-status', '--format=', wt.branch]).stdout;
  assert.doesNotMatch(stat, /^D\t\.claude\/rules\/worca\/team\.md$/m, 'the commit deletes nothing the project tracks');
  assert.match(git(repo, ['ls-tree', '-r', '--name-only', wt.branch]).stdout, /^\.claude\/rules\/worca\/team\.md$/m);
  assert.equal(git(repo, ['show', `${wt.branch}:.claude/rules/worca/team.md`]).stdout, '# team, edited by the run\n', "the run's edit lands, as at teardown");
  assert.equal(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0);
});

test('a project that does not track .claude/rules/worca: a memory mount teardown failed to remove stays out of the commit', async () => {
  const { repo, id, key, wt } = await retainedRun();
  // Teardown's own staging already took the mount out of the index; only removeInjectedPaths can leave files behind.
  const mount = join(wt.worktreeDir, '.claude', 'rules', 'worca');
  await mkdir(mount, { recursive: true });
  await writeFile(join(mount, 'note.md'), '# memory\n');
  const report = await applyRetainedWork({ key, id });
  assert.equal(report.applied.length, 1, JSON.stringify(report));
  assert.doesNotMatch(git(repo, ['ls-tree', '-r', '--name-only', wt.branch]).stdout, /rules\/worca/);
  assert.equal(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0);
});

test('nothing retained: an idempotent empty report; unknown id: null', async () => {
  const { id, key } = await retainedRun();
  await applyRetainedWork({ key, id });
  const again = await applyRetainedWork({ key, id });
  assert.deepEqual([again.applied, again.failed, again.remaining], [[], [], 0]);
  assert.equal(await applyRetainedWork({ key, id: 'deadbeef' }), null);
  await assert.rejects(() => applyRetainedWork({ id }), /projectKey, projectDir or workspaceKey is required/);
});

test('a workspace applies member by member: a member whose commit fails again keeps its worktree and stamp (D10)', POSIX, async () => {
  const repoA = templateRepo('apply-wsa', { branch: 'main', user: true, files: { 'README.md': '# a\n' } });
  const repoB = templateRepo('apply-wsb', { branch: 'main', user: true, files: { 'README.md': '# b\n' } });
  created.push(repoA, repoB);
  const id = 'a5b6c7d8';
  const wkey = 'wks-apply';
  const [keyA, keyB] = ['apply-wsa-0000000a', 'apply-wsb-0000000b'];
  const wtA = await createWorktree({ projectDir: repoA, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/apply-${id}-a` });
  const wtB = await createWorktree({ projectDir: repoB, pipelineId: id, sourceBranch: 'main', featureBranch: `worca-cc/apply-${id}-b` });
  await writeFile(join(wtA.worktreeDir, 'a.js'), 'export const a = 1;\n');
  git(wtA.worktreeDir, ['add', '-A']);
  await writeFile(join(wtB.worktreeDir, 'b.js'), 'export const b = 1;\n');
  git(wtB.worktreeDir, ['add', '-A']);
  const hook = join(repoB, '.git', 'hooks', 'pre-commit');           // member B only
  await writeFile(hook, '#!/bin/sh\necho "member B: lint failed" >&2\nexit 1\n');
  await chmod(hook, 0o755);
  const projects = [
    { projectKey: keyA, projectDir: repoA, projectName: 'apply-wsa' },
    { projectKey: keyB, projectDir: repoB, projectName: 'apply-wsb' },
  ];
  const retainedRecord = (wt) => ({ source: 'main', feature: wt.branch, worktreeDir: wt.worktreeDir,
    worktreeRemoved: false, branchKept: true, commitFailed: { ...FAILED } });
  seedPipelineRow({
    id, projectKey: keyA, workspaceKey: wkey, target: 'workspace', title: 'Add login', status: 'done',
    baseName: 'add-login', datePrefix: '14-10-26',
    workspaceMeta: { workspaceId: wkey, workspaceName: 'demo', projectKeys: [keyA, keyB], projects,
      branches: { [keyA]: retainedRecord(wtA), [keyB]: retainedRecord(wtB) }, runRootMode: 'legacy' },
  });

  const report = await applyRetainedWork({ workspaceKey: wkey, id });
  assert.deepEqual(report.applied.map((a) => a.projectKey), [keyA], JSON.stringify(report));
  assert.deepEqual(report.failed.map((f) => f.projectKey), [keyB]);
  assert.match(report.failed[0].message, /member B: lint failed/);
  assert.equal(report.remaining, 1, 'the member that failed again keeps the run alive');
  assert.equal(existsSync(wtA.worktreeDir), false, "A's worktree is released");
  assert.equal(existsSync(wtB.worktreeDir), true, "B's worktree stays");
  assert.equal(git(repoA, ['cat-file', '-e', `${wtA.branch}:a.js`]).status, 0, "A's work is on its branch");

  const row = lookupPipelineRow(`workspaces/${wkey}`, id);
  const recs = Object.fromEntries(branchRecordsOf(row));
  assert.equal(recs[keyA].commitFailed, undefined);
  assert.equal(recs[keyA].commit, report.applied[0].sha);
  assert.equal(recs[keyA].retainedApplied.sha, report.applied[0].sha);
  assert.equal(recs[keyA].worktreeRemoved, true);
  assert.match(recs[keyB].commitFailed.message, /member B: lint failed/);
  assert.notEqual(recs[keyB].commitFailed.message, FAILED.message);
  assert.equal(recs[keyB].worktreeRemoved, false);
  assert.deepEqual(retainedWorkFor(row).members.map((m) => m.projectKey), [keyB]);
});

test('a worktree removal that fails after a good commit: the DB stamp and the run.json retain ledger both forget the member', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions (not root)' : false }, async () => {
  const { repo, id, key, wt } = await retainedRun();
  const runRoot = join(worcaHome(), 'runs', id);
  await writeRunManifest(runRoot, { retain: { reason: 'commit_failed', at: FAILED.at,
    members: [{ projectKey: key, worktreeDir: wt.worktreeDir, branch: wt.branch, step: 'commit', message: 'hook failed', at: FAILED.at }] } });
  const parent = dirname(wt.worktreeDir);
  await chmod(parent, 0o555);                                   // the worktree folder cannot be removed
  let report;
  try {
    report = await applyRetainedWork({ key, id });
  } finally {
    await chmod(parent, 0o755);
  }
  assert.equal(report.applied.length, 1, JSON.stringify(report));
  assert.equal(git(repo, ['cat-file', '-e', `${wt.branch}:login.js`]).status, 0, 'the work is on the branch');
  assert.equal(report.remaining, 1, 'the folder is still there');
  assert.equal(existsSync(wt.worktreeDir), true);
  assert.equal(recordOf(key, id).commitFailed, undefined);
  assert.equal(retainedWorkFor(lookupPipelineRow(key, id)), null);
  assert.equal((await readRunManifest(runRoot)).retain, null, 'Archive and the boot sweep no longer see retained work');
});
