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
    onboarding: { done: 0, total: 9, steps: { teamPolicy: false } },
    requirements: 0, done: 0, addons: 0, spaces: 0, schedules: false, repeating: false,
    intervals: [], teamRuns: 0, finishes: [], ...over,
  };
  const calls = { teamMetricsRuns: 0, parallelIntervals: 0, councilFinishes: 0, tz: [] };
  const sources = {
    onboarding: () => w.onboarding,
    requirementsFlag: () => true,
    requirementCount: () => w.requirements,
    countStartedRuns: () => w.requirements,
    countDoneRuns: () => w.done,
    scheduleFacts: () => ({ schedules: w.schedules, repeatingSchedules: w.repeating }),
    addonFacts: () => ({ addonsInstalled: w.addons, addonsAtOnce: w.addons }),
    spaceCount: () => w.spaces,
    parallelIntervals: () => { calls.parallelIntervals++; return w.intervals; },
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
const RUNNER = { onboarding: { done: 9, total: 9, steps: { teamPolicy: false } }, requirements: 1, done: 1 };
const seed = (key, over) => store.updatePerson(key, () => ({
  level: 2, celebrated: 2, welcome: { kind: 'new', seenAt: NOW }, doneAt: {}, tz: null,
  live: { addons: [], addonPeak: 0, spaces: false, statsViewedAt: null, teamMetricsOpenedAt: null },
  createdAt: NOW, updatedAt: NOW, ...over,
}));
const rejects = (p) => assert.rejects(p, (e) => e instanceof WorcaLevelRequestError && e.code === 'WORCA_LEVEL_BAD_REQUEST');

test('service: stats-viewed records only statsViewedAt (R-po-34)', async () => {
  const { service, pokes } = makeService();
  await service.recordViewed(LOCAL, { type: 'stats-viewed' });
  const r = store.readPerson('_local');
  assert.deepEqual(r.live, { addons: [], addonPeak: 0, spaces: false, statsViewedAt: NOW, teamMetricsOpenedAt: null });
  assert.deepEqual([r.level, r.doneAt, r.tz], [0, {}, null]);
  assert.deepEqual(pokes, [POKE]);
});

test('service: team-metrics-viewed stamps only with a policy and 10 runs (R-po-33, R-po-38)', async () => {
  const policy = { done: 9, total: 9, steps: { teamPolicy: true } };
  const ten = makeService({ onboarding: policy, teamRuns: 10 });
  await ten.service.recordViewed(LOCAL, { type: 'team-metrics-viewed' });
  assert.equal(store.readPerson('_local').live.teamMetricsOpenedAt, NOW);
  assert.deepEqual(ten.pokes, [POKE]);

  unlinkSync(store.worcaLevelsFile());
  for (const over of [{ onboarding: policy, teamRuns: 9 }, { teamRuns: 10 }]) {
    const no = makeService(over);
    await no.service.recordViewed(LOCAL, { type: 'team-metrics-viewed' });
    assert.equal(store.readPerson('_local'), null, 'nothing recorded');
    assert.deepEqual(no.pokes, []);
  }
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

test('service: D-13 — the team-metrics count source is read only at level 3 with the item unlatched, and always on open', async () => {
  const get = async (level, doneAt = {}) => {
    rmSync(store.worcaLevelsFile(), { force: true });
    await seed('_local', { level, celebrated: level, doneAt });
    const m = makeService({ fresh: false });
    await m.service.getState(LOCAL);
    return m.calls.teamMetricsRuns;
  };
  assert.equal(await get(2), 0);
  assert.equal(await get(3), 1);
  assert.equal(await get(3, { teamMetrics: NOW }), 0);
  assert.equal(await get(4), 0);

  await seed('_local', { level: 2, celebrated: 2 });
  const m = makeService({ fresh: false });
  await m.service.recordViewed(LOCAL, { type: 'team-metrics-viewed' });
  assert.equal(m.calls.teamMetricsRuns, 1, 'the open reads the count at any level');
  assert.equal(m.calls.parallelIntervals + m.calls.councilFinishes, 0, 'parallel and council are never read for it');
});

test('service: D-13 — parallel and council are not read once their items are latched', async () => {
  await seed('_local', { level: 4, celebrated: 4, doneAt: { parallelFeatures: NOW, councilStreak: NOW } });
  const m = makeService({ fresh: false });
  await m.service.getState(LOCAL);
  assert.deepEqual([m.calls.parallelIntervals, m.calls.councilFinishes], [0, 0]);
  unlinkSync(store.worcaLevelsFile());
  await seed('_local', { level: 4, celebrated: 4 });
  await m.service.getState(LOCAL);
  assert.deepEqual([m.calls.parallelIntervals, m.calls.councilFinishes], [1, 1]);
});

test('service: welcome new shows once; after the ack it is null', async () => {
  const { service } = makeService();
  const first = await service.getState(LOCAL);
  assert.deepEqual([first.welcome, first.level.index, first.celebration], [{ kind: 'new' }, 1, null]);
  assert.deepEqual((await service.getState(LOCAL)).welcome, { kind: 'new' }, 'still there until acknowledged');
  assert.equal((await service.ack(LOCAL, { what: 'welcome' })).welcome, null);
  assert.equal((await service.getState(LOCAL)).welcome, null);
});

test('service: welcome existing needs past activity AND a backfilled level above Curious (D-11)', async () => {
  const runner = makeService({ fresh: false, ...RUNNER });
  const view = await runner.service.getState(LOCAL);
  assert.deepEqual([view.level.index, view.welcome], [2, { kind: 'existing' }]);

  unlinkSync(store.worcaLevelsFile());
  const curious = makeService({ fresh: false });
  const still = await curious.service.getState(LOCAL);
  assert.deepEqual([still.level.index, still.welcome], [1, { kind: 'new' }]);
});

test('service: celebration once per level; skipped levels are not celebrated; index 5 is accepted', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  await m.service.getState(LOCAL);                         // backfilled at Runner: celebrated = 2
  await m.service.ack(LOCAL, { what: 'welcome' });
  assert.equal((await m.service.getState(LOCAL)).celebration, null, 'the backfilled level is not celebrated');

  Object.assign(m.w, { addons: 1, spaces: 1, schedules: true });
  await m.service.recordViewed(LOCAL, { type: 'stats-viewed' });
  const up = await m.service.getState(LOCAL);
  assert.equal(up.level.index, 3);
  assert.deepEqual([up.celebration.index, up.celebration.key, up.celebration.nextName, up.celebration.nextUnit], [3, 'hooked', 'WorcaHolic', 'items']);
  assert.equal(up.celebration.nextTotal, 4);
  assert.ok(up.celebration.hat && up.celebration.phrase && up.celebration.recap && up.celebration.tint);

  assert.equal((await m.service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration, null);
  assert.equal((await m.service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration, null, 'idempotent');
  assert.equal(store.readPerson('_local').celebrated, 3);

  unlinkSync(store.worcaLevelsFile());
  await seed('_local', { level: 5, celebrated: 4 });
  const top = await m.service.getState(LOCAL);
  assert.deepEqual([top.top, top.next, top.nextLevel, top.celebration.nextName, top.celebration.nextTotal], [true, null, null, null, null]);
  const acked = await m.service.ack(LOCAL, { what: 'celebration', index: 5 });
  assert.deepEqual([acked.celebration, store.readPerson('_local').celebrated, WORCA_LEVEL_COUNT], [null, 5, 5]);
});

test('service: only the shown level is acknowledged — a level reached since stays to be celebrated', async () => {
  await seed('_local', { level: 4, celebrated: 2 });
  const { service } = makeService({ fresh: false });
  assert.equal((await service.getState(LOCAL)).celebration.index, 4, 'only the highest level is celebrated');
  assert.equal((await service.ack(LOCAL, { what: 'celebration', index: 3 })).celebration.index, 4);
  assert.equal((await service.ack(LOCAL, { what: 'celebration', index: 4 })).celebration, null);
});

test('service: the view lists the ladder with a state per level and the full level copy', async () => {
  await seed('_local', { level: 3, celebrated: 3 });
  const view = await makeService({ fresh: false }).service.getState(LOCAL);
  assert.equal(view.count, WORCA_LEVEL_COUNT);
  assert.deepEqual(view.ladder.map((l) => l.state), ['reached', 'reached', 'current', 'next', 'later']);
  assert.deepEqual(Object.keys(view.ladder[0]), ['index', 'key', 'name', 'tint', 'hue', 'description', 'avatar', 'state']);
  assert.deepEqual(Object.keys(view.level), ['index', 'key', 'name', 'tint', 'hue', 'tagline', 'description', 'hat', 'phrase', 'recap', 'avatar']);
  assert.equal(view.nextLevel.name, 'WorcaHolic');

  unlinkSync(store.worcaLevelsFile());
  await seed('_local', { level: 5, celebrated: 5 });
  const top = await makeService({ fresh: false }).service.getState(LOCAL);
  assert.deepEqual(top.ladder.map((l) => l.state), ['reached', 'reached', 'reached', 'reached', 'current']);
});

test('service: the team-metrics action points at Team policy until a policy is installed (D-8, R-po-35)', async () => {
  await seed('_local', { level: 3, celebrated: 3 });
  const teamMetrics = (view) => view.next.find((a) => a.id === 'teamMetrics');

  const before = teamMetrics(await makeService({ fresh: false }).service.getState(LOCAL));
  assert.deepEqual([before.href, before.openLabel], ['#team-policy', 'Open Team policy']);

  const policy = { done: 9, total: 9, steps: { teamPolicy: true } };
  const after = teamMetrics(await makeService({ fresh: false, onboarding: policy }).service.getState(LOCAL));
  assert.deepEqual([after.href, after.openLabel], ['#team-metrics', 'Open Team metrics']);
});

test('service: a teammate\'s policy counts for the caller (R-po-37)', async () => {
  // Bob installed nothing himself; the install-wide onboarding state reports a policy.
  const policy = { done: 9, total: 9, steps: { teamPolicy: true } };
  const m = makeService({ fresh: false, onboarding: policy, teamRuns: 10 });
  await m.service.recordViewed(B, { type: 'team-metrics-viewed' });
  assert.equal(store.readPerson('bob@example.com').live.teamMetricsOpenedAt, NOW);
});

test('service: ann and bob each see only their own (R-po-24)', async () => {
  const m = makeService({ fresh: false, ...RUNNER });
  await m.service.getState(A);
  await m.service.ack(A, { what: 'welcome' });
  assert.deepEqual(Object.keys(store.readPerson('ann@example.com') ?? {}).length > 0, true);
  assert.equal(store.readPerson('bob@example.com'), null, 'reading as ann creates nothing for bob');
  assert.equal(store.readPerson('_local'), null, 'a shared install never uses the local key');

  const bob = await m.service.getState(B);
  assert.deepEqual(bob.welcome, { kind: 'existing' }, 'bob\'s welcome is not ann\'s');
  assert.equal((await m.service.getState(A)).welcome, null);

  await m.service.recordViewed(A, { type: 'stats-viewed' });
  assert.equal(store.readPerson('ann@example.com').live.statsViewedAt, NOW);
  assert.equal(store.readPerson('bob@example.com').live.statsViewedAt, null);
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
