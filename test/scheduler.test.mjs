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
  scheduleCounts, summarizeRequest, RETRY_BACKOFF_MIN, AFTER_RUN_AT,
  afterRefOf, predecessorState, previousBranchesOf, dependentsOfRun, resolveAfterRef,
  chainBaseBranchesOf, markTicketFired,
} from '../src/core/scheduler.mjs';
import { projectKey } from '../src/core/store.mjs';
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

test('an after-ticket stores its predecessor, sits at the sentinel time, and is always due', () => {
  const t = createTicket({ projectDir: DIR, title: 'Add tests', request: REQ, after: { kind: 'pipeline', id: 'abcd1234' }, afterPolicy: 'any', sourceFromPrevious: true, now: T0 });
  assert.deepEqual(t.after, { kind: 'pipeline', id: 'abcd1234', policy: 'any' });
  assert.equal(t.sourceFromPrevious, true);
  assert.equal(t.runAt, AFTER_RUN_AT, 'D11: invisible to an older build');
  assert.equal(t.status, 'scheduled');
  assert.ok(dueTickets({ now: T0 }).some((d) => d.id === t.id), 'due at once — the gate decides');
  const timed = createTicket({ projectDir: DIR, title: 'Later', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.equal(timed.after, null);
  assert.equal(timed.sourceFromPrevious, false);
  assert.throws(() => createTicket({ projectDir: DIR, request: REQ, now: T0 }), /runAtMs is required/);
  assert.throws(() => createTicket({ projectDir: DIR, request: REQ, after: { kind: 'series', id: 'x' }, now: T0 }), /after.kind/);
});

test('updateTicket switches a ticket between a time and a predecessor', () => {
  const t = createTicket({ projectDir: DIR, title: 'A', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  const a = updateTicket(t.id, { after: { kind: 'ticket', id: 'some-other-ticket' }, afterPolicy: 'any', sourceFromPrevious: true }, { now: T0 });
  assert.deepEqual(a.after, { kind: 'ticket', id: 'some-other-ticket', policy: 'any' });
  assert.equal(a.runAt, AFTER_RUN_AT);
  assert.equal(a.sourceFromPrevious, true);
  const b = updateTicket(t.id, { runAtMs: T0 + 2 * HOUR }, { now: T0 });
  assert.equal(b.after, null, 'a time clears the predecessor');
  assert.equal(b.sourceFromPrevious, false, '…and the branch choice that needs one');
  assert.equal(b.runAt, new Date(T0 + 2 * HOUR).toISOString());
  // …and the policy: a later re-chaining that says nothing about it must not inherit the old `any` —
  // not even one sent ALONG WITH the time (PATCH { scheduledFor, afterPolicy } is such a caller): a
  // timed ticket has no policy, so the runAtMs branch's reset must be the last word on after_policy.
  updateTicket(t.id, { runAtMs: T0 + 3 * HOUR, afterPolicy: 'any' }, { now: T0 });
  assert.equal(updateTicket(t.id, { after: { kind: 'ticket', id: 'x' } }, { now: T0 }).after.policy, 'done', 'a move to a time also reset after_policy');
  const c = updateTicket(t.id, { after: { kind: 'ticket', id: 'x' }, afterPolicy: 'any' }, { now: T0 });
  assert.equal(c.after.policy, 'any');
  assert.equal(updateTicket(t.id, { afterPolicy: 'bogus' }, { now: T0 }).after.policy, 'any', 'an unknown policy is ignored');
  // D13: a caller that sends both has no defensible intent — refuse rather than pick one.
  assert.throws(() => updateTicket(t.id, { runAtMs: T0 + HOUR, after: { kind: 'ticket', id: 'x' } }, { now: T0 }), /runAtMs OR after/);
  // A malformed predecessor is refused here exactly as createTicket refuses it — never swallowed as "no change".
  assert.throws(() => updateTicket(t.id, { after: { kind: 'series', id: 'x' } }, { now: T0 }), /after.kind/);
});

test('predecessorState follows a ticket into its pipeline and reads the outcome gate', () => {
  const pred = createTicket({ projectDir: DIR, title: 'Refactor', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.equal(predecessorState({ kind: 'ticket', id: pred.id }, { now: T0 }).state, 'waiting');
  assert.equal(predecessorState({ kind: 'ticket', id: 'nope' }, { now: T0 }).state, 'gone');
  cancelTicket(pred.id, { now: T0 });
  const c = predecessorState({ kind: 'ticket', id: pred.id }, { now: T0 });
  assert.equal(c.state, 'bad'); assert.equal(c.reason, 'was canceled'); assert.equal(c.title, 'Refactor');

  seedPipelineRow({ id: 'p0000001', title: 'Refactor', status: 'running', startedAt: new Date(T0).toISOString(), branch: { source: 'main', feature: 'worca/refactor-p0000001' } });
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0 }).state, 'waiting');
  getDb().prepare("UPDATE pipelines SET status = 'paused' WHERE id = 'p0000001'").run();
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0 }).state, 'waiting', 'a paused run is still going');
  getDb().prepare("UPDATE pipelines SET status = 'error' WHERE id = 'p0000001'").run();
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0 }).state, 'bad');
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0 }).reason, 'ended with an error');
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0, policy: 'any' }).state, 'ok');
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'p0000001'").run();
  const ok = predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0 });
  assert.equal(ok.state, 'ok'); assert.equal(ok.pipelineId, 'p0000001');
  // The host's in-memory view wins over a lagging row.
  assert.equal(predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0, isLive: ({ pipelineId }) => pipelineId === 'p0000001' }).state, 'waiting');
  assert.equal(predecessorState({ kind: 'pipeline', id: 'zzz' }, { now: T0 }).state, 'gone');

  // A fired ticket without a pipeline: fresh = still starting; stale = it never got one.
  const fired = createTicket({ projectDir: DIR, title: 'F', runAtMs: T0, request: REQ, now: T0 });
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', updated_at = ? WHERE id = ?").run(new Date(T0).toISOString(), fired.id);
  assert.equal(predecessorState({ kind: 'ticket', id: fired.id }, { now: T0 + MIN }).state, 'waiting');
  assert.equal(predecessorState({ kind: 'ticket', id: fired.id }, { now: T0 + 10 * MIN }).state, 'bad');
  setTicketPipeline(fired.id, 'p0000001');
  assert.equal(predecessorState({ kind: 'ticket', id: fired.id }, { now: T0 + 10 * MIN }).state, 'ok', 'follows into the pipeline');

  // Archive (the History delete) keeps the row but stamps archived_at and removes the branch: the
  // predecessor is GONE under either policy, by either kind — never a `done` to start from.
  getDb().prepare("UPDATE pipelines SET archived_at = ? WHERE id = 'p0000001'").run(new Date(T0).toISOString());
  const arch = predecessorState({ kind: 'pipeline', id: 'p0000001' }, { now: T0, policy: 'any' });
  assert.equal(arch.state, 'gone'); assert.equal(arch.reason, 'was archived'); assert.equal(arch.pipelineId, 'p0000001');
  assert.equal(predecessorState({ kind: 'ticket', id: fired.id }, { now: T0 + 10 * MIN }).state, 'gone', 'the ticket follows into the archived pipeline');
});

test('afterRefOf, previousBranchesOf and dependentsOfRun read the rows', () => {
  // projectKey stated, not inherited: the assertion below is about THIS value.
  seedPipelineRow({ id: 'p0000002', title: 'Refactor', status: 'done', projectKey: 'proj-00000001', startedAt: new Date(T0).toISOString(), branch: { source: 'main', feature: 'worca/refactor-p0000002' } });
  seedPipelineRow({ id: 'w0000001', title: 'Ws', status: 'done', target: 'workspace', workspaceKey: 'ws_1', startedAt: new Date(T0).toISOString(),
    workspaceMeta: { workspaceId: 'ws_1', branches: { 'proj-a': { source: 'main', feature: 'worca/ws-a' }, 'proj-b': { source: 'dev', feature: 'worca/ws-b' } } } });
  assert.deepEqual(previousBranchesOf('p0000002'), { sourceBranch: 'worca/refactor-p0000002' });
  assert.deepEqual(previousBranchesOf('w0000001'), { sourceBranchByKey: { 'proj-a': 'worca/ws-a', 'proj-b': 'worca/ws-b' } });
  assert.equal(previousBranchesOf('nope'), null);
  const p = afterRefOf('p0000002');
  assert.equal(p.kind, 'pipeline'); assert.equal(p.projectKey, 'proj-00000001'); assert.equal(p.workspaceId, null); assert.equal(p.status, 'done');
  const w = afterRefOf('w0000001');
  assert.equal(w.workspaceId, 'ws_1'); assert.equal(w.projectKey, null);
  const t = createTicket({ projectDir: DIR, title: 'B', request: REQ, after: { kind: 'pipeline', id: 'p0000002' }, now: T0 });
  const tr = afterRefOf(t.id);
  assert.equal(tr.kind, 'ticket'); assert.equal(tr.status, 'scheduled'); assert.equal(tr.scheduleId, null);
  assert.equal(afterRefOf('missing'), null);
  assert.deepEqual(dependentsOfRun({ pipelineId: 'p0000002' }).map((d) => d.id), [t.id]);
  // A dependent chained on the TICKET that became p0000002 is a dependent of the pipeline too (the Archive note).
  const became = createTicket({ projectDir: DIR, title: 'Became', runAtMs: T0, request: REQ, now: T0 });
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired' WHERE id = ?").run(became.id);
  setTicketPipeline(became.id, 'p0000002');
  const v = createTicket({ projectDir: DIR, title: 'V', request: REQ, after: { kind: 'ticket', id: became.id }, now: T0 });
  assert.deepEqual(dependentsOfRun({ pipelineId: 'p0000002' }).map((d) => d.id).sort(), [t.id, v.id].sort());
  assert.deepEqual(dependentsOfRun({ ticketId: became.id }).map((d) => d.id), [v.id]);
  const u = createTicket({ projectDir: DIR, title: 'C', request: REQ, after: { kind: 'ticket', id: t.id }, now: T0 });
  assert.deepEqual(dependentsOfRun({ ticketId: t.id }).map((d) => [d.id, d.kind, d.title]), [[u.id, 'once', 'C']]);
  cancelTicket(u.id, { now: T0 });
  assert.deepEqual(dependentsOfRun({ ticketId: t.id }), [], 'an ended dependent is not a dependent');
});

test('resolveAfterRef: every refusal has its sentence; a waiting or done predecessor is accepted', () => {
  seedPipelineRow({ id: 'p0000003', title: 'Refactor', status: 'running', projectKey: projectKey(DIR), startedAt: new Date(T0).toISOString() });
  seedPipelineRow({ id: 'p0000004', title: 'Other', status: 'done', projectKey: 'proj-other', startedAt: new Date(T0).toISOString() });
  seedPipelineRow({ id: 'p0000005', title: 'Broken', status: 'error', projectKey: projectKey(DIR), startedAt: new Date(T0).toISOString() });
  seedPipelineRow({ id: 'w0000002', title: 'Ws', status: 'done', target: 'workspace', workspaceKey: 'ws_9', startedAt: new Date(T0).toISOString() });
  seedPipelineRow({ id: 'w0000003', title: 'Ws2', status: 'done', target: 'workspace', workspaceKey: 'ws_9', startedAt: new Date(T0).toISOString() });
  const opts = { projectDir: DIR };
  assert.equal(resolveAfterRef(null, opts).error, 'after must be { kind: ticket | pipeline, id }');
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'zzz' }, opts).error, 'no run or scheduled run has id zzz');
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'sch_deadbeef' }, opts).error, 'after a repeating schedule is not supported — give the id of one of its runs');
  assert.match(resolveAfterRef({ kind: 'pipeline', id: 'p0000004' }, opts).error, /^‘Other’ targets another project; this run targets/);
  assert.match(resolveAfterRef({ kind: 'pipeline', id: 'w0000002' }, opts).error, /^‘Ws’ targets a workspace; this run targets a project$/);
  assert.match(resolveAfterRef({ kind: 'pipeline', id: 'p0000003' }, { workspaceId: 'ws_9' }).error, /targets a project; this run targets a workspace$/);
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'w0000003' }, { workspaceId: 'ws_1' }).error, '‘Ws2’ targets another workspace; this run targets ws_1');
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'p0000005' }, opts).error, '‘Broken’ ended with an error — nothing to wait for');
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'p0000005' }, { ...opts, policy: 'any' }).ok, true, 'any: an ended run is fine');
  // An archived run (History's delete keeps the row, removes the branch) is gone — under either policy.
  seedPipelineRow({ id: 'p0000006', title: 'Archived', status: 'done', projectKey: projectKey(DIR), startedAt: new Date(T0).toISOString() });
  getDb().prepare("UPDATE pipelines SET archived_at = ? WHERE id = 'p0000006'").run(new Date(T0).toISOString());
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'p0000006' }, { ...opts, policy: 'any' }).error, '‘Archived’ was archived — nothing to wait for');
  const ok = resolveAfterRef({ kind: 'pipeline', id: 'p0000003' }, opts);
  assert.deepEqual(ok, { ok: true, after: { kind: 'pipeline', id: 'p0000003', title: 'Refactor', status: 'running', pipelineId: 'p0000003' } });
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: 'w0000002' }, { workspaceId: 'ws_9' }).ok, true);
  // gone: a fired ticket whose pipeline row is not there any more.
  const gone = createTicket({ projectDir: DIR, title: 'F', runAtMs: T0, request: REQ, now: T0 });
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired' WHERE id = ?").run(gone.id);
  setTicketPipeline(gone.id, 'zzzzzzzz');
  assert.equal(resolveAfterRef({ kind: 'ticket', id: gone.id }, opts).error, '‘F’ was removed — nothing to wait for');
  // A ticket of a series cannot be waited for; a plain ticket can, by either kind word.
  const { ticket: occ } = createSchedule({ projectDir: DIR, title: 'Nightly', request: REQ, rule: nightly, now: T0 });
  assert.equal(resolveAfterRef({ kind: 'ticket', id: occ.id }, opts).error, 'after a repeating schedule is not supported — give the id of one of its runs');
  const a = createTicket({ projectDir: DIR, title: 'A', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.equal(resolveAfterRef({ kind: 'ticket', id: a.id }, opts).after.status, 'scheduled');
  assert.equal(resolveAfterRef({ kind: 'pipeline', id: a.id }, opts).after.kind, 'ticket', 'the kind is corrected from the row, never trusted');
});

test('resolveAfterRef refuses a cycle, at any depth', () => {
  const a = createTicket({ projectDir: DIR, title: 'A', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  const b = createTicket({ projectDir: DIR, title: 'B', request: REQ, after: { kind: 'ticket', id: a.id }, now: T0 });
  const c = createTicket({ projectDir: DIR, title: 'C', request: REQ, after: { kind: 'ticket', id: b.id }, now: T0 });
  assert.equal(resolveAfterRef({ kind: 'ticket', id: a.id }, { projectDir: DIR, selfId: a.id }).error, '‘A’ is this run');
  assert.equal(resolveAfterRef({ kind: 'ticket', id: c.id }, { projectDir: DIR, selfId: a.id }).error, '‘C’ already waits for this run');
  assert.equal(resolveAfterRef({ kind: 'ticket', id: c.id }, { projectDir: DIR, selfId: b.id }).error, '‘C’ already waits for this run');
  assert.equal(resolveAfterRef({ kind: 'ticket', id: a.id }, { projectDir: DIR, selfId: c.id }).ok, true, 'upstream is fine');
});

test('an after-ticket waits, then starts the tick after its predecessor finishes, from that moment', async () => {
  seedPipelineRow({ id: 'g0000001', title: 'Refactor', status: 'running', startedAt: new Date(T0).toISOString() });
  const t = createTicket({ projectDir: DIR, title: 'Tests', request: REQ, after: { kind: 'pipeline', id: 'g0000001' }, now: T0 });
  const started = [];
  const start = async (tk) => { started.push(tk.id); return { ok: true, pipelineId: 'g0000002' }; };
  let out = await runDueTickets({ now: T0 + MIN, start });
  assert.deepEqual(out.waiting, [t.id]); assert.deepEqual(started, []);
  assert.equal(getTicket(t.id).runAt, AFTER_RUN_AT, 'untouched while waiting');
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = 'g0000001'").run();
  out = await runDueTickets({ now: T0 + 2 * HOUR, start });
  assert.deepEqual(out.fired, [t.id]); assert.deepEqual(started, [t.id]);
  const fired = getTicket(t.id);   // not `after`: that name is the node:test hook imported at the top of the file
  assert.equal(fired.status, 'fired');
  assert.equal(fired.runAt, new Date(T0 + 2 * HOUR).toISOString(), 'D11: due from the moment the gate opened');
  assert.ok(!kinds().includes('late'), 'never late: it was due the instant it started');
});

test('a predecessor that ends badly makes the dependent missed, with the reason; any-policy and Run now go through', async () => {
  seedPipelineRow({ id: 'g0000003', title: 'Refactor', status: 'error', startedAt: new Date(T0).toISOString() });
  const strict = createTicket({ projectDir: DIR, title: 'Tests', request: REQ, after: { kind: 'pipeline', id: 'g0000003' }, now: T0 });
  const loose = createTicket({ projectDir: DIR, title: 'Docs', request: REQ, after: { kind: 'pipeline', id: 'g0000003' }, afterPolicy: 'any', now: T0 });
  const out = await runDueTickets({ now: T0 + MIN, start: okStart() });
  assert.deepEqual(out.missed, [strict.id]); assert.deepEqual(out.fired, [loose.id]);
  const m = getTicket(strict.id);
  assert.equal(m.status, 'missed');
  assert.equal(m.failReason, 'The run before it ended with an error.');
  const n = listNotifications().find((x) => x.ticketId === strict.id);
  assert.equal(n.kind, 'missed');
  assert.equal(n.message, 'was waiting for ‘Refactor’, which ended with an error.');
  // Run now on the missed one: forced bypasses the gate.
  requestRunNow(strict.id, { now: T0 + 2 * MIN });
  const again = await runDueTickets({ now: T0 + 2 * MIN, start: okStart() });
  assert.deepEqual(again.fired, [strict.id]);
});

test('a ticket predecessor that is canceled or removed strands its dependent as missed', async () => {
  const a = createTicket({ projectDir: DIR, title: 'A', runAtMs: T0 + HOUR, request: REQ, now: T0 });
  const b = createTicket({ projectDir: DIR, title: 'B', request: REQ, after: { kind: 'ticket', id: a.id }, now: T0 });
  assert.deepEqual((await runDueTickets({ now: T0 + MIN, start: okStart() })).waiting, [b.id]);
  cancelTicket(a.id, { now: T0 + 2 * MIN });
  const out = await runDueTickets({ now: T0 + 3 * MIN, start: okStart() });
  assert.deepEqual(out.missed, [b.id]);
  assert.equal(getTicket(b.id).failReason, 'The run before it was canceled.');
  seedPipelineRow({ id: 'g0000004', title: 'Gone', status: 'running', startedAt: new Date(T0).toISOString() });
  const c = createTicket({ projectDir: DIR, title: 'C', request: REQ, after: { kind: 'pipeline', id: 'g0000004' }, now: T0 });
  getDb().prepare("DELETE FROM pipelines WHERE id = 'g0000004'").run();
  const out2 = await runDueTickets({ now: T0 + 4 * MIN, start: okStart() });
  assert.deepEqual(out2.missed, [c.id]);
  assert.equal(getTicket(c.id).failReason, 'The run before it was removed.');
});

test('a transient start error on an opened gate retries from the gate time, not the sentinel', async () => {
  seedPipelineRow({ id: 'g0000005', title: 'R', status: 'done', startedAt: new Date(T0).toISOString() });
  const t = createTicket({ projectDir: DIR, title: 'T', request: REQ, after: { kind: 'pipeline', id: 'g0000005' }, now: T0 });
  const out = await runDueTickets({ now: T0 + MIN, start: async () => ({ ok: false, error: 'busy', transient: true }) });
  assert.deepEqual(out.retried, [t.id]);
  const r = getTicket(t.id);
  assert.equal(r.status, 'scheduled'); assert.equal(r.attempts, 1);
  assert.equal(r.runAt, new Date(T0 + MIN).toISOString());
  assert.equal(r.retryAt, new Date(T0 + MIN + RETRY_BACKOFF_MIN[0] * MIN).toISOString());
  const out2 = await runDueTickets({ now: T0 + 3 * MIN, start: okStart() });
  assert.deepEqual(out2.fired, [t.id]);
});

test('archiving the predecessor (History delete keeps the row, removes its branch) strands the dependent as missed', async () => {
  seedPipelineRow({ id: 'g0000006', title: 'Old', status: 'running', startedAt: new Date(T0).toISOString(), branch: { source: 'main', feature: 'worca/old-g0000006' } });
  const t = createTicket({ projectDir: DIR, title: 'Next', request: REQ, after: { kind: 'pipeline', id: 'g0000006' }, sourceFromPrevious: true, now: T0 });
  assert.deepEqual((await runDueTickets({ now: T0 + MIN, start: okStart() })).waiting, [t.id]);
  // Archive refuses a live run: it finishes first, then the row is stamped and the branch is gone.
  getDb().prepare("UPDATE pipelines SET status = 'done', archived_at = ? WHERE id = 'g0000006'").run(new Date(T0 + 2 * MIN).toISOString());
  const out = await runDueTickets({ now: T0 + 3 * MIN, start: okStart() });
  assert.deepEqual(out.missed, [t.id]); assert.deepEqual(out.fired, []);
  assert.equal(getTicket(t.id).failReason, 'The run before it was archived.');
  assert.equal(listNotifications().find((x) => x.ticketId === t.id).message, 'was waiting for ‘Old’, which was archived.');
});

// ── chainBaseBranchesOf: the PR dialog's base-branch choices along a run chain ──
const DAY = 24 * HOUR;
const chainRun = (id, source, feature) =>
  seedPipelineRow({ id, title: id, status: 'done', startedAt: new Date(T0).toISOString(), branch: { source, feature } });
// The ticket that started `pipelineId` after `after`, fired at T0 (so a purge 31 days later drops it).
const chainFire = (pipelineId, after, sourceFromPrevious = true) => {
  const t = createTicket({ projectDir: DIR, title: pipelineId, request: REQ, after, sourceFromPrevious, now: T0 });
  markTicketFired(t.id, { pipelineId, now: T0 });
  return t;
};

test('chainBaseBranchesOf walks a from-its-branch chain back to its root, root first', () => {
  // dev → nb1 → nb2 → nb3: each run started from the previous run's feature branch.
  chainRun('c0000001', 'dev', 'nb1');
  chainRun('c0000002', 'nb1', 'nb2');
  chainRun('c0000003', 'nb2', 'nb3');
  const t2 = chainFire('c0000002', { kind: 'pipeline', id: 'c0000001' });
  chainFire('c0000003', { kind: 'ticket', id: t2.id });      // chained on the TICKET that became nb2
  assert.deepEqual(chainBaseBranchesOf('c0000003'), ['dev', 'nb1', 'nb2']);
  assert.deepEqual(chainBaseBranchesOf('c0000002'), ['dev', 'nb1']);
  assert.deepEqual(chainBaseBranchesOf('c0000001'), ['dev'], 'a run no ticket started is its own root');
  assert.deepEqual(chainBaseBranchesOf('nope'), [], 'no run, no branches');
});

test('chainBaseBranchesOf stops at a link that did not start from its predecessor\'s branch', () => {
  // nb2 waited for nb1 and even names nb1 as its source, but was NOT started "from its branch".
  chainRun('c0000011', 'dev', 'nb1');
  chainRun('c0000012', 'nb1', 'nb2');
  chainRun('c0000013', 'nb2', 'nb3');
  chainFire('c0000012', { kind: 'pipeline', id: 'c0000011' }, false);
  chainFire('c0000013', { kind: 'pipeline', id: 'c0000012' });
  assert.deepEqual(chainBaseBranchesOf('c0000013'), ['nb1', 'nb2']);
  // A timed ticket (no predecessor at all) is a chain start too.
  chainRun('c0000014', 'main', 'nb4');
  markTicketFired(createTicket({ projectDir: DIR, title: 'T', runAtMs: T0, request: REQ, now: T0 }).id, { pipelineId: 'c0000014', now: T0 });
  assert.deepEqual(chainBaseBranchesOf('c0000014'), ['main']);
});

test('chainBaseBranchesOf ends the walk at a purged or missing link — the run\'s own source is the fallback', () => {
  chainRun('c0000021', 'dev', 'nb1');
  chainRun('c0000022', 'nb1', 'nb2');
  chainRun('c0000023', 'nb2', 'nb3');
  const t2 = chainFire('c0000022', { kind: 'pipeline', id: 'c0000021' });
  chainFire('c0000023', { kind: 'ticket', id: t2.id });
  assert.deepEqual(chainBaseBranchesOf('c0000023'), ['dev', 'nb1', 'nb2']);
  // Fired tickets are purged after TICKET_RETENTION_DAYS: with them goes the only record of the link.
  assert.equal(purgeScheduler({ now: T0 + 31 * DAY }).tickets, 2);
  assert.deepEqual(chainBaseBranchesOf('c0000023'), ['nb2']);
  assert.deepEqual(chainBaseBranchesOf('c0000022'), ['nb1']);
  // A predecessor ticket that is gone while the dependent's ticket is still there.
  chainRun('c0000024', 'nb3', 'nb4');
  chainFire('c0000024', { kind: 'ticket', id: 'purged-ticket' });
  assert.deepEqual(chainBaseBranchesOf('c0000024'), ['nb3']);
  // A predecessor pipeline row that is gone.
  chainRun('c0000025', 'nb4', 'nb5');
  chainFire('c0000025', { kind: 'pipeline', id: 'zzzzzzzz' });
  assert.deepEqual(chainBaseBranchesOf('c0000025'), ['nb4']);
});

test('chainBaseBranchesOf stops where the predecessor\'s feature is not this run\'s source, and survives a cycle', () => {
  chainRun('c0000031', 'dev', 'nb1');
  chainRun('c0000032', 'hotfix', 'nb2');                   // renamed/rebased: not nb1's branch any more
  chainFire('c0000032', { kind: 'pipeline', id: 'c0000031' });
  assert.deepEqual(chainBaseBranchesOf('c0000032'), ['hotfix']);
  // A hand-made cycle (x after y, y after x) must terminate.
  chainRun('c0000033', 'ny', 'nx');
  chainRun('c0000034', 'nx', 'ny');
  chainFire('c0000033', { kind: 'pipeline', id: 'c0000034' });
  chainFire('c0000034', { kind: 'pipeline', id: 'c0000033' });
  assert.deepEqual(chainBaseBranchesOf('c0000034'), ['ny', 'nx'], 'the walk stops at the first repeated run');
  // A run without a recorded source has nothing to offer.
  chainRun('c0000035', null, 'nb9');
  assert.deepEqual(chainBaseBranchesOf('c0000035'), []);
});
