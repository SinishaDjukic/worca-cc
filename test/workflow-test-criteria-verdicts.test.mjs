// test/workflow-test-criteria-verdicts.test.mjs — D98: a try passes when its checks pass and every deciding criterion is met; a not
// checked or unreliable criterion never decides; an example that differs only in an unreliable criterion is named, not called worse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criterionResult, combinedStatus, withCriteria, unreliableOnly, notCheckedEverywhere, finishedTry } from '../src/shared/workflow-tests/criteria-verdicts.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const C = { id: 'k_1', text: 'Names a success metric' };
const reliable = { state: 'reliable', n: 20, agree: 19, decides: true };
const unreliable = { state: 'unreliable', n: 10, agree: 6, decides: false };
const J = (met, extra = {}) => ({ id: 9, met, reason: 'r', proof: 'p', proofFound: true, error: null, ...extra });

test('criterionResult: met, not met, not checked for each reason, and an unfinished try', () => {
  assert.deepEqual(criterionResult(C, J(false), reliable), { id: 'k_1', label: 'Names a success metric', trust: reliable, met: false, value: 'Not met',
    reason: 'r', proof: 'p', proofFound: true, judgementId: 9, decides: true, shadowDecides: true });
  assert.equal(criterionResult(C, J(true), unreliable).decides, false);
  assert.deepEqual([criterionResult(C, null, reliable).value, criterionResult(C, null, reliable).decides], ['Not checked yet', false]);
  assert.equal(criterionResult(C, J(null, { error: 'no-proof' }), reliable).value, "Not checked: Worca's proof was not in the result");
  assert.equal(criterionResult(C, J(null, { error: 'limit' }), reliable).pending, true);
  assert.equal(criterionResult(C, J(true), reliable, { finished: false }).value, 'Not checked: the try did not finish');
  assert.equal(criterionResult(C, J(false), reliable, { answer: false }).answer, false, "I9: the viewer's earlier answer, when given");
  assert.equal('answer' in criterionResult(C, J(false), reliable), false);
});

test('combinedStatus: a failed try stays failed; a passed one fails on a deciding miss; all = unreliable ones decide too', () => {
  const miss = criterionResult(C, J(false), unreliable);
  assert.equal(combinedStatus('passed', [criterionResult(C, J(false), reliable)]), 'failed');
  assert.equal(combinedStatus('passed', [miss]), 'passed');
  assert.equal(combinedStatus('passed', [miss], { all: true }), 'failed');
  assert.equal(combinedStatus('passed', [criterionResult(C, null, reliable)]), 'passed', 'not checked never fails a try');
  assert.equal(combinedStatus('failed', [criterionResult(C, J(true), reliable)]), 'failed');
  assert.equal(combinedStatus('stopped', []), 'stopped');
});

test('withCriteria and Compare: missed criteria are named, unreliable-only differences are not better or worse', () => {
  const v = (status) => ({ facts: { status: 'done' }, basics: [], checks: [] });
  const tries = [
    { id: 1, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: v() },
    { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: v() },
    { id: 3, side: 'a', exampleId: 2, status: 'passed', costUsd: 1, verdict: v() },
    { id: 4, side: 'b', exampleId: 2, status: 'passed', costUsd: 1, verdict: v() },
  ];
  const results = { 1: [criterionResult(C, J(true), reliable)], 2: [criterionResult(C, J(false), reliable)],
    3: [criterionResult({ id: 'k_2', text: 'Proposes a test' }, J(true), unreliable)], 4: [criterionResult({ id: 'k_2', text: 'Proposes a test' }, J(false), unreliable)] };
  const decorated = withCriteria(tries, (t) => results[t.id]);
  assert.deepEqual(decorated.map((t) => [t.status, t.checksStatus, t.shadowStatus]),
    [['passed', 'passed', 'passed'], ['failed', 'passed', 'failed'], ['passed', 'passed', 'passed'], ['passed', 'passed', 'failed']]);
  assert.ok(finishedTry(decorated[0]));
  const input = { examples: [{ id: 1, name: 'Bulk invoice export' }, { id: 2, name: 'Pricing page A/B test' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: decorated };
  const real = compareModel(input);
  assert.deepEqual(real.examples.map((r) => r.result), ['worse', 'same']);
  assert.match(JSON.stringify(real.examples[0].missedList), /Names a success metric/, 'the missed criterion is named (board 5)');
  const shadow = compareModel({ ...input, tries: decorated.map((t) => ({ ...t, status: t.shadowStatus ?? t.status })) });
  assert.deepEqual(unreliableOnly(real, shadow), [{ id: 2, name: 'Pricing page A/B test' }]);
  assert.deepEqual(withCriteria([tries[0]], () => null), [tries[0]], 'an example without criteria is untouched');
});

test('I6: a criterion decides for an example only when every finished try of both versions has a counted verdict', () => {
  const v = () => ({ facts: { status: 'done' }, basics: [], checks: [] });
  const tries = [{ id: 1, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: v() },
    { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: v() }];
  const results = { 1: [criterionResult(C, null, reliable)], 2: [criterionResult(C, J(false), reliable)] };   // A reused, never checked
  const decorated = withCriteria(tries, (t) => results[t.id]);
  assert.deepEqual(decorated.map((t) => t.status), ['passed', 'passed'], 'B is not failed on a criterion A was never checked on');
  assert.deepEqual([decorated[1].verdict.criteria[0].uneven, decorated[1].verdict.criteria[0].decides], [true, false]);
  const input = { examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: decorated };
  assert.deepEqual(compareModel(input).examples.map((r) => r.result), ['same']);
  assert.deepEqual(notCheckedEverywhere(decorated, input.examples), [{ id: 1, name: 'Bulk invoice export', criteria: ['Names a success metric'] }]);
  const noProof = withCriteria(tries, (t) => (t.id === 1 ? [criterionResult(C, J(null, { error: 'no-proof' }), reliable)] : results[2]));
  assert.deepEqual(noProof.map((t) => t.status), ['passed', 'passed'], 'an uncounted answer on one side only does not decide either');
  const both = withCriteria(tries, (t) => (t.id === 1 ? [criterionResult(C, J(true), reliable)] : results[2]));
  assert.deepEqual(both.map((t) => t.status), ['passed', 'failed'], 'checked on both sides: it decides');
  assert.deepEqual(notCheckedEverywhere(both, input.examples), []);
});

test('N2: a try whose run did not finish has no say in even checking; the criterion still decides on the finished tries', () => {
  const done = { facts: { status: 'done' }, basics: [], checks: [] };
  const errored = { facts: { status: 'error' }, basics: [], checks: [] };
  const tries = [{ id: 1, side: 'a', exampleId: 1, status: 'failed', costUsd: 1, verdict: errored },
    ...[2, 3].map((id) => ({ id, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: done })),
    ...[4, 5, 6].map((id) => ({ id, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: done }))];
  const res = (t) => [t.id === 1 ? criterionResult(C, null, reliable, { finished: false }) : criterionResult(C, J(t.side === 'a'), reliable)];
  const decorated = withCriteria(tries, res);
  assert.deepEqual(decorated.map((t) => t.status), ['failed', 'passed', 'passed', 'failed', 'failed', 'failed']);
  const input = { examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: decorated };
  assert.equal(compareModel(input).examples[0].result, 'worse', 'B misses it on all three finished tries');
  assert.deepEqual(notCheckedEverywhere(decorated, input.examples), []);
});

test('review (a): a criterion with no counted verdict on any finished try is listed as not checked, and a try that did not finish is not counted', () => {
  const done = { facts: { status: 'done' }, basics: [], checks: [] };
  const errored = { facts: { status: 'error' }, basics: [], checks: [] };
  const tries = [{ id: 1, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: done },
    { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: done },
    { id: 3, side: 'b', exampleId: 2, status: 'failed', costUsd: 1, verdict: errored }];
  const decorated = withCriteria(tries, (t) => [criterionResult(C, t.exampleId === 2 ? null : J(null, { error: 'limit' }), reliable, { finished: t.exampleId !== 2 })]);
  const examples = [{ id: 1, name: 'Bulk invoice export' }, { id: 2, name: 'Errored one' }];
  assert.deepEqual(notCheckedEverywhere(decorated, examples), [{ id: 1, name: 'Bulk invoice export', criteria: ['Names a success metric'] }]);
});

test('final review M6: the errors a later pass asks again are one list, shared by the store and the cells', async () => {
  const shared = await import('../src/shared/workflow-tests/criteria-verdicts.mjs');
  const cs = await import('../src/core/workflow-tests/criteria-store.mjs');
  assert.deepEqual(shared.RETRY_ERRORS, ['limit', 'cap', 'failed', 'stopped', 'pending']);   // board 59 B: a person's Stop
  assert.equal(cs.RETRY_ERRORS, shared.RETRY_ERRORS, 'the store uses the shared list, not a copy');
  for (const error of shared.RETRY_ERRORS) assert.equal(criterionResult(C, J(null, { error }), reliable).pending, true, error);
});
