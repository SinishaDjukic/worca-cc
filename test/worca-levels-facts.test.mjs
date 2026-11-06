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

const { gatherFacts } = await import('../src/core/worca-levels/facts.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { writePluginsLock } = await import('../src/core/plugins-lock.mjs');

const FACT_KEYS = ['gettingStartedDone', 'gettingStarted', 'requirements', 'requirementsFlag', 'startedRuns', 'doneRuns',
  'addonsInstalled', 'addonsEnabled', 'spaces', 'schedules', 'scheduledRuns', 'peakParallel', 'statsDays'];
const NO_LIVE = { addons: [], spaces: 0, statsDays: [], peakParallel: 0 };
const ago = (days, extraMs = 0) => new Date(Date.now() - days * 86400000 + extraMs).toISOString();
const MIN = 60000;

// Getting started is derived from the host (PATH, probes); the tests inject a fixed answer.
const onboarding = async () => ({ done: 9, total: 9 });
const gather = (input, sources = {}) => gatherFacts({ live: NO_LIVE, ...input }, { onboarding, ...sources });

let seq = 0;
// A bare pipelines row, written with the columns this suite reads. test/helpers/db-seed.mjs routes through
// artifacts.mjs (the production writers), whose import graph is far heavier than the facts under test.
async function run(startedBy, status = 'done', extra = {}) {
  const id = `worca${String(++seq).padStart(4, '0')}`;
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, started_by, schedule_id)
    VALUES (?, 'proj-00000001', 'project', ?, 'done', 0, ?, ?, ?, ?)`)
    .run(id, status, ago(1), ago(1), startedBy, extra.scheduleId ?? null);
  if (extra.phases) {
    const ins = getDb().prepare('INSERT INTO pipeline_phases (pipeline_id, ordinal, status, started_at, finished_at) VALUES (?,?,?,?,?)');
    extra.phases.forEach(([s, f], i) => ins.run(id, i, 'done', s, f));
  }
  return id;
}
function schedule(createdBy) {
  getDb().prepare(`INSERT INTO schedules (id, request, rule, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(`sch_${++seq}`, '{}', '{}', createdBy, ago(1), ago(1));
}
function requirement(createdBy) {
  getDb().prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_by, created_at, updated_at)
    VALUES ('project','k','t','d','draft','{}',?,?,?)`).run(createdBy, ago(1), ago(1));
}
function workspace() {
  getDb().prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(`wks-x-${++seq}`, `ws${seq}`, ago(1), ago(1));
}

beforeEach(() => {
  const db = getDb();
  for (const t of ['pipelines', 'schedules', 'req_features', 'workspaces']) db.exec(`DELETE FROM ${t}`);
  writePluginsLock({});
  delete process.env.WORCA_FLAGS;
});

test('shape: every fact is present and only a number or boolean (empty install)', async () => {
  const facts = await gather({ person: '_local', shared: false });
  assert.deepEqual(Object.keys(facts).sort(), [...FACT_KEYS].sort());
  for (const k of FACT_KEYS) {
    if (k === 'gettingStarted') assert.deepEqual(facts[k], { done: 9, total: 9 });
    else assert.ok(['number', 'boolean'].includes(typeof facts[k]), `${k} is ${typeof facts[k]}`);
  }
  assert.equal(facts.gettingStartedDone, true);
  assert.equal(facts.requirementsFlag, false);
  assert.equal(facts.startedRuns, 0);
  assert.equal(facts.peakParallel, 0);
});

test('Getting started is credited from install state, shared or not, and is incomplete when steps are missing', async () => {
  const part = async () => ({ done: 4, total: 9 });
  for (const shared of [false, true]) {
    const f = await gather({ person: 'ada@x.io', shared }, { onboarding: part });
    assert.equal(f.gettingStartedDone, false);
    assert.deepEqual(f.gettingStarted, { done: 4, total: 9 });
    const g = await gather({ person: 'ada@x.io', shared });
    assert.equal(g.gettingStartedDone, true);
  }
});

test('single install counts every run, including NULL started_by; only done runs count as done', async () => {
  await run(null, 'done');
  await run('someone@x.io', 'done');
  await run(null, 'error');
  const f = await gather({ person: '_local', shared: false });
  assert.equal(f.startedRuns, 3);
  assert.equal(f.doneRuns, 2);
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

test('requirements, schedules and scheduled runs are filtered by person only when shared', async () => {
  requirement('ada@x.io'); requirement('bob@x.io'); requirement(null);
  schedule('ada@x.io'); schedule('bob@x.io'); schedule(null);
  await run('ada@x.io', 'done', { scheduleId: 'sch_a' });
  await run('ada@x.io', 'done', { scheduleId: 'sch_a' });
  await run('bob@x.io', 'done', { scheduleId: 'sch_b' });
  await run('ada@x.io', 'done');
  const shared = await gather({ person: 'ada@x.io', shared: true });
  assert.deepEqual([shared.requirements, shared.schedules, shared.scheduledRuns], [1, 1, 2]);
  const single = await gather({ person: '_local', shared: false });
  assert.deepEqual([single.requirements, single.schedules, single.scheduledRuns], [3, 3, 3]);
});

test('single install backfills add-ons and spaces from the lock and workspaces table', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, gamma: {} });
  workspace(); workspace();
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, addons: ['ignored'], spaces: 9 } });
  assert.equal(f.addonsInstalled, 3);
  assert.equal(f.addonsEnabled, 2); // enabled !== false
  assert.equal(f.spaces, 2);
});

test('shared install counts only live add-ons and spaces, and only still-enabled add-ons count as enabled', async () => {
  writePluginsLock({ alpha: { enabled: true }, beta: { enabled: false }, other: { enabled: true } });
  workspace();
  const live = { ...NO_LIVE, addons: ['alpha', 'beta', 'removed'], spaces: 1 };
  const f = await gather({ person: 'ada@x.io', shared: true, live });
  assert.equal(f.addonsInstalled, 3);
  assert.equal(f.addonsEnabled, 1);
  assert.equal(f.spaces, 1);
  const none = await gather({ person: 'bob@x.io', shared: true });
  assert.deepEqual([none.addonsInstalled, none.addonsEnabled, none.spaces], [0, 0, 0]);
});

test('a space recorded through the store (a boolean) counts as one space on a shared install', async () => {
  const store = await import('../src/core/worca-levels/store.mjs');
  await store.recordLive('ada@x.io', { space: true });
  const f = await gather({ person: 'ada@x.io', shared: true, live: store.readPerson('ada@x.io').live });
  assert.ok(f.spaces >= 1);
});

test('peakParallel backfill: overlapping pipelines give 2, non-overlapping give 1', async () => {
  const t0 = Date.now() - 5 * 86400000;
  const at = (min) => new Date(t0 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { phases: [[at(0), at(30)]] });
  await run('ada@x.io', 'done', { phases: [[at(10), at(40)]] });
  await run('bob@x.io', 'done', { phases: [[at(5), at(35)]] });
  await run('ada@x.io', 'done', { phases: [[at(100), at(130)]] });
  const ada = await gather({ person: 'ada@x.io', shared: true });
  assert.equal(ada.peakParallel, 2);
  const single = await gather({ person: '_local', shared: false });
  assert.equal(single.peakParallel, 3);
  getDb().exec('DELETE FROM pipelines');
  await run('ada@x.io', 'done', { phases: [[at(0), at(30)]] });
  await run('ada@x.io', 'done', { phases: [[at(30), at(60)]] });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).peakParallel, 1);
});

test('peakParallel backfill uses each pipeline min start / max finish and ignores runs older than 90 days', async () => {
  const base = Date.now() - 3 * 86400000;
  const at = (min) => new Date(base + min * MIN).toISOString();
  // two phases with a gap still make one [0,60] span that overlaps the second pipeline
  await run('ada@x.io', 'done', { phases: [[at(0), at(10)], [at(50), at(60)]] });
  await run('ada@x.io', 'done', { phases: [[at(20), at(30)]] });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).peakParallel, 2);
  getDb().exec('DELETE FROM pipelines');
  const old = (min) => new Date(Date.now() - 100 * 86400000 + min * MIN).toISOString();
  await run('ada@x.io', 'done', { phases: [[old(0), old(30)]] });
  await run('ada@x.io', 'done', { phases: [[old(10), old(40)]] });
  assert.equal((await gather({ person: 'ada@x.io', shared: true })).peakParallel, 0);
});

test('peakParallel is the max of the live value and the backfill; statsDays is the live day count', async () => {
  const f = await gather({ person: '_local', shared: false, live: { ...NO_LIVE, peakParallel: 4, statsDays: ['2026-11-01', '2026-11-02', '2026-11-04'] } });
  assert.equal(f.peakParallel, 4);
  assert.equal(f.statsDays, 3);
});

test('a source that throws yields 0/false, is logged with context, and gatherFacts does not throw', async () => {
  await run('ada@x.io', 'done');
  const boom = () => { throw new Error('db gone'); };
  const logged = [];
  const origWarn = console.warn;
  console.warn = (...a) => logged.push(a.join(' '));
  let f;
  try {
    f = await gather({ person: 'ada@x.io', shared: true }, {
      onboarding: async () => { throw new Error('probe failed'); },
      countStartedRuns: boom, addonFacts: boom, spaceCount: boom, peakParallelBackfill: boom,
    });
  } finally { console.warn = origWarn; }
  assert.equal(f.startedRuns, 0);
  assert.equal(f.gettingStartedDone, false);
  assert.deepEqual(f.gettingStarted, { done: 0, total: 0 });
  assert.deepEqual([f.addonsInstalled, f.addonsEnabled, f.spaces, f.peakParallel], [0, 0, 0, 0]);
  assert.equal(f.doneRuns, 1); // an unaffected source still answers
  assert.ok(logged.some((l) => l.includes('countStartedRuns') && l.includes('db gone')), logged.join('\n'));
});

test('a malformed live record falls back to an empty default', async () => {
  const f = await gather({ person: '_local', shared: true, live: null });
  assert.deepEqual([f.addonsInstalled, f.spaces, f.statsDays, f.peakParallel], [0, 0, 0, 0]);
});
