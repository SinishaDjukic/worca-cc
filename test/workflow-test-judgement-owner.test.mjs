// test/workflow-test-judgement-owner.test.mjs — fix round 3, item C (final review M7): a judgement row records the test that wrote it
// (test_run_id). A cap or limit row says "this test reached its cost limit" / "the spending limit is reached" only on that test;
// an older test that owns the reused try shows what any criterion not checked yet shows. Fakes only, no model call.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { createCriteriaJudge } from '../src/core/workflow-tests/criteria-runner.mjs';
import { withCriteriaFor } from '../src/core/workflow-tests/criteria-read.mjs';
import { recoverTestsAtBoot } from '../src/core/workflow-tests/start.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { recordTestJudgeCost } from '../src/core/cost-budget.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftowner-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
const holders = new Set();
after(() => { for (const h of holders) clearInterval(h); });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const WF = 'wf_owner';
const TEXT = '## Success metric\n\nCut tickets by 60% within one quarter.';
/** The runner on a fake run handler; the fake judge says the spending limit is reached for any criterion in `limited`. */
function harness(limited = new Set()) {
  const entries = new Map();
  let n = 0;
  const judge = createCriteriaJudge({
    subjectOf: async () => TEXT, contextOf: () => '', book: (row) => recordTestJudgeCost(row),
    judgeCriterion: async ({ criterion, book }) => {
      if (limited.has(criterion)) return { met: null, reason: null, proof: null, proofFound: false, error: 'limit', costUsd: 0, ms: 1 };
      book(0.1, 'billed');
      return { met: true, reason: 'r', proof: 'Cut tickets by 60%', proofFound: true, error: null, costUsd: 0.1, ms: 1 };
    },
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
const example = (criteria) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1,
  basics: { noError: true, noHelp: false }, criteria, judge: { model: 'claude-haiku-4-5' } });
const waitDone = async (id) => { for (let i = 0; i < 400 && store.readTestRun(id).status === 'running'; i += 1) await new Promise((r) => setTimeout(r, 10)); };
/** label → the words a page shows for it on the run's tries, seen from `runId`. */
const words = (runId) => Object.fromEntries(withCriteriaFor(WF, store.triesOfRun(runId), { runId }).flatMap((t) => t.verdict.criteria.map((c) => [c.label, c.value])));

test("M7: a newer test's limit and cap rows on a reused try name the newer test; the older one shows them as not checked yet", async () => {
  const h = harness(new Set(['Explains the legal reasons']));
  const ex = example([{ text: 'Names a success metric' }]);
  const runner = createTestRunner(h.deps);
  const first = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(first.id);
  store.updateExample(WF, ex.id, { criteria: [...ex.criteria, { text: 'Explains the legal reasons' }] });
  const second = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: true });
  await waitDone(second.id);
  // The newer test then ends at its own cost limit with one more criterion it never checked (leaveUnchecked's 'cap').
  store.updateExample(WF, ex.id, { criteria: [...store.readExample(WF, ex.id).criteria, { text: 'Gives a deadline' }] });
  h.judge.leaveUnchecked(store.readTestRun(second.id), { overCap: () => true });

  const [t] = store.triesOfRun(first.id);
  assert.deepEqual(store.triesOfRun(second.id).map((x) => x.id), [t.id], 'the second test reused the first test\'s try');
  const rows = Object.fromEntries(cs.tryJudgements([t.id]).map((j) => [j.criterionId, [j.error, j.testRunId]]));
  const [metric, legal, deadline] = store.readExample(WF, ex.id).criteria.map((c) => c.id);
  assert.deepEqual(rows[metric], [null, first.id], 'a verdict records its test too');
  assert.deepEqual(rows[legal], ['limit', second.id]);
  assert.deepEqual(rows[deadline], ['cap', second.id]);

  assert.deepEqual(words(second.id), { 'Names a success metric': 'Met', 'Explains the legal reasons': 'Not checked: the spending limit is reached',
    'Gives a deadline': 'Not checked: this test reached its cost limit' });
  assert.deepEqual(words(first.id), { 'Names a success metric': 'Met', 'Explains the legal reasons': 'Not checked yet',
    'Gives a deadline': 'Not checked yet' }, 'the older test never reached a limit: it shows what any criterion not checked yet shows');
});

test('M7: a test a restart cut short at its own cost limit is recorded as cap, not failed, under its own id', async () => {
  const ex = example([{ text: 'Names a success metric' }]);
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1, capUsd: 0.5 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', costUsd: 0.5, verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
  recoverTestsAtBoot({ tmpDir: homes.at(-1) });
  assert.equal(store.readTestRun(run.id).status, 'stopped');
  assert.deepEqual(cs.tryJudgements([t.id]).map((j) => [j.error, j.testRunId]), [['cap', run.id]]);
  assert.deepEqual(words(run.id), { 'Names a success metric': 'Not checked: this test reached its cost limit' });
});
