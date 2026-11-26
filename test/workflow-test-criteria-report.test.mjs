// test/workflow-test-criteria-report.test.mjs — board 12 (D99), boards 1 and 5's sentences, and board 4's estimate row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byCriterionModel, checkingCounts, trustReportModel } from '../src/shared/workflow-tests/criteria-report.mjs';
import { TRUST_TESTS, trustTestLine, trustTestBadge, answersText, checkingSentence, listTrustSentence, exactLine } from '../src/shared/workflow-tests/criteria-text.mjs';
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

test('estimateOf adds checking the criteria (board 4) from each side checkUsd, and says when its price is not known', () => {
  const plan = { a: { want: 3, reusable: 3, perTryUsd: 1, checkUsd: { fresh: 0.3, withReuse: 0 } },
    b: { want: 3, reusable: 0, perTryUsd: 0.5, checkUsd: { fresh: 0.3, withReuse: 0.3 } }, perTryMs: 60000, criteria: { pairsUsd: 0.2 } };
  const e = estimateOf(plan);
  assert.equal(Math.round(e.criteriaUsd * 100) / 100, 0.5, 'B has 3 new tries $0.30 + the pairs $0.20; A is reused and fully checked');
  assert.equal(Math.round(e.usd * 100) / 100, 2);
  const unknown = { ...plan, b: { ...plan.b, checkUsd: { fresh: null, withReuse: null } } };
  assert.deepEqual(['criteriaUsd', 'usd'].map((k) => estimateOf(unknown)[k]), [null, null], 'M6: the total is not known either');
  assert.equal(estimateOf({ ...plan, criteria: null }).criteriaUsd, 0);
});

test('estimateOf prices the checks of reused tries that still miss a criterion, never as $0 (review)', () => {
  const plan = { a: { want: 3, reusable: 3, perTryUsd: 1, checkUsd: { fresh: 0.3, withReuse: 0.3 } }, b: { want: 3, reusable: 3, perTryUsd: 0.5, checkUsd: { fresh: 0.3, withReuse: 0.3 } },
    perTryMs: 60000, criteria: { pairsUsd: 0 } };
  const all = estimateOf(plan, { reuseA: true, reuseB: true });
  assert.equal(all.total, 0, 'every try is reused');
  assert.equal(Math.round(all.usd * 100) / 100, 0.6);
  assert.equal(estimateOf({ ...plan, a: { ...plan.a, checkUsd: { fresh: null, withReuse: null } } }, { reuseA: true, reuseB: true }).usd, null, 'not known, never $0');
  const done = { fresh: 0.3, withReuse: 0 };
  assert.equal(estimateOf({ ...plan, a: { ...plan.a, checkUsd: done }, b: { ...plan.b, checkUsd: done } }, { reuseA: true, reuseB: true }).usd, 0, 'nothing to check: $0 is true');
  assert.equal(Math.round(estimateOf(plan, { reuseA: true, reuseB: false }).criteriaUsd * 100) / 100, 0.6, 'B is tried again (fresh $0.30) and A reused ($0.30)');
});

test('review: an example whose tries all errored is not uneven; a finished try with no counted verdict is (the same finishedTry as Not checked)', () => {
  const ex = { id: 1, name: 'X', criteria: [{ id: 'k_1', text: 'Names a metric' }], trust: { k_1: R }, checks: [] };
  const tr = (id, side, status) => ({ id, side, exampleId: 1, status: 'passed', verdict: { facts: { status }, criteria: [c('k_1', null)], checks: [] } });
  const errored = byCriterionModel({ examples: [ex], hasA: true, tries: [tr(1, 'a', 'error'), tr(2, 'b', 'error')] });
  assert.deepEqual(errored.rows.map((r) => r.uneven), [false]);
  const finished = byCriterionModel({ examples: [ex], hasA: true, tries: [tr(1, 'a', 'done'), tr(2, 'b', 'done')] });
  assert.deepEqual(finished.rows.map((r) => r.uneven), [true]);
});

test("trustReportModel: board 13's tiles, the six tests and what to do", () => {
  const criteria = [
    { exampleId: 1, exampleName: 'Bulk', criterionId: 'k_1', text: 'Names a success metric', trust: { state: 'reliable', n: 20, agree: 19, decides: true } },
    { exampleId: 2, exampleName: 'Pricing', criterionId: 'k_2', text: 'Proposes a test within 4 weeks', trust: { state: 'unreliable', n: 10, agree: 6, decides: false } },
    { exampleId: 3, exampleName: 'GDPR', criterionId: 'k_3', text: 'Explains the legal reason', trust: { state: 'confirm', n: 0, agree: 0, decides: true } },
  ];
  const rounds = [
    { criterionText: 'Names a success metric', cards: [{ planted: null, met: true }, { planted: 'number removed', met: false }, { planted: 'x', met: false }, { planted: 'y', met: false }],
      same: { n: 4, of: 4 }, padding: { n: 4, of: 4 } },
    { criterionText: 'Proposes a test within 4 weeks', cards: [{ planted: null, met: true }, { planted: 'a', met: true }, { planted: 'b', met: true }, { planted: 'c', met: false }],
      same: { n: 3, of: 4 }, padding: { n: 4, of: 4 } },
  ];
  const m = trustReportModel({ criteria, rounds, pairs: [{ winner: 'a', swapped: 'a' }, { winner: 'unsure', swapped: 'b' }], proofs: { found: 214, of: 216 } });
  assert.deepEqual(m.tiles.agree, { n: 30, agree: 25 });
  assert.deepEqual(m.tiles.planted, { caught: 4, of: 6, missedOn: ['Proposes a test within 4 weeks'] });
  assert.deepEqual(m.tiles.trusted, { n: 1, of: 3, unreliable: 1, waiting: 1 });
  // fix round 1: order and proof are good from AGREE_MIN (80%), as board 13 draws 214 of 216 proofs; 1 of 2 pairs (50%) is below it
  assert.deepEqual(m.tests.map((t) => [t.key, t.state]), [['planted', 'bad'], ['again', 'bad'], ['order', 'bad'], ['longer', 'good'], ['proof', 'good'], ['people', 'good']]);
  assert.deepEqual(m.todo.map((x) => [x.kind, x.text]), [['fix', 'Proposes a test within 4 weeks'], ['confirm', 'Explains the legal reason']]);
  assert.equal(m.state, 'ready');
});

test('trustReportModel: the early states (P4-M4) and the words of each test', () => {
  const none = trustReportModel({});
  assert.equal(none.state, 'no-criteria');
  assert.ok(none.tests.every((t) => t.state === 'none'));
  assert.deepEqual(none.tiles.agree, { n: 0, agree: 0 });
  const waiting = trustReportModel({ criteria: [{ exampleId: 1, exampleName: 'A', criterionId: 'k_1', text: 'T', trust: { state: 'collecting', n: 0, agree: 0, decides: true } }] });
  assert.equal(waiting.state, 'no-answers');
  assert.equal(waiting.tiles.trusted.waiting, 1);
  const some = trustReportModel({ criteria: [{ exampleId: 1, exampleName: 'A', criterionId: 'k_1', text: 'T', trust: { state: 'collecting', n: 3, agree: 3, decides: true } }] });
  assert.equal(some.state, 'ready');
  assert.equal(some.colleagues, false);   // Part 5 brings colleagues' data; the tile's sub-line is "of N answers"
  assert.equal(trustTestLine({ key: 'people', state: 'waiting', n: 3, agree: 3, pct: 100 }), '100% · of 3 answers (Worca needs 10)');   // user decision 5
  assert.equal(trustTestLine({ key: 'planted', state: 'none' }), 'Not run yet');
  assert.equal(trustTestLine({ key: 'planted', state: 'bad', caught: 4, of: 6, missedOn: ['A', 'B'] }), '4 of 6 caught. Missed on "A", "B".');
  assert.equal(TRUST_TESTS.order[0], 'Order swapped');
});

test('trustReportModel fix round 1: a shared criterion counts once; below 10 answers the people test waits; empty repeats are left out', () => {
  const shared = { state: 'collecting', n: 6, agree: 6, decides: true };
  const row = (id) => ({ exampleId: id, exampleName: `E${id}`, criterionId: `k_${id}`, text: 'Same words', trust: shared, trustKey: 'fp|model' });
  const m = trustReportModel({ criteria: [row(1), row(2)] });
  assert.deepEqual(m.tiles.agree, { n: 6, agree: 6 });   // not 12
  assert.equal(m.tests.find((t) => t.key === 'people').state, 'waiting');   // 100% of 6 is waiting, never bad (user decision 5: its line says so)
  const ten = trustReportModel({ criteria: [{ ...row(1), trust: { state: 'unreliable', n: 10, agree: 7, decides: false } }] });
  assert.equal(ten.tests.find((t) => t.key === 'people').state, 'bad');
  const rounds = [{ criterionText: 'A', cards: [], same: { n: 0, of: 0 }, padding: { n: 0, of: 0 } }];
  const r = trustReportModel({ criteria: [row(1)], rounds });
  assert.equal(r.tests.find((t) => t.key === 'again').state, 'none');
  assert.equal(r.tests.find((t) => t.key === 'longer').state, 'none');
});

test("trustReportModel: the people test compares the true share, so 79.6% is not rounded up to a pass", () => {
  const people = (n, agree) => trustReportModel({ criteria: [{ trustKey: 'k', trust: { n, agree } }] }).tests.find((t) => t.key === 'people');
  assert.notEqual(people(250, 199).state, 'good', '199 of 250 is 79.6%');
  assert.equal(people(250, 200).state, 'good', '200 of 250 is 80%');
});

// ---- Task 23 (boards 13, 1; P4-M4; user decisions 4 and 5) ----
test('user decision 5: the people test with 1 to 9 answers shows the real numbers and what Worca needs; none reads Not run yet', () => {
  const people = (n, agree) => trustReportModel({ criteria: [{ trustKey: 'k', trust: { state: 'collecting', n, agree } }] }).tests.find((t) => t.key === 'people');
  assert.equal(people(0, 0).state, 'none');
  assert.equal(people(6, 6).state, 'waiting');
  assert.equal(trustTestLine(people(6, 6)), '100% · of 6 answers (Worca needs 10)');
  assert.equal(trustTestLine(people(1, 0)), '0% · of 1 answer (Worca needs 10)');
  assert.equal(trustTestLine(people(14, 12)), '86% of 14 answers', 'P4-M4: test 6 with 10 or more answers');
  assert.equal(trustTestLine(people(0, 0)), 'Not run yet');
});

test("user decision 4: a test that found a problem has a count badge (board 13's \"2 missed\", \"1 changes\"); good is green, nothing yet grey", () => {
  assert.deepEqual(trustTestBadge({ key: 'planted', state: 'bad', caught: 10, of: 12, missedOn: ['A'] }), ['badge red', '2 missed']);
  assert.deepEqual(trustTestBadge({ key: 'again', state: 'bad', n: 11, of: 12 }), ['badge red', '1 changes']);
  assert.deepEqual(trustTestBadge({ key: 'order', state: 'bad', n: 13, of: 18 }), ['badge red', '5 changes']);
  assert.deepEqual(trustTestBadge({ key: 'longer', state: 'bad', fooled: 2 }), ['badge red', '2 fooled']);
  assert.deepEqual(trustTestBadge({ key: 'proof', state: 'bad', n: 150, of: 216 }), ['badge red', '66 without proof']);
  assert.deepEqual(trustTestBadge({ key: 'proof', state: 'good', n: 214, of: 216 }), ['badge green', 'Good'], 'the count shows only when the test is bad');
  assert.deepEqual(trustTestBadge({ key: 'people', state: 'bad', n: 10, agree: 7, pct: 70 }), ['badge red', '3 disagree']);
  assert.deepEqual(trustTestBadge({ key: 'proof', state: 'good', n: 4, of: 4 }), ['badge green', 'Good']);
  assert.deepEqual(trustTestBadge({ key: 'planted', state: 'none' }), ['badge', 'Not run yet']);
  assert.deepEqual(trustTestBadge({ key: 'people', state: 'waiting', n: 6, agree: 6, pct: 100 }), ['badge', 'Needs your answers']);
});

test('boards 13 and P4-M4: the planted line says "Both missed on" when two misses share one criterion; the people words quote Check the checker', () => {
  assert.equal(trustTestLine({ key: 'planted', state: 'bad', caught: 10, of: 12, missedOn: ['Asks which part matters most before writing'] }),
    '10 of 12 caught. Both missed on "Asks which part matters most before writing".');
  assert.equal(trustTestLine({ key: 'planted', state: 'bad', caught: 11, of: 12, missedOn: ['A'] }), '11 of 12 caught. Missed on "A".');
  assert.equal(trustTestLine({ key: 'planted', state: 'bad', caught: 9, of: 12, missedOn: ['A', 'A'] }), '9 of 12 caught. Missed on "A".', 'one criterion named once');
  assert.equal(TRUST_TESTS.people[1], 'From your Agree and Disagree answers and "Check the checker".');
});

test("the planted test's words are true of a real round: the criterion is broken everywhere; Worca's own simple mistakes only in mock mode", () => {
  const words = TRUST_TESTS.planted[1];
  assert.match(words, /no longer true anywhere in it/);
  assert.match(words, /In mock mode Worca makes simple mistakes itself/);
  assert.doesNotMatch(words, /adds a made-up quote/, 'a real round never adds a made-up quote of its own');
});

test("the trusted tile counts as board 1's card does: an exact check made from a criterion counts as reliable; a criterion with no model is left out", () => {
  const crit = (state) => ({ exampleId: 1, exampleName: 'A', criterionId: `k_${state}`, text: state, trust: state ? { state, n: 0, agree: 0 } : null });
  const m = trustReportModel({ criteria: [crit('reliable'), crit('unreliable'), crit('confirm'), crit(null)], exactChecks: 2 });
  assert.deepEqual(m.tiles.trusted, { n: 3, of: 5, unreliable: 1, waiting: 1 });
  assert.deepEqual(checkingCounts([{ state: 'reliable' }, { state: 'unreliable' }, { state: 'confirm' }, null, { state: 'exact' }, { state: 'exact' }]),
    { total: 5, reliable: 3, unreliable: 1, waiting: 1 }, 'the same numbers as the card');
});

// ---- Task 23 fix round 1 ----
test('fix round 1: order and proof are good from AGREE_MIN (board 13: 17 of 18 pairs, 214 of 216 proofs) and bad below it; the others stay strict', () => {
  const pairs = (same, of) => Array.from({ length: of }, (_, i) => ({ winner: i < same ? 'a' : 'unsure' }));
  const st = (input, key) => trustReportModel(input).tests.find((t) => t.key === key).state;
  assert.equal(st({ pairs: pairs(17, 18) }, 'order'), 'good');
  assert.equal(st({ pairs: pairs(8, 10) }, 'order'), 'good', '80% is the bar');
  assert.equal(st({ pairs: pairs(7, 10) }, 'order'), 'bad');
  assert.equal(st({ proofs: { found: 214, of: 216 } }, 'proof'), 'good');
  assert.equal(trustTestLine({ key: 'proof', state: 'good', n: 214, of: 216 }), '214 of 216 verdicts had proof. 2 were not counted.');
  assert.equal(st({ proofs: { found: 150, of: 216 } }, 'proof'), 'bad');
  assert.equal(st({ proofs: { found: 0, of: 0 } }, 'proof'), 'none');
  const round = (miss, same, pad) => ({ criterionText: 'A', cards: [{ planted: 'x', met: miss }, ...Array.from({ length: 9 }, () => ({ planted: 'y', met: false }))],
    same: { n: same, of: 4 }, padding: { n: pad, of: 4 } });
  assert.equal(st({ rounds: [round(true, 4, 4)] }, 'planted'), 'bad', 'one miss in 10 is still a problem');
  assert.equal(st({ rounds: [round(false, 3, 4)] }, 'again'), 'bad');
  assert.equal(st({ rounds: [round(false, 4, 3)] }, 'longer'), 'bad');
});

test('fix round 1: a workflow whose criteria all became exact checks is ready (the card shows), not "No criteria yet"; no answers yet needs criteria that wait', () => {
  const exactOnly = trustReportModel({ exactChecks: 2 });
  assert.equal(exactOnly.state, 'ready');
  assert.deepEqual(exactOnly.tiles.trusted, { n: 2, of: 2, unreliable: 0, waiting: 0 });
  assert.equal(trustReportModel({}).state, 'no-criteria');
  const noModel = trustReportModel({ criteria: [{ exampleId: 1, exampleName: 'A', criterionId: 'k_1', text: 'T', trust: null }] });
  assert.equal(noModel.state, 'ready', 'nothing waits for answers: no blue box');
  assert.equal(trustReportModel({ criteria: [{ exampleId: 1, criterionId: 'k_1', text: 'T', trust: { state: 'confirm', n: 0, agree: 0 } }] }).state, 'no-answers');
});

test('fix round 1: What to do names a criterion shared by two examples once (its trust key), with the first example', () => {
  const t = { state: 'unreliable', n: 10, agree: 6 };
  const m = trustReportModel({ criteria: [
    { exampleId: 1, exampleName: 'A', criterionId: 'k_1', text: 'Same', trust: t, trustKey: 'fp|m' },
    { exampleId: 2, exampleName: 'B', criterionId: 'k_9', text: 'Same', trust: t, trustKey: 'fp|m' },
    { exampleId: 3, exampleName: 'C', criterionId: 'k_3', text: 'Other', trust: { state: 'confirm', n: 0, agree: 0 } },
    { exampleId: 4, exampleName: 'D', criterionId: 'k_4', text: 'Other', trust: { state: 'confirm', n: 0, agree: 0 } }] });
  assert.deepEqual(m.todo.map((x) => [x.kind, x.exampleId, x.criterionId]), [['fix', 1, 'k_1'], ['confirm', 3, 'k_3'], ['confirm', 4, 'k_4']],
    'rows without a trust key (no model read) stay apart');
});

test('fix round 1: answersText is the one shared "N answer(s)"', () => {
  assert.equal(answersText(1), '1 answer');
  assert.equal(answersText(14), '14 answers');
});

test('order and proof use the 80% bar only from 10 samples (as the people test); with fewer, every miss is a problem', () => {
  const pairs = (same, of) => Array.from({ length: of }, (_, i) => ({ winner: i < same ? 'a' : 'unsure' }));
  const st = (input, key) => trustReportModel(input).tests.find((t) => t.key === key).state;
  assert.equal(st({ pairs: pairs(4, 5) }, 'order'), 'bad', '1 pair in 5 flipped with the order');
  assert.equal(st({ pairs: pairs(5, 5) }, 'order'), 'good');
  assert.equal(st({ pairs: pairs(9, 10) }, 'order'), 'good');
  assert.equal(st({ proofs: { found: 8, of: 9 } }, 'proof'), 'bad');
  assert.equal(st({ proofs: { found: 9, of: 9 } }, 'proof'), 'good');
});

test('user decision 2026-11-22: a planted card that still meets the criterion is not missed when the person answered Right on it', () => {
  const round = (answer) => ({ criterionText: 'Names a success metric with a number', same: { n: 4, of: 4 }, padding: { n: 4, of: 4 },
    cards: [{ planted: null, met: true, answer: true }, { planted: 'numbers written as words', met: true, answer }, { planted: 'x', met: false, answer: true },
      { planted: 'y', met: false, answer: true }] });
  assert.deepEqual(trustReportModel({ rounds: [round(true)] }).tiles.planted, { caught: 3, of: 3, missedOn: [] }, 'Right: Worca was right that it still meets it');
  assert.deepEqual(trustReportModel({ rounds: [round(false)] }).tiles.planted, { caught: 2, of: 3, missedOn: ['Names a success metric with a number'] });
  assert.deepEqual(trustReportModel({ rounds: [round(null)] }).tiles.planted, { caught: 2, of: 3, missedOn: ['Names a success metric with a number'] }, 'not answered yet');
});
