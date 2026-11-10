// test/workflow-test-compare.test.mjs — D28 and C2: better or worse, luck, steady, the tiles and "In short", on the
// numbers of canvas board 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useLabel, testTitle, latestTitle, countsText, agoText, compareModel, estimateOf, fmtDuration, pctDelta, durationDelta,
  countDelta, fmtTimes, fmtUsdRange, aboutUsd, TRIES_AT_ONCE, differs,
} from '../src/shared/workflow-tests/compare.mjs';
import { fmtUsdFine, fmtUsd } from '../src/shared/workflow-tests/checks.mjs';
import { MAX_PARALLEL } from '../src/core/workflow-tests/runner.mjs';

const ctx = { liveVersionNo: 4, latestVersionNo: 4 };
const SECTIONS = 'Has the sections Problem, Users, Success metric and Risks';
const HELP = 'Finishes without needing help from someone';
let nextId = 0;
const tries = (side, exampleId, marks, { cost, ms, missed = SECTIONS, sent = 1 }) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [], checks: m === 'P' ? [{ label: missed, met: true }] : [{ label: missed, met: false }],
    facts: { durationMs: ms, sentBack: sent } },
}));
const board = () => {
  const ex = [[1, 'Bulk invoice export', 'PPP', 'PFF'], [2, 'Unclear request: "dark mode please"', 'PFF', 'PPP'], [3, 'A feature we already have', 'FFF', 'PPF'],
    [4, 'Offline mode for the field app', 'PPP', 'PPP'], [5, 'Pricing page A/B test', 'PPF', 'PPF'], [6, 'Customer data export (GDPR)', 'PPP', 'PPP']];
  const list = [];
  for (const [id, , a, b] of ex) {
    list.push(...tries('a', id, a, { cost: 0.84, ms: 370000, sent: 2, missed: id === 2 ? HELP : SECTIONS }));
    list.push(...tries('b', id, b, { cost: 0.52, ms: 280000, sent: 1 }));
  }
  return { examples: ex.map(([id, name]) => ({ id, name })), a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list };
};

test('labels and titles in the board\'s words', () => {
  assert.deepEqual([useLabel('draft', ctx), useLabel('draft', ctx, 'column'), useLabel('draft', ctx, 'select')], ['v5 draft', 'v5 draft · yours', 'v5 draft · your changes']);
  assert.deepEqual([useLabel(4, ctx, 'column'), useLabel(3, ctx, 'column'), useLabel(4, ctx)], ['v4 · the team uses it', 'v3', 'v4']);
  assert.deepEqual([useLabel('draft', {}), useLabel('draft', {}, 'column')], ['Your draft', 'Your draft']);
  const run = { kind: 'compare', a: 4, b: 'draft' };
  assert.equal(testTitle(run, ctx), 'Your v5 draft compared with v4');
  assert.equal(testTitle(run, ctx, { mode: 'testing' }), 'Your v5 draft compared with v4', 'U-T8 (F20): running, done and stopped share the compare title');
  assert.equal(testTitle({ kind: 'compare', a: 4, b: 5 }, ctx, { mode: 'testing' }), 'v5 compared with v4');
  assert.equal(testTitle({ kind: 'compare', a: null, b: 'draft' }, ctx, { mode: 'testing' }), 'Your v5 draft', 'no version A: the tested version alone');
  assert.equal(latestTitle(run, ctx), 'Latest test: your v5 draft compared with v4');
  assert.equal(testTitle({ kind: 'compare', a: 4, b: 5 }, { liveVersionNo: 4, latestVersionNo: 5 }), 'v5 compared with v4');
  assert.equal(testTitle({ kind: 'once', a: null, b: 'draft' }, ctx, { exampleName: 'Bulk invoice export' }), 'Tried once: Bulk invoice export');
  assert.equal(testTitle({ kind: 'once', a: null, b: 'draft' }, ctx, { mode: 'testing', exampleName: 'Bulk invoice export' }), 'Trying once: Bulk invoice export');
  assert.deepEqual([countsText(6, 3), countsText(1, 1)], ['6 examples, 3 tries each', '1 example, 1 try each']);
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.deepEqual(['2026-10-26T11:59:40Z', '2026-10-26T11:55:00Z', '2026-10-26T10:00:00Z', '2026-10-25T09:00:00Z'].map((t) => agoText(t, now)),
    ['just now', '5 minutes ago', '2 hours ago', 'yesterday']);
});

test('board 5: tries passed, better, worse, same, why, steady and In short', () => {
  const m = compareModel(board());
  assert.deepEqual(m.counts, { better: 2, worse: 1, same: 3 });
  assert.deepEqual([m.tiles.a.passed, m.tiles.b.passed], [{ passed: 12, total: 18 }, { passed: 14, total: 18 }]);
  assert.deepEqual(m.examples.map((r) => [r.id, r.result, r.luck]), [[1, 'worse', false], [2, 'better', false], [3, 'better', false], [4, 'same', false], [5, 'same', false], [6, 'same', false]]);
  assert.equal(m.examples[0].why, `v5 draft missed "${SECTIONS}" (2 of 3 tries)`);
  assert.equal(m.examples[1].why, `v4 missed "${HELP}" (2 of 3 tries)`);
  assert.deepEqual([m.tiles.a.steady, m.tiles.b.steady], [{ n: 3, of: 6 }, { n: 3, of: 6 }]);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  assert.deepEqual([m.tiles.a.costPerTry, m.tiles.b.costPerTry, m.tiles.a.timePerTry, m.tiles.b.timePerTry, m.tiles.a.sentBack, m.tiles.b.sentBack].map(r3),
    [0.84, 0.52, 370000, 280000, 2, 1]);
  assert.deepEqual(m.inShort, [
    'v5 draft is cheaper and faster, and better on 2 examples.',
    `It is worse on 1 example, Bulk invoice export: it missed "${SECTIONS}" (2 of 3 tries).`,
    'It is sent back for fixes less often: 1 time a try, against 2.',
    'Its results also vary more from try to try.',
  ]);
  assert.deepEqual(m.look, { exampleId: 1, name: 'Bulk invoice export', before: 'Look at ', after: ' before you share v5 draft.' });
});

test('a difference of one try is "might be luck" and names no reason; nothing changed reads as the same', () => {
  const luck = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, 'PPF', { cost: 0.5, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 0.5, ms: 1000 })] });
  assert.deepEqual([luck.examples[0].result, luck.examples[0].luck, luck.examples[0].why], ['better', true, null]);
  const same = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, 'PPP', { cost: 0.5, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 0.5, ms: 1000 })] });
  assert.deepEqual([same.inShort, same.look], [['v5 draft gives the same results as v4 on every example.'], null]);
  const one = compareModel({ examples: [{ id: 1, name: 'X' }], a: null, b: { label: 'Your draft' }, tries: tries('b', 1, 'P', { cost: 0.5, ms: 1000 }) });
  assert.deepEqual([one.tiles.a, one.tiles.b.passed, one.examples[0].result, one.inShort], [null, { passed: 1, total: 1 }, null, []]);
  const unfinished = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [{ id: 99, side: 'b', exampleId: 1, status: 'stopped', costUsd: 0.4, verdict: null }] });
  assert.deepEqual([unfinished.tiles.b.passed, unfinished.examples[0].result, unfinished.inShort, unfinished.look], [{ passed: 0, total: 0 }, null, [], null]);
});

test('In short: the three approved extra sentences, and nothing at all when no example was tried on both (C2, D38)', () => {
  const one = (aMarks, bMarks, bCost) => compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, aMarks, { cost: 1, ms: 1000 }), ...tries('b', 1, bMarks, { cost: bCost, ms: 1000 })] });
  assert.deepEqual(one('PPP', 'PPP', 0.5).inShort, ['v5 draft is cheaper, and gives the same results as v4.']);
  assert.deepEqual(one('PPP', 'FFF', 0.5).inShort, ['v5 draft is cheaper.', `It is worse on 1 example, X: it missed "${SECTIONS}" (3 of 3 tries).`]);
  assert.deepEqual(one('PPP', 'PPF', 1).inShort, ['v5 draft is worse on 1 example, X.', 'Its results also vary more from try to try.'], 'a one-try difference names no reason');
  const onlyA = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: tries('a', 1, 'PPP', { cost: 1, ms: 1000 }) });
  assert.deepEqual([onlyA.counts, onlyA.inShort, onlyA.look], [{ better: 0, worse: 0, same: 0 }, [], null]);
});

test('formats of the tiles and the estimate', () => {
  assert.deepEqual([fmtDuration(280000), fmtDuration(45000), fmtDuration(3900000), fmtDuration(120000)], ['4 min 40 s', '45 s', '1 h 5 min', '2 min']);
  assert.deepEqual([pctDelta(0.84, 0.52), pctDelta(0.5, 0.6), pctDelta(0.5, 0.5)], ['38% less', '20% more', 'the same']);
  assert.deepEqual([durationDelta(370000, 280000), durationDelta(60000, 90000), durationDelta(60000, 62000)], ['1½ min less', '30 s more', 'the same']);
  assert.deepEqual([countDelta(12, 14), countDelta(14, 12), countDelta(3, 3)], ['2 more', '2 fewer', 'the same']);
  assert.deepEqual([fmtTimes(1.2), fmtTimes(1.6000001)], ['1.2×', '1.6×']);
  assert.deepEqual([fmtUsdRange(8.93, 10.81), fmtUsdRange(0.4, 0.7)], ['$9 to $11', '$0.40 to $0.70']);
  assert.deepEqual([aboutUsd(15.12), aboutUsd(10), aboutUsd(3.8)], ['$15', '$10', '$3.80']);
  const plan = { a: { want: 18, reusable: 18, perTryUsd: 0.84 }, b: { want: 18, reusable: 0, perTryUsd: 0.52 }, perTryMs: 280000 };
  const e = estimateOf(plan, { reuseA: true });
  assert.deepEqual([e.toRun, e.total, Math.round(e.usd * 100) / 100, fmtUsdRange(e.low, e.high), e.minutes, e.capUsd], [{ a: 0, b: 18 }, 18, 9.36, '$9 to $11', 28, 15], '18 tries, 3 at a time, 4 min 40 s each');
  const unknown = estimateOf({ a: { want: 3, reusable: 0, perTryUsd: null }, b: { want: 3, reusable: 0, perTryUsd: 0.5 }, perTryMs: null }, { reuseA: false });
  assert.deepEqual([unknown.total, unknown.usd, unknown.minutes, unknown.capUsd], [6, null, null, 10]);
  assert.equal(TRIES_AT_ONCE, MAX_PARALLEL, 'the estimate uses the runner\'s parallelism');
});

// Fix 1: the approved rule for sentence 1, partial coverage, luck with uneven tries, and "Look at".
const X = [{ id: 1, name: 'X' }];
const L4 = { label: 'v4' };
const L5 = { label: 'v5 draft' };
const cmp = (aM, bM, { ac = 1, bc = 1, am = 20000, bm = 20000, examples = X } = {}) => compareModel({ examples, a: L4, b: L5,
  tries: [...tries('a', 1, aM, { cost: ac, ms: am }), ...tries('b', 1, bM, { cost: bc, ms: bm })] });

test('Fix 1: sentence 1 for every reachable form and adjective combination', () => {
  const steadier = 'Its results are also steadier from try to try.';
  assert.deepEqual(cmp('PFF', 'PPP', { bc: 0.5, bm: 10000 }).inShort, ['v5 draft is cheaper and faster, and better on 1 example.', steadier]);
  assert.deepEqual(cmp('PFF', 'PPP', { bc: 2, bm: 40000 }).inShort, ['v5 draft is more expensive and slower, and better on 1 example.', steadier]);
  assert.deepEqual(cmp('PFF', 'PPP', { bc: 0.5, bm: 40000 }).inShort, ['v5 draft is cheaper and slower, and better on 1 example.', steadier]);
  assert.deepEqual(cmp('PFF', 'PPP', { bc: 2, bm: 10000 }).inShort, ['v5 draft is more expensive and faster, and better on 1 example.', steadier]);
  assert.deepEqual(cmp('PFF', 'PPP', { bm: 10000 }).inShort, ['v5 draft is faster, and better on 1 example.', steadier]);
  assert.deepEqual(cmp('PFF', 'PPP').inShort, ['v5 draft is better on 1 example.', steadier]);
  assert.deepEqual(cmp('PPP', 'PPP', { bc: 2, bm: 40000 }).inShort, ['v5 draft is more expensive and slower, and gives the same results as v4.']);
  assert.deepEqual(cmp('PPP', 'PPP', { bm: 10000 }).inShort, ['v5 draft is faster, and gives the same results as v4.']);
  assert.deepEqual(cmp('PPP', 'PPP', { bc: 0.5, bm: 40000 }).inShort, ['v5 draft is cheaper and slower, and gives the same results as v4.']);
  assert.deepEqual(cmp('PPP', 'PPP').inShort, ['v5 draft gives the same results as v4 on every example.']);
  // only one of two examples was finished on both versions: not "every example"
  const partial = compareModel({ examples: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }], a: L4, b: L5,
    tries: [...tries('a', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('a', 2, 'PPP', { cost: 1, ms: 1000 })] });
  assert.deepEqual(partial.inShort, ['v5 draft gives the same results as v4 on the examples both versions finished.']);
  assert.deepEqual(cmp('PPP', 'FFF', { bc: 2 }).inShort.slice(0, 2),
    ['v5 draft is more expensive.', `It is worse on 1 example, X: it missed "${SECTIONS}" (3 of 3 tries).`]);
  assert.deepEqual(cmp('PPP', 'FFF').inShort, [`v5 draft is worse on 1 example, X: it missed "${SECTIONS}" (3 of 3 tries).`]);
  const two = compareModel({ examples: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }], a: L4, b: L5,
    tries: [1, 2].flatMap((id) => [...tries('a', id, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', id, 'FFF', { cost: 1, ms: 1000 })]) });
  assert.deepEqual(two.inShort, ['v5 draft is worse on 2 examples.']);
});

test('Fix 1: steadiness counts only examples compared on both versions', () => {
  const m = compareModel({ examples: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }], a: L4, b: L5,
    tries: [...tries('a', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 2, 'PPP', { cost: 1, ms: 1000 })] });
  assert.deepEqual([m.tiles.a.steady, m.tiles.b.steady], [{ n: 1, of: 1 }, { n: 1, of: 1 }]);
  assert.ok(!m.inShort.some((t) => /vary more|steadier/.test(t)));
});

test('Fix 1: a difference resting on one try is chance, whichever side has more tries; Look at is only for clear drops', () => {
  const m = compareModel({ examples: X, a: L4, b: L5, tries: [...tries('a', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 1, 'F', { cost: 1, ms: 1000 })] });
  assert.deepEqual([m.examples[0].result, m.examples[0].luck, m.examples[0].why, m.look], ['worse', true, null, null]);
  assert.deepEqual(cmp('PPP', 'PPF').look, null);
  assert.equal(cmp('PPP', 'FFF').look.exampleId, 1);
});

test('Fix 2: cost and time per try only over the compared examples; Look at picks the clear one when the larger drop could be chance', () => {
  const m = compareModel({ examples: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }], a: L4, b: L5,
    tries: [...tries('a', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 2, 'PPP', { cost: 0.1, ms: 100 })] });
  assert.deepEqual([m.tiles.a.costPerTry, m.tiles.b.costPerTry, m.tiles.b.timePerTry], [1, 1, 1000]);
  assert.deepEqual(m.inShort, ['v5 draft gives the same results as v4 on the examples both versions finished.']);
  const solo = compareModel({ examples: [{ id: 2, name: 'Y' }], a: null, b: L5, tries: tries('b', 2, 'PPP', { cost: 0.1, ms: 100 }) });
  assert.equal(Math.round(solo.tiles.b.costPerTry * 100) / 100, 0.1, 'a single-version test averages all its tries');
  const t = compareModel({ examples: [{ id: 1, name: 'Luck' }, { id: 2, name: 'Clear' }], a: L4, b: L5, tries: [
    ...tries('a', 1, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 1, 'F', { cost: 1, ms: 1000 }),
    ...tries('a', 2, 'PPP', { cost: 1, ms: 1000 }), ...tries('b', 2, 'PFF', { cost: 1, ms: 1000 })] });
  assert.deepEqual(t.examples.map((r) => [r.result, r.luck]), [['worse', true], ['worse', false]]);
  assert.equal(t.look.name, 'Clear');
});

// U-T5 (D5): one shared rule for "differs", honest sentences, rows and tiles.
const L1 = 'Has the sections Problem and Risks';
const L2 = 'Names an owner for each risk';
// marks: P passed, F failed (missed every label in `miss`), f failed (missed only the first label).
const tr = (side, exampleId, marks, { cost = 1, ms = 1000, sent = 0, miss = [SECTIONS] } = {}) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [],
    checks: miss.map((label, i) => ({ label, met: m === 'P' || (m === 'f' && i > 0) })), facts: { durationMs: ms, sentBack: sent } },
}));
const sd = (marks, o = {}) => (id, s) => tr(s, id, marks, o);
const cmp2 = (exs) => compareModel({ examples: exs.map(([id, name]) => ({ id, name })), a: L4, b: L5,
  tries: exs.flatMap(([id, , at, bt]) => [...at(id, 'a'), ...bt(id, 'b')]) });

test('U-T5 D5: differs needs 20% and the floor, and 2 finished tries on each side', () => {
  assert.equal(differs('time', 40000, 44000, 3, 3), 'same', '40 s against 44 s is 10%');
  assert.equal(differs('time', 30000, 40000, 3, 3), 'more', '33% and 10 s');
  assert.equal(differs('time', 30000, 39000, 3, 3), 'same', 'under 10 s');
  assert.equal(differs('time', 100000, 70000, 3, 3), 'less');
  assert.equal(differs('cost', 0.1, 0.115, 3, 3), 'same', '15%');
  assert.equal(differs('cost', 0.1, 0.125, 3, 3), 'more');
  assert.equal(differs('cost', 0.001, 0.002, 3, 3), 'same', 'under a cent a try');
  assert.equal(differs('cost', 0.05, 0.02, 3, 3), 'less');
  assert.equal(differs('cost', 1, 3, 1, 3), null, 'one try on a side is not enough');
  assert.equal(differs('cost', 1, 3, 3, 0), null);
  assert.equal(differs('sentBack', 1, 1.4, 3, 3), 'same');
  assert.equal(differs('sentBack', 1, 1.5, 3, 3), 'more');
  assert.equal(differs('sentBack', 2, 1, 3, 3), 'less');
  assert.equal(differs('cost', null, 1, 3, 3), null);
});

test('Fix 3: $0 baseline decides on the absolute part; too few tries is cannot-tell, not same', () => {
  assert.equal(differs('cost', 0, 0.5, 3, 3), 'more');
  assert.equal(differs('cost', 0, 0.005, 3, 3), 'same');
  assert.equal(differs('time', 0, 12000, 3, 3), 'more');
  assert.equal(differs('time', 0, 5000, 3, 3), 'same');
  assert.equal(differs('cost', 1, 3, 1, 1), null);
  const few = cmp2([[1, 'X', sd('P', { cost: 1, ms: 20000 }), sd('P', { cost: 3, ms: 20000 })]]);
  assert.deepEqual([few.tiles.diff.cost, few.tiles.diff.time], [null, null]);
  assert.deepEqual(few.inShort, ['v5 draft gives the same results as v4 on every example.'], 'says nothing about cost');
  const zero = cmp2([[1, 'X', sd('PPP', { cost: 0 }), sd('PPP', { cost: 0.5 })]]);
  assert.equal(zero.tiles.diff.cost, 'more');
  assert.equal(zero.inShort[0], 'v5 draft is more expensive, and gives the same results as v4.');
});

test('Fix 2: no dangling It / Its when no earlier sentence names the version', () => {
  const sent = cmp2([[1, 'X', sd('FFF', { sent: 2 }), sd('FFF', { sent: 1 })]]);
  assert.equal(sent.inShort.join(' '), `Neither version passes any example yet. Most often missed: "${SECTIONS}" (6 of 6 tries). v5 draft is sent back for fixes less often: 1 time a try, against 2.`);
  const vary = cmp2([[1, 'X', sd('FFF'), sd('FFF')], [2, 'Y', sd('PPP'), sd('PPP')]]);
  assert.ok(!/\bIts?\b/.test(vary.inShort.join(' ')), vary.inShort.join(' '));
});

test('Fix 2: steadiness names the version too', () => {
  const m = cmp2([[1, 'X', sd('FFF'), sd('PFF')]]);
  assert.equal(m.inShort[m.inShort.length - 1], "v5 draft's results also vary more from try to try.");
  assert.ok(!/Its?/.test(m.inShort.join(' ')), m.inShort.join(' '));
});

test('Fix 4: "Same result, but" shows both directions', () => {
  const cheap = cmp2([[1, 'X', sd('PPP', { cost: 0.05 }), sd('PPP', { cost: 0.02 })]]);
  assert.equal(cheap.examples[0].why, 'Same result, but v5 draft costs 0.4× as much a try ($0.0200 against $0.0500).');
  const less = cmp2([[1, 'X', sd('PPP', { sent: 3 }), sd('PPP', { sent: 1 })]]);
  assert.equal(less.examples[0].why, 'Same result, but v5 draft is sent back for fixes 1 time a try, against 3.');
  const mix = cmp2([[1, 'X', sd('PPP', { cost: 0.02, sent: 1 }), sd('PPP', { cost: 0.05, sent: 0 })]]);
  assert.equal(mix.examples[0].why, 'Same result, but v5 draft costs 2.5× as much a try ($0.0500 against $0.0200), and is sent back for fixes 0 times a try, against 1.');
});

test('U-T5 F6: 40 s against 44 s is not "slower"; a real gap still is', () => {
  const m = cmp2([[1, 'X', sd('PPP', { ms: 40000 }), sd('PPP', { ms: 44000 })]]);
  assert.deepEqual(m.inShort, ['v5 draft gives the same results as v4 on every example.']);
  assert.deepEqual(m.tiles.diff, { cost: 'same', time: 'same', sentBack: 'same' });
  const slow = cmp2([[1, 'X', sd('PPP', { ms: 30000 }), sd('PPP', { ms: 45000 })]]);
  assert.deepEqual(slow.inShort, ['v5 draft is slower, and gives the same results as v4.']);
  assert.equal(slow.tiles.diff.time, 'more');
});

test('U-T5 F7: nothing passes on either side', () => {
  const none = cmp2([[1, 'X', sd('FFF', { cost: 1 }), sd('FFF', { cost: 0.4 })], [2, 'Y', sd('FFF', { cost: 1 }), sd('FFF', { cost: 0.4 })]]);
  assert.equal(none.inShort.join(' '), `Neither version passes any example yet. Most often missed: "${SECTIONS}" (12 of 12 tries). v5 draft is cheaper than v4.`);
  const flat = cmp2([[1, 'X', sd('FFF'), sd('FFF')]]);
  assert.equal(flat.inShort.join(' '), `Neither version passes any example yet. Most often missed: "${SECTIONS}" (6 of 6 tries).`);
  assert.equal(flat.look, null);
});

test('U-T5 F8: fails on both is "Same", never luck', () => {
  const m = cmp2([[1, 'X', sd('PFFFF'), sd('FFFFF')]]);
  const r = m.examples[0];
  assert.deepEqual([r.result, r.luck, r.failsBoth], ['same', false, true]);
  assert.equal(r.why, `Fails on both versions: "${SECTIONS}" is missed most (9 of 10 tries). Look at the example or its checks.`);
  assert.deepEqual(m.counts, { better: 0, worse: 0, same: 1 });
  const ok = cmp2([[1, 'X', sd('PPFFF'), sd('PPPFF')]]);   // 40% and 60%: only one is under half
  assert.equal(ok.examples[0].failsBoth, false);
});

test('U-T5 F9: every check B missed more often than A is named', () => {
  const m = cmp2([[1, 'X', sd('PPP', { miss: [L1, L2] }), sd('FFF', { miss: [L1, L2] })]]);
  assert.equal(m.examples[0].why, `v5 draft missed "${L1}" (3 of 3 tries) and "${L2}" (3 of 3 tries)`);
  assert.equal(m.inShort[0], `v5 draft is worse on 1 example, X: it missed "${L1}" (3 of 3 tries) and "${L2}" (3 of 3 tries).`);
  const some = cmp2([[1, 'X', sd('PPP', { miss: [L1, L2] }), sd('fff', { miss: [L1, L2] })]]);
  assert.equal(some.examples[0].why, `v5 draft missed "${L1}" (3 of 3 tries)`, 'f misses only the first label');
});

test('U-T5 F10: same pass result at a different cost or sent back', () => {
  const costly = cmp2([[1, 'X', sd('PPP', { cost: 0.02 }), sd('PPP', { cost: 0.05 })]]);
  assert.equal(costly.examples[0].why, 'Same result, but v5 draft costs 2.5× as much a try ($0.0500 against $0.0200).');
  const both = cmp2([[1, 'X', sd('PPP', { cost: 0.02, sent: 1 }), sd('PPP', { cost: 0.05, sent: 2 })]]);
  assert.equal(both.examples[0].why, 'Same result, but v5 draft costs 2.5× as much a try ($0.0500 against $0.0200), and is sent back for fixes 2 times a try, against 1.');
  assert.deepEqual(both.inShort, ['v5 draft is more expensive, and gives the same results as v4.', 'It is sent back for fixes more often: 2 times a try, against 1.']);
  const less = cmp2([[1, 'X', sd('PPP', { sent: 2 }), sd('PPP', { sent: 1 })]]);
  assert.deepEqual(less.inShort, ['v5 draft gives the same results as v4 on every example.', 'It is sent back for fixes less often: 1 time a try, against 2.']);
  assert.equal(less.examples[0].why, 'Same result, but v5 draft is sent back for fixes 1 time a try, against 2.', 'both directions (Fix 4)');
  const same = cmp2([[1, 'X', sd('PPP', { cost: 0.5 }), sd('PPP', { cost: 0.51 })]]);
  assert.equal(same.examples[0].why, null);
});

test('U-T5 F11: "steadier" counts only examples that passed every try', () => {
  const failing = cmp2([[1, 'X', sd('PPP'), sd('PPP')], [2, 'Y', sd('PFF'), sd('FFF')]]);   // B is steady only in failing
  assert.deepEqual([failing.tiles.a.steady, failing.tiles.b.steady], [{ n: 1, of: 2 }, { n: 1, of: 2 }]);
  assert.ok(!failing.inShort.some((t) => /vary more|steadier/.test(t)), failing.inShort.join(' '));
  const better = cmp2([[1, 'X', sd('PPP'), sd('PPP')], [2, 'Y', sd('PFF'), sd('PPP')]]);
  assert.deepEqual([better.tiles.a.steady, better.tiles.b.steady], [{ n: 1, of: 2 }, { n: 2, of: 2 }]);
  assert.ok(better.inShort.includes('Its results are also steadier from try to try.'));
  const vary = cmp2([[1, 'X', sd('PPP'), sd('PFP')], [2, 'Y', sd('PPP'), sd('PPP')]]);
  assert.ok(vary.inShort.includes('Its results also vary more from try to try.'));
  assert.ok(!vary.inShort.includes('Its results are also steadier from try to try.'));
});

test('U-T5 Look at: most missed checks first, then the drop; a tie says how many more', () => {
  const m = cmp2([[1, 'Beta', sd('PPP', { miss: [L1, L2] }), sd('FFF', { miss: [L1, L2] })], [2, 'Alpha', sd('PPP', { miss: [L1, L2] }), sd('FFF', { miss: [L1, L2] })],
    [3, 'Gamma', sd('PPP'), sd('FFF')]]);
  assert.deepEqual(m.look, { exampleId: 2, name: 'Alpha', before: 'Look at ', after: ' (and 1 more like it) before you share v5 draft.' });
  const one = cmp2([[1, 'Big drop', sd('PPP'), sd('FFF')], [2, 'Many checks', sd('PPP', { miss: [L1, L2] }), sd('PFF', { miss: [L1, L2] })]]);
  assert.equal(one.look.name, 'Many checks', 'more missed checks beat the bigger drop');
  assert.equal(one.look.after, ' before you share v5 draft.');
});

test('U-T5 money: under $0.10 three significant digits, from $0.10 two decimals', () => {
  assert.deepEqual([fmtUsdFine(0.0131), fmtUsdFine(0.05), fmtUsdFine(0.0049), fmtUsdFine(0.1), fmtUsdFine(3.8), fmtUsdFine(0), fmtUsdFine(null)],
    ['$0.0131', '$0.0500', '$0.00490', '$0.10', '$3.80', '$0.00', '$0.00']);
  assert.equal(fmtUsd(0.0131), '$0.01', 'fmtUsd stays for limits');
});

