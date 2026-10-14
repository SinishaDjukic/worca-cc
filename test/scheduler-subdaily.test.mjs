// test/scheduler-subdaily.test.mjs
// Sub-daily series in the due loop: one catch-up after a downtime (the slots in between are
// reported missed), missed slots that never pause the series, and quiet overlap skips.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSchedule, getSchedule, listTickets, runDueTickets } from '../src/core/scheduler.mjs';
import { listNotifications } from '../src/core/notifications.mjs';

useTempHome(after);
const DIR = '/tmp/worca-sched-subdaily';
const REQ = { projectDir: DIR, prompt: 'Poll the queue', workflowId: 'wf_default' };
const T0 = Date.parse('2026-09-18T08:00:00Z'); // Friday 10:00 Berlin
const every15 = { freq: 'daily', step: { minutes: 15 }, tz: 'Europe/Berlin', anchor: '2026-09-18' };
const okStart = () => async () => ({ ok: true });
const kinds = () => listNotifications().map((n) => n.kind).reverse();
beforeEach(() => { getDb().exec('DELETE FROM scheduled_runs; DELETE FROM schedules; DELETE FROM notifications; DELETE FROM pipelines;'); });

test('after a downtime a sub-daily series starts ONE catch-up and reports the passed slots missed', async () => {
  const { schedule, ticket } = createSchedule({ title: 'Q', projectDir: DIR, request: REQ, rule: every15, graceMin: 360, now: T0 });
  assert.equal(ticket.runAt, '2026-09-18T08:15:00.000Z');
  const back = Date.parse('2026-09-18T10:05:00Z'); // 1 h 50 min later: 7 more slots passed (08:30 … 10:00)
  const started = [];
  const out = await runDueTickets({ now: back, start: async (t) => { started.push(t.runAt); return { ok: true }; } });
  assert.deepEqual(started, ['2026-09-18T08:15:00.000Z']);
  assert.equal(out.fired.length, 1);
  const missed = listNotifications().find((n) => n.kind === 'missed');
  assert.match(missed.message, /^missed 7 slots, up to 2026-09-18T10:00:00\.000Z, while Worca was not running\./);
  const s = getSchedule(schedule.id);
  assert.equal(s.nextRunAt, '2026-09-18T10:15:00.000Z'); // the grid resumes
  assert.equal(s.failureStreak, 0);
  assert.equal(listTickets({ scheduleId: schedule.id, all: true }).length, 2); // no row per passed slot
});

test('beyond the grace: one missed ticket names the passed slots and the streak does not move', async () => {
  const { schedule } = createSchedule({ title: 'Q', projectDir: DIR, request: REQ, rule: every15, graceMin: 30, maxFailures: 1, now: T0 });
  const out = await runDueTickets({ now: Date.parse('2026-09-18T09:20:00Z'), start: okStart() });
  assert.equal(out.missed.length, 1);
  assert.match(listNotifications()[0].message, /Worca was not running\. 4 slots after it, up to 2026-09-18T09:15:00\.000Z, passed too\./);
  const s = getSchedule(schedule.id);
  assert.equal(s.status, 'active'); // maxFailures 1 would have paused a daily series
  assert.equal(s.failureStreak, 0);
  assert.equal(s.nextRunAt, '2026-09-18T09:30:00.000Z');
});

test('ifMissed skip on a sub-daily series misses without a catch-up and without a streak', async () => {
  const { schedule } = createSchedule({ title: 'Q', projectDir: DIR, request: REQ, rule: every15, ifMissed: 'skip', maxFailures: 1, now: T0 });
  const out = await runDueTickets({ now: Date.parse('2026-09-18T08:20:00Z'), start: okStart() });
  assert.equal(out.fired.length, 0);
  assert.equal(out.missed.length, 1);
  assert.equal(getSchedule(schedule.id).status, 'active');
});

test('an overlap skip on a sub-daily series is recorded on the ticket, with no feed item', async () => {
  const { schedule, ticket } = createSchedule({ title: 'Q', projectDir: DIR, request: REQ, rule: every15, now: T0 });
  const live = new Set([ticket.id]);
  await runDueTickets({ now: Date.parse('2026-09-18T08:15:05Z'), start: okStart(), isLive: ({ id }) => live.has(id) });
  const out = await runDueTickets({ now: Date.parse('2026-09-18T08:30:05Z'), start: okStart(), isLive: ({ id }) => live.has(id) });
  assert.equal(out.skipped.length, 1);
  assert.equal(listTickets({ scheduleId: schedule.id, all: true }).find((t) => t.runAt === '2026-09-18T08:30:00.000Z').status, 'skipped');
  assert.equal(getSchedule(schedule.id).lastResult, 'skipped');
  assert.deepEqual(kinds(), []);
});

test('newestFirst keeps the latest occurrences when the history is longer than the limit', async () => {
  const { schedule } = createSchedule({ title: 'Q', projectDir: DIR, request: REQ, rule: every15, now: T0 });
  for (const at of ['08:15', '08:30', '08:45']) await runDueTickets({ now: Date.parse(`2026-09-18T${at}:05Z`), start: okStart() });
  const runAts = listTickets({ scheduleId: schedule.id, all: true, limit: 2, newestFirst: true }).map((t) => t.runAt);
  assert.deepEqual(runAts, ['2026-09-18T09:00:00.000Z', '2026-09-18T08:45:00.000Z']);
});
