// test/workflow-test-criteria-runner.test.mjs — D91: a try's criteria are checked after its automatic checks, once per criterion and
// model; a reused try is checked in the criteria phase; a criterion edit never re-runs the workflow; the cost counts in the test's cap.
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
import { createCriteriaJudge, subjectOfTry } from '../src/core/workflow-tests/criteria-runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { recordTestJudgeCost } from '../src/core/cost-budget.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftcrun-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
const holders = new Set();
after(() => { for (const h of holders) clearInterval(h); });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const WF = 'wf_brief';
const TEXT = '## Success metric\n\nCut tickets by 60% within one quarter.';
/** The runner on a fake run handler (as test/workflow-test-runner.test.mjs), with a fake judge that costs $0.10 a call. */
function harness(over = {}) {
  const entries = new Map();
  let n = 0;
  const calls = [];
  const judge = createCriteriaJudge({
    subjectOf: async () => TEXT, contextOf: () => '',
    judgeCriterion: async ({ criterion, book }) => { calls.push(criterion); book(0.1, 'billed'); return { met: /metric/i.test(criterion), reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0.1, ms: 1 }; },
    book: (row) => recordTestJudgeCost(row),
    ...(over.judge || {}),
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
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    mockMode: () => false,
    pollMs: 5,
    ...(over.deps || {}),
  };
  return { deps, calls, started: () => n };
}
const example = (criteria) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1,
  basics: { noError: true, noHelp: false }, criteria, judge: { model: 'claude-haiku-4-5' } });
const waitDone = async (runner, id) => { for (let i = 0; i < 400 && store.readTestRun(id).status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 10)); };

test('a try is checked once per criterion after its checks; the cost counts in the test', async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await waitDone(runner, run.id);
  assert.deepEqual(h.calls, ['Names a success metric', 'Explains the legal reasons']);
  const [t] = store.triesOfRun(run.id);
  assert.deepEqual(cs.tryJudgements([t.id]).map((j) => [j.criterionId === ex.criteria[0].id, j.met]).sort(), [[false, false], [true, true]]);
  assert.equal(store.spentOfRun(run.id), 0.7, 'the try ($0.50) and two checks ($0.10 each)');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE test_run_id = ?').get(run.id).n, 2);
  assert.equal(store.costUnknownOfRun(run.id), false);
  recordTestJudgeCost({ workflowId: WF, testRunId: run.id, purpose: 'try', amountUsd: 0, costKind: 'unknown' });
  assert.equal(store.costUnknownOfRun(run.id), true, 'P4-Q17');
});

test('a new criterion re-checks the reused try in the criteria phase and never re-runs the workflow (D86)', async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(runner, first.id);
  store.updateExample(WF, ex.id, { criteria: [...ex.criteria, { text: 'Explains the legal reasons' }] });
  const second = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(runner, second.id);
  assert.equal(h.started(), 1, 'the second test reused the try');
  assert.deepEqual(h.calls, ['Names a success metric', 'Explains the legal reasons'], 'only the new criterion was asked');
  assert.equal(store.spentOfRun(second.id), 0.1, 'the second test paid only for its check');
});

test('M13: an unfinished try is never checked, and the criteria phase stops when asked or over the cap', async () => {
  const calls = [];
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {},
    judgeCriterion: async ({ criterion }) => { calls.push(criterion); return { met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }; } });
  const ex = example([{ text: 'Names a success metric' }]);
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status: 'stopped', pipelineId: 'p0000001' });
  assert.deepEqual(await judge.judgeTry(ex, store.readTry(t.id)), [], 'a stopped try is never checked');
  store.updateTry(t.id, { status: 'passed', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
  await judge.judgeMissing(store.readTestRun(run.id), { stopped: () => true });
  await judge.judgeMissing(store.readTestRun(run.id), { overCap: () => true });
  assert.deepEqual(calls, [], 'stopped, or over the cap: nothing asked');
  await judge.judgeMissing(store.readTestRun(run.id));
  assert.deepEqual(calls, ['Names a success metric']);
});

test('subjectOfTry: the result, and a project try\'s diff under its heading', async () => {
  const readMain = async () => ({ text: 'Fixed the rounding.' });
  assert.equal(await subjectOfTry({ pipelineId: 'p1' }, { readMain, readPatch: async () => ({ patch: 'diff' }) }), 'Fixed the rounding.');
  const both = await subjectOfTry({ pipelineId: 'p1', startCommit: 'abc' }, { readMain, readPatch: async () => ({ patch: '+ return cents;', cut: false }) });
  assert.match(both, /^Fixed the rounding\.\n\n--- The changes this try made to the project \(a git diff\) ---\n\+ return cents;$/);
});

test('every real judge call books its spend: the default book is recordTestJudgeCost (ledger row, purpose, model, run)', async () => {
  // No `book` override: createCriteriaJudge's own wiring must reach the ledger. A fake helperCall reports a cost (no real model call).
  const helperCall = async () => ({ text: JSON.stringify({ verdict: 'met', reason: 'r', proof: 'Cut tickets by 60%' }), costUsd: 0.25, costKind: 'billed' });
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '',
    judgeCriterion: (args) => import('../src/core/workflow-tests/judge.mjs').then((m) => m.judgeCriterion(args,
      { mock: () => false, budget: () => null, userSignIn: () => false, helperCall })) });
  const ex = example([{ text: 'Names a success metric' }]);
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
  const out = await judge.judgeTry(ex, store.readTry(t.id), { testRunId: run.id });
  assert.equal(out.length, 1);
  assert.equal(out[0].error, null, 'the fake call produced a real judgement');
  const rows = prepare('SELECT purpose, model, amount_usd, cost_kind, test_run_id, example_id FROM wf_test_judge_ledger').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ purpose: 'try', model: 'claude-haiku-4-5', amount_usd: 0.25, cost_kind: 'billed', test_run_id: run.id, example_id: ex.id }]);
  assert.equal(store.spentOfRun(run.id), 0.25);
});

const doneVerdict = { passed: true, facts: { status: 'done' }, basics: [], checks: [] };
function seedTry(ex, verdict, status = 'passed') {
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status, pipelineId: 'p0000001', verdict });
  return { run, t: store.readTry(t.id) };
}

test('a booking that fails after a paid call is logged with its amount, then thrown; the try still ends passed or failed', async () => {
  const lines = [];
  const orig = console.error; console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const h = harness({ judge: { book: () => { throw new Error('disk full'); } } });
    const ex = example([{ text: 'Names a success metric' }]);
    const runner = createTestRunner(h.deps);
    const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
    await waitDone(runner, run.id);
    const [t] = store.triesOfRun(run.id);
    assert.ok(t.status === 'passed' || t.status === 'failed', `the try ended ${t.status}`);
    assert.notEqual(store.readTestRun(run.id).status, 'running');
    const line = lines.find((l) => l.includes('spend not recorded'));
    assert.ok(line, `a log line says the spend was not recorded: ${lines.join(' | ')}`);
    for (const part of ['0.1', 'billed', 'claude-haiku-4-5', WF, ex.id, String(run.id)]) assert.ok(line.includes(part), `the line names ${part}: ${line}`);
  } finally { console.error = orig; }
});

test('the cap of the test holds between the two asks of a judge: an unreadable first reply, a cap reached, no second call', async () => {
  let replies = 0; let capped = false;
  const helperCall = async () => { replies += 1; capped = true; return { text: 'not json at all', costUsd: 0.3, costKind: 'billed' }; };
  const { judgeCriterion } = await import('../src/core/workflow-tests/judge.mjs');
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {},
    judgeCriterion: (args, d) => judgeCriterion(args, { ...d, mock: () => false, userSignIn: () => false, helperCall }) });
  const ex = example([{ text: 'Names a success metric' }]);
  const { run, t } = seedTry(ex, doneVerdict);
  const out = await judge.judgeTry(ex, t, { testRunId: run.id, overCap: () => capped });
  assert.equal(replies, 1, 'the second attempt was not made');
  assert.equal(out[0].error, 'limit');
});

test('the judge spend reaches the cap partway through the criteria of a try: the second is not asked and the test stops as cap', async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, capUsd: 0.55 });
  await waitDone(runner, run.id);
  assert.deepEqual(h.calls, ['Names a success metric']);
  const r = store.readTestRun(run.id);
  assert.equal(r.status, 'stopped');
  assert.equal(r.stopReason, 'cap');
});

test('a try Worca set aside, or whose run did not finish, is never judged', async () => {
  const calls = [];
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {},
    judgeCriterion: async ({ criterion }) => { calls.push(criterion); return { met: true, reason: 'r', proof: 'x', proofFound: true, error: null, costUsd: 0, ms: 1 }; } });
  const ex = example([{ text: 'Names a success metric' }]);
  const a = seedTry(ex, { worcaProblem: 'Worca could not run this try.', facts: { status: 'done' } }, 'failed');
  assert.deepEqual(await judge.judgeTry(ex, a.t, { testRunId: a.run.id }), []);
  const b = seedTry(ex, { passed: false, facts: { status: 'failed' }, basics: [], checks: [] }, 'failed');
  assert.deepEqual(await judge.judgeTry(ex, b.t, { testRunId: b.run.id }), []);
  assert.deepEqual(calls, [], 'the judge was never called');
});

test('a judgeCriteria that throws leaves the try passed or failed, and the test finishes', async () => {
  const orig = console.error; console.error = () => {};
  try {
    const h = harness({ deps: { judgeCriteria: async () => { throw new Error('boom'); } } });
    const ex = example([{ text: 'Names a success metric' }]);
    const runner = createTestRunner(h.deps);
    const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
    await waitDone(runner, run.id);
    const [t] = store.triesOfRun(run.id);
    assert.ok(t.status === 'passed' || t.status === 'failed');
    assert.equal(store.readTestRun(run.id).status, 'done');
  } finally { console.error = orig; }
});

test('the end of the criteria phase notifies, while the test still runs', async () => {
  const frames = [];
  let runner;
  const h = harness({ deps: { notify: (f) => { frames.push({ phase: runner.criteriaPhaseOf(f.testRunId), status: store.readTestRun(f.testRunId).status }); } } });
  const ex = example([{ text: 'Names a success metric' }]);
  runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await waitDone(runner, run.id);
  const at = frames.findIndex((f) => f.phase === true);
  assert.ok(at >= 0, 'the phase start notified');
  assert.ok(frames.slice(at + 1).some((f) => f.phase === false && f.status === 'running'), 'a frame after the phase ended, before the test did');
});
