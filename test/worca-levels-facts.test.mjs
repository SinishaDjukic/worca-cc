// test/worca-levels-facts.test.mjs
// src/core/worca-levels/facts.mjs — the numbers and booleans the worca-level evaluator reads, gathered
// from the DB, the plugin lock, the requirements flag and the person's live record.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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

const { gatherFacts, scheduleFacts, requirementCount, countStartedRuns } = await import('../src/core/worca-levels/facts.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { writePluginsLock } = await import('../src/core/plugins-lock.mjs');

const FACT_KEYS = ['setupFinished', 'providerSignedIn', 'runnerSteps', 'teamMetricsOn', 'teamPolicyOn', 'realRuns', 'runsOnDays',
  'activeDays', 'prsOpened', 'prsMerged', 'prMergedUnknown', 'daysUnknown', 'scheduledRunDone', 'workspaceRunDone', 'projects',
  'repeatingScheduleRunsMax', 'addonsInstalled', 'addonsAtOnce', 'parallelDoneAt'];
const NO_LIVE = { addons: [], addonPeak: 0, spaces: false };
const ago = (days, extraMs = 0) => new Date(Date.now() - days * 86400000 + extraMs).toISOString();
const MIN = 60000;
const TZ = 'UTC';

// Getting started is derived from the host (PATH, probes); the tests inject a fixed answer.
const onboarding = async () => ({ setupFinished: true, providerSignedIn: true, runnerSteps: { done: 6, of: 6 }, teamMetricsOn: false, teamPolicyOn: true });
const gather = (input, sources = {}) => gatherFacts({ live: NO_LIVE, tz: TZ, ...input }, { onboarding, ...sources });

let seq = 0;
// A bare pipelines row, written with the columns this suite reads. test/helpers/db-seed.mjs routes through
// artifacts.mjs (the production writers), whose import graph is far heavier than the facts under test.
async function run(startedBy, status = 'done', extra = {}) {
  const id = extra.id ?? `worca${String(++seq).padStart(4, '0')}`;
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, started_by, schedule_id, scheduled_for, deleted_at, total_cost_usd, run_setup, credit_key, pr_url, pr_state, workspace_meta)
    VALUES (?, ?, ?, ?, 'done', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, extra.projectKey ?? 'proj-00000001', extra.target ?? 'project', status, 'startedAt' in extra ? extra.startedAt : ago(1), 'updatedAt' in extra ? extra.updatedAt : ago(1), startedBy,
      extra.scheduleId ?? null, extra.scheduledFor ?? null, extra.deletedAt ?? null,
      extra.cost ?? 0, extra.runSetup ?? null, extra.creditKey ?? null, extra.prUrl ?? null, extra.prState ?? null, extra.workspaceMeta ?? null);
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
// Two runs of `status` that overlap in time: [t0, t0+30m] and [t0+10m, t0+40m].
async function overlapping(who, status = 'done', t0 = Date.now() - 5 * 86400000) {
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  const a = await run(who, status, { cost: 1, startedAt: at(0), updatedAt: at(30) });
  const b = await run(who, status, { cost: 1, startedAt: at(10), updatedAt: at(40) });
  return { a, b };
}

beforeEach(() => {
  const db = getDb();
  for (const t of ['pipelines', 'scheduled_runs', 'schedules', 'req_features']) db.exec(`DELETE FROM ${t}`);
  writePluginsLock({});
  delete process.env.WORCA_FLAGS;
});


test('shape: every fact v2 key is present with the neutral value for the levels still to come', async () => {
  const facts = await gather({ person: '_local', shared: false });
  assert.deepEqual(Object.keys(facts).sort(), [...FACT_KEYS].sort());
  assert.deepEqual([facts.setupFinished, facts.providerSignedIn], [true, true]);
  assert.deepEqual(facts.runnerSteps, { done: 6, of: 6 });
  assert.deepEqual([facts.teamMetricsOn, facts.teamPolicyOn], [false, true]);
  assert.equal(facts.realRuns, 0);
  assert.deepEqual(facts.runsOnDays, { metAt: null, runs: 0, days: 0 });
  assert.deepEqual(facts.activeDays, { inWindow: 0, metAt: null });
  assert.equal(facts.parallelDoneAt, null);
});

test('the onboarding source supplies setup, provider, steps 1-6 and the team steps', async () => {
  const part = async () => ({ setupFinished: false, providerSignedIn: true, runnerSteps: { done: 9, of: 9 }, teamMetricsOn: true, teamPolicyOn: false });
  const f = await gather({ person: 'ada@x.io', shared: true }, { onboarding: part });
  assert.deepEqual([f.setupFinished, f.providerSignedIn, f.teamMetricsOn, f.teamPolicyOn], [false, true, true, false]);
  assert.deepEqual(f.runnerSteps, { done: 6, of: 6 }, 'never more than 6 steps');
});

test('real-run counts exclude demo/$0 and include deleted runs', async () => {
  await run('ada@x.io', 'done', { cost: 0.5 });
  await run('ada@x.io', 'done', { cost: 0.5, deletedAt: ago(0) });
  await run('ada@x.io', 'done', { cost: 0 });
  await run('ada@x.io', 'done', { cost: 0.5, runSetup: JSON.stringify({ mock: true }) });
  await run('ada@x.io', 'error', { cost: 0.5 });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).realRuns, 2);
  assert.equal((await gather({ person: '_local', shared: false })).realRuns, 2);
});

test('shared install: a deleted run still counts for its owner (credit_key) and for no one else', async () => {
  await run(null, 'done', { cost: 1, deletedAt: ago(0), creditKey: 'Ada@X.io' });
  await run('bob@x.io', 'done', { cost: 1 });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).realRuns, 1);
  assert.equal((await gather({ person: 'bob@x.io', shared: true })).realRuns, 1);
  assert.equal((await gather({ person: 'zed@x.io', shared: true })).realRuns, 0);
});

test('single install counts every real run, including NULL started_by and NULL credit_key', async () => {
  await run(null, 'done', { cost: 1 });
  await run('someone@x.io', 'done', { cost: 1 });
  assert.equal((await gather({ person: '_local', shared: false })).realRuns, 2);
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).realRuns, 0, 'NULL started_by counts on a single install only');
});

test('countStartedRuns (past activity) counts deleted runs on COALESCE(started_by, credit_key)', () => {
  const who = { person: 'ada@x.io', shared: true };
  assert.equal(countStartedRuns(who), 0);
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, started_by, credit_key, deleted_at)
    VALUES ('worcaDel1', 'proj-00000001', 'project', 'done', 'done', 0, ?, ?, NULL, 'ada@x.io', ?)`).run(ago(1), ago(1), ago(0));
  assert.equal(countStartedRuns(who), 1);
  assert.equal(countStartedRuns({ person: 'bob@x.io', shared: true }), 0);
  requirement('ada@x.io'); requirement('bob@x.io');
  assert.equal(requirementCount(who), 1);
});

test('scheduleFacts: from a schedules row, and from pipelines.schedule_id after the schedule is deleted', async () => {
  const ada = { person: 'ada@x.io', shared: true };
  assert.equal(scheduleFacts(ada).repeatingSchedules, false);
  const id = schedule('ada@x.io');
  assert.deepEqual(scheduleFacts(ada), { schedules: true, repeatingSchedules: true });
  getDb().exec('DELETE FROM schedules');
  assert.equal(scheduleFacts(ada).repeatingSchedules, false);
  await run('ada@x.io', 'done', { scheduleId: id });
  assert.equal(scheduleFacts(ada).repeatingSchedules, true);
});

test('scheduleFacts: a one-off row (or a timed run) counts for schedules only; filtered by person only when shared', async () => {
  oneOff('ada@x.io');
  assert.deepEqual(scheduleFacts({ person: 'ada@x.io', shared: true }), { schedules: true, repeatingSchedules: false });
  assert.deepEqual(scheduleFacts({ person: 'zed@x.io', shared: true }), { schedules: false, repeatingSchedules: false });
  getDb().exec('DELETE FROM scheduled_runs');
  await run('bob@x.io', 'done', { scheduledFor: ago(1) });
  assert.deepEqual(scheduleFacts({ person: 'bob@x.io', shared: true }), { schedules: true, repeatingSchedules: false });
  assert.deepEqual(scheduleFacts({ person: '_local', shared: false }), { schedules: true, repeatingSchedules: false });
});

test('single install backfills add-ons from the lock', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, gamma: {} });
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addons: ['ignored'] } });
  assert.equal(f.addonsInstalled, 3);
  assert.equal(f.addonsAtOnce, 3);
});

test('shared install counts only the add-ons the person recorded that are still in the lock', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, other: { enabled: true } });
  const f = await gather({ person: 'ada@x.io', shared: true, live: { ...NO_LIVE, addons: ['alpha', 'beta', 'removed'] } });
  assert.equal(f.addonsInstalled, 2);
  const none = await gather({ person: 'bob@x.io', shared: true });
  assert.deepEqual([none.addonsInstalled, none.addonsAtOnce], [0, 0]);
});

test('addonsAtOnce is the larger of the live peak and the add-ons installed now', async () => {
  writePluginsLock({ alpha: {} });
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addonPeak: 4 } });
  assert.deepEqual([f.addonsInstalled, f.addonsAtOnce], [1, 4]);
  writePluginsLock({ a: {}, b: {}, c: {} });
  assert.equal((await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addonPeak: 2 } })).addonsAtOnce, 3);
});

test('parallelDoneAt is the later updated_at of the earliest overlapping done pair', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const { b } = await overlapping('ada@x.io', 'done', t0);
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.parallelDoneAt, getDb().prepare('SELECT updated_at AS u FROM pipelines WHERE id = ?').get(b).u);
});

test('parallelDoneAt is null when the pair is not both done, or only back-to-back, or has NULL started_at', async () => {
  for (const status of ['error', 'stopped', 'running']) {
    getDb().exec('DELETE FROM pipelines');
    await overlapping('ada@x.io', status);
    assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null, status);
  }
  getDb().exec('DELETE FROM pipelines');
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(30), updatedAt: at(60) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
  getDb().exec('DELETE FROM pipelines');
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { cost: 1, startedAt: null, updatedAt: at(40) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
});

test('parallelDoneAt still counts a pair when one of its runs was deleted (D-4)', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(0), updatedAt: at(30) });
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(10), updatedAt: at(40), deletedAt: ago(0) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, at(40));
});

test('parallelDoneAt: other people\'s runs never count for the person on a shared install', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { cost: 1, startedAt: at(0), updatedAt: at(30) });
  await run('bob@x.io', 'done', { cost: 1, startedAt: at(10), updatedAt: at(40) });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).parallelDoneAt, null);
  assert.equal((await gather({ person: 'bob@x.io', shared: true })).parallelDoneAt, null);
  assert.ok((await gather({ person: '_local', shared: false })).parallelDoneAt);
});

test('workspace run, scheduled run, distinct projects incl. workspace members, merged-PR unknown', async () => {
  const me = { person: 'ada@x.io', shared: true };
  await run('ada@x.io', 'done', { cost: 1, projectKey: 'proj-a' });
  await run('ada@x.io', 'done', { cost: 1, projectKey: 'proj-a', prUrl: 'https://x/pr/1', prState: 'MERGED' });
  const f1 = await gather(me);
  assert.deepEqual([f1.workspaceRunDone, f1.scheduledRunDone, f1.projects, f1.prsOpened, f1.prsMerged, f1.prMergedUnknown], [false, false, 1, 1, 1, false]);
  await run('ada@x.io', 'done', { cost: 1, projectKey: 'proj-a', target: 'workspace', workspaceMeta: JSON.stringify({ projectKeys: ['proj-a', 'proj-b', 'proj-c'] }), prUrl: 'https://x/pr/2' });
  await run('ada@x.io', 'done', { cost: 1, projectKey: 'no-project-00000000' });
  await run('ada@x.io', 'done', { cost: 1, projectKey: 'proj-z', scheduledFor: ago(1), deletedAt: ago(0), workspaceMeta: '{not json' });
  await run('ada@x.io', 'done', { cost: 0, projectKey: 'proj-free', prUrl: 'https://x/pr/3', prState: 'MERGED' });
  const f = await gather(me);
  assert.equal(f.workspaceRunDone, true);
  assert.equal(f.scheduledRunDone, true, 'a run with scheduled_for counts');
  assert.equal(f.projects, 4, 'a, b, c from the workspace members, plus z; the no-project key and the $0 run do not count');
  assert.deepEqual([f.prsOpened, f.prsMerged, f.prMergedUnknown], [2, 1, true], 'the $0 run is not a real run');
  assert.equal((await gather({ person: 'bob@x.io', shared: true })).projects, 0);
});

test('repeatingScheduleRunsMax is the highest real-run count of one schedule; a schedule run sets scheduledRunDone', async () => {
  for (let i = 0; i < 3; i++) await run('ada@x.io', 'done', { cost: 1, scheduleId: 'sch_a' });
  await run('ada@x.io', 'done', { cost: 1, scheduleId: 'sch_b' });
  await run('ada@x.io', 'done', { cost: 0, scheduleId: 'sch_b' });
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.deepEqual([f.repeatingScheduleRunsMax, f.scheduledRunDone], [3, true]);
});

test('runsOnDays and activeDays come from the real runs, one active day per schedule', async () => {
  for (let i = 0; i < 12; i++) await run('ada@x.io', 'done', { cost: 1, updatedAt: ago(10 - (i % 4), i * MIN), scheduleId: i < 6 ? 'sch_a' : null });
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.runsOnDays.runs, 12);
  assert.equal(f.runsOnDays.days, 4);
  assert.ok(f.runsOnDays.metAt, 'ten runs on three days');
  assert.equal(f.activeDays.inWindow, 4);
  assert.equal(f.activeDays.metAt, null);
});

test('ten runs of one schedule give one day, so they alone never meet the 3-day rule (D-9)', async () => {
  for (let i = 0; i < 10; i++) await run('ada@x.io', 'done', { cost: 1, updatedAt: ago(10 - i), scheduleId: 'sch_daily' });
  const f = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(f.runsOnDays.runs, 10);
  assert.equal(f.runsOnDays.days, 1);
  assert.equal(f.runsOnDays.metAt, null);
});

test('a failing realRunRows source leaves the row facts neutral', async () => {
  const f = await gather({ person: 'ada@x.io', shared: true }, { realRunRows: () => { throw new Error('boom'); } });
  assert.deepEqual([f.projects, f.prsOpened, f.scheduledRunDone, f.workspaceRunDone, f.repeatingScheduleRunsMax], [0, 0, false, false, 0]);
  assert.deepEqual(f.runsOnDays, { metAt: null, runs: 0, days: 0 });
});

test('skip short-circuits a source: its override is not called and its fact is neutral', async () => {
  await overlapping('ada@x.io');
  const called = [];
  const spy = (name, value) => () => { called.push(name); return value; };
  const f = await gather({ person: 'ada@x.io', shared: true, skip: new Set(['onboarding', 'parallel']) }, {
    onboarding: spy('onboarding', { setupFinished: true, providerSignedIn: true, runnerSteps: { done: 6, of: 6 } }),
    parallelIntervals: spy('parallel', []),
    realRuns: spy('realRuns', 3),
  });
  assert.deepEqual(called, ['realRuns']);
  assert.deepEqual([f.setupFinished, f.providerSignedIn, f.teamPolicyOn], [false, false, false]);
  assert.deepEqual(f.runnerSteps, { done: 0, of: 6 });
  assert.equal(f.parallelDoneAt, null);
  assert.equal(f.realRuns, 3);
});

test('a source that throws yields its neutral value, is logged with context, and gatherFacts does not throw (I-12)', async () => {
  await run('ada@x.io', 'done', { cost: 1 });
  const boom = () => { throw new Error('db gone'); };
  const logged = [];
  const origWarn = console.warn;
  console.warn = (...a) => logged.push(a.join(' '));
  let f;
  try {
    f = await gather({ person: 'ada@x.io', shared: true }, {
      onboarding: async () => { throw new Error('probe failed'); },
      realRuns: boom, addonFacts: boom, parallelIntervals: boom,
    });
  } finally { console.warn = origWarn; }
  assert.equal(f.realRuns, 0);
  assert.deepEqual([f.setupFinished, f.providerSignedIn, f.teamMetricsOn], [false, false, false]);
  assert.deepEqual(f.runnerSteps, { done: 0, of: 6 });
  assert.deepEqual([f.addonsInstalled, f.addonsAtOnce, f.parallelDoneAt], [0, 0, null]);
  assert.ok(logged.some((l) => l.includes('realRuns') && l.includes('db gone')), logged.join('\n'));
});

test('a malformed live record falls back to an empty default', async () => {
  const f = await gather({ person: '_local', shared: true, live: null });
  assert.deepEqual([f.addonsInstalled, f.addonsAtOnce], [0, 0]);
});
