// test/shape-server-slices.test.mjs — Shape it first, plan in slices, on the server (spec §3.8, L9–L11): the
// /api/shape/… routes, the live overlay, the shape-feature broadcasts, the Chat card's REST strip and the answer
// route's outline fields. Boot = the server-mock-mode recipe of test/api-shape-first.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir, templateRepo } from './helpers/git-dir.mjs';
import { seedPipeline, seedPipelineRow } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { addProject } from '../src/core/projects.mjs';
import { readCostCapOverride } from '../src/core/cost-budget.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createThread, linkRun as askLinkRun, listMessages, appendMessage as askAppendMessage } from '../src/core/ask/store.mjs';
import { createSliceFeature, featureView, recordShapePlan, recordShip, retireFeaturesOf, featureThread, currentFeatureId, sliceGateState } from '../src/core/shape/features.mjs';
import { getTicket, requestRunNow, cancelTicket } from '../src/core/scheduler.mjs';
import { checkCombine } from '../src/core/git-sync.mjs';
import { listNotifications } from '../src/core/notifications.mjs';
import { nightModeToggle } from '../src/core/settings.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { readServerSource, SERVER_MJS } from '../src/core/read-server-source.mjs';
import { featureCardModel } from '../ui/public/shape/feature-card.mjs';
import { paintFeatureActions } from '../ui/public/shape/feature-actions.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { NO_ADO, REMOTES_V, okRun, failRun, argOf, ghCalls, git, stubShip, shipKit } from './helpers/ship-world.mjs';
import { world, SIXTEEN_RUN_STATES } from './helpers/shape-sixteen-runs.mjs';
import { planStop, heldRefusal } from '../src/shared/shape/run-stops.mjs';
// A namespace read, so a missing new export (featureAnswerPlace, whereToAnswerOf) fails only its own tests.
import * as CHAIN from '../src/core/shape/chain.mjs';

useTempHome(after, 'worca-shape-server-slices-');

let srv, base, wsBase, runs, testing, project, schedulerTick, pauseRun;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const get = (p) => fetch(`${base}${p}`);
const savedMock = process.env.WORCA_MOCK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs, schedulerTick, pauseRun } = mod);
  testing = mod._testing;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  project = mkdtempSync(join(tmpdir(), 'worca-shape-server-slices-proj-'));
  getDb();
});
after(async () => {
  for (const [id, e] of [...runs]) {
    if (e && e.orch && typeof e.orch.stop === 'function' && !['done', 'stopped', 'error'].includes(String(e.status))) {
      try { await e.orch.stop(); } catch { /* best effort */ }
    }
    void id;
  }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (savedMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = savedMock;
  rmSync(project, { recursive: true, force: true });
});

// ── fixtures ─────────────────────────────────────────────────────────────────
const slice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [], acceptance: [`ok ${n}`],
  dependsOn: [], estimate: 'M' });
const outlineOf = (n) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => slice(i + 1)) });
let seq = 0;
const nextId = () => `ss${String(++seq).padStart(8, '0')}`;
const pipe = (status = 'running') => {
  const id = nextId();
  seedPipelineRow({ id, projectKey: projectKey(project), status, title: id, branch: { source: 'main', feature: `feat/${id}` } });
  return id;
};
/** A feature of `n` slices whose slice 1 ran as pipeline `status`. Tickets are quieted by callers that tick. */
const mk = (n = 2, status = 'running', over = {}) => {
  const pid = pipe(status);
  const f = createSliceFeature({ pipelineId: pid, projectDir: project, title: 'Charts', outline: outlineOf(n), perspectives: ['product'],
    workflowId: 'wf_shape', startedBy: 'ann', base: { mock: true }, ...over });
  return { ...f, pid };
};
const setPipe = (id, status) => getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, id);
const view = async (id) => (await get(`/api/shape/features/${id}`)).json();

/** A live entry stand-in for pipeline `pid`: what liveSliceOf reads. */
function liveEntry(pid, { status = 'running', pending = null, approved = false } = {}) {
  const e = { id: `live-${pid}`, kind: 'run', pipelineId: pid, status, events: [], pendingQuestion: pending,
    orch: { state: { shaping: approved ? { approved: { file: 'p.md' } } : {} } } };
  runs.set(e.id, e);
  return e;
}
const dropEntry = (e) => runs.delete(e.id);

/** Collects every frame a socket receives; `frames(type)` filters. */
async function collector() {
  const ws = new WebSocket(wsBase);
  const got = [];
  ws.on('message', (d) => { try { got.push(JSON.parse(String(d))); } catch { /* not json */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const t0 = Date.now();
  while (!got.some((m) => m.type === 'hello') && Date.now() - t0 < 3000) await sleep(10);
  return { frames: (type) => got.filter((m) => m.type === type), close: () => ws.close(), got };
}

// ── the internal-only slice field ──────────────────────────────────────────────
test('not internal: POST /api/run with shape.slice is refused as an unknown field', async () => {
  const r = await post('/api/run', { prompt: 'x', projectDir: project, shape: { slice: { feature: 'f', index: 2 } } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /shape has unknown field\(s\): slice/);
});

// ── GET /api/shape/features/:id ──────────────────────────────────────────────
test('GET /api/schedules: a chain whose first run is a slice carries its feature (D17)', async () => {
  const { id, pid } = mk(3, 'running');
  const c = (await (await get('/api/schedules')).json()).chains.find((x) => x.members[0].pipelineId === pid);
  assert.ok(c, 'the chain is listed');
  assert.equal(c.feature.id, id);
  assert.equal(c.feature.title, 'Charts');
  assert.deepEqual(c.feature.slices.map((x) => x.index), [1, 2, 3]);
});

test('GET /api/shape/pipelines/:pid/slice: the slice\'s place in its feature; 404 for a plain run', async () => {
  const f = mk(3, 'done');
  const p2 = pipe('running');
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  const r = await get(`/api/shape/pipelines/${p2}/slice`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual({ ...body, state: undefined }, { featureId: f.id, title: 'Charts', index: 2, total: 3, sliceTitle: 'Slice 2',
    state: undefined, next: { index: 3, title: 'Slice 3', state: 'planned' }, threadId: null });
  assert.equal((await get('/api/shape/pipelines/p-plain-zz/slice')).status, 404);
});

test('GET feature: the view, 404 for an unknown id, and the re-plan successor with replanOf', async () => {
  const a = mk(2);
  const v = await view(a.id);
  assert.equal(v.id, a.id);
  assert.equal(v.total, 2);
  assert.equal(v.replanOf, null);
  assert.equal((await get('/api/shape/features/feat_nope')).status, 404);

  // F47: A replanned, replaced_by B → the view of B with replanOf 'A'.
  const b = mk(3);
  getDb().prepare("UPDATE shape_features SET status = 'replanned', replaced_by = ? WHERE id = ?").run(b.id, a.id);
  const viaA = await view(a.id);
  assert.equal(viaA.id, b.id);
  assert.equal(viaA.replanOf, a.id);
  assert.equal((await view(b.id)).replanOf, null);
});

// Shaper small runs A2: flag off is dev's exact body; on adds the record's 2 keys (test/fixtures/shaper/dev-feature-view-keys.json).
test("GET feature and the card's feature: dev's exact keys with small runs off, plus care and requirementKinds with it on", async () => {
  const DEV = JSON.parse(readFileSync(new URL('./fixtures/shaper/dev-feature-view-keys.json', import.meta.url), 'utf8'));
  const RECORD = ['care', 'requirementKinds'];
  const { id, pid } = mk(2);                                     // running: not ready to ship, so no ship.hint
  const keys = async () => {
    const api = await view(id);
    const card = await (await get(`/api/shape/pipelines/${pid}/card`)).json();
    return { api, card: card.feature };
  };
  const off = await withEnvVars({ WORCA_FLAGS: undefined }, keys);
  assert.deepEqual(Object.keys(off.api), DEV.api);
  assert.deepEqual(Object.keys(off.card), DEV.view);
  assert.deepEqual(Object.keys(off.api.slices[0]), DEV.slice);
  assert.deepEqual(Object.keys(off.api.ship), DEV.ship);
  const on = await withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, keys);
  assert.deepEqual(Object.keys(on.api).sort(), [...DEV.api, ...RECORD].sort());
  assert.deepEqual(Object.keys(on.card), [...DEV.view, ...RECORD]);
  assert.deepEqual([on.api.care, on.api.requirementKinds], [{ position: 'balanced', chosenBy: 'default', worcaPick: null }, []]);
  assert.deepEqual([on.card.care, on.card.requirementKinds], [on.api.care, on.api.requirementKinds]);
  // Everything dev returns is the same with the flag on.
  for (const k of DEV.api) assert.deepEqual(on.api[k], off.api[k], k);
});

// Slice 7 (D10, R-arch-4): the view says whether a chat follows the feature, only for a marked one with the flag on.
test('s7 R-arch-4: a feature started without a chat has no chat card', async () => {
  const marker = (pid) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', pid);
  const on = (fn) => withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, fn);
  const both = async (id, pid) => [await view(id), (await (await get(`/api/shape/pipelines/${pid}/card`)).json()).feature];
  const chatless = mk(1, 'done');
  marker(chatless.pid);
  await on(async () => {
    for (const v of await both(chatless.id, chatless.pid)) assert.equal(v.hasChat, false);
    await testing.offerShipCard(chatless.pid);                     // every run is done
    assert.equal(featureThread(chatless.id), null);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM ask_run_links WHERE pipeline_id = ?').get(chatless.pid).n, 0);
    const blocks = getDb().prepare('SELECT blocks FROM ask_messages').all().map((r) => String(r.blocks || '')).join('\n');
    assert.equal(blocks.includes(chatless.id) || blocks.includes(chatless.pid), false, 'no chat card names it');
  });
  const chatted = mk(1, 'done');
  marker(chatted.pid);
  const thread = createThread({ title: 'charts' });
  askLinkRun(thread.id, { runId: 'run-s7-chat', pipelineId: chatted.pid, cardId: 'card_s7' });
  await on(async () => { for (const v of await both(chatted.id, chatted.pid)) assert.equal(v.hasChat, true); });
  // Unmarked with the flag on, and marked with the flag off: dev's keys, no hasChat at all.
  const plain = mk(1, 'done');
  await on(async () => { for (const v of await both(plain.id, plain.pid)) assert.equal('hasChat' in v, false, 'unmarked'); });
  await withEnvVars({ WORCA_FLAGS: undefined }, async () => {
    for (const f of [chatless, chatted]) for (const v of await both(f.id, f.pid)) assert.equal('hasChat' in v, false, 'flag off');
  });
});

// Slice 18 (R-arch-4, D4, D7): the chat texts read, when they are sent, whether a chat follows the run's feature.
const smallMarker = (pid) => getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', pid);
const smallOn = (fn) => withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, fn);
const markedFeature = (over) => { const f = mk(1, 'done', over); smallMarker(f.pid); return f; };
const chatOn = (pid, tag) => askLinkRun(createThread({ title: tag }).id, { runId: `run-${tag}`, pipelineId: pid, cardId: `card_${tag}` });

test('s18 (R-arch-4): featureAnswerPlace answers as the feature view\'s hasChat, and null for unmarked, unknown and flag off', async () => {
  assert.equal(typeof CHAIN.featureAnswerPlace, 'function', 'chain.mjs exports featureAnswerPlace');
  const chatless = markedFeature();
  const chatted = markedFeature();
  chatOn(chatted.pid, 's18_chat');
  const plain = mk(1, 'done');                       // no marker
  await smallOn(async () => {
    assert.deepEqual(CHAIN.featureAnswerPlace(chatless.pid), { featureId: chatless.id, hasChat: false });
    assert.deepEqual(CHAIN.featureAnswerPlace(chatted.pid), { featureId: chatted.id, hasChat: true });
    for (const f of [chatless, chatted]) assert.equal(CHAIN.featureAnswerPlace(f.pid).hasChat, (await view(f.id)).hasChat, f.id);
    assert.equal(CHAIN.featureAnswerPlace(plain.pid), null, 'unmarked');
    assert.equal(CHAIN.featureAnswerPlace('no-such'), null, 'unknown pipeline');
  });
  await withEnvVars({ WORCA_FLAGS: undefined }, async () => {
    for (const f of [chatless, chatted]) assert.equal(CHAIN.featureAnswerPlace(f.pid), null, 'flag off');
  });
});

test('s18 (R-arch-4): featureAnswerPlace of a re-planned feature\'s run answers for the newest feature, and finds the first chat', async () => {
  assert.equal(typeof CHAIN.featureAnswerPlace, 'function', 'chain.mjs exports featureAnswerPlace');
  const first = markedFeature();
  chatOn(first.pid, 's18_replan');
  const next = markedFeature({ replaces: first.id });
  await smallOn(async () => assert.deepEqual(CHAIN.featureAnswerPlace(first.pid), { featureId: next.id, hasChat: true }));
});

test('s18 (R-arch-4): whereToAnswerOf maps a live run id to its pipeline, falls back to the id, and returns null on a throw', async () => {
  assert.equal(typeof CHAIN.whereToAnswerOf, 'function', 'chain.mjs exports whereToAnswerOf');
  const chatless = markedFeature();
  await smallOn(async () => {
    const where = CHAIN.whereToAnswerOf(new Map([['run-1', { pipelineId: chatless.pid }]]));
    assert.equal(where('run-1')?.hasChat, false, 'the run\'s pipeline');
    assert.equal(CHAIN.whereToAnswerOf(new Map())(chatless.pid)?.hasChat, false, 'an unknown run id is read as a pipeline id');
    assert.equal(where('run-unknown'), null);
    assert.equal(CHAIN.whereToAnswerOf({ get: () => { throw new Error('boom'); } })('run-1'), null, 'a throw is null');
  });
});

test('s18 (R-arch-4): the server builds whereToAnswerOf once from its runs and hands it to the notifier and the chat actions', () => {
  const src = readServerSource(undefined, { routes: false });
  assert.equal(src.split('whereToAnswerOf(runs)').length - 1, 1, 'built once, from the runs Map');
  const block = (from, to) => { const at = src.indexOf(from); assert.ok(at >= 0, from); return src.slice(at, src.indexOf(to, at)); };
  assert.match(block('const chatNotifier = createNotifier({', '\n});'), /\bwhereToAnswer\b/, 'createNotifier');
  assert.match(block('const chatActions = {', '\n};'), /\bwhereToAnswer\b/, 'chatActions');
});

test('GET feature: a settled entry is ignored (the pipelines row decides), a paused or plan-asking one is shown (F26)', async () => {
  const f = mk(2, 'stopped');
  const settled = liveEntry(f.pid, { status: 'stopped' });
  try {
    const v = await view(f.id);
    assert.equal(v.slices[0].state, 'stopped');
    assert.equal(v.halted.index, 1);
  } finally { dropEntry(settled); }

  const g = mk(2, 'done');
  const doneEntry = liveEntry(g.pid, { status: 'done' });
  try { assert.equal((await view(g.id)).slices[0].state, 'done'); } finally { dropEntry(doneEntry); }

  const h = mk(2, 'running');
  const paused = liveEntry(h.pid, { status: 'paused' });
  try { assert.equal((await view(h.id)).slices[0].state, 'paused'); } finally { dropEntry(paused); }

  const k = mk(2, 'running');
  const ask = liveEntry(k.pid, { status: 'running', pending: { id: 'plan-n-1', kind: 'plan' } });
  try {
    assert.equal((await view(k.id)).slices[0].state, 'approval');
    ask.pendingQuestion = { id: 'q1', kind: 'questions' };
    assert.equal((await view(k.id)).slices[0].state, 'questions');
    ask.pendingQuestion = null;
    ask.orch.state.shaping = { approved: { file: 'p.md' } };
    assert.equal((await view(k.id)).slices[0].state, 'running');
  } finally { dropEntry(ask); }
  for (const x of [f, g, h, k]) getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?)").run(x.id);
});

// ── actions ──────────────────────────────────────────────────────────────────
test('cancel cancels the open tickets, answers the view and broadcasts shape-feature', async () => {
  const f = mk(3);
  const c = await collector();
  try {
    const r = await post(`/api/shape/features/${f.id}/cancel`, {});
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.feature.status, 'canceled');
    await sleep(100);
    assert.ok(c.frames('shape-feature').some((m) => m.id === f.id), 'a shape-feature frame reached the socket');
    assert.equal((await post(`/api/shape/features/${f.id}/cancel`, {})).status, 409, 'a canceled feature refuses a second cancel');
    assert.equal((await post('/api/shape/features/feat_nope/cancel', {})).status, 404);
  } finally { c.close(); }
});

// "Ask me before each run": slice 1 done, slice 2's ticket held by the scheduler until Start now (or the switch goes off).
const heldFeature = async () => {
  const f = mk(2, 'done', { approveEach: true });
  await schedulerTick();
  const v = featureView(f.id);
  assert.ok(v.held, 'slice 2 is held after a tick');
  return { f, ticketId: v.held.ticketId };
};
const ticketRow = (id) => ({ ...getDb().prepare('SELECT status, forced, run_at, fail_reason FROM scheduled_runs WHERE id = ?').get(id) });

test('start: 404 unknown, 409 when no run is held; a held run starts and its ticket is fired', async () => {
  assert.equal((await post('/api/shape/features/feat_nope/start', {})).status, 404);
  const quiet = mk(2, 'running', { approveEach: true });
  let r = await post(`/api/shape/features/${quiet.id}/start`, {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'no run is waiting for you to start');
  const { f, ticketId } = await heldFeature();
  r = await post(`/api/shape/features/${f.id}/start`, {});
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.runId, ticketId);
  assert.notEqual(getTicket(ticketId).status, 'scheduled', 'Run now fired it');
  assert.equal(featureView(f.id).held, null);
});

test('start: a run-now refusal passes through and changes no ticket', async () => {
  const { f, ticketId } = await heldFeature();
  const before = ticketRow(ticketId);
  // the run before is still merging its work back: Run now refuses
  const pid = f.pid;
  const row = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid);
  getDb().prepare('UPDATE pipelines SET branch = NULL WHERE id = ?').run(pid);
  try {
    const r = await post(`/api/shape/features/${f.id}/start`, {});
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /first, or change its source branch/);
    assert.deepEqual(ticketRow(ticketId), before);
  } finally { getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(row.branch, pid); }
});

test('start: a canceled feature answers 409', async () => {
  const { f } = await heldFeature();
  getDb().prepare("UPDATE shape_features SET status = 'canceled' WHERE id = ?").run(f.id);
  const r = await post(`/api/shape/features/${f.id}/start`, {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'this feature is canceled');
});

test('approve-each off releases a held run', async () => {
  const { f, ticketId } = await heldFeature();
  const r = await post(`/api/shape/features/${f.id}/approve-each`, { on: false });
  assert.deepEqual(await r.json(), { ok: true, approveEach: false });
  await schedulerTick();                                   // best effort: a busy tick leaves it to the next one
  assert.notEqual(getTicket(ticketId).status, 'scheduled');
  assert.equal(featureView(f.id).held, null);
});

test('Away on: a tick keeps the run held and featureView(id).held stays set', async () => {
  const keys = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const home = mkdtempSync(join(tmpdir(), 'worca-shape-away-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    mkdirSync(join(home, '.worca-cc'), { recursive: true });
    writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ nightModeToggle: 'on' }));
    assert.equal(nightModeToggle(), 'on');
    const { f, ticketId } = await heldFeature();
    await schedulerTick();
    assert.equal(getTicket(ticketId).status, 'scheduled');
    assert.deepEqual(featureView(f.id).held, { index: 2, ticketId });
    // the card Away leaves: the feature route's view through the shared painter shows the held row once
    const feature = await view(f.id);
    const { controls } = featureCardModel({ card: { pipelineId: feature.originPipelineId, feature, log: [] } });
    const dom = new JSDOM('<!doctype html><body></body>');
    const host = dom.window.document.createElement('div');
    paintFeatureActions(dom.window.document, host, controls, {}, { menu: false });
    const rows = host.querySelectorAll('.shape-feature-held');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].textContent, 'Needs youRun 2 waits for you to startStart now');
    assert.equal(host.textContent.split('waits for you to start').length - 1, 1);
    dom.window.close();
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    rmSync(home, { recursive: true, force: true });
  }
});

test('approve-each validates its body, stores the switch and 404s an unknown feature', async () => {
  const f = mk(2);
  let r = await post(`/api/shape/features/${f.id}/approve-each`, { on: 'yes' });
  assert.equal(r.status, 400);
  r = await post(`/api/shape/features/${f.id}/approve-each`, {});
  assert.equal(r.status, 400);
  r = await post(`/api/shape/features/${f.id}/approve-each`, { on: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, approveEach: false });
  assert.equal((await view(f.id)).approveEach, false);
  assert.equal((await post('/api/shape/features/feat_nope/approve-each', { on: true })).status, 404);
});

test('resume: nothing stopped is a 409, a stopped slice restarts as a new ticket', async () => {
  const quiet = mk(2, 'running');
  let r = await post(`/api/shape/features/${quiet.id}/resume`, {});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /no slice is stopped/);

  const f = mk(2, 'stopped');
  r = await post(`/api/shape/features/${f.id}/resume`, {});
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.action, 'restart');
  assert.ok(body.ticketId);
  assert.equal((await post('/api/shape/features/feat_nope/resume', {})).status, 404);
});

// Slice 6 (D13): the resume route takes the run number of a stop line's Resume.
const ticketCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM scheduled_runs').get().n;
const rowTicket = (fid, idx) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, idx).ticket_id;

test('resume with an index that is not a run number is a 400 and writes no ticket', async () => {
  for (const index of [0, 'x', 1.5, -1]) {
    const f = mk(2, 'stopped');
    const n = ticketCount(); const t = rowTicket(f.id, 1);
    const r = await post(`/api/shape/features/${f.id}/resume`, { index });
    assert.equal(r.status, 400, JSON.stringify(index));
    assert.deepEqual(await r.json(), { error: 'index must be a run number' }, JSON.stringify(index));
    assert.equal(ticketCount(), n, JSON.stringify(index));
    assert.equal(rowTicket(f.id, 1), t, JSON.stringify(index));
  }
});

test('resume with a run that is not stopped is a 409 NOT_HALTED and writes no ticket', async () => {
  const f = mk(2, 'stopped');
  const n = ticketCount(); const t = rowTicket(f.id, 1);
  const r = await post(`/api/shape/features/${f.id}/resume`, { index: 2 });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'NOT_HALTED', error: 'Run 2 is not stopped' });
  assert.equal(ticketCount(), n);
  assert.equal(rowTicket(f.id, 1), t);
});

test('resume with the stopped run\'s index, or with an empty body, restarts it as today', async () => {
  for (const body of [{ index: 1 }, {}]) {
    const f = mk(2, 'stopped');
    const r = await post(`/api/shape/features/${f.id}/resume`, body);
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.equal(out.action, 'restart', JSON.stringify(body));
    assert.equal(rowTicket(f.id, 1), out.ticketId, JSON.stringify(body));
  }
});

test('replan answers the ticket as runId and a second replan is a 409', async () => {
  const f = mk(2, 'stopped');
  let r = await post(`/api/shape/features/${f.id}/replan`, {});
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.runId);
  r = await post(`/api/shape/features/${f.id}/replan`, {});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /replanning/);
});

// ── plans ────────────────────────────────────────────────────────────────────
test('GET /api/shape/plans lists the plans newest first, with a paused row as paused and the feature view attached', async () => {
  const old = createThread();
  const fresh = createThread();
  recordShapePlan({ threadId: old.id, cardId: 'card_00000001', title: 'Older plan', now: Date.now() - 60000 });
  recordShapePlan({ threadId: fresh.id, cardId: 'card_00000002', title: 'Newer plan' });
  const f = mk(2, 'running');
  askLinkRun(fresh.id, { runId: `live-${f.pid}`, cardId: 'card_00000002', pipelineId: f.pid, status: 'running' });
  const e = liveEntry(f.pid, { status: 'paused' });
  try {
    const { plans } = await (await get('/api/shape/plans')).json();
    const ours = plans.filter((p) => p.threadId === old.id || p.threadId === fresh.id);
    assert.deepEqual(ours.map((p) => p.cardId), ['card_00000002', 'card_00000001']);
    assert.equal(ours[0].state, 'paused');
    assert.equal(ours[0].feature.id, f.id);
    assert.equal(ours[1].feature, null);
  } finally { dropEntry(e); }
});

test('GET /api/shape/plans: a plan whose slice 1 is a replanned feature carries the successor view (F47)', async () => {
  const t = createThread();
  recordShapePlan({ threadId: t.id, cardId: 'card_00000003', title: 'Plan' });
  const a = mk(2, 'done');
  const b = mk(3, 'running');
  getDb().prepare("UPDATE shape_features SET status = 'replanned', replaced_by = ? WHERE id = ?").run(b.id, a.id);
  askLinkRun(t.id, { runId: 'r-a', cardId: 'card_00000003', pipelineId: a.pid, status: 'done' });
  const { plans } = await (await get('/api/shape/plans')).json();
  const row = plans.find((p) => p.threadId === t.id);
  assert.equal(row.feature.id, b.id);
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id IN (?, ?))").run(a.id, b.id);
});

// ── the Chat card's REST strip (F46, F48) ────────────────────────────────────
test('GET /api/ask/runs/:id carries shaping.feature for slice 1 only', async () => {
  const f = mk(2, 'done');
  const slice2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  const p2 = pipe('running');
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(p2, slice2);
  const lone = pipe('done');
  try {
    const one = await (await get(`/api/ask/runs/${f.pid}`)).json();
    assert.deepEqual(one.state.shaping, { feature: { id: f.id, index: 1 } });
    const two = await (await get(`/api/ask/runs/${p2}`)).json();
    assert.ok(!two.state.shaping, 'a slice-2 pipeline gets no strip');
    const none = await (await get(`/api/ask/runs/${lone}`)).json();
    assert.ok(!none.state.shaping, 'a run with no feature gets no strip');
  } finally { retireFeaturesOf(f.pid); }
});

// ── the answer route forwards the outline fields ─────────────────────────────
test('POST /api/runs/:id/answer forwards edits and approveEach to the run', async () => {
  const calls = [];
  runs.set('shape-outline-run', { id: 'shape-outline-run', kind: 'run', status: 'running', events: [],
    orch: { answer: (qid, payload, by) => { calls.push({ qid, payload, by }); return true; } },
    pendingQuestion: { id: 'plan-outline-n_plan-1', kind: 'plan' } });
  try {
    const edits = [{ op: 'merge', id: 's2' }];
    const r = await post('/api/runs/shape-outline-run/answer', { id: 'plan-outline-n_plan-1', decision: 'approve', edits, approveEach: false });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(calls[0].payload, { decision: 'approve', edits, approveEach: false });
  } finally { runs.delete('shape-outline-run'); }
});

// ── the wireRun hook (F42, F49) ──────────────────────────────────────────────
/** A wired fake slice orchestrator for pipeline `pid`; emit through `orch`. */
function wireSlice(pid) {
  const orch = Object.assign(new EventEmitter(), { runShape: { slice: { feature: 'f', index: 2 } }, state: { shaping: {} } });
  const entry = { id: `wired-${pid}`, kind: 'run', status: 'running', events: [], pipelineId: pid, orch };
  runs.set(entry.id, entry);
  testing.wireRun(entry);
  return { orch, entry };
}

test('wireRun: a slice run broadcasts its feature when status, ask kind or approval changes, and not on token frames (F49)', async () => {
  const f = mk(2, 'running');
  const { orch, entry } = wireSlice(f.pid);
  const c = await collector();
  const count = () => c.frames('shape-feature').filter((m) => m.id === f.id).length;
  try {
    orch.emit('question', { id: 'plan-n-1', kind: 'plan' });
    await sleep(60);
    assert.equal(count(), 1, 'the plan ask opened');
    for (let i = 0; i < 5; i++) { orch.emit('token', { text: 'x' }); orch.emit('log', { line: 'y' }); }
    await sleep(60);
    assert.equal(count(), 1, 'token and log frames send nothing');
    orch.emit('exec', { node: 'n' });
    await sleep(60);
    assert.equal(count(), 1, 'an unchanged key sends nothing');
    entry.pendingQuestion = null;
    orch.state.shaping = { approved: { file: 'p.md' } };
    orch.emit('state', { status: 'running' });
    await sleep(60);
    assert.equal(count(), 2, 'the approval changed the key');
    assert.ok(!entry.events.some((e) => e.type === 'shape-feature'), 'a shape-feature frame is never in the run replay');
  } finally {
    c.close();
    runs.delete(entry.id);
    getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?)").run(f.id);
  }
});

test('wireRun: a shape-feature event on the orchestrator is broadcast and kept out of the replay', async () => {
  const { orch, entry } = wireSlice(pipe('running'));
  const c = await collector();
  try {
    orch.emit('shape-feature', { id: 'feat_x' });
    await sleep(60);
    assert.equal(c.frames('shape-feature').filter((m) => m.id === 'feat_x').length, 1);
    assert.ok(!entry.events.some((e) => e.type === 'shape-feature'));
  } finally { c.close(); runs.delete(entry.id); }
});

// ── errors never escape (F29, F42): LAST in the file, they break the shared temp DB ──────────────────────────
test('errors never escape: with shape_feature_slices gone resume answers 500, the run frame still lands and the server lives', async () => {
  const f = mk(2, 'stopped');
  const { orch, entry } = wireSlice(f.pid);
  const c = await collector();
  const db = getDb();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('ALTER TABLE shape_feature_slices RENAME TO shape_feature_slices_gone');
  try {
    const r = await post(`/api/shape/features/${f.id}/resume`, {});
    assert.equal(r.status, 500);
    assert.ok(typeof (await r.json()).error === 'string');
    assert.equal((await get('/api/health')).status, 200, 'the server still answers');

    orch.emit('question', { id: 'plan-n-1', kind: 'plan' });
    orch.emit('done', { status: 'stopped' });
    await sleep(100);
    assert.ok(c.frames('done').some((m) => m.runId === entry.id), 'the done frame reached the socket');
    assert.ok(entry.events.some((e) => e.type === 'done'), 'and the run replay');
  } finally {
    db.exec('ALTER TABLE shape_feature_slices_gone RENAME TO shape_feature_slices');
    db.exec('PRAGMA foreign_keys = ON');
    c.close();
    runs.delete(entry.id);
  }
});

// ── One ship flow: a member's own PR (openMemberPr); a settled slice opens none (afterRunSettled) ───────────────
/** gh present, one origin; every argv lands in `seen`. `create(args)` answers gh pr create (a URL, or a failure). */
function stubGh(seen, { create = () => okRun('https://github.com/me/repo/pull/7\n') } = {}) {
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return create(args);
    return okRun('');
  });
}
const creates = (seen) => seen.filter((a) => a[0] === 'gh' && a[1] === 'pr' && a[2] === 'create');
let gitInfo;
const NEEDS_META = () => writeStoreMeta(projectKey(project), 'project', { key: projectKey(project), name: 'P', path: project });
/** Slice 1 done on feat/<p1> from main, slice 2 done on feat/<p2> from slice 1's branch (stacked), its ticket fired. */
function stackedFeature() {
  NEEDS_META();
  const p1 = nextId();
  seedPipelineRow({ id: p1, projectKey: projectKey(project), status: 'done', title: 'Charts · 1/2: Slice 1', branch: { source: 'main', feature: `feat/${p1}` } });
  const f = createSliceFeature({ pipelineId: p1, projectDir: project, title: 'Charts', outline: outlineOf(2), perspectives: ['product'],
    workflowId: 'wf_shape', base: { mock: true } });
  const p2 = nextId();
  seedPipelineRow({ id: p2, projectKey: projectKey(project), status: 'done', title: 'Charts · 2/2: Slice 2', branch: { source: `feat/${p1}`, feature: `feat/${p2}` } });
  const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(p2, t2);
  return { f, p1, p2 };
}
const draftOf = (fid, idx) => getDb().prepare('SELECT draft_pr_url FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, idx).draft_pr_url;

test('openMemberPr: a ready PR on the chain root for slice 1, stacked on slice 1\'s branch for slice 2; no draft', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const { f, p1, p2 } = stackedFeature();
    const seen = [];
    stubGh(seen);
    assert.equal((await testing.openMemberPr(p1)).ok, true);
    stubGh(seen, { create: () => okRun('https://github.com/me/repo/pull/8\n') });
    assert.equal((await testing.openMemberPr(p2)).ok, true);
    const [c1, c2] = creates(seen);
    assert.equal(argOf(c1, '--base'), 'main');
    assert.equal(argOf(c2, '--base'), `feat/${p1}`);
    assert.ok(!c1.includes('--draft') && !c2.includes('--draft'));
    assert.equal(draftOf(f.id, 1), null, 'no draft_pr_url is written');
  } finally { gitInfo.reset(); }
}));

test('openMemberPr: a run that already has a live PR opens no second one', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const { p1 } = stackedFeature();
    const seen = [];
    stubGh(seen);
    assert.equal((await testing.openMemberPr(p1)).ok, true);
    const again = await testing.openMemberPr(p1);
    assert.deepEqual([again.ok, again.existed], [true, true]);
    assert.equal(creates(seen).length, 1, 'once only');
  } finally { gitInfo.reset(); }
}));

test('afterRunSettled: a done slice opens no PR (one ship flow); it still offers the Ship card', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const seen = [];
    stubGh(seen);
    const orch = (pid, status, slice = { feature: 'f', index: 1 }) => ({ runShape: slice ? { slice } : null, getState: () => ({ status, id: pid }) });
    const a = stackedFeature();
    await testing.afterRunSettled(orch(a.p1, 'done'));
    await testing.afterRunSettled(orch(a.p2, 'done'));
    assert.equal(creates(seen).length, 0, 'no draft PR per slice');
    assert.equal(draftOf(a.f.id, 1), null);
  } finally { gitInfo.reset(); }
}));

// ── D24, D25: POST /api/shape/features/:id/ship ─────────────────────────────────────────────────────────────────
const { shipWorld, cleanup: shipCleanup } = shipKit({ nextId, outlineOf });
after(shipCleanup);
const ship = (id, mode) => post(`/api/shape/features/${id}/ship`, { mode });
const shipT = (name, fn) => test(name, () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try { await fn(); } finally { gitInfo.reset(); }
}));

shipT('Ship as: a bad mode is 400, a feature not yet done is 409, an unknown one 404', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  assert.equal((await ship(w.f.id, 'both')).status, 400);
  assert.equal((await ship('feat_missing', 'one')).status, 404);
  const half = mk(2, 'done');
  assert.equal((await ship(half.id, 'one')).status, 409);
});

shipT('s5: a live round of run 3 holds Ship back with a 409 naming it', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  seedPipelineRow({ id: 'rnd5s003', status: 'running', branch: { source: w.last, sameAsSource: true, roundOf: { pipelineId: w.pids[2], round: 2, request: 'blue' } } });
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'a round of run 3 is still going');
  assert.equal(ghCalls(seen, 'create').length, 0);
});

shipT('stacked: CHANGELOG.md on the last slice\'s branch, pushed, gh pr ready ×3 in order; the feature reads stacked', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(ghCalls(seen, 'ready').map((a) => a[3]), [1, 2, 3].map((n) => `https://github.com/me/repo/pull/${n}`));
  assert.match(git(w.dir, 'show', `${w.last}:CHANGELOG.md`), /## Unreleased\n\n### Charts\n\n- Slice 1\n- Slice 2\n- Slice 3/);
  assert.ok(seen.some((a) => a[0] === 'git' && a[1] === 'push' && a.includes(w.last)));
  assert.equal((await view(w.f.id)).ship.mode, 'stacked');
  assert.equal((await ship(w.f.id, 'stacked')).status, 409, 'a second ship');
});

shipT('one PR: gh pr create on the chain root (no draft, no "Part of"), then the three drafts closed with a comment', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  const c = ghCalls(seen, 'create');
  assert.equal(c.length, 1);
  assert.equal(argOf(c[0], '--base'), 'main');
  assert.ok(!c[0].includes('--draft'));
  const body = argOf(c[0], '--body');
  assert.ok(!body.startsWith('Part of'));
  assert.equal(body.match(/^## Slice \d/gm).length, 3);
  const closes = ghCalls(seen, 'close');
  assert.equal(closes.length, 3);
  for (const x of closes) assert.equal(argOf(x, '--comment'), 'Shipped as one pull request: https://github.com/me/repo/pull/9');
  const { readPrState } = await import('../src/core/artifacts.mjs');
  // The one PR is every slice's PR (as a chain shipped as One): the group reads In review · 1 PR, not Ready to ship.
  for (const pid of w.pids) assert.deepEqual([readPrState(pid).url, readPrState(pid).state], ['https://github.com/me/repo/pull/9', 'OPEN'], pid);
  const v = await view(w.f.id);
  assert.deepEqual([v.ship.mode, v.ship.prUrl], ['one', 'https://github.com/me/repo/pull/9']);
  assert.equal(v.ship.result.closed, 3, 'slice 3\'s draft counts though its row now holds the one PR');
});

shipT('one PR when gh reports the last slice\'s draft already exists: it is made ready and edited, only two closes', async () => {
  const seen = []; stubShip(seen, { create: () => failRun('a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/me/repo/pull/3') });
  const w = shipWorld();
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(ghCalls(seen, 'ready').map((a) => a[3]), ['https://github.com/me/repo/pull/3']);
  assert.ok(ghCalls(seen, 'edit').some((a) => a[3] === 'https://github.com/me/repo/pull/3'));
  assert.deepEqual(ghCalls(seen, 'close').map((a) => a[3]), ['https://github.com/me/repo/pull/1', 'https://github.com/me/repo/pull/2']);
  assert.equal((await view(w.f.id)).ship.result.closed, 2);
});

shipT('stacked with no slice PRs: each slice gets a ready PR on its stacked base in merge order, then 3 gh pr ready', async () => {
  let n = 0;
  const seen = []; stubShip(seen, { create: () => okRun(`https://github.com/me/repo/pull/${++n}\n`) });
  const w = shipWorld({ prs: false });
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const c = ghCalls(seen, 'create');
  assert.deepEqual(c.map((a) => argOf(a, '--base')), ['main', `feat/${w.pids[0]}`, `feat/${w.pids[1]}`]);
  assert.ok(c.every((a) => !a.includes('--draft')));
  assert.deepEqual(ghCalls(seen, 'ready').map((a) => a[3]), [1, 2, 3].map((k) => `https://github.com/me/repo/pull/${k}`));
});

shipT('One with no slice PRs: 1 PR into the chain root, nothing closed', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld({ prs: false });
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  const c = ghCalls(seen, 'create');
  assert.equal(c.length, 1);
  assert.equal(argOf(c[0], '--base'), 'main');
  assert.equal(ghCalls(seen, 'close').length, 0);
});

shipT('in-flight drafts still ship stacked: 0 creates, 3 gh pr ready in slice order', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();                                   // each slice's PR recorded as its draft (recordSliceDraft)
  assert.ok((await view(w.f.id)).slices.every((s) => s.pr && s.pr.draft === true), 'every slice reads as a draft');
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(ghCalls(seen, 'create').length, 0);
  assert.deepEqual(ghCalls(seen, 'ready').map((a) => a[3]), [1, 2, 3].map((k) => `https://github.com/me/repo/pull/${k}`));
});

shipT('after a ship the slices\' stored PRs read ready, not draft, and pipelines-changed reloads the pages (one ship flow)', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  for (const pid of w.pids) getDb().prepare('UPDATE pipelines SET pr_verdict = ? WHERE id = ?').run(JSON.stringify({ draft: true, mergeable: 'MERGEABLE' }), pid);
  const ws = await collector();
  try {
    const r = await ship(w.f.id, 'stacked');
    assert.equal(r.status, 200, await r.clone().text());
    const { readPrState } = await import('../src/core/artifacts.mjs');
    for (const pid of w.pids) assert.deepEqual([readPrState(pid).draft, readPrState(pid).mergeable], [false, 'MERGEABLE'], pid);
    const t0 = Date.now();
    while (!ws.frames('pipelines-changed').length && Date.now() - t0 < 3000) await sleep(10);
    assert.ok(ws.frames('pipelines-changed').length, 'the Runs list and the group page reload History and run groups');
  } finally { ws.close(); }
});

shipT('One over legacy drafts: the group of the feature reads In review · 1 PR, not Ready to ship', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  for (const pid of w.pids) getDb().prepare('UPDATE pipelines SET pr_verdict = ? WHERE id = ?').run(JSON.stringify({ draft: true }), pid);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  const { listRunGroups } = await import('../src/core/run-groups.mjs');
  const { groupModel } = await import('../src/shared/run-model.mjs');
  const g = listRunGroups().find((x) => x.id === w.f.id);
  const m = groupModel({ kind: 'feature', title: g.title, members: g.members.map((x) => ({ status: x.status, pr: x.pr })) });
  assert.deepEqual([m.state, m.line, m.prCount], ['in-review', 'In review · 1 PR', 1]);
});

shipT('One refuses a ready slice PR (409), closing and creating nothing', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld({ drafts: false });                  // ready slice PRs, as openMemberPr leaves them
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /already has a PR/);
  assert.equal(ghCalls(seen, 'close').length, 0);
  assert.equal(ghCalls(seen, 'create').length, 0);
});

shipT('a stacked failure mid-loop says how to continue; run 1\'s PR stays and a retry makes the other 2', async () => {
  let n = 0;
  const seen = []; stubShip(seen, { create: () => (++n === 2 ? failRun('boom') : okRun(`https://github.com/me/repo/pull/${n}\n`)) });
  const w = shipWorld({ prs: false });
  const r = await ship(w.f.id, 'stacked');
  assert.ok(r.status >= 409, String(r.status));
  const j = await r.json();
  assert.match(j.error, /run 2's PR.*Create PR again to continue/);
  assert.deepEqual(j.prs, ['https://github.com/me/repo/pull/1']);
  const { readPrState } = await import('../src/core/artifacts.mjs');
  assert.equal(readPrState(w.pids[0]).url, 'https://github.com/me/repo/pull/1');
  const before = ghCalls(seen, 'create').length;
  const ok = await ship(w.f.id, 'stacked');
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal(ghCalls(seen, 'create').length - before, 2);
});

shipT('a ship whose PRs were all closed unmerged ships again: stacked opens a new PR per run', async () => {
  let n = 10;
  const seen = []; stubShip(seen, { create: () => okRun(`https://github.com/me/repo/pull/${++n}\n`) });
  const w = shipWorld({ drafts: false });
  const { recordShip } = await import('../src/core/shape/features.mjs');
  recordShip(w.f.id, { mode: 'stacked', release: { version: 'v1.2.0', target: 'main' } });
  assert.equal((await ship(w.f.id, 'stacked')).status, 409, 'its PRs are still open');
  getDb().prepare("UPDATE pipelines SET pr_state = 'CLOSED' WHERE id IN (?, ?, ?)").run(...w.pids);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(ghCalls(seen, 'create').length, 3, 'a new PR for every run');
  const { readPrState } = await import('../src/core/artifacts.mjs');
  assert.deepEqual(w.pids.map((p) => [readPrState(p).url, readPrState(p).state]),
    [11, 12, 13].map((k) => [`https://github.com/me/repo/pull/${k}`, 'OPEN']));
  const row = getDb().prepare('SELECT ship_mode, release_version FROM shape_features WHERE id = ?').get(w.f.id);
  assert.deepEqual({ ...row }, { ship_mode: 'stacked', release_version: null }, 'the old release is not carried over');
  assert.equal((await ship(w.f.id, 'one')).status, 409, 'shipped again');
});

shipT('watch: true turns Watch on for each slice PR', async () => {
  let n = 0;
  const seen = []; stubShip(seen, { create: () => okRun(`https://github.com/me/repo/pull/${++n}\n`) });
  const w = shipWorld({ prs: false });
  const r = await post(`/api/shape/features/${w.f.id}/ship`, { mode: 'stacked', watch: true });
  assert.equal(r.status, 200, await r.clone().text());
  const { getWatch } = await import('../src/core/pr-watch.mjs');
  const rows = [1, 2, 3].map((k) => getWatch(`https://github.com/me/repo/pull/${k}`));
  assert.deepEqual(rows.map((x) => [x && x.enabled, x && x.pipelineId]), w.pids.map((pid) => [true, pid]));
  assert.equal((await post(`/api/shape/features/${w.f.id}/ship`, { mode: 'stacked', watch: 'yes' })).status, 400);
});

shipT('a failed ready then a retry: CHANGELOG.md keeps one ### Charts entry; two concurrent ships: one wins', async () => {
  const seen = [];
  let failing = true;
  stubShip(seen, { ready: () => (failing ? failRun('nope') : okRun('')) });
  const w = shipWorld();
  assert.equal((await ship(w.f.id, 'stacked')).status, 500);
  failing = false;
  assert.equal((await ship(w.f.id, 'stacked')).status, 200);
  assert.equal(git(w.dir, 'show', `${w.last}:CHANGELOG.md`).match(/^### Charts$/gm).length, 1);
  const w2 = shipWorld();
  const [a, b] = await Promise.all([ship(w2.f.id, 'one'), ship(w2.f.id, 'one')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

// ── Shaper s2: the Chat feature card route, the slice route's thread ─────────────
const fire = (featureId, idx, pid) => getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?")
  .run(pid, getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(featureId, idx).ticket_id);

test('GET /api/shape/pipelines/:pid/card: 404 for an unknown or plain run; a shaped run\'s log; the feature with its ask', async () => {
  assert.equal((await get('/api/shape/pipelines/p-nope-zz/card')).status, 404);
  const plain = pipe('running');
  const ePlain = liveEntry(plain);                                   // orch.state.shaping = {} is truthy: give it none
  ePlain.orch.state = {};
  assert.equal((await get(`/api/shape/pipelines/${plain}/card`)).status, 404, 'a plain run is no feature card');
  dropEntry(ePlain);
  const shapedPid = pipe('running');
  const eShaped = liveEntry(shapedPid);                              // shaping: {} (live, outline not yet approved)
  const s = await get(`/api/shape/pipelines/${shapedPid}/card`);
  assert.equal(s.status, 200);
  assert.deepEqual(await s.json(), { pipelineId: shapedPid, feature: null, log: [] });
  dropEntry(eShaped);
  const { id: fid, pid: p1 } = mk(3, 'done');
  const p2 = pipe('running');
  fire(fid, 2, p2);
  const e2 = liveEntry(p2, { pending: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } });
  try {
    const r = await get(`/api/shape/pipelines/${p1}/card`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.pipelineId, p1);
    assert.deepEqual(body.feature.ask, { index: 2, runId: e2.id, pipelineId: p2, id: 'plan-n_refine-1', kind: 'plan' });
  } finally {
    dropEntry(e2);
    getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?)").run(fid);
  }
});

test('GET /api/shape/pipelines/:pid/slice carries the feature thread', async () => {
  const { id: fid, pid: p1 } = mk(2, 'done');
  const p2 = pipe('running');
  fire(fid, 2, p2);
  const thread = createThread({ title: 'charts' });
  askLinkRun(thread.id, { runId: 'run-x', pipelineId: p1, cardId: 'card_x' });
  try {
    const info = await (await get(`/api/shape/pipelines/${p2}/slice`)).json();
    assert.equal(info.threadId, thread.id);
  } finally {
    getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?)").run(fid);
  }
});

test('re-plan from the card: the re-plan run\'s Split ask is the feature\'s ask, and the old URL still resolves', async () => {
  const f = mk(3, 'stopped');
  const r = await post(`/api/shape/features/${f.id}/replan`, {});
  assert.equal(r.status, 200);
  const { runId: ticketId } = await r.json();
  const rp = pipe('running');
  getDb().prepare('UPDATE scheduled_runs SET pipeline_id = ? WHERE id = ?').run(rp, ticketId);
  const e = liveEntry(rp, { pending: { id: 'q-split', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } } });
  try {
    const v = await view(f.id);
    assert.equal(v.status, 'replanning');
    assert.deepEqual(v.ask, { index: null, runId: e.id, pipelineId: rp, id: 'q-split', kind: 'outline' });
    assert.match(v.log.at(-1).text, /^Re-planning runs? /);
    const next = mk(2, 'running', { replaces: f.id });          // the re-plan's outline approved
    const viaOld = await get(`/api/shape/features/${f.id}`);
    assert.equal(viaOld.status, 200);
    const body = await viaOld.json();
    assert.equal(body.id, next.id);
    assert.equal(body.replanOf, f.id);
  } finally { dropEntry(e); }
});

// ── Shaper s4: the release on Ship as, the Ship card synced from the route, the release hints, POST /api/pr's release ──
shipT('Ship as with a bad release is 400; a ship from the route flips the thread\'s Ship card to applied and stores the release', async () => {
  const seen = []; stubShip(seen, { describe: 'v1.11.0' });
  const w = shipWorld();
  const thread = createThread({ title: 'charts' });
  askLinkRun(thread.id, { runId: 'run-s4', pipelineId: w.pids[0], cardId: 'card_s4' });
  await testing.offerShipCard(w.pids[2]);
  const card = () => listMessages(thread.id).flatMap((m) => m.blocks || []).find((b) => b.card && b.card.type === 'ship');
  assert.equal(card().state, 'proposed');
  assert.equal(card().card.release.version, 'v1.12.0');
  assert.equal((await post(`/api/shape/features/${w.f.id}/ship`, { mode: 'one', release: { version: 'bad' } })).status, 400);
  assert.equal(ghCalls(seen, 'create').length, 0);
  const r = await post(`/api/shape/features/${w.f.id}/ship`, { mode: 'one', release: { version: 'v1.12.0' } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(card().state, 'applied');
  assert.deepEqual({ mode: card().card.result.mode, prUrl: card().card.result.prUrl, release: card().card.result.release },
    { mode: 'one', prUrl: 'https://github.com/me/repo/pull/9', release: { version: 'v1.12.0', url: null, error: null } });
  const row = getDb().prepare('SELECT release_version, release_target FROM shape_features WHERE id = ?').get(w.f.id);
  assert.deepEqual({ ...row }, { release_version: 'v1.12.0', release_target: 'main' });
});

shipT('GET /api/shape/features/:id on a ready feature carries the release hint from the last tag', async () => {
  const seen = []; stubShip(seen, { describe: 'v1.11.0' });
  const w = shipWorld();
  const v = await view(w.f.id);
  assert.equal(v.ship.ready, true);
  assert.equal(v.ship.hint.version, 'v1.12.0');
  assert.equal(v.ship.hint.from, 'tag');
  assert.ok(seen.some((a) => a[0] === 'git' && a[1] === 'describe' && a.includes('--tags')));
});

shipT('GET /api/pr/remotes carries the release hint; POST /api/pr with a release stores it on the run, with memberKey it is 400', async () => {
  const seen = []; stubShip(seen, { describe: 'v1.11.0', create: () => okRun('https://github.com/me/repo/pull/12\n') });
  const w = shipWorld({ prs: false });
  const pk = projectKey(w.dir);
  const rm = await (await get(`/api/pr/remotes?id=${w.pids[0]}&projectKey=${pk}`)).json();
  assert.equal(rm.release?.version, 'v1.12.0', JSON.stringify(rm));
  const bad = await post('/api/pr', { id: w.pids[0], projectKey: pk, release: { version: 'nope' } });
  assert.equal(bad.status, 400);
  const member = await post('/api/pr', { id: w.pids[0], projectKey: pk, memberKey: 'other', release: { version: 'v1.12.0' } });
  assert.equal(member.status, 400);
  assert.equal((await member.json()).error, 'a release is for a single-project run');
  assert.equal(ghCalls(seen, 'create').length, 0, 'refused before anything is pushed');
  const r = await post('/api/pr', { id: w.pids[0], projectKey: pk, release: { version: 'v1.12.0' } });
  assert.equal(r.status, 200, await r.clone().text());
  const row = getDb().prepare('SELECT release_version, release_target FROM pipelines WHERE id = ?').get(w.pids[0]);
  assert.deepEqual({ ...row }, { release_version: 'v1.12.0', release_target: 'main' });
});

const reqOutlineOf = (n) => ({ ...outlineOf(n), agreed: [{ id: 'R-po-1', text: 'a' }, { id: 'R-ux-1', text: 'b' }], leftOut: [],
  slices: outlineOf(n).slices.map((s, i) => ({ ...s, requirements: i === 0 ? ['R-po-1', 'R-ux-1'] : [] })) });
const { shipWorld: reqShipWorld, cleanup: reqShipCleanup } = shipKit({ nextId, outlineOf: reqOutlineOf });
after(reqShipCleanup);

shipT('refresh keeps one Satisfies line', async () => {
  const seen = [];
  const old = 'Part of Charts: slice 1 of 3\nSatisfies: R-po-1, R-ux-1\n\n- Slice 2, Slice 2: not opened yet\n- Slice 3, Slice 3: not opened yet\n\nWhat changed.';
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
    if (cmd === 'git' && args[0] === 'describe') return failRun('fatal: No names found');
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('body')) return okRun(old);
    return okRun('');
  });
  const w = reqShipWorld();
  assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }, { id: 'R-ux-1', mark: 'met' }])).status, 200);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  const edit = ghCalls(seen, 'edit').find((a) => a[3] === 'https://github.com/me/repo/pull/1');
  assert.ok(edit, 'slice 1\'s body was refreshed');
  const body = argOf(edit, '--body');
  assert.equal(body.match(/^Satisfies: /gm).length, 1, body);
  assert.match(body, /^Part of Charts: slice 1 of 3\nSatisfies: R-po-1, R-ux-1\n\n- Slice 2, Slice 2: https:\/\/github\.com\/me\/repo\/pull\/2\n- Slice 3, Slice 3: https:\/\/github\.com\/me\/repo\/pull\/3\n\nWhat changed\.$/);
});

// ── Shaper requirements s3 (D8, D9): the acceptance ledger gates the ship ─────────────────────────────────────────
const reqShipT = (name, fn, env = NO_ADO) => test(name, () => withEnvVars(env, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try { await fn(); } finally { gitInfo.reset(); }
}));
const AGREED2 = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-ops-1', text: 'It rolls back' }];
const withAgreed = (fid) => {
  const row = getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid);
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.outline), agreed: AGREED2 }), fid);
};
const putMarks = (id, entries) => fetch(`${base}/api/shape/features/${id}/acceptance`, { method: 'PUT', headers: JSONH, body: JSON.stringify({ entries }) });
const storedMarks = (fid) => JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fid).outline).acceptance;
const sideEffects = (seen) => seen.filter((a) => (a[0] === 'gh' && a[1] === 'pr' && ['create', 'ready', 'close', 'edit'].includes(a[2]))
  || (a[0] === 'git' && ['push', 'commit', 'commit-tree', 'update-ref'].includes(a[1])));
const ALL_MARKED = [{ id: 'R-po-1', mark: 'met' }, { id: 'R-ops-1', mark: 'dropped', reason: 'later' }];

reqShipT('ship refuses 409 ACCEPTANCE_INCOMPLETE before any PR, changelog or push, in one and stacked mode', async () => {
  for (const [mode, opts] of [['one', {}], ['stacked', { prs: false }]]) {
    const seen = []; stubShip(seen);
    const w = shipWorld(opts);
    withAgreed(w.f.id);
    assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }])).status, 200);
    const r = await ship(w.f.id, mode);
    assert.equal(r.status, 409, mode);
    const body = await r.json();
    assert.deepEqual([body.code, body.missing], ['ACCEPTANCE_INCOMPLETE', ['R-ops-1']], mode);
    assert.deepEqual(sideEffects(seen), [], `${mode}: no side effect`);
    assert.throws(() => git(w.dir, 'show', `${w.last}:CHANGELOG.md`), /CHANGELOG/, `${mode}: no changelog commit`);
  }
});

reqShipT('PUT acceptance: 400 ACCEPTANCE_INVALID stores nothing; 200 stores the marks; then ship goes through', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  withAgreed(w.f.id);
  assert.equal((await putMarks('feat_missing', [])).status, 404);
  assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }])).status, 200);
  const bad = await putMarks(w.f.id, [{ id: 'R-ops-1', mark: 'not-met', target: ' ' }]);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'R-ops-1: not met needs where it moved', code: 'ACCEPTANCE_INVALID' });
  assert.deepEqual(storedMarks(w.f.id), [{ id: 'R-po-1', mark: 'met' }], 'the refused save stored nothing');
  const ok = await putMarks(w.f.id, ALL_MARKED);
  assert.equal(ok.status, 200);
  assert.deepEqual([(await ok.json()).acceptance.ready], [true]);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await putMarks(w.f.id, ALL_MARKED)).status, 409, 'after ship');
});

reqShipT('PUT acceptance merges per id: a save from a card with stale marks never reverts another card\'s mark', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  withAgreed(w.f.id);
  assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }])).status, 200);
  assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'dropped', reason: 'later' }])).status, 200, 'the chat card');
  const r = await putMarks(w.f.id, [{ id: 'R-ops-1', mark: 'met' }]);   // the feature page, still showing R-po-1 met
  assert.equal(r.status, 200);
  const want = [{ id: 'R-po-1', mark: 'dropped', reason: 'later' }, { id: 'R-ops-1', mark: 'met' }];
  assert.deepEqual([storedMarks(w.f.id), (await r.json()).acceptance.entries], [want, want]);
});

reqShipT('PUT acceptance while the feature is shipping answers 409', async () => {
  let release; const held = new Promise((r) => { release = r; });
  let entered; const inCreate = new Promise((r) => { entered = r; });
  const seen = []; stubShip(seen, { create: async () => { entered(); await held; return okRun('https://github.com/me/repo/pull/9\n'); } });
  const w = shipWorld({ prs: false });
  withAgreed(w.f.id);
  await putMarks(w.f.id, ALL_MARKED);
  const shipping = ship(w.f.id, 'stacked');
  await inCreate;
  const r = await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }]);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'this feature is already shipping');
  release();
  await (await shipping).text();
  assert.deepEqual(storedMarks(w.f.id), ALL_MARKED);
});

reqShipT('the chat Ship card carries the ledger: offered unmarked, updated by each PUT, and final once shipped', async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  withAgreed(w.f.id);
  const thread = createThread({ title: 'charts' });
  askLinkRun(thread.id, { runId: 'run-s3-ledger', pipelineId: w.pids[0], cardId: 'card_s3_ledger' });
  await testing.offerShipCard(w.pids[2]);
  const card = () => listMessages(thread.id).flatMap((m) => m.blocks || []).find((b) => b.card && b.card.type === 'ship');
  assert.deepEqual([card().card.acceptance.agreed.map((a) => a.id), card().card.acceptance.entries], [['R-po-1', 'R-ops-1'], []]);
  assert.equal((await view(w.f.id)).ship.acceptance.total, 2, 'the feature page gets the ledger with the flag on');
  assert.equal((await putMarks(w.f.id, ALL_MARKED)).status, 200);
  assert.deepEqual([card().state, card().card.acceptance.entries, card().card.acceptance.ready], ['proposed', ALL_MARKED, true]);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual([card().state, card().card.acceptance.entries], ['applied', ALL_MARKED]);
});

// ── PR when a run finishes (src/core/pr-auto-finish.mjs): the generalised PR paths ───────────────────────────────
test('openMemberPr draft: gh --draft and recordSliceDraft; a draft refused → ready and no recordSliceDraft', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const { f, p1, p2 } = stackedFeature();
    const seen = [];
    stubGh(seen);
    const r1 = await testing.openMemberPr(p1, { draft: true });
    assert.equal(r1.ok, true);
    assert.ok(creates(seen)[0].includes('--draft'));
    assert.equal(draftOf(f.id, 1), 'https://github.com/me/repo/pull/7');
    assert.equal((await view(f.id)).slices[0].pr.draft, true, 'the feature page reads the slice as a draft');
    const seen2 = []; const fell = [];
    stubGh(seen2, { create: (args) => (args.includes('--draft') ? failRun('Draft pull requests are not supported here') : okRun('https://github.com/me/repo/pull/8\n')) });
    const r2 = await testing.openMemberPr(p2, { draft: true, onDraftFallback: (e) => fell.push(e) });
    assert.deepEqual([r2.ok, r2.fellBack], [true, true]);
    assert.deepEqual(creates(seen2).map((a) => a.includes('--draft')), [true, false]);
    assert.equal(fell.length, 1);
    assert.equal(draftOf(f.id, 2), null, 'a ready PR is not recorded as a draft');
  } finally { gitInfo.reset(); }
}));

shipT('shipFeatureNow draft: the one PR opens --draft and adoptOnePr does not mark it ready', async () => {
  const { shipFeatureNow } = await import('../ui/server.mjs');
  const seen = []; stubShip(seen);
  const w = shipWorld({ prs: false });
  const r = await shipFeatureNow(w.f.id, 'one', { draft: true, actor: 'ann@acme.test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(ghCalls(seen, 'create')[0].includes('--draft'));
  const seen2 = []; stubShip(seen2, { create: () => failRun('a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/me/repo/pull/3') });
  const w2 = shipWorld();
  const r2 = await shipFeatureNow(w2.f.id, 'one', { draft: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(ghCalls(seen2, 'ready').length, 0, 'the PR it found stays a draft');
  assert.ok(ghCalls(seen2, 'edit').some((a) => a[3] === 'https://github.com/me/repo/pull/3'), 'its body is refreshed');
});

shipT('shipFeatureNow base overrides the chain root', async () => {
  const { shipFeatureNow } = await import('../ui/server.mjs');
  const seen = []; stubShip(seen);
  const w = shipWorld({ prs: false });
  const r = await shipFeatureNow(w.f.id, 'one', { base: 'release/2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(argOf(ghCalls(seen, 'create')[0], '--base'), 'release/2');
});

// ── PR when a run finishes, through the real server wiring (afterRunSettled → the finisher → openMemberPr / shipFeatureNow) ──
const ANN = 'ann@acme.test';
const PR_SOURCE = JSON.stringify({ open: 'team', slices: 'team' });
const setFeaturePr = (fid, open, slices) => getDb().prepare('UPDATE shape_features SET pr_open = ?, pr_slices = ?, pr_source = ?, pr_outcome = NULL, created_by = ? WHERE id = ?').run(open, slices, PR_SOURCE, ANN, fid);
const setRunPr = (pid, open, slices) => getDb().prepare('UPDATE pipelines SET pr_auto = ? WHERE id = ?')
  .run(JSON.stringify({ open, slices, scope: 'project', featureId: 'x', source: { open: 'feature', slices: 'feature' } }), pid);
const runOutcome = async (pid) => (await import('../src/core/pr-auto.mjs')).readRunPrAuto(pid)?.outcome;
const featureOutcome = async (fid) => (await import('../src/core/pr-auto.mjs')).featurePrSetting(fid)?.outcome;
/** What afterRunSettled reads from a settled slice run: its state and the slice marker. */
const settled = (pid, dir, branch) => ({ runShape: { slice: { feature: 'f', index: 1 } },
  getState: () => ({ id: pid, status: 'done', startedBy: ANN, projectDir: dir, target: 'project', branch }) });
const rowBranch = (pid) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid).branch);

test('afterRunSettled each: a done slice opens its stacked draft PR (gh --draft, base = the previous slice branch)', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const { f, p1, p2 } = stackedFeature();
    setFeaturePr(f.id, 'draft', 'each'); setRunPr(p1, 'draft', 'each'); setRunPr(p2, 'draft', 'each');
    const seen = []; let n = 6;
    gitInfo.setRunner((cmd, args) => {
      seen.push([cmd, ...args]);
      if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
      if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
      if (cmd === 'git' && args[0] === 'rev-parse') return okRun('abc123\n');
      if (cmd === 'git' && args[0] === 'rev-list') return okRun('2\n');
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return okRun(`https://github.com/me/repo/pull/${++n}\n`);
      return okRun('');
    });
    await testing.afterRunSettled(settled(p1, project, rowBranch(p1)));
    await testing.afterRunSettled(settled(p2, project, rowBranch(p2)));
    const [c1, c2] = creates(seen);
    assert.ok(c1.includes('--draft') && c2.includes('--draft'));
    assert.deepEqual([argOf(c1, '--base'), argOf(c2, '--base')], ['main', `feat/${p1}`]);
    assert.deepEqual([(await runOutcome(p1)).status, (await runOutcome(p1)).draft, (await runOutcome(p1)).urls], ['opened', true, ['https://github.com/me/repo/pull/7']]);
    assert.equal((await runOutcome(p2)).status, 'opened');
    assert.equal(draftOf(f.id, 2), 'https://github.com/me/repo/pull/8');
  } finally { gitInfo.reset(); }
}));

shipT('afterRunSettled one: only the last done slice ships one draft PR into the chain root, with the CHANGELOG commit and recordShip', async () => {
  const { afterRunSettled } = testing;
  const seen = []; stubShip(seen);
  const w = shipWorld({ prs: false });
  setFeaturePr(w.f.id, 'draft', 'one');
  w.pids.forEach((p) => setRunPr(p, 'draft', 'one'));
  setPipe(w.pids[2], 'running');
  await afterRunSettled(settled(w.pids[0], w.dir, rowBranch(w.pids[0])));
  await afterRunSettled(settled(w.pids[1], w.dir, rowBranch(w.pids[1])));
  assert.equal(ghCalls(seen, 'create').length, 0, 'earlier slices open no PR');
  assert.equal((await runOutcome(w.pids[0])).status, 'waiting');
  assert.equal(await featureOutcome(w.f.id), null);
  setPipe(w.pids[2], 'done');
  await afterRunSettled(settled(w.pids[2], w.dir, rowBranch(w.pids[2])));
  const [create, ...more] = ghCalls(seen, 'create');
  assert.equal(more.length, 0);
  assert.ok(create.includes('--draft'));
  assert.equal(argOf(create, '--base'), 'main');
  assert.equal(argOf(create, '--head'), w.last);
  assert.match(git(w.dir, 'show', `${w.last}:CHANGELOG.md`), /Charts/);
  const o = await featureOutcome(w.f.id);
  assert.deepEqual([o.status, o.draft, o.final, o.urls], ['opened', true, true, ['https://github.com/me/repo/pull/9']]);
  const v = await view(w.f.id);
  assert.deepEqual([v.ship.mode, v.ship.prUrl], ['one', 'https://github.com/me/repo/pull/9']);
});

reqShipT('one: a held feature ships when the last requirement is marked over HTTP (PUT acceptance → onAcceptanceChanged)', async () => {
  const { afterRunSettled } = testing;
  const seen = []; stubShip(seen);
  const w = shipWorld({ prs: false });
  withAgreed(w.f.id);
  setFeaturePr(w.f.id, 'draft', 'one');
  w.pids.forEach((p) => setRunPr(p, 'draft', 'one'));
  assert.equal((await putMarks(w.f.id, [{ id: 'R-po-1', mark: 'met' }])).status, 200);
  for (const p of w.pids) await afterRunSettled(settled(p, w.dir, rowBranch(p)));
  assert.equal((await featureOutcome(w.f.id)).status, 'held');
  assert.equal(ghCalls(seen, 'create').length, 0);
  assert.equal((await putMarks(w.f.id, ALL_MARKED)).status, 200);
  for (let i = 0; i < 100 && (await featureOutcome(w.f.id)).status === 'held'; i++) await sleep(20);
  assert.equal((await featureOutcome(w.f.id)).status, 'opened');
  assert.equal(ghCalls(seen, 'create').length, 1);
  assert.equal((await view(w.f.id)).ship.mode, 'one');
});

// ── Shaper small runs A4: a finished feature's figures, recorded on settle and on an acceptance save ────────────────
const SMALL_ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const SMALL_OFF = { WORCA_FLAGS: undefined };
const figureRows = (fid) => getDb().prepare('SELECT figures FROM shape_feature_figures WHERE feature_id = ?').all(fid).map((r) => JSON.parse(r.figures));
const plainSettle = (pid) => ({ runShape: null, getState: () => ({ status: 'done', id: pid }) });

reqShipT('figures: the last slice settling done records 1 row, a round after Ship re-records it; the flag off records none', async () => {
  const seen = []; stubGh(seen);
  await withEnvVars(SMALL_ON, async () => {
    const a = stackedFeature();
    setPipe(a.p2, 'running');
    await testing.afterRunSettled(plainSettle(a.p1));
    assert.equal(figureRows(a.f.id).length, 0, 'slice 2 still running');
    setPipe(a.p2, 'done');
    await testing.afterRunSettled(plainSettle(a.p2));
    assert.deepEqual(figureRows(a.f.id).map((f) => f.changesAfterShip), [0]);
    recordShip(a.f.id, { mode: 'one', now: Date.now() - 3_600_000 });
    const r = nextId();
    seedPipelineRow({ id: r, projectKey: projectKey(project), status: 'done', title: r, startedAt: new Date().toISOString(),
      branch: { source: 'main', feature: `feat/${r}`, roundOf: { pipelineId: a.p1, round: 2 } } });
    await testing.afterRunSettled(plainSettle(r));
    assert.deepEqual(figureRows(a.f.id).map((f) => f.changesAfterShip), [1]);
  });
  await withEnvVars(SMALL_OFF, async () => {
    const b = stackedFeature();
    await testing.afterRunSettled(plainSettle(b.p1));
    await testing.afterRunSettled(plainSettle(b.p2));
    assert.equal(figureRows(b.f.id).length, 0);
  });
});

reqShipT('figures: PUT acceptance answers the same with the flag on and off; on, the stored requirementsMet follows the marks', async () => {
  const seen = []; stubGh(seen);
  const on = stackedFeature(); withAgreed(on.f.id);
  const off = stackedFeature(); withAgreed(off.f.id);
  const answer = async (env, fid, entries) => withEnvVars(env, async () => { const r = await putMarks(fid, entries); return { status: r.status, body: await r.json() }; });
  const marks = [{ id: 'R-po-1', mark: 'met' }];
  const a = await answer(SMALL_ON, on.f.id, marks);
  const b = await answer(SMALL_OFF, off.f.id, marks);
  assert.equal(a.status, 200);
  assert.deepEqual(a, b);
  assert.deepEqual(figureRows(on.f.id).map((f) => f.requirementsMet), [{ met: 1, total: 2 }]);
  await answer(SMALL_ON, on.f.id, [{ id: 'R-ops-1', mark: 'met' }]);
  assert.deepEqual(figureRows(on.f.id).map((f) => f.requirementsMet), [{ met: 2, total: 2 }]);
  assert.equal(figureRows(off.f.id).length, 0);
});

// ── Shaper small runs A5: runs start from the latest finished work ───────────────────────────────────────────────────
const sliceTicket = (fid, k) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(fid, k).ticket_id;
/** Slice k of a shipWorld has not run yet: its ticket waits again, with no pipeline. */
const unrun = (fid, k) => getDb().prepare("UPDATE scheduled_runs SET status = 'scheduled', pipeline_id = NULL WHERE id = ?").run(sliceTicket(fid, k));
/** Only `keep` may fire on the next tick: every other waiting ticket in this file is canceled. */
const quietBut = (...keep) => getDb().prepare(`UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'
  AND id NOT IN (${keep.map(() => '?').join(', ')})`).run(...keep);
const branchOf = (pid) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid)?.branch || 'null');
const tickUntil = async (pred) => { for (let i = 0; i < 100; i++) { await schedulerTick(); if (pred()) return; await sleep(20); } };
const isAncestor = (dir, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: dir }).status === 0;
/** The run a fired ticket became: wait for its worktree, read its head, then stop it. → { pid, branch, head } */
async function firedRun(ticketId, ms = 60000) {
  const t0 = Date.now();
  let pid = null; let branch = null; let head = null;
  while (Date.now() - t0 < ms) {
    pid = runs.get(ticketId)?.pipelineId || getTicket(ticketId)?.pipelineId || null;
    branch = pid ? branchOf(pid) : null;
    if (branch && branch.worktreeDir) break;
    await sleep(50);
  }
  if (branch && branch.worktreeDir) head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: branch.worktreeDir, encoding: 'utf8' }).stdout.trim();
  const e = runs.get(ticketId);
  if (e && !['done', 'stopped', 'error'].includes(String(e.status))) await post('/api/stop', { runId: ticketId });
  for (let i = 0; i < 400 && runs.get(ticketId) && !['done', 'stopped', 'error', 'paused', 'interrupted'].includes(String(runs.get(ticketId).status)); i++) await sleep(25);
  return { pid, branch, head };
}

test("small runs: schedulerTick starts slice 4 from slice 2's branch while slice 3 is stopped", () => withEnvVars(SMALL_ON, async () => {
  const w = shipWorld({ slices: 4, prs: false });
  setPipe(w.pids[2], 'stopped');
  unrun(w.f.id, 4);
  const t4 = sliceTicket(w.f.id, 4);
  quietBut(t4);
  await tickUntil(() => getTicket(t4).status !== 'scheduled');
  assert.equal(getTicket(t4).status, 'fired', getTicket(t4).failReason || '');
  const run = await firedRun(t4);
  assert.equal(run.branch.source, `feat/${w.pids[1]}`);
}));

test('small runs: a re-plan that carries requirements fires on the slice-requirements workflow', () => withEnvVars(SMALL_ON, async () => {
  const w = shipWorld({ slices: 3, prs: false });
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
  outline.agreed = [1, 2, 3].map((n) => ({ id: `R-po-${n}`, text: `Text ${n}` }));
  outline.slices.forEach((s, i) => { s.requirements = [`R-po-${i + 1}`]; });
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outline), w.f.id);
  unrun(w.f.id, 3);
  const r = await post(`/api/shape/features/${w.f.id}/replan`, {});
  const { runId } = await r.json();
  assert.equal(r.status, 200);
  const stored = getTicket(runId, { withRequest: true }).request;
  assert.equal(stored.workflowId, 'wf_shape_slice_req');
  assert.match(stored.prompt, /^- \*\*R-po-3\*\* Text 3$/m);
  assert.doesNotMatch(stored.prompt, /^- \*\*R-po-[12]\*\*/m);
  quietBut(runId);
  await tickUntil(() => getTicket(runId).status !== 'scheduled');
  assert.equal(getTicket(runId).status, 'fired', getTicket(runId).failReason || '');
  const orch = runs.get(runId).orch;
  assert.deepEqual([orch.workflowId, orch.runShape.replaces, orch.runShape.slices], ['wf_shape_slice_req', w.f.id, 'auto']);
  const run = await firedRun(runId);
  assert.equal(run.branch.source, `feat/${w.pids[1]}`);
}));

test('small runs, stop 3 of 5: runs 4 and 5 finish, Resume on the feature restarts run 3 from run 5\'s branch', () => withEnvVars(SMALL_ON, async () => {
  const w = shipWorld({ slices: 5, prs: false });
  setPipe(w.pids[2], 'stopped');
  const res = await post(`/api/shape/features/${w.f.id}/resume`, {});
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.action, 'restart');
  quietBut(body.ticketId);
  await tickUntil(() => getTicket(body.ticketId).status !== 'scheduled');
  assert.equal(getTicket(body.ticketId).status, 'fired', getTicket(body.ticketId).failReason || '');
  const run = await firedRun(body.ticketId);
  assert.equal(run.branch.source, `feat/${w.pids[4]}`);
  assert.ok(run.head, 'the restarted run 3 has a checkout');
  assert.ok(isAncestor(w.dir, `feat/${w.pids[3]}`, run.head), "run 4's commits are in run 3's branch");
  assert.ok(isAncestor(w.dir, `feat/${w.pids[4]}`, run.head), "run 5's commits are in run 3's branch");
}));

test('small runs: Run now on a slice whose builds-on is unfinished is refused as still going', () => withEnvVars(SMALL_ON, async () => {
  const w = shipWorld({ slices: 3, prs: false });
  const f = getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id);
  const outline = JSON.parse(f.outline);
  outline.slices[2].dependsOn = ['s2'];
  getDb().prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outline), w.f.id);
  setPipe(w.pids[1], 'stopped');
  unrun(w.f.id, 3);
  const t3 = sliceTicket(w.f.id, 3);
  requestRunNow(t3);
  const out = await testing.fireTicket(getTicket(t3, { withRequest: true }));
  assert.deepEqual(out, { ok: false, error: 'the run before it is still going', transient: true });
  cancelTicket(t3);
}));

/** A marked 4-run world whose runs 2 and 3 each branch off run 1 (run 3 finished last, so run 4 would start from its
 *  branch) and run 4, not started, builds on both. `clash`: both change the same line of src/a.mjs (a fixture file of the
 *  temp repo); else each adds its own file. → { w, t4, two, three } (two/three = the branch names) */
function siblingDepsWorld({ clash }) {
  const w = shipWorld({ slices: 4, prs: false });
  const [p1, p2, p3] = w.pids;
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), p1);
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
  outline.slices[3].dependsOn = ['s2', 's3'];
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outline), w.f.id);
  const commit = (file, text) => { writeFileSync(join(w.dir, file), text); git(w.dir, 'add', '-A'); git(w.dir, 'commit', '-qm', file); };
  git(w.dir, 'checkout', '-q', `feat/${p1}`);
  mkdirSync(join(w.dir, 'src'), { recursive: true });
  commit('src/a.mjs', "export const a = 'one';\n");
  for (const [pid, n] of [[p2, 2], [p3, 3]]) {
    git(w.dir, 'checkout', '-q', '-B', `feat/${pid}`, `feat/${p1}`);
    commit(clash ? 'src/a.mjs' : `sibling${n}.txt`, `export const a = '${n}';\n`);
  }
  git(w.dir, 'checkout', '-q', 'main');
  w.pids.slice(0, 3).forEach((pid, i) => db.prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ source: i ? `feat/${p1}` : 'main', feature: `feat/${pid}` }), `2026-01-0${i + 1}T00:00:00.000Z`, pid));
  unrun(w.f.id, 4);
  const t4 = sliceTicket(w.f.id, 4);
  quietBut(t4);
  return { w, t4, two: `feat/${p2}`, three: `feat/${p3}` };
}

test('small runs: the run started for slice 4 holds the work of both runs it builds on, not only the latest one', () => withEnvVars(SMALL_ON, async () => {
  const { w, t4, two, three } = siblingDepsWorld({ clash: false });
  const heads = [two, three].map((b) => git(w.dir, 'rev-parse', b));
  await tickUntil(() => getTicket(t4).status !== 'scheduled');
  assert.equal(getTicket(t4).status, 'fired', getTicket(t4).failReason || '');
  const run = await firedRun(t4);
  assert.equal(run.branch.source, three, 'the recorded source is still the latest finished run\'s branch');
  assert.ok(run.head, 'run 4 has a checkout');
  assert.ok(isAncestor(w.dir, heads[1], run.head), "run 3's commits are in run 4's branch");
  assert.ok(isAncestor(w.dir, heads[0], run.head), "run 2's commits are in run 4's branch");
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(run.pid).map((r) => r.text);
  assert.ok(audit.some((t) => t.startsWith(`Combined the work of run 2 (\`${two}\`) into `) && t.endsWith(' before the first agent.')),
    audit.join('\n'));
}));

test('E1 small runs: slice 4 is held while runs 2 and 3 clash; Start now answers 409 DEPENDENCY_CLASH until it is settled', () => withEnvVars(SMALL_ON, async () => {
  const { w, t4, two, three } = siblingDepsWorld({ clash: true });
  const reason = 'runs 2 and 3 clash in src/a.mjs';
  const refs = git(w.dir, 'for-each-ref');
  const start = () => post(`/api/shape/features/${w.f.id}/start`, {});
  try {
    await tickUntil(() => featureView(w.f.id).held || getTicket(t4).status !== 'scheduled');
    assert.equal(getTicket(t4).status, 'scheduled', 'run 4 did not start');
    assert.equal(getTicket(t4).pipelineId, null);
    assert.equal(getTicket(t4).failReason, null);
    const v = await view(w.f.id);
    assert.equal(v.approveEach, false);
    assert.deepEqual(v.held, { index: 4, ticketId: t4, reason });
    // Start now with the clash unsettled: refused with the reason, and nothing starts.
    const refused = await start();
    assert.deepEqual([refused.status, await refused.json()], [409, { error: reason, code: 'DEPENDENCY_CLASH' }]);
    assert.deepEqual([getTicket(t4).status, getTicket(t4).forced, getTicket(t4).attempts], ['scheduled', false, 0]);
    assert.equal(runs.get(t4), undefined);
    assert.equal(git(w.dir, 'for-each-ref'), refs, 'no ref was written or moved');
    assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: w.dir }).status === 0, false, 'no merge in progress');
    assert.equal((await view(w.f.id)).held?.reason, reason, 'still held');
    // The owner settles the clash on run 3's branch, without pushing.
    git(w.dir, 'checkout', '-q', three);
    spawnSync('git', ['merge', '--no-edit', two], { cwd: w.dir });
    writeFileSync(join(w.dir, 'src', 'a.mjs'), "export const a = 'settled';\n");
    git(w.dir, 'add', '-A'); git(w.dir, 'commit', '-q', '--no-edit');
    git(w.dir, 'checkout', '-q', 'main');
    const heads = [two, three].map((b) => git(w.dir, 'rev-parse', b));
    const res = await start();
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'fired', body.failReason || '');
    const run = await firedRun(t4);
    assert.ok(run.head, 'run 4 has a checkout');
    assert.ok(isAncestor(w.dir, heads[0], run.head), "run 2's commits are in run 4's branch");
    assert.ok(isAncestor(w.dir, heads[1], run.head), "run 3's commits are in run 4's branch");
    assert.equal((await view(w.f.id)).held, null);
  } finally {
    if (runs.get(t4) && !['done', 'stopped', 'error'].includes(String(runs.get(t4).status))) await firedRun(t4);
  }
}));

/** `git` with `input` on stdin (hash-object, mktree). */
const gitIn = (cwd, input, ...args) => {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/** Commit `file` on `branch` with no checkout. → the new commit */
function commitOnRef(dir, branch, file, text) {
  const parent = git(dir, 'rev-parse', `refs/heads/${branch}`);
  const blob = gitIn(dir, text, 'hash-object', '-w', '--stdin');
  const tree = gitIn(dir, `${git(dir, 'ls-tree', parent)}\n100644 blob ${blob}\t${file}\n`, 'mktree');
  const commit = git(dir, 'commit-tree', tree, '-p', parent, '-m', file);
  git(dir, 'update-ref', `refs/heads/${branch}`, commit, parent);
  return commit;
}
/** The runs-map entry of fired ticket `id`, once its launch settled. */
async function settledRun(id, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !runs.get(id)?.settled) await sleep(25);
  assert.ok(runs.get(id)?.settled, `the run of ticket ${id} settled`);
  return runs.get(id);
}
const attemptRow = (pid) => getDb().prepare('SELECT status, archived_at FROM pipelines WHERE id = ?').get(pid);
const runErrorNotices = (ticketId) => listNotifications().filter((n) => n.ticketId === ticketId && n.kind === 'run_error');
/** Leave no seam, no live run and no waiting ticket of `t4` behind. */
async function releaseSetupWorld(t4) {
  testing.setCombineGateDeps?.(null);
  if (runs.get(t4) && !['done', 'stopped', 'error'].includes(String(runs.get(t4).status))) await firedRun(t4);
  if (getTicket(t4)?.status === 'scheduled') cancelTicket(t4);
}

test("E2 (R-qa-2) small runs: run 4's built-on branch moves after the clash check and clashes at setup; run 4 is held with Start now, not failed", () => withEnvVars(SMALL_ON, async () => {
  const { w, t4, two, three } = siblingDepsWorld({ clash: false });
  const reason = 'runs 2 and 3 clash in sibling3.txt';
  const [twoBefore, threeBefore] = [two, three].map((b) => git(w.dir, 'rev-parse', b));
  const start = () => post(`/api/shape/features/${w.f.id}/start`, {});
  const verdicts = [];
  let moved = null;
  try {
    testing.setCombineGateDeps({ checkCombine: async (dir, opts) => {
      const v = await checkCombine(dir, opts);
      verdicts.push(v.status);
      // Run 2 moves right after the fire-time check: it now adds sibling3.txt too, with other content than run 3's.
      if (!moved) moved = commitOnRef(w.dir, two, 'sibling3.txt', "export const a = 'moved';\n");
      return v;
    } });
    await tickUntil(() => runs.get(t4));
    const attempt = await settledRun(t4);
    assert.equal(verdicts[0], 'clean', 'the fire-time check found the combine clean');
    const pid = attempt.pipelineId;
    const branch = attempt.orch.state?.branch?.feature || branchOf(pid)?.feature;
    // 1. The same ticket waits again: not failed.
    const ticket = getTicket(t4);
    assert.deepEqual({ status: ticket.status, pipelineId: ticket.pipelineId, forced: ticket.forced, failReason: ticket.failReason },
      { status: 'scheduled', pipelineId: null, forced: false, failReason: null });
    // 2, 3. The feature holds on the clash.
    assert.deepEqual(featureView(w.f.id).held, { index: 4, ticketId: t4, reason });
    assert.equal(featureView(w.f.id).slices.find((s) => s.index === 4).state, 'held');
    // 4. No failed-run notice.
    assert.deepEqual(runErrorNotices(t4), []);
    // 5. The attempt is archived and its empty branch is gone.
    for (let i = 0; i < 200 && !attemptRow(pid).archived_at; i++) await sleep(25);
    assert.ok(attemptRow(pid).archived_at, 'the attempt is archived');
    assert.ok(branch && branch !== two && branch !== three, `the attempt had a branch of its own: ${branch}`);
    assert.notEqual(spawnSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${branch}`], { cwd: w.dir }).status, 0,
      `${branch} no longer resolves`);
    // 6. The built-on branches are as their owners left them.
    assert.deepEqual([two, three].map((b) => git(w.dir, 'rev-parse', b)), [moved, threeBefore]);
    // 7. Start now with the clash unsettled: refused with the reason.
    testing.setCombineGateDeps(null);
    const refused = await start();
    assert.deepEqual([refused.status, await refused.json()], [409, { error: reason, code: 'DEPENDENCY_CLASH' }]);
    // 8. Settled on run 2's branch, Start now fires the same ticket.
    git(w.dir, 'update-ref', `refs/heads/${two}`, twoBefore);
    const res = await start();
    assert.ok(res.ok, `Start now answered ${res.status}: ${await res.clone().text()}`);
    await tickUntil(() => getTicket(t4).status === 'fired');
    const run = await firedRun(t4);
    assert.equal(getTicket(t4).status, 'fired', getTicket(t4).failReason || '');
    assert.ok(run.pid && run.pid !== pid, 'a new attempt');
    assert.equal(getTicket(t4).pipelineId, run.pid);
  } finally { await releaseSetupWorld(t4); }
}));

test('E3 (R-qa-2) small runs: a setup error that is not a clash still fails the run', () => withEnvVars(SMALL_ON, async () => {
  const { w, t4 } = siblingDepsWorld({ clash: false });
  const error = 'the run before it is still merging its work back';
  try {
    testing.setCombineGateDeps({ checkCombine: async (dir, opts) => {
      const v = await checkCombine(dir, opts);
      // Run 3 reads as still merging back right after the fire-time check: the run's own setup check finds it pending.
      getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ source: `feat/${w.pids[0]}`,
        feature: `feat/${w.pids[0]}`, sameAsSource: true, worktreeDir: join(w.dir, 'merging') }), new Date().toISOString(), w.pids[2]);
      return v;
    } });
    await tickUntil(() => runs.get(t4));
    const attempt = await settledRun(t4);
    const pid = attempt.pipelineId;
    assert.equal(attemptRow(pid).status, 'error');
    assert.deepEqual([getTicket(t4).status, getTicket(t4).pipelineId], ['fired', pid]);
    assert.equal(runErrorNotices(t4).length, 1);
    const frames = attempt.events.filter((e) => e.type === 'error');
    assert.ok(frames.some((e) => e.message === error), JSON.stringify(frames));
    assert.ok(frames.every((e) => !('clash' in e)), 'only a clash adds `clash` to the error frame');
    assert.equal(attemptRow(pid).archived_at, null);
  } finally { await releaseSetupWorld(t4); }
}));

/** A one-PR world whose last slice (3) was rebuilt on `from`'s branch as feat/<tag>, finishing last. */
const rebuildLast = (w, from, tag, k = 3) => {
  git(w.dir, 'checkout', '-q', '-b', `feat/${tag}`, from);
  writeFileSync(join(w.dir, `${tag}.txt`), tag); git(w.dir, 'add', '-A'); git(w.dir, 'commit', '-qm', tag);
  git(w.dir, 'checkout', '-q', 'main');
  getDb().prepare('UPDATE pipelines SET branch = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ source: from, feature: `feat/${tag}` }), '2099-01-01T00:00:00.000Z', w.pids[k - 1]);
  return `feat/${tag}`;
};

shipT('small runs: one PR pushes the latest finished slice', () => withEnvVars(SMALL_ON, async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld({ slices: 4, prs: false });
  // Run 3 finished last, started from run 4's branch: it holds every finished run's work.
  const head = rebuildLast(w, `feat/${w.pids[3]}`, `x${w.pids[2]}`);
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(seen.some((a) => a[0] === 'git' && a[1] === 'push' && a.includes(head)), 'the latest finished branch is pushed');
  assert.ok(!seen.some((a) => a[0] === 'git' && a[1] === 'push' && a.includes(w.last)));
  assert.match(git(w.dir, 'show', `${head}:CHANGELOG.md`), /### Charts/);
  assert.equal(argOf(ghCalls(seen, 'create')[0], '--base'), 'main');
}));

shipT("small runs: one PR is refused 409 HEAD_MISSING_WORK when the head lacks a done slice's tip", () => withEnvVars(SMALL_ON, async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld({ slices: 3, prs: false });
  rebuildLast(w, `feat/${w.pids[0]}`, `y${w.pids[2]}`);   // run 3 lacks run 2's work
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'HEAD_MISSING_WORK', error: "run 2's work is not in the branch one PR would ship: create one PR per run" });
  assert.equal(ghCalls(seen, 'create').length, 0);
  assert.ok(!seen.some((a) => a[0] === 'git' && a[1] === 'push'));
  assert.equal((await view(w.f.id)).ship.mode, null, 'nothing recorded');
}));

shipT('small runs off: the one-PR ship makes no ancestor check and ships the last row', () => withEnvVars(SMALL_OFF, async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld({ slices: 3, prs: false });
  const head = rebuildLast(w, `feat/${w.pids[0]}`, `z${w.pids[2]}`);   // the same head that lacks run 2's work
  const r = await ship(w.f.id, 'one');
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(seen.some((a) => a[0] === 'git' && a[1] === 'push' && a.includes(head)), "dev's last row ships");
}));

test('small runs off: the same tick misses slice 4 as dev does', () => withEnvVars(SMALL_OFF, async () => {
  const w = shipWorld({ slices: 4, prs: false });
  setPipe(w.pids[2], 'stopped');
  unrun(w.f.id, 4);
  const t4 = sliceTicket(w.f.id, 4);
  quietBut(t4);
  await tickUntil(() => getTicket(t4).status !== 'scheduled');
  assert.equal(getTicket(t4).status, 'missed');
  assert.equal(getTicket(t4).failReason, 'The run before it was stopped.');
}));

// ── Shaper small runs B1 (D8, Invariant 5): one card per marked feature; Chat posts no Ship card for it ──
shipT('B1: a marked feature\'s thread holds one card block; no Ship card is posted, and a re-plan adds none', async () => {
  const seen = []; stubShip(seen, { describe: 'v1.11.0' });
  const w = shipWorld();
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  const thread = createThread({ title: 'charts' });
  // The started run card the Chat thread holds for the planning run (its proposal block, now the live run card).
  askAppendMessage(thread.id, { role: 'assistant', text: '', status: 'done',
    blocks: [{ kind: 'card', id: 'card_b1', state: 'started', card: { type: 'run', pipelineId: w.pids[0], title: 'Charts' } }] });
  askLinkRun(thread.id, { runId: 'run-b1', pipelineId: w.pids[0], cardId: 'card_b1' });
  /** The card blocks of the feature's thread that name this feature or its origin run. */
  const cardBlocks = (fid) => {
    const th = featureThread(fid);
    assert.equal(th && th.threadId, thread.id);
    return listMessages(th.threadId).flatMap((m) => m.blocks || [])
      .filter((b) => b.kind === 'card' && b.card && (b.card.pipelineId === w.pids[0] || (b.card.featureId && currentFeatureId(b.card.featureId) === fid)));
  };
  assert.equal(cardBlocks(w.f.id).length, 1, 'before ship-ready');
  const c = await collector();
  try {
    assert.equal(await testing.offerShipCard(w.pids[2]), null, 'no Ship card for a marked feature');
    await sleep(100);
    assert.equal(c.frames('ask-message').length, 0, 'nothing broadcast');
  } finally { c.close(); }
  assert.equal(cardBlocks(w.f.id).length, 1, 'after ship-ready');
  // A re-plan: the successor feature reaches the same thread through `replaces` and posts no card of its own.
  const pidR = pipe('running');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), pidR);
  const succ = createSliceFeature({ pipelineId: pidR, projectDir: w.dir, title: 'Charts', outline: outlineOf(2), perspectives: ['product'],
    workflowId: 'wf_shape', startedBy: 'ann', replaces: w.f.id });
  assert.equal(currentFeatureId(w.f.id), succ.id);
  assert.equal(cardBlocks(succ.id).length, 1, 'after a re-plan');
});

// Small runs B4 (D12): both answer routes refuse an approve of a split failing a non-waivable rule, through the real
// validator of a real mock run held at the Split (WORCA_MOCK_SPLIT_OUTLINE picks the broken rule).
test('B4: POST /api/answer and /api/runs/:id/answer answer 422 split-not-approvable per Care × rule; the Split stays open, no feature', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const { resolveShapeRequest } = await import('../src/core/shape/run.mjs');
  for (const position of ['lean', 'balanced', 'thorough']) {
    for (const outline of ['coverage', 'ownership', 'confirmRole']) {
      await withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns', WORCA_MOCK_SPLIT_OUTLINE: outline }, async () => {
        const req = resolveShapeRequest({ shape: { size: 'large', lead: 'security' } }, { smallRuns: true });
        const orch = createOrchestrator({ projectDir: gitDir('b4-server'), workflowId: req.workflowId, prompt: 'Plan this in slices: demo',
          claude: { mock: true }, shape: req.shape });
        const held = new Promise((resolve) => orch.on('question', (q) => {
          if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position } }));
          else if (q.kind === 'plan' && q.plan?.outline) resolve(q);
          else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
          // C1: the server's Design registry is up (design defaults on), so the Prototype step offers itself: skip it.
          else if (q.kind === 'prototype') setImmediate(() => orch.answer(q.id, { decision: 'skip' }));
          else setImmediate(() => orch.answer(q.id, { answers: [] }));
        }));
        const done = orch.run();
        const q = await held;
        const runId = `b4-${position}-${outline}`;
        runs.set(runId, { id: runId, kind: 'run', status: 'running', events: [], orch, pendingQuestion: q });
        try {
          for (const r of [await post('/api/answer', { runId, id: q.id, payload: { decision: 'approve' } }),
            await post(`/api/runs/${runId}/answer`, { id: q.id, decision: 'approve' })]) {
            assert.equal(r.status, 422, `${position} ${outline}`);
            const body = await r.json();
            assert.equal(body.errors[0].code, 'split-not-approvable', `${position} ${outline}`);
            assert.match(body.errors[0].message, new RegExp(`${outline} R-`));
          }
          assert.equal(orch.pendingQuestion?.id, q.id, 'the Split stays open');
          assert.equal(getDb().prepare('SELECT id FROM shape_features WHERE origin_pipeline_id = ?').get(orch.getState().id), undefined);
          orch.answer(q.id, { decision: 'stop' });
          assert.equal((await done).status, 'stopped');
        } finally { runs.delete(runId); }
      });
    }
  }
});

// ── Small runs C3 (D9): a stop's answer waits for the run's turn ───────────────────────────────────────────────
const C3_STOP = { reason: 'objection', run: 2, pick: 'another', head: 'Run 2 · Code review objects', text: 't', node: 'n_review', findingsLine: '',
  options: [{ value: 'another', payload: { decision: 'another' } }, { value: 'continue', payload: { decision: 'continue' } }] };
/** A 4-run feature: run 1 done, run 2 live on a stop question, run 3 live (going) unless `three` is false. */
function stoppedFeature({ three = true } = {}) {
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const f = mk(4, 'done');
  const tix = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? ORDER BY idx').all(f.id).map((r) => r.ticket_id);
  const answered = [];
  const entryOf = (index, extra = {}) => {
    const pid = pipe('running');
    getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pid, tix[index - 1]);
    const orch = Object.assign(new EventEmitter(), { runShape: { slice: { feature: f.id, index } }, state: { shaping: { approved: { file: 'p.md' } } },
      answer: (id, payload, by) => answered.push({ index, id, payload, by }) });
    const e = { id: `c3-${pid}`, kind: 'run', pipelineId: pid, status: 'running', events: [], pendingQuestion: null, orch, ...extra };
    runs.set(e.id, e);
    return e;
  };
  const e2 = entryOf(2, { pendingQuestion: { id: 'gate-w9-3', kind: 'gate', stop: C3_STOP } });
  const e3 = three ? entryOf(3) : null;
  const cleanup = () => { for (const e of [e2, e3]) if (e) runs.delete(e.id); getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run(); };
  return { f, tix, e2, e3, answered, cleanup };
}

test('C3 routes: a held answer replies {ok:true, held:true}; a foreign payload 422 and a second answer 409 change nothing', async () => {
  const w = stoppedFeature();
  try {
    let r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'stop' } });
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(await r.json()), /not one of this stop's options/);
    assert.equal(w.e2.heldStop ?? null, null);
    r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'another' } });
    assert.deepEqual(await r.json(), { ok: true, held: true });
    assert.equal(w.e2.pendingQuestion.id, 'gate-w9-3', 'the question stays open');
    r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'this stop is already answered: it goes on after run 3', code: 'STOP_HELD' });
    assert.equal(w.answered.length, 0);
    assert.equal((await view(w.f.id)).slices[1].state, 'questions');
  } finally { w.cleanup(); }
});

test('C3 routes: a stop the run has taken refuses a second answer 409 STOP_ANSWERED and answers nothing more', async () => {
  const w = stoppedFeature({ three: false });
  try {
    let r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(w.e2.pendingQuestion, null, 'the question is resolved');
    r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'another' } });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'this stop is already answered', code: 'STOP_ANSWERED' });
    assert.equal(w.answered.length, 1);
  } finally { w.cleanup(); }
});

test('C3: deliver runs before runDueTickets: the held run goes on and the independent run 4 does not fire on that tick', () => withEnvVars(SMALL_ON, async () => {
  const w = stoppedFeature();
  try {
    await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'another' } });
    runs.delete(w.e3.id);
    setPipe(w.e3.pipelineId, 'done');
    await schedulerTick();
    assert.deepEqual(w.answered.map((a) => [a.index, a.id, a.payload.decision]), [[2, 'gate-w9-3', 'another']]);
    assert.equal(w.e2.pendingQuestion, null);
    assert.equal(w.e2.heldStop, null);
    assert.equal(getTicket(w.tix[3]).status, 'scheduled', 'run 2 is going again: run 4 waits');
  } finally { w.cleanup(); }
}));

test('C3: the run-event hook delivers once as the busy run settles, with no tick in between', async () => {
  const w = stoppedFeature({ three: false });
  const e3 = { id: 'c3-hook', kind: 'run', status: 'running', events: [], pendingQuestion: null, pipelineId: pipe('running'),
    orch: Object.assign(new EventEmitter(), { runShape: { slice: { feature: w.f.id, index: 3 } }, state: { shaping: { approved: { file: 'p.md' } } } }) };
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(e3.pipelineId, w.tix[2]);
  runs.set(e3.id, e3);
  testing.wireRun(e3);
  try {
    await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.equal(w.e2.heldStop?.after, 3);
    setPipe(e3.pipelineId, 'done');
    e3.status = 'done';
    e3.orch.emit('state', { status: 'done' });
    await sleep(30);
    assert.equal(w.answered.length, 1);
    e3.orch.emit('exec', { node: 'x' });
    await sleep(30);
    assert.equal(w.answered.length, 1, 'delivered once');
  } finally { runs.delete(e3.id); w.cleanup(); }
});

test('C3: ui/server.mjs stays within its size cap', () => {
  const capsFile = new URL('../tools/split-by-feature/size-caps.json', import.meta.url);
  const caps = JSON.parse(readFileSync(capsFile, 'utf8'));
  const lines = readServerSource(undefined, { routes: false }).split('\n').length - 1;
  assert.ok(lines <= caps[SERVER_MJS], `${lines} > ${caps[SERVER_MJS]}`);
});

// ── Small runs C5: the Verifier through the server's settle path, frames and PR exemption ──────────────────────
const verifierFeature = (dir) => {
  const p1 = pipe('done');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), p1);
  const outline = { ...outlineOf(2), agreed: [{ id: 'R-po-1', text: 'one' }, { id: 'R-po-2', text: 'two' }] };
  outline.slices = outline.slices.map((s, i) => ({ ...s, requirements: [`R-po-${i + 1}`] }));
  const f = createSliceFeature({ pipelineId: p1, projectDir: dir, title: 'Charts', outline, perspectives: ['product'], workflowId: 'wf_shape',
    startedBy: 'ann', base: { mock: true }, smallRuns: true, care: { position: 'lean', chosenBy: 'person', worcaPick: 'lean' } });
  const p2 = pipe('done');
  const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(p2, t2);
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  const checks = () => (JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id).outline).verify || { checks: [] }).checks;
  return { f, p1, p2, checks };
};

test("C5: a marked feature's last slice settling done through afterRunSettled creates a wf_shape_verify ticket", () => withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, async () => {
  const w = verifierFeature(project);
  await testing.afterRunSettled({ runShape: { slice: { feature: w.f.id, index: 2 } }, getState: () => ({ status: 'done', id: w.p2 }) });
  assert.equal(w.checks().length, 1);
  const t = getTicket(w.checks()[0].ticketId, { withRequest: true });
  assert.equal(t.request.workflowId, 'wf_shape_verify');
  assert.deepEqual(t.after, { kind: 'pipeline', id: w.p2, policy: 'done' });
  cancelTicket(t.id);
}));

test("C5: a Verifier pipeline's frame broadcasts its feature (the runShape.verify gate and featureOfAnyPipeline)", () => withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, async () => {
  const w = verifierFeature(project);
  await testing.afterRunSettled({ runShape: { slice: { feature: w.f.id, index: 2 } }, getState: () => ({ status: 'done', id: w.p2 }) });
  const vp = pipe('running');
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(vp, w.checks()[0].ticketId);
  const orch = Object.assign(new EventEmitter(), { runShape: { verify: { featureId: w.f.id, round: 1 } }, state: {} });
  const entry = { id: `wired-${vp}`, kind: 'run', status: 'running', events: [], pipelineId: vp, orch };
  runs.set(entry.id, entry);
  testing.wireRun(entry);
  const c = await collector();
  try {
    orch.emit('question', { id: 'verify-2-x', kind: 'gate' });
    await sleep(60);
    assert.equal(c.frames('shape-feature').filter((m) => m.id === w.f.id).length, 1);
  } finally { c.close(); runs.delete(entry.id); cancelTicket(w.checks()[0].ticketId); }
}));

test('C5: a Verifier run is PR-exempt as verify', () => withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, async () => {
  const dir = gitDir('verifier-pr');
  const w = verifierFeature(dir);
  for (const b of ['main', `feat/${w.p2}`]) spawnSync('git', ['branch', '-f', b], { cwd: dir });
  await testing.afterRunSettled({ runShape: { slice: { feature: w.f.id, index: 2 } }, getState: () => ({ status: 'done', id: w.p2 }) });
  const tid = w.checks()[0].ticketId;
  requestRunNow(tid);
  await schedulerTick();
  const { readRunPrAuto } = await import('../src/core/pr-auto.mjs');
  let pa = null;
  for (let i = 0; i < 200 && !pa; i++) { const pid = getTicket(tid)?.pipelineId; pa = pid ? readRunPrAuto(pid) : null; if (!pa) await sleep(50); }
  assert.equal(pa?.exempt, 'verify');
  const e = [...runs.values()].find((x) => x.pipelineId === getTicket(tid).pipelineId);
  for (let i = 0; i < 200 && e && !['done', 'stopped', 'error', 'paused'].includes(String(e.status)); i++) await sleep(50);
  if (e && e.orch && !['done', 'stopped', 'error'].includes(String(e.status))) await e.orch.stop?.();
}));

// ── Shaper small runs D2 (D8): /slice of a marked feature with the flag on adds owns, startsFrom and stored ───────────
test('D2 (D8): GET /slice: marked + flag on adds owns, startsFrom and stored (also with startsFrom null); flag off dev\'s keys; 404 plain', async () => {
  const DEV = ['featureId', 'title', 'index', 'total', 'sliceTitle', 'state', 'next', 'threadId'];
  const f = mk(3, 'done');
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  const p2 = pipe('done');
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify({ feature: `feat/${p2}` }), p2);   // an old row: no source
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  const slice = async (pid) => { const r = await get(`/api/shape/pipelines/${pid}/slice`); return { status: r.status, body: await r.json() }; };
  await withEnvVars(SMALL_ON, async () => {
    const one = await slice(f.pid);
    assert.equal(one.status, 200);
    assert.deepEqual(Object.keys(one.body), [...DEV.slice(0, 7), 'owns', 'startsFrom', 'links', 'threadId', 'stored']);
    assert.deepEqual(one.body.owns, []);
    assert.equal(one.body.startsFrom.kind, 'feature');
    assert.deepEqual(one.body.stored, { planVersion: null, planReviewed: false, tests: null });
    const two = await slice(p2);
    assert.equal(two.body.startsFrom, null);
    assert.deepEqual(two.body.owns, []);
    assert.deepEqual(two.body.stored, { planVersion: null, planReviewed: false, tests: null });
    assert.equal((await slice('p-plain-d2')).status, 404);
  });
  await withEnvVars(SMALL_OFF, async () => {
    assert.deepEqual(Object.keys((await slice(f.pid)).body), DEV);
    assert.deepEqual(Object.keys((await slice(p2)).body), DEV);
  });
  const plain = mk(2, 'done');
  await withEnvVars(SMALL_ON, async () => assert.deepEqual(Object.keys((await slice(plain.pid)).body), DEV, 'unmarked: dev\'s keys'));
});

// ── Shaper small runs D3 (D4): the run page's Owns word is the feature's own `shown`, computed once ───────────────────
test('D3: /slice owns[].word equals the feature\'s shown.word for the same id; flag off: no word', async () => {
  const outline = outlineOf(2);
  outline.slices[0].requirements = ['R-po-1'];
  outline.slices[1].requirements = ['R-po-2'];
  outline.agreed = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People export it' }];
  outline.leftOut = [];
  const f = await withEnvVars(SMALL_ON, async () => mk(2, 'done', { outline }));
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  const slice = async (pid) => (await get(`/api/shape/pipelines/${pid}/slice`)).json();
  await withEnvVars(SMALL_ON, async () => {
    const v = await view(f.id);
    const shown = new Map(v.ship.smallRuns.owned.map((o) => [o.id, o.shown]));
    const owns = (await slice(f.pid)).owns;
    assert.deepEqual(owns.map((o) => [o.id, o.word, o.mark]), [['R-po-1', shown.get('R-po-1').word, shown.get('R-po-1').mark]]);
    assert.equal(owns[0].word, 'met');
  });
  await withEnvVars(SMALL_OFF, async () => {
    assert.equal('owns' in (await slice(f.pid)), false, 'flag off: no owns at all');
    const v = await view(f.id);
    assert.ok(v.ship.smallRuns.owned.every((o) => !('shown' in o)));
  });
});

// ── The Verifier's settle: the routes ask isFinishingRun ───────────────────────────────────────────────────────────────
test('a Verifier run this server is still finishing: view and card read verifying and Resume is 409; settled, it reads halted; flag off, Resume is 409 and starts nothing', () => withEnvVars(SMALL_ON, async () => {
  const outline = outlineOf(2);
  outline.slices[0].requirements = ['R-po-1'];
  outline.slices[1].requirements = ['R-po-2'];
  outline.agreed = [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People export it' }];
  outline.leftOut = [];
  const f = mk(2, 'done', { outline });
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  const p2 = pipe('done');
  db.prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  db.prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2)").run(p2, f.id);
  const v = pipe('done');
  db.prepare("UPDATE pipelines SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(v);
  const row = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id).outline);
  row.verify = { checks: [{ round: 1, ticketId: null, pipelineId: v, head: { index: 2, pipelineId: p2 }, headSha: null, state: 'verifying', result: null, gapRuns: [], extra: 0, fixCycles: 1, at: '2026-01-01T00:00:00.000Z' }] };
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(row), f.id);
  const e = liveEntry(v, { status: 'done' });   // the row and the frame read done; the run's promise is still open
  const card = async () => (await (await get(`/api/shape/pipelines/${f.pid}/card`)).json()).feature;
  try {
    assert.equal((await view(f.id)).verify.state, 'verifying');
    assert.equal((await card()).verify.state, 'verifying');
    const refused = await post(`/api/shape/features/${f.id}/resume`, {});
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { code: 'NOTHING_TO_RESUME', error: 'nothing to resume now: the Verifier is not stopped, a run or round is not over, or the Shaper Labs switch is off' });
    e.settled = true;
    assert.deepEqual([(await view(f.id)).verify.state, (await view(f.id)).status, (await card()).verify.state], ['halted', 'active', 'halted']);
  } finally { dropEntry(e); }
  await withEnvVars(SMALL_OFF, async () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM scheduled_runs').get().n;
    assert.equal((await post(`/api/shape/features/${f.id}/resume`, {})).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scheduled_runs').get().n, n, 'flag off: no Verifier run');
  });
}));

shipT('a run or a round this server is still finishing: Ship answers 409 NOT_READY with no push and no gh call, and no Ship card is posted', () => withEnvVars(SMALL_ON, async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  const round = nextId();
  seedPipelineRow({ id: round, projectKey: projectKey(w.dir), status: 'done', branch: { source: w.last, sameAsSource: true, roundOf: { pipelineId: w.pids[2], round: 2, request: 'blue' } } });
  for (const pid of [w.pids[0], round]) {
    const e = liveEntry(pid, { status: 'done' });   // done, and the run's promise is still open
    try {
      const r = await ship(w.f.id, 'stacked');
      assert.equal(r.status, 409, pid);
      assert.equal((await r.json()).code, 'NOT_READY');
      assert.equal((await view(w.f.id)).ship.ready, false);
      assert.equal(await testing.offerShipCard(w.pids[2]), null);
      assert.deepEqual(seen.filter((a) => a[0] === 'gh' || a[1] === 'push'), []);
    } finally { dropEntry(e); }
  }
}));

// The ship rule at the moment of shipping: POST /ship asks it again, whatever the page showed.
shipT('POST /ship of a marked feature, flag on: 409 NOT_READY with no push and no gh call unless a clean check is on record for the exact head', () => withEnvVars(SMALL_ON, async () => {
  const seen = []; stubShip(seen);
  const w = shipWorld();
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
  const tip = (pid) => git(w.dir, 'rev-parse', `feat/${pid}`);
  const store = (checks) => {
    const o = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
    db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...o, verify: { checks } }), w.f.id);
  };
  const clean = () => ({ round: 1, ticketId: null, pipelineId: null, head: { index: 3, pipelineId: w.pids[2] }, headSha: tip(w.pids[2]),
    tips: Object.fromEntries(w.pids.map((p) => [p, tip(p)])), state: 'clean', result: { held: [], gaps: [] }, gapRuns: [], extra: 0, fixCycles: 1, at: '2026-01-01T00:00:00.000Z' });
  const commit = (pid) => { git(w.dir, 'checkout', '-q', `feat/${pid}`); writeFileSync(join(w.dir, `late-${nextId()}.txt`), 'x'); git(w.dir, 'add', '-A');
    git(w.dir, 'commit', '-qm', 'late'); git(w.dir, 'checkout', '-q', 'main'); };
  const refused = async (why) => {
    const r = await ship(w.f.id, 'stacked');
    assert.equal(r.status, 409, why);
    assert.equal((await r.json()).code, 'NOT_READY', why);
    assert.deepEqual(seen.filter((a) => a[0] === 'gh' || a[1] === 'push'), [], why);
  };
  await refused('no check on record');
  store([clean()]);
  assert.equal((await view(w.f.id)).ship.ready, true);
  commit(w.pids[2]);
  await refused('a commit on the head after the page read ready');
  store([clean()]);
  commit(w.pids[0]);
  await refused("a commit on an earlier run's branch, which ships too");
  store([{ ...clean(), headSha: null }]);
  await refused('a check with no head');
  store([clean()]);
  const round = nextId();
  seedPipelineRow({ id: round, projectKey: projectKey(w.dir), status: 'interrupted', branch: { source: w.last, sameAsSource: true, roundOf: { pipelineId: w.pids[2], round: 2, request: 'blue' } } });
  await refused('an interrupted round');
  setPipe(round, 'stopped');
  // The changelog commit is Ship's own: a ship that fails after it goes on without a new check.
  stubShip(seen, { ready: () => failRun('nope') });
  assert.equal((await ship(w.f.id, 'stacked')).status, 500);
  assert.match(git(w.dir, 'show', `${w.last}:CHANGELOG.md`), /### Charts/);
  stubShip(seen);
  const r = await ship(w.f.id, 'stacked');
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(seen.some((a) => a[0] === 'git' && a[1] === 'push'));
}));

// ── The Ship lock and the rule asked again while Ship is under way ─────────────────────────────────────────────────────
/** A marked three-run feature with no PR yet and a clean check for its head; `marked: false` leaves the marker out. */
function shippingWorld({ marked = true } = {}) {
  const w = shipWorld({ prs: false });
  const db = getDb();
  const tip = (pid) => git(w.dir, 'rev-parse', `feat/${pid}`);
  if (marked) {
    db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.pids[0]);
    const o = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
    const check = { round: 1, ticketId: null, pipelineId: null, head: { index: 3, pipelineId: w.pids[2] }, headSha: tip(w.pids[2]), tips: Object.fromEntries(w.pids.map((p) => [p, tip(p)])),
      state: 'clean', result: { held: [], gaps: [] }, gapRuns: [], extra: 0, fixCycles: 1, at: '2026-01-01T00:00:00.000Z' };
    db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...o, verify: { checks: [check] } }), w.f.id);
  }
  const seen = [];
  return { ...w, seen, commit: (pid) => { git(w.dir, 'checkout', '-q', `feat/${pid}`); writeFileSync(join(w.dir, `late-${nextId()}.txt`), 'x'); git(w.dir, 'add', '-A');
    git(w.dir, 'commit', '-qm', 'late'); git(w.dir, 'checkout', '-q', 'main'); },
  round: () => seedPipelineRow({ id: nextId(), projectKey: projectKey(w.dir), status: 'running', branch: { source: w.last, sameAsSource: true, roundOf: { pipelineId: w.pids[2], round: 2, request: 'blue' } } }),
  /** Ships with `during(n)` run inside the n-th `gh pr create`; `stubs` = more of stubShip's answers. */
  shipWith: async (during, stubs = {}) => {
    let n = 0;
    stubShip(seen, { create: async () => { n += 1; await during(n); return okRun(`https://github.com/me/repo/pull/${n}\n`); }, ...stubs });
    const r = await ship(w.f.id, 'stacked');
    return { status: r.status, body: await r.json() };
  },
  pushes: (pid) => seen.filter((a) => a[0] === 'git' && a[1] === 'push' && a.includes(`feat/${pid}`)).length };
}
const shipMode = (id) => getDb().prepare('SELECT ship_mode FROM shape_features WHERE id = ?').get(id).ship_mode;

for (const [what, act] of [['a commit on the head branch', (w) => w.commit(w.pids[2])], ['a round row', (w) => w.round()]]) {
  shipT(`${what} during the first create stops Ship: 409 NOT_READY with the PR made so far, and the later runs are not pushed`, () => withEnvVars(SMALL_ON, async () => {
    const w = shippingWorld();
    assert.equal((await view(w.f.id)).ship.ready, true);
    const r = await w.shipWith((n) => { if (n === 1) act(w); });
    assert.deepEqual([r.status, r.body.code, r.body.prs], [409, 'NOT_READY', ['https://github.com/me/repo/pull/1']]);
    assert.deepEqual(w.pids.map(w.pushes), [1, 0, 0]);
    assert.equal(shipMode(w.f.id), null);
  }));
}

for (const k of [0, 2]) {
  shipT(`a commit on run ${k + 1}'s branch during the last create: 409 NOT_READY with all three PRs, and nothing is pushed after the changelog`, () => withEnvVars(SMALL_ON, async () => {
    const w = shippingWorld();
    const r = await w.shipWith((n) => { if (n === 3) w.commit(w.pids[k]); });
    assert.deepEqual([r.status, r.body.code, r.body.prs.length], [409, 'NOT_READY', 3]);
    assert.deepEqual(w.pids.map(w.pushes), [1, 1, 1]);
    assert.equal(shipMode(w.f.id), null);
  }));
}

shipT('a commit made inside the second push of the head branch: 409 NOT_READY, and the feature is not recorded as shipped', () => withEnvVars(SMALL_ON, async () => {
  const w = shippingWorld();
  const r = await w.shipWith(() => {}, { push: (args) => {
    if (args.includes(`feat/${w.pids[2]}`) && w.pushes(w.pids[2]) === 2) w.commit(w.pids[2]);
    return okRun('');
  } });
  assert.deepEqual([r.status, r.body.code, r.body.prs?.length], [409, 'NOT_READY', 3], JSON.stringify(r.body));
  assert.match(r.body.error, /or Resume on the feature page, if it reads Stopped/);
  assert.doesNotMatch(r.body.error, /\bcard\b/, 'a feature with no chat has no card');
  assert.equal(w.pushes(w.pids[2]), 2);
  assert.equal(shipMode(w.f.id), null);
}));

shipT('a step that failed after the work changed keeps its own error in the stop message', () => withEnvVars(SMALL_ON, async () => {
  const w = shippingWorld();
  const r = await w.shipWith(() => {}, { ready: () => { w.commit(w.pids[2]); return failRun('nope'); } });
  assert.deepEqual([r.status, r.body.code], [409, 'NOT_READY']);
  assert.match(r.body.error, /could not mark slice 1's PR ready: .*nope/);
}));

shipT('while a small-runs feature ships, a round, an appended run, a change, Resume and Re-plan are refused with SHIPPING and write nothing', () => withEnvVars(SMALL_ON, async () => {
  const w = shippingWorld();
  const db = getDb();
  const thread = createThread({ title: 'lock' });
  const card = (landing, extra = {}) => ({ id: `card_${nextId().slice(-8)}`, kind: 'card', state: 'proposed', card: { type: 'changes', text: 'blue bars', landing, featureId: w.f.id, pipelineId: w.pids[2], ...extra } });
  const round = card({ kind: 'round', title: 'Changes to Run 3', target: { roundOf: w.pids[2], round: 2, sourceBranch: w.last, featureId: w.f.id } },
    { run: { prompt: 'blue bars', projectDir: w.dir, sourceBranch: w.last, sameAsSource: true, syncBeforeStart: false, mock: true } });
  const extraRun = card({ kind: 'extra-run', title: 'Changes', target: { featureId: w.f.id } });
  askAppendMessage(thread.id, { role: 'assistant', text: '', blocks: [round, extraRun] });
  const rows = () => ['scheduled_runs', 'shape_feature_slices', 'pipelines'].map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  const { reqChanges } = await import('../ui/server.mjs');
  const { changeAgreedRequirements, replanRest } = await import('../src/core/shape/features.mjs');
  const before = rows();
  const got = [];
  const r = await w.shipWith(async (n) => {
    if (n !== 1) return;
    for (const c of [round, extraRun]) {
      const a = await post(`/api/ask/threads/${thread.id}/cards/${c.id}`, { verb: 'start' });
      got.push([a.status, (await a.json()).code]);
    }
    const out = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(w.f.id).outline);
    db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...out, agreed: [{ id: 'R-po-1', text: 'People see it' }] }), w.f.id);
    const c = reqChanges.apply(w.f.id, [{ id: 'R-po-1', from: 'People see it', to: 'People export it' }], { kind: 'chat' });
    got.push([c.status, c.code]);
    assert.throws(() => changeAgreedRequirements(w.f.id, { changes: [] }), { code: 'SHIPPING', status: 409 });
    db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(out), w.f.id);
    for (const verb of ['resume', 'replan']) {
      const a = await post(`/api/shape/features/${w.f.id}/${verb}`, {});
      got.push([a.status, (await a.json()).code]);
    }
    assert.throws(() => replanRest(w.f.id), { code: 'SHIPPING', status: 409 });
  });
  assert.deepEqual(got, Array(5).fill([409, 'SHIPPING']));
  assert.deepEqual([r.status, shipMode(w.f.id), rows()], [200, 'stacked', before], JSON.stringify(r.body));
}));

shipT('a round started just before Ship, with no row yet, holds Ship', () => withEnvVars(SMALL_ON, async () => {
  const w = shippingWorld();
  const e = { id: `live-${nextId()}`, kind: 'run', pipelineId: null, status: 'starting', events: [], pendingQuestion: null, orch: { state: {}, branchOpts: { roundOf: { pipelineId: w.pids[2], round: 2 } } } };
  runs.set(e.id, e);
  try {
    const r = await w.shipWith(() => {});
    assert.deepEqual([r.status, r.body.code, w.seen.filter((a) => a[0] === 'gh' || a[1] === 'push')], [409, 'NOT_READY', []]);
  } finally { dropEntry(e); }
}));

for (const [what, env, marked] of [['an unmarked feature', SMALL_ON, false], ['the flag off', SMALL_OFF, true]]) {
  shipT(`${what}: no lock and no re-check, Ship goes on as on dev`, () => withEnvVars(env, async () => {
    const w = shippingWorld({ marked });
    const { roundWhileShipping } = await import('../src/core/shape/chain.mjs');
    const r = await w.shipWith((n) => { if (n !== 1) return; w.commit(w.pids[2]); assert.equal(roundWhileShipping(w.pids[2]), null); });
    assert.deepEqual([r.status, shipMode(w.f.id)], [200, 'stacked'], JSON.stringify(r.body));
  }));
}

// A paused round that is stopped settles in no run of its own: the stop starts the check it was holding.
test('a stopped paused round lets the first check start', () => withEnvVars(SMALL_ON, async () => {
  const f = mk(2, 'done');
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  const p2 = pipe('done');
  db.prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  db.prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2)").run(p2, f.id);
  const round = nextId();
  seedPipelineRow({ id: round, projectKey: projectKey(project), status: 'stopped', branch: { source: 'main', sameAsSource: true, roundOf: { pipelineId: p2, round: 2, request: 'blue' } } });
  const { stopPausedPipeline } = await import('../ui/server.mjs');
  await stopPausedPipeline(round).catch(() => {});
  const checks = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id).outline).verify?.checks || [];
  assert.deepEqual(checks.map((c) => [c.round, c.state]), [[1, 'verifying']]);
  cancelTicket(checks[0].ticketId);
}));

// Item 5: the Verifier's run page finds its feature through the slice route (flag on); it carries no slice fields.
test('GET /api/shape/pipelines/:pid/slice: a Verifier\'s run answers its feature with the flag on, 404 with it off', () => withEnvVars(SMALL_ON, async () => {
  const f = mk(2, 'done');
  const db = getDb();
  db.prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), f.pid);
  const p2 = pipe('done');
  db.prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  db.prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2)").run(p2, f.id);
  const { startVerifyCheck } = await import('../src/core/shape/verifier.mjs');
  const check = startVerifyCheck(f.id);
  assert.ok(check);
  const pv = pipe('running');
  db.prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(pv, check.ticketId);
  const r = await get(`/api/shape/pipelines/${pv}/slice`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { verifier: true, featureId: f.id, threadId: null });
  const thread = createThread({ title: 'charts' });
  askLinkRun(thread.id, { runId: 'run-verify-x', pipelineId: f.pid, cardId: 'card_verify_x' });
  assert.equal((await (await get(`/api/shape/pipelines/${pv}/slice`)).json()).threadId, thread.id);
  assert.equal((await (await get(`/api/shape/pipelines/${p2}/slice`)).json()).index, 2, 'a slice is unchanged');
  assert.equal((await get('/api/shape/pipelines/p-plain-zz/slice')).status, 404);
  await withEnvVars(SMALL_OFF, async () => { assert.equal((await get(`/api/shape/pipelines/${pv}/slice`)).status, 404); });
}));

// ── Small runs slice 7 (R-qa-2): a second answer to a listed stop is refused as today, from each listed line ─────────
const PLAN_REFUSAL = 'no plan approval with that id is waiting on this run';
const APPROVE = { decision: 'approve' };
/** The 16-run feature `fx` with a live entry per run in `stops` (run → ask kind) and a running one, asking nothing, per
 *  run in `going`. Each orchestrator records every answer it receives. */
function sixteenStopEntries(fx, stops, going = []) {
  const answered = [];
  const entries = new Map();
  const add = (run, pendingQuestion) => {
    const pid = fx.pipelineOf(run);
    const orch = Object.assign(new EventEmitter(), { runShape: { slice: { feature: fx.featureId, index: run } }, state: { shaping: { approved: { file: 'p.md' } } },
      answer: (id, payload, by) => answered.push({ run, id, payload, by }) });
    const e = { id: `s7-${pid}`, kind: 'run', pipelineId: pid, status: 'running', events: [], pendingQuestion, orch };
    runs.set(e.id, e);
    entries.set(run, e);
  };
  for (const [key, kind] of Object.entries(stops)) {
    const run = Number(key);
    const stop = run === 2 ? planStop({ run, outlineChange: 'the runner cache needs its own run' }) : planStop({ run });
    add(run, { id: `q${run}`, kind, stop });
  }
  for (const run of going) add(run, null);
  const quiet = () => getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const cleanup = () => { for (const e of entries.values()) runs.delete(e.id); quiet(); };
  /** Run `run` finishes and the held answers whose turn has come are delivered; no waiting ticket may fire. */
  const finish = async (run) => {
    runs.delete(entries.get(run).id);
    setPipe(fx.pipelineOf(run), 'done');
    quiet();
    // A tick another request started may still be in flight (schedulerTick answers null then): wait for a pass of our own.
    for (const end = Date.now() + 5000; (await schedulerTick()) === null && Date.now() < end;) await new Promise((r) => setTimeout(r, 20));
  };
  return { entry: (run) => entries.get(run), of: (run) => answered.filter((a) => a.run === run), answered, finish, cleanup };
}
const LINE_STOPS = { 2: 'plan', 4: 'gate', 11: 'gate' };
/** `next`: busy with run 6 not started (nothing going, an answer is due). `busy`: run 6 going (an answer is held). */
function stopWorld(name, stops = LINE_STOPS) {
  const { 6: _six, ...states } = SIXTEEN_RUN_STATES.busy.states;
  const fx = world(project, { done: [1, 3], states: name === 'busy' ? SIXTEEN_RUN_STATES.busy.states : states });
  return sixteenStopEntries(fx, stops, name === 'busy' ? [6] : []);
}
const reply = async (res) => { const r = await res; return [r.status, await r.json()]; };
const planAnswer = (e, id) => reply(post(`/api/runs/${e.id}/answer`, { id, decision: 'approve' }));
const gateAnswer = (e, id) => reply(post('/api/answer', { runId: e.id, id, payload: APPROVE }));

test('S7-T10 run 2, due: the second approval is refused 409 on the plan route and run 2 is answered once', () => withEnvVars(SMALL_ON, async () => {
  const w = stopWorld('next');
  try {
    assert.deepEqual(await planAnswer(w.entry(2), 'q2'), [200, { ok: true }]);
    assert.deepEqual(await planAnswer(w.entry(2), 'q2'), [409, { error: PLAN_REFUSAL }]);
    assert.deepEqual(w.of(2).map((a) => [a.id, a.payload.decision]), [['q2', 'approve']]);
    assert.equal(w.answered.length, 1, 'no other run is answered');
  } finally { w.cleanup(); }
}));

test('S7-T11 run 2, held behind run 6: the second approval is 409 STOP_HELD; one delivery once run 6 is done', () => withEnvVars(SMALL_ON, async () => {
  const w = stopWorld('busy');
  try {
    const e = w.entry(2);
    assert.deepEqual(await planAnswer(e, 'q2'), [200, { ok: true, held: true }]);
    const held = structuredClone(e.heldStop);
    assert.deepEqual(await planAnswer(e, 'q2'), [409, { error: heldRefusal(6), code: 'STOP_HELD' }]);
    assert.equal(w.of(2).length, 0, 'not started yet');
    assert.deepEqual(e.heldStop, held, 'the refusal changes nothing');
    assert.equal(e.pendingQuestion.id, 'q2');
    await w.finish(6);
    assert.equal(w.of(2).length, 1);
    assert.deepEqual(await planAnswer(e, 'q2'), [409, { error: PLAN_REFUSAL }]);
    assert.equal(w.of(2).length, 1, 'run 2 is not started twice');
  } finally { w.cleanup(); }
}));

test('S7-T12 run 11\'s check line, due: the second answer is 409 STOP_ANSWERED and run 11 is answered once', () => withEnvVars(SMALL_ON, async () => {
  const w = stopWorld('next');
  try {
    assert.deepEqual(await gateAnswer(w.entry(11), 'q11'), [200, { ok: true }]);
    assert.deepEqual(await gateAnswer(w.entry(11), 'q11'), [409, { error: 'this stop is already answered', code: 'STOP_ANSWERED' }]);
    assert.equal(w.of(11).length, 1);
    assert.equal(w.answered.length, 1);
  } finally { w.cleanup(); }
}));

test('S7-T12 run 11\'s check line, held: the second answer is 409 STOP_HELD; one delivery once run 6 is done', () => withEnvVars(SMALL_ON, async () => {
  const w = stopWorld('busy');
  try {
    const e = w.entry(11);
    assert.deepEqual(await gateAnswer(e, 'q11'), [200, { ok: true, held: true }]);
    const held = structuredClone(e.heldStop);
    assert.deepEqual(await gateAnswer(e, 'q11'), [409, { error: heldRefusal(6), code: 'STOP_HELD' }]);
    assert.equal(w.of(11).length, 0);
    assert.deepEqual(e.heldStop, held);
    await w.finish(6);
    assert.equal(w.of(11).length, 1);
    assert.deepEqual(await gateAnswer(e, 'q11'), [409, { error: 'this stop is already answered', code: 'STOP_ANSWERED' }]);
    assert.equal(w.of(11).length, 1);
  } finally { w.cleanup(); }
}));

test('S7-T12b run 11 as a plan approval: the second approval is refused on the plan route and run 11 is answered once', () => withEnvVars(SMALL_ON, async () => {
  const w = stopWorld('next', { ...LINE_STOPS, 11: 'plan' });
  try {
    assert.deepEqual(await planAnswer(w.entry(11), 'q11'), [200, { ok: true }]);
    assert.deepEqual(await planAnswer(w.entry(11), 'q11'), [409, { error: PLAN_REFUSAL }]);
    assert.equal(w.of(11).length, 1);
  } finally { w.cleanup(); }
}));

// ── Shaper small runs, slice 3: the answer routes over a take-in that refuses, waits or runs ─────────────────────────
const TAKE_REASON = 'runs 2 and 3 clash in src/a.mjs';
/** A marked feature with run 2 live at its stop, its stand-in orch answering takeInBeforeAnswer with `reply`. */
function takeInStop({ three = false, reply = { ok: true, merged: [] } } = {}) {
  const w = stoppedFeature({ three });
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), w.f.pid);
  const taken = [];
  w.e2.orch.takeInBeforeAnswer = async () => { taken.push(w.e2.id); return reply; };
  return { ...w, taken };
}

test('slice 3 routes: POST /api/answer replies 409 TAKE_IN_REFUSED with the reason and the question stays open', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInStop({ reply: { ok: false, refused: true, reason: TAKE_REASON } });
  try {
    const r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.deepEqual([r.status, await r.json()], [409, { error: TAKE_REASON, code: 'TAKE_IN_REFUSED' }]);
    assert.equal(w.e2.pendingQuestion?.id, 'gate-w9-3');
    assert.deepEqual([w.taken.length, w.answered.length], [1, 0]);
  } finally { w.cleanup(); }
}));

test('slice 3 routes: POST /api/runs/:id/answer maps the same refusal to 409 TAKE_IN_REFUSED', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInStop({ reply: { ok: false, refused: true, reason: TAKE_REASON } });
  w.e2.pendingQuestion = { id: 'plan-w9-1', kind: 'plan', stop: planStop({ run: 2 }) };
  try {
    const r = await post(`/api/runs/${w.e2.id}/answer`, { id: 'plan-w9-1', decision: 'approve' });
    assert.deepEqual([r.status, await r.json()], [409, { error: TAKE_REASON, code: 'TAKE_IN_REFUSED' }]);
    assert.equal(w.e2.pendingQuestion?.id, 'plan-w9-1');
    assert.equal(w.answered.length, 0);
  } finally { w.cleanup(); }
}));

test('slice 3 routes: a take-in that succeeds answers the run, resolves the question and replies 200', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInStop();
  try {
    const r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.deepEqual([r.status, await r.json()], [200, { ok: true }]);
    assert.deepEqual([w.taken.length, w.answered.length], [1, 1]);
    assert.equal(w.e2.pendingQuestion, null);
  } finally { w.cleanup(); }
}));

test('slice 3 routes: a take-in that waits replies {ok:true, held:true}', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInStop({ reply: { ok: false, wait: true, after: 3 } });
  try {
    const r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.deepEqual(await r.json(), { ok: true, held: true });
    assert.equal(w.e2.heldStop?.after, 3);
    assert.equal(w.answered.length, 0);
  } finally { w.cleanup(); }
}));

test('slice 3 (R-arch-11): answerRun stays synchronous on an unmarked feature and returns a promise only for a take-in', () => withEnvVars(SMALL_ON, async () => {
  const unmarked = stoppedFeature({ three: false });
  try {
    assert.equal(testing.answerRun(unmarked.e2.id, 'gate-w9-3', { decision: 'continue' }, 'ann'), undefined);
    assert.equal(unmarked.answered.length, 1);
    assert.equal(unmarked.e2.pendingQuestion, null);
  } finally { unmarked.cleanup(); }
  const w = takeInStop();
  try {
    const out = testing.answerRun(w.e2.id, 'gate-w9-3', { decision: 'continue' }, 'ann');
    assert.equal(typeof out?.then, 'function');
    assert.equal(await out, undefined);
    assert.equal(w.e2.pendingQuestion, null);
  } finally { w.cleanup(); }
}));

test('slice 3 (D11, D13) liveSliceOf: a take-in in flight reads going; a refusal shows only on the question it was for', async () => {
  const w = stoppedFeature({ three: false });
  try {
    const { liveSliceOf } = await import('../ui/server.mjs');
    const plain = liveSliceOf(w.e2.pipelineId);
    assert.deepEqual(plain.stop, { reason: 'objection', held: false });
    w.e2.takingIn = 'gate-w9-3';
    const taking = liveSliceOf(w.e2.pipelineId);
    assert.deepEqual([taking.stop.going, taking.asking], [true, true]);
    w.e2.takingIn = null;
    w.e2.takeInRefused = { id: 'gate-w9-3', reason: TAKE_REASON };
    assert.equal(liveSliceOf(w.e2.pipelineId).stop.refused, TAKE_REASON);
    w.e2.takeInRefused = { id: 'gate-w9-2', reason: TAKE_REASON };
    assert.deepEqual(liveSliceOf(w.e2.pipelineId), plain, 'a refusal of an earlier question is not shown');
  } finally { w.cleanup(); }
});

test('slice 3 (D4): a settled run delivers the held answers that waited for its teardown', () => withEnvVars(SMALL_ON, async () => {
  const w = takeInStop({ three: true });
  try {
    const r = await post('/api/answer', { runId: w.e2.id, id: 'gate-w9-3', payload: { decision: 'continue' } });
    assert.deepEqual(await r.json(), { ok: true, held: true });
    // Run 3 reads done and has settled; only the settle hook runs (no scheduler tick, no run frame).
    Object.assign(w.e3, { status: 'done', settled: true });
    setPipe(w.e3.pipelineId, 'done');
    await testing.afterRunSettled(plainSettle(w.e3.pipelineId));
    for (let i = 0; i < 50 && !w.answered.length; i++) await sleep(10);
    assert.deepEqual([w.taken.length, w.answered.length], [1, 1]);
    assert.equal(w.e2.pendingQuestion, null);
  } finally { w.cleanup(); }
}));

// ── Shaper small runs, slice 5 (R-po-3, R-arch-1): a boot resume holds the turn until it fails or is live ────────────
test("S5: run 9's boot resume fails, the next tick starts run 10", () => withEnvVars(SMALL_ON, async () => {
  const repo = templateRepo('s5-boot', { branch: 'main', user: true, files: { 'README.md': 'boot\n' } });
  writeStoreMeta(projectKey(repo), 'project', { key: projectKey(repo), name: 'S5', path: repo });
  const fx = world(repo, { done: [1, 2, 3, 4, 8, 11], states: { 5: { pipe: 'paused' }, 9: { pipe: 'paused' } } });
  // The finished runs' work branches exist, so run 10 can start from them.
  for (const run of [1, 2, 3, 4, 8, 11]) git(repo, 'branch', `feat/${fx.pipelineOf(run)}`);
  const pid9 = fx.pipelineOf(9);
  const [t10, t13] = [fx.ticketOf(10), fx.ticketOf(13)];
  getDb().prepare('UPDATE pipelines SET resume_point = ? WHERE id = ?').run('{"version":2,"pauseReason":"drain"}', pid9);
  try {
    const seen = [];
    const resume = async (pid) => {
      seen.push({ pid, resuming: testing.liveSliceOf(pid)?.resuming, gate: sliceGateState(getTicket(t10), { live: testing.liveSliceOf })?.state });
      throw new Error('refused');
    };
    const out = await testing.autoResumeOnBoot({ env: {}, resume });
    assert.deepEqual(seen.filter((s) => s.pid === pid9), [{ pid: pid9, resuming: true, gate: 'waiting' }], 'run 10 waits while run 9 is being resumed');
    assert.deepEqual(out.failed.filter((f) => f.pipelineId === pid9).map((f) => f.error), ['refused']);
    assert.equal(testing.liveSliceOf(pid9), null, 'the failed resume frees the turn');
    assert.equal(sliceGateState(getTicket(t10), { live: testing.liveSliceOf })?.state, 'ok');
    // A tick another request started may still be in flight (schedulerTick answers null then): wait for a pass of our own.
    let pass = null;
    for (const end = Date.now() + 5000; (pass = await schedulerTick()) === null && Date.now() < end;) await sleep(20);
    assert.ok(pass, 'a scheduler pass ran');
    assert.ok(pass.fired.includes(t10), `run 10 starts: ${getTicket(t10).failReason || JSON.stringify(pass)}`);
    assert.ok(pass.waiting.includes(t13), 'run 13 waits behind run 10');
  } finally {
    if (getTicket(t10)?.status === 'fired') await firedRun(t10);
    getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}));

// ── Shaper small runs, slice 7 (R-po-4, R-po-5): a resume waits its turn ────────────────────────────────────────────
/** An 8-run feature on an onboarded project, marked small-runs unless `marked` is false: run 1 done; run `paused` a
 *  paused run resumeRun can resume (worktree on disk, resume point); run `working` a running runs-map entry. */
async function resumeServerWorld({ paused = 5, working = 8, marked = true, second = null, rp = {} } = {}) {
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const proj = mkdtempSync(join(tmpdir(), 'worca-s7-proj-'));
  const wt = mkdtempSync(join(tmpdir(), 'worca-s7-wt-'));
  await addProject({ name: `s7-${nextId()}`, path: proj });
  const origin = pipe('done');
  const f = createSliceFeature({ pipelineId: origin, projectDir: proj, title: 'Resume waits', outline: outlineOf(8), perspectives: ['product'],
    workflowId: 'wf_shape', startedBy: 'ann', base: { mock: true }, smallRuns: false });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run(JSON.stringify({ smallRuns: true }), origin);
  const { id: pid } = await seedPipeline(proj, { title: `run ${paused}`, status: 'paused',
    branch: { source: 'main', feature: 'f', worktreeDir: wt, reusedExisting: false }, resumePoint: graphResumePoint({ pipelineDir: proj, ...rp }) });
  fire(f.id, paused, pid);
  let pid2 = null;
  if (second != null) {
    const wt2 = mkdtempSync(join(tmpdir(), 'worca-s7-wt-'));
    ({ id: pid2 } = await seedPipeline(proj, { title: `run ${second}`, status: 'paused',
      branch: { source: 'main', feature: 'f', worktreeDir: wt2, reusedExisting: false }, resumePoint: graphResumePoint({ pipelineDir: proj }) }));
    fire(f.id, second, pid2);
  }
  const going = working == null ? null : pipe('running');
  if (going) fire(f.id, working, going);
  const goingEntry = going ? liveEntry(going) : null;
  // No other run of the feature may start by itself: these tests are about the paused run only.
  const quiet = () => getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  quiet();
  const entriesOf = (of = pid) => [...runs.values()].filter((e) => e.pipelineId === of);
  /** The working run finishes: only a scheduler pass may deliver what waited for it. */
  const finishWorking = () => { dropEntry(goingEntry); setPipe(going, 'done'); };
  const cleanup = async () => {
    quiet();
    for (const id of [pid, pid2]) if (id) testing.heldStops?.dropResume(id);
    if (goingEntry) dropEntry(goingEntry);
    for (const e of [...entriesOf(), ...(pid2 ? entriesOf(pid2) : [])]) {
      try { await e.orch?.stop?.(); } catch { /* best effort */ }
      if (e.launch) await Promise.race([e.launch.catch(() => {}), sleep(5000)]);
      runs.delete(e.id);
    }
    rmSync(proj, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(wt, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  return { f, pid, pid2, entriesOf, finishWorking, cleanup };
}
const eventsOf = (pid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid).map((r) => r.text);
const storedStatus = (pid) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(pid).status;

test('slice 7: resumeRun on paused run 5 while run 8 works returns {ok, held: true, after: 8} and writes nothing', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    const events = eventsOf(w.pid);
    // ignoreCostCap is the first thing a resume would write.
    const out = await testing.resumeRun(w.pid, { by: 'ann', ignoreCostCap: true });
    assert.deepEqual(out, { ok: true, held: true, pipelineId: w.pid, after: 8 });
    assert.deepEqual(w.entriesOf(), [], 'no runs-map entry');
    assert.deepEqual(eventsOf(w.pid), events, 'no audit line');
    assert.ok(!readCostCapOverride(w.pid), 'no cost override');
    assert.equal(storedStatus(w.pid), 'paused');
  } finally { await w.cleanup(); }
}));

test('slice 7: POST /api/resume passes the held answer through, with no runId', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    const r = await post('/api/resume', { pipelineId: w.pid });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, held: true, pipelineId: w.pid, after: 8 });
    assert.deepEqual(w.entriesOf(), []);
  } finally { await w.cleanup(); }
}));

test('slice 7: liveSliceOf composes the held-stops overlay', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    await testing.resumeRun(w.pid, { by: 'ann' });
    const held = testing.liveSliceOf(w.pid);
    assert.deepEqual(held?.heldResume, { after: 8 });
    assert.equal(held.status, 'paused');
    assert.ok(!held.resuming);
    assert.equal(testing.heldStops.dropResume(w.pid), true);
    assert.equal(testing.liveSliceOf(w.pid), null, 'neither field once dropped');
  } finally { await w.cleanup(); }
}));

test('slice 7: once run 8 is done, the next tick resumes held run 5 through resumeRun, as the person who asked', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    await testing.resumeRun(w.pid, { by: 'ann' });
    assert.deepEqual(w.entriesOf(), []);
    w.finishWorking();
    for (const end = Date.now() + 5000; (await schedulerTick()) === null && Date.now() < end;) await sleep(20);
    for (let i = 0; i < 250 && !w.entriesOf().length; i++) await sleep(20);
    const [entry] = w.entriesOf();
    assert.ok(entry, 'run 5 is resumed');
    assert.equal(entry.lastAction.by, 'ann');
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null);
  } finally { await w.cleanup(); }
}));

for (const [name, env, marked] of [['flag on, a feature not marked small-runs', SMALL_ON, false], ['flag off, a marked feature', SMALL_OFF, true]]) {
  test(`slice 7: resumeRun on paused run 3 with run 2 working starts it at once (${name})`, () => withEnvVars(env, async () => {
    const w = await resumeServerWorld({ paused: 3, working: 2, marked });
    try {
      const out = await testing.resumeRun(w.pid, { by: 'ann' });
      assert.ok(out.runId, JSON.stringify(out));
      assert.ok(!out.held);
      assert.ok(runs.has(out.runId), 'a runs-map entry exists');
      assert.equal(testing.heldStops.heldResumeOf(w.pid), null, 'no held resume is recorded');
    } finally { await w.cleanup(); }
  }));
}

test('slice 7: pauseRun on a held paused run drops the hold and does not throw CANNOT_PAUSE', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    // The entry this server holds for a run it paused: its harness cannot pause it again.
    const entry = { id: `s7-paused-${w.pid}`, kind: 'run', pipelineId: w.pid, status: 'paused', events: [], pendingQuestion: null,
      orch: { pause: () => false, state: {} } };
    runs.set(entry.id, entry);
    assert.equal((await testing.resumeRun(w.pid, { by: 'ann' })).held, true);
    assert.deepEqual(testing.liveSliceOf(w.pid).heldResume, { after: 8 });
    testing.chatActions.pause(entry.id, 'ann');
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null);
    assert.equal('heldResume' in testing.liveSliceOf(w.pid), false);
    assert.equal(entry.status, 'paused', 'still paused, not pausing');
    assert.throws(() => testing.chatActions.pause(entry.id, 'ann'), (e) => e.code === 'CANNOT_PAUSE', 'with nothing held, as today');
  } finally { await w.cleanup(); }
}));

test('slice 7: stopPausedPipeline on a held run with no runs-map entry drops the hold', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    assert.equal((await testing.resumeRun(w.pid, { by: 'ann' })).held, true);
    assert.deepEqual(w.entriesOf(), []);
    const out = await testing.stopPausedPipeline(w.pid, 'ann');
    assert.equal(out.status, 'stopped');
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null);
  } finally { await w.cleanup(); }
}));

// Direction d0b6a6288 (D14, R-po-4): the feature card's and a stop line's Resume go through resumeRun, held at their turn.
test("slice 7: the feature route's Resume on paused run 5 while run 8 works is held after run 8 and starts once run 8 is done", () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    const r = await post(`/api/shape/features/${w.f.id}/resume`, { index: 5 });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.action, 'resume');
    assert.equal(body.held, true);
    assert.equal(body.after, 8);
    assert.equal(body.runId, undefined, 'nothing started');
    assert.deepEqual(w.entriesOf(), []);
    assert.deepEqual(testing.heldStops.heldResumeOf(w.pid), { after: 8 });
    assert.equal(storedStatus(w.pid), 'paused');
    w.finishWorking();
    for (const end = Date.now() + 5000; (await schedulerTick()) === null && Date.now() < end;) await sleep(20);
    for (let i = 0; i < 250 && !w.entriesOf().length; i++) await sleep(20);
    assert.ok(w.entriesOf().length, 'run 5 is resumed at its turn');
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null);
  } finally { await w.cleanup(); }
}));

test('slice 7: a resume over its pipeline cost cap is refused at once (needsOverride), not held', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    await post('/api/settings', { pipelineCostLimitUsd: 1 });
    getDb().prepare('UPDATE pipelines SET total_cost_usd = 2 WHERE id = ?').run(w.pid);
    await assert.rejects(testing.resumeRun(w.pid, { by: 'ann' }), (e) => e.status === 403 && e.body?.needsOverride === true);
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null, 'nothing is held');
    assert.equal(testing.liveSliceOf(w.pid), null);
  } finally { await post('/api/settings', { pipelineCostLimitUsd: null }); await w.cleanup(); }
}));

test('slice 7: two resumes at once on runs 3 and 5 with nothing going: run 3 starts, run 5 is held after it', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld({ paused: 3, second: 5, working: null });
  try {
    const [three, five] = await Promise.all([testing.resumeRun(w.pid, { by: 'ann' }), testing.resumeRun(w.pid2, { by: 'bo' })]);
    assert.ok(three.runId, JSON.stringify(three));
    assert.deepEqual(five, { ok: true, held: true, pipelineId: w.pid2, after: 3 });
    assert.deepEqual(w.entriesOf(w.pid2), [], 'run 5 started nothing');
    assert.equal(testing.liveSliceOf(w.pid)?.resuming, undefined, 'the claim is released once run 3 is live');
  } finally { await w.cleanup(); }
}));

test('slice 7: a second Resume while a held resume is being delivered answers 409, not a second run', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    await testing.resumeRun(w.pid, { by: 'ann' });
    w.finishWorking();
    const delivery = testing.heldStops.deliver();
    assert.equal(testing.liveSliceOf(w.pid)?.resuming, true, 'it reads as being resumed');
    const r = await post('/api/resume', { pipelineId: w.pid });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'RESUME_IN_FLIGHT');
    await delivery;
    assert.equal(w.entriesOf().length, 1, 'one run');
  } finally { await w.cleanup(); }
}));

test('slice 7: a scheduled-resume ticket held for its turn is kept for the next tick, not fired', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    const out = await testing.fireResumeTicket({ id: 'tk-s7', createdBy: 'ann', request: {} }, w.pid);
    assert.deepEqual(out, { ok: false, hold: true, error: 'the run waits its turn (after run 8)' });
    assert.deepEqual(testing.heldStops.heldResumeOf(w.pid), { after: 8 });
    assert.deepEqual(w.entriesOf(), []);
    assert.ok(!eventsOf(w.pid).some((t) => /resumed/i.test(t)), 'no "resumed" audit line');
  } finally { await w.cleanup(); }
}));

test('slice 7: a scheduled-resume ticket that fires while its held resume is being delivered is held, not failed', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    await testing.resumeRun(w.pid, { by: 'ann' });
    w.finishWorking();
    const delivery = testing.heldStops.deliver();
    const out = await testing.fireResumeTicket({ id: 'tk-s7-flight', createdBy: 'ann', request: {} }, w.pid);
    assert.deepEqual(out, { ok: false, hold: true, error: 'the run is being resumed' }, 'the next tick skips the resumed run');
    await delivery;
    assert.equal(w.entriesOf().length, 1, 'one run');
  } finally { await w.cleanup(); }
}));

/** A network-paused resume point (network-wait.mjs) the watch would resume once the endpoint answers. */
const netPaused = () => ({ pauseReason: 'recoverable', pauseClass: 'network',
  network: { since: new Date(Date.now() - 10 * 60_000).toISOString(), origin: 'https://api.anthropic.com', reachable: false, waiting: false } });

test('slice 7: the network watch leaves a held run alone: no resume, no "Network back" line', () => withEnvVars({ ...SMALL_ON, WORCA_NETWORK_WAIT: '1' }, async () => {
  const w = await resumeServerWorld({ rp: netPaused() });
  try {
    assert.equal((await testing.resumeRun(w.pid, { by: 'ann' })).held, true);
    testing.setNetworkProbe(async () => true);
    for (let i = 0; i < 2; i++) assert.ok(!(await testing.networkWatchTick()).includes(w.pid));
    assert.deepEqual(w.entriesOf(), []);
    assert.ok(!eventsOf(w.pid).some((t) => /^Network back/.test(t)), 'no "Network back" audit line');
    assert.deepEqual(testing.heldStops.heldResumeOf(w.pid), { after: 8 });
  } finally { await w.cleanup(); }
}));

test('slice 7: Pause on a held run cancels its resume tickets, and neither a tick nor the network watch holds it again', () => withEnvVars({ ...SMALL_ON, WORCA_NETWORK_WAIT: '1' }, async () => {
  const w = await resumeServerWorld({ rp: netPaused() });
  try {
    const entry = { id: `s7-paused-${w.pid}`, kind: 'run', pipelineId: w.pid, status: 'paused', events: [], pendingQuestion: null,
      orch: { pause: () => false, state: {} } };
    runs.set(entry.id, entry);
    const r = await post('/api/schedules/resume', { pipelineId: w.pid, scheduledFor: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(r.status, 202, await r.text());
    const ticket = getDb().prepare("SELECT id FROM scheduled_runs WHERE resume_pipeline_id = ? AND status = 'scheduled'").get(w.pid);
    assert.ok(ticket);
    assert.equal((await testing.resumeRun(w.pid, { by: 'ann' })).held, true);
    testing.chatActions.pause(entry.id, 'ann');
    assert.equal(getTicket(ticket.id).status, 'canceled', 'the resume ticket is canceled');
    await schedulerTick();
    testing.setNetworkProbe(async () => true);
    assert.ok(!(await testing.networkWatchTick()).includes(w.pid), 'the network watch does not take it up');
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null, 'nothing holds it again');
    assert.deepEqual(w.entriesOf().filter((e) => e !== entry), [], 'nothing started');
    assert.equal(testing.heldStops.watchSkips(w.pid), true);
    testing.heldStops.holdResume(w.pid, { by: 'ann' });
    testing.heldStops.dropResume(w.pid);
    assert.equal(testing.heldStops.watchSkips(w.pid), false, "the next Resume clears the Pause's drop");
  } finally { runs.delete(`s7-paused-${w.pid}`); await w.cleanup(); }
}));

// ── Shaper small runs, slice 8 (R-ux-2): the run page learns before the press which run a Resume would wait for ──
test('s8: GET /api/shape/pipelines/:pid/slice of paused run 5 while run 8 works returns resumeAfter 8', () => withEnvVars(SMALL_ON, async () => {
  const w = await resumeServerWorld();
  try {
    const r = await get(`/api/shape/pipelines/${w.pid}/slice`);
    assert.equal(r.status, 200);
    const info = await r.json();
    assert.deepEqual([info.index, info.state, info.resumeAfter], [5, 'paused', 8]);
    assert.equal(testing.heldStops.heldResumeOf(w.pid), null, 'reading holds nothing');
  } finally { await w.cleanup(); }
}));

// ── Shaper small runs, slice 9 (R-arch-3): no live slice reads "paused with a held stop answer" ─────────────────────
test('slice 9: pausing a run with a held stop answer clears its question, so liveSliceOf carries no stop', () => withEnvVars(SMALL_ON, async () => {
  const pid = pipe('running');
  const entry = liveEntry(pid, { pending: { id: 'q2', kind: 'plan', stop: { reason: 'requirement', run: 2 } } });
  const answered = [];
  entry.heldStop = { id: 'q2', payload: { decision: 'keep' }, by: 'ann', after: 3 };
  entry.orch.pause = () => true;
  entry.orch.answer = (...args) => { answered.push(args); };
  try {
    assert.equal(testing.liveSliceOf(pid).stop.held, true);
    pauseRun(entry.id, 'ann');
    assert.equal(entry.status, 'pausing');
    assert.equal(entry.pendingQuestion, null);
    assert.equal('stop' in testing.liveSliceOf(pid), false, 'no stop while pausing');
    entry.status = 'paused';                                 // as the state and done frames set it
    const paused = testing.liveSliceOf(pid);
    assert.equal(paused.status, 'paused');
    assert.equal('stop' in paused, false, 'no stop once paused');
    await testing.heldStops.deliver();
    assert.equal(entry.heldStop, null, 'the stale held answer is dropped');
    assert.deepEqual(answered, [], 'nothing is sent to the run');
  } finally { dropEntry(entry); }
}));
