// test/git-missing-wrappers.test.mjs — git missing: every async wrapper answers its own failure shape and spawns
// nothing; injected runners sit behind the gate, so a counting stub sees any leak.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { _testing as cap, gitMissingResult } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { listRemotes, hasGh, findPrForBranch, prMergeable, createPr, _testing as gitInfo } from '../src/core/git-info.mjs';
import { commitInfo, _testing as gitSync } from '../src/core/git-sync.mjs';
import { runGit, _testing as metricsGit } from '../src/core/metrics/sync.mjs';
import { runGitCapture } from '../src/core/worktree.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { openBranchWorktree } from '../src/core/terminal/worktrees.mjs';
import { listMemberFiles } from '../src/core/workspace-map/files.mjs';
import { clearStaleGitLocks } from '../src/core/git-lock.mjs';
import { envForShell } from '../src/core/graph/script-runner.mjs';

useTempHome(after);
afterEach(() => { cap.reset(); gitInfo.reset(); gitSync.reset(); metricsGit.reset(); });
const repo = gitDir('p0-wrap');                        // built while git is on (suite WORCA_GIT=1)
const counter = () => { const calls = []; return { calls, fn: async (...a) => { calls.push(a); return { ok: true, stdout: '', stderr: '', code: 0 }; } }; };

test('async wrappers while git is missing', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'git-info: no git call reaches the runner; gh still does', run: async () => {
      const r = counter(); gitInfo.setRunner(r.fn);
      assert.deepEqual(await listRemotes(repo), { ok: false, remotes: [], error: 'git is not installed on this machine' });
      await hasGh();
      assert.deepEqual(r.calls.map((c) => c[0]), ['gh']);
    } },
    { name: 'git-info: gh calls that make gh run git (no --repo and no PR URL; pr create) are refused like git', run: async () => {
      const r = counter(); gitInfo.setRunner(r.fn);
      const url = 'https://github.com/o/r/pull/1';
      assert.equal(await findPrForBranch({ projectDir: repo, head: 'worca-cc/x-1' }), null);        // History list, archive, sources
      assert.equal(await prMergeable({ projectDir: repo, head: 'worca-cc/x-1' }), 'UNKNOWN');      // POST /api/pr/mergeable
      assert.equal((await createPr({ projectDir: repo, base: 'main', head: 'worca-cc/x-1', title: 't', repo: 'o/r' })).ok, false);
      assert.equal(await findPrForBranch({ projectDir: repo, head: 'worca-cc/x-1', prUrl: url }), null);
      assert.equal(await prMergeable({ projectDir: repo, head: 'worca-cc/x-1', repo: 'o/r' }), 'UNKNOWN');
      // only the calls gh answers without git reach the runner: a PR URL, and --repo
      assert.deepEqual(r.calls.map((c) => [c[0], ...c[1].slice(0, 4)]), [['gh', 'pr', 'view', url, '--json'], ['gh', 'pr', 'view', 'worca-cc/x-1', '--repo']]);
    } },
    { name: 'git-sync: commitInfo answers null, the runner is never called', run: async () => {
      const r = counter(); gitSync.setRunner(r.fn);
      assert.equal(await commitInfo(repo, 'HEAD'), null);
      assert.equal(r.calls.length, 0);
    } },
    { name: 'metrics/policy runGit: the failure shape, no call', run: async () => {
      const r = counter(); metricsGit.setGit(r.fn);
      assert.deepEqual(await runGit(repo, ['status']), gitMissingResult());
      assert.equal(r.calls.length, 0);
    } },
    { name: 'worktree.mjs and the harness: a real spawn would print "git version"; both return the shape', run: async () => {
      assert.deepEqual(await runGitCapture(repo, ['--version']), gitMissingResult());
      assert.deepEqual(await RunHarness.prototype._git.call({ projectDir: repo, abort: new AbortController() }, ['--version']), gitMissingResult());
    } },
    { name: 'branch terminal: GIT_MISSING before anything else', run: async () => {
      await assert.rejects(openBranchWorktree({ projectKey: 'p0wrap-00000001', projectDir: repo, branch: 'main' }), { code: 'GIT_MISSING' });
    } },
    { name: 'workspace map lists files by walking; a stale index.lock is left alone (git never asked)', run: async () => {
      writeFileSync(join(repo, 'a.txt'), 'x');
      const lock = join(repo, '.git', 'index.lock'); writeFileSync(lock, '');
      const old = new Date(Date.now() - 3_600_000); utimesSync(lock, old, old);
      assert.equal((await listMemberFiles(repo)).via, 'walk');
      assert.deepEqual(await clearStaleGitLocks(repo), []);
      assert.ok(existsSync(lock));
    } },
    { name: 'git on again: the same calls reach git (the gate is the only change)', run: async () => {
      gitArrives();
      assert.match((await runGitCapture(repo, ['--version'])).stdout, /^git version /);
    } },
  ]);
});

test('script children get the parent answer as WORCA_GIT (a child never probes)', (t) => {
  const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;
  t.after(() => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; cap.reset(); });
  cap.set({ available: true, version: '2.43.0', path: '/usr/bin/git', reason: 'ok' });
  assert.equal(envForShell({ ctx: {} }, { PATH: '/usr/bin' }).WORCA_GIT, '1', 'probed on, env unset: the child must not fall to "not probed"');
  withNoGit();
  assert.equal(envForShell({ ctx: {} }, { PATH: '/usr/bin' }).WORCA_GIT, '0');
});

// Imports here (ESM hoists them): every line above stays byte-identical for the later plans' anchors.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { templateRepo } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkoutRun } from '../src/core/checkout.mjs';
import { removeBranchWorktree } from '../src/core/terminal/worktrees.mjs';
import { insertBranchWorktree } from '../src/core/terminal/store.mjs';

test('worktree cleanup paths while git is missing never run git', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'Check out (the keep policy after a run; the routes are gated): no `git worktree prune` while git is missing', run: async () => {
      gitArrives();
      const proj = templateRepo('p0-co', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
      execFileSync('git', ['branch', 'worca-cc/p0co'], { cwd: proj });
      const box = mkdtempSync(join(tmpdir(), 'worca-p0-wt-')); t.after(() => rmSync(box, { recursive: true, force: true }));
      const gone = join(box, 'wt');
      execFileSync('git', ['worktree', 'add', '--detach', gone], { cwd: proj });
      rmSync(gone, { recursive: true, force: true });            // a stale registration: `git worktree prune` would drop it
      const { id } = await seedPipeline(proj, { status: 'done', branch: { source: 'main', feature: 'worca-cc/p0co', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
      withNoGit();
      await checkoutRun({ id }).catch(() => {});
      assert.ok(existsSync(join(proj, '.git', 'worktrees', 'wt')), 'the stale registration is still there: git never ran');
    } },
    { name: 'removeBranchWorktree (boot sweep / cap / keep never): kept as unpushed-commits — git itself would find nothing unreached here', run: async () => {
      const copy = gitDir('p0-detached');            // HEAD sits on a branch: a real `git rev-list … --not --branches` prints nothing
      insertBranchWorktree({ dir: copy, projectKey: 'p0wrap-00000001', branch: 'main', detached: true });
      assert.deepEqual(await removeBranchWorktree(copy, { projectDirOf: async () => repo }), { removed: false, reason: 'unpushed-commits' });
      assert.ok(existsSync(copy));
    } },
  ]);
});

// A kept checkout is discarded with `force: true` (until-pr release, the checkout cap); the patch that saves its
// uncommitted edits (snapshotWorktreePatch) needs git, so while git is missing nothing may discard it.
import { releaseKeptCheckouts, enforceCheckoutCap } from '../src/core/checkout.mjs';
import { persistPrState } from '../src/core/artifacts.mjs';

test('kept checkouts are never discarded while git is missing (their edits could not be saved)', async (t) => {
  withNoGit(t);
  gitArrives();
  const proj = templateRepo('p0-kept', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } }); t.after(() => rmSync(proj, { recursive: true, force: true }));
  execFileSync('git', ['branch', 'worca-cc/p0kept'], { cwd: proj });
  const { id } = await seedPipeline(proj, { status: 'done', branch: { source: 'main', feature: 'worca-cc/p0kept', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  const { members: [m] } = await checkoutRun({ id, policy: 'until-pr' });
  persistPrState(id, { url: 'https://github.com/acme/p0kept/pull/1', number: 1, state: 'OPEN' });
  const edit = join(m.worktreeDir, 'EDIT.txt');
  writeFileSync(edit, 'unsaved\n');
  withNoGit();
  await checkRows([
    { name: 'until-pr release of a merged PR: nothing released, the edits stay', run: async () => {
      assert.deepEqual(await releaseKeptCheckouts({ busy: new Set(), prState: async () => 'MERGED' }), { released: [] });
      assert.ok(existsSync(edit));
    } },
    { name: 'the checkout cap evicts nothing', run: async () => {
      assert.deepEqual(await enforceCheckoutCap({ max: 0, busy: new Set() }), { evicted: [] });
      assert.ok(existsSync(edit));
    } },
  ]);
});

// A run that ends while git is missing (git vanished mid-run, or Stop of a paused run) keeps its worktree and branch;
// the after-run base check must not store "no-branch" for a branch it could not look at.
import { afterRunBaseCheck } from '../src/core/base-conflicts.mjs';
import { findPipelineRowById } from '../src/core/artifacts.mjs';

test('the after-run base check stores nothing while git is missing (the branch is still there)', async (t) => {
  withNoGit(t);
  gitArrives();
  const proj = templateRepo('p0-basecheck', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } }); t.after(() => rmSync(proj, { recursive: true, force: true }));
  execFileSync('git', ['branch', 'worca-cc/p0base'], { cwd: proj });
  const { id } = await seedPipeline(proj, { status: 'stopped', branch: { source: 'main', feature: 'worca-cc/p0base', runRootMode: 'detached', worktreeRemoved: false, branchKept: true } });
  withNoGit();
  await afterRunBaseCheck(id);
  assert.equal(JSON.parse(findPipelineRowById(id).branch).baseCheck, undefined);
});
