// test/workflow-test-judge-stop.test.mjs — fix round 3, item B: Stop cuts checking short. The test's stop, and a stop of a
// criteria-only check ("Check them on these tries"), abort the checking model's call in flight; what it reported is booked (else a
// $0 row). Board 59 B: the call cut short is 'stopped' ("Not checked: you stopped the check"), and what the stop never reached reads
// "Not checked yet" ('pending' at the end of a test, no row after a criteria-only check). Fakes only.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { createCriteriaJudge } from '../src/core/workflow-tests/criteria-runner.mjs';
import { judgeCriterion, judgePair } from '../src/core/workflow-tests/judge.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { recordTestJudgeCost } from '../src/core/cost-budget.mjs';
import { criterionResult } from '../src/shared/workflow-tests/criteria-verdicts.mjs';

const homes = [];
let home;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'worca-cc-wftjstop-')); homes.push(home); _resetForTests(); process.env.WORCA_HOME = home; });
const holders = new Set();
after(() => { for (const h of holders) clearInterval(h); });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const WF = 'wf_stop';
const TEXT = '## Success metric\n\nCut tickets by 60% within one quarter.';
const SAFETY_MS = 20_000;
/**
 * A fake helperCall that waits until its signal aborts, then rejects as helperCall does (an AbortError carrying what the CLI
 * reported, or { 0, 'unknown' } when it reported nothing). Without a signal it would wait SAFETY_MS: a test that never aborts
 * fails on time, not hangs. `started` resolves at the first call.
 */
function waitingHelper({ reported = null } = {}) {
  const out = { calls: 0 };
  let go;
  out.started = new Promise((r) => { go = r; });
  out.helperCall = ({ signal }) => new Promise((_res, rej) => {
    out.calls += 1;
    go();
    const fail = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError', costUsd: reported ? reported.usd : 0, costKind: reported ? reported.kind : 'unknown' }));
    const t = setTimeout(() => rej(new Error('never aborted')), SAFETY_MS);
    if (!signal) return;
    if (signal.aborted) { clearTimeout(t); fail(); return; }
    signal.addEventListener('abort', () => { clearTimeout(t); fail(); }, { once: true });
  });
  out.d = { helperCall: (a) => out.helperCall(a), scratch: () => home, userSignIn: () => false, mock: () => false, budget: () => ({ blocked: false }) };
  return out;
}

test('judgeCriterion: an abort ends the call at once; the cost the CLI reported is booked, else a $0 unknown row', async () => {
  for (const [reported, want] of [[null, [0, 'unknown']], [{ usd: 0.02, kind: 'billed' }, [0.02, 'billed']]]) {
    const h = waitingHelper({ reported });
    const ctrl = new AbortController();
    const booked = [];
    const t0 = Date.now();
    const p = judgeCriterion({ criterion: 'Names a metric', subject: TEXT, model: 'm', signal: ctrl.signal, book: (u, k) => booked.push([u, k]) }, h.d);
    await h.started;
    ctrl.abort();
    const j = await p;
    assert.ok(Date.now() - t0 < 2000, 'ended at once, not at the safety timeout');
    assert.equal(j.error, 'failed');
    assert.equal(j.met, null);
    assert.deepEqual(booked, [want]);
    assert.equal(h.calls, 1, 'not asked a second time after the stop');
  }
});

test('judgeCriterion and judgePair: a signal already aborted makes no call and books nothing', async () => {
  const h = waitingHelper();
  const ctrl = new AbortController();
  ctrl.abort();
  const booked = [];
  const j = await judgeCriterion({ criterion: 'c', subject: TEXT, model: 'm', signal: ctrl.signal, book: (u, k) => booked.push([u, k]) }, h.d);
  assert.equal(j.error, 'failed');
  const p = await judgePair({ a: 'A', b: 'B', model: 'm', signal: ctrl.signal, book: (u, k) => booked.push([u, k]) }, h.d);
  assert.equal(p.error, 'failed');
  assert.equal(h.calls, 0);
  assert.deepEqual(booked, []);
});

/** The runner on a fake run handler (as workflow-test-criteria-runner.test.mjs); its checks go through the real judgeCriterion on `helper`. */
function harness(helper) {
  const entries = new Map();
  let n = 0;
  const judge = createCriteriaJudge({
    subjectOf: async () => TEXT, contextOf: () => '', book: (row) => recordTestJudgeCost(row),
    judgeCriterion: (args, o) => judgeCriterion(args, { ...helper.d, ...o }),
    judgePair: (args, o) => judgePair(args, { ...helper.d, ...o }),
  });
  const deps = {
    startRun: async (_body, { workflowTest }) => {
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0.5 };
      let finish; const launch = new Promise((r) => { finish = r; });
      const h = setInterval(() => {}, 60_000); holders.add(h);
      const e = { orch, launch, status: 'running', pipelineId };
      entries.set(runKey, e);
      workflowTest.onOrch(orch, { runKey });
      setImmediate(() => { e.status = 'done'; clearInterval(h); finish(); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async () => {},
    answer: () => true,
    outcomeOf: async (pipelineId) => ({ pipelineId, facts: { status: 'done', costUsd: 0.5, durationMs: 1, sentBack: 0, help: [], failReason: null },
      text: TEXT, name: 'result.md', source: 'work', files: ['work/result.md'] }),
    judge: (example, outcome) => checkTry(example, outcome),
    judgeCriteria: (ex, t, o) => judge.judgeTry(ex, t, o),
    judgeMissing: (run, o) => judge.judgeMissing(run, o),
    leaveUnchecked: (run, o) => judge.leaveUnchecked(run, o),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    mockMode: () => false,
    pollMs: 5,
  };
  return { deps };
}
const example = (criteria) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1,
  basics: { noError: true, noHelp: false }, criteria, judge: { model: 'claude-haiku-4-5' } });
const ledger = () => prepare('SELECT amount_usd AS u, cost_kind AS k FROM wf_test_judge_ledger ORDER BY id').all().map((r) => [Number(r.u), r.k]);
const shown = (j) => criterionResult({ id: 'c', text: 'c' }, j, null).value;

test("Stop testing cuts a try's check short: stop ends at once, the cut call is 'stopped', the rest 'pending', the stopped call is a $0 row", async () => {
  const helper = waitingHelper();
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const runner = createTestRunner(harness(helper).deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await helper.started;
  const t0 = Date.now();
  const stopped = await runner.stop(run.id);
  assert.ok(Date.now() - t0 < 2000, `Stop waited ${Date.now() - t0} ms for the model call`);
  assert.equal(stopped.status, 'stopped');
  assert.equal(helper.calls, 1, 'the second criterion is never asked');
  const [t] = store.triesOfRun(run.id);
  const js = cs.tryJudgements([t.id]);
  const byCriterion = (j) => ex.criteria.findIndex((c) => c.id === j.criterionId);
  js.sort((x, y) => byCriterion(x) - byCriterion(y));
  assert.deepEqual(js.map((j) => [j.met, j.error]), [[null, 'stopped'], [null, 'pending']], 'the first was out when Stop came; the second never asked');
  assert.deepEqual(js.map(shown), ['Not checked: you stopped the check', 'Not checked yet']);
  assert.deepEqual(ledger(), [[0, 'unknown']]);
});

test('Stop on a criteria-only check ("Check them on these tries") aborts its call at once and frees the workflow', async () => {
  const quick = waitingHelper();
  const ex = example([]);
  // A finished test with nothing to check, then a criterion added: the check of it on these tries waits on the model.
  const free = createTestRunner(harness({ d: { ...quick.d, helperCall: async () => ({ text: '', costUsd: 0, costKind: 'billed' }) } }).deps);
  const run = await free.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  for (let i = 0; i < 400 && store.readTestRun(run.id).status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.readTestRun(run.id).status, 'done');
  store.updateExample(WF, ex.id, { criteria: [{ text: 'Names a success metric' }] });
  const runner = createTestRunner(harness(quick).deps);
  const done = runner.checkCriteriaLater(store.readTestRun(run.id));
  await quick.started;
  assert.equal(runner.criteriaCheckOf(run.id), true);
  const t0 = Date.now();
  const back = await runner.stop(run.id);
  assert.ok(Date.now() - t0 < 2000, `Stop waited ${Date.now() - t0} ms for the model call`);
  assert.equal(runner.criteriaCheckOf(run.id), false, 'the workflow is free again');
  assert.deepEqual(back.checked, { done: 0, of: 1 }, 'board 59 C: the one try was cut short, so none of 1 was checked');
  await done;
  const [t] = store.triesOfRun(run.id);
  assert.deepEqual(cs.tryJudgements([t.id]).map((j) => [j.error, shown(j)]), [['stopped', 'Not checked: you stopped the check']]);
  assert.equal(store.readTestRun(run.id).status, 'done', 'the test itself stays as it ended');
  assert.deepEqual(ledger(), [[0, 'unknown']]);
});

/** A finished test whose criteria-only check reports `progress` and then waits for its stop. */
function waitingCheck(progress) {
  const ex = example([]);
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  prepare("UPDATE wf_test_runs SET status = 'done' WHERE id = ?").run(run.id);
  let began;
  const started = new Promise((r) => { began = r; });
  const runner = createTestRunner({ ...harness(waitingHelper()).deps,
    judgeMissing: (_r, o) => { o.onProgress(progress); began();
      return new Promise((r) => { if (o.signal.aborted) r(); else o.signal.addEventListener('abort', r, { once: true }); }); } });
  const done = runner.checkCriteriaLater(store.readTestRun(run.id));
  return { run, runner, done, started };
}

test('review M4: the line after a stop is never untrue: no count once every try was checked (a stop in the pairs), or with none to check', async () => {
  for (const progress of [{ done: 1, of: 1 }, { done: 0, of: 0 }, { done: 2, of: 2 }]) {
    const { run, runner, done, started } = waitingCheck(progress);
    await started;
    const back = await runner.stop(run.id, { only: 'criteria' });
    assert.equal(back.checked, null, `${progress.done} of ${progress.of}: the page shows its usual band`);
    await done;
  }
  const { run, runner, done, started } = waitingCheck({ done: 1, of: 3 });
  await started;
  assert.deepEqual((await runner.stop(run.id, { only: 'criteria' })).checked, { done: 1, of: 3 }, 'a real count stays');
  await done;
});

test('review M5: a stop sent by "Stop checking" ends only a criteria-only check, never the test itself', async () => {
  const ex = example([]);
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  assert.equal(store.readTestRun(run.id).status, 'running');
  const runner = createTestRunner(harness(waitingHelper()).deps);
  const back = await runner.stop(run.id, { only: 'criteria' });
  assert.equal(back.status, 'running', 'no criteria check runs: the run comes back unchanged');
  assert.equal(back.checked, undefined);
  assert.equal(store.readTestRun(run.id).status, 'running', 'the test was not closed');
});
