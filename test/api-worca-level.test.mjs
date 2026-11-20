// test/api-worca-level.test.mjs
// GET /api/worca-level, POST /api/worca-level/ack, POST /api/worca-level/events (ui/routes/worca-levels/worca-level.mjs).
// Server-test shape (api-onboarding.test.mjs): useTempHome at module top level, the app imported INSIDE
// before(), an ephemeral http server and real fetch. Rules that need host state a test cannot build (a
// policy, ten ledgers, a level-up) are driven through createWorcaLevelService with injected facts.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
const REAL_HEADER = process.env.WORCA_IDENTITY_HEADER;
const REAL_PROXIES = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
process.env.HOME = home;                     // settings.json and worca-levels.json live under HOME

const JSONH = { 'Content-Type': 'application/json' };
const VIEW_KEYS = ['celebration', 'count', 'ladder', 'level', 'next', 'nextLevel', 'progress', 'top', 'welcome'];
const NOW = '2026-11-05T10:00:00.000Z';
const TM_TYPE_ERROR = 'type must be "stats-viewed" or "team-metrics-viewed"';

let srv, base, app, getDb, store, createWorcaLevelService;
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
  ({ createWorcaLevelService } = await import('../src/core/worca-levels/service.mjs'));
  srv = http.createServer(app);
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
const RUNNER = { ...NEUTRAL, gettingStartedDone: true, gettingStarted: { done: 9, total: 9 }, requirements: 1, startedRuns: 1, doneRuns: 1 };
const HOOKED = { ...RUNNER, addonsInstalled: 1, spaces: 1, schedules: true, statsViewedAt: NOW };
// Everything for WorcaHolic except opening Team metrics, which only a view can do.
const BEFORE_TEAM_METRICS = { ...HOOKED, addonsInstalled: 2, addonsAtOnce: 2, repeatingSchedules: true, parallelDoneAt: NOW };
const COUNCIL = { ...BEFORE_TEAM_METRICS, teamMetricsOpenedAt: NOW, council: { current: 30, metAt: NOW } };
const local = { headers: {} };
const person = (email) => ({ worcaUser: { email }, headers: {} });

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

test('fresh install: Simple and Curious, with a welcome that is new (R-po-8)', async () => {
  await checkRows([
    { name: 'view shape and level 1', run: async () => {
      const v = await view(await get());
      assert.deepEqual(Object.keys(v).sort(), VIEW_KEYS);
      assert.equal(v.level.index, 1);
      assert.equal(v.level.key, 'curious');
      assert.deepEqual(v.welcome, { kind: 'new' });
      assert.equal(v.celebration, null);
      assert.equal(v.top, false);
      assert.equal(v.ladder.length, v.count);
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

test('welcome once: a new person sees "new" until the ack, then null (R-po-19)', async () => {
  assert.deepEqual((await view(await get())).welcome, { kind: 'new' });
  assert.deepEqual((await view(await get())).welcome, { kind: 'new' }, 'a GET does not clear it');
  assert.equal((await view(await ack('welcome'))).welcome, null);
  assert.equal((await view(await ack('welcome'))).welcome, null, 'idempotent');
  assert.equal((await view(await get())).welcome, null, 'persisted');
});

test('existing user backfilled to their level, with no celebration for the levels skipped (R-po-20)', async () => {
  const facts = { current: HOOKED };
  const { svc } = serviceWith(facts, { isFreshInstall: () => false });
  let v = await svc.getState(local);
  assert.equal(v.level.index, 3);
  assert.deepEqual(v.welcome, { kind: 'existing' });
  assert.equal(v.celebration, null);
  await svc.ack(local, { what: 'welcome' });
  v = await svc.getState(local);
  assert.equal(v.celebration, null, 'levels 2 and 3 were backfilled, not celebrated');
  assert.equal(store.readPerson('_local').celebrated, 3);
});

test('celebration once per level; an ack of index 5 is accepted (R-po-21)', async () => {
  await checkRows([
    { name: 'a level-up celebrates once the welcome is acked, and only once', run: async () => {
      dropStore();
      const facts = { current: NEUTRAL };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      await svc.ack(local, { what: 'welcome' });
      facts.current = RUNNER;
      let v = await svc.getState(local);
      assert.equal(v.level.index, 2);
      assert.equal(v.celebration.index, 2);
      v = await svc.ack(local, { what: 'celebration', index: 2 });
      assert.equal(v.celebration, null);
      assert.equal((await svc.ack(local, { what: 'celebration', index: 2 })).celebration, null, 'idempotent');
      assert.equal((await svc.getState(local)).celebration, null);
    } },
    { name: 'the next level-up celebrates again; index 5 is accepted', run: async () => {
      dropStore();
      const facts = { current: NEUTRAL };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      await svc.ack(local, { what: 'welcome' });
      facts.current = COUNCIL;
      let v = await svc.getState(local);
      assert.equal(v.level.index, 5);
      assert.equal(v.top, true);
      assert.equal(v.celebration.index, 5);
      v = await svc.ack(local, { what: 'celebration', index: 5 });
      assert.equal(v.celebration, null);
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
        assert.equal((await view(await get())).level.index, before1.level.index, uiLevel);
      }
    } },
    { name: 'a level-up leaves uiLevel alone', run: async () => {
      dropStore();
      const modeBefore = (await (await get('/api/settings')).json()).uiLevel;
      const facts = { current: NEUTRAL };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      facts.current = COUNCIL;
      assert.equal((await svc.getState(local)).level.index, 5);
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
    { name: 'A acks, B is untouched', run: async () => {
      await get('/api/worca-level', A);
      await get('/api/worca-level', B);
      assert.equal((await view(await ack('welcome', A))).welcome, null);
      assert.deepEqual((await view(await get('/api/worca-level', B))).welcome, { kind: 'new' });
      assert.equal((await view(await get('/api/worca-level', A))).welcome, null);
    } },
    { name: 'records are keyed by the lowercased name', run: async () => {
      assert.ok(store.readPerson('alice@x.com'));
      assert.ok(store.readPerson('bob@x.com'));
      assert.equal(store.readPerson('_local'), null);
      assert.equal((await view(await get('/api/worca-level', { 'X-User': 'ALICE@x.com' }))).welcome, null);
    } },
    { name: '?person= is ignored on GET and ack', run: async () => {
      assert.deepEqual((await view(await get('/api/worca-level?person=alice@x.com', B))).welcome, { kind: 'new' });
      await post('/api/worca-level/ack?person=alice@x.com', { what: 'welcome', person: 'alice@x.com' }, B);
      assert.equal((await view(await get('/api/worca-level', B))).welcome, null);
    } },
    { name: 'stats-viewed lands on the caller only', run: async () => {
      assert.equal((await post('/api/worca-level/events', { type: 'stats-viewed' }, A)).status, 204);
      assert.ok(store.readPerson('alice@x.com').live.statsViewedAt);
      assert.equal(store.readPerson('bob@x.com').live.statsViewedAt, null);
    } },
    { name: '/api/stats and /api/team-metrics/scopes carry no worca data', run: async () => {
      for (const path of ['/api/stats', '/api/team-metrics/scopes']) {
        const text = await (await get(path, A)).text();
        assert.ok(!/worca-?level/i.test(text), `${path}: ${text.slice(0, 200)}`);
      }
    } },
  ]);
});

test('team metrics needs a policy, 10 runs, then the open (R-po-33)', async () => {
  const facts = { current: { ...BEFORE_TEAM_METRICS, policyInstalled: false, teamMetricsRuns: 10 } };
  const { svc, pokes } = serviceWith(facts);
  const teamMetrics = async () => (await svc.getState(local)).next?.find((a) => a.id === 'teamMetrics');
  await svc.getState(local);
  await checkRows([
    { name: 'no policy: the open is not recorded', run: async () => {
      await svc.recordViewed(local, { type: 'team-metrics-viewed' });
      assert.equal(store.readPerson('_local').live.teamMetricsOpenedAt, null);
      assert.deepEqual(pokes, []);
    } },
    { name: 'policy but too few runs: not recorded', run: async () => {
      facts.current = { ...facts.current, policyInstalled: true, teamMetricsRuns: 9 };
      await svc.recordViewed(local, { type: 'team-metrics-viewed' });
      assert.equal(store.readPerson('_local').live.teamMetricsOpenedAt, null);
    } },
    { name: 'policy and 10 runs, level 3 -> the open counts and WorcaHolic is reached', run: async () => {
      facts.current = { ...facts.current, teamMetricsRuns: 10 };
      assert.equal((await svc.getState(local)).level.index, 3);
      assert.equal((await teamMetrics()).done, false);
      await svc.recordViewed(local, { type: 'team-metrics-viewed' });
      assert.equal(store.readPerson('_local').live.teamMetricsOpenedAt, NOW);
      assert.equal((await svc.getState(local)).level.index, 4);
    } },
  ]);
});

test('a stats view never marks team metrics (R-po-34, I-6)', async () => {
  const facts = { current: { ...BEFORE_TEAM_METRICS, policyInstalled: true, teamMetricsRuns: 10, statsViewedAt: null } };
  const { svc } = serviceWith(facts);
  await svc.recordViewed(local, { type: 'stats-viewed' });
  const rec = store.readPerson('_local');
  assert.equal(rec.live.statsViewedAt, NOW);
  assert.equal(rec.live.teamMetricsOpenedAt, null);
  assert.equal((await svc.getState(local)).level.index, 3);
  assert.equal(store.readPerson('_local').doneAt.teamMetrics, undefined);
});

test('a teammate\'s policy counts for the caller (R-po-37)', async () => {
  // Bob installed nothing; the install-wide onboarding state reports a policy.
  const facts = { current: { ...BEFORE_TEAM_METRICS, policyInstalled: true, teamMetricsRuns: 10 } };
  const { svc } = serviceWith(facts, { isFreshInstall: () => false, hasSharedActivity: () => true });
  const bob = person('bob@x.com');
  await svc.getState(bob);
  await svc.recordViewed(bob, { type: 'team-metrics-viewed' });
  assert.equal(store.readPerson('bob@x.com').live.teamMetricsOpenedAt, NOW);
  assert.equal(store.readPerson('_local'), null);
});

test('9 runs do not count, 10 do (R-po-38)', async () => {
  for (const [runs, stamped] of [[9, null], [10, NOW]]) {
    dropStore();
    const { svc } = serviceWith({ current: { ...BEFORE_TEAM_METRICS, policyInstalled: true, teamMetricsRuns: runs } });
    await svc.getState(local);
    await svc.recordViewed(local, { type: 'team-metrics-viewed' });
    assert.equal(store.readPerson('_local').live.teamMetricsOpenedAt, stamped, `${runs} runs`);
  }
});

test('events over HTTP: 204 with no body; team-metrics-viewed before its preconditions writes nothing', async () => {
  await get();
  const r = await post('/api/worca-level/events', { type: 'stats-viewed' });
  assert.equal(r.status, 204);
  assert.equal(await r.text(), '');
  assert.ok(store.readPerson('_local').live.statsViewedAt);
  const bytes = storeBytes();
  const tm = await post('/api/worca-level/events', { type: 'team-metrics-viewed' });
  assert.equal(tm.status, 204);
  assert.equal(storeBytes(), bytes);
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
