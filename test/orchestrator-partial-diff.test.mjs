// test/orchestrator-partial-diff.test.mjs
// The diff artifact must survive the NON-done terminal paths. A run that is
// stopped (or that errors) mid-flight still commits its work onto the kept
// feature branch, so History must be able to show that work: _buildResults()
// runs on the stopped/error branches too, while the checkpoint refs and the
// worktree are still live (the `finally` tears them down right after).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { listArtifacts, readPipelineForResume } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-partial-diff-'));
  created.push(dir);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'seed.txt'), 'seed\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

// Write a file the moment the worktree exists. The default `seed.txt` is TRACKED:
// `git diff <checkpoint>` (what _buildResults runs) sees a tracked edit with no
// intent-to-add staging, so those assertions do not depend on which dispatch step
// the run was stopped in. Pass a fresh `name` for the UNTRACKED case, which git
// diff is blind to until the terminal path stages it.
function editOnWorktree(orch, text, name = 'seed.txt') {
  const box = { done: false, dir: null };
  orch.on('state', (s) => {
    const wt = s.branch && s.branch.worktreeDir;
    if (box.done || !wt || !existsSync(wt)) return;
    box.done = true;
    box.dir = wt;
    writeFileSync(join(wt, name), text);
  });
  return box;
}

const results = (dir) => join(dir, 'results.json');
const patch = (dir) => join(dir, 'diff-patch.patch');

test('a run stopped mid-flight persists results.json + diff-patch.patch', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const edit = editOnWorktree(orch, 'stopped work\n');
  orch.on('state', (s) => { if (s.branch && s.branch.feature) orch.stop(); });

  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.ok(edit.done, 'precondition: the tracked file was edited inside the worktree');

  assert.ok(existsSync(results(res.pipelineDir)), 'results.json is persisted on the stopped path');
  assert.ok(existsSync(patch(res.pipelineDir)), 'diff-patch.patch is persisted on the stopped path');
  const text = readFileSync(patch(res.pipelineDir), 'utf8');
  assert.match(text, /seed\.txt/);
  assert.match(text, /\+stopped work/);

  const arts = await listArtifacts(orch.getState().id);
  assert.ok(arts.some((a) => a.kind === 'diff-patch'), 'the diff-patch artifact is indexed');
});

test('a run that errors mid-flight persists results.json + diff-patch.patch', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    runners: { producer: async () => { throw new Error('boom'); }, verifier: okVerifier },
  });
  const edit = editOnWorktree(orch, 'errored work\n');

  const res = await orch.run();
  assert.equal(res.status, 'error', JSON.stringify(res));
  assert.ok(edit.done, 'precondition: the tracked file was edited inside the worktree');

  assert.ok(existsSync(results(res.pipelineDir)), 'results.json is persisted on the error path');
  const text = readFileSync(patch(res.pipelineDir), 'utf8');
  assert.match(text, /\+errored work/);

  const arts = await listArtifacts(orch.getState().id);
  assert.ok(arts.some((a) => a.kind === 'diff-patch'), 'the diff-patch artifact is indexed');
});

test('the persisted patch matches what the kept feature branch commit carries', async () => {
  // Ordering guard: _buildResults must run BEFORE the `finally` tears the checkout
  // down. It diffs the live worktree against the checkpoint; teardown then commits
  // the same exclusion set onto the kept branch — so the two diffs agree.
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  editOnWorktree(orch, 'stopped work\n');
  orch.on('state', (s) => { if (s.branch && s.branch.feature) orch.stop(); });

  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  const feature = orch.getState().branch.feature;
  assert.ok(!existsSync(orch.getState().branch.worktreeDir), 'the checkout is gone by the time run() resolves');

  const fromBranch = spawnSync('git', ['-C', repo, 'diff', 'main', feature]).stdout.toString();
  assert.match(fromBranch, /\+stopped work/, 'precondition: the kept branch carries the work');

  const persisted = readFileSync(patch(res.pipelineDir), 'utf8');
  const bodyOf = (s) => s.split('\n').filter((l) => /^[+-@]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n');
  assert.equal(bodyOf(persisted), bodyOf(fromBranch));
});

// A file the agent CREATED is the whole point of the feature, and it is exactly
// what a plain `git diff <checkpoint>` cannot see: only the review loop's
// intent-to-add staging (`git add -A -N`, :2204/:2311) makes it visible, and a
// stopped run never reaches it. The terminal paths stage themselves.
test('a stopped run keeps the files the agent CREATED (untracked) in the patch', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const made = editOnWorktree(orch, 'agent created this\n', 'brand-new.txt');
  orch.on('state', (s) => { if (s.branch && s.branch.feature) orch.stop(); });

  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.ok(made.done, 'precondition: an untracked file was created inside the worktree');

  const text = readFileSync(patch(res.pipelineDir), 'utf8');
  assert.match(text, /^diff --git a\/brand-new\.txt b\/brand-new\.txt$/m);
  assert.match(text, /^new file mode /m, 'staged as an addition, not as a context-free blob');
  assert.match(text, /\+agent created this/);

  // results.json is built from the same diff base, so it must agree.
  const view = JSON.parse(readFileSync(results(res.pipelineDir), 'utf8'));
  assert.deepEqual(view.newFiles.map((f) => f.path), ['brand-new.txt']);
  assert.equal(view.summary.filesNew, 1);

  // The kept branch carried it all along — that gap is what this pins.
  const feature = orch.getState().branch.feature;
  const fromBranch = spawnSync('git', ['-C', repo, 'diff', 'main', feature]).stdout.toString();
  assert.match(fromBranch, /\+agent created this/, 'precondition: the kept branch carries the file');
});

test('an errored run keeps the files the agent CREATED too', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    runners: { producer: async () => { throw new Error('boom'); }, verifier: okVerifier },
  });
  const made = editOnWorktree(orch, 'errored new file\n', 'brand-new.txt');

  const res = await orch.run();
  assert.equal(res.status, 'error', JSON.stringify(res));
  assert.ok(made.done, 'precondition: an untracked file was created inside the worktree');
  assert.match(readFileSync(patch(res.pipelineDir), 'utf8'), /\+errored new file/);
});

// A checkpoint existing is NOT the same as the run having a diff. Every downstream
// "does this run have a diff?" test is an EXISTENCE test: a 0-byte patch makes
// /diff answer 200-empty instead of 404, /recovery-patch serve an empty
// attachment, the comments routes report patchAvailable:false and 409 every
// create, and the detail page open on the Diff tab to render "(no files changed)".
test('a stopped run whose worktree was never touched persists nothing', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  // No editOnWorktree: the checkpoint IS established (step 3 precedes the worktree
  // setup that names the feature branch), so `if (!members.length) return` does
  // NOT catch this — the diff under that checkpoint is simply empty.
  orch.on('state', (s) => { if (s.branch && s.branch.feature) orch.stop(); });

  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.ok(!existsSync(patch(res.pipelineDir)), 'no 0-byte diff-patch.patch');
  assert.ok(!existsSync(results(res.pipelineDir)), 'and no all-zero results.json');

  const arts = await listArtifacts(orch.getState().id);
  assert.ok(!arts.some((a) => a.kind === 'diff-patch' || a.kind === 'results'),
    'nothing is indexed either, so both artifact routes keep 404-ing');
});

test('a run stopped before the checkpoint exists writes no results and does not throw', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const p = orch.run();
  orch.stop();                       // abort before preflight can build a checkpoint
  const res = await p;
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.ok(res.pipelineDir, 'the pipeline row still exists');
  assert.ok(!existsSync(results(res.pipelineDir)), 'no results.json without checkpoint refs');
  assert.ok(!existsSync(patch(res.pipelineDir)), 'no diff-patch.patch without checkpoint refs');
});

test('the done path still persists both artifacts (unchanged)', async () => {
  const repo = await freshRepo();
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  editOnWorktree(orch, 'finished work\n');
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.ok(existsSync(results(res.pipelineDir)));
  assert.match(readFileSync(patch(res.pipelineDir), 'utf8'), /\+finished work/);
});

test('a resumed run that is then stopped persists results.json + diff-patch.patch', async () => {
  const repo = await freshRepo();
  let orchRef = null;
  let hangOnce = true;
  const mkRunners = () => ({
    producer: async (ctx) => {
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      queueMicrotask(() => orchRef.stop());
      return new Promise((_r, rej) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
        if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    verifier: okVerifier,
  });

  const orch1 = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true },
    branch: { source: 'main' }, runners: mkRunners(),
  });
  orchRef = orch1;
  const edit = editOnWorktree(orch1, 'resumed work\n');
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.ok(edit.done, 'precondition: the tracked file was edited inside the worktree');

  const saved = readPipelineForResume(orch1.state.id);
  const orch2 = createOrchestrator({
    projectDir: repo, auto: true, claude: { mock: true }, runners: mkRunners(), resume: saved,
  });
  orchRef = orch2;
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'stopped', JSON.stringify(r2));

  assert.ok(existsSync(results(r2.pipelineDir)), 'results.json is persisted on resume()\'s stopped path');
  assert.match(readFileSync(patch(r2.pipelineDir), 'utf8'), /\+resumed work/);
});

// Review of PR #376: the empty-patch early return above also ran on the DONE
// path, so a finished run with no file changes (review-only / plan-only / no-op
// workflow) stopped writing results.json — which carries the review-derived
// keyThingsToCheck/blockingIssues the task-source write-back reads
// (sources.mjs). Absent diff stays absent; absent RESULTS is a regression.
test('a done run with NO file changes still persists results.json (no 0-byte diff-patch)', async () => {
  const repo = await freshRepo();
  // A review-only workflow: the mock reviewer writes no project files, so the
  // checkpoint diff is genuinely empty.
  const wf = await writeWorkflow({ name: 'Review only', steps: [[{ id: 's0', key: 'reviewer' }]], feedbacks: [] });
  const orch = createOrchestrator({
    projectDir: repo, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' }, workflowId: wf.id,
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.ok(existsSync(results(res.pipelineDir)), 'results.json is written on the done path even with no diff');
  const parsed = JSON.parse(readFileSync(results(res.pipelineDir), 'utf8'));
  assert.equal(typeof parsed.summary, 'object');
  assert.ok(!existsSync(patch(res.pipelineDir)), 'no 0-byte diff-patch.patch');
  const arts = await listArtifacts(orch.getState().id);
  assert.ok(arts.some((a) => a.kind === 'results'), 'results indexed');
  assert.ok(!arts.some((a) => a.kind === 'diff-patch'), 'diff-patch not indexed');
});
