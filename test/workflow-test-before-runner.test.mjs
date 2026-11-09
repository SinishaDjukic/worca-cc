// test/workflow-test-before-runner.test.mjs — workflow tests 3b, Task 10 (D75, D78): in a test, each project example's command
// runs once on its start point before any try; its result reaches the judge; a stop aborts it; the plan estimates it; the
// progress page sees it; Test a version knows when personal plugins are off.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { beforePlanOf } from '../src/core/workflow-tests/service.mjs';
import { connectorNotes } from '../src/core/workflow-tests/connectors.mjs';

const WF = 'wf_bprun';
const homes = [];
beforeEach(async () => { const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftbrun-')); homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const SHA = 'a'.repeat(40);
const pin = { key: 'tickets-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA, changes: null, setupCmd: 'npm ci' };
const TESTS = { format: 'tap', pass: ['adds', 'rounds'], fail: [], skip: [], passListed: true, counts: null, truncated: false };
const example = (checks = [{ kind: 'command', cmd: 'npm test' }], project = pin) => store.createExample(WF, { name: 'Ticket 482', request: 'Fix the rounding.', checks }, { project });

function harness({ beforeRun = null } = {}) {
  const entries = new Map();
  const started = []; const prepared = []; const befores = [];
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
      started.push(body.title);
      setImmediate(() => { orch.state.totalCostUsd = 0.5; e.end('done'); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { entries.get(k)?.end('stopped'); },
    answer: () => true,
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: 0.5, durationMs, sentBack: 0, help, failReason }, text: 'Fixed.', name: null, source: 'end-value',
        files: [], setup: { cmd: 'npm ci', ok: true, exitCode: 0, timedOut: false, ms: 1000, tail: '' }, logFile: null,
        project: { key: pin.key, checkoutDir: `/copy/${pipelineId}`, branch: 'b', runRoot: '/r', files: [], paths: [], touched: [], total: 0,
          counts: { added: 0, changed: 0, removed: 0 }, added: 0, removed: 0 } };
    },
    judge: (ex, outcome, o = {}) => checkTry(ex, outcome, { onCommand: o.onCommand, beforeOf: o.beforeOf,
      runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 4321,
        tests: { ...TESTS, pass: ['adds'], fail: ['rounds'] } }) }),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    prepareProject: async (ex) => { prepared.push(ex.id); return { copyDir: '/copy', startCommit: ex.project.startCommit }; },
    cleanupTry: async () => ({ removed: true, error: null }),
    measureDisk: async () => 1,
    freeDisk: async () => 50 * 2 ** 30,
    mockMode: () => false,
    pollMs: 5,
    beforeRun: beforeRun || (async (spec, { onPhase } = {}) => {
      befores.push(spec);
      if (onPhase) onPhase('command');
      return { ran: true, ok: true, exitCode: 0, timedOut: false, tests: TESTS, at: '2026-10-28T09:00:00.000Z', cached: false, ms: 2000 };
    }),
  };
  return { deps, started, prepared, befores };
}

test('before any try, each project example\'s command runs once on its start point; the judge classifies against it', async () => {
  const ex = example();
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(run.id);
  assert.equal(h.befores.length, 1, 'once for the example, whatever the tries and versions');
  assert.deepEqual(h.befores[0], { key: pin.key, startCommit: SHA, setupCmd: 'npm ci', cmd: 'npm test', timeoutMin: 10 });
  const tries = store.triesOfRun(run.id);
  assert.equal(tries.length, 6);
  for (const t of tries) {
    const c = t.verdict.checks[0];
    assert.deepEqual([c.before.level, c.before.broke, c.ms, c.failed], ['tests', { n: 1, names: ['rounds'] }, 4321, ['rounds']]);
  }
  assert.equal(store.lastCommandMs(ex.id, ex.checks[0].id), 4321);
  assert.equal(store.lastCommandMs(ex.id, 'c_none'), null);
});

test('no command check, no before run; an example without a project neither', async () => {
  const a = example([]);
  const b = store.createExample(WF, { name: 'Brief', request: 'Write it.' });
  const h = harness();
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [a.id, b.id], tries: 1 });
  await runner.idle(run.id);
  assert.deepEqual(h.befores, []);
});

test('a stop during the before run aborts it; no try starts; the progress page saw it', async () => {
  const ex = example();
  let seenSignal = null;
  let release;
  const held = new Promise((r) => { release = r; });
  const h = harness({ beforeRun: async (_spec, { signal, onPhase }) => {
    seenSignal = signal;
    onPhase('setup');
    await new Promise((r) => { signal.addEventListener('abort', r, { once: true }); held.then(r); });
    return { ran: false, reason: 'stopped' };
  } });
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  for (let i = 0; i < 200 && runner.beforeNowOf(run.id)?.phase !== 'setup'; i += 1) await new Promise((r) => setTimeout(r, 5));
  const now = runner.beforeNowOf(run.id);
  assert.deepEqual([now.exampleName, now.cmd, now.phase, now.n, now.of], ['Ticket 482', 'npm test', 'setup', 1, 1]);
  const stopped = await runner.stop(run.id);
  release();
  assert.equal(seenSignal.aborted, true);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(h.started, [], 'no try started');
  assert.equal(runner.beforeNowOf(run.id), null);
});

test('a project that cannot be used stops the test in the before phase, as a try would', async () => {
  const ex = example();
  const h = harness();
  h.deps.prepareProject = async () => { throw Object.assign(new Error('The project folder is missing.'), { code: 'NOT_READY' }); };
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const r = store.readTestRun(run.id);
  assert.deepEqual([r.status, r.stopReason, r.stopDetail], ['stopped', 'refused', 'The project folder is missing.']);
});

test('the plan: how many start points still need the command, and how long that takes', async () => {
  const ex1 = { id: 1, project: pin, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const ex2 = { id: 2, project: { ...pin, startCommit: 'b'.repeat(40) }, checks: [{ id: 'c_2', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const ex3 = { id: 3, project: null, checks: [] };
  const plan = (o) => beforePlanOf([ex1, ex2, ex3], { setupMsOf: () => 60_000, commandMsOf: () => 30_000, ...o });
  assert.deepEqual(await plan({ readKept: async () => null }), { runs: 2, ms: 180_000, cmd: 'npm test' });
  assert.deepEqual(await plan({ readKept: async (s) => (s.startCommit === SHA ? { ran: true } : null) }), { runs: 1, ms: 90_000, cmd: 'npm test' });
  assert.equal(await plan({ readKept: async () => ({ ran: true }) }), null, 'every one kept: nothing to say');
  assert.deepEqual(await plan({ readKept: async () => null, commandMsOf: () => null }), { runs: 2, ms: null, cmd: 'npm test' }, 'not measured yet');
  const mixed = await beforePlanOf([ex1, { ...ex2, checks: [{ id: 'c_3', kind: 'command', cmd: 'pytest', timeoutMin: 10 }] }],
    { readKept: async () => null, setupMsOf: () => 0, commandMsOf: () => 1 });
  assert.equal(mixed.cmd, null, 'several commands');
});

test('Test a version knows when the person\'s plugins are off (D70, D78)', () => {
  assert.equal(connectorNotes({ engines: ['claude'], mode: 'pretend' }).personalOff, true);
  assert.equal(connectorNotes({ engines: ['claude'], mode: 'real' }).personalOff, false);
  assert.equal(connectorNotes({ engines: ['codex'], mode: 'pretend' }).personalOff, false);
  assert.deepEqual(connectorNotes({ engines: ['claude', 'codex'], mode: 'pretend' }).engines, ['Codex']);
});

test('the before phase gives back the copy it held (U-T1): nothing stays busy after the test', async () => {
  const { holdCopy, _testing } = await import('../src/core/workflow-tests/project-copy.mjs');
  const ex = example();
  const h = harness();
  h.deps.prepareProject = async (e) => { holdCopy(e.project.key); return { copyDir: '/copy', startCommit: e.project.startCommit }; };
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  assert.equal(h.befores.length, 1);
  assert.equal(_testing.copyBusy(pin.key), false, 'the before phase and the try each released their hold');
});
