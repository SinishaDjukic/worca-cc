// test/worca-levels-facts.test.mjs
// src/core/worca-levels/facts.mjs — the numbers and booleans the worca-level evaluator reads, gathered
// from the DB, the plugin lock, the requirements flag and the person's live record.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after);
// settings.json (the flags) lives under HOME, not WORCA_HOME: point both at the temp dir.
const REAL_HOME = process.env.HOME;
const REAL_FLAGS = process.env.WORCA_FLAGS;
process.env.HOME = home;
after(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_FLAGS === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = REAL_FLAGS;
});

const { gatherFacts } = await import('../src/core/worca-levels/facts.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { writePluginsLock } = await import('../src/core/plugins-lock.mjs');
const { writeRunLedger, ledgerFile } = await import('../src/core/metrics/ledger.mjs');

const FACT_KEYS = ['gettingStartedDone', 'gettingStarted', 'policyInstalled', 'requirements', 'requirementsFlag', 'startedRuns',
  'doneRuns', 'addonsInstalled', 'addonsAtOnce', 'spaces', 'schedules', 'repeatingSchedules', 'statsViewedAt', 'parallelDoneAt',
  'teamMetricsRuns', 'teamMetricsOpenedAt', 'council'];
const NO_LIVE = { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null };
const ago = (days, extraMs = 0) => new Date(Date.now() - days * 86400000 + extraMs).toISOString();
const MIN = 60000;
const TZ = 'UTC';

// Getting started is derived from the host (PATH, probes); the tests inject a fixed answer.
const onboarding = async () => ({ done: 9, total: 9, steps: { teamPolicy: true } });
const gather = (input, sources = {}) => gatherFacts({ live: NO_LIVE, tz: TZ, ...input }, { onboarding, ...sources });

let seq = 0;
// A bare pipelines row, written with the columns this suite reads. test/helpers/db-seed.mjs routes through
// artifacts.mjs (the production writers), whose import graph is far heavier than the facts under test.
async function run(startedBy, status = 'done', extra = {}) {
  const id = extra.id ?? `worca${String(++seq).padStart(4, '0')}`;
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, started_by, schedule_id, scheduled_for, deleted_at)
    VALUES (?, 'proj-00000001', 'project', ?, 'done', 0, ?, ?, ?, ?, ?, ?)`)
    .run(id, status, 'startedAt' in extra ? extra.startedAt : ago(1), 'updatedAt' in extra ? extra.updatedAt : ago(1), startedBy,
      extra.scheduleId ?? null, extra.scheduledFor ?? null, extra.deletedAt ?? null);
  return id;
}
function schedule(createdBy) {
  const id = `sch_${++seq}`;
  getDb().prepare(`INSERT INTO schedules (id, request, rule, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, '{}', '{}', createdBy, ago(1), ago(1));
  return id;
}
function oneOff(createdBy) {
  getDb().prepare(`INSERT INTO scheduled_runs (id, schedule_id, run_at, request, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(`sr_${++seq}`, null, ago(-1), '{}', createdBy, ago(1), ago(1));
}
function requirement(createdBy) {
  getDb().prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_by, created_at, updated_at)
    VALUES ('project','k','t','d','draft','{}',?,?,?)`).run(createdBy, ago(1), ago(1));
}
function workspace() {
  getDb().prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(`wks-x-${++seq}`, `ws${seq}`, ago(1), ago(1));
}
// Two runs of `status` that overlap in time: [t0, t0+30m] and [t0+10m, t0+40m].
async function overlapping(who, status = 'done', t0 = Date.now() - 5 * 86400000) {
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  const a = await run(who, status, { startedAt: at(0), updatedAt: at(30) });
  const b = await run(who, status, { startedAt: at(10), updatedAt: at(40) });
  return { a, b };
}

beforeEach(() => {
  const db = getDb();
  for (const t of ['pipelines', 'scheduled_runs', 'schedules', 'req_features', 'workspaces']) db.exec(`DELETE FROM ${t}`);
  rmSync(dirname(ledgerFile('x')), { recursive: true, force: true });
  writePluginsLock({});
  delete process.env.WORCA_FLAGS;
});

test('shape: every fact is present with the neutral value (empty install)', async () => {
  const facts = await gather({ person: '_local', shared: false });
  assert.deepEqual(Object.keys(facts).sort(), [...FACT_KEYS].sort());
  assert.deepEqual(facts.gettingStarted, { done: 9, total: 9 });
  assert.equal(facts.gettingStartedDone, true);
  assert.equal(facts.policyInstalled, true);
  assert.equal(facts.requirementsFlag, false);
  assert.equal(facts.startedRuns, 0);
  assert.equal(facts.parallelDoneAt, null);
  assert.equal(facts.statsViewedAt, null);
  assert.equal(facts.teamMetricsOpenedAt, null);
  assert.equal(facts.teamMetricsRuns, 0);
  assert.deepEqual(facts.council, { current: 0, metAt: null });
  assert.deepEqual([facts.schedules, facts.repeatingSchedules], [false, false]);
});

test('Getting started is credited from install state, shared or not, and is incomplete when steps are missing', async () => {
  const part = async () => ({ done: 4, total: 9, steps: {} });
  for (const shared of [false, true]) {
    const f = await gather({ person: 'ada@x.io', shared }, { onboarding: part });
    assert.equal(f.gettingStartedDone, false);
    assert.deepEqual(f.gettingStarted, { done: 4, total: 9 });
    assert.equal(f.policyInstalled, false);
    const g = await gather({ person: 'ada@x.io', shared });
    assert.equal(g.gettingStartedDone, true);
  }
});

test('policyInstalled comes from the onboarding teamPolicy step', async () => {
  const off = async () => ({ done: 9, total: 9, steps: { teamPolicy: false } });
  assert.equal((await gather({ person: '_local', shared: false }, { onboarding: off })).policyInstalled, false);
  assert.equal((await gather({ person: '_local', shared: false })).policyInstalled, true);
});

test('single install counts every run, including NULL started_by; only done runs count as done', async () => {
  await run(null, 'done');
  await run('someone@x.io', 'done');
  await run(null, 'error');
  const f = await gather({ person: '_local', shared: false });
  assert.equal(f.startedRuns, 3);
  assert.equal(f.doneRuns, 2);
});

test('countDoneRuns excludes deleted rows', async () => {
  await run('ada@x.io', 'done');
  await run('ada@x.io', 'done', { deletedAt: ago(0) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).doneRuns, 1);
  assert.equal((await gather({ person: '_local', shared: false })).doneRuns, 1);
});

test('shared install counts only the person (case-insensitive) and never NULL started_by', async () => {
  await run('Ada@X.io', 'done');
  await run('ada@x.io', 'error');
  await run('bob@x.io', 'done');
  await run(null, 'done');
  const ada = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(ada.startedRuns, 2);
  assert.equal(ada.doneRuns, 1);
  const nobody = await gather({ person: 'zed@x.io', shared: true });
  assert.equal(nobody.startedRuns, 0);
});

test('D-6: with the requirements flag off, a first started run is visible through startedRuns', async () => {
  await run('ada@x.io', 'running');
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.requirementsFlag, false);
  assert.equal(f.requirements, 0);
  assert.ok(f.startedRuns >= 1);
  process.env.WORCA_FLAGS = 'requirements';
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).requirementsFlag, true);
});

test('requirements are filtered by person only when shared', async () => {
  requirement('ada@x.io'); requirement('bob@x.io'); requirement(null);
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).requirements, 1);
  assert.equal((await gather({ person: '_local', shared: false })).requirements, 3);
});

test('repeatingSchedules: from a schedules row, and from pipelines.schedule_id after the schedule is deleted', async () => {
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).repeatingSchedules, false);
  const id = schedule('ada@x.io');
  const withRow = await gather({ person: 'ada@x.io', shared: true });
  assert.deepEqual([withRow.schedules, withRow.repeatingSchedules], [true, true]);
  getDb().exec('DELETE FROM schedules');
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).repeatingSchedules, false);
  await run('ada@x.io', 'done', { scheduleId: id });
  const kept = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(kept.repeatingSchedules, true);
});

test('a one-off scheduled_runs row (or a timed run) counts for schedules only, not repeatingSchedules', async () => {
  oneOff('ada@x.io');
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.deepEqual([f.schedules, f.repeatingSchedules], [true, false]);
  getDb().exec('DELETE FROM scheduled_runs');
  await run('bob@x.io', 'done', { scheduledFor: ago(1) });
  const t = await gather({ person: 'bob@x.io', shared: true });
  assert.deepEqual([t.schedules, t.repeatingSchedules], [true, false]);
});

test('schedule facts are filtered by person only when shared', async () => {
  schedule('bob@x.io'); oneOff('bob@x.io'); await run('bob@x.io', 'done', { scheduleId: 'sch_b' });
  const ada = await gather({ person: 'ada@x.io', shared: true });
  assert.deepEqual([ada.schedules, ada.repeatingSchedules], [false, false]);
  const single = await gather({ person: '_local', shared: false });
  assert.deepEqual([single.schedules, single.repeatingSchedules], [true, true]);
});

test('single install backfills add-ons and spaces from the lock and workspaces table', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, gamma: {} });
  workspace(); workspace();
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addons: ['ignored'], spaces: true } });
  assert.equal(f.addonsInstalled, 3);
  assert.equal(f.addonsAtOnce, 3);
  assert.equal(f.spaces, 2);
});

test('shared install counts only the add-ons the person recorded that are still in the lock', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, other: { enabled: true } });
  workspace();
  const live = { ...NO_LIVE, addons: ['alpha', 'beta', 'removed'], spaces: true };
  const f = await gather({ person: 'ada@x.io', shared: true, live });
  assert.equal(f.addonsInstalled, 2);
  assert.equal(f.spaces, 1);
  const none = await gather({ person: 'bob@x.io', shared: true });
  assert.deepEqual([none.addonsInstalled, none.addonsAtOnce, none.spaces], [0, 0, 0]);
});

test('addonsAtOnce is the larger of the live peak and the add-ons installed now', async () => {
  writePluginsLock({ alpha: {} });
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addonPeak: 4 } });
  assert.deepEqual([f.addonsInstalled, f.addonsAtOnce], [1, 4]);
  writePluginsLock({ a: {}, b: {}, c: {} });
  const g = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addonPeak: 2 } });
  assert.equal(g.addonsAtOnce, 3);
});

test('a space recorded through the store (a boolean) counts as one space on a shared install', async () => {
  const store = await import('../src/core/worca-levels/store.mjs');
  await store.recordLive('ada@x.io', { space: true });
  const f = await gather({ person: 'ada@x.io', shared: true, live: store.readPerson('ada@x.io').live });
  assert.ok(f.spaces >= 1);
});

test('statsViewedAt and teamMetricsOpenedAt are read from the live record', async () => {
  const live = { ...NO_LIVE, statsViewedAt: '2026-11-01T10:00:00.000Z', teamMetricsOpenedAt: '2026-11-02T10:00:00.000Z' };
  const f = await gather({ person: '_local', shared: false, live });
  assert.equal(f.statsViewedAt, live.statsViewedAt);
  assert.equal(f.teamMetricsOpenedAt, live.teamMetricsOpenedAt);
});

test('parallelDoneAt is the later updated_at of the earliest overlapping done pair', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const { b } = await overlapping('ada@x.io', 'done', t0);
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.parallelDoneAt, getDb().prepare('SELECT updated_at AS u FROM pipelines WHERE id = ?').get(b).u);
});

test('parallelDoneAt is null when the pair is not both done, or only back-to-back, or has NULL started_at, or is deleted', async () => {
  for (const status of ['error', 'stopped', 'running']) {
    getDb().exec('DELETE FROM pipelines');
    await overlapping('ada@x.io', status);
    assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null, status);
  }
  getDb().exec('DELETE FROM pipelines');
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { startedAt: at(30), updatedAt: at(60) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
  getDb().exec('DELETE FROM pipelines');
  await run('ada@x.io', 'done', { startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { startedAt: null, updatedAt: at(40) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
  getDb().exec('DELETE FROM pipelines');
  await run('ada@x.io', 'done', { startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { startedAt: at(10), updatedAt: at(40), deletedAt: ago(0) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
});

test('parallelDoneAt: other people\'s runs never count for the person on a shared install', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { startedAt: at(0), updatedAt: at(30) });
  await run('bob@x.io', 'done', { startedAt: at(10), updatedAt: at(40) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
  assert.equal((await gather({ person: 'bob@x.io', shared: true })).parallelDoneAt, null);
  assert.ok((await gather({ person: '_local', shared: false })).parallelDoneAt);
});

function ledgered(id, state = 'recorded') { writeRunLedger(id, { state }); }

test('teamMetricsRuns counts only recorded ledgers of the person\'s done, non-deleted runs', async () => {
  const a = await run('ada@x.io', 'done');
  const b = await run('ada@x.io', 'done');
  const c = await run('ada@x.io', 'done');
  const err = await run('ada@x.io', 'error');
  const del = await run('ada@x.io', 'done', { deletedAt: ago(0) });
  const bob = await run('bob@x.io', 'done');
  ledgered(a); ledgered(b, 'skipped'); ledgered(c, 'pending'); ledgered(err); ledgered(del); ledgered(bob);
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).teamMetricsRuns, 1);
  assert.equal((await gather({ person: 'bob@x.io', shared: true })).teamMetricsRuns, 1);
  assert.equal((await gather({ person: '_local', shared: false })).teamMetricsRuns, 2);
});

test('teamMetricsRuns caps at 10 and stops reading ledgers at the 10th hit, newest first', async () => {
  const ids = [];
  for (let i = 0; i < 14; i++) ids.push(await run('ada@x.io', 'done', { updatedAt: ago(1, i * MIN) }));
  for (const id of ids) ledgered(id);
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.teamMetricsRuns, 10);
  // newest first: the 4 oldest runs are never examined, so removing their ledgers changes nothing
  for (const id of ids.slice(0, 4)) rmSync(ledgerFile(id), { force: true });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).teamMetricsRuns, 10);
  rmSync(ledgerFile(ids[13]), { force: true });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).teamMetricsRuns, 9);
});

test('council counts done finishes only; error, stopped, running and deleted runs are ignored', async () => {
  const now = Date.now();
  const mk = async (days, status, extra = {}) => {
    for (const n of [1, 2]) await run('ada@x.io', status, { startedAt: ago(days + 1), updatedAt: new Date(now - days * 86400000 + n * MIN).toISOString(), ...extra });
  };
  await mk(1, 'done'); await mk(2, 'error'); await mk(3, 'stopped'); await mk(4, 'running'); await mk(5, 'done', { deletedAt: ago(0) });
  const f = await gatherFacts({ person: 'ada@x.io', shared: true, live: NO_LIVE, tz: TZ, now }, { onboarding });
  assert.equal(f.council.current, 1);
  assert.equal(f.council.metAt, null);
});

test('council is per person on a shared install, and counts everyone on a single install', async () => {
  const now = Date.now();
  const two = async (who, days) => { for (const n of [1, 2]) await run(who, 'done', { updatedAt: new Date(now - days * 86400000 + n * MIN).toISOString() }); };
  await two('ada@x.io', 1); await two('bob@x.io', 1);
  const ada = await gatherFacts({ person: 'ada@x.io', shared: true, live: NO_LIVE, tz: TZ, now }, { onboarding });
  assert.equal(ada.council.current, 1);
  const bob1 = await run('bob@x.io', 'done', { updatedAt: new Date(now - 2 * 86400000).toISOString() });
  assert.ok(bob1);
  const zed = await gatherFacts({ person: 'zed@x.io', shared: true, live: NO_LIVE, tz: TZ, now }, { onboarding });
  assert.equal(zed.council.current, 0);
});

test('skip short-circuits a source: its override is not called and its fact is neutral', async () => {
  await overlapping('ada@x.io');
  const called = [];
  const spy = (name, value) => () => { called.push(name); return value; };
  const f = await gather({ person: 'ada@x.io', shared: true, skip: new Set(['onboarding', 'parallel', 'teamMetrics', 'council', 'countStartedRuns']) }, {
    onboarding: spy('onboarding', { done: 9, total: 9, steps: { teamPolicy: true } }),
    parallelIntervals: spy('parallel', []),
    teamMetricsRuns: spy('teamMetrics', 10),
    councilFinishes: spy('council', []),
    countStartedRuns: spy('countStartedRuns', 7),
    countDoneRuns: spy('countDoneRuns', 3),
  });
  assert.deepEqual(called, ['countDoneRuns']);
  assert.equal(f.gettingStartedDone, false);
  assert.deepEqual(f.gettingStarted, { done: 0, total: 0 });
  assert.equal(f.policyInstalled, false);
  assert.equal(f.parallelDoneAt, null);
  assert.equal(f.teamMetricsRuns, 0);
  assert.deepEqual(f.council, { current: 0, metAt: null });
  assert.equal(f.startedRuns, 0);
  assert.equal(f.doneRuns, 3);
});

test('a skipped real source does not read the ledger', async () => {
  const id = await run('ada@x.io', 'done');
  ledgered(id);
  const f = await gather({ person: 'ada@x.io', shared: true, skip: new Set(['teamMetrics']) });
  assert.equal(f.teamMetricsRuns, 0);
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).teamMetricsRuns, 1);
});

test('a source that throws yields its neutral value, is logged with context, and gatherFacts does not throw (I-12)', async () => {
  await run('ada@x.io', 'done');
  const boom = () => { throw new Error('db gone'); };
  const logged = [];
  const origWarn = console.warn;
  console.warn = (...a) => logged.push(a.join(' '));
  let f;
  try {
    f = await gather({ person: 'ada@x.io', shared: true }, {
      onboarding: async () => { throw new Error('probe failed'); },
      countStartedRuns: boom, addonFacts: boom, spaceCount: boom, scheduleFacts: boom,
      parallelIntervals: boom, teamMetricsRuns: boom, councilFinishes: boom,
    });
  } finally { console.warn = origWarn; }
  assert.equal(f.startedRuns, 0);
  assert.equal(f.gettingStartedDone, false);
  assert.equal(f.policyInstalled, false);
  assert.deepEqual(f.gettingStarted, { done: 0, total: 0 });
  assert.deepEqual([f.addonsInstalled, f.addonsAtOnce, f.spaces], [0, 0, 0]);
  assert.deepEqual([f.schedules, f.repeatingSchedules], [false, false]);
  assert.deepEqual([f.parallelDoneAt, f.teamMetricsRuns], [null, 0]);
  assert.deepEqual(f.council, { current: 0, metAt: null });
  assert.equal(f.doneRuns, 1); // an unaffected source still answers
  assert.ok(logged.some((l) => l.includes('countStartedRuns') && l.includes('db gone')), logged.join('\n'));
});

test('a malformed live record falls back to an empty default', async () => {
  const f = await gather({ person: '_local', shared: true, live: null });
  assert.deepEqual([f.addonsInstalled, f.spaces, f.statsViewedAt, f.teamMetricsOpenedAt], [0, 0, null, null]);
});
