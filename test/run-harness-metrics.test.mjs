// test/run-harness-metrics.test.mjs
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { _testing as recordTesting } from '../src/core/metrics/record.mjs';

useTempHome(after);
afterEach(() => recordTesting.reset());

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-rh-metrics-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# hi\n'); g('add', '-A'); g('commit', '-qm', 'init');
  return dir;
}

function spy() {
  const calls = [];
  recordTesting.setRecorder(async (harness, opts) => { calls.push({ status: opts.status, hasPipeline: !!harness.pipeline, error: opts.error ? String(opts.error.message || opts.error) : null, iv: { ...harness._metricsIv } }); return { recorded: false, reason: 'spy' }; });
  return calls;
}

// Local copy of the stub runners from test/orchestrator-error-pause.test.mjs:22-24
// (test/helpers/engines.mjs exports only adaptRunner/ENGINES — importing `runners` from it fails at link time).
const runners = () => ({
  producer: async () => ({ status: 'ok', summary: 'ok' }),
  verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
});

test('run() done → recordRunMetrics exactly once with status done', async () => {
  const calls = spy();
  const orch = createOrchestrator({ projectDir: repo(), prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.deepEqual(calls.map((c) => c.status), ['done']);
  assert.equal(calls[0].hasPipeline, true);
});

test('run() stopped → exactly once with status stopped', async () => {
  const calls = spy();
  const orch = createOrchestrator({ projectDir: repo(), prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' } });
  orch.on('state', (s) => { if (s.branch && s.branch.feature) orch.stop(); });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  assert.deepEqual(calls.map((c) => c.status), ['stopped']);
});

test('run() error with a row → exactly once with status error and the error', async () => {
  const calls = spy();
  const orch = createOrchestrator({ projectDir: repo(), prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  orch._pauseForFailure = async () => null;              // policy says "error" instead of pause
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error'); assert.equal(calls[0].hasPipeline, true);
  assert.match(calls[0].error, /graphify exploded/);
});

test('run() launch/preflight error (no row) → called once, harness has no pipeline', async () => {
  const calls = spy();
  const orch = createOrchestrator({ projectDir: repo(), prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch._preflightAgentKeys = () => { throw new Error('agent "ghost" is not installed'); };
  const res = await orch.run();
  assert.equal(res.status, 'error'); assert.equal(res.pipelineDir, null);
  assert.deepEqual(calls.map((c) => [c.status, c.hasPipeline]), [['error', false]]);
});

test('pause then resume() done → once on resume, interventions carry pauses/resumes', async () => {
  const dir = repo();
  const calls = spy();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  const realBuild = orch1._buildWorktreeGraph.bind(orch1);
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  assert.equal(calls.length, 0, 'a pause is not terminal');
  const saved = readPipelineForResume(orch1.state.id);
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done');
  assert.deepEqual(calls.map((c) => c.status), ['done']);
  assert.equal(calls[0].iv.pauses, 1); assert.equal(calls[0].iv.resumes, 1);
  void realBuild;
});

test('resume() error (worktree removed) → once with status error', async () => {
  const dir = repo();
  const calls = spy();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  await orch1.run();
  rmSync(orch1.state.branch.worktreeDir, { recursive: true, force: true });
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: readPipelineForResume(orch1.state.id) });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'error');
  assert.deepEqual(calls.map((c) => c.status), ['error']);
});

test('resume() stopped → once with status stopped', async () => {
  const dir = repo();
  const calls = spy();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  await orch1.run();
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: readPipelineForResume(orch1.state.id) });
  orch2.on('state', (s) => { if (s.status === 'running') orch2.stop(); });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'stopped');
  assert.deepEqual(calls.map((c) => c.status), ['stopped']);
});

test('a throwing recorder never breaks the run', async () => {
  recordTesting.setRecorder(async () => { throw new Error('metrics boom'); });
  const orch = createOrchestrator({ projectDir: repo(), prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' } });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.ok(logs.some((l) => l.source === 'metrics' && /metrics boom/.test(l.text)));
});

test('a pause stamps lastPauseReason into the resume point; resume counts one resume and no extra pause', async () => {
  const dir = repo();
  const calls = spy();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  await orch1.run();
  assert.equal(orch1.state.resumePoint.interventions.pauses, 1);
  assert.equal(orch1.state.resumePoint.interventions.lastPauseReason, 'error');
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: readPipelineForResume(orch1.state.id) });
  await orch2.resume();
  // Counters survive; the last pause is forgotten once resume rehydrated (decision 2), so a
  // later unrelated failure/stop is never mislabelled with the old pause reason.
  assert.deepEqual([calls[0].iv.pauses, calls[0].iv.resumes, calls[0].iv.lastPauseReason], [1, 1, null]);
});

test('every persisted resume point carries the counters (a crash-resume keeps them)', async () => {
  const dir = repo();
  spy();
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch1._buildWorktreeGraph = async () => { throw new Error('graphify exploded'); };
  await orch1.run();
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(), resume: readPipelineForResume(orch1.state.id) });
  const seen = [];
  orch2.on('state', (s) => {
    if (s.status !== 'running') return;
    const rp = readPipelineForResume(orch1.state.id).resumePoint;   // the PERSISTED point a crash would resume from
    if (rp) seen.push(rp.interventions ?? null);
  });
  await orch2.resume();
  // The first sample is still the pause's own point, written before resume()'s first _persist().
  assert.ok(seen.length > 1, JSON.stringify(seen));
  assert.ok(seen.slice(1).every((iv) => iv && iv.pauses === 1 && iv.resumes === 1), JSON.stringify(seen));
});

test('the live-pause fallback in snapshotFromHarness reports failure kind budget when stop() races a cost-cap pause', async () => {
  // _pauseFor() sets this.pauseReason (first-writer-wins), THEN synchronously calls
  // pause() -> _setStatus('pausing') -> emits 'state'. A stop() reacting to that
  // 'state' event synchronously flips status to 'stopped' before _capReached's
  // throw ever reaches run()'s catch, so the pause branch (status !== 'stopped')
  // is skipped entirely and _completePaused() — which stamps _metricsIv — never
  // runs. harness.pauseReason is the only place the cost-cap reason survives.
  const dir = repo();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners() });
  orch.on('state', (s) => { if (s.status === 'pausing') orch.stop(); });
  orch._buildWorktreeGraph = async () => { orch._capReached('cost_total', 'total cost limit reached (test)'); };
  let recorded = null;
  recordTesting.setRecorder(async (harness, opts) => {
    const { snapshotFromHarness, buildRunRecord } = await import('../src/core/metrics/record.mjs');
    const snap = await snapshotFromHarness(harness, opts);
    recorded = { snap, record: buildRunRecord(snap) };
    return { recorded: false, reason: 'spy' };
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  assert.equal(orch._metricsIv.lastPauseReason, null, 'precondition: _completePaused never ran');
  assert.ok(recorded, 'the recorder ran on the stopped terminal path');
  assert.equal(recorded.snap.lastPause.reason, 'cost_total');
  assert.equal(recorded.record.failure?.kind, 'budget');
});
