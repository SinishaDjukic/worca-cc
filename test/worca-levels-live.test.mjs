// test/worca-levels-live.test.mjs — the live-event hooks of the worca levels (plan §3.7): a successful plugin install,
// and a workspace create or membership edit each record a `live` patch for the
// person who did it and send ONE payload-free `worca-level-changed` poke. A failed install or a rejected workspace
// create records nothing; no response body gains worca data (I-5). In-process server, mock mode, sandboxed homes.
// The second half drives the level service itself (createWorcaLevelService) with injected fact sources.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gatherFacts } from '../src/core/worca-levels/facts.mjs';
import { WORCA_LEVEL_COUNT } from '../src/shared/worca-levels.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
const REAL_HEADER = process.env.WORCA_IDENTITY_HEADER;
const REAL_PROXIES = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
process.env.HOME = home;                         // worca-levels.json lives under HOME

const run = promisify(execFile);
const POKE = 'worca-level-changed';
const FULL_SHA = 'a'.repeat(40);

let server, base, runs, store, ws, repoDir, goodSha;
const frames = [];
const cleanup = [];
const call = async (method, p, body, headers = {}) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, text, body: text ? JSON.parse(text) : null };
};
const pokes = () => frames.filter((f) => f.type === POKE).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Run `act`, give the broadcast a moment, return how many pokes it caused. */
async function pokesDuring(act) {
  const before = pokes();
  const out = await act();
  await sleep(150);
  return { out, pokes: pokes() - before };
}
const live = (key) => store.readPerson(key)?.live ?? null;

before(async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  repoDir = mkdtempSync(join(tmpdir(), 'worca-cc-live-plugin-'));
  cleanup.push(repoDir);
  writeFileSync(join(repoDir, 'worca-cc-plugin.json'), JSON.stringify({ name: 'live-src', version: '0.1.0', description: 'live fixture',
    taskSources: [{ id: 'main', displayName: 'Live', module: './connector/index.mjs', configSchema: [], inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] }));
  mkdirSync(join(repoDir, 'connector'));
  writeFileSync(join(repoDir, 'connector', 'index.mjs'), 'export default () => ({ async validateConfig() { return { ok: true }; } });\n');
  const git = (...args) => run('git', ['-C', repoDir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', repoDir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'v1');
  goodSha = (await git('rev-parse', 'HEAD')).stdout.trim();

  ({ server, runs } = await import('../ui/server.mjs'));
  store = await import('../src/core/worca-levels/store.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
});

after(async () => {
  for (const e of runs.values()) { try { e.orch.stop(); } catch { /* already over */ } }
  await sleep(300);
  ws?.close();
  server?.closeAllConnections?.();
  if (server) await new Promise((r) => server.close(r));
  delete process.env.WORCA_MOCK;
  process.env.HOME = REAL_HOME;
  if (REAL_HEADER === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = REAL_HEADER;
  if (REAL_PROXIES === undefined) delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; else process.env.WORCA_IDENTITY_TRUSTED_PROXIES = REAL_PROXIES;
  for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  delete process.env.WORCA_IDENTITY_HEADER;
  try { unlinkSync(store.worcaLevelsFile()); } catch { /* none yet */ }
});

test('POST /api/team-metrics/discover and /api/policy/discover each send one worca-level-changed poke', async () => {
  assert.equal((await call('GET', '/api/worca-level')).status, 200);   // the poke is a no-op until the first level request made the service
  for (const path of ['/api/team-metrics/discover', '/api/policy/discover']) {
    const { out, pokes: n } = await pokesDuring(() => call('POST', path));
    assert.equal(out.status, 200, out.text);
    assert.ok(n >= 1, `${path} pokes the level`);
  }
});

test('a persisted PR state change pokes once; the same state again does not', async () => {
  assert.equal((await call('GET', '/api/worca-level')).status, 200);
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { persistPrState } = await import('../src/core/artifacts.mjs');
  const { id } = await seedPipeline(repoDir, { title: 'Pr', status: 'done', startedAt: '2026-06-01T00:00:00Z' });
  const pr = { url: 'https://gh/x/pull/7', number: 7, state: 'MERGED' };
  assert.equal((await pokesDuring(() => persistPrState(id, pr))).pokes, 1);
  assert.equal((await pokesDuring(() => persistPrState(id, pr))).pokes, 0);
});

const noWorcaData = (text) => assert.doesNotMatch(text, /worca-?level|peakParallel|"live"\s*:/i, 'I-5: the response carries no worca data');

test('plugin install: a failed install records nothing; a successful one records the plugin id with one poke', async () => {
  const mkt = await call('POST', '/api/marketplaces', { url: repoDir });
  assert.equal(mkt.status, 200, mkt.text);
  const marketplace = mkt.body.marketplace.id;
  const body = { repoUrl: repoDir, subdir: '', name: 'live-src', sha: goodSha, marketplace };

  const bad = await pokesDuring(() => call('POST', '/api/plugins/install', { ...body, sha: FULL_SHA }));
  assert.notEqual(bad.out.status, 200);
  assert.deepEqual([bad.pokes, store.readPerson('_local')], [0, null], 'nothing recorded, nothing sent');

  const good = await pokesDuring(() => call('POST', '/api/plugins/install', body));
  assert.equal(good.out.status, 200, good.out.text);
  assert.equal(good.pokes, 1);
  assert.deepEqual(live('_local').addons, ['live-src']);
  noWorcaData(good.out.text);
});

test('workspace create: a rejected create records nothing; a created one records spaces with one poke', async () => {
  const dirs = [0, 1, 2].map((i) => { const d = mkdtempSync(join(tmpdir(), `worca-cc-live-ws${i}-`)); writeFileSync(join(d, 'n.txt'), 'n\n'); cleanup.push(d); return d; });
  for (const [i, d] of dirs.entries()) assert.equal((await call('POST', '/api/projects', { name: `Live ${i}`, path: d })).status, 200);

  const rejected = await pokesDuring(() => call('POST', '/api/workspaces', { name: 'Live WS', projectPaths: [dirs[0]] }));
  assert.equal(rejected.out.status, 400);
  assert.deepEqual([rejected.pokes, store.readPerson('_local')], [0, null]);

  const created = await pokesDuring(() => call('POST', '/api/workspaces', { name: 'Live WS', projectPaths: [dirs[0], dirs[1], dirs[2]] }));
  assert.equal(created.out.status, 201, created.out.text);
  assert.equal(created.pokes, 1);
  assert.equal(live('_local').spaces, true);
  noWorcaData(created.out.text);

  // The membership edit records too: clear the flag, then drop a member without a re-scan.
  unlinkSync(store.worcaLevelsFile());
  const id = created.out.body.workspace.id;
  const edited = await pokesDuring(() => call('POST', `/api/workspaces/${id}/members`, { remove: dirs[2], rescan: 'none' }));
  assert.equal(edited.out.status, 200, edited.out.text);
  assert.equal(edited.pokes, 1);
  assert.equal(live('_local').spaces, true);
  noWorcaData(edited.out.text);
});

// ---------------------------------------------------------------------------------------------------------------------
// The level service. Every fact source is replaced, so no test reads the database or the plugin lock.

const { createWorcaLevelService, WorcaLevelRequestError } = await import('../src/core/worca-levels/service.mjs');
const NOW = '2026-05-11T10:00:00.000Z';
const LOCAL = { headers: {} };
const person = (email) => ({ worcaUser: { email }, headers: {} });
const A = person('Ann@Example.com');
const B = person('bob@example.com');

/** Mutable fact world: tests change `w`, the sources read it. `calls` counts the sources D-13 may skip. */
function world(over = {}) {
  const w = {
    onboarding: { setupFinished: false, providerSignedIn: false, runnerSteps: { done: 0, of: 6 } }, realRuns: 0,
    requirements: 0, done: 0, addons: 0, spaces: 0, schedules: false, repeating: false,
    intervals: [], teamRuns: 0, finishes: [], rows: [], ...over,
  };
  const calls = { teamMetricsRuns: 0, parallelIntervals: 0, councilFinishes: 0, tz: [] };
  const sources = {
    onboarding: () => w.onboarding,
    realRuns: () => w.realRuns,
    requirementsFlag: () => true,
    requirementCount: () => w.requirements,
    countStartedRuns: () => w.requirements,
    countDoneRuns: () => w.done,
    scheduleFacts: () => ({ schedules: w.schedules, repeatingSchedules: w.repeating }),
    addonFacts: () => ({ addonsInstalled: w.addons, addonsAtOnce: w.addons }),
    spaceCount: () => w.spaces,
    parallelIntervals: () => { calls.parallelIntervals++; return w.intervals; },
    realRunRows: () => w.rows,
    teamMetricsRuns: () => { calls.teamMetricsRuns++; return w.teamRuns; },
    councilFinishes: () => { calls.councilFinishes++; return w.finishes; },
  };
  const gather = (input) => { calls.tz.push(input.tz); return gatherFacts(input, sources); };
  return { w, calls, gather };
}

function makeService({ fresh = true, ...worldOver } = {}) {
  const fx = world(worldOver);
  const pokes = [];
  const service = createWorcaLevelService({
    isFreshInstall: () => fresh,
    emitChanged: (t) => pokes.push(t),
    gatherFacts: fx.gather,
    hasSharedActivity: () => fresh === false,
    now: () => NOW,
  });
  return { ...fx, service, pokes };
}

/** Facts that backfill to Runner (level 2). */
const SETUP = { setupFinished: true, providerSignedIn: true, runnerSteps: { done: 0, of: 6 } };
const RUNNER = { onboarding: { ...SETUP, runnerSteps: { done: 6, of: 6 } }, realRuns: 3 };
const seed = (key, over) => store.updatePerson(key, () => ({
  level: 2, celebrated: 2, welcome: { kind: 'new', seenAt: NOW }, doneAt: {}, tz: null,
  live: { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null },
  createdAt: NOW, updatedAt: NOW, ...over,
}));
/** A record under the v2 rules: it is latched, never migrated. */
const seedV2 = (key, over) => seed(key, { rules: 2, reachedAt: {}, summary: null, nudged: {}, modeSuggestion: { advanced: null, expert: null }, ...over });
const rejects = (p) => assert.rejects(p, (e) => e instanceof WorcaLevelRequestError && e.code === 'WORCA_LEVEL_BAD_REQUEST');

test('service: page-view events are accepted and record nothing (D-19)', async () => {
  const { service, pokes } = makeService();
  for (const type of ['stats-viewed', 'team-metrics-viewed']) await service.recordViewed(LOCAL, { type });
  assert.equal(existsSync(store.worcaLevelsFile()), false);
  assert.deepEqual(pokes, []);
});

test('service: a bad viewed type, ack target or ack index throws and writes nothing', async () => {
  const { service } = makeService();
  await rejects(service.recordViewed(LOCAL, { type: 'level-up' }));
  await rejects(service.recordViewed(LOCAL, {}));
  await rejects(service.ack(LOCAL, { what: 'item' }));
  for (const index of [0, 6, 1.5, '2', undefined]) await rejects(service.ack(LOCAL, { what: 'celebration', index }));
  assert.equal(existsSync(store.worcaLevelsFile()), false);
});

test('service: tz — a valid zone is stored, an invalid one is ignored in favour of the stored zone (D-6)', async () => {
  const { service, calls } = makeService();
  await service.getState(LOCAL, { tz: 'Europe/Paris' });
  assert.equal(store.readPerson('_local').tz, 'Europe/Paris');
  await service.getState(LOCAL, { tz: 'Not/AZone' });
  await service.getState(LOCAL, {});
  assert.deepEqual(calls.tz, ['Europe/Paris', 'Europe/Paris', 'Europe/Paris']);
  assert.equal(store.readPerson('_local').tz, 'Europe/Paris');
  await service.getState(LOCAL, { tz: 'Asia/Tokyo' });
  assert.equal(store.readPerson('_local').tz, 'Asia/Tokyo');
});

test('service: tz — with nothing stored an invalid zone falls back to the server zone and does not fail', async () => {
  const { service, calls } = makeService();
  await service.getState(LOCAL, { tz: 'Not/AZone' });
  assert.equal(calls.tz[0], Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(store.readPerson('_local').tz, null);
});

test('service: D-13 — parallel is not read once its item is latched in a v2 record', async () => {
  await seedV2('_local', { level: 4, celebrated: 4, doneAt: { parallelFeatures: NOW } });
  const m = makeService({ fresh: false });
  await m.service.getState(LOCAL);
  assert.equal(m.calls.parallelIntervals, 0);
  unlinkSync(store.worcaLevelsFile());
  await seedV2('_local', { level: 4, celebrated: 4 });
  await m.service.getState(LOCAL);
  assert.equal(m.calls.parallelIntervals, 1);
});

test('service: D-13 — the first v2 evaluation reads every source, even when a v1 stamp is kept', async () => {
  await seed('_local', { level: 4, celebrated: 4, doneAt: { parallelFeatures: NOW } });
  const m = makeService({ fresh: false });
  await m.service.getState(LOCAL);
  assert.equal(m.calls.parallelIntervals, 1);
});

test('service: celebration once per level; skipped levels are not celebrated; index 5 is accepted', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  await m.service.getState(LOCAL);                         // backfilled at Runner: celebrated = 2
  assert.equal((await m.service.getState(LOCAL)).celebration, null, 'the backfilled level is not celebrated');

  Object.assign(m.w, { onboarding: SETUP, realRuns: 19, rows: HISTORY, schedules: true });
  const up = await m.service.getState(LOCAL);
  assert.equal(up.level.index, 3);
  assert.deepEqual([up.celebration.index, up.celebration.key, up.celebration.nextName, up.celebration.nextUnit], [3, 'hooked', 'WorcaHolic', 'items']);
  assert.equal(up.celebration.nextTotal, 3);
  assert.ok(up.celebration.hat && up.celebration.phrase && up.celebration.recap && up.celebration.tint);

  assert.equal((await m.service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration, null);
  assert.equal((await m.service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration, null, 'idempotent');
  assert.equal(store.readPerson('_local').celebrated, 3);

  unlinkSync(store.worcaLevelsFile());
  await seedV2('_local', { level: 5, celebrated: 4 });
  const top = await m.service.getState(LOCAL);
  assert.deepEqual([top.top, top.next, top.nextLevel, top.celebration.nextName, top.celebration.nextTotal], [true, null, null, null, null]);
  const acked = await m.service.ack(LOCAL, { what: 'celebration', index: 5 });
  assert.deepEqual([acked.celebration, store.readPerson('_local').celebrated, WORCA_LEVEL_COUNT], [null, 5, 5]);
});

test('service: only the shown level is acknowledged — a level reached since stays to be celebrated', async () => {
  await seedV2('_local', { level: 4, celebrated: 2 });
  const { service } = makeService({ fresh: false });
  assert.equal((await service.getState(LOCAL)).celebration.index, 4, 'only the highest level is celebrated');
  assert.equal((await service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration.index, 4);
  assert.equal((await service.ack(LOCAL, { what: 'celebration', index: 4 })).celebration, null);
});

test('service: the view lists the ladder with a state per level and the full level copy', async () => {
  await seedV2('_local', { level: 3, celebrated: 3 });
  const view = await makeService({ fresh: false }).service.getState(LOCAL);
  assert.equal(view.count, WORCA_LEVEL_COUNT);
  assert.deepEqual(view.ladder.map((l) => l.state), ['reached', 'reached', 'current', 'next', 'later']);
  assert.deepEqual(Object.keys(view.ladder[0]), ['index', 'key', 'name', 'tint', 'hue', 'description', 'avatar', 'state', 'reachedAt', 'items']);
  assert.deepEqual(Object.keys(view.level), ['index', 'key', 'name', 'tint', 'hue', 'tagline', 'description', 'hat', 'phrase', 'recap', 'avatar']);
  assert.equal(view.nextLevel.name, 'WorcaHolic');

  unlinkSync(store.worcaLevelsFile());
  await seedV2('_local', { level: 5, celebrated: 5 });
  const top = await makeService({ fresh: false }).service.getState(LOCAL);
  assert.deepEqual(top.ladder.map((l) => l.state), ['reached', 'reached', 'reached', 'reached', 'current']);
});

test('service: ann and bob each see only their own (R-po-24)', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  await m.service.getState(A);
  await m.service.ack(A, { what: 'summary' });
  assert.deepEqual(Object.keys(store.readPerson('ann@example.com') ?? {}).length > 0, true);
  assert.equal(store.readPerson('bob@example.com'), null, 'reading as ann creates nothing for bob');
  assert.equal(store.readPerson('_local'), null, 'a shared install never uses the local key');

  const bob = await m.service.getState(B);
  assert.deepEqual([bob.summary.from, bob.summary.to], [0, 2], 'bob\'s summary is not ann\'s');
  assert.equal((await m.service.getState(A)).summary, null);
});

test('service: noteLiveEvent records the patch and sends one poke', async () => {
  const { service, pokes } = makeService();
  await service.noteLiveEvent('_local', { addon: 'live-src', addonPeak: 2 });
  const r = store.readPerson('_local');
  assert.deepEqual([r.live.addons, r.live.addonPeak, pokes], [['live-src'], 2, [POKE]]);
});

test('service: the level service never writes uiLevel (I-4)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/worca-levels/service.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /setUiLevel|pinUiLevel|uiLevel/);
});

test('service: a held v1 level gets reachedAt from its latest action stamp; a later view keeps it', async () => {
  const D = (d) => `2026-0${d}-01T08:00:00.000Z`;
  await seed('_local', {
    level: 2, celebrated: 2, createdAt: D(1),
    doneAt: { setupFinished: D(2), providerSignedIn: D(3), runnerSteps: D(4), realRuns: D(5) },
  });
  const { service } = makeService({ fresh: false });   // no fact backs these items: the stamps alone decide
  const first = await service.getState(LOCAL);
  assert.deepEqual(store.readPerson('_local').reachedAt, { 1: D(3), 2: D(5) });
  assert.deepEqual(first.ladder.map((l) => l.reachedAt), [D(3), D(5), null, null, null]);

  const again = await service.getState(LOCAL);   // a later view changes nothing
  assert.deepEqual(store.readPerson('_local').reachedAt, { 1: D(3), 2: D(5) });
  assert.deepEqual(again.ladder.map((l) => l.reachedAt), [D(3), D(5), null, null, null]);
});

test('service: a level reached now is stamped with the time it was reached, once', async () => {
  const m = makeService({ onboarding: SETUP });
  await m.service.getState(LOCAL);
  assert.deepEqual(store.readPerson('_local').reachedAt, { 1: NOW });
  Object.assign(m.w, RUNNER);
  const v = await m.service.getState(LOCAL);
  assert.equal(v.level.index, 2);
  assert.deepEqual(store.readPerson('_local').reachedAt, { 1: NOW, 2: NOW });
});

test('service: ladder items carry done, doneAt and the item copy', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  const v = await m.service.getState(LOCAL);
  assert.deepEqual(v.ladder[0].items.map((i) => [i.id, i.done]), [['setupFinished', true], ['providerSignedIn', true]]);
  assert.deepEqual(v.ladder[1].items.map((i) => [i.id, i.done]), [['runnerSteps', true], ['realRuns', true]]);
  assert.ok([...v.ladder[0].items, ...v.ladder[1].items].every((i) => i.doneAt === NOW && i.label));
  assert.ok(v.ladder[2].items.every((i) => i.done === false && i.doneAt === null && i.label));
});

// ---------------------------------------------------------------------------------------------------------------------
// Record v2, migration and the backfill summary (plan step 3.4).

const { migrateRecord } = await import('../src/core/worca-levels/migrate.mjs');
const row = (i, over = {}) => ({
  id: `r${i}`, finishedAt: `2026-05-0${1 + (i % 4)}T12:00:00.000Z`, scheduleId: null, scheduledFor: null,
  target: 'project', projectKey: 'p1', projectKeys: [], prUrl: null, prState: null, ...over,
});
/** 19 real runs over 4 days, one with a pull request, one scheduled, one in a workspace. */
const HISTORY = Array.from({ length: 19 }, (_, i) => row(i, i === 0 ? { prUrl: 'https://x/pr/1' } : i === 1 ? { scheduleId: 's1' } : i === 2 ? { target: 'workspace' } : {}))
  .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
const GS6 = { setupFinished: true, providerSignedIn: true, runnerSteps: { done: 6, of: 6 } };

test('migrate: existing user — GS steps 1-6, 19 real runs over 4 days, 1 PR, 2 choices -> Hooked with one summary and no celebration (R-po-12)', async () => {
  const { service } = makeService({ fresh: false, onboarding: GS6, realRuns: 19, rows: HISTORY });
  const v = await service.getState(LOCAL);
  assert.equal(v.level.index, 3);
  assert.equal(v.celebration, null, 'no per-level celebration');
  assert.deepEqual([v.summary.from, v.summary.to], [0, 3]);
  assert.deepEqual(v.summary.levels.map((l) => [l.index, l.name]), [[1, 'Curious'], [2, 'Runner'], [3, 'Hooked']]);
  assert.ok(v.summary.levels.every((l) => l.avatar && l.reachedAt));
  assert.ok(v.summary.items.includes('Finish setup') && v.summary.items.includes('A scheduled run finished'));
  const rec = store.readPerson('_local');
  assert.deepEqual([rec.rules, rec.level, rec.celebrated, rec.summary.shownAt], [2, 3, 3, null]);
  assert.deepEqual(rec.modeSuggestion, { advanced: 'skipped', expert: null });
  assert.deepEqual(rec.nudged, {});
  assert.equal((await service.getState(LOCAL)).summary.to, 3, 'the summary stays until it is acknowledged');
});

test('migrate: several levels at once -> one summary, and the ack clears it for good', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  const v = await m.service.getState(LOCAL);
  assert.deepEqual([v.level.index, v.celebration, v.summary.from, v.summary.to, v.summary.levels.length], [2, null, 0, 2, 2]);
  const acked = await m.service.ack(LOCAL, { what: 'summary' });
  assert.equal(acked.summary, null);
  assert.ok(store.readPerson('_local').summary.shownAt);
  Object.assign(m.w, { addons: 1, spaces: 1, schedules: true });
  assert.equal((await m.service.getState(LOCAL)).summary, null, 'never shown again');
});

test('migrate: no summary on a fresh install, and none for a level reached later', async () => {
  const fresh = makeService({ fresh: true, onboarding: SETUP });
  assert.equal((await fresh.service.getState(LOCAL)).summary, null);
  unlinkSync(store.worcaLevelsFile());
  const m = makeService({ fresh: false, onboarding: SETUP });
  const first = await m.service.getState(LOCAL);
  assert.deepEqual([first.level.index, first.summary.to], [1, 1]);
  await m.service.ack(LOCAL, { what: 'summary' });
  Object.assign(m.w, RUNNER);
  const up = await m.service.getState(LOCAL);
  assert.deepEqual([up.level.index, up.summary, up.celebration.index], [2, null, 2]);
});

test('migrate: a v1 level-3 record keeps Hooked even if the new rules say Runner (R-po-11)', async () => {
  await seed('_local', { level: 3, celebrated: 3, doneAt: { parallelFeatures: NOW, runnerSteps: NOW } });
  const { service } = makeService({ fresh: false, ...RUNNER });
  const v = await service.getState(LOCAL);
  assert.deepEqual([v.level.index, v.celebration, v.summary], [3, null, null]);
  const rec = store.readPerson('_local');
  assert.deepEqual([rec.rules, rec.level, rec.celebrated], [2, 3, 3]);
  assert.equal(rec.doneAt.parallelFeatures, NOW, 'a kept stamp');
});

test('migrate: a v1 record of a fresh, unfinished install migrates to level 0 with Finish setup not done', async () => {
  await seed('_local', { level: 1, celebrated: 1, doneAt: { setupFinished: NOW } });
  const { service } = makeService({ fresh: true });
  const v = await service.getState(LOCAL);
  assert.deepEqual([v.level, v.summary, v.celebration, v.setup.missing.includes('setup')], [null, null, null, true]);
  assert.equal(v.ladder[0].items[0].done, false);
  const rec = store.readPerson('_local');
  assert.deepEqual([rec.rules, rec.level, rec.doneAt], [2, 0, {}]);
});

test('migrate: a corrupt file is rebuilt from history', async () => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(store.worcaLevelsFile(), '{ not json');
  const { service } = makeService({ fresh: false, ...RUNNER });
  const v = await service.getState(LOCAL);
  assert.deepEqual([v.level.index, v.summary.to, v.celebration], [2, 2, null]);
  assert.equal(store.readPerson('_local').rules, 2);
});

test('migrateRecord: v1 rules, pure and idempotent (I-14)', () => {
  const D = (d) => `2026-0${d}-01T08:00:00.000Z`;
  const v1 = Object.freeze({
    level: 3, celebrated: 3, welcome: { kind: 'new', seenAt: D(1) }, createdAt: D(1), updatedAt: D(2), tz: 'Asia/Tokyo',
    doneAt: Object.freeze({ setupFinished: D(2), providerSignedIn: D(2), runnerSteps: D(3), realRuns: D(3), parallelFeatures: D(4), addonInstalled: D(5), addonsAtOnce: D(5), teamMetrics: D(5) }),
    reachedAt: Object.freeze({ 1: D(2), 2: D(3), 3: D(5) }),
    live: { addons: ['a'], addonPeak: 1, spaces: true, statsViewedAt: null, teamMetricsOpenedAt: null },
  });
  const first = migrateRecord(v1, { now: NOW });
  assert.equal(first.from, 3);
  assert.deepEqual(Object.keys(first.record.doneAt).sort(), ['addonInstalled', 'addonsAtOnce', 'parallelFeatures']);
  assert.deepEqual(first.record.reachedAt, { 1: D(2), 2: D(3), 3: D(5) });
  assert.deepEqual([first.record.rules, first.record.level, first.record.tz, first.record.live.addons], [2, 3, 'Asia/Tokyo', ['a']]);
  assert.deepEqual([first.record.summary, first.record.nudged], [null, {}]);
  assert.deepEqual(first.record.modeSuggestion, { advanced: null, expert: null });
  const second = migrateRecord(first.record, { now: '2030-01-01T00:00:00.000Z' });
  assert.deepEqual(second.record, first.record);
  assert.equal(second.from, 3);
});

test('migrateRecord: a level-1 v1 record is no floor; nothing is stamped for Curious; a missing record is a blank v2', () => {
  const r = migrateRecord({ level: 1, celebrated: 1, doneAt: { setupFinished: NOW, providerSignedIn: NOW }, reachedAt: { 1: NOW } }, { now: NOW });
  assert.deepEqual([r.from, r.record.level, r.record.celebrated, r.record.doneAt, r.record.reachedAt], [1, 0, 0, {}, {}]);
  const blank = migrateRecord(null, { now: NOW });
  assert.deepEqual([blank.from, blank.record.rules, blank.record.level, blank.record.createdAt], [0, 2, 0, NOW]);
});

test('migrateRecord: a held level without a stamp takes the latest stamp of its items before they are dropped', () => {
  const D = (d) => `2026-0${d}-01T08:00:00.000Z`;
  const r = migrateRecord({ level: 2, doneAt: { setupFinished: D(2), providerSignedIn: D(3), runnerSteps: D(4), realRuns: D(5) } }, { now: NOW });
  assert.deepEqual(r.record.reachedAt, { 1: D(3), 2: D(5) });
});

test('migrateRecord: a rules 2 record is not changed, and a damaged v2 field is repaired', () => {
  const rec = { rules: 2, level: 2, celebrated: 2, doneAt: {}, reachedAt: { 1: NOW, 2: NOW }, summary: { from: 0, to: 2, shownAt: null },
    nudged: { a: NOW }, modeSuggestion: { advanced: 'dismissed', expert: null }, tz: null,
    live: { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null }, createdAt: NOW, updatedAt: NOW };
  const once = migrateRecord(rec, { now: NOW }).record;
  assert.deepEqual(migrateRecord(once, { now: NOW }).record, once);
  assert.deepEqual([once.summary, once.nudged, once.modeSuggestion, once.reachedAt], [rec.summary, rec.nudged, rec.modeSuggestion, rec.reachedAt]);
  const bad = migrateRecord({ ...rec, summary: 'x', nudged: [], modeSuggestion: { advanced: 'maybe' }, reachedAt: { 1: 'no', 9: NOW } }, { now: NOW }).record;
  assert.deepEqual([bad.summary, bad.nudged, bad.modeSuggestion, bad.reachedAt], [null, {}, { advanced: null, expert: null }, {}]);
});

test('service: pokeLevelFactsChanged emits one worca-level-changed and writes nothing (I-1)', async () => {
  const { service, pokes } = makeService();
  service.pokeLevelFactsChanged();
  assert.deepEqual(pokes, [POKE]);
  assert.equal(existsSync(store.worcaLevelsFile()), false);
});

test('service: after a fact flips, the next getState raises the level and sets the celebration', async () => {
  const { service, w } = makeService({ fresh: false, ...RUNNER });
  assert.equal((await service.getState(LOCAL)).level.index, 2);   // backfilled: not celebrated
  Object.assign(w, { onboarding: SETUP, realRuns: 19, rows: HISTORY, schedules: true });   // a fact changed outside the service
  service.pokeLevelFactsChanged();
  const up = await service.getState(LOCAL);
  assert.equal(up.level.index, 3);
  assert.equal(up.celebration?.index, 3);
});
