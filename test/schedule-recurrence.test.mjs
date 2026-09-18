// test/schedule-recurrence.test.mjs
// The shared recurrence module: timezone maths across DST edges, rule validation,
// next-occurrence selection, the sentence builder, and the CLI parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedToUtc, zonedParts, normalizeRule, nextOccurrence, previewOccurrences, describeRule,
  formatInstant, formatCountdown, parseEvery, parseCron, parseAt, parseScheduledFor, localDate,
} from '../src/shared/schedule/recurrence.mjs';

const BERLIN = 'Europe/Berlin';
const NY = 'America/New_York';
const Z = (s) => Date.parse(s);
const rule = (r, today = '2026-09-18') => {
  const n = normalizeRule({ tz: BERLIN, ...r }, { todayLocal: today });
  assert.equal(n.ok, true, n.error);
  return n.rule;
};

test('zonedToUtc: plain, gap (spring forward) and fold (autumn) in Europe/Berlin', () => {
  assert.equal(zonedToUtc({ y: 2026, m: 9, d: 19, hh: 2, mm: 0 }, BERLIN), Z('2026-09-19T00:00:00Z'));
  // 2027-03-28 02:30 does not exist: it lands the same distance past the gap (03:30 CEST).
  assert.equal(zonedToUtc({ y: 2027, m: 3, d: 28, hh: 2, mm: 30 }, BERLIN), Z('2027-03-28T01:30:00Z'));
  // 2026-10-25 02:30 happens twice: the FIRST one (still CEST) wins.
  assert.equal(zonedToUtc({ y: 2026, m: 10, d: 25, hh: 2, mm: 30 }, BERLIN), Z('2026-10-25T00:30:00Z'));
});

test('zonedParts and localDate read wall-clock time in the zone', () => {
  const p = zonedParts(Z('2026-09-18T23:30:00Z'), BERLIN);
  assert.deepEqual([p.y, p.m, p.d, p.hh, p.mm], [2026, 9, 19, 1, 30]);
  assert.equal(localDate(Z('2026-09-18T23:30:00Z'), BERLIN), '2026-09-19');
  assert.equal(localDate(Z('2026-09-18T23:30:00Z'), NY), '2026-09-18');
});

test('a nightly rule keeps its wall-clock time across a DST change', () => {
  const r = rule({ freq: 'daily', time: '02:00' }, '2026-10-23');
  const got = previewOccurrences(r, Z('2026-10-23T12:00:00Z'), 4).map((t) => new Date(t).toISOString());
  assert.deepEqual(got, [
    '2026-10-24T00:00:00.000Z', // CEST, UTC+2
    '2026-10-25T00:00:00.000Z', // the fold night fires ONCE
    '2026-10-26T01:00:00.000Z', // CET, UTC+1
    '2026-10-27T01:00:00.000Z',
  ]);
});

test('weekday rule: sentence and the next three dates', () => {
  const r = rule({ freq: 'weekly', weekdays: ['fr', 'mo', 'tu', 'we', 'th'], time: '2:00' });
  assert.equal(r.time, '02:00');
  assert.deepEqual(r.weekdays, ['mo', 'tu', 'we', 'th', 'fr']);
  assert.equal(describeRule(r), 'Every weekday at 02:00');
  const now = Z('2026-09-18T16:48:00Z'); // Friday evening
  assert.deepEqual(previewOccurrences(r, now, 3).map((t) => formatInstant(t, BERLIN)),
    ['Mon Sep 21, 02:00', 'Tue Sep 22, 02:00', 'Wed Sep 23, 02:00']);
});

test('interval rules count from the anchor', () => {
  const every3 = rule({ freq: 'daily', interval: 3, time: '06:00' }, '2026-09-18');
  assert.deepEqual(previewOccurrences(every3, Z('2026-09-18T12:00:00Z'), 3).map((t) => localDate(t, BERLIN)),
    ['2026-09-21', '2026-09-24', '2026-09-27']);
  const biweekly = rule({ freq: 'weekly', interval: 2, weekdays: ['mo'], time: '02:00' }, '2026-09-18');
  assert.deepEqual(previewOccurrences(biweekly, Z('2026-09-18T12:00:00Z'), 3).map((t) => localDate(t, BERLIN)),
    ['2026-09-28', '2026-10-12', '2026-10-26']);
  assert.equal(describeRule(biweekly), 'Every 2 weeks on Monday at 02:00');
});

test('monthly rules clamp to the last day and support "last"', () => {
  const r31 = rule({ freq: 'monthly', monthDay: 31, time: '03:00', tz: NY });
  assert.deepEqual(previewOccurrences(r31, Z('2026-09-18T16:00:00Z'), 3).map((t) => formatInstant(t, NY)),
    ['Wed Sep 30, 03:00', 'Sat Oct 31, 03:00', 'Mon Nov 30, 03:00']);
  const last = rule({ freq: 'monthly', monthDay: 'last', time: '03:00' });
  assert.equal(describeRule(last), 'Every month on the last day at 03:00');
  assert.equal(describeRule(rule({ freq: 'monthly', monthDay: 1, time: '03:00' })), 'Every month on the 1st at 03:00');
  assert.equal(describeRule(rule({ freq: 'monthly', monthDay: 22, time: '03:00' })), 'Every month on the 22nd at 03:00');
});

test('end conditions stop the series', () => {
  const until = rule({ freq: 'daily', time: '02:00', end: { type: 'until', until: '2026-09-20' } });
  assert.equal(previewOccurrences(until, Z('2026-09-18T12:00:00Z'), 10).length, 2);
  const count = rule({ freq: 'daily', time: '02:00', end: { type: 'count', count: 3 } });
  assert.equal(nextOccurrence(count, Z('2026-09-18T12:00:00Z'), { firedCount: 3 }), null);
  assert.equal(previewOccurrences(count, Z('2026-09-18T12:00:00Z'), 10, { firedCount: 1 }).length, 2);
  assert.equal(describeRule(count), 'Every day at 02:00, 3 times');
});

test('normalizeRule rejects bad input with a readable reason', () => {
  const bad = (r, re) => { const n = normalizeRule(r, { todayLocal: '2026-09-18' }); assert.equal(n.ok, false); assert.match(n.error, re); };
  bad(null, /must be an object/);
  bad({ freq: 'hourly', time: '02:00', tz: BERLIN }, /freq/);
  bad({ freq: 'daily', time: '25:00', tz: BERLIN }, /HH:MM/);
  bad({ freq: 'daily', time: '02:00', tz: 'Mars/Olympus' }, /timezone/);
  bad({ freq: 'weekly', time: '02:00', tz: BERLIN, weekdays: [] }, /at least one day/);
  bad({ freq: 'weekly', time: '02:00', tz: BERLIN, weekdays: ['xx'] }, /mo tu we/);
  bad({ freq: 'monthly', time: '02:00', tz: BERLIN, monthDay: 32 }, /1-31/);
  bad({ freq: 'daily', time: '02:00', tz: BERLIN, interval: 0 }, /interval/);
  bad({ freq: 'daily', time: '02:00', tz: BERLIN, end: { type: 'count', count: 0 } }, /count/);
});

test('parseEvery covers the documented shorthand', () => {
  assert.deepEqual(parseEvery('day 03:30').rule, { freq: 'daily', interval: 1, time: '03:30' });
  assert.deepEqual(parseEvery('3 days 02:00').rule, { freq: 'daily', interval: 3, time: '02:00' });
  assert.deepEqual(parseEvery('weekdays 02:00').rule.weekdays, ['mo', 'tu', 'we', 'th', 'fr']);
  assert.deepEqual(parseEvery('weekends 09:00').rule.weekdays, ['sa', 'su']);
  assert.deepEqual(parseEvery('mon,wed,fri 02:00').rule.weekdays, ['mo', 'we', 'fr']);
  assert.deepEqual(parseEvery('2 weeks mon,thu 02:00').rule, { freq: 'weekly', interval: 2, weekdays: ['mo', 'th'], time: '02:00' });
  assert.deepEqual(parseEvery('month last 02:00').rule, { freq: 'monthly', interval: 1, monthDay: 'last', time: '02:00' });
  assert.equal(parseEvery('sometimes').ok, false);
  assert.equal(parseEvery('week 02:00').ok, false);
  assert.equal(parseEvery('month 40 02:00').ok, false);
});

test('parseCron translates what a rule can express and refuses the rest', () => {
  assert.deepEqual(parseCron('0 2 * * 1-5').rule.weekdays, ['mo', 'tu', 'we', 'th', 'fr']);
  assert.deepEqual(parseCron('30 3 * * *').rule, { freq: 'daily', interval: 1, time: '03:30' });
  assert.deepEqual(parseCron('0 2 * * 0,6').rule.weekdays, ['sa', 'su']);
  assert.deepEqual(parseCron('0 2 15 * *').rule, { freq: 'monthly', interval: 1, monthDay: 15, time: '02:00' });
  assert.equal(parseCron('*/5 * * * *').ok, false);
  assert.equal(parseCron('0 2 * 6 *').ok, false);
  assert.equal(parseCron('0 2 *').ok, false);
});

test('parseAt reads local forms in the given zone and absolute ISO as-is', () => {
  const nowMs = Z('2026-09-18T16:48:00Z'); // 18:48 in Berlin
  const at = (s) => { const r = parseAt(s, { nowMs, tz: BERLIN }); assert.equal(r.ok, true, r.error); return new Date(r.ms).toISOString(); };
  assert.equal(at('02:00'), '2026-09-19T00:00:00.000Z');       // next 02:00
  assert.equal(at('22:00'), '2026-09-18T20:00:00.000Z');       // later today
  assert.equal(at('tomorrow 02:00'), '2026-09-19T00:00:00.000Z');
  assert.equal(at('+90m'), '2026-09-18T18:18:00.000Z');
  assert.equal(at('+2h'), '2026-09-18T18:48:00.000Z');
  assert.equal(at('2026-09-19 02:00'), '2026-09-19T00:00:00.000Z');
  assert.equal(at('2026-09-19T02:00:00+02:00'), '2026-09-19T00:00:00.000Z');
  assert.equal(at('2026-09-19T02:00:00Z'), '2026-09-19T02:00:00.000Z');
  assert.equal(parseAt('next week', { nowMs, tz: BERLIN }).ok, false);
  assert.equal(parseAt('26:00', { nowMs, tz: BERLIN }).ok, false);
});

test('parseScheduledFor demands an offset', () => {
  assert.equal(parseScheduledFor('2026-09-19T02:00:00+02:00').ms, Z('2026-09-19T00:00:00Z'));
  assert.equal(parseScheduledFor('2026-09-19T02:00:00Z').ok, true);
  assert.match(parseScheduledFor('2026-09-19T02:00:00').error, /offset/);
  assert.equal(parseScheduledFor('tomorrow').ok, false);
  assert.equal(parseScheduledFor(42).ok, false);
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(45_000), '45s');
  assert.equal(formatCountdown(12 * 60_000), '12m');
  assert.equal(formatCountdown(7 * 3600_000 + 12 * 60_000), '7h 12m');
  assert.equal(formatCountdown(76 * 3600_000), '3d 4h');
  assert.equal(formatCountdown(-5), '');
});
