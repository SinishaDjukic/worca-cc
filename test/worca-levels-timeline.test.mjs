// test/worca-levels-timeline.test.mjs — the pure time helpers behind the parallel-features and
// council-streak facts: strict overlap detection and per-timezone daily streaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstParallelPair, dayKey, councilStreak } from '../src/core/worca-levels/timeline.mjs';

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

// `n` consecutive days from `start` (UTC midnight based), each with two finishes at 09:00 and 10:00 UTC.
function busyDays(start, n, perDay = 2) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    for (let j = 0; j < perDay; j++) out.push(`${d}T${String(9 + j).padStart(2, '0')}:00:00Z`);
  }
  return out;
}

test('councilStreak: 30 consecutive busy days meet it at the 2nd finish of day 30', () => {
  const r = councilStreak(busyDays('2026-01-01', 30), 'UTC', '2026-02-15T12:00:00Z');
  assert.equal(r.metAt, '2026-01-30T10:00:00.000Z');
});

test('councilStreak: a day with one finish resets the run', () => {
  const t = [...busyDays('2026-01-01', 14), ...busyDays('2026-01-15', 1, 1), ...busyDays('2026-01-16', 30)];
  const r = councilStreak(t, 'UTC', '2026-03-01T12:00:00Z');
  assert.equal(r.metAt, '2026-02-14T10:00:00.000Z');
});

test('councilStreak: a Saturday with one finish resets (weekends are ordinary days)', () => {
  // 2026-01-03 is a Saturday.
  assert.equal(new Date('2026-01-03T00:00:00Z').getUTCDay(), 6);
  const t = [...busyDays('2026-01-01', 2), ...busyDays('2026-01-03', 1, 1), ...busyDays('2026-01-04', 29)];
  assert.equal(councilStreak(t, 'UTC', '2026-03-01T12:00:00Z').metAt, null);
});

test('councilStreak: fewer than 30 days never meets it', () => {
  assert.deepEqual(councilStreak(busyDays('2026-01-01', 29), 'UTC', '2026-03-01T12:00:00Z'), { current: 0, metAt: null });
});

test('councilStreak: today with one finish does not reset the streak ending yesterday', () => {
  const t = [...busyDays('2026-01-01', 5), ...busyDays('2026-01-06', 1, 1)];
  assert.equal(councilStreak(t, 'UTC', '2026-01-06T20:00:00Z').current, 5);
});

test('councilStreak: current counts yesterday’s run plus today when today qualifies', () => {
  const t = busyDays('2026-01-01', 6);
  assert.equal(councilStreak(t, 'UTC', '2026-01-06T20:00:00Z').current, 6);
});

test('councilStreak: a missing yesterday resets current to 0', () => {
  const t = busyDays('2026-01-01', 5);
  assert.equal(councilStreak(t, 'UTC', '2026-01-07T08:00:00Z').current, 0);
});

test('councilStreak: a finish at 23:30 local is bucketed on the local day, not the UTC day', () => {
  // 23:30Z on Jan 5 is 00:30 on Jan 6 in Berlin but still Jan 5 in UTC.
  const t = ['2026-01-05T08:00:00Z', '2026-01-05T23:30:00Z'];
  assert.equal(councilStreak(t, 'Europe/Berlin', '2026-01-06T12:00:00Z').current, 0, 'one finish per Berlin day');
  assert.equal(councilStreak(t, 'UTC', '2026-01-06T12:00:00Z').current, 1, 'both finishes on UTC Jan 5');
});

function localDaysAcrossDst(startDay, n, hours) {
  // Two finishes per calendar day at the given UTC hours; the hours are chosen to stay on one local date.
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.parse(`${startDay}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    for (const h of hours) out.push(`${d}T${h}:00:00Z`);
  }
  return out;
}

test('councilStreak: Europe/Berlin keeps day counts right across both DST changes', () => {
  // Noon-ish UTC finishes stay on the same Berlin date in winter and summer time.
  const spring = localDaysAcrossDst('2026-03-20', 30, ['10', '11']);
  assert.equal(councilStreak(spring, 'Europe/Berlin', '2026-04-30T12:00:00Z').metAt, '2026-04-18T11:00:00.000Z');
  const autumn = localDaysAcrossDst('2026-10-15', 30, ['10', '11']);
  assert.equal(councilStreak(autumn, 'Europe/Berlin', '2026-12-01T12:00:00Z').metAt, '2026-11-13T11:00:00.000Z');
});

test('councilStreak: America/New_York keeps day counts right across both DST changes', () => {
  const spring = localDaysAcrossDst('2026-03-01', 30, ['15', '16']);
  assert.equal(councilStreak(spring, 'America/New_York', '2026-04-30T12:00:00Z').metAt, '2026-03-30T16:00:00.000Z');
  const autumn = localDaysAcrossDst('2026-10-20', 30, ['15', '16']);
  assert.equal(councilStreak(autumn, 'America/New_York', '2026-12-30T12:00:00Z').metAt, '2026-11-18T16:00:00.000Z');
});

test('councilStreak: current counts days across a DST change in the zone', () => {
  // Berlin DST starts 2026-03-29; three busy days around it, today is the 30th.
  const t = localDaysAcrossDst('2026-03-27', 3, ['10', '11']);
  assert.equal(councilStreak(t, 'Europe/Berlin', '2026-03-30T08:00:00Z').current, 3);
});
