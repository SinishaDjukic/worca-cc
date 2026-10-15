// test/shape-server-slices.test.mjs — Shape it first, plan in slices, on the server (spec §3.8, L9–L11): the gated
// /api/shape/… routes, the live overlay, the shape-feature broadcasts, the Chat card's REST strip and the answer
// route's outline fields. Boot = the server-mock-mode recipe of test/api-shape-first.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createThread, linkRun as askLinkRun } from '../src/core/ask/store.mjs';
import { createSliceFeature, recordShapePlan, retireFeaturesOf } from '../src/core/shape/features.mjs';

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
