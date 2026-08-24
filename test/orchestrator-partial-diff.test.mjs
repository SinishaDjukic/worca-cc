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

// Edit a TRACKED file the moment the worktree exists: `git diff <checkpoint>` (what
// _buildResults runs) sees a tracked edit with no intent-to-add staging, so the
// assertions do not depend on which dispatch step the run was stopped in.
function editOnWorktree(orch, text) {
  const box = { done: false, dir: null };
  orch.on('state', (s) => {
    const wt = s.branch && s.branch.worktreeDir;
    if (box.done || !wt || !existsSync(wt)) return;
    box.done = true;
    box.dir = wt;
    writeFileSync(join(wt, 'seed.txt'), text);
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
