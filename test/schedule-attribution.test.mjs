// test/schedule-attribution.test.mjs — step 4: who made / last changed a schedule or scheduled run
// (schedules/scheduled_runs created_by + updated_by, v39), its v39 backfill, the notification suffix,
// Ask's schedule shapes and the CLI's "by" column.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { DatabaseSync } from 'node:sqlite';
import { getDb, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';
import {
  createTicket, getTicket, updateTicket, cancelTicket, requestRunNow, createSchedule, getSchedule, updateSchedule,
  pauseSchedule, resumeSchedule, skipNext, runScheduleNow, runDueTickets, lastChangedSuffix,
} from '../src/core/scheduler.mjs';
import { listNotifications } from '../src/core/notifications.mjs';

useTempHome(after);

const T0 = Date.parse('2026-09-18T16:00:00Z');
const HOUR = 3600_000;
const DIR = '/tmp/worca-sched-attrib';
const REQ = { projectDir: DIR, prompt: 'Upgrade dependencies', workflowId: 'wf_default' };
const nightly = { freq: 'daily', time: '02:00', tz: 'Europe/Berlin', anchor: '2026-09-18' };

beforeEach(() => {
  getDb().exec('DELETE FROM scheduled_runs; DELETE FROM schedules; DELETE FROM notifications;');
});

test('a ticket records who made it and who last changed it; no actor keeps the last one', () => {
  const t = createTicket({ projectDir: DIR, runAtMs: T0 + HOUR, request: REQ, createdBy: 'ada@example.com', now: T0 });
  assert.equal(t.createdBy, 'ada@example.com');
  assert.equal(t.updatedBy, 'ada@example.com');
  assert.equal(updateTicket(t.id, { runAtMs: T0 + 2 * HOUR }, { now: T0, by: 'grace@example.com' }).updatedBy, 'grace@example.com');
  assert.equal(updateTicket(t.id, { ifMissed: 'skip' }, { now: T0 }).updatedBy, 'grace@example.com', 'an internal change names nobody');
  assert.equal(requestRunNow(t.id, { now: T0, by: 'bob@example.com' }).updatedBy, 'bob@example.com');
  const t2 = createTicket({ projectDir: DIR, runAtMs: T0 + HOUR, request: REQ, now: T0 });
  assert.equal(t2.createdBy, null, 'nobody known');
  assert.equal(cancelTicket(t2.id, { now: T0, by: 'ada@example.com' }).updatedBy, 'ada@example.com');
  assert.equal(createTicket({ projectDir: DIR, runAtMs: T0, request: REQ, createdBy: 'a\nb', now: T0 }).createdBy, null, 'a broken value is not stored');
});

test('a series records its creator and every change; occurrences and Run now carry the right person', () => {
  const { schedule, ticket } = createSchedule({ projectDir: DIR, title: 'Nightly', request: REQ, rule: nightly, createdBy: 'ada@example.com', now: T0 });
  assert.equal(schedule.createdBy, 'ada@example.com');
  assert.equal(ticket.createdBy, 'ada@example.com', 'the occurrence inherits the series creator');
  assert.equal(updateSchedule(schedule.id, { title: 'Nightly deps' }, { now: T0, by: 'grace@example.com' }).updatedBy, 'grace@example.com');
  assert.equal(getSchedule(schedule.id).createdBy, 'ada@example.com', 'the creator never changes');
  assert.equal(pauseSchedule(schedule.id, { now: T0, by: 'bob@example.com' }).updatedBy, 'bob@example.com');
  assert.equal(resumeSchedule(schedule.id, { now: T0, by: 'ada@example.com' }).updatedBy, 'ada@example.com');
  assert.equal(skipNext(schedule.id, { now: T0, by: 'grace@example.com' }).updatedBy, 'grace@example.com');
  assert.equal(runScheduleNow(schedule.id, { now: T0, by: 'bob@example.com' }).createdBy, 'bob@example.com', 'Run now is the clicker\'s');
  assert.equal(runScheduleNow(schedule.id, { now: T0 }).createdBy, 'ada@example.com', 'no clicker: the series creator');
});

test('missed / failed / self-paused notifications say who last changed it, never "local"', async () => {
  assert.equal(lastChangedSuffix({ updatedBy: 'local' }), '');
  assert.equal(lastChangedSuffix({ createdBy: 'ada@example.com' }), ' Last changed by ada@example.com.');
  assert.equal(lastChangedSuffix({ createdBy: 'x' }, { updatedBy: 'grace@example.com' }), ' Last changed by grace@example.com.', 'the series wins');

  createTicket({ projectDir: DIR, title: 'Gone', runAtMs: T0 - 8 * HOUR, request: REQ, graceMin: 60, createdBy: 'ada@example.com', now: T0 - 9 * HOUR });
  createTicket({ projectDir: DIR, title: 'Broken', runAtMs: T0, request: REQ, createdBy: 'grace@example.com', now: T0 - HOUR });
  createTicket({ projectDir: DIR, title: 'Mine', runAtMs: T0 - 8 * HOUR, request: REQ, graceMin: 60, createdBy: 'local', now: T0 - 9 * HOUR });
  await runDueTickets({ now: T0 + 1000, start: async () => ({ ok: false, error: 'no such workflow', transient: false }) });
  const byTitle = Object.fromEntries(listNotifications().map((n) => [n.title, n.message]));
  assert.match(byTitle.Gone, / Last changed by ada@example\.com\.$/);
  assert.equal(byTitle.Broken, 'could not start: no such workflow. Last changed by grace@example.com.');
  assert.doesNotMatch(byTitle.Mine, /Last changed/);

  const { schedule, ticket } = createSchedule({ projectDir: DIR, title: 'Flaky', request: REQ, rule: nightly, maxFailures: 1, createdBy: 'bob@example.com', now: T0 });
  await runDueTickets({ now: Date.parse(ticket.runAt) + 1000, start: async () => ({ ok: false, error: 'boom', transient: false }) });
  const paused = listNotifications({ scheduleId: schedule.id }).find((n) => n.kind === 'paused');
  assert.ok(paused, JSON.stringify(listNotifications({ scheduleId: schedule.id })));
  assert.match(paused.message, /in a row\. Last changed by bob@example\.com\.$/);
});

test('v39: a DB stamped 38 gains the columns and backfills created_by from internal.startedBy', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  for (const t of ['schedules', 'scheduled_runs']) for (const c of ['created_by', 'updated_by']) db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  const ts = new Date(T0).toISOString();
  const req = JSON.stringify({ ...REQ, internal: { startedBy: 'ada@example.com' } });
  db.prepare("INSERT INTO scheduled_runs (id, run_at, request, created_at, updated_at) VALUES ('t-old', ?, ?, ?, ?)").run(ts, req, ts, ts);
  db.prepare("INSERT INTO scheduled_runs (id, run_at, request, created_at, updated_at) VALUES ('t-none', ?, ?, ?, ?)").run(ts, JSON.stringify(REQ), ts, ts);
  db.prepare("INSERT INTO schedules (id, request, rule, created_at, updated_at) VALUES ('sch_old', ?, ?, ?, ?)").run(req, JSON.stringify(nightly), ts, ts);
  db.exec('PRAGMA user_version = 38');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const by = (t, id) => db.prepare(`SELECT created_by, updated_by FROM ${t} WHERE id = ?`).get(id);
  assert.equal(by('scheduled_runs', 't-old').created_by, 'ada@example.com');
  assert.equal(by('scheduled_runs', 't-none').created_by, null);
  assert.equal(by('schedules', 'sch_old').created_by, 'ada@example.com');
  assert.equal(by('schedules', 'sch_old').updated_by, null, 'nobody changed it yet');
  db.close();
});

test('Ask Worca: list/get_schedule carry createdBy / updatedBy (never "local"); its pause names the turn\'s person', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { defaultToolDeps } = await import('../src/core/ask/tool-deps.mjs');
  const { defaultScheduleDeps } = await import('../src/core/ask/schedule-deps.mjs');
  const { schedule } = createSchedule({ projectDir: DIR, title: 'Nightly', request: REQ, rule: nightly, createdBy: 'ada@example.com' });
  const local = createTicket({ projectDir: DIR, title: 'Mine', runAtMs: Date.now() + HOUR, request: REQ, createdBy: 'local' });
  const tools = createAskTools({ ...defaultToolDeps({ threadId: null }), ...defaultScheduleDeps({ reader: 'grace@example.com' }) });
  const list = await tools.call('list_schedules', {});
  const row = list.schedules.find((x) => x.id === schedule.id);
  assert.equal(row.createdBy, 'ada@example.com');
  assert.equal(row.updatedBy, 'ada@example.com');
  const mine = list.runs.find((x) => x.id === local.id);
  assert.equal('createdBy' in mine, false, '"local" is not a person');
  await tools.call('pause_schedule', { id: schedule.id });
  assert.equal((await tools.call('get_schedule', { id: schedule.id })).updatedBy, 'grace@example.com');
  const plain = createAskTools({ ...defaultToolDeps({ threadId: null }), ...defaultScheduleDeps({}) });
  await plain.call('resume_schedule', { id: schedule.id });
  assert.equal(getSchedule(schedule.id).updatedBy, 'grace@example.com', 'no shared person: the last one stays');
});

test('CLI: `worca schedule list/show` name a person only when one made or changed it', async () => {
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');
  const { schedule } = createSchedule({ projectDir: DIR, title: 'Nightly', request: REQ, rule: nightly, createdBy: 'ada@example.com' });
  updateSchedule(schedule.id, { title: 'Nightly deps' }, { by: 'grace@example.com' });
  createTicket({ projectDir: DIR, title: 'Mine', runAtMs: Date.now() + HOUR, request: REQ, createdBy: 'local' });
  const run = (args) => spawnSync(process.execPath, [CLI, 'schedule', ...args], { env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
  const list = run(['list']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /Nightly deps {2}·  by grace@example\.com/);
  assert.doesNotMatch(list.stdout, /Mine.*by /);
  const show = run(['show', schedule.id]);
  assert.match(show.stdout, /created by ada@example\.com/);
  assert.match(show.stdout, /changed by grace@example\.com/);
});
