// test/workflow-test-criteria-report.test.mjs — board 12 (D99), boards 1 and 5's sentences, and board 4's estimate row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byCriterionModel, checkingCounts } from '../src/shared/workflow-tests/criteria-report.mjs';
import { checkingSentence, listTrustSentence, exactLine } from '../src/shared/workflow-tests/criteria-text.mjs';
import { estimateOf } from '../src/shared/workflow-tests/compare.mjs';

const R = { state: 'reliable', n: 20, agree: 19, decides: true };
const U = { state: 'unreliable', n: 10, agree: 6, decides: false };
const t = (id, side, exampleId, criteria, checks = []) => ({ id, side, exampleId, status: 'passed', verdict: { criteria, checks } });
const c = (id, met) => ({ id, met });

test('byCriterionModel: changed rows first and coloured only when they decide; all-met rows collapse; said checks are exact rows', () => {
  const examples = [
    { id: 1, name: 'Bulk invoice export', criteria: [{ id: 'k_1', text: 'Names a success metric' }], trust: { k_1: R },
      checks: [{ id: 'c_1', kind: 'mentions', text: '200', said: "Mentions that today's export stops at 200 invoices" }] },
    { id: 2, name: 'Pricing page A/B test', criteria: [{ id: 'k_2', text: 'Proposes a test within 4 weeks' }, { id: 'k_3', text: 'Names what is measured' }], trust: { k_2: U, k_3: R }, checks: [] },
  ];
  const tries = [
    t(1, 'a', 1, [c('k_1', true)], [c('c_1', true)]), t(2, 'a', 1, [c('k_1', true)], [c('c_1', true)]),
    t(3, 'b', 1, [c('k_1', false)], [c('c_1', true)]), t(4, 'b', 1, [c('k_1', false)], [c('c_1', true)]),
    t(5, 'a', 2, [c('k_2', true), c('k_3', true)]), t(6, 'b', 2, [c('k_2', false), c('k_3', false)]),
  ];
  const m = byCriterionModel({ examples, hasA: true, tries });
  assert.deepEqual(m.rows.map((r) => [r.label, r.changed, r.unreliableChange, r.a && `${r.a.met}/${r.a.of}`, `${r.b.met}/${r.b.of}`]), [
    ['Names a success metric', 'worse', false, '2/2', '0/2'],
    ['Names what is measured', 'worse', false, '1/1', '0/1'],
    ['Proposes a test within 4 weeks', null, true, '1/1', '0/1'],
  ]);
  assert.equal(m.more, 1, "the exact check met everywhere collapses into the 'more' line");
  // N8: Compare's even checking (I6) holds here too: an uneven criterion is not coloured worse, and is marked.
  const u = byCriterionModel({ examples: [examples[0]], hasA: true, tries: [
    t(1, 'a', 1, [{ id: 'k_1', met: true, uneven: true }]), t(2, 'a', 1, [{ id: 'k_1', met: null }]),
    t(3, 'b', 1, [{ id: 'k_1', met: false, uneven: true }]), t(4, 'b', 1, [{ id: 'k_1', met: false, uneven: true }])] });
  assert.deepEqual(u.rows.filter((r) => r.label === 'Names a success metric').map((r) => [r.changed, r.unreliableChange, r.uneven]), [[null, false, true]]);
  assert.deepEqual(checkingCounts([R, R, U, { state: 'confirm', decides: true }, { state: 'exact', decides: true }]),
    { total: 5, reliable: 3, unreliable: 1, waiting: 1 });
});

test('the sentences of boards 1, 2 and 5', () => {
  assert.equal(checkingSentence({ total: 12, reliable: 10, unreliable: 1, waiting: 1 }),
    "Worca's checking is reliable for 10 of 12 criteria. 1 unreliable criterion is shown, but does not decide better or worse.");
  assert.equal(listTrustSentence({ total: 12, reliable: 10, unreliable: 1, waiting: 1 }), 'Reliable for 10 of 12 criteria. 1 is unreliable, 1 needs your answers.');
  assert.equal(listTrustSentence({ total: 3, reliable: 3, unreliable: 0, waiting: 0 }), 'Reliable for 3 of 3 criteria.');
  assert.equal(exactLine({ kind: 'mentions', text: '200' }), 'Can be checked exactly: the result must contain "200".');
  assert.equal(exactLine({ kind: 'quotes' }), 'Can be checked exactly, without AI.');
});

test('estimateOf adds checking the criteria (board 4) and says when its price is not known', () => {
  const plan = { a: { want: 3, reusable: 3, perTryUsd: 1 }, b: { want: 3, reusable: 0, perTryUsd: 0.5 }, perTryMs: 60000, criteria: { perTryUsd: 0.1, pairsUsd: 0.2 } };
  const e = estimateOf(plan);
  assert.equal(Math.round(e.criteriaUsd * 100) / 100, 0.5, '3 new tries × $0.10 + the pairs $0.20');
  assert.equal(Math.round(e.usd * 100) / 100, 2);
  assert.deepEqual(['criteriaUsd', 'usd'].map((k) => estimateOf({ ...plan, criteria: { perTryUsd: null, pairsUsd: null } })[k]), [null, null], 'M6: the total is not known either');
  assert.equal(estimateOf({ ...plan, criteria: null }).criteriaUsd, 0);
});

test('estimateOf prices the checks of reused tries that still miss a criterion, never as $0 (review)', () => {
  const plan = { a: { want: 3, reusable: 3, judgeMissing: 3, perTryUsd: 1 }, b: { want: 3, reusable: 3, judgeMissing: 3, perTryUsd: 0.5 }, perTryMs: 60000,
    criteria: { perTryUsd: 0.1, pairsUsd: 0 } };
  const all = estimateOf(plan, { reuseA: true, reuseB: true });
  assert.equal(all.total, 0, 'every try is reused');
  assert.equal(Math.round(all.criteriaUsd * 100) / 100, 0.6, '6 reused tries × $0.10');
  assert.equal(Math.round(all.usd * 100) / 100, 0.6);
  assert.equal(estimateOf({ ...plan, criteria: { perTryUsd: null, pairsUsd: null } }, { reuseA: true, reuseB: true }).usd, null, 'not known, never $0');
  assert.equal(estimateOf({ ...plan, a: { ...plan.a, judgeMissing: 0 }, b: { ...plan.b, judgeMissing: 0 } }, { reuseA: true, reuseB: true }).usd, 0, 'nothing to check: $0 is true');
  const some = estimateOf(plan, { reuseA: true, reuseB: false });
  assert.equal(Math.round(some.criteriaUsd * 100) / 100, 0.6, '3 new tries of B + 3 reused of A');
});

test('review: an example whose tries all errored is not uneven; a finished try with no counted verdict is (the same finishedTry as Not checked)', () => {
  const ex = { id: 1, name: 'X', criteria: [{ id: 'k_1', text: 'Names a metric' }], trust: { k_1: R }, checks: [] };
  const tr = (id, side, status) => ({ id, side, exampleId: 1, status: 'passed', verdict: { facts: { status }, criteria: [c('k_1', null)], checks: [] } });
  const errored = byCriterionModel({ examples: [ex], hasA: true, tries: [tr(1, 'a', 'error'), tr(2, 'b', 'error')] });
  assert.deepEqual(errored.rows.map((r) => r.uneven), [false]);
  const finished = byCriterionModel({ examples: [ex], hasA: true, tries: [tr(1, 'a', 'done'), tr(2, 'b', 'done')] });
  assert.deepEqual(finished.rows.map((r) => r.uneven), [true]);
});
