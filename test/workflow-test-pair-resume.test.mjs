// test/workflow-test-pair-resume.test.mjs — fix round 3, item D (final review M8): a pair question the spending limit stops between its
// two asks keeps its first answer (on the row, with its cost row), so the next pass asks only the missing second order. Fakes only.
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
import { judgePair } from '../src/core/workflow-tests/judge.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { recordTestJudgeCost } from '../src/core/cost-budget.mjs';

const homes = [];
let home;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'worca-cc-wftpairres-')); homes.push(home); _resetForTests(); process.env.WORCA_HOME = home; });
const holders = new Set();
after(() => { for (const h of holders) clearInterval(h); });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

/** A counting fake helperCall: each ask answers `winners[i]` ("1" | "2" | "same") and costs $0.02. `open()` = how many asks the budget allows. */
function counting(winners) {
  const out = { calls: 0, allowed: Infinity };
  out.d = { scratch: () => home, userSignIn: () => false, mock: () => false, budget: () => ({ blocked: out.calls >= out.allowed }),
    helperCall: async () => { const w = winners[out.calls]; out.calls += 1; return { text: JSON.stringify({ winner: w, reason: `Result ${w} is clearer.` }), costUsd: 0.02, costKind: 'billed' }; } };
  return out;
}

test('judgePair: stopped by the limit after the first ask, it returns that answer; given back, only the second order is asked', async () => {
  const h = counting(['1', '2']);
  h.allowed = 1;
  const booked = [];
  const book = (u, k) => booked.push([u, k]);
  const one = await judgePair({ a: 'A text', b: 'B text', model: 'm', book }, h.d);
  assert.equal(one.error, 'limit');
  assert.deepEqual(one.first, { winner: 'first', reason: 'Result 1 is clearer.' }, 'the first answer comes back with the refusal');
  assert.equal(one.costUsd, 0.02);
  assert.equal(h.calls, 1);
  h.allowed = Infinity;
  const two = await judgePair({ a: 'A text', b: 'B text', model: 'm', book, first: one.first }, h.d);
  assert.equal(h.calls, 2, 'only the missing order was asked');
  assert.deepEqual([two.winner, two.swapped, two.costUsd, two.error], ['a', 'a', 0.02, null]);
  assert.equal(two.reason, 'result A is clearer.', "the kept first ask's words still name the sides");
  assert.deepEqual(booked, [[0.02, 'billed'], [0.02, 'billed']], 'each ask paid once');
});

const WF = 'wf_pair';
const TEXT = '## Success metric\n\nCut tickets by 60% within one quarter.';
function harness(helper) {
  const entries = new Map();
  let n = 0;
  const judge = createCriteriaJudge({
    subjectOf: async (t) => `${TEXT} (${t.side})`, contextOf: () => '', book: (row) => recordTestJudgeCost(row), budget: () => helper.d.budget(),
    judgeCriterion: async () => ({ met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0, ms: 1 }),
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
  return { deps, judge };
}

test('a test whose pair the limit stopped half way keeps the first answer and its cost row; the next pass asks only the second order', async () => {
  const helper = counting(['2', '1']);
  helper.allowed = 1;
  const { deps, judge } = harness(helper);
  const ex = store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1, basics: { noError: true, noHelp: false },
    criteria: [{ text: 'Names a success metric' }], judge: { model: 'claude-haiku-4-5' } });
  const runner = createTestRunner(deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false });
  for (let i = 0; i < 400 && store.readTestRun(run.id).status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 10));
  const tries = store.triesOfRun(run.id);
  const A = tries.find((t) => t.side === 'a'); const B = tries.find((t) => t.side === 'b');
  const stopped = cs.pairJudgement(A.id, B.id);
  assert.equal(stopped.error, 'limit');
  assert.deepEqual(stopped.variant.first, { winner: 'second', reason: 'Result 2 is clearer.' }, 'the first answer is kept on the row');
  assert.equal(stopped.costUsd, 0.02);
  assert.equal(stopped.testRunId, run.id);
  const ledger = () => prepare("SELECT amount_usd AS u FROM wf_test_judge_ledger WHERE purpose = 'pair'").all().map((r) => Number(r.u));
  assert.deepEqual(ledger(), [0.02], "the first ask's cost row stays");

  helper.allowed = Infinity;
  await judge.judgePairs(store.readTestRun(run.id));
  assert.equal(helper.calls, 2, 'the resume asked once, not both orders again');
  const done = cs.pairJudgement(A.id, B.id);
  assert.deepEqual([done.winner, done.error, done.costUsd], ['b', null, 0.02]);
  assert.deepEqual(ledger(), [0.02, 0.02], 'two asks, two cost rows: nothing paid twice');
  await judge.judgePairs(store.readTestRun(run.id));
  assert.equal(helper.calls, 2, 'a finished pair is never asked again');
});

/** A compare test of one example whose pair the helper's budget stops after `allowed` asks; returns its tries and judge. */
async function pairTest(helper, { capUsd = null } = {}) {
  const { deps, judge } = harness(helper);
  const ex = store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1, basics: { noError: true, noHelp: false },
    criteria: [{ text: 'Names a success metric' }], judge: { model: 'claude-haiku-4-5' } });
  const runner = createTestRunner(deps);
  const run = await runner.start({ workflowId: WF, kind: 'compare', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: false, capUsd });
  for (let i = 0; i < 400 && store.readTestRun(run.id).status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 10));
  const tries = store.triesOfRun(run.id);
  return { ex, run: store.readTestRun(run.id), judge, A: tries.find((t) => t.side === 'a'), B: tries.find((t) => t.side === 'b') };
}

test("fix round 4 (leftover 3): a pair the test's own cost cap stops half way is stored as 'cap', not 'limit', and keeps its first answer", async () => {
  const helper = counting(['2', '1']);
  // The two tries cost $0.50 each; the first ask ($0.02) reaches the cap of $1.01, so the second ask is refused by the cap.
  const { A, B } = await pairTest(helper, { capUsd: 1.01 });
  assert.equal(helper.calls, 1, 'the second order was not asked');
  const row = cs.pairJudgement(A.id, B.id);
  assert.equal(row.error, 'cap', "the test's own cap, not Worca's spending limit");
  assert.deepEqual(row.variant.first, { winner: 'second', reason: 'Result 2 is clearer.' }, 'the first answer is kept');
  assert.ok(cs.RETRY_ERRORS.includes(row.error), 'a later pass asks it again');
});

test('fix round 4 (Minor 2): the kept first answer is dropped when the liked result or the checking model changed: both orders are asked again', async () => {
  for (const change of ['liked', 'model']) {
    const helper = counting(['2', '1', '1', '2']);
    helper.allowed = 1;
    const { ex, run, judge, A, B } = await pairTest(helper);
    assert.deepEqual([helper.calls, cs.pairJudgement(A.id, B.id).error], [1, 'limit']);
    if (change === 'liked') cs.putLiked(ex.id, { name: 'brief.md', data: 'A brief we liked: cut tickets by 60%.' });
    else store.updateExample(WF, ex.id, { judge: { model: 'claude-opus-4-1' } });
    helper.allowed = Infinity;
    await judge.judgePairs(run);
    assert.equal(helper.calls, 3, `${change}: both orders asked again, not only the second`);
    const done = cs.pairJudgement(A.id, B.id);
    assert.equal(done.error, null, change);
    assert.equal(done.variant.first, undefined, `${change}: no kept answer carried over`);
    if (change === 'model') assert.equal(done.model, 'claude-opus-4-1');
    else assert.equal(done.variant.question, 'liked');
    _resetForTests();
    home = await mkdtemp(join(tmpdir(), 'worca-cc-wftpairres-')); homes.push(home); process.env.WORCA_HOME = home;
  }
});
