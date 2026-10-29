// test/workflow-test-project-runner.test.mjs — workflow tests 3a, Task 7 (D55, D60, D61, D62): the runner with examples that
// work on a project. A try runs in the copy and is cleaned up however it ends; a failed setup stops the test without failing
// a try; readiness and disk refuse a start with their sentences; the progress page can see each try's phase.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { exampleReadiness, testTargetOf } from '../src/core/workflow-tests/try-body.mjs';
import { fmtGb, diskRow, diskRefusalText, diskRefusalOnceText, leftOutText } from '../src/shared/workflow-tests/project-text.mjs';

const WF = 'wf_prun';
const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftprun-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const pin = { key: 'tickets-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA, changes: null, setupCmd: 'npm ci' };
const example = (over = {}, project = pin) => store.createExample(WF, { name: 'Ticket 482', request: 'Fix the rounding.', ...over }, { project });

function harness({ setup = { cmd: 'npm ci', ok: true, exitCode: 0, timedOut: false, ms: 1000, tail: '' }, hold = false } = {}) {
  const entries = new Map();
  const started = []; const prepared = []; const cleaned = [];
  let n = 0;
  const deps = {
    startRun: async (body, { workflowTest }) => {
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0, setupStage: null };
      let finish;
      const launch = new Promise((r) => { finish = r; });
      const e = { orch, launch, status: 'running', pipelineId, end(status) { if (e.status !== 'running') return; e.status = status; finish(); } };
      entries.set(runKey, e);
      workflowTest.onOrch(orch, { runKey });
      started.push({ projectDir: body.projectDir, sourceBranch: body.sourceBranch, noProject: body.noProject, project: workflowTest.project, title: body.title });
      setImmediate(() => { orch.state.totalCostUsd = 0.5; if (!hold) e.end(setup.ok ? 'done' : 'error'); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { entries.get(k)?.end('stopped'); },
    answer: () => true,
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: 0.5, durationMs, sentBack: 0, help, failReason },
        text: 'Fixed.', name: null, source: 'end-value', files: ['src/round.mjs'], setup,
        project: { key: pin.key, checkoutDir: `/copy/${pipelineId}`, branch: `worca-cc/t-${pipelineId}`, runRoot: `/runs/${pipelineId}`,
          files: [{ status: 'changed', path: 'src/round.mjs', added: 2, removed: 1 }], paths: ['src/round.mjs'], total: 1,
          counts: { added: 0, changed: 1, removed: 0 }, added: 2, removed: 1 } };
    },
    judge: (ex, outcome) => checkTry(ex, outcome),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    prepareProject: async (ex) => { prepared.push(ex.id); return { copyDir: '/copy', startCommit: ex.project.startCommit }; },
    cleanupTry: async (o) => { cleaned.push(o.pipelineId); return { removed: true, error: null }; },
    measureDisk: async () => 123_456,
    freeDisk: async () => 50 * 2 ** 30,
    mockMode: () => false,
    pollMs: 5,
  };
  return { deps, entries, started, prepared, cleaned };
}

test('a workflow that needs a project is testable; an example without one is left out (D62)', () => {
  assert.deepEqual(testTargetOf({ nodes: [{ kind: 'agent', key: 'coder' }] }, { coder: { needsRepo: true } }), { testable: true, reason: null, needsProject: true });
  assert.deepEqual(exampleReadiness({ needsProject: true, example: { project: null }, state: null }), { ready: false, reason: 'pick-project' });
  assert.deepEqual(exampleReadiness({ needsProject: false, example: { project: null }, state: null }), { ready: true, reason: null });
  assert.deepEqual(exampleReadiness({ needsProject: false, example: { project: pin }, state: 'missing' }), { ready: false, reason: 'missing' });
  assert.deepEqual(exampleReadiness({ needsProject: true, example: { project: pin }, state: 'ok' }), { ready: true, reason: null });
  assert.equal(leftOutText(['Ticket 497']), 'Ticket 497 is left out: pick its project first.');
  assert.equal(leftOutText(['A', 'B']), 'A and B are left out: pick their project first.');
});

test('the disk sentences (boards 34, 39)', () => {
  const GB = 2 ** 30;
  assert.equal(fmtGb(1.2 * GB), '1.2 GB');
  assert.equal(diskRow(1.2 * GB, 48 * GB), 'Needs about 1.2 GB free while it runs · 48.0 GB free');
  assert.equal(diskRefusalText(1.2 * GB, 0.9 * GB), 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.');
  assert.equal(diskRefusalOnceText(0.4 * GB, 0.2 * GB), 'One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged.');
});

test('a project try runs in the copy, records what it changed, and is cleaned up', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  assert.deepEqual(h.started[0], { projectDir: '/copy', sourceBranch: SHA, noProject: undefined, project: { key: pin.key, setupCmd: 'npm ci' }, title: 'Test: Ticket 482 · try 1' });
  const [t] = store.triesOfRun(run.id);
  assert.equal(t.status, 'passed');
  assert.deepEqual([t.startCommit, t.diskBytes, t.changes.total, t.changes.counts.changed, t.setup.ok], [SHA, 123_456, 1, 1, true]);
  assert.equal('paths' in t.changes, false, 'the stored list has no second copy of the paths');
  assert.deepEqual(h.prepared, [ex.id]);
  assert.deepEqual(h.cleaned, [t.pipelineId], 'removed after its checks');
});

test('a setup that fails stops the test; the try is not a failed try (D55)', async () => {
  const ex = example();
  const h = harness({ setup: { cmd: 'npm ci', ok: false, exitCode: 1, timedOut: false, ms: 900, tail: 'npm error code EUSAGE' } });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason, done.stopDetail], ['stopped', 'setup', 'The setup step failed: npm ci ended with an error.']);
  const tries = store.triesOfRun(run.id);
  assert.ok(!tries.some((t) => t.status === 'failed'), 'no try counts as failed');
  const stopped = tries.find((t) => t.status === 'stopped');
  assert.equal(stopped.verdict, null);
  assert.equal(stopped.setup.tail, 'npm error code EUSAGE');
  assert.ok(h.cleaned.includes(stopped.pipelineId));
});

test('readiness and disk refuse a start with their sentences', async () => {
  const ex = example({ name: 'Ticket 497' }, null);
  const notReady = createTestRunner({ ...harness().deps, targetOf: async (_wf, _use, e) => ({ ready: false, reason: 'pick-project', text: leftOutText([e.name]) }) });
  await assert.rejects(notReady.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'NOT_READY', message: 'Ticket 497 is left out: pick its project first.' });
  const full = createTestRunner({ ...harness().deps, diskCheck: async () => ({ enough: false, text: 'Not enough free disk to start.' }) });
  await assert.rejects(full.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [example().id], tries: 1 }), { code: 'NO_DISK' });
  assert.equal(store.runningTestRun(WF), null, 'nothing was written');
});

test('a project that cannot be prepared stops the test as refused; the try waits for Finish the rest', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner({ ...h.deps, prepareProject: async () => { throw Object.assign(new Error('The project folder is missing'), { code: 'NOT_READY' }); } });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason, done.stopDetail], ['stopped', 'refused', 'The project folder is missing']);
  assert.equal(store.triesOfRun(run.id)[0].status, 'waiting');
});

test('phases while a try runs (board 35), and a stopped try is cleaned up too', async () => {
  const ex = example();
  const h = harness({ hold: true });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  let t;
  for (let i = 0; i < 200 && !(t = store.triesOfRun(run.id)[0]).runKey; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(runner.phaseOf(run.id, t.id).phase, 'working');
  h.entries.get(t.runKey).orch.state.setupStage = 'Running setup';
  assert.equal(runner.phaseOf(run.id, t.id).phase, 'setup');
  assert.equal(runner.diskOf(run.id).freeAtStart, 50 * 2 ** 30);
  await runner.stop(run.id);
  assert.ok(h.cleaned.includes(store.triesOfRun(run.id)[0].pipelineId));
  assert.equal(runner.phaseOf(run.id, t.id), null);
});

test('a restart stops a paused or interrupted test row, so its run folder is reclaimed', () => {
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test) VALUES ('feed0002', 'tickets-1a2b3c4d', 'interrupted', 1),
    ('feed0003', 'tickets-1a2b3c4d', 'paused', 1), ('feed0004', 'tickets-1a2b3c4d', 'paused', NULL)`).run();
  store.recoverInterruptedTestRuns();
  const st = (id) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status;
  assert.deepEqual([st('feed0002'), st('feed0003'), st('feed0004')], ['stopped', 'stopped', 'paused'], 'never a normal run');
});
