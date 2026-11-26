// test/team-metrics-leaderboard.test.mjs — the pure leaderboard (src/shared/team-metrics/leaderboard.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEADERBOARD_WEIGHTS, LEADERBOARD_RANGES, buildLeaderboard, mergedRunIds, mergedLookupGaps,
} from '../src/shared/team-metrics/leaderboard.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const NOW = Date.parse('2026-09-16T12:00:00Z');
let n = 0;
/** `count` runs by `actor` this month; `opts` may carry usd/result/startedAt. */
const runs = (actor, count, opts = {}) => Array.from({ length: count }, () => makeRecord({ id: `r${++n}`, actor, startedAt: '2026-09-10T10:00:00Z', ...opts }));
const lb = (records, extra = {}) => buildLeaderboard(records, { range: 'this-month', now: NOW, ...extra });
const row = (board, label) => board.rows.find((r) => r.label === label);

test('weights are fixed and sum to 100', () => {
  assert.deepEqual({ ...LEADERBOARD_WEIGHTS }, { merged: 35, success: 35, runs: 15, perRun: 15 });
  assert.equal(Object.values(LEADERBOARD_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('windows per range at NOW (UTC), all is unbounded, custom/unknown throw', () => {
  const at = (range) => lb([], { range });
  assert.equal(at('this-month').startMs, Date.UTC(2026, 8, 1));
  assert.equal(at('this-month').endMs, Date.UTC(2026, 9, 1));
  assert.equal(at('last-month').startMs, Date.UTC(2026, 7, 1));
  assert.equal(at('quarter').startMs, Date.UTC(2026, 6, 1));
  assert.equal(at('year').startMs, Date.UTC(2026, 0, 1));
  assert.equal(at('all').startMs, null);
  assert.equal(at('all').endMs, null);
  assert.deepEqual(['open', 'closed', 'all-time'], [at('quarter').phase, at('last-month').phase, at('all').phase]);
  assert.throws(() => at('custom'), RangeError);
  assert.throws(() => at('week'), RangeError);
  assert.deepEqual([...LEADERBOARD_RANGES], ['this-month', 'last-month', 'quarter', 'year', 'all']);
});

test('only runs started inside the window count', () => {
  const recs = [...runs('Ana', 3), ...runs('Ana', 2, { startedAt: '2026-08-10T10:00:00Z' }), ...runs('Ana', 1, { startedAt: '2026-10-01T00:00:00Z' })];
  assert.equal(lb(recs).totalRuns, 3);
  assert.equal(lb(recs, { range: 'last-month' }).totalRuns, 2);
  assert.equal(lb(recs, { range: 'all' }).totalRuns, 6);
});

test('eligibility: 2 runs is not ranked, 3 is; the 3rd run moves a person into the ranking', () => {
  const two = lb([...runs('Ana', 3), ...runs('Bo', 2)]);
  assert.deepEqual(two.rows.map((r) => r.label), ['Ana']);
  assert.deepEqual(two.notEligible, [{ key: 'Bo', label: 'Bo', runs: 2, needs: 1 }]);
  const three = lb([...runs('Ana', 3), ...runs('Bo', 3)]);
  assert.deepEqual(three.rows.map((r) => r.label).sort(), ['Ana', 'Bo']);
  assert.deepEqual(three.notEligible, []);
});

test('a 2-run person with the best raw numbers is never a winner', () => {
  const recs = [...runs('Ana', 3, { usd: 5, result: 'failed' }), ...runs('Bo', 2, { usd: 0.01 })];
  const b = lb(recs, { mergedRunIds: new Set(recs.filter((r) => r.actor === 'Bo').map((r) => r.id)) });
  assert.deepEqual(b.winners, ['Ana']);
  assert.ok(!b.rows.some((r) => r.label === 'Bo'));
});

test('not-eligible list: runs desc then label; people with 0 runs never appear', () => {
  const b = lb([...runs('Zed', 1), ...runs('Amy', 1), ...runs('Cat', 2), ...runs('Ana', 3), ...runs('Old', 4, { startedAt: '2026-01-01T00:00:00Z' })]);
  assert.deepEqual(b.notEligible.map((p) => p.label), ['Cat', 'Amy', 'Zed']);
  assert.ok(![...b.rows, ...b.notEligible].some((p) => p.label === 'Old'));
});

test('statuses: no-runs, none-eligible, ranked', () => {
  assert.equal(lb([]).status, 'no-runs');
  assert.deepEqual(lb([]).winners, []);
  const none = lb(runs('Bo', 2));
  assert.equal(none.status, 'none-eligible');
  assert.deepEqual(none.winners, []);
  assert.equal(none.totalRuns, 2);
  assert.equal(lb(runs('Bo', 3)).status, 'ranked');
});

test('records without an actor are excluded entirely', () => {
  const b = lb([...runs('', 5), ...runs(null, 5)]);
  assert.equal(b.status, 'no-runs');
  assert.equal(b.totalRuns, 0);
});

test('lower spend per run ranks higher', () => {
  const b = lb([...runs('Cheap', 3, { usd: 1 }), ...runs('Dear', 3, { usd: 2 })]);
  assert.deepEqual(b.rows.map((r) => r.label), ['Cheap', 'Dear']);
  assert.equal(row(b, 'Cheap').parts.perRun.points, 15);
  assert.equal(row(b, 'Dear').parts.perRun.points, 7.5);
});

test('more merged runs ranks higher', () => {
  const recs = [...runs('A', 3), ...runs('B', 3)];
  const b = lb(recs, { mergedRunIds: new Set([recs[0].id, recs[1].id, recs[3].id]) });
  assert.deepEqual(b.rows.map((r) => r.label), ['A', 'B']);
  assert.equal(row(b, 'A').parts.merged.points, 35);
  assert.ok(Math.abs(row(b, 'B').parts.merged.points - 17.5) < 1e-9);
});

test('higher success rate ranks higher', () => {
  const b = lb([...runs('Ok', 3), ...runs('Flaky', 2), ...runs('Flaky', 1, { result: 'failed' })]);
  assert.deepEqual(b.rows.map((r) => r.label), ['Ok', 'Flaky']);
  assert.ok(Math.abs(row(b, 'Flaky').parts.success.points - 35 * (2 / 3)) < 1e-9);
});

test('20 % margins give the same shape of gap regardless of team size', () => {
  // A leads merged and success by 20 %; B leads runs and spend per run by 20 %.
  const a = runs('A', 8, { usd: 1.25 });
  const bb = [...runs('B', 10, { usd: 1 })];
  bb.slice(8).forEach((r) => { r.result = 'failed'; });
  const merged = new Set([...a.slice(0, 8).map((r) => r.id), ...bb.slice(0, 8).map((r) => r.id)]);
  const board = lb([...a, ...bb], { mergedRunIds: merged });
  const ra = row(board, 'A');
  const rb = row(board, 'B');
  assert.ok(Math.abs(ra.score - 94) < 1e-9, `A ${ra.score}`);
  assert.ok(rb.score < ra.score);
  assert.ok(rb.score > 80);
});

test('a tie at the top gives joint winners and rank 1,1,3', () => {
  const b = lb([...runs('A', 4), ...runs('B', 4), ...runs('C', 3, { result: 'failed' })]);
  assert.deepEqual(b.winners.sort(), ['A', 'B']);
  assert.deepEqual(b.rows.map((r) => r.rank), [1, 1, 3]);
});

test('scores equal at one decimal share a rank but keep the unrounded order', () => {
  // 100 and 99.97: rounded both 100.0.
  const recs = [...runs('Zed', 3000), ...runs('Amy', 2999)];
  const b = lb(recs);
  assert.deepEqual(b.rows.map((r) => r.rank), [1, 1]);
  assert.deepEqual(b.rows.map((r) => r.label), ['Zed', 'Amy']);
  assert.ok(b.rows[0].score > b.rows[1].score);
});

test('uncosted runs count in runs/success/merged but not in spend per run', () => {
  const recs = [...runs('A', 2, { usd: 2 }), ...runs('A', 1, { usd: null })];
  const a = row(lb(recs), 'A');
  assert.equal(a.runs, 3);
  assert.equal(a.costed, 2);
  assert.equal(a.perRunUsd, 2);
  assert.equal(a.successRate, 1);
});

test('nobody costed scores 0 for spend; $0 and the smallest positive both score full marks', () => {
  const none = row(lb(runs('A', 3, { usd: null })), 'A');
  assert.equal(none.perRunUsd, null);
  assert.equal(none.parts.perRun.points, 0);
  const b = lb([...runs('Free', 3, { usd: 0 }), ...runs('Penny', 3, { usd: 0.01 }), ...runs('Dear', 3, { usd: 1 })]);
  assert.equal(row(b, 'Free').parts.perRun.points, 15);
  assert.equal(row(b, 'Penny').parts.perRun.points, 15);
  assert.ok(row(b, 'Dear').parts.perRun.points < 1);
});

test('nobody merged: merged is 0 for all and nothing is NaN', () => {
  const b = lb([...runs('A', 3), ...runs('B', 3, { result: 'failed' })]);
  for (const r of b.rows) {
    assert.equal(r.parts.merged.points, 0);
    assert.ok(Number.isFinite(r.score));
  }
  const allFailed = lb(runs('A', 3, { result: 'failed' }));
  assert.equal(allFailed.rows[0].parts.success.points, 0);
});

test('a single eligible person scores per the formula', () => {
  const recs = runs('Solo', 3, { usd: 2 });
  const s = lb(recs, { mergedRunIds: new Set([recs[0].id]) }).rows[0];
  assert.equal(s.score, 15 + 15 + 35 + 35);
  assert.equal(lb(recs).rows[0].score, 15 + 15 + 0 + 35);
});

test('mergedRunIds: only MERGED counts; Map and object both accepted', () => {
  const recs = ['a', 'b', 'c', 'd', 'e'].map((id) => makeRecord({ id }));
  const map = new Map([['a', [{ state: 'MERGED' }]], ['b', [{ state: 'OPEN' }, { state: 'MERGED' }]], ['c', [{ state: 'CLOSED' }]], ['d', null], ['e', []]]);
  assert.deepEqual([...mergedRunIds(map, recs)].sort(), ['a', 'b']);
  assert.deepEqual([...mergedRunIds(Object.fromEntries(map), recs)].sort(), ['a', 'b']);
  assert.equal(mergedRunIds(null, recs).size, 0);
});

test('input is not mutated', () => {
  const recs = runs('A', 3);
  const copy = structuredClone(recs);
  lb(recs);
  assert.deepEqual(recs, copy);
});

test('mergedLookupGaps: every provider that failed is named, and Azure listings cut short are kept', () => {
  assert.deepEqual(mergedLookupGaps(null), { providers: [], truncated: [] });
  assert.deepEqual(mergedLookupGaps({ gh: 'ok', azure: 'ok', bitbucket: 'unused' }), { providers: [], truncated: [] });
  assert.deepEqual(mergedLookupGaps({ gh: 'unused', azure: 'missing' }).providers, ['Azure DevOps']);
  assert.deepEqual(mergedLookupGaps({ gh: 'unused', azure: 'unauthenticated' }).providers, ['Azure DevOps']);
  assert.deepEqual(mergedLookupGaps({ gh: 'ok', azure: 'ok', azureError: 'HTTP 500' }).providers, ['Azure DevOps']);
  assert.deepEqual(mergedLookupGaps({ bitbucket: 'missing' }).providers, ['Bitbucket']);
  assert.deepEqual(mergedLookupGaps({ bitbucket: 'ok', bitbucketError: 'timeout' }).providers, ['Bitbucket']);
  assert.deepEqual(mergedLookupGaps({ gh: 'missing', azure: 'unauthenticated', bitbucketError: 'x' }).providers, ['GitHub', 'Azure DevOps', 'Bitbucket']);
  assert.deepEqual(mergedLookupGaps({ ghError: 'gh down' }).providers, ['GitHub']);
  const status = { azure: 'ok', azureTruncated: ['org/proj/repo'] };
  const gaps = mergedLookupGaps(status);
  assert.deepEqual(gaps, { providers: [], truncated: ['org/proj/repo'] });
  assert.notEqual(gaps.truncated, status.azureTruncated, 'a copy, not the status array');
});
