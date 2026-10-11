// test/ui-activity-model.test.mjs — the top bar's Activity model (ui/public/activity-model.mjs):
// Needs you is the Runs badge's own rule (runs-list.mjs countNeedsYou), Running the sidebar's live runs less those,
// Scheduled groups one-off tickets and series by their next start, and the button's one badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countNeedsYou, rowTime } from '../ui/public/runs-list.mjs';
import {
  activityModel, activityCounts, badgeState, firstTab, schedTime, schedDayGroup, ACTIVITY_TABS, SCHED_GROUPS,
} from '../ui/public/activity-model.mjs';
import { checkRows } from './helpers/rows.mjs';

const NOW = Date.UTC(2026, 9, 8, 14, 15);            // Thu Oct 8 2026, 14:15 UTC
const utc = (d, h, m) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString();
const loc = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();   // run start times: the Runs list's local clock
const liveIt = (runId, extra = {}) => ({
  runId, pipelineId: '', title: runId, status: 'running', ask: null, pauseReason: '', unread: false,
  step: '', failedStep: '', startedAt: loc(8, 12, 34), groupKey: 'emp', groupName: 'Employee project',
  by: '', pr: null, checks: null, files: null, ...extra,
});
const histIt = (id, extra = {}) => ({
  id, projectKey: 'worca-2', title: id, status: 'done', pauseReason: null,
  startedAt: loc(8, 11, 17), mtime: 0, groupName: 'worca-cc', by: '', pr: null, checks: null, files: null, ...extra,
});
// Every edge of the Needs you rule: a question, a question while pausing / interrupted (not you),
// a pause, a failure unread and read, a lingering finished run, and a paused History row that is
// the same run as a live one (counted once) or a run this tab does not know (counted). `active` is
// what liveRuns() holds: the live ones, and a workspace scan the Runs list does not show.
const LIVE = {
  ask1: liveIt('ask1', { ask: { kind: 'workflow', step: 'Plan' }, groupName: 'Rollouts' }),
  pausing1: liveIt('pausing1', { status: 'pausing', ask: { kind: 'questions', step: '' } }),
  intr1: liveIt('intr1', { status: 'interrupted', ask: { kind: 'questions', step: '' } }),
  paused1: liveIt('paused1', { pipelineId: 'p1', status: 'paused', groupName: 'worca-cc', startedAt: loc(8, 9, 0) }),
  fail1: liveIt('fail1', { status: 'error', failedStep: 'Tester', unread: true }),
  fail2: liveIt('fail2', { status: 'error', unread: false }),
  run1: liveIt('run1', { step: 'Implement' }),
  start1: liveIt('start1', { status: 'starting' }),
  done1: liveIt('done1', { status: 'done', unread: true }),
};
const RUNS = {
  live: Object.values(LIVE),
  history: [histIt('p1', { status: 'paused' }), histIt('p9', { status: 'paused', startedAt: loc(7, 8, 0) }), histIt('p8', { status: 'error' })],
  active: [LIVE.ask1, LIVE.pausing1, LIVE.run1, LIVE.start1, liveIt('scan1', { title: 'Scan workspace', groupName: 'Platform' })],
};

test('Needs you holds exactly what the Runs badge counts; Running is the sidebar\'s live runs that do not need you', () => {
  const m = activityModel({ ...RUNS, now: NOW, tz: 'UTC' });
  assert.equal(m.counts.needs, countNeedsYou(RUNS), 'the same number as the sidebar Runs badge');
  assert.equal(m.needs.length, m.counts.needs);
  assert.deepEqual(m.needs.map((r) => r.key), ['live:ask1', 'live:paused1', 'hist:worca-2/p9', 'live:fail1'],
    'the Runs list order: questions, pauses (newest first), failures');
  assert.deepEqual(m.needs.map((r) => r.sub), ['Rollouts · Plan review', 'worca-cc · Paused', 'worca-cc · Paused', 'Employee project · Tester failed']);
  assert.deepEqual(m.needs.map((r) => r.href), ['#running/ask1', '#running/paused1', '#history/worca-2/p9', '#running/fail1']);
  assert.deepEqual(m.running.map((r) => r.key), ['live:pausing1', 'live:run1', 'live:start1', 'live:scan1'],
    'a workspace scan runs too; the question is under Needs you');
  assert.deepEqual(m.running.map((r) => r.sub),
    ['Employee project · Pausing', 'Employee project · Running · Implement', 'Employee project · Starting', 'Platform · Running']);
  assert.deepEqual(m.running.map((r) => r.href), ['#running/pausing1', '#running/run1', '#running/start1', '#running/scan1']);
  assert.equal(m.counts.running, 4);
  assert.deepEqual([...new Set([...m.needs, ...m.running].map((r) => r.tone))], ['need', 'run']);
  assert.equal(m.running[1].time, rowTime(loc(8, 12, 34), NOW), 'the start time, as on the Runs list');
  // The light items the badge reads on every frame give the same two numbers; with nothing needing
  // you, Running is every live run — the sidebar's grey Runs number.
  const light = {
    live: RUNS.live.map(({ runId, pipelineId, status, ask, unread }) => ({ runId, pipelineId, status, ask: ask != null, unread })),
    history: RUNS.history.map(({ id, status }) => ({ id, status })),
    active: RUNS.active.map(({ runId }) => ({ runId })),
  };
  assert.deepEqual(activityCounts(light), { needs: countNeedsYou(light), running: 4 });
  assert.equal(countNeedsYou(light), 4);
  assert.deepEqual(activityCounts({ active: light.active }), { needs: 0, running: light.active.length });
});

test('badge: the Needs you number (amber) over the running number, hidden at zero; the tooltip names both', async () => {
  await checkRows([
    { name: 'needs you wins', run: () => assert.deepEqual(badgeState({ needs: 4, running: 2 }), { tone: 'need', n: 4, title: '4 need you · 2 running' }) },
    { name: 'one needs you', run: () => assert.deepEqual(badgeState({ needs: 1, running: 0 }), { tone: 'need', n: 1, title: '1 needs you · 0 running' }) },
    { name: 'running only', run: () => assert.deepEqual(badgeState({ needs: 0, running: 3 }), { tone: 'run', n: 3, title: '0 need you · 3 running' }) },
    { name: 'nothing: hidden, no tooltip', run: () => assert.deepEqual(badgeState({ needs: 0, running: 0 }), { tone: '', n: 0, title: '' }) },
    { name: 'first non-empty tab, else Needs you', run: () => {
      assert.deepEqual(ACTIVITY_TABS, ['needs', 'running', 'scheduled']);
      assert.equal(firstTab({ needs: 2, running: 1, scheduled: 4 }), 'needs');
      assert.equal(firstTab({ needs: 0, running: 1, scheduled: 4 }), 'running');
      assert.equal(firstTab({ needs: 0, running: 0, scheduled: 4 }), 'scheduled');
      assert.equal(firstTab({ needs: 0, running: 0, scheduled: null }), 'needs', 'not loaded yet');
      assert.equal(firstTab({ needs: 0, running: 0, scheduled: 0 }), 'needs');
    } },
  ]);
});

const ticket = (id, extra = {}) => ({ id, scheduleId: null, title: id, status: 'scheduled', projectKey: 'billing', after: null, ...extra });
const series = (id, extra = {}) => ({ id, title: id, status: 'active', projectKey: 'billing', sentence: 'Every day at 02:00', nextRunAt: null, ...extra });
const SCHED = {
  tickets: [
    ticket('later1', { runAt: utc(19, 6, 0) }),
    ticket('today2', { runAt: utc(8, 22, 0) }),
    ticket('missed1', { status: 'missed', runAt: utc(7, 9, 0) }),
    ticket('today1', { runAt: utc(8, 13, 0), queued: true }),
    ticket('after1', { runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'pipeline', id: 'p5', title: 'Add rate limiter', status: 'running' } }),
    ticket('occ1', { scheduleId: 'nightly', runAt: utc(9, 2, 0) }),
    ticket('firing1', { status: 'firing', runAt: utc(8, 14, 0) }),
  ],
  schedules: [
    series('nightly', { nextRunAt: utc(9, 2, 0) }),
    series('paused1', { status: 'paused' }),
    series('weekly', { nextRunAt: utc(12, 6, 0), sentence: 'Every Monday at 06:00', projectKey: 'shared-lib' }),
    series('sat', { nextRunAt: utc(10, 9, 0) }),
    series('ended1', { status: 'ended' }),
  ],
};

test('Scheduled: one-off tickets and series, grouped Missed · Today · Tomorrow · This week · Later · After a run, by next start', () => {
  const m = activityModel({ ...SCHED, now: NOW, tz: 'UTC' });
  assert.deepEqual(SCHED_GROUPS.map(([, label]) => label), ['Missed', 'Today', 'Tomorrow', 'This week', 'Later', 'After a run']);
  const g = m.scheduled.groups;
  assert.deepEqual(g.map((x) => x.label), ['Missed', 'Today', 'Tomorrow', 'This week', 'Later', 'After a run']);
  assert.deepEqual(g.map((x) => x.rows.map((r) => r.title)),
    [['missed1'], ['today1', 'today2'], ['nightly'], ['sat'], ['weekly', 'later1', 'paused1'], ['after1']],
    'a series stands for its own occurrences; firing and ended ones are not listed');
  assert.deepEqual(g.map((x) => x.rows.map((r) => r.time)),
    [['Wed 09:00'], ['Thu 13:00', 'Thu 22:00'], ['Fri 02:00'], ['Sat 09:00'], ['Mon 06:00', 'Mon Oct 19, 06:00', 'Paused'], ['Waiting']]);
  assert.deepEqual(g.flatMap((x) => x.rows.map((r) => r.href)),
    ['#schedules/once', '#schedules/once', '#schedules/once', '#schedules/repeating', '#schedules/repeating',
      '#schedules/repeating', '#schedules/once', '#schedules/repeating', '#schedules/once']);
  assert.equal(g[3].rows[0].sub, 'billing · Every day at 02:00');
  assert.equal(g[4].rows[0].sub, 'shared-lib · Every Monday at 06:00');
  assert.equal(g[1].rows[0].sub, 'billing · Once');
  assert.equal(g[5].rows[0].sub, 'billing · After ‘Add rate limiter’');
  assert.deepEqual(g.map((x) => x.rows[0].tone), ['need', 'idle', 'idle', 'idle', 'idle', 'idle'], 'a missed run is amber');
  assert.equal(m.counts.scheduled, 9, 'the count is the rows listed');
  assert.equal(m.counts.scheduled, g.reduce((n, x) => n + x.rows.length, 0));
});

test('Scheduled before the first load has no rows and no number; the place comes from placeOf; the time zone is honoured', async () => {
  await checkRows([
    { name: 'not loaded', run: () => {
      const m = activityModel({ now: NOW, tz: 'UTC' });
      assert.deepEqual(m.scheduled, { loaded: false, total: 0, groups: [] });
      assert.equal(m.counts.scheduled, null);
      const empty = activityModel({ tickets: [], schedules: [], now: NOW, tz: 'UTC' });
      assert.equal(empty.counts.scheduled, 0);
      assert.equal(empty.scheduled.loaded, true);
    } },
    { name: 'placeOf names the project', run: () => {
      const m = activityModel({ tickets: [ticket('t', { runAt: utc(8, 22, 0) })], schedules: [], now: NOW, tz: 'UTC', placeOf: (x) => `P:${x.projectKey}` });
      assert.equal(m.scheduled.groups[0].rows[0].sub, 'P:billing · Once');
    } },
    { name: 'a missed after-ticket has no time (its runAt is the sentinel)', run: () => {
      const m = activityModel({ tickets: [ticket('a', { status: 'missed', runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'ticket', id: 'x', title: null } })], schedules: [], now: NOW, tz: 'UTC' });
      assert.deepEqual(m.scheduled.groups.map((x) => [x.label, x.rows[0].time, x.rows[0].sub]), [['Missed', '', 'billing · After ‘the run before it’']]);
    } },
    { name: 'Tokyo: 20:00 UTC on Thursday is Friday 05:00, tomorrow', run: () => {
      const ms = Date.parse(utc(8, 20, 0));
      assert.equal(schedDayGroup(ms, NOW, 'Asia/Tokyo'), 'tomorrow');
      assert.equal(schedTime(ms, NOW, 'Asia/Tokyo'), 'Fri 05:00');
      assert.equal(schedDayGroup(ms, NOW, 'UTC'), 'today');
    } },
    { name: 'This week ends on Sunday', run: () => {
      assert.equal(schedDayGroup(Date.parse(utc(11, 23, 0)), NOW, 'UTC'), 'week');
      assert.equal(schedDayGroup(Date.parse(utc(12, 0, 30)), NOW, 'UTC'), 'later');
      const sat = Date.UTC(2026, 9, 10, 12, 0);
      assert.equal(schedDayGroup(Date.parse(utc(12, 6, 0)), sat, 'UTC'), 'later', 'Saturday: Monday is next week');
      assert.equal(schedDayGroup(Date.parse(utc(11, 6, 0)), sat, 'UTC'), 'tomorrow');
    } },
  ]);
});

test('Scheduled day edges: midnight is the zone\'s, not UTC\'s; a week with a DST change keeps its days', async () => {
  const NY = 'America/New_York';                     // UTC-4 in October: NOW is Thu 10:15 there
  const B = 'Europe/Berlin';                         // leaves summer time on Sun Oct 25 2026, 03:00 → 02:00
  await checkRows([
    { name: 'New York: Thu 23:59 is today, Fri 00:01 tomorrow (both Friday in UTC)', run: () => {
      assert.equal(schedDayGroup(Date.parse('2026-10-09T03:59:00Z'), NOW, NY), 'today');
      assert.equal(schedTime(Date.parse('2026-10-09T03:59:00Z'), NOW, NY), 'Thu 23:59');
      assert.equal(schedDayGroup(Date.parse('2026-10-09T04:01:00Z'), NOW, NY), 'tomorrow');
      assert.equal(schedTime(Date.parse('2026-10-09T04:01:00Z'), NOW, NY), 'Fri 00:01');
    } },
    { name: 'now at 23:59: a start two minutes on is tomorrow, one a minute ago is today', run: () => {
      const late = Date.parse('2026-10-09T03:59:00Z');
      assert.equal(schedDayGroup(Date.parse('2026-10-09T04:01:00Z'), late, NY), 'tomorrow');
      assert.equal(schedDayGroup(Date.parse('2026-10-09T03:58:00Z'), late, NY), 'today');
    } },
    { name: 'Berlin, the week of the change: Sun 23:30 is this week, Mon 00:30 later (a 25-hour Sunday)', run: () => {
      const thu = Date.UTC(2026, 9, 22, 12, 0);      // Thu Oct 22, 14:00 in Berlin (UTC+2)
      assert.equal(schedDayGroup(Date.parse('2026-10-25T22:30:00Z'), thu, B), 'week');
      assert.equal(schedTime(Date.parse('2026-10-25T22:30:00Z'), thu, B), 'Sun 23:30');
      assert.equal(schedDayGroup(Date.parse('2026-10-25T23:30:00Z'), thu, B), 'later');
      assert.equal(schedTime(Date.parse('2026-10-25T23:30:00Z'), thu, B), 'Mon 00:30');
      assert.equal(schedDayGroup(Date.parse('2026-10-22T22:30:00Z'), thu, B), 'tomorrow', 'Fri 00:30 CEST is Thursday in UTC');
    } },
  ]);
});
