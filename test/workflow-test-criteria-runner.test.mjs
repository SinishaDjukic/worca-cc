// test/workflow-test-criteria-runner.test.mjs — D91: a try's criteria are checked after its automatic checks, once per criterion and
// model; a reused try is checked in the criteria phase; a criterion edit never re-runs the workflow; the cost counts in the test's cap.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare, getDb } from '../src/core/db.mjs';
import { judgeCallUsd, sideCheckPlan, checkUsdOf, criteriaPlanOf, reasonOfCriterion, needsCriteriaJudging } from '../src/core/workflow-tests/criteria-read.mjs';
import { estimateOf } from '../src/shared/workflow-tests/compare.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { createCriteriaJudge, subjectOfTry } from '../src/core/workflow-tests/criteria-runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { criterionResult } from '../src/shared/workflow-tests/criteria-verdicts.mjs';
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
    leaveUnchecked: (run, o) => judge.leaveUnchecked(run, o),
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

test('P4-M5: the criteria phase says how many earlier tries it checks, and how many are done (board 20\'s line)', async () => {
  const seen = [];
  let runner;
  const h = harness({ deps: { notify: (f) => { const p = runner.criteriaProgressOf(f.testRunId); if (p) seen.push(p); } } });
  const ex = example([{ text: 'Names a success metric' }]);
  runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(runner, first.id);
  store.updateExample(WF, ex.id, { criteria: [...ex.criteria, { text: 'Explains the legal reasons' }] });
  seen.length = 0;
  const second = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(runner, second.id);
  assert.deepEqual(seen, [{ done: 0, of: 1 }, { done: 1, of: 1 }], 'one reused try misses a criterion (fix round 1: no line while nothing is counted)');
  assert.equal(runner.criteriaProgressOf(second.id), null, 'none once the phase is over');
  // judgeMissing alone: a try that misses nothing is not counted.
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {},
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }) });
  const steps = [];
  await judge.judgeMissing(store.readTestRun(second.id), { onProgress: (p) => steps.push(p) });
  assert.deepEqual(steps, [{ done: 0, of: 0 }, null], 'nothing to check; the progress is cleared before the pairs');
});

test('fix round 1: a test with criteria and no reused tries shows no criteria phase line, nor while the pairs are asked', async () => {
  let runner = null;
  let runId = null;
  let last;
  const seen = [];
  const atPair = [];
  const h = harness({ deps: { notify: (f) => { const p = runner && runner.criteriaProgressOf(f.testRunId); if (p) seen.push(p); } } });
  const judge = createCriteriaJudge({ subjectOf: async (t) => `${TEXT} (${t.side})`, contextOf: () => '', book: () => {},
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }),
    judgePair: async () => { atPair.push([runner.criteriaProgressOf(runId), last]); return { winner: 'b', reason: 'r', swapped: 'b', costUsd: 0, error: null, ms: 1 }; } });
  h.deps.judgeCriteria = (e, t, o) => judge.judgeTry(e, t, o);
  h.deps.judgeMissing = (run, o) => judge.judgeMissing(run, o);
  const ex = example([{ text: 'Names a success metric' }]);
  runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false });
  runId = run.id;
  await waitDone(runner, run.id);
  assert.deepEqual(seen, [], 'both tries were checked as they ended: no "Checking your criteria on earlier tries"');
  assert.deepEqual(atPair.map((x) => x[0]), [null], 'no line while the pair is asked');
  // judgeMissing alone, with an earlier try to check and then a pair: the progress is cleared before the pair.
  prepare("DELETE FROM wf_test_judgements WHERE purpose = 'pair'").run();
  store.updateExample(WF, ex.id, { criteria: [...store.readExample(WF, ex.id).criteria, { text: 'Explains the legal reasons' }] });
  atPair.length = 0;
  await judge.judgeMissing(store.readTestRun(run.id), { onProgress: (p) => { last = p; } });
  assert.deepEqual(atPair.map((x) => x[1]), [null]);
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
  assert.equal(out[0].error, 'cap', "fix round 2: the test's own cap, not Worca's spending limit");
  assert.equal(cellOf(out[0]), 'Not checked: this test reached its cost limit');
});

/** The words a try's cell shows for a judgement row (P4-C2). */
const cellOf = (j) => criterionResult({ id: 'k_x', text: 'x' }, j, null).value;

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
  // Fix rounds 1, 2: the criterion the cap left gets a 'cap' row (no cost), so it reads 'unchecked', never 'new', and its cell names the cap.
  const [t] = store.triesOfRun(run.id);
  const left = cs.tryJudgements([t.id]).find((j) => j.fp === cs.criterionFp('Explains the legal reasons'));
  assert.deepEqual([left && left.error, left && left.met, left && left.costUsd], ['cap', null, 0]);
  assert.equal(cellOf(left), 'Not checked: this test reached its cost limit');
  assert.equal(reasonOfCriterion([t.id])('Explains the legal reasons'), 'unchecked');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE test_run_id = ?').get(run.id).n, 1, 'only the call that was made is booked');
});

test("fix round 4: Finish the rest after a cost-cap stop checks the criteria the cap left, and only those; no try is made again", async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, capUsd: 0.55 });
  await waitDone(runner, run.id);
  assert.deepEqual([store.readTestRun(run.id).stopReason, h.calls.length, h.started()], ['cap', 1, 1]);
  const [t] = store.triesOfRun(run.id);
  const legal = () => cs.tryJudgements([t.id]).find((j) => j.fp === cs.criterionFp('Explains the legal reasons'));
  assert.equal(legal().error, 'cap');
  await runner.continueRun(run.id, { capUsd: 2 });
  await waitDone(runner, run.id);
  const r = store.readTestRun(run.id);
  assert.deepEqual([r.status, r.stopReason], ['done', null]);
  assert.equal(h.started(), 1, 'the finished try is not made again');
  assert.deepEqual(h.calls, ['Names a success metric', 'Explains the legal reasons'], 'only the criterion the cap left was asked');
  assert.deepEqual([legal().met, legal().error, legal().testRunId], [false, null, run.id]);
  assert.equal(cellOf(legal()), 'Not met');
  assert.equal(store.spentOfRun(run.id), 0.7, 'the try and the two checks, each paid once');
});

test("fix round 1: Worca's spending limit refuses every check: no call, no booking, and each criterion reads 'unchecked', never 'new'", async () => {
  const { judgeCriterion } = await import('../src/core/workflow-tests/judge.mjs');
  let asked = 0;
  const h = harness({ judge: { budget: () => ({ blocked: true }), judgeCriterion: (args, d) => judgeCriterion({ ...args, mock: false }, { ...d, mock: () => false,
    helperCall: async () => { asked += 1; throw new Error('no paid call when refused'); } }) } });
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await waitDone(runner, run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
  const [t] = store.triesOfRun(run.id);
  assert.deepEqual(cs.tryJudgements([t.id]).map((j) => [j.criterionId, j.error, j.met, j.costUsd]).sort(),
    ex.criteria.map((c) => [c.id, 'limit', null, 0]).sort(), 'the first refused, the second never reached: both recorded');
  assert.deepEqual(cs.tryJudgements([t.id]).map(cellOf), ['Not checked: the spending limit is reached', 'Not checked: the spending limit is reached']);
  assert.equal(asked, 0);
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE test_run_id = ?').get(run.id).n, 0);
  const reasonOf = reasonOfCriterion([t.id]);
  assert.deepEqual(ex.criteria.map((c) => reasonOf(c.text)), ['unchecked', 'unchecked']);
  assert.equal(cs.needsJudging(t.id, cs.criterionFp('Explains the legal reasons'), 'claude-haiku-4-5'), true, 'a later pass still checks it');
});

test('fix round 1: leaveUnchecked records only what has no row yet, with the reason given; never a call or a booking', async () => {
  const calls = [];
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => { calls.push('book'); },
    judgeCriterion: async () => { calls.push('judge'); return { met: true, reason: 'r', proof: 'x', proofFound: true, error: null, costUsd: 0, ms: 1 }; } });
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const { run, t } = seedTry(ex, doneVerdict);
  const unfinished = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 2 });
  store.linkTry(run.id, unfinished.id, 'b');
  cs.insertJudgement({ workflowId: WF, exampleId: ex.id, criterionId: ex.criteria[0].id, fp: cs.criterionFp(ex.criteria[0].text), model: 'claude-haiku-4-5',
    purpose: 'try', tryId: t.id, j: { met: true, reason: 'r', proof: 'x', proofFound: true } });
  judge.leaveUnchecked(store.readTestRun(run.id), { error: 'failed' });
  judge.leaveUnchecked(store.readTestRun(run.id), { error: 'limit' });
  assert.deepEqual(cs.tryJudgements([t.id]).map((j) => [j.criterionId, j.met, j.error]).sort(),
    [[ex.criteria[0].id, true, null], [ex.criteria[1].id, null, 'failed']].sort(), 'the checked one is kept; the other recorded once, as the first call said');
  assert.deepEqual(cs.tryJudgements([unfinished.id]), [], 'an unfinished try is not checked, so nothing is recorded');
  assert.deepEqual(calls, []);
});

test("fix round 2: the cap reached in the criteria phase: the test ends done, and what it left reads 'cap', not the spending limit", async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(runner, first.id);
  store.updateExample(WF, ex.id, { criteria: [...ex.criteria, { text: 'Explains the legal reasons' }, { text: 'Gives a deadline' }] });
  const second = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true, capUsd: 0.1 });
  await waitDone(runner, second.id);
  assert.deepEqual([store.readTestRun(second.id).status, store.readTestRun(second.id).stopReason], ['done', null], 'the phase stops on overCap; the test ends done');
  const [t] = store.triesOfRun(second.id);
  const row = (text) => cs.tryJudgements([t.id]).find((j) => j.fp === cs.criterionFp(text));
  assert.equal(row('Explains the legal reasons').error, null, 'checked: its $0.10 reaches the $0.10 cap');
  assert.deepEqual([row('Gives a deadline').error, cellOf(row('Gives a deadline'))], ['cap', 'Not checked: this test reached its cost limit']);
});

test("fix round 2: a done test whose check threw: what it left reads 'failed' (the check did not run), not the spending limit", async () => {
  const orig = console.error; console.error = () => {};
  try {
    const h = harness({ judge: { budget: () => ({ blocked: false }), judgeCriterion: async () => { throw new Error('boom'); } } });
    const ex = example([{ text: 'Names a success metric' }]);
    const runner = createTestRunner(h.deps);
    const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
    await waitDone(runner, run.id);
    assert.equal(store.readTestRun(run.id).status, 'done');
    const [t] = store.triesOfRun(run.id);
    const [j] = cs.tryJudgements([t.id]);
    assert.deepEqual([j.error, cellOf(j)], ['failed', 'Not checked: the check did not run']);
  } finally { console.error = orig; }
});

test("fix round 2: leaveUnchecked's code from the state at the end: the test's cap, else Worca's spending limit, else failed; 'cap' is never a verdict", async () => {
  let blocked = false;
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {}, budget: () => ({ blocked }),
    judgeCriterion: async () => { throw new Error('never asked'); } });
  const ex = example([{ text: 'Names a success metric' }]);
  const codeOf = (o) => { const { run, t } = seedTry(ex, doneVerdict); judge.leaveUnchecked(run, o); return [t, cs.tryJudgements([t.id])[0]]; };
  assert.equal(codeOf({ overCap: () => true })[1].error, 'cap');
  blocked = true;
  assert.equal(codeOf({ overCap: () => true })[1].error, 'cap', 'the cap first');
  assert.equal(codeOf({ overCap: () => false })[1].error, 'limit');
  blocked = false;
  assert.equal(codeOf({})[1].error, 'failed');
  const [t, j] = codeOf({ overCap: () => true });
  assert.deepEqual([j.met, criterionResult({ id: 'k', text: 'x' }, j, null).pending, criterionResult({ id: 'k', text: 'x' }, j, null).decides], [null, true, false]);
  assert.ok(cs.RETRY_ERRORS.includes('cap'));
  assert.equal(cs.needsJudging(t.id, j.fp, 'claude-haiku-4-5'), true, 'a later pass checks it');
  assert.equal(needsCriteriaJudging(store.readExample(WF, ex.id), t), 1, 'and it is priced as a missing check');
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

test('I15: Check them on these tries holds the workflow busy, and stops at the test\'s own cost limit', async () => {
  const h = harness();
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, capUsd: 0.65 });
  await waitDone(runner, first.id);   // the try ($0.50) and its check ($0.10)
  store.updateExample(WF, ex.id, { criteria: [...ex.criteria, { text: 'Explains the legal reasons' }, { text: 'Names the users' }] });
  const job = runner.checkCriteriaLater(store.readTestRun(first.id));
  assert.equal(runner.criteriaCheckOf(first.id), true);
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }), { code: 'BUSY' });
  assert.throws(() => runner.checkCriteriaLater(store.readTestRun(first.id)), { code: 'BUSY' });
  await job;
  assert.equal(runner.criteriaCheckOf(first.id), false);
  assert.deepEqual(h.calls, ['Names a success metric', 'Explains the legal reasons'], 'at $0.70 the limit of $0.65 is reached: the third is not asked');
  assert.equal(store.spentOfRun(first.id), 0.7);
});

test('review (b): board 20\'s "So far" counts the combined status, as Compare does', async () => {
  const { progressOf } = await import('../src/core/workflow-tests/service.mjs');
  const h = harness({ judge: { judgeCriterion: async ({ book }) => { book(0.1, 'billed'); return { met: false, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0.1, ms: 1 }; } } });
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await waitDone(runner, run.id);
  assert.equal(store.triesOfRun(run.id)[0].status, 'passed', 'the checks alone pass it');
  const row = progressOf(WF, run.id).rows[0];
  assert.deepEqual([row.dots, row.summary], [['failed'], 'Done · 0 of 1 passed']);
});

test('judgeCallUsd: a $0 unknown-cost row is never a price; if any recent row is unknown the price is not known (M6)', () => {
  getDb();
  const row = (amountUsd, costKind) => recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'm-priced', amountUsd, costKind });
  row(0.1, 'billed'); row(0.3, 'billed');
  assert.equal(Math.round(judgeCallUsd('m-priced') * 1e6) / 1e6, 0.2);
  row(0, 'unknown'); row(0, 'unknown'); row(0, 'unknown');
  assert.equal(judgeCallUsd('m-priced'), null, 'the median of [0.1, 0.3, 0, 0, 0] would be $0; it is not known instead');
  recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'm-only-unknown', amountUsd: 0, costKind: 'unknown' });
  assert.equal(judgeCallUsd('m-only-unknown'), null);
});

test('the check has its own busy text; start, continueRun and a second press all say it (and the workflow reports checking)', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let holding = false;
  const h = harness();
  const real = h.deps.judgeMissing;
  h.deps.judgeMissing = (run, o) => (holding ? gate : real(run, o));
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await waitDone(runner, first.id);
  holding = true;
  const job = runner.checkCriteriaLater(store.readTestRun(first.id));
  const TEXT_CHECKING = 'Worca is checking your criteria on these tries. A test can start when it is done.';
  assert.equal(runner.criteriaCheckingOf(WF), true);
  assert.equal(runner.criteriaCheckingOf('wf_other'), false);
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }), { code: 'BUSY', message: TEXT_CHECKING });
  assert.throws(() => runner.checkCriteriaLater(store.readTestRun(first.id)), { code: 'BUSY', message: TEXT_CHECKING });
  store.updateTestRun(first.id, { status: 'stopped' });
  await assert.rejects(runner.continueRun(first.id), { code: 'BUSY', message: TEXT_CHECKING });
  release(); await job;
  assert.equal(runner.criteriaCheckingOf(WF), false);
});

/** Round 2: `n` finished tries of an example in a run, none of them checked yet. */
function triesOf(ex, n, { mock = false } = {}) {
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: n });
  const list = [];
  for (let i = 1; i <= n; i += 1) {
    const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: i, mock });
    store.linkTry(run.id, t.id, 'b');
    store.updateTry(t.id, { status: 'passed', pipelineId: `p000000${i}`, verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
    list.push(store.readTry(t.id));
  }
  return { run, list };
}
const priceHaiku = (usd) => { for (let i = 0; i < 3; i += 1) recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'claude-haiku-4-5', amountUsd: usd, costKind: 'billed' }); };

test('round 2: reused tries are priced per missing check at their own example\'s price, not at a diluted average (the reviewer\'s probe)', () => {
  getDb();
  priceHaiku(0.05);
  const withCriteria = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }, { text: 'Names the users' }]);
  const bare = [1, 2, 3].map(() => example([]));
  const { list } = triesOf(withCriteria, 3);
  const items = [{ ex: withCriteria, kept: list }, ...bare.map((ex) => ({ ex, kept: [] }))];
  const side = sideCheckPlan(items, 3);
  assert.equal(Math.round(side.withReuse * 1e6) / 1e6, 0.45, '9 missing checks x $0.05');
  const plan = { b: { want: 12, reusable: 3, perTryUsd: 0.5, checkUsd: side }, perTryMs: 1000, criteria: { pairsUsd: 0 } };
  const e = estimateOf(plan, { reuseB: true });
  assert.equal(Math.round(e.criteriaUsd * 100) / 100, 0.45 + 0, 'the new tries of the examples without criteria add nothing');
  const bareOnly = sideCheckPlan(bare.map((ex) => ({ ex, kept: [] })), 3);
  assert.deepEqual([bareOnly.fresh, bareOnly.withReuse], [0, 0], 'examples without criteria cost nothing');
  assert.equal(sideCheckPlan([{ ex: withCriteria, kept: list }], 3).fresh, 0.45, 'fresh: 3 tries x 3 criteria x $0.05');
  recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'claude-haiku-4-5', amountUsd: 0, costKind: 'unknown' });
  const unknown = sideCheckPlan(items, 3);
  assert.deepEqual([unknown.fresh, unknown.withReuse], [null, null], 'a price that is not known is not $0');
  assert.equal(estimateOf({ ...plan, b: { ...plan.b, checkUsd: unknown } }, { reuseB: true }).usd, null);
});

test('round 2: mock tries and mock plans cost nothing to check', () => {
  getDb();
  priceHaiku(0.05);
  const ex = example([{ text: 'Names a success metric' }]);
  const { run, list } = triesOf(ex, 2, { mock: true });
  assert.equal(checkUsdOf(WF, run), 0, 'mock tries are checked for free');
  assert.equal(sideCheckPlan([{ ex, kept: list }], 2).withReuse, 0, 'kept mock tries miss checks that cost nothing');
  assert.equal(sideCheckPlan([{ ex, kept: [] }], 2, { mock: true }).fresh, 0);
  assert.deepEqual(criteriaPlanOf(WF, [ex.id], { mock: true }), { pairsUsd: 0 });
  const real = triesOf(ex, 2);
  assert.equal(Math.round(checkUsdOf(WF, real.run) * 1e6) / 1e6, 0.1, 'real tries: 2 x $0.05');
});

test('round 3: an example unknown price makes its new tries unknown, but not its reused and fully checked ones', () => {
  getDb();
  priceHaiku(0.05);
  const a = example([{ text: 'Names a success metric' }]);
  const { list } = triesOf(a, 2);
  for (const t of list) cs.insertJudgement({ workflowId: WF, exampleId: a.id, criterionId: a.criteria[0].id, fp: cs.criterionFp('Names a success metric'),
    model: 'claude-haiku-4-5', purpose: 'try', tryId: t.id, j: { met: true, reason: 'r', proof: 'p', proofFound: true } });
  recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'claude-haiku-4-5', amountUsd: 0, costKind: 'unknown' });   // the price is no longer known
  const reused = sideCheckPlan([{ ex: a, kept: list }], 2);
  assert.deepEqual([reused.fresh, reused.withReuse], [null, 0], 'all reused and fully checked: nothing to pay, so known');
  const more = sideCheckPlan([{ ex: a, kept: list }], 3);
  assert.deepEqual([more.fresh, more.withReuse], [null, null], 'a new try needs the unknown price');
  const fresh = triesOf(example([{ text: 'Explains the legal reasons' }]), 1);   // a kept try that still misses a check
  assert.equal(sideCheckPlan([{ ex: store.readExample(WF, fresh.list[0].exampleId), kept: fresh.list }], 1).withReuse, null);
});

test('D100: one pair per compared example, blind (texts only), stored once; a second pass asks nothing', async () => {
  const h = harness();
  const seen = [];
  const judge = createCriteriaJudge({
    subjectOf: async (t) => `${TEXT} (${t.side})`, contextOf: () => '',
    judgeCriterion: async ({ book }) => { book(0.1, 'billed'); return { met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0.1, ms: 1 }; },
    judgePair: async (args) => { seen.push(args); return { winner: 'b', reason: 'r', swapped: 'b', costUsd: 0.04, error: null, ms: 1 }; },
    book: (row) => recordTestJudgeCost(row),
  });
  h.deps.judgeCriteria = (ex, t, o) => judge.judgeTry(ex, t, o);
  h.deps.judgeMissing = (run, o) => judge.judgeMissing(run, o);
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false });
  await waitDone(runner, run.id);
  const tries = store.triesOfRun(run.id);
  const A = tries.find((t) => t.side === 'a'); const B = tries.find((t) => t.side === 'b');
  const pairs = () => prepare("SELECT try_id, other_try_id, winner FROM wf_test_judgements WHERE purpose = 'pair'").all().map((r) => ({ ...r }));
  assert.deepEqual(pairs(), [{ try_id: A.id, other_try_id: B.id, winner: 'b' }]);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['a', 'b', 'book', 'context', 'liked', 'mock', 'model', 'signal'], 'blind: no version label reaches the question (signal: fix round 3, Stop)');
  assert.deepEqual([seen[0].a, seen[0].b], [`${TEXT} (a)`, `${TEXT} (b)`]);
  await judge.judgeMissing(store.readTestRun(run.id));
  assert.equal(seen.length, 1, 'asked once');
  assert.equal(pairs().length, 1);
});

test('D100: a pair call books nothing unless judgePair books; the real one books purpose pair through the default book (fails if it books nothing)', async () => {
  const helperCall = async () => ({ text: '{"winner":"1","reason":"Clearer."}', costUsd: 0.03, costKind: 'billed' });
  const { judgePair } = await import('../src/core/workflow-tests/judge.mjs');
  const judge = createCriteriaJudge({ subjectOf: async (t) => `${TEXT} (${t.side})`, contextOf: () => '',
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }),
    judgePair: (args, dd) => judgePair(args, { ...dd, mock: () => false, userSignIn: () => false, helperCall }) });
  const h = harness();
  h.deps.judgeCriteria = (e, t, o) => judge.judgeTry(e, t, o);
  h.deps.judgeMissing = (run, o) => judge.judgeMissing(run, o);
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false });
  await waitDone(runner, run.id);
  const rows = prepare("SELECT purpose, model, amount_usd, test_run_id, example_id FROM wf_test_judge_ledger WHERE purpose = 'pair' ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [0, 1].map(() => ({ purpose: 'pair', model: 'claude-haiku-4-5', amount_usd: 0.03, test_run_id: run.id, example_id: ex.id })));
});

test('D100: the test\'s cost limit reached stops the pair: no call, the pair stays to ask later', async () => {
  const h = harness();
  const calls = [];
  const judge = createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '',
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }),
    judgePair: async (args, dd) => { calls.push(dd.budget()); return { error: 'limit', winner: null, reason: null, swapped: null, costUsd: 0, ms: 1 }; } });
  h.deps.judgeCriteria = (e, t, o) => judge.judgeTry(e, t, o);
  h.deps.judgeMissing = (run, o) => judge.judgeMissing(run, o);
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false });
  await waitDone(runner, run.id);
  await judge.judgePairs(store.readTestRun(run.id), { overCap: () => true });
  assert.equal(calls.length, 1, 'only the first pass asked; an over-cap pass asks nothing');
  assert.equal(cs.pairJudgement(...store.triesOfRun(run.id).sort((x, y) => (x.side < y.side ? -1 : 1)).map((t) => t.id)).error, 'limit');
});

test('D100: pairOf gives the side by side its pair (winner, reason, question, the viewer\'s answer); none without one; a pair is priced from now on', async () => {
  const { pairOf } = await import('../src/core/workflow-tests/criteria-read.mjs');
  const ex = example([{ text: 'Names a success metric' }]);
  const run = store.createTestRun({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const mk = (side) => { const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: side, fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 }); store.linkTry(run.id, t.id, side); return t; };
  const A = mk('a'); const B = mk('b');
  assert.equal(pairOf(A, B), null);
  assert.equal(pairOf(null, B), null);
  const j = cs.insertJudgement({ workflowId: WF, exampleId: ex.id, fp: cs.pairFp(null), model: 'm', purpose: 'pair', tryId: A.id, otherTryId: B.id,
    variant: { question: 'better', swapped: 'b' }, j: { winner: 'b', reason: 'B is clearer.', costUsd: 0.04, ms: 1 } });
  cs.setAnswer(j.id, { agree: false, by: 'me' });
  assert.deepEqual(pairOf(A, B, { by: 'me' }), { judgementId: j.id, winner: 'b', reason: 'B is clearer.', question: 'better', answer: false });
  assert.equal(pairOf(A, B).answer, null);
  assert.deepEqual(cs.answersFor(WF, cs.pairFp(null), 'm'), [], 'a pair answer never counts toward trust');
  priceHaiku(0.05);
  const priced = criteriaPlanOf(WF, [ex.id], { hasA: true }).pairsUsd;
  assert.ok(typeof priced === 'number' && priced > 0, 'two calls per example are priced');
});

const likedOnly = () => { const e = example([]); cs.putLiked(e.id, { name: 'good.md', data: 'Good brief.' }); return e; };

test('fix 2: a liked-only example is priced for pairs, and the estimate is never $0 when every try is reused', () => {
  getDb();
  priceHaiku(0.05);
  const ex = likedOnly();
  const plan = criteriaPlanOf(WF, [ex.id], { hasA: true });
  assert.ok(plan && typeof plan.pairsUsd === 'number' && plan.pairsUsd > 0, 'pairs apply to a liked-only example');
  const side = { want: 1, reusable: 1, perTryUsd: 0.5, checkUsd: { fresh: 0, withReuse: 0 } };
  const e = estimateOf({ a: side, b: side, perTryMs: 1000, criteria: plan }, { reuseA: true, reuseB: true });
  assert.ok(e.usd > 0, 'every try reused, the pair is still asked');
  assert.equal(estimateOf({ a: side, b: side, perTryMs: 1000, criteria: { pairsUsd: null } }, { reuseA: true, reuseB: true }).usd, null);
  assert.equal(criteriaPlanOf(WF, [example([]).id], { hasA: true }), null, 'no criteria and nothing liked: no pairs');
});

test('fix 3: the pair price comes from pair ledger rows; without any, twice the try price; an unknown pair row makes it unknown', () => {
  getDb();
  priceHaiku(0.05);
  const ex = example([{ text: 'Names a success metric' }]);
  assert.equal(Math.round(criteriaPlanOf(WF, [ex.id], { hasA: true }).pairsUsd * 1e6) / 1e6, 0.1, 'fallback: 2 x the try price');
  for (const u of [0.02, 0.03, 0.04]) recordTestJudgeCost({ workflowId: WF, purpose: 'pair', model: 'claude-haiku-4-5', amountUsd: u, costKind: 'billed' });
  assert.equal(Math.round(criteriaPlanOf(WF, [ex.id], { hasA: true }).pairsUsd * 1e6) / 1e6, 0.06, '2 x the median pair call ($0.03)');
  recordTestJudgeCost({ workflowId: WF, purpose: 'pair', model: 'claude-haiku-4-5', amountUsd: 0, costKind: 'unknown' });
  assert.equal(criteriaPlanOf(WF, [ex.id], { hasA: true }).pairsUsd, null);
});

test('fix 4: pairTriesOf picks the first finished try of each side, as the runner does (try 1 unfinished is skipped)', async () => {
  const { pairTriesOf } = await import('../src/shared/workflow-tests/criteria-verdicts.mjs');
  const done = { facts: { status: 'done' } };
  const t = (id, side, tryNo, status, verdict) => ({ id, exampleId: 7, side, tryNo, status, verdict });
  const tries = [t(1, 'a', 1, 'error', null), t(2, 'a', 2, 'passed', done), t(3, 'b', 1, 'passed', done), t(4, 'b', 2, 'passed', done), t(5, 'a', 3, 'passed', done)];
  const { A, B } = pairTriesOf(tries, 7);
  assert.deepEqual([A.id, B.id], [2, 3]);
  assert.deepEqual(pairTriesOf(tries, 8), { A: null, B: null });
});
