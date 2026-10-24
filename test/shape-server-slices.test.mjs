// test/shape-server-slices.test.mjs — Shape it first, plan in slices, on the server (spec §3.8, L9–L11): the gated
// /api/shape/… routes, the live overlay, the shape-feature broadcasts, the Chat card's REST strip and the answer
// route's outline fields. Boot = the server-mock-mode recipe of test/api-shape-first.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createThread, linkRun as askLinkRun, listMessages } from '../src/core/ask/store.mjs';
import { createSliceFeature, recordShapePlan, retireFeaturesOf } from '../src/core/shape/features.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { NO_ADO, REMOTES_V, okRun, failRun, argOf, ghCalls, git, stubShip, shipKit } from './helpers/ship-world.mjs';

useTempHome(after, 'worca-shape-server-slices-');

let srv, base, wsBase, runs, testing, project;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const get = (p) => fetch(`${base}${p}`);
const savedMock = process.env.WORCA_MOCK;
const savedFlags = process.env.WORCA_FLAGS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withGate(on, fn) {
  process.env.WORCA_FLAGS = on ? 'shapeFirst' : '-shapeFirst';   // WORCA_FLAGS locks it over settings.json
  try { return await fn(); } finally { process.env.WORCA_FLAGS = '-shapeFirst'; }
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
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
  if (savedFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = savedFlags;
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

// ── the gate ─────────────────────────────────────────────────────────────────
test('gate off: every /api/shape/ route is 404 and POST /api/run with shape.slice says shape is not available', () => withGate(false, async () => {
  for (const p of ['/api/shape/features/x', '/api/shape/plans']) assert.equal((await get(p)).status, 404, p);
  for (const a of ['cancel', 'resume', 'replan', 'approve-each']) {
    assert.equal((await post(`/api/shape/features/x/${a}`, { on: true })).status, 404, a);
  }
  const r = await post('/api/run', { prompt: 'x', projectDir: project, shape: { slice: { feature: 'f', index: 2 } } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /shape is not available on this server/);
}));

test('gate on, not internal: POST /api/run with shape.slice is refused as an unknown field', () => withGate(true, async () => {
  const r = await post('/api/run', { prompt: 'x', projectDir: project, shape: { slice: { feature: 'f', index: 2 } } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /shape has unknown field\(s\): slice/);
}));

// ── GET /api/shape/features/:id ──────────────────────────────────────────────
test('GET /api/schedules: a chain whose first run is a slice carries its feature; with the gate off it does not (D17)', async () => {
  const { id, pid } = mk(3, 'running');
  const chainOf = async () => (await (await get('/api/schedules')).json()).chains.find((c) => c.members[0].pipelineId === pid);
  await withGate(true, async () => {
    const c = await chainOf();
    assert.ok(c, 'the chain is listed');
    assert.equal(c.feature.id, id);
    assert.equal(c.feature.title, 'Charts');
    assert.deepEqual(c.feature.slices.map((x) => x.index), [1, 2, 3]);
  });
  await withGate(false, async () => {
    const c = await chainOf();
    assert.ok(c);
    assert.equal('feature' in c, false);
  });
});

test('GET /api/shape/pipelines/:pid/slice: the slice\'s place in its feature; 404 for a plain run; the gate refuses when off', async () => {
  const f = mk(3, 'done');
  const p2 = pipe('running');
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  await withGate(true, async () => {
    const r = await get(`/api/shape/pipelines/${p2}/slice`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual({ ...body, state: undefined }, { featureId: f.id, title: 'Charts', index: 2, total: 3, sliceTitle: 'Slice 2',
      state: undefined, next: { index: 3, title: 'Slice 3', state: 'planned' }, threadId: null });
    assert.equal((await get('/api/shape/pipelines/p-plain-zz/slice')).status, 404);
  });
  await withGate(false, async () => {
    assert.equal((await get(`/api/shape/pipelines/${p2}/slice`)).status, 404);
  });
});

test('GET feature: the view, 404 for an unknown id, and the re-plan successor with replanOf', () => withGate(true, async () => {
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
}));

test('GET feature: a settled entry is ignored (the pipelines row decides), a paused or plan-asking one is shown (F26)', () => withGate(true, async () => {
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
}));

// ── actions ──────────────────────────────────────────────────────────────────
test('cancel cancels the open tickets, answers the view and broadcasts shape-feature', () => withGate(true, async () => {
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
}));

test('approve-each validates its body, stores the switch and 404s an unknown feature', () => withGate(true, async () => {
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
}));

test('resume: nothing stopped is a 409, a stopped slice restarts as a new ticket', () => withGate(true, async () => {
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
}));

test('replan answers the ticket as runId and a second replan is a 409', () => withGate(true, async () => {
  const f = mk(2, 'stopped');
  let r = await post(`/api/shape/features/${f.id}/replan`, {});
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.ok(body.runId);
  r = await post(`/api/shape/features/${f.id}/replan`, {});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /replanning/);
}));

// ── plans ────────────────────────────────────────────────────────────────────
test('GET /api/shape/plans lists the plans newest first, with a paused row as paused and the feature view attached', () => withGate(true, async () => {
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
}));

test('GET /api/shape/plans: a plan whose slice 1 is a replanned feature carries the successor view (F47)', () => withGate(true, async () => {
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
}));

// ── the Chat card's REST strip (F46, F48) ────────────────────────────────────
test('GET /api/ask/runs/:id carries shaping.feature for slice 1 only, and only while the gate is on', async () => {
  const f = mk(2, 'done');
  const slice2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id).ticket_id;
  const p2 = pipe('running');
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(p2, slice2);
  const lone = pipe('done');
  try {
    await withGate(true, async () => {
      const one = await (await get(`/api/ask/runs/${f.pid}`)).json();
      assert.deepEqual(one.state.shaping, { feature: { id: f.id, index: 1 } });
      const two = await (await get(`/api/ask/runs/${p2}`)).json();
      assert.ok(!two.state.shaping, 'a slice-2 pipeline gets no strip');
      const none = await (await get(`/api/ask/runs/${lone}`)).json();
      assert.ok(!none.state.shaping, 'a run with no feature gets no strip');
    });
    await withGate(false, async () => {
      const off = await (await get(`/api/ask/runs/${f.pid}`)).json();
      assert.ok(!off.state.shaping, 'the gate off gives no strip');
    });
  } finally { retireFeaturesOf(f.pid); }
});

// ── the answer route forwards the outline fields ─────────────────────────────
test('POST /api/runs/:id/answer forwards edits and approveEach to the run', () => withGate(true, async () => {
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
}));

// ── the wireRun hook (F42, F49) ──────────────────────────────────────────────
/** A wired fake slice orchestrator for pipeline `pid`; emit through `orch`. */
function wireSlice(pid) {
  const orch = Object.assign(new EventEmitter(), { runShape: { slice: { feature: 'f', index: 2 } }, state: { shaping: {} } });
  const entry = { id: `wired-${pid}`, kind: 'run', status: 'running', events: [], pipelineId: pid, orch };
  runs.set(entry.id, entry);
  testing.wireRun(entry);
  return { orch, entry };
}

test('wireRun: a slice run broadcasts its feature when status, ask kind or approval changes, and not on token frames (F49)', () => withGate(true, async () => {
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
}));

test('wireRun: with the gate off a slice run sends no shape-feature frame', () => withGate(false, async () => {
  const f = mk(2, 'running');
  const { orch, entry } = wireSlice(f.pid);
  const c = await collector();
  try {
    orch.emit('question', { id: 'plan-n-1', kind: 'plan' });
    await sleep(80);
    assert.equal(c.frames('shape-feature').length, 0);
  } finally { c.close(); runs.delete(entry.id); }
}));

test('wireRun: a shape-feature event on the orchestrator is broadcast and kept out of the replay', () => withGate(true, async () => {
  const { orch, entry } = wireSlice(pipe('running'));
  const c = await collector();
  try {
    orch.emit('shape-feature', { id: 'feat_x' });
    await sleep(60);
    assert.equal(c.frames('shape-feature').filter((m) => m.id === 'feat_x').length, 1);
    assert.ok(!entry.events.some((e) => e.type === 'shape-feature'));
  } finally { c.close(); runs.delete(entry.id); }
}));

// ── errors never escape (F29, F42): LAST in the file, they break the shared temp DB ──────────────────────────
test('errors never escape: with shape_feature_slices gone resume answers 500, the run frame still lands and the server lives', () => withGate(true, async () => {
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
}));

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

test('openMemberPr: a ready PR on the chain root for slice 1, stacked on slice 1\'s branch for slice 2; no draft', () => withGate(true, () => withEnvVars(NO_ADO, async () => {
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
})));

test('openMemberPr: a run that already has a live PR opens no second one', () => withGate(true, () => withEnvVars(NO_ADO, async () => {
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
})));

test('afterRunSettled: a done slice opens no PR (one ship flow); it still offers the Ship card', () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try {
    const seen = [];
    stubGh(seen);
    const orch = (pid, status, slice = { feature: 'f', index: 1 }) => ({ runShape: slice ? { slice } : null, getState: () => ({ status, id: pid }) });
    await withGate(true, async () => {
      const a = stackedFeature();
      await testing.afterRunSettled(orch(a.p1, 'done'));
      await testing.afterRunSettled(orch(a.p2, 'done'));
      assert.equal(creates(seen).length, 0, 'no draft PR per slice');
      assert.equal(draftOf(a.f.id, 1), null);
    });
  } finally { gitInfo.reset(); }
}));

// ── D24, D25: POST /api/shape/features/:id/ship ─────────────────────────────────────────────────────────────────
const { shipWorld, cleanup: shipCleanup } = shipKit({ nextId, outlineOf });
after(shipCleanup);
const ship = (id, mode) => post(`/api/shape/features/${id}/ship`, { mode });
const shipT = (name, fn) => test(name, () => withGate(true, () => withEnvVars(NO_ADO, async () => {
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  try { await fn(); } finally { gitInfo.reset(); }
})));

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

test('Ship as with the gate off answers the gate\'s refusal', () => withGate(false, async () => {
  assert.equal((await post('/api/shape/features/feat_x/ship', { mode: 'one' })).status, 404);
  assert.equal((await post('/api/shape/features/feat_x/ship', { mode: 'stacked', watch: true })).status, 404, 'with watch too');
}));

// ── Shaper s2: the Chat feature card route, the slice route's thread ─────────────
const fire = (featureId, idx, pid) => getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?")
  .run(pid, getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(featureId, idx).ticket_id);

test('GET /api/shape/pipelines/:pid/card: 404 gate off, unknown or plain run; a shaped run\'s log; the feature with its ask', () => withGate(true, async () => {
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
    await withGate(false, async () => assert.equal((await get(`/api/shape/pipelines/${p1}/card`)).status, 404));
  } finally {
    dropEntry(e2);
    getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE id IN (SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ?)").run(fid);
  }
}));

test('GET /api/shape/pipelines/:pid/slice carries the feature thread', () => withGate(true, async () => {
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
}));

test('re-plan from the card: the re-plan run\'s Split ask is the feature\'s ask, and the old URL still resolves', () => withGate(true, async () => {
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
}));

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
