// test/api-worca-level.test.mjs
// GET /api/worca-level, POST /api/worca-level/ack, POST /api/worca-level/events (ui/routes/worca-levels/worca-level.mjs).
// Server-test shape (api-onboarding.test.mjs): useTempHome at module top level, the app imported INSIDE
// before(), an ephemeral http server and real fetch. Rules that need host state a test cannot build (a
// policy, ten ledgers, a level-up) are driven through createWorcaLevelService with injected facts.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
const REAL_HEADER = process.env.WORCA_IDENTITY_HEADER;
const REAL_PROXIES = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
process.env.HOME = home;                     // settings.json and worca-levels.json live under HOME

const JSONH = { 'Content-Type': 'application/json' };
const VIEW_KEYS = ['celebration', 'count', 'ladder', 'level', 'modeSuggestion', 'next', 'nextLevel', 'nudge', 'onTeam', 'progress', 'runner', 'setup', 'summary', 'top'];
const NOW = '2026-11-05T10:00:00.000Z';
const TM_TYPE_ERROR = 'type must be "stats-viewed" or "team-metrics-viewed"';

let srv, base, app, getDb, store, createWorcaLevelService, svcAckTargets;
const get = (path = '/api/worca-level', headers = {}) => fetch(`${base}${path}`, { headers });
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...JSONH, ...headers }, body: JSON.stringify(body) });
const ack = (what, headers) => post('/api/worca-level/ack', { what }, headers);
const view = async (r) => { assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
const storeBytes = () => (existsSync(store.worcaLevelsFile()) ? readFileSync(store.worcaLevelsFile(), 'utf8') : null);
const dropStore = () => rmSync(store.worcaLevelsFile(), { recursive: true, force: true });

before(async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // the in-process server's callers are loopback
  ({ app } = await import('../ui/server.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  store = await import('../src/core/worca-levels/store.mjs');
  ({ createWorcaLevelService, ACK_TARGETS: svcAckTargets } = await import('../src/core/worca-levels/service.mjs'));
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  process.env.HOME = REAL_HOME;
  if (REAL_HEADER === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = REAL_HEADER;
  if (REAL_PROXIES === undefined) delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; else process.env.WORCA_IDENTITY_TRUSTED_PROXIES = REAL_PROXIES;
});

beforeEach(() => {
  delete process.env.WORCA_IDENTITY_HEADER;
  dropStore();
  const db = getDb();
  for (const t of ['pipelines', 'schedules', 'req_features']) db.exec(`DELETE FROM ${t}`);
});

const NEUTRAL = {
  gettingStartedDone: false, gettingStarted: { done: 0, total: 9 }, policyInstalled: false,
  requirements: 0, requirementsFlag: true, startedRuns: 0, doneRuns: 0, addonsInstalled: 0, addonsAtOnce: 0,
  spaces: 0, schedules: false, repeatingSchedules: false, statsViewedAt: null, parallelDoneAt: null,
  teamMetricsRuns: 0, teamMetricsOpenedAt: null, council: { current: 0, metAt: null },
};
const SETUP = { ...NEUTRAL, setupFinished: true, providerSignedIn: true };
const RUNNER = { ...SETUP, runnerSteps: { done: 6, of: 9 }, realRuns: 3 };
const HOOKED = { ...RUNNER, addonsInstalled: 1, spaces: 1, schedules: true, statsViewedAt: NOW };
const local = { headers: {} };

/** A service over a mutable `facts.current`; the stored live stamps are fed back in, as gatherFacts does. */
function serviceWith(facts, extra = {}) {
  const pokes = [];
  const svc = createWorcaLevelService({
    isFreshInstall: () => true,
    emitChanged: (...a) => pokes.push(a),
    gatherFacts: async ({ live }) => ({
      ...facts.current,
      statsViewedAt: live?.statsViewedAt ?? facts.current.statsViewedAt,
      teamMetricsOpenedAt: live?.teamMetricsOpenedAt ?? facts.current.teamMetricsOpenedAt,
    }),
    now: () => NOW,
    ...extra,
  });
  return { svc, pokes };
}

test('fresh install: Simple, no level yet, and no welcome in the view (R-po-8)', async () => {
  await checkRows([
    { name: 'view shape: level 0 names what setup is missing', run: async () => {
      const v = await view(await get());
      assert.deepEqual(Object.keys(v).sort(), VIEW_KEYS);
      assert.equal(v.level, null);
      assert.ok(v.setup.missing.includes('setup'), 'setup is not finished');
      assert.equal('welcome' in v, false);
      assert.equal(v.celebration, null);
      assert.equal(v.top, false);
      assert.equal(v.ladder.length, v.count);
    } },
    { name: 'setup and provider done: level 1, Curious', run: async () => {
      const { svc } = serviceWith({ current: SETUP });
      const v = await svc.getState(local);
      assert.equal(v.level.index, 1);
      assert.equal(v.level.key, 'curious');
    } },
    { name: 'the interface mode is Simple', run: async () => {
      const s = await (await get('/api/settings')).json();
      assert.equal(s.uiLevel, 'simple');
    } },
    { name: 'no person name or other-person data in the view', run: async () => {
      process.env.WORCA_IDENTITY_HEADER = 'X-User';
      const text = await (await get('/api/worca-level', { 'X-User': 'ada@example.com' })).text();
      assert.ok(!/ada/i.test(text), text);
    } },
  ]);
});

test('ack welcome answers the view and records nothing (D-19)', async () => {
  await get();
  const bytes = storeBytes();
  const r = await ack('welcome');
  assert.equal(r.status, 200, await r.clone().text());
  const v = await r.json();
  assert.equal(v.ladder.length, v.count, 'it answers the view');
  assert.equal(storeBytes(), bytes, 'and writes nothing');
  assert.equal(storeBytes(), bytes, 'again');
  for (const what of ['celebration', 'summary', 'nudge', 'mode-suggestion']) {
    assert.ok(svcAckTargets.includes(what), what);
  }
});

test('existing user backfilled to their level, with no celebration for the levels skipped (R-po-20)', async () => {
  const facts = { current: RUNNER };
  const { svc } = serviceWith(facts, { isFreshInstall: () => false });
  const v = await svc.getState(local);
  assert.equal(v.level.index, 2);
  assert.equal('welcome' in v, false);
  assert.equal(v.celebration, null, 'level 1 was backfilled, not celebrated');
  assert.equal(store.readPerson('_local').celebrated, 2);
});

test('celebration once per level; an ack of index 5 is accepted (R-po-21)', async () => {
  await checkRows([
    { name: 'a level-up celebrates, and only once', run: async () => {
      dropStore();
      const facts = { current: SETUP };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      facts.current = RUNNER;
      let v = await svc.getState(local);
      assert.equal(v.level.index, 2);
      assert.equal(v.celebration.index, 2);
      v = await svc.ack(local, { what: 'celebration', index: 2 });
      assert.equal(v.celebration, null);
      assert.equal((await svc.ack(local, { what: 'celebration', index: 2 })).celebration, null, 'idempotent');
      assert.equal((await svc.getState(local)).celebration, null);
    } },
    { name: 'a level reached after the ack is celebrated again', run: async () => {
      dropStore();
      const facts = { current: RUNNER };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      await svc.ack(local, { what: 'celebration', index: 2 });
      facts.current = { ...RUNNER, runsOnDays: { runs: 10, days: 3, metAt: NOW }, prsOpened: 1, addonsInstalled: 1, projects: 2 };
      const v = await svc.getState(local);
      assert.ok(v.level.index >= 2);
      assert.equal(v.celebration === null || v.celebration.index === v.level.index, true);
    } },
    { name: 'over HTTP the ack accepts index 5 and answers a view', run: async () => {
      await get();
      const r = await post('/api/worca-level/ack', { what: 'celebration', index: 5 });
      assert.equal(r.status, 200, await r.clone().text());
      assert.deepEqual(Object.keys(await r.json()).sort(), VIEW_KEYS);
    } },
  ]);
});

test('mode change keeps the level; a level-up keeps the interface mode (R-po-2)', async () => {
  await checkRows([
    { name: 'POST /api/settings { uiLevel } leaves the level unchanged', run: async () => {
      const before1 = await view(await get());
      for (const uiLevel of ['expert', 'advanced', 'simple']) {
        const r = await post('/api/settings', { uiLevel });
        assert.equal(r.status, 200, await r.clone().text());
        assert.deepEqual((await view(await get())).level, before1.level, uiLevel);
      }
    } },
    { name: 'a level-up leaves uiLevel alone', run: async () => {
      dropStore();
      const modeBefore = (await (await get('/api/settings')).json()).uiLevel;
      const facts = { current: SETUP };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      facts.current = RUNNER;
      assert.equal((await svc.getState(local)).level.index, 2);
      assert.equal((await (await get('/api/settings')).json()).uiLevel, modeBefore);
    } },
  ]);
});

test('no route sets an item, a level or doneAt (I-2); /events takes exactly two types', async () => {
  const routerSrc = readFileSync(new URL('../ui/routes/worca-levels/worca-level.mjs', import.meta.url), 'utf8');
  const registered = [...routerSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(registered.sort(), ['get /api/worca-level', 'post /api/worca-level/ack', 'post /api/worca-level/events']);
  await checkRows([
    { name: 'events with any other type is 400', run: async () => {
      for (const type of ['addon-installed', 'level-up', 'item', 'gettingStarted', 5, undefined]) {
        const r = await post('/api/worca-level/events', { type });
        assert.equal(r.status, 400, String(type));
        assert.deepEqual(await r.json(), { error: TM_TYPE_ERROR, code: 'WORCA_LEVEL_BAD_REQUEST' });
      }
    } },
    { name: 'ack of an item or a level is 400', run: async () => {
      for (const body of [{ what: 'level', level: 5 }, { what: 'item', id: 'gettingStarted' }, { id: 'councilStreak' }, { level: 5 }]) {
        assert.equal((await post('/api/worca-level/ack', body)).status, 400, JSON.stringify(body));
      }
    } },
    { name: 'no other write path answers', run: async () => {
      for (const p of ['/api/worca-level', '/api/worca-level/level', '/api/worca-level/item', '/api/worca-level/done']) {
        assert.ok([404, 405].includes((await post(p, { level: 5, id: 'gettingStarted' })).status), p);
      }
      assert.equal(storeBytes(), null, 'nothing was written');
    } },
  ]);
});

test('a bad ack or events body leaves the store byte-identical (I-3)', async () => {
  const bad = [
    ['/api/worca-level/ack', {}], ['/api/worca-level/ack', { what: 'level' }], ['/api/worca-level/ack', { what: 3 }],
    ['/api/worca-level/ack', { what: '__proto__' }], ['/api/worca-level/ack', { what: 'celebration' }],
    ['/api/worca-level/ack', { what: 'celebration', index: 0 }], ['/api/worca-level/ack', { what: 'celebration', index: 6 }],
    ['/api/worca-level/ack', { what: 'celebration', index: '2' }], ['/api/worca-level/ack', { what: 'celebration', index: 1.5 }],
    ['/api/worca-level/events', {}], ['/api/worca-level/events', { type: 'nope' }], ['/api/worca-level/events', { type: 7 }],
  ];
  await checkRows([
    { name: 'no file on a fresh home', run: async () => {
      for (const [p, body] of bad) {
        const r = await post(p, body);
        assert.equal(r.status, 400, `${p} ${JSON.stringify(body)}`);
        const j = await r.json();
        assert.equal(typeof j.error, 'string');
        assert.equal(j.code, 'WORCA_LEVEL_BAD_REQUEST');
      }
      assert.equal(storeBytes(), null);
    } },
    { name: 'the same bytes when a record exists', run: async () => {
      await get();
      const bytes = storeBytes();
      assert.ok(bytes);
      for (const [p, body] of bad) await post(p, body);
      assert.equal(storeBytes(), bytes);
    } },
  ]);
});

test('A and B see only their own (R-po-24, I-5): ?person= and body person are ignored', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-User';
  const A = { 'X-User': 'alice@x.com' };
  const B = { 'X-User': 'bob@x.com' };
  await checkRows([
    { name: 'A and B each get their own record', run: async () => {
      await get('/api/worca-level', A);
      await get('/api/worca-level', B);
      assert.ok(store.readPerson('alice@x.com'));
      assert.ok(store.readPerson('bob@x.com'));
    } },
    { name: 'records are keyed by the lowercased name', run: async () => {
      assert.equal(store.readPerson('_local'), null);
      await get('/api/worca-level', { 'X-User': 'ALICE@x.com' });
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(store.worcaLevelsFile(), 'utf8')).people).sort(), ['alice@x.com', 'bob@x.com']);
    } },
    { name: '?person= is ignored on GET and ack', run: async () => {
      await get('/api/worca-level?person=carol@x.com', B);
      await post('/api/worca-level/ack?person=carol@x.com', { what: 'summary', person: 'carol@x.com' }, B);
      assert.equal(store.readPerson('carol@x.com'), null);
    } },
    { name: 'a stale stats-viewed answers 204 and writes nothing', run: async () => {
      const bytes = storeBytes();
      assert.equal((await post('/api/worca-level/events', { type: 'stats-viewed' }, A)).status, 204);
      assert.equal(storeBytes(), bytes);
    } },
    { name: '/api/stats and /api/team-metrics/scopes carry no worca data', run: async () => {
      for (const path of ['/api/stats', '/api/team-metrics/scopes']) {
        const text = await (await get(path, A)).text();
        assert.ok(!/worca-?level/i.test(text), `${path}: ${text.slice(0, 200)}`);
      }
    } },
  ]);
});

test('POST events stats-viewed answers 204 and records nothing (D-19)', async () => {
  await get();
  const bytes = storeBytes();
  for (const type of ['stats-viewed', 'team-metrics-viewed']) {
    const r = await post('/api/worca-level/events', { type });
    assert.equal(r.status, 204, type);
    assert.equal(await r.text(), '', type);
    assert.equal(storeBytes(), bytes, `${type} writes nothing`);
  }
});

test('tz: a valid zone is stored; an invalid one on GET is ignored and does not fail', async () => {
  await checkRows([
    { name: 'invalid tz is a normal 200', run: async () => {
      for (const tz of ['Not/AZone', '', '../../etc', 'x'.repeat(300)]) {
        const r = await get(`/api/worca-level?tz=${encodeURIComponent(tz)}`);
        assert.equal(r.status, 200, tz);
      }
      assert.equal(store.readPerson('_local').tz, null);
    } },
    { name: 'a valid zone is stored', run: async () => {
      assert.equal((await get('/api/worca-level?tz=Europe%2FParis')).status, 200);
      assert.equal(store.readPerson('_local').tz, 'Europe/Paris');
      assert.equal((await get('/api/worca-level?tz=Not%2FAZone')).status, 200);
      assert.equal(store.readPerson('_local').tz, 'Europe/Paris', 'the invalid one did not replace it');
    } },
    { name: 'ack and events take tz from the body', run: async () => {
      assert.equal((await post('/api/worca-level/ack', { what: 'welcome', tz: 'Asia/Tokyo' })).status, 200);
      assert.equal(store.readPerson('_local').tz, 'Asia/Tokyo');
      assert.equal((await post('/api/worca-level/events', { type: 'stats-viewed', tz: 'Not/AZone' })).status, 204);
    } },
  ]);
});

test('a store that cannot be read is a 500 with a friendly message and no internals', async () => {
  mkdirSync(store.worcaLevelsFile(), { recursive: true });      // a directory where the file should be
  try {
    const r = await get();
    assert.equal(r.status, 500);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { error: 'Could not read your level.', code: 'WORCA_LEVEL_UNAVAILABLE' });
    assert.ok(!text.includes(home), 'no path in the response');
  } finally {
    dropStore();
  }
});

test('a person key the store refuses is the same friendly 500', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-User';
  const r = await get('/api/worca-level', { 'X-User': 'constructor' });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Could not read your level.', code: 'WORCA_LEVEL_UNAVAILABLE' });
});

test('I-4: nothing in src/core/worca-levels imports setUiLevel or pinUiLevel', () => {
  const dir = new URL('../src/core/worca-levels/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(join(dir.pathname, f), 'utf8');
    assert.doesNotMatch(src, /setUiLevel|pinUiLevel/, f);
  }
});

test('two parallel first GETs create one record', async () => {
  const views = await Promise.all(Array.from({ length: 5 }, () => get().then(view)));
  assert.equal(new Set(views.map((v) => JSON.stringify(v))).size, 1);
  const file = JSON.parse(readFileSync(store.worcaLevelsFile(), 'utf8'));
  assert.deepEqual(Object.keys(file.people), ['_local']);
});

test('ack summary 200 then summary null', async () => {
  const { svc } = serviceWith({ current: RUNNER }, { isFreshInstall: () => false });
  const first = await svc.getState(local);
  assert.deepEqual([first.summary.from, first.summary.to, first.celebration], [0, 2, null]);
  const acked = await svc.ack(local, { what: 'summary' });
  assert.equal(acked.summary, null);
  assert.equal((await svc.getState(local)).summary, null);
  const r = await ack('summary');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).summary, null);
});

const writeStore = (people) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(store.worcaLevelsFile(), JSON.stringify({ version: 1, people }));
};

test('a damaged stored record answers a view, not a 500', async () => {
  const facts = { current: { ...HOOKED, setupFinished: true, providerSignedIn: true } };
  const { svc } = serviceWith(facts);
  const stored = () => JSON.parse(readFileSync(store.worcaLevelsFile(), 'utf8')).people._local;
  await checkRows([
    { name: 'no welcome', run: async () => {
      writeStore({ _local: { level: 2, celebrated: 2, doneAt: {} } });
      const v = await view(await get());
      assert.ok(v.level === null || v.level.index <= 5);
      assert.equal(v.count, 5);
    } },
    { name: 'level 9 is clamped', run: async () => {
      writeStore({ _local: { level: 9, celebrated: 9, welcome: { kind: 'new', seenAt: NOW }, doneAt: {} } });
      const v = await svc.getState(local);
      assert.ok(v.level.index <= 5, 'the stored 9 never reaches the view');
      assert.equal((await view(await get())).count, 5);
    } },
    { name: 'a non-object record is rebuilt from history', run: async () => {
      writeStore({ _local: 'garbage' });
      const v = await svc.getState(local);
      assert.ok(v.level.index >= 1, 'rebuilt from the facts, not the garbage');
      assert.equal(typeof stored(), 'object');
      assert.equal(stored().level, v.level.index);
    } },
    { name: 'an ack on a damaged record still works', run: async () => {
      writeStore({ _local: { level: 2, celebrated: 'x', welcome: 7, doneAt: [] } });
      const v = await view(await ack('summary'));
      assert.equal(v.count, 5);
    } },
  ]);
});

test('ladder carries reachedAt for each reached level', async () => {
  dropStore();
  const SETUP = { ...NEUTRAL, setupFinished: true, providerSignedIn: true };
  const facts = { current: NEUTRAL };
  const { svc } = serviceWith(facts);
  let v = await svc.getState(local);
  assert.deepEqual(v.ladder.map((l) => l.reachedAt), [null, null, null, null, null], 'no level yet, nothing reached');
  assert.ok(v.ladder.every((l) => Array.isArray(l.items)));
  facts.current = SETUP;
  v = await svc.getState(local);
  assert.deepEqual(v.ladder.map((l) => l.reachedAt), [NOW, null, null, null, null]);
  facts.current = { ...SETUP, runnerSteps: { done: 6, total: 9 }, realRuns: 3 };
  v = await svc.getState(local);
  assert.deepEqual(v.ladder.map((l) => l.reachedAt), [NOW, NOW, null, null, null]);
  const over = await view(await get());
  assert.ok(over.ladder.every((l) => 'reachedAt' in l && Array.isArray(l.items)), 'over HTTP too');
});

test('the broadcast done frame carries real: a costed run is real, a demo run is not (R-po-6)', async () => {
  const { EventEmitter } = await import('node:events');
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const mod = await import('../ui/server.mjs');
  const real = await seedPipeline('/tmp/wl-real', { status: 'done', totalCostUsd: 1.5 });
  const demo = await seedPipeline('/tmp/wl-real', { status: 'done', totalCostUsd: 1.5 });
  getDb().prepare('UPDATE pipelines SET run_setup = ? WHERE id = ?').run(JSON.stringify({ mock: true }), demo.id);
  const doneFrame = (pipelineId, payload = { status: 'done' }) => {
    const entry = { id: `uuid-${pipelineId}`, orch: new EventEmitter(), projectDir: '/tmp/wl-real', title: 't', status: 'running', events: [], pendingQuestion: null, pipelineId };
    mod.runs.set(entry.id, entry);
    mod._testing.wireRun(entry);
    try {
      entry.orch.emit('done', payload);
      return entry.events.find((e) => e.type === 'done');
    } finally { mod.runs.delete(entry.id); }
  };
  assert.equal(doneFrame(real.id).real, true);
  assert.equal(doneFrame(demo.id).real, false);
  assert.equal(doneFrame(real.id, { status: 'error' }).real, false, 'an error finish is never real');
});

const NUDGE_FACTS = {
  ...ZERO_V2_FACTS(),
  setupFinished: true, providerSignedIn: true, runnerSteps: { done: 6, of: 6 }, realRuns: 3,
  runsOnDays: { metAt: NOW, runs: 10, days: 3 }, prsOpened: 1, addonsInstalled: 1, scheduledRunDone: true, prsMerged: 4,
};

function ZERO_V2_FACTS() {
  return {
    runnerSteps: { done: 0, of: 6 }, teamMetricsOn: false, teamPolicyOn: false, runsOnDays: { metAt: null, runs: 0, days: 0 },
    activeDays: { inWindow: 0, metAt: null }, prMergedUnknown: false, daysUnknown: false, workspaceRunDone: false, projects: 0,
    repeatingScheduleRunsMax: 0, addonsAtOnce: 0, parallelDoneAt: null,
  };
}

test('ack nudge latches the id: the same nudge never returns (I-11)', async () => {
  const { svc } = serviceWith({ current: NUDGE_FACTS });
  const first = await svc.getState(local);
  assert.deepEqual(first.nudge, { id: 'prsMerged', text: '1 more merged PR to WorcaHolic' });
  assert.deepEqual((await svc.getState(local)).nudge, first.nudge, 'it is offered until it is acknowledged');
  const acked = await svc.ack(local, { what: 'nudge', id: 'prsMerged' });
  assert.equal(acked.nudge, null);
  assert.equal((await svc.getState(local)).nudge, null);
  const again = await svc.ack(local, { what: 'nudge', id: 'prsMerged' });
  assert.equal(again.nudge, null, 'a second ack changes nothing');
  assert.ok(JSON.parse(storeBytes()).people._local.nudged.prsMerged, 'the latch is stored');
});

test('ack nudge without a usable id is 400 WORCA_LEVEL_BAD_REQUEST and writes nothing (I-4)', async () => {
  await checkRows([
    { name: 'no id, over HTTP, on a fresh home', run: async () => {
      const r = await post('/api/worca-level/ack', { what: 'nudge' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'WORCA_LEVEL_BAD_REQUEST');
      assert.equal(storeBytes(), null);
    } },
    { name: 'an empty, non-string or unknown id leaves a stored record byte-identical', run: async () => {
      await get();
      const bytes = storeBytes();
      for (const id of ['', 7, null, ['prsMerged'], '__proto__', 'constructor', 'notAnItem']) {
        const r = await post('/api/worca-level/ack', { what: 'nudge', id });
        assert.equal(r.status, 400, JSON.stringify(id));
        assert.equal((await r.json()).code, 'WORCA_LEVEL_BAD_REQUEST');
      }
      assert.equal(storeBytes(), bytes);
    } },
    { name: 'a real id over HTTP answers a view', run: async () => {
      const r = await post('/api/worca-level/ack', { what: 'nudge', id: 'prsMerged' });
      assert.equal(r.status, 200, await r.clone().text());
    } },
  ]);
});

// ── the interface-mode suggestion (R-po-15) ──
const LOW_FACTS = { ...ZERO_V2_FACTS(), setupFinished: true, providerSignedIn: true };

test('suggestion ack persists; never re-offered', async () => {
  const facts = { current: LOW_FACTS };
  const { svc } = serviceWith(facts);
  const first = await svc.getState(local);
  assert.equal(first.modeSuggestion, null, 'a person created below Hooked is offered nothing');
  facts.current = NUDGE_FACTS;
  const reached = await svc.getState(local);
  assert.equal(reached.level.index, 3);
  assert.equal(reached.modeSuggestion, 'advanced');
  assert.equal((await svc.getState(local)).modeSuggestion, 'advanced', 'offered until it is answered');
  const acked = await svc.ack(local, { what: 'mode-suggestion', mode: 'advanced', answer: 'dismissed' });
  assert.equal(acked.modeSuggestion, null);
  assert.equal((await svc.getState(local)).modeSuggestion, null, 'never re-offered');
  assert.equal(store.readPerson('_local').modeSuggestion.advanced, 'dismissed');
  const again = await svc.ack(local, { what: 'mode-suggestion', mode: 'advanced', answer: 'accepted' });
  assert.equal(again.modeSuggestion, null);
  assert.equal(store.readPerson('_local').modeSuggestion.advanced, 'dismissed', 'the first answer stands');
});

test('a GET that overlaps an ack answers with the acknowledged record, not the one read before the facts (m7)', async () => {
  const facts = { current: LOW_FACTS };
  let gate = null;
  const { svc } = serviceWith(facts, {
    gatherFacts: async () => { const held = gate; gate = null; if (held) await held; return facts.current; },   // only the first caller waits
  });
  await svc.getState(local);
  facts.current = NUDGE_FACTS;
  assert.equal((await svc.getState(local)).modeSuggestion, 'advanced');
  let release;
  gate = new Promise((r) => { release = r; });
  const pending = svc.getState(local);                 // reads the record, then waits for its facts
  const acked = svc.ack(local, { what: 'mode-suggestion', mode: 'advanced', answer: 'dismissed' });
  await new Promise((r) => setTimeout(r, 20));
  release();
  assert.equal((await pending).modeSuggestion, null, 'the overlapping GET shows the answer');
  await acked;
});

test('a past-activity read that throws counts as no history and never fails the first GET (m8)', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { svc } = serviceWith({ current: RUNNER }, { isFreshInstall: () => { throw new Error('db locked'); } });
    const v = await svc.getState(local);
    assert.equal(v.level.index, 2);
    assert.equal(v.summary, null);
  } finally { console.warn = warn; }
});

test('Expert is suggested first at level 4 and Advanced stays answerable', async () => {
  const facts = { current: LOW_FACTS };
  const { svc } = serviceWith(facts);
  await svc.getState(local);
  facts.current = { ...NUDGE_FACTS, prsMerged: 5, parallelDoneAt: NOW, addonsAtOnce: 2, projects: 3 };
  const v = await svc.getState(local);
  assert.equal(v.level.index, 4);
  assert.equal(v.modeSuggestion, 'expert');
  const acked = await svc.ack(local, { what: 'mode-suggestion', mode: 'expert', answer: 'accepted' });
  assert.equal(acked.modeSuggestion, 'advanced', 'the unanswered lower mode is next');
});

test('a bad mode-suggestion ack writes nothing', async () => {
  await checkRows([
    { name: 'a missing mode over HTTP, on a fresh home', run: async () => {
      const r = await post('/api/worca-level/ack', { what: 'mode-suggestion', answer: 'dismissed' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'WORCA_LEVEL_BAD_REQUEST');
      assert.equal(storeBytes(), null);
    } },
    { name: 'a bad mode or answer leaves a stored record byte-identical', run: async () => {
      await get();
      const bytes = storeBytes();
      const bad = [
        { mode: 'simple', answer: 'dismissed' }, { mode: 'council', answer: 'accepted' }, { mode: '__proto__', answer: 'accepted' },
        { mode: 7, answer: 'accepted' }, { mode: 'advanced', answer: 'skipped' }, { mode: 'advanced', answer: 'maybe' },
        { mode: 'advanced' }, { mode: ['advanced'], answer: ['accepted'] }, { answer: 'accepted' },
      ];
      for (const body of bad) {
        const r = await post('/api/worca-level/ack', { what: 'mode-suggestion', ...body });
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal((await r.json()).code, 'WORCA_LEVEL_BAD_REQUEST');
      }
      assert.equal(storeBytes(), bytes);
    } },
    { name: 'a good ack over HTTP answers a view', run: async () => {
      const r = await post('/api/worca-level/ack', { what: 'mode-suggestion', mode: 'advanced', answer: 'dismissed' });
      assert.equal(r.status, 200, await r.clone().text());
    } },
  ]);
});
