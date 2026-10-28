// test/schedule-recurrence.test.mjs
// The shared recurrence module: timezone maths across DST edges, rule validation,
// next-occurrence selection, the sentence builder, and the CLI parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedToUtc, zonedParts, normalizeRule, nextOccurrence, previewOccurrences, describeRule,
  formatInstant, formatCountdown, parseEvery, parseCron, parseAt, parseScheduledFor, localDate,
  countOccurrences, isSubDaily, occurrenceStamp,
} from '../src/shared/schedule/recurrence.mjs';
import { checkRows } from './helpers/rows.mjs';

const BERLIN = 'Europe/Berlin';
const NY = 'America/New_York';
const Z = (s) => Date.parse(s);
const rule = (r, today = '2026-09-18') => {
  const n = normalizeRule({ tz: BERLIN, ...r }, { todayLocal: today });
  assert.equal(n.ok, true, n.error);
  return n.rule;
};

test('zoned time: zonedToUtc (plain/gap/fold) and zonedParts/localDate read wall-clock time', async () => {
  await checkRows([
    { name: 'zonedToUtc: plain, gap (spring forward) and fold (autumn) in Europe/Berlin', run: () => {
      assert.equal(zonedToUtc({ y: 2026, m: 9, d: 19, hh: 2, mm: 0 }, BERLIN), Z('2026-09-19T00:00:00Z'));
      // 2027-03-28 02:30 does not exist: it lands the same distance past the gap (03:30 CEST).
      assert.equal(zonedToUtc({ y: 2027, m: 3, d: 28, hh: 2, mm: 30 }, BERLIN), Z('2027-03-28T01:30:00Z'));
      // 2026-10-25 02:30 happens twice: the FIRST one (still CEST) wins.
      assert.equal(zonedToUtc({ y: 2026, m: 10, d: 25, hh: 2, mm: 30 }, BERLIN), Z('2026-10-25T00:30:00Z'));
    } },
    { name: 'zonedParts and localDate read wall-clock time in the zone', run: () => {
      const p = zonedParts(Z('2026-09-18T23:30:00Z'), BERLIN);
      assert.deepEqual([p.y, p.m, p.d, p.hh, p.mm], [2026, 9, 19, 1, 30]);
      assert.equal(localDate(Z('2026-09-18T23:30:00Z'), BERLIN), '2026-09-19');
      assert.equal(localDate(Z('2026-09-18T23:30:00Z'), NY), '2026-09-18');
    } },
  ]);
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

test('rule kinds: weekday, interval, monthly clamp/last and end conditions produce the right sentence and dates', async () => {
  await checkRows([
    { name: 'weekday rule: sentence and the next three dates', run: () => {
      const r = rule({ freq: 'weekly', weekdays: ['fr', 'mo', 'tu', 'we', 'th'], time: '2:00' });
      assert.equal(r.time, '02:00');
      assert.deepEqual(r.weekdays, ['mo', 'tu', 'we', 'th', 'fr']);
      assert.equal(describeRule(r), 'Every weekday at 02:00');
      const now = Z('2026-09-18T16:48:00Z'); // Friday evening
      assert.deepEqual(previewOccurrences(r, now, 3).map((t) => formatInstant(t, BERLIN)),
        ['Mon Sep 21, 02:00', 'Tue Sep 22, 02:00', 'Wed Sep 23, 02:00']);
    } },
    { name: 'interval rules count from the anchor', run: () => {
      const every3 = rule({ freq: 'daily', interval: 3, time: '06:00' }, '2026-09-18');
      assert.deepEqual(previewOccurrences(every3, Z('2026-09-18T12:00:00Z'), 3).map((t) => localDate(t, BERLIN)),
        ['2026-09-21', '2026-09-24', '2026-09-27']);
      const biweekly = rule({ freq: 'weekly', interval: 2, weekdays: ['mo'], time: '02:00' }, '2026-09-18');
      assert.deepEqual(previewOccurrences(biweekly, Z('2026-09-18T12:00:00Z'), 3).map((t) => localDate(t, BERLIN)),
        ['2026-09-28', '2026-10-12', '2026-10-26']);
      assert.equal(describeRule(biweekly), 'Every 2 weeks on Monday at 02:00');
    } },
    { name: 'monthly rules clamp to the last day and support "last"', run: () => {
      const r31 = rule({ freq: 'monthly', monthDay: 31, time: '03:00', tz: NY });
      assert.deepEqual(previewOccurrences(r31, Z('2026-09-18T16:00:00Z'), 3).map((t) => formatInstant(t, NY)),
        ['Wed Sep 30, 03:00', 'Sat Oct 31, 03:00', 'Mon Nov 30, 03:00']);
      const last = rule({ freq: 'monthly', monthDay: 'last', time: '03:00' });
      assert.equal(describeRule(last), 'Every month on the last day at 03:00');
      assert.equal(describeRule(rule({ freq: 'monthly', monthDay: 1, time: '03:00' })), 'Every month on the 1st at 03:00');
      assert.equal(describeRule(rule({ freq: 'monthly', monthDay: 22, time: '03:00' })), 'Every month on the 22nd at 03:00');
    } },
    { name: 'end conditions stop the series', run: () => {
      const until = rule({ freq: 'daily', time: '02:00', end: { type: 'until', until: '2026-09-20' } });
      assert.equal(previewOccurrences(until, Z('2026-09-18T12:00:00Z'), 10).length, 2);
      const count = rule({ freq: 'daily', time: '02:00', end: { type: 'count', count: 3 } });
      assert.equal(nextOccurrence(count, Z('2026-09-18T12:00:00Z'), { firedCount: 3 }), null);
      assert.equal(previewOccurrences(count, Z('2026-09-18T12:00:00Z'), 10, { firedCount: 1 }).length, 2);
      assert.equal(describeRule(count), 'Every day at 02:00, 3 times');
    } },
  ]);
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
  assert.equal(parseCron('0 2 * 6 *').ok, false);
  assert.equal(parseCron('0 2 *').ok, false);
});

test('parseAt reads local/relative/ISO forms; parseScheduledFor demands an offset', async () => {
  await checkRows([
    { name: 'parseAt reads local forms in the given zone and absolute ISO as-is', run: () => {
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
    } },
    { name: 'parseScheduledFor demands an offset', run: () => {
      assert.equal(parseScheduledFor('2026-09-19T02:00:00+02:00').ms, Z('2026-09-19T00:00:00Z'));
      assert.equal(parseScheduledFor('2026-09-19T02:00:00Z').ok, true);
      assert.match(parseScheduledFor('2026-09-19T02:00:00').error, /offset/);
      assert.equal(parseScheduledFor('tomorrow').ok, false);
      assert.equal(parseScheduledFor(42).ok, false);
    } },
  ]);
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(45_000), '45s');
  assert.equal(formatCountdown(12 * 60_000), '12m');
  assert.equal(formatCountdown(7 * 3600_000 + 12 * 60_000), '7h 12m');
  assert.equal(formatCountdown(76 * 3600_000), '3d 4h');
  assert.equal(formatCountdown(-5), '');
});

const iso = (t) => new Date(t).toISOString();
const refused = (r, re) => {
  const n = normalizeRule({ tz: BERLIN, ...r }, { todayLocal: '2026-09-18' });
  assert.equal(n.ok, false, JSON.stringify(n));
  assert.match(n.error, re);
};

test('sub-daily: every N minutes in a time range on weekdays', () => {
  const r = rule({ freq: 'weekly', weekdays: ['mo', 'tu', 'we', 'th', 'fr'], step: { minutes: 15, from: '09:00', to: '18:00' } });
  assert.deepEqual(r.step, { minutes: 15, from: '09:00', to: '18:00' });
  assert.equal('time' in r, false);
  assert.equal(isSubDaily(r), true);
  assert.equal(describeRule(r), 'Every 15 minutes, 09:00–18:00, weekdays');
  const now = Z('2026-09-18T15:40:00Z'); // Friday 17:40 Berlin
  assert.deepEqual(previewOccurrences(r, now, 4).map((t) => formatInstant(t, BERLIN)),
    ['Fri Sep 18, 17:45', 'Fri Sep 18, 18:00', 'Mon Sep 21, 09:00', 'Mon Sep 21, 09:15']);
});

test('sub-daily: a list of times, sorted and de-duplicated; one time is the classic rule', () => {
  const r = rule({ freq: 'daily', times: ['17:00', '09:00', '13:00', '09:00'] });
  assert.deepEqual(r.times, ['09:00', '13:00', '17:00']);
  assert.equal(describeRule(r), 'Every day at 09:00, 13:00 and 17:00');
  assert.deepEqual(rule({ freq: 'daily', times: ['9:00'] }), rule({ freq: 'daily', time: '09:00' }));
  assert.equal(isSubDaily(rule({ freq: 'daily', time: '02:00' })), false);
});

test('sub-daily sentences read naturally', () => {
  assert.equal(describeRule(rule({ freq: 'daily', step: { minutes: 60 } })), 'Every hour');
  assert.equal(describeRule(rule({ freq: 'daily', step: { minutes: 120 }, end: { type: 'count', count: 5 } })), 'Every 2 hours, 5 times');
  assert.equal(describeRule(rule({ freq: 'weekly', weekdays: ['mo', 'fr'], step: { minutes: 90, from: '08:00', to: '20:00' } })),
    'Every 90 minutes, 08:00–20:00, on Monday and Friday');
  assert.equal(describeRule(rule({ freq: 'monthly', monthDay: 1, step: { minutes: 30, from: '09:00', to: '12:00' } })),
    'Every 30 minutes, 09:00–12:00, on the 1st of every month');
  assert.equal(describeRule(rule({ freq: 'daily', interval: 2, step: { minutes: 45 } })), 'Every 45 minutes, every 2 days');
});

test('runs closer than 15 minutes are refused, across midnight too', () => {
  refused({ freq: 'daily', step: { minutes: 5 } }, /at least 15 minutes apart: every 5 minutes is too often/);
  refused({ freq: 'daily', times: ['09:00', '09:10'] }, /09:00 and 09:10 are 10 minutes apart/);
  refused({ freq: 'daily', step: { minutes: 17 } }, /23:48 and 00:00 the next day are 12 minutes apart/);
  refused({ freq: 'daily', times: ['00:05', '23:55'] }, /23:55 and 00:05 the next day are 10 minutes apart/);
  rule({ freq: 'weekly', weekdays: ['mo', 'we'], step: { minutes: 17 } });           // never two days in a row
  refused({ freq: 'weekly', weekdays: ['mo', 'su'], step: { minutes: 17 } }, /next day/); // Sunday -> Monday
  rule({ freq: 'weekly', interval: 2, weekdays: ['mo', 'su'], step: { minutes: 17 } }); // that Monday is skipped
  rule({ freq: 'daily', interval: 2, step: { minutes: 17 } });
  refused({ freq: 'daily', time: '02:00', step: { minutes: 15 } }, /one of time, times or step/);
  refused({ freq: 'daily', step: { minutes: 30, from: '18:00', to: '09:00' } }, /cross midnight/);
  refused({ freq: 'daily', step: { minutes: 7.5 } }, /whole number/);
  refused({ freq: 'daily', times: ['9am'] }, /HH:MM/);
});

test('sub-daily slots are wall-clock across DST: the spring gap has no run, the autumn hour runs once', () => {
  const spring = rule({ freq: 'daily', step: { minutes: 30, from: '01:00', to: '04:00' } }, '2027-03-27');
  assert.deepEqual(previewOccurrences(spring, Z('2027-03-27T23:00:00Z'), 5).map((t) => formatInstant(t, BERLIN)),
    ['Sun Mar 28, 01:00', 'Sun Mar 28, 01:30', 'Sun Mar 28, 03:00', 'Sun Mar 28, 03:30', 'Sun Mar 28, 04:00']);
  const autumn = rule({ freq: 'daily', step: { minutes: 30, from: '01:30', to: '03:30' } }, '2026-10-24');
  assert.deepEqual(previewOccurrences(autumn, Z('2026-10-24T22:00:00Z'), 5).map(iso), [
    '2026-10-24T23:30:00.000Z', // 01:30 CEST
    '2026-10-25T00:00:00.000Z', // 02:00 CEST (the first 02:00 only)
    '2026-10-25T00:30:00.000Z', // 02:30 CEST
    '2026-10-25T02:00:00.000Z', // 03:00 CET — the repeated hour does not run again
    '2026-10-25T02:30:00.000Z',
  ]);
  // A classic one-time rule keeps moving past the gap, as before.
  assert.equal(iso(nextOccurrence(rule({ freq: 'daily', time: '02:30' }, '2027-03-27'), Z('2027-03-27T12:00:00Z'))), '2027-03-28T01:30:00.000Z');
});

test('until and count keep working with sub-daily rules', () => {
  const u = rule({ freq: 'daily', step: { minutes: 60, from: '09:00', to: '11:00' }, end: { type: 'until', until: '2026-09-19' } });
  assert.equal(previewOccurrences(u, Z('2026-09-18T00:00:00Z'), 20).length, 6); // 3 a day, 2 days
  const c = rule({ freq: 'daily', times: ['09:00', '17:00'], end: { type: 'count', count: 3 } });
  assert.equal(previewOccurrences(c, Z('2026-09-18T00:00:00Z'), 20).length, 3);
  assert.equal(nextOccurrence(c, 0, { firedCount: 3 }), null);
});

test('countOccurrences and occurrenceStamp', () => {
  const r = rule({ freq: 'daily', step: { minutes: 15 } });
  const a = Z('2026-09-18T10:00:00Z');
  assert.deepEqual(countOccurrences(r, a, a + 3600_000), { count: 4, last: a + 3600_000 });
  assert.deepEqual(countOccurrences(r, a, a), { count: 0, last: null });
  assert.equal(countOccurrences(r, a, a + 7 * 86400_000).count, 672);
  assert.equal(occurrenceStamp(Z('2026-09-18T07:15:00Z'), r), '20260918-0915');
  assert.equal(occurrenceStamp(Z('2026-09-18T22:30:00Z'), rule({ freq: 'daily', time: '00:30' })), '20260919');
});

test('parseEvery: several times a day and every N minutes/hours', () => {
  assert.deepEqual(parseEvery('15m').rule, { freq: 'daily', interval: 1, step: { minutes: 15 } });
  assert.deepEqual(parseEvery('every 30 minutes 09:00-18:00 weekdays').rule,
    { freq: 'weekly', interval: 1, weekdays: ['mo', 'tu', 'we', 'th', 'fr'], step: { minutes: 30, from: '09:00', to: '18:00' } });
  assert.deepEqual(parseEvery('2h mon,wed').rule, { freq: 'weekly', interval: 1, weekdays: ['mo', 'we'], step: { minutes: 120 } });
  assert.deepEqual(parseEvery('hour 08:00-20:00').rule, { freq: 'daily', interval: 1, step: { minutes: 60, from: '08:00', to: '20:00' } });
  assert.deepEqual(parseEvery('day 09:00,13:00,17:00').rule, { freq: 'daily', interval: 1, times: ['09:00', '13:00', '17:00'] });
  assert.deepEqual(parseEvery('weekdays 08:00,20:00').rule.times, ['08:00', '20:00']);
  assert.equal(parseEvery('15m sometimes').ok, false);
  assert.equal(parseEvery('15m 25:00-26:00').ok, false);
  assert.equal(parseEvery('day 09:00,9am').ok, false);
});

test('parseCron maps */N, ranges and lists of minutes and hours', () => {
  assert.deepEqual(parseCron('*/15 * * * *').rule, { freq: 'daily', interval: 1, step: { minutes: 15 } });
  assert.deepEqual(parseCron('*/15 9-17 * * 1-5').rule,
    { freq: 'weekly', interval: 1, weekdays: ['mo', 'tu', 'we', 'th', 'fr'], step: { minutes: 15, from: '09:00', to: '17:45' } });
  assert.deepEqual(parseCron('0 */2 * * *').rule, { freq: 'daily', interval: 1, step: { minutes: 120 } });
  assert.deepEqual(parseCron('0 9-17 * * *').rule.step, { minutes: 60, from: '09:00', to: '17:00' });
  assert.deepEqual(parseCron('0 9,13,17 * * *').rule, { freq: 'daily', interval: 1, times: ['09:00', '13:00', '17:00'] });
  const tooOften = (cron, re) => assert.match(normalizeRule({ ...parseCron(cron).rule, tz: BERLIN }, { todayLocal: '2026-09-18' }).error, re);
  tooOften('*/5 * * * *', /at least 15 minutes apart: every 5 minutes is too often/);
  tooOften('0,10 * * * *', /10 minutes apart/);
  assert.equal(parseCron('x 2 * * *').ok, false);
  assert.equal(parseCron('0 25 * * *').ok, false);
});
