// test/workflow-test-compare.test.mjs — D28 and C2: better or worse, luck, steady, the tiles and "In short", on the
// numbers of canvas board 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useLabel, testTitle, latestTitle, countsText, agoText, compareModel, estimateOf, fmtDuration, pctDelta, durationDelta,
  countDelta, fmtTimes, fmtUsdRange, aboutUsd, TRIES_AT_ONCE,
} from '../src/shared/workflow-tests/compare.mjs';
import { MAX_PARALLEL } from '../src/core/workflow-tests/runner.mjs';

const ctx = { liveVersionNo: 4, latestVersionNo: 4 };
const SECTIONS = 'Has the sections Problem, Users, Success metric and Risks';
const HELP = 'Finishes without needing help from someone';
let nextId = 0;
const tries = (side, exampleId, marks, { cost, ms, missed = SECTIONS }) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [], checks: m === 'P' ? [{ label: missed, met: true }] : [{ label: missed, met: false }],
    facts: { durationMs: ms, sentBack: side === 'a' ? 2 : 1 } },
}));
const board = () => {
  const ex = [[1, 'Bulk invoice export', 'PPP', 'PFF'], [2, 'Unclear request: "dark mode please"', 'PFF', 'PPP'], [3, 'A feature we already have', 'FFF', 'PPF'],
    [4, 'Offline mode for the field app', 'PPP', 'PPP'], [5, 'Pricing page A/B test', 'PPF', 'PPF'], [6, 'Customer data export (GDPR)', 'PPP', 'PPP']];
  const list = [];
  for (const [id, , a, b] of ex) {
    list.push(...tries('a', id, a, { cost: 0.84, ms: 370000, missed: id === 2 ? HELP : SECTIONS }));
    list.push(...tries('b', id, b, { cost: 0.52, ms: 280000 }));
  }
  return { examples: ex.map(([id, name]) => ({ id, name })), a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list };
};

test('labels and titles in the board\'s words', () => {
  assert.deepEqual([useLabel('draft', ctx), useLabel('draft', ctx, 'column'), useLabel('draft', ctx, 'select')], ['v5 draft', 'v5 draft · yours', 'v5 draft · your changes']);
  assert.deepEqual([useLabel(4, ctx, 'column'), useLabel(3, ctx, 'column'), useLabel(4, ctx)], ['v4 · the team uses it', 'v3', 'v4']);
  assert.deepEqual([useLabel('draft', {}), useLabel('draft', {}, 'column')], ['Your draft', 'Your draft']);
  const run = { kind: 'compare', a: 4, b: 'draft' };
  assert.equal(testTitle(run, ctx), 'Your v5 draft compared with v4');
  assert.equal(testTitle(run, ctx, { mode: 'testing' }), 'Testing your v5 draft');
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
  assert.equal(m.examples[0].why, `v5 draft missed "${SECTIONS}" in 2 of 3 tries`);
  assert.equal(m.examples[1].why, `v4 missed "${HELP}" in 2 of 3 tries`);
  assert.deepEqual([m.tiles.a.steady, m.tiles.b.steady], [{ n: 4, of: 6 }, { n: 3, of: 6 }]);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  assert.deepEqual([m.tiles.a.costPerTry, m.tiles.b.costPerTry, m.tiles.a.timePerTry, m.tiles.b.timePerTry, m.tiles.a.sentBack, m.tiles.b.sentBack].map(r3),
    [0.84, 0.52, 370000, 280000, 2, 1]);
  assert.deepEqual(m.inShort, [
    'v5 draft is cheaper and faster, and better on 2 examples.',
    `It is worse on 1 example, Bulk invoice export: it missed "${SECTIONS}" in 2 of 3 tries.`,
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
  assert.deepEqual(one('PPP', 'FFF', 0.5).inShort, ['v5 draft is cheaper.', `It is worse on 1 example, X: it missed "${SECTIONS}" in 3 of 3 tries.`]);
  assert.deepEqual(one('PPP', 'PPF', 1).inShort, ['It is worse on 1 example, X.', 'Its results also vary more from try to try.'], 'a one-try difference names no reason');
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
