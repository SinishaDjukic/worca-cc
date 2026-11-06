// test/api-worca-level.test.mjs
// src/core/worca-levels/service.mjs + GET /api/worca-level, POST /api/worca-level/ack, POST /api/worca-level/events.
// Server-test shape (api-onboarding.test.mjs): useTempHome at module top level, the app imported INSIDE
// before(), an ephemeral http server and real fetch. The service's own rules (creation, celebration) are
// driven through createWorcaLevelService with injected facts, since a real level-up needs host state.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, unlinkSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
const REAL_HEADER = process.env.WORCA_IDENTITY_HEADER;
const REAL_PROXIES = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
process.env.HOME = home;                     // settings.json and worca-levels.json live under HOME

const JSONH = { 'Content-Type': 'application/json' };
const VIEW_KEYS = ['celebration', 'ladder', 'level', 'next', 'progress', 'top', 'welcome'];
const NOW = '2026-11-05T10:00:00.000Z';

let srv, base, app, getDb, store, createWorcaLevelService;
const get = (path = '/api/worca-level', headers = {}) => fetch(`${base}${path}`, { headers });
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...JSONH, ...headers }, body: JSON.stringify(body) });
const ack = (what, headers) => post('/api/worca-level/ack', { what }, headers);
const view = async (r) => { assert.equal(r.status, 200, await r.clone().text()); return r.json(); };

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
  try { unlinkSync(store.worcaLevelsFile()); } catch { /* none yet */ }
  const db = getDb();
  for (const t of ['pipelines', 'schedules', 'req_features']) db.exec(`DELETE FROM ${t}`);
});

let seq = 0;
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
function seedRun(startedBy, status = 'done') {
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, status, phase, cycle, started_at, updated_at, started_by)
    VALUES (?, 'proj-00000001', 'project', ?, 'done', 0, ?, ?, ?)`)
    .run(`orcb${String(++seq).padStart(4, '0')}`, status, ago(1), ago(1), startedBy);
}

const LEVEL4_FACTS = {
  gettingStartedDone: true, gettingStarted: { done: 9, total: 9 }, requirements: 1, requirementsFlag: true,
  startedRuns: 1, doneRuns: 1, addonsInstalled: 2, addonsEnabled: 2, spaces: 1, schedules: 1,
  scheduledRuns: 5, peakParallel: 2, statsDays: 3,
};
const NO_FACTS = { ...LEVEL4_FACTS, gettingStartedDone: false, requirements: 0, startedRuns: 0, doneRuns: 0,
  addonsInstalled: 0, addonsEnabled: 0, spaces: 0, schedules: 0, scheduledRuns: 0, peakParallel: 0, statsDays: 0 };
const local = { headers: {} };

function serviceWith(facts, extra = {}) {
  const pokes = [];
  const svc = createWorcaLevelService({
    isFreshInstall: () => true,
    emitChanged: (...a) => pokes.push(a),
    gatherFacts: async () => facts.current,
    now: () => NOW,
    ...extra,
  });
  return { svc, pokes };
}

test('GET answers the view for a fresh install: level 1, a "new" welcome, no celebration, the four-rung ladder', async () => {
  await checkRows([
    { name: 'view shape', run: async () => {
      const v = await view(await get());
      assert.deepEqual(Object.keys(v).sort(), VIEW_KEYS);
      assert.equal(v.level.index, 1);
      assert.deepEqual(Object.keys(v.level).sort(), ['avatar', 'description', 'index', 'key', 'name']);
      assert.deepEqual(v.welcome, { kind: 'new' });
      assert.equal(v.celebration, null);
      assert.equal(v.top, false);
      assert.equal(v.ladder.length, 4);
      assert.deepEqual(v.ladder.map((l) => l.reached), [true, false, false, false]);
      assert.deepEqual(Object.keys(v.ladder[0]).sort(), ['avatar', 'index', 'key', 'name', 'reached']);
      assert.equal(v.progress.total, v.next.length);
    } },
    { name: 'no person name or other-person data in the view', run: async () => {
      process.env.WORCA_IDENTITY_HEADER = 'X-User';
      const text = await (await get('/api/worca-level', { 'X-User': 'ada@example.com' })).text();
      assert.ok(!/ada/i.test(text), text);
    } },
  ]);
});

test('I-4: welcome.kind is "new" on a fresh install, "existing" with past activity, and never changes on later GETs', async () => {
  await checkRows([
    { name: 'fresh -> new, stays new after a run appears', run: async () => {
      assert.equal((await view(await get())).welcome.kind, 'new');
      seedRun('local');
      assert.equal((await view(await get())).welcome.kind, 'new');
    } },
    { name: 'past activity at first GET -> existing, stays', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      assert.equal((await view(await get())).welcome.kind, 'existing');
      assert.equal((await view(await get())).welcome.kind, 'existing');
    } },
  ]);
});

test('I-4 (shared): past activity is the person\'s own req_features / pipelines / schedules row', async () => {
  process.env.WORCA_IDENTITY_HEADER = 'X-User';
  seedRun('Bob@x.com');
  getDb().prepare(`INSERT INTO schedules (id, request, rule, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run('sch_worca1', '{}', '{}', 'dora@x.com', ago(1), ago(1));
  getDb().prepare(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_by, created_at, updated_at)
    VALUES ('project','k','t','d','draft','{}',?,?,?)`).run('rex@x.com', ago(1), ago(1));
  await checkRows([
    { name: 'a run owner is existing (case-insensitive)', run: async () => assert.equal((await view(await get('/api/worca-level', { 'X-User': 'bob@X.com' }))).welcome.kind, 'existing') },
    { name: 'a schedule owner is existing', run: async () => assert.equal((await view(await get('/api/worca-level', { 'X-User': 'dora@x.com' }))).welcome.kind, 'existing') },
    { name: 'a requirement owner is existing', run: async () => assert.equal((await view(await get('/api/worca-level', { 'X-User': 'rex@x.com' }))).welcome.kind, 'existing') },
    { name: 'a person with no rows is new', run: async () => assert.equal((await view(await get('/api/worca-level', { 'X-User': 'nina@x.com' }))).welcome.kind, 'new') },
  ]);
});

test('ack: welcome clears the welcome, is idempotent; bad bodies are 400 with { error }', async () => {
  await checkRows([
    { name: 'ack welcome', run: async () => {
      await get();
      const a = await view(await ack('welcome'));
      assert.equal(a.welcome, null);
      assert.equal((await view(await ack('welcome'))).welcome, null);
      assert.equal((await view(await get())).welcome, null, 'persisted');
    } },
    { name: 'ack of an unknown thing / missing body is 400', run: async () => {
      for (const body of [{ what: 'level' }, {}, { what: 3 }, { what: '__proto__' }, { what: 'celebration' }, { what: 'celebration', index: 9 }]) {
        const r = await post('/api/worca-level/ack', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal(typeof (await r.json()).error, 'string');
      }
    } },
  ]);
});

test('I-3: one celebration for the highest level after the welcome; none at creation; none after ack', async () => {
  await checkRows([
    { name: 'levels backfilled at creation are never celebrated', run: async () => {
      const facts = { current: LEVEL4_FACTS };
      const { svc } = serviceWith(facts);
      const v = await svc.getState(local);
      assert.equal(v.level.index, 4);
      assert.equal(v.top, true);
      assert.equal(v.celebration, null);
      await svc.ack(local, { what: 'welcome' });
      assert.equal((await svc.getState(local)).celebration, null);
    } },
    { name: 'a level-up shows one celebration only once the welcome is acked, for the highest level', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      const facts = { current: NO_FACTS };
      const { svc } = serviceWith(facts);
      let v = await svc.getState(local);
      assert.equal(v.level.index, 1);
      facts.current = LEVEL4_FACTS;
      v = await svc.getState(local);
      assert.equal(v.level.index, 4);
      assert.equal(v.celebration, null, 'welcome not yet seen');
      assert.ok(v.welcome);
      await svc.ack(local, { what: 'welcome' });
      v = await svc.getState(local);
      assert.deepEqual(Object.keys(v.celebration).sort(), ['avatar', 'index', 'key', 'name']);
      assert.equal(v.celebration.index, 4);
      v = await svc.ack(local, { what: 'celebration', index: 4 });
      assert.equal(v.celebration, null);
      assert.equal((await svc.ack(local, { what: 'celebration', index: 4 })).celebration, null, 'idempotent');
      assert.equal((await svc.getState(local)).celebration, null);
    } },
    { name: 'a later level-up after an acked celebration celebrates again', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      const facts = { current: NO_FACTS };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      await svc.ack(local, { what: 'welcome' });
      facts.current = { ...NO_FACTS, gettingStartedDone: true, requirements: 1, doneRuns: 1, startedRuns: 1 };
      let v = await svc.getState(local);
      assert.equal(v.level.index, 2);
      assert.equal(v.celebration.index, 2);
      await svc.ack(local, { what: 'celebration', index: 2 });
      facts.current = LEVEL4_FACTS;
      v = await svc.getState(local);
      assert.equal(v.celebration.index, 4);
    } },
    { name: 'M1: an ack names the level that was shown; a level reached after the GET is still celebrated', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      const facts = { current: NO_FACTS };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      await svc.ack(local, { what: 'welcome' });
      facts.current = { ...NO_FACTS, gettingStartedDone: true, requirements: 1, doneRuns: 1, startedRuns: 1 };
      assert.equal((await svc.getState(local)).celebration.index, 2);
      facts.current = LEVEL4_FACTS;                         // the level rises before the dialog is closed
      const v = await svc.ack(local, { what: 'celebration', index: 2 });
      assert.equal(v.celebration.index, 4);
      assert.equal((await svc.getState(local)).celebration.index, 4);
    } },
    { name: 'D-6: with the requirements flag off the Swimmer links open #new and say task; with it on they open #requirements', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      const swimmerFacts = { ...NO_FACTS, gettingStartedDone: true };
      const hrefs = (v) => Object.fromEntries(v.next.map((a) => [a.id, a.href]));
      const off = await serviceWith({ current: { ...swimmerFacts, requirementsFlag: false } }).svc.getState(local);
      assert.equal(hrefs(off).firstRequirement, '#new');
      assert.equal(hrefs(off).firstFeatureDone, '#new');
      assert.equal(off.next.find((a) => a.id === 'firstRequirement').label, 'Write your first task');
      assert.equal(hrefs(off).gettingStarted, '#getting-started');
      const on = await serviceWith({ current: { ...swimmerFacts, requirementsFlag: true } }).svc.getState(local);
      assert.equal(hrefs(on).firstRequirement, '#requirements');
      assert.equal(on.next.find((a) => a.id === 'firstRequirement').label, 'Write your first requirement');
    } },
    { name: 'M1: a celebration ack without a valid index is rejected', run: async () => {
      const { svc } = serviceWith({ current: NO_FACTS });
      for (const index of [undefined, 0, 5, 1.5, '2', null]) {
        await assert.rejects(svc.ack(local, { what: 'celebration', index }), { code: 'WORCA_LEVEL_BAD_REQUEST' }, String(index));
      }
    } },
    { name: 'the level never drops when facts shrink', run: async () => {
      try { unlinkSync(store.worcaLevelsFile()); } catch { /* fresh */ }
      const facts = { current: LEVEL4_FACTS };
      const { svc } = serviceWith(facts);
      await svc.getState(local);
      facts.current = NO_FACTS;
      assert.equal((await svc.getState(local)).level.index, 4);
    } },
  ]);
});

test('creation uses the injected past-activity check for a single-person install; kind never changes', async () => {
  const facts = { current: NO_FACTS };
  const { svc } = serviceWith(facts, { isFreshInstall: () => false });
  assert.equal((await svc.getState(local)).welcome.kind, 'existing');
  const { svc: fresh } = serviceWith(facts, { isFreshInstall: () => true });
  assert.equal((await fresh.getState(local)).welcome.kind, 'existing', 'already stored');
});

test('noteLiveEvent records the live patch and pokes once, payload-free', async () => {
  const { svc, pokes } = serviceWith({ current: NO_FACTS });
  await svc.noteLiveEvent('_local', { addon: 'foo' });
  assert.deepEqual(store.readPerson('_local').live.addons, ['foo']);
  assert.deepEqual(pokes, [['worca-level-changed']]);
});

test('R-po 15: a seeded finished run appears as done on the next GET', async () => {
  const before1 = await view(await get());
  assert.ok(!before1.next.find((a) => a.id === 'firstFeatureDone').done);
  seedRun('local', 'done');
  const after1 = await view(await get());
  assert.ok(after1.next.find((a) => a.id === 'firstFeatureDone').done);
  assert.ok(after1.progress.done >= 1);
});

test('events: stats-viewed -> 204 and today (UTC) is stored; other types are 400', async () => {
  await get();
  await checkRows([
    { name: 'stats-viewed', run: async () => {
      const r = await post('/api/worca-level/events', { type: 'stats-viewed' });
      assert.equal(r.status, 204);
      assert.equal(await r.text(), '');
      assert.deepEqual(store.readPerson('_local').live.statsDays, [new Date().toISOString().slice(0, 10)]);
      await post('/api/worca-level/events', { type: 'stats-viewed' });
      assert.equal(store.readPerson('_local').live.statsDays.length, 1, 'distinct days');
    } },
    { name: 'unknown / missing type', run: async () => {
      for (const body of [{ type: 'addon-installed' }, {}, { type: 5 }]) {
        const r = await post('/api/worca-level/events', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.equal(typeof (await r.json()).error, 'string');
      }
    } },
  ]);
});

test('recordStatsViewed keeps only the last 30 distinct days and does not backfill', async () => {
  const { svc } = serviceWith({ current: NO_FACTS });
  await svc.getState(local);
  assert.deepEqual(store.readPerson('_local').live.statsDays, []);
  for (let i = 1; i <= 32; i++) {
    const day = `2026-01-${String(i).padStart(2, '0')}`;
    if (i <= 31) await store.recordLive('_local', { statsDay: day });
  }
  await svc.recordStatsViewed(local);
  const days = store.readPerson('_local').live.statsDays;
  assert.equal(days.length, 30);
  assert.equal(days.at(-1), NOW.slice(0, 10));
});

test('I-5: with WORCA_IDENTITY_HEADER each person sees only their own view; ?person= is ignored', async () => {
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
      await post('/api/worca-level/events', { type: 'stats-viewed' }, A);
      assert.equal(store.readPerson('alice@x.com').live.statsDays.length, 1);
      assert.equal(store.readPerson('bob@x.com').live.statsDays.length, 0);
    } },
    { name: '/api/stats and /api/team-metrics/scopes carry no worca data', run: async () => {
      for (const path of ['/api/stats', '/api/team-metrics/scopes']) {
        const text = await (await get(path, A)).text();
        assert.ok(!/worca/i.test(text), `${path}: ${text.slice(0, 200)}`);
      }
    } },
  ]);
});

test('two parallel first GETs create one record', async () => {
  const views = await Promise.all(Array.from({ length: 5 }, () => get().then(view)));
  assert.equal(new Set(views.map((v) => JSON.stringify(v))).size, 1);
  const file = JSON.parse(readFileSync(store.worcaLevelsFile(), 'utf8'));
  assert.deepEqual(Object.keys(file.people), ['_local']);
});
