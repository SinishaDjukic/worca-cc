// test/scheduler.test.mjs
// The launch-ticket store and the due loop, with an injected clock and start function:
// lifecycle, the claim race, missed slots + grace, transient retry, recurring series
// (materialise next, overlap policies, failure streak, end), ownership, recovery.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  createTicket, getTicket, listTickets, updateTicket, cancelTicket, requestRunNow, claimTicket,
  releaseTicket, setTicketPipeline, createSchedule, getSchedule, listSchedules, updateSchedule,
  pauseSchedule, resumeSchedule, skipNext, runScheduleNow, deleteSchedule, cancelForTarget,
  dependentsOfWorkflow, dueTickets, runDueTickets, recordOutcome, recoverScheduler, purgeScheduler,
  scheduleCounts, summarizeRequest, RETRY_BACKOFF_MIN,
} from '../src/core/scheduler.mjs';
import { listNotifications, unreadCount } from '../src/core/notifications.mjs';

useTempHome(after);

const T0 = Date.parse('2026-09-18T16:00:00Z'); // Friday 18:00 Berlin
const MIN = 60_000;
const HOUR = 3600_000;
const DIR = '/tmp/worca-sched-proj';
const REQ = { projectDir: DIR, prompt: 'Upgrade dependencies', workflowId: 'wf_default' };
const nightly = { freq: 'daily', time: '02:00', tz: 'Europe/Berlin', anchor: '2026-09-18' };
const okStart = (extra = {}) => async () => ({ ok: true, ...extra });
const kinds = () => listNotifications().map((n) => n.kind).reverse();

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM scheduled_runs; DELETE FROM schedules; DELETE FROM notifications; DELETE FROM pipelines;');
});

test('a one-shot ticket waits, fires once, and records its pipeline', async () => {
  const t = createTicket({ projectDir: DIR, title: 'Upgrade', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.equal(t.status, 'scheduled');
  assert.equal(t.scheduledFor, new Date(T0 + HOUR).toISOString());
  assert.equal(t.summary.prompt, 'Upgrade dependencies');
  assert.equal(dueTickets({ now: T0 + 59 * MIN }).length, 0);

  const started = [];
  const out = await runDueTickets({ now: T0 + HOUR + 5_000, start: async (tk) => { started.push(tk.id); return { ok: true }; } });
  assert.deepEqual(out.fired, [t.id]);
  assert.deepEqual(started, [t.id]);
  assert.equal(getTicket(t.id).status, 'fired');
  // A second tick never starts it again.
  const again = await runDueTickets({ now: T0 + HOUR + 40_000, start: async () => { throw new Error('must not start twice'); } });
  assert.deepEqual(again.fired, []);

  seedPipelineRow({ id: 'abcd1234', status: 'running', startedAt: new Date(T0 + HOUR).toISOString() });
  setTicketPipeline(t.id, 'abcd1234');
  assert.equal(getTicket(t.id).pipelineId, 'abcd1234');
  const row = getDb().prepare('SELECT scheduled_for, schedule_id FROM pipelines WHERE id = ?').get('abcd1234');
  assert.equal(row.scheduled_for, t.runAt);
  assert.equal(row.schedule_id, null);
});

test('the claim is exclusive: only one process starts a ticket', () => {
  const t = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, now: T0 });
  assert.equal(claimTicket(t.id, { pid: 111, host: 'a' }), true);
  assert.equal(claimTicket(t.id, { pid: 222, host: 'b' }), false);
  assert.equal(getTicket(t.id).status, 'firing');
});

test('missed slots: late inside the grace window starts late, beyond it is missed', async () => {
  const late = createTicket({ projectDir: DIR, title: 'Late', runAtMs: T0, request: REQ, graceMin: 360, now: T0 - HOUR });
  const gone = createTicket({ projectDir: DIR, title: 'Gone', runAtMs: T0 - 8 * HOUR, request: REQ, graceMin: 360, now: T0 - 9 * HOUR });
  const skip = createTicket({ projectDir: DIR, title: 'Skip', runAtMs: T0, request: REQ, ifMissed: 'skip', now: T0 - HOUR });
  const out = await runDueTickets({ now: T0 + 2 * HOUR, start: okStart() });
  assert.deepEqual(out.fired, [late.id]);
  assert.deepEqual(out.missed.sort(), [gone.id, skip.id].sort());
  assert.equal(getTicket(gone.id).status, 'missed');
  assert.deepEqual(kinds().sort(), ['late', 'missed', 'missed']);
  assert.equal(unreadCount(), 2); // `late` is info and arrives read

  // Run now on a missed ticket: it starts and the alarm resolves itself.
  assert.ok(requestRunNow(gone.id, { now: T0 + 3 * HOUR }));
  const again = await runDueTickets({ now: T0 + 3 * HOUR, start: okStart() });
  assert.deepEqual(again.fired, [gone.id]);
  assert.equal(listNotifications({ unread: true }).filter((n) => n.ticketId === gone.id).length, 0);
});

test('reschedule and cancel', () => {
  const t = createTicket({ projectDir: DIR, runAtMs: T0 + HOUR, request: REQ, now: T0 });
  const moved = updateTicket(t.id, { runAtMs: T0 + 5 * HOUR, ifMissed: 'skip' }, { now: T0 });
  assert.equal(moved.runAt, new Date(T0 + 5 * HOUR).toISOString());
  assert.equal(moved.ifMissed, 'skip');
  assert.equal(cancelTicket(t.id).status, 'canceled');
  assert.equal(cancelTicket(t.id), null);
  assert.equal(updateTicket(t.id, { runAtMs: T0 + HOUR }), null);
  assert.equal(listTickets().length, 0);
  assert.equal(listTickets({ all: true }).length, 1);
});

test('a transient start error retries with backoff, then fails past the grace window', async () => {
  const t = createTicket({ projectDir: DIR, title: 'Issue 12', runAtMs: T0, request: REQ, graceMin: 10, now: T0 - HOUR });
  const flaky = async () => ({ ok: false, transient: true, error: 'network unreachable' });
  let out = await runDueTickets({ now: T0 + 1_000, start: flaky });
  assert.deepEqual(out.retried, [t.id]);
  let cur = getTicket(t.id);
  assert.equal(cur.status, 'scheduled');
  assert.equal(cur.attempts, 1);
  assert.equal(cur.retryAt, new Date(T0 + 1_000 + RETRY_BACKOFF_MIN[0] * MIN).toISOString());
  // Not due again until the retry delay has passed.
  assert.equal(dueTickets({ now: T0 + 30_000 }).length, 0);
  out = await runDueTickets({ now: T0 + 2 * MIN, start: flaky });
  assert.deepEqual(out.retried, [t.id]);
  // Attempt 3 would land past run_at + grace (10 min): it fails instead.
  out = await runDueTickets({ now: T0 + 8 * MIN, start: flaky });
  assert.deepEqual(out.failed, [t.id]);
  cur = getTicket(t.id);
  assert.equal(cur.status, 'failed');
  assert.match(cur.failReason, /network/);
  assert.deepEqual(kinds(), ['retrying', 'failed']); // one "retrying" note, not one per attempt
});

test('a permanent start error fails at once', async () => {
  const t = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, now: T0 - HOUR });
  const out = await runDueTickets({ now: T0, start: async () => ({ ok: false, error: 'total cost limit reached' }) });
  assert.deepEqual(out.failed, [t.id]);
  assert.equal(listNotifications()[0].kind, 'failed');
  // a throwing start is a permanent failure too
  const t2 = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, now: T0 - HOUR });
  const out2 = await runDueTickets({ now: T0, start: async () => { throw new Error('boom'); } });
  assert.deepEqual(out2.failed, [t2.id]);
});

test('a recurring schedule materialises only its next occurrence, and the next after a start', async () => {
  const { schedule, ticket } = createSchedule({ title: 'Nightly', projectDir: DIR, request: REQ, rule: nightly, now: T0 });
  assert.equal(schedule.sentence, 'Every day at 02:00');
  assert.equal(ticket.runAt, '2026-09-19T00:00:00.000Z');
  assert.equal(schedule.nextRunAt, ticket.runAt);
  assert.equal(listTickets({ scheduleId: schedule.id }).length, 1);

  const at = Date.parse(ticket.runAt) + 10_000;
  const out = await runDueTickets({ now: at, start: okStart() });
  assert.deepEqual(out.fired, [ticket.id]);
  const s = getSchedule(schedule.id);
  assert.equal(s.runsCount, 1);
  assert.equal(s.nextRunAt, '2026-09-20T00:00:00.000Z');
  const open = listTickets({ scheduleId: schedule.id });
  assert.equal(open.length, 1);
  assert.notEqual(open[0].id, ticket.id);

  recordOutcome(ticket.id, { status: 'done', pipelineId: null, now: at + HOUR });
  assert.equal(getSchedule(schedule.id).lastResult, 'completed');
  assert.equal(listNotifications()[0].kind, 'completed');
  assert.equal(unreadCount(), 0);
});

test('overlap policies: skip, queue, start', async () => {
  const mk = (overlap) => createSchedule({ title: overlap, projectDir: DIR, request: REQ, rule: nightly, overlap, now: T0 });
  const live = new Set();
  const isLive = ({ id }) => live.has(id);
  const day1 = Date.parse('2026-09-19T00:00:05Z');
  const day2 = Date.parse('2026-09-20T00:00:05Z');

  const a = mk('skip'); const b = mk('queue'); const c = mk('start');
  await runDueTickets({ now: day1, start: okStart(), isLive });
  for (const s of [a, b, c]) live.add(s.ticket.id); // night one is still running on night two

  const out = await runDueTickets({ now: day2, start: okStart(), isLive });
  const next = (s) => listTickets({ scheduleId: s.schedule.id, all: true }).find((t) => t.runAt === '2026-09-20T00:00:00.000Z');
  assert.equal(next(a).status, 'skipped');
  assert.equal(next(b).status, 'scheduled');
  assert.equal(next(b).queued, true);
  assert.equal(next(c).status, 'fired');
  assert.deepEqual(out.skipped, [next(a).id]);
  assert.ok(listNotifications().some((n) => n.kind === 'skipped' && n.severity === 'info'));
  // the skipped series already has night three lined up
  assert.ok(listTickets({ scheduleId: a.schedule.id }).some((t) => t.runAt === '2026-09-21T00:00:00.000Z'));

  // The previous run ends: the queued occurrence starts on the next tick.
  live.clear();
  const out2 = await runDueTickets({ now: day2 + 45 * MIN, start: okStart(), isLive });
  assert.deepEqual(out2.fired, [next(b).id]);
});

test('overlap reads the pipelines table when the host has no live view', async () => {
  const { schedule, ticket } = createSchedule({ title: 'db', projectDir: DIR, request: REQ, rule: nightly, now: T0 });
  await runDueTickets({ now: Date.parse(ticket.runAt) + 1000, start: okStart({ pipelineId: 'feed0001' }) });
  seedPipelineRow({ id: 'feed0001', status: 'running', startedAt: ticket.runAt });
  const out = await runDueTickets({ now: Date.parse('2026-09-20T00:00:05Z'), start: okStart() });
  assert.equal(out.skipped.length, 1);
  getDb().prepare("UPDATE pipelines SET status = 'paused' WHERE id = 'feed0001'").run();
  const out2 = await runDueTickets({ now: Date.parse('2026-09-21T00:00:05Z'), start: okStart() });
  assert.equal(out2.fired.length, 1, 'a paused previous run does not block the next occurrence');
  assert.equal(getSchedule(schedule.id).runsCount, 2);
});

test('failure streak: three failures in a row pause the series; resume resets it', async () => {
  const { schedule } = createSchedule({ title: 'Weekly deps', projectDir: DIR, request: REQ, rule: nightly, maxFailures: 3, now: T0 });
  const fail = async () => ({ ok: false, error: 'GitHub token rejected' });
  for (const day of ['19', '20', '21']) await runDueTickets({ now: Date.parse(`2026-09-${day}T00:00:05Z`), start: fail });
  const s = getSchedule(schedule.id);
  assert.equal(s.status, 'paused');
  assert.equal(s.pauseReason, 'failure_streak');
  assert.equal(s.failureStreak, 3);
  assert.equal(s.nextRunAt, null);
  assert.equal(listTickets({ scheduleId: schedule.id }).length, 0, 'a paused series has no pending occurrence');
  assert.deepEqual(kinds(), ['failed', 'failed', 'failed', 'paused']);

  const resumed = resumeSchedule(schedule.id, { now: Date.parse('2026-09-21T09:00:00Z') });
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.failureStreak, 0);
  assert.equal(resumed.nextRunAt, '2026-09-22T00:00:00.000Z');
  assert.equal(listNotifications({ unread: true }).filter((n) => n.kind === 'paused').length, 0);
});

test('a run that ends in error counts towards the streak; done resets it; stopped and paused do not count', async () => {
  const { schedule } = createSchedule({ title: 'S', projectDir: DIR, request: REQ, rule: nightly, maxFailures: 2, now: T0 });
  const night = async (day) => {
    const out = await runDueTickets({ now: Date.parse(`2026-09-${day}T00:00:05Z`), start: okStart() });
    return out.fired[0];
  };
  recordOutcome(await night('19'), { status: 'error', detail: 'tests failed' });
  assert.equal(getSchedule(schedule.id).failureStreak, 1);
  recordOutcome(await night('20'), { status: 'stopped' });
  recordOutcome(await night('21'), { status: 'paused', reason: 'usage_limit' });
  assert.equal(getSchedule(schedule.id).failureStreak, 1);
  assert.equal(getSchedule(schedule.id).status, 'active');
  recordOutcome(await night('22'), { status: 'done' });
  assert.equal(getSchedule(schedule.id).failureStreak, 0);
  assert.ok(kinds().includes('run_paused'));
  // maxFailures 0 never pauses
  const never = createSchedule({ title: 'N', projectDir: DIR, request: REQ, rule: nightly, maxFailures: 0, now: T0 });
  for (const day of ['19', '20', '21', '22']) await runDueTickets({ now: Date.parse(`2026-09-${day}T00:00:05Z`), start: async () => ({ ok: false, error: 'x' }), });
  assert.equal(getSchedule(never.schedule.id).status, 'active');
});

test('catch-up after downtime starts at most one late occurrence', async () => {
  const { schedule } = createSchedule({ title: 'C', projectDir: DIR, request: REQ, rule: nightly, graceMin: 360, now: T0 });
  // The server was down for four nights and comes back at 03:00 Berlin on the 23rd.
  const back = Date.parse('2026-09-23T01:00:00Z');
  const started = [];
  let out = await runDueTickets({ now: back, start: async (t) => { started.push(t.runAt); return { ok: true }; } });
  // The pending ticket (night of the 19th) is long past its grace: missed, not replayed.
  assert.equal(out.missed.length, 1);
  assert.deepEqual(started, []);
  // The next slot is computed from NOW, so the 20th-22nd are never replayed.
  assert.equal(getSchedule(schedule.id).nextRunAt, '2026-09-24T00:00:00.000Z');
  out = await runDueTickets({ now: back + MIN, start: okStart() });
  assert.deepEqual(out.fired, []);
});

test('the grace window of a series is capped at the time to its next occurrence', async () => {
  const hourlyish = { freq: 'daily', time: '02:00', tz: 'Europe/Berlin', anchor: '2026-09-18' };
  const { ticket } = createSchedule({ title: 'G', projectDir: DIR, request: REQ, rule: hourlyish, graceMin: 10080, now: T0 });
  // 25 hours late: inside the 7-day grace, but past the next occurrence -> missed.
  const out = await runDueTickets({ now: Date.parse(ticket.runAt) + 25 * HOUR, start: okStart() });
  assert.equal(out.missed.length, 1);
});

test('edit, skip next, run now, pause and delete a series', async () => {
  const { schedule, ticket } = createSchedule({ title: 'E', projectDir: DIR, request: REQ, rule: nightly, now: T0 });
  // Editing the rule REPLACES the pending occurrence.
  const edited = updateSchedule(schedule.id, { rule: { freq: 'weekly', weekdays: ['mo'], time: '06:00', tz: 'Europe/Berlin' }, overlap: 'queue' }, { now: T0 });
  assert.equal(edited.sentence, 'Every Monday at 06:00');
  assert.equal(edited.overlap, 'queue');
  assert.equal(getTicket(ticket.id), null);
  assert.equal(edited.nextRunAt, '2026-09-21T04:00:00.000Z');
  assert.throws(() => updateSchedule(schedule.id, { rule: { freq: 'weekly', weekdays: [], time: '06:00', tz: 'Europe/Berlin' } }), /at least one day/);
  assert.throws(() => updateSchedule(schedule.id, { overlap: 'sometimes' }), /overlap/);

  const skipped = skipNext(schedule.id, { now: T0 });
  assert.equal(skipped.nextRunAt, '2026-09-28T04:00:00.000Z');

  // Run now adds ONE extra occurrence; the series does not shift.
  const extra = runScheduleNow(schedule.id, { now: T0 });
  const out = await runDueTickets({ now: T0 + 1000, start: okStart() });
  assert.deepEqual(out.fired, [extra.id]);
  assert.equal(getSchedule(schedule.id).nextRunAt, '2026-09-28T04:00:00.000Z');
  assert.equal(listTickets({ scheduleId: schedule.id }).length, 1);

  assert.equal(pauseSchedule(schedule.id, { now: T0 }).status, 'paused');
  assert.equal(listTickets({ scheduleId: schedule.id }).length, 0);
  assert.equal(pauseSchedule(schedule.id), null);
  assert.equal(deleteSchedule(schedule.id), true);
  assert.equal(listSchedules().length, 0);
  assert.equal(listTickets({ all: true }).filter((t) => t.scheduleId === schedule.id).length, 0);
});

test('a series with an end condition ends and says so once', async () => {
  const rule = { ...nightly, end: { type: 'count', count: 1 } };
  const { schedule, ticket } = createSchedule({ title: 'Once-ish', projectDir: DIR, request: REQ, rule, now: T0 });
  await runDueTickets({ now: Date.parse(ticket.runAt) + 1000, start: okStart() });
  const s = getSchedule(schedule.id);
  assert.equal(s.status, 'ended');
  assert.equal(s.nextRunAt, null);
  assert.equal(listNotifications().filter((n) => n.kind === 'ended').length, 1);
  assert.throws(() => createSchedule({ projectDir: DIR, request: REQ, rule: { freq: 'daily', time: 'noon', tz: 'Europe/Berlin' } }), /HH:MM/);
});

test('a ticket owned by a live `--wait` process is left alone; a dead owner hands it back', async () => {
  const mine = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, ownerPid: 4242, ownerHost: hostname(), now: T0 - HOUR });
  let out = await runDueTickets({ now: T0 + 1000, start: okStart(), pid: 1, pidAlive: (p) => p === 4242 });
  assert.deepEqual(out.waiting, [mine.id]);
  assert.equal(getTicket(mine.id).status, 'scheduled');
  // the owner itself can claim and start it
  out = await runDueTickets({ now: T0 + 2000, start: okStart(), pid: 4242, onlyOwned: true, pidAlive: () => true });
  assert.deepEqual(out.fired, [mine.id]);

  const orphan = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, ownerPid: 4343, ownerHost: hostname(), now: T0 - HOUR });
  out = await runDueTickets({ now: T0 + 3000, start: okStart(), pid: 1, pidAlive: () => false });
  assert.deepEqual(out.fired, [orphan.id]);
  // release is explicit too
  const r = createTicket({ projectDir: DIR, runAtMs: T0 + HOUR, request: REQ, ownerPid: 99, ownerHost: hostname(), now: T0 });
  assert.equal(releaseTicket(r.id), true);
  assert.equal(getTicket(r.id).ownerPid, null);
});

test('recovery returns a ticket stuck in firing with a dead owner; purge drops old ended rows', () => {
  const t = createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, now: T0 });
  assert.equal(claimTicket(t.id, { pid: 777, host: hostname() }), true);
  assert.equal(recoverScheduler({ now: T0 + MIN, pidAlive: () => true }), 0);
  assert.equal(recoverScheduler({ now: T0 + MIN, pidAlive: () => false }), 1);
  assert.equal(getTicket(t.id).status, 'scheduled');

  cancelTicket(t.id, { now: T0 });
  assert.deepEqual(purgeScheduler({ now: T0 + 10 * 86400000 }), { tickets: 0, schedules: 0 });
  assert.equal(purgeScheduler({ now: T0 + 40 * 86400000 }).tickets, 1);
});

test('target removal and workflow dependents', () => {
  createTicket({ projectDir: DIR, title: 'one', runAtMs: T0 + HOUR, request: { ...REQ, workflowId: 'wf_x' }, now: T0 });
  createSchedule({ title: 'series', projectDir: DIR, request: { ...REQ, workflowId: 'wf_x' }, rule: nightly, now: T0 });
  createTicket({ projectDir: '/tmp/other', title: 'other', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.deepEqual(dependentsOfWorkflow('wf_x').map((d) => d.kind).sort(), ['once', 'recurring']);
  assert.deepEqual(scheduleCounts(), { scheduled: 3, missed: 0, recurring: 1 });
  assert.equal(cancelForTarget({ projectDir: DIR }), 2);
  assert.deepEqual(scheduleCounts(), { scheduled: 1, missed: 0, recurring: 0 });
});

test('summarizeRequest never leaks the whole prompt', () => {
  const s = summarizeRequest({ workspaceId: 'ws1', promptMarkdown: 'x'.repeat(1000), source: null, internal: { extrasPaths: ['a', 'b'] }, mock: 1 });
  assert.equal(s.target, 'workspace');
  assert.equal(s.prompt.length, 281);
  assert.equal(s.extras, 2);
  assert.equal(s.mock, true);
});
