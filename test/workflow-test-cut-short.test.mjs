// test/workflow-test-cut-short.test.mjs — board 59 B (approved 2026-11-21): a check cut short. A person's Stop: "Not checked: you stopped
// the check" ('stopped', asked again later); the test's own cost cap: 'cap' ("Not checked: this test reached its cost limit", fix round 3
// review Minor 1); any other failure stays 'failed' ("the check did not run"); criteria never reached read "Not checked yet". Fakes only.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { createCriteriaJudge } from '../src/core/workflow-tests/criteria-runner.mjs';
import { withCriteriaFor, reasonOfCriterion } from '../src/core/workflow-tests/criteria-read.mjs';
import { criterionResult, RETRY_ERRORS } from '../src/shared/workflow-tests/criteria-verdicts.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftcut-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))); });

const WF = 'wf_cut';
const MODEL = 'claude-haiku-4-5';
const TEXT = '## Success metric\n\nCut tickets by 60% within one quarter.';
const example = (criteria) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 1,
  basics: { noError: true, noHelp: false }, criteria, judge: { model: MODEL } });
const doneVerdict = { passed: true, facts: { status: 'done' }, basics: [], checks: [] };
function seedTry(ex) {
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', verdict: doneVerdict });
  return { run, t: store.readTry(t.id) };
}
const cellOf = (j) => criterionResult({ id: 'k_x', text: 'x' }, j, null).value;
/** A judge whose call is cut short: the stop (`ctrl.abort()`) lands while the call is out, and the call comes back as an aborted call
 *  does (judge.mjs: { error: 'failed' }). */
const cutJudge = (ctrl) => createCriteriaJudge({ subjectOf: async () => TEXT, contextOf: () => '', book: () => {}, budget: () => ({ blocked: false }),
  judgeCriterion: async () => { if (ctrl) ctrl.abort(); return { met: null, reason: null, proof: null, proofFound: false, error: 'failed', detail: 'stopped', costUsd: 0, ms: 1 }; },
  judgePair: async () => { if (ctrl) ctrl.abort(); return { winner: null, reason: null, swapped: null, error: 'failed', costUsd: 0, ms: 1 }; } });

test('B: the shared words and the list of codes asked again', () => {
  assert.ok(RETRY_ERRORS.includes('stopped'), 'a stopped check is checked again on the next pass');
  assert.ok(RETRY_ERRORS.includes('pending'), 'a criterion a stop never reached is checked again on the next pass');
  const s = criterionResult({ id: 'k', text: 'x' }, { id: 1, met: null, error: 'stopped' }, null);
  assert.deepEqual([s.value, s.pending, s.decides], ['Not checked: you stopped the check', true, false]);
  const p = criterionResult({ id: 'k', text: 'x' }, { id: 2, met: null, error: 'pending' }, null);
  assert.deepEqual([p.value, p.pending, p.decides], ['Not checked yet', true, false]);
});

test("B: a call cut short by a person's Stop is 'stopped'; by the test's own cap 'cap'; by any other stop 'failed'", async () => {
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const cases = [
    [{ stopped: () => 'person' }, 'stopped', 'Not checked: you stopped the check'],
    [{ stopped: () => 'person', overCap: () => true }, 'cap', 'Not checked: this test reached its cost limit'],
    [{ stopped: () => 'cap' }, 'cap', 'Not checked: this test reached its cost limit'],
    [{ stopped: () => 'worca' }, 'failed', 'Not checked: the check did not run'],
    [{ stopped: () => true }, 'failed', 'Not checked: the check did not run'],
  ];
  for (const [o, code, words] of cases) {
    const { run, t } = seedTry(ex);
    const ctrl = new AbortController();
    const out = await cutJudge(ctrl).judgeTry(ex, t, { testRunId: run.id, signal: ctrl.signal,
      stopped: () => (ctrl.signal.aborted ? o.stopped() : null), overCap: () => ctrl.signal.aborted && !!(o.overCap && o.overCap()) });
    assert.deepEqual(out.map((j) => [j.error, cellOf(j)]), [[code, words]], JSON.stringify(o));
    assert.equal(cs.needsJudging(t.id, out[0].fp, MODEL), true, 'a later pass checks it again');
  }
  const { run, t } = seedTry(ex);
  const out = await cutJudge().judgeTry(ex, t, { testRunId: run.id });
  assert.deepEqual(out.map((j) => j.error), ['failed', 'failed'], 'a call that failed with no stop stays "the check did not run"');
});

test("B: a pair cut short by the test's own cap is 'cap', by a person's Stop 'stopped'", async () => {
  const ex = example([{ text: 'Names a success metric' }]);
  for (const [o, code] of [[{ overCap: () => true }, 'cap'], [{ stopped: () => 'person' }, 'stopped'], [{ stopped: () => 'error' }, 'failed']]) {
    const run = store.createTestRun({ workflowId: WF, kind: 'compare', a: 'draft', b: 'draft', aFp: 'f', bFp: 'f', exampleIds: [ex.id], tries: 1 });
    for (const side of ['a', 'b']) {
      const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'f', exampleFp: ex.fingerprint, tryNo: 1 });
      store.linkTry(run.id, t.id, side);
      store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', verdict: doneVerdict });
    }
    const ctrl = new AbortController();
    await cutJudge(ctrl).judgePairs(store.readTestRun(run.id), { signal: ctrl.signal,
      stopped: () => (ctrl.signal.aborted && o.stopped ? o.stopped() : null), overCap: () => ctrl.signal.aborted && !!(o.overCap && o.overCap()) });
    const tries = store.triesOfRun(run.id);
    const pair = cs.pairJudgement(tries.find((x) => x.side === 'a').id, tries.find((x) => x.side === 'b').id);
    assert.equal(pair && pair.error, code, JSON.stringify(Object.keys(o)));
  }
});

test("B: after a person's Stop, the criteria the stop never reached read \"Not checked yet\" and are still 'unchecked', not 'new'", async () => {
  const judge = cutJudge(null);
  const ex = example([{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }]);
  const { run, t } = seedTry(ex);
  judge.leaveUnchecked(run, { stopReason: 'person' });
  const js = cs.tryJudgements([t.id]);
  assert.deepEqual(js.map((j) => [j.met, j.error, cellOf(j)]), [[null, 'pending', 'Not checked yet'], [null, 'pending', 'Not checked yet']]);
  assert.deepEqual(ex.criteria.map((c) => reasonOfCriterion([t.id])(c.text)), ['unchecked', 'unchecked']);
  assert.equal(cs.needsJudging(t.id, js[0].fp, MODEL), true);
  // Any other stop keeps its code: the cap first, then 'failed'.
  const other = seedTry(ex);
  judge.leaveUnchecked(other.run, { stopReason: 'worca' });
  assert.deepEqual(cs.tryJudgements([other.t.id]).map((j) => j.error), ['failed', 'failed']);
  const capped = seedTry(ex);
  judge.leaveUnchecked(capped.run, { stopReason: 'person', overCap: () => true });
  assert.deepEqual(cs.tryJudgements([capped.t.id]).map((j) => j.error), ['cap', 'cap']);
});

test("B: \"you stopped the check\" shows on the test that was stopped; another test that reused the try reads \"Not checked yet\"", () => {
  const ex = example([{ text: 'Names a success metric' }]);
  const { run, t } = seedTry(ex);
  const other = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'f', exampleIds: [ex.id], tries: 1 });
  store.linkTry(other.id, t.id, 'b');
  cs.insertJudgement({ workflowId: WF, exampleId: ex.id, criterionId: ex.criteria[0].id, fp: cs.criterionFp(ex.criteria[0].text), model: MODEL,
    purpose: 'try', tryId: t.id, testRunId: run.id, j: { met: null, error: 'stopped' } });
  const words = (runId) => withCriteriaFor(WF, store.triesOfRun(runId), { runId })[0].verdict.criteria[0].value;
  assert.equal(words(run.id), 'Not checked: you stopped the check');
  assert.equal(words(other.id), 'Not checked yet');
});
