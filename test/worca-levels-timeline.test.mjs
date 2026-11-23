// test/worca-levels-timeline.test.mjs — the pure time helpers behind the parallel-features, runs-on-days
// and active-days facts: strict overlap detection and per-timezone day counting.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { firstParallelPair, dayKey, activeDayKeys, firstRunsOnDays, activeDaysWindow } from '../src/core/worca-levels/timeline.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const { getDb } = await import('../src/core/db.mjs');
const { realRunRows } = await import('../src/core/worca-levels/facts.mjs');

const iv = (id, start, end) => ({ id, start, end });

test('firstParallelPair: an overlap gives the pair, at the later finish', () => {
  const r = firstParallelPair([iv('a', '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z'), iv('b', '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')]);
  assert.deepEqual(r, { at: '2026-01-01T13:00:00Z', ids: ['a', 'b'] });
});

test('firstParallelPair: back-to-back runs do not overlap', () => {
  assert.equal(firstParallelPair([iv('a', '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'), iv('b', '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z')]), null);
});

test('firstParallelPair: a nested interval overlaps, at the outer finish', () => {
  const r = firstParallelPair([iv('a', '2026-01-01T10:00:00Z', '2026-01-01T14:00:00Z'), iv('b', '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z')]);
  assert.deepEqual(r, { at: '2026-01-01T14:00:00Z', ids: ['a', 'b'] });
});

test('firstParallelPair: of three runs the earliest second finish wins', () => {
  const r = firstParallelPair([
    iv('a', '2026-01-01T10:00:00Z', '2026-01-01T20:00:00Z'),
    iv('b', '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z'),
    iv('c', '2026-01-01T11:30:00Z', '2026-01-01T15:00:00Z'),
  ]);
  assert.deepEqual(r, { at: '2026-01-01T15:00:00Z', ids: ['b', 'c'] });
});

test('firstParallelPair: zero-length and inverted intervals are ignored', () => {
  assert.equal(firstParallelPair([iv('a', '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z'), iv('z', '2026-01-01T11:00:00Z', '2026-01-01T11:00:00Z')]), null);
  assert.equal(firstParallelPair([iv('a', '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z'), iv('r', '2026-01-01T11:30:00Z', '2026-01-01T11:00:00Z')]), null);
});

test('firstParallelPair: empty input gives null and the input is not mutated', () => {
  assert.equal(firstParallelPair([]), null);
  const input = [iv('b', '2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z'), iv('a', '2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')];
  const copy = structuredClone(input);
  firstParallelPair(input);
  assert.deepEqual(input, copy);
});

test('dayKey: the same instant lands on different days in Pacific/Auckland and UTC', () => {
  const t = '2026-03-10T23:30:00Z';
  assert.equal(dayKey(t, 'UTC'), '2026-03-10');
  assert.equal(dayKey(t, 'Pacific/Auckland'), '2026-03-11');
});

// A real-run row as realRunRows returns it; only the fields the helpers read.
const row = (id, finishedAt, extra = {}) => ({ id, finishedAt, scheduleId: null, ...extra });
const dayAt = (start, i, hour = 10) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000 + hour * 3600000).toISOString();

test('activeDayKeys: a day is active with one real run, stamped at its first finish', () => {
  const m = activeDayKeys([row('b', '2026-01-01T15:00:00Z'), row('a', '2026-01-01T09:00:00Z'), row('c', '2026-01-02T08:00:00Z')], 'UTC');
  assert.deepEqual([...m], [['2026-01-01', Date.parse('2026-01-01T09:00:00Z')], ['2026-01-02', Date.parse('2026-01-02T08:00:00Z')]]);
});

test('activeDayKeys: a daily schedule contributes one day', () => {
  const rows = [0, 1, 2, 3, 4].map((i) => row(`s${i}`, dayAt('2026-01-01', i), { scheduleId: 'sch_1' }));
  const m = activeDayKeys(rows, 'UTC');
  assert.deepEqual([...m.keys()], ['2026-01-01']);
  const withManual = activeDayKeys([...rows, row('m', dayAt('2026-01-03', 0))], 'UTC');
  assert.deepEqual([...withManual.keys()], ['2026-01-01', '2026-01-03'], 'a hand-started run on a later day still counts');
});

test('activeDayKeys: buckets by the local day and mutates nothing', () => {
  const rows = [row('a', '2026-01-05T23:30:00Z')];
  const copy = structuredClone(rows);
  assert.deepEqual([...activeDayKeys(rows, 'Europe/Berlin').keys()], ['2026-01-06']);
  assert.deepEqual(rows, copy);
});

test('firstRunsOnDays stamps the 10th run on the 3rd day', () => {
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(row(`r${i}`, `2026-01-0${1 + (i % 2)}T${String(8 + i).padStart(2, '0')}:00:00Z`));
  assert.deepEqual(firstRunsOnDays(rows, 'UTC', { runs: 10, days: 3 }), { metAt: null, runs: 9, days: 2 }, '9 runs over 2 days');
  rows.push(row('r9', '2026-01-03T09:00:00Z'));
  const r = firstRunsOnDays(rows, 'UTC', { runs: 10, days: 3 });
  assert.deepEqual(r, { metAt: '2026-01-03T09:00:00.000Z', runs: 10, days: 3 });
});

test('firstRunsOnDays: both thresholds must hold; the later one stamps it', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row(`r${i}`, `2026-01-01T${String(8 + i).padStart(2, '0')}:00:00Z`));
  rows.push(row('d2', '2026-01-02T08:00:00Z'), row('d3', '2026-01-03T08:00:00Z'));
  assert.equal(firstRunsOnDays(rows, 'UTC').metAt, '2026-01-03T08:00:00.000Z');
});

test('firstRunsOnDays: the runs of one schedule add one day in total (D-9)', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ ...row(`s${i}`, `2026-01-${String(1 + i).padStart(2, '0')}T08:00:00Z`), scheduleId: 'sch_a' });
  assert.deepEqual(firstRunsOnDays(rows, 'UTC'), { metAt: null, runs: 10, days: 1 });
  rows.push(row('m1', '2026-01-11T08:00:00Z'), row('m2', '2026-01-12T08:00:00Z'));
  assert.deepEqual(firstRunsOnDays(rows, 'UTC'), { metAt: '2026-01-12T08:00:00.000Z', runs: 12, days: 3 });
});

test('activeDaysWindow: 20 active days spread over 30 with gaps meets Council; 19 does not; weekends don\'t reset', () => {
  // Skip every Saturday and Sunday from 2026-01-01 (a Thursday) until 20 days are collected: spans 28 days.
  const days = [];
  for (let i = 0; days.length < 20; i++) {
    const t = new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86400000);
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) days.push(i);
  }
  const rows = (list) => list.map((i) => row(`r${i}`, dayAt('2026-01-01', i)));
  const now = Date.parse('2026-03-01T12:00:00Z');
  const met = activeDaysWindow(activeDayKeys(rows(days), 'UTC'), 'UTC', now);
  assert.equal(met.metAt, dayAt('2026-01-01', days[19]).replace(':00:00Z', ':00:00.000Z'));
  const short = activeDaysWindow(activeDayKeys(rows(days.slice(0, 19)), 'UTC'), 'UTC', now);
  assert.equal(short.metAt, null);
});

test('activeDaysWindow: 20 days not inside one 30-day window do not meet it', () => {
  const days = [...Array(10).keys(), ...[...Array(10).keys()].map((i) => i + 40)];
  const rows = days.map((i) => row(`r${i}`, dayAt('2026-01-01', i)));
  assert.equal(activeDaysWindow(activeDayKeys(rows, 'UTC'), 'UTC', Date.parse('2026-04-01T00:00:00Z')).metAt, null);
});

test('activeDaysWindow: inWindow counts the active days in [today-29, today] and the clock is the argument', () => {
  const rows = [0, 1, 5, 29, 30].map((i) => row(`r${i}`, dayAt('2026-01-01', i)));
  const m = activeDayKeys(rows, 'UTC');
  const today = Date.parse('2026-01-30T12:00:00Z');
  assert.equal(activeDaysWindow(m, 'UTC', today).inWindow, 4, 'days 0..29 are in; day 30 is tomorrow');
  assert.equal(activeDaysWindow(m, 'UTC', Date.parse('2026-01-31T12:00:00Z')).inWindow, 4, 'day 0 fell out, day 30 came in');
  assert.deepEqual(activeDaysWindow(new Map(), 'UTC', today), { inWindow: 0, metAt: null });
});

// A done pipelines row with an explicit finish instant and a LATER updated_at (a rename after the finish).
function doneRun(id, finishedAt, updatedAt) {
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, finished_at, started_by, total_cost_usd)
    VALUES (?, 'proj-00000001', 'project', 'done', 'done', 0, ?, ?, ?, '_local', 1)`)
    .run(id, '2026-05-10T18:00:00Z', updatedAt, finishedAt);
}

test('a run finished 23:30 in Europe/Belgrade (21:30Z) is that local day, not the next/previous UTC day', () => {
  const db = getDb();
  db.exec('DELETE FROM pipelines');
  // Both finish on Belgrade May 10 (CEST, UTC+2): 21:30Z is 23:30 local. Their updated_at moved on to May 11 UTC.
  doneRun('worca0001', '2026-05-10T21:30:00Z', '2026-05-11T09:00:00Z');
  doneRun('worca0002', '2026-05-10T10:00:00Z', '2026-05-11T09:05:00Z');
  const rows = realRunRows({ person: '_local', shared: false });
  assert.deepEqual(rows.map((r) => r.finishedAt).sort(), ['2026-05-10T10:00:00Z', '2026-05-10T21:30:00Z'], 'the finish instant');
  assert.deepEqual([...activeDayKeys(rows, 'Europe/Belgrade').keys()], ['2026-05-10']);
});

test('realRunRows falls back to updated_at for a run with no finished_at', () => {
  const db = getDb();
  db.exec('DELETE FROM pipelines');
  doneRun('worca0003', null, '2026-05-10T21:30:00Z');
  assert.deepEqual(realRunRows({ person: '_local', shared: false }).map((r) => r.finishedAt), ['2026-05-10T21:30:00Z']);
});
