// test/api-shape-first.test.mjs — Shape it first on the server (spec D2, D9, D10, D12): the hello feature, `shape` on
// POST /api/run, the gated workflow list, POST /api/runs/:id/answer and its never-stranded fallback.
// Boot = the server-mock-mode recipe (temp home + WORCA_MOCK BEFORE the dynamic import; listen on the MODULE server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let srv, base, wsBase, runs;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const savedMock = process.env.WORCA_MOCK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withGate(on, fn) {
  if (on) process.env.WORCA_SHAPE_FIRST = '1'; else delete process.env.WORCA_SHAPE_FIRST;
  try { return await fn(); } finally { delete process.env.WORCA_SHAPE_FIRST; }
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});
after(async () => {
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  delete process.env.WORCA_SHAPE_FIRST;
  if (savedMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = savedMock;
});

function hello() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase);
    const t = setTimeout(() => { ws.terminate(); reject(new Error('no hello')); }, 3000);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type !== 'hello') return;
      clearTimeout(t);
      ws.close();
      resolve(msg);
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
async function untilSettled(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    await sleep(50);
  }
  throw new Error(`run ${runId} never settled`);
}

const neverCreatedDir = () => join(tmpdir(), `worca-cc-shape-never-${process.pid}-${Date.now()}`);

/** A live run stand-in holding a plan approval stop. */
function fakePlanRun(id, answer) {
  runs.set(id, { id, kind: 'run', status: 'running', events: [], orch: { answer }, pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan' } });
}

test('gate off: hello says shapeFirst false and the workflow list has no wf_shape', () => withGate(false, async () => {
  assert.equal((await hello()).features.shapeFirst, false);
  const { workflows } = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(!workflows.some((w) => w.id === 'wf_shape'));
}));

test('gate off: shape and the shape workflows are refused before any target is created; the answer route is 404', () => withGate(false, async () => {
  const dir = neverCreatedDir();
  let r = await post('/api/run', { prompt: 'x', projectDir: dir, shape: { perspectives: ['qa'] } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /shape is not available/);
  r = await post('/api/run', { prompt: 'x', projectDir: dir, workflowId: 'wf_shape' });
  assert.equal(r.status, 400);
  assert.equal(existsSync(dir), false, 'no refusal created the target dir');

  fakePlanRun('shape-off-run', () => true);
  try {
    r = await post('/api/runs/shape-off-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 404, 'a live run is not reachable through the gated route');
  } finally { runs.delete('shape-off-run'); }
}));

test('gate on: hello says shapeFirst true and wf_shape follows Memory defragment', () => withGate(true, async () => {
  assert.equal((await hello()).features.shapeFirst, true);
  const { workflows } = await (await fetch(`${base}/api/workflows`)).json();
  const ids = workflows.map((w) => w.id);
  assert.equal(ids.indexOf('wf_shape'), ids.indexOf('wf_memory_defrag') + 1);
}));

test('gate on: an unknown perspective is a 400 naming it, and the shape workflows cannot be deleted', () => withGate(true, async () => {
  const r = await post('/api/run', { prompt: 'x', projectDir: neverCreatedDir(), shape: { perspectives: ['ops'] } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ops/);
  for (const id of ['wf_shape', 'wf_shape_ux']) {
    const d = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE' });
    assert.equal(d.status, 400, id);
    assert.match((await d.json()).error, /cannot be deleted/);
  }
}));

test('gate on: a shaped mock run stops at the plan approval and approving finishes it', () => withGate(true, async () => {
  const dir = gitDir('shape-first');
  const r = await post('/api/run', { prompt: 'Add a charts page.', projectDir: dir, shape: { perspectives: ['qa'] } });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  const entry = runs.get(runId);

  let pq;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    pq = entry.pendingQuestion;
    if (pq && pq.kind === 'plan') break;
    if (pq) {
      const a = await post('/api/answer', { runId, id: pq.id, payload: { answers: [] } });
      assert.equal(a.status, 200, await a.text());
    }
    assert.ok(!settled.has(String(entry.status || '')), `the run settled (${entry.status}) before the plan stop`);
    await sleep(50);
  }
  assert.equal(pq?.kind, 'plan', 'the run reached the plan approval');
  assert.ok(pq.plan.file, 'the stop names the plan file');
  assert.equal(pq.plan.check.total, 8);
  assert.equal(pq.plan.revisable, true);

  const a = await post(`/api/runs/${runId}/answer`, { id: pq.id, decision: 'approve' });
  assert.equal(a.status, 200, await a.text());
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
}));

test('gate on: the plan route answers the held id and refuses the rest', () => withGate(true, async () => {
  const calls = [];
  fakePlanRun('shape-route-run', (qid, payload, by) => { calls.push({ qid, payload, by }); return true; });
  try {
    let r = await post('/api/runs/shape-route-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 200, await r.text());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload, { decision: 'approve' });

    r = await post('/api/runs/shape-route-run/answer', { id: 'some-other-id', decision: 'approve' });
    assert.equal(r.status, 409);
    r = await post('/api/runs/no-such-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 404);
    assert.equal(calls.length, 1, 'refused answers never reached the run');
  } finally { runs.delete('shape-route-run'); }
}));

test('gate on: an invalid answer is a 422 with the run\'s field errors', () => withGate(true, async () => {
  const errors = [{ path: 'feedback', code: 'required', message: 'revise needs feedback text' }];
  fakePlanRun('shape-422-run', () => { throw Object.assign(new Error('invalid'), { code: 'INVALID_ANSWER', errors }); });
  try {
    const r = await post('/api/runs/shape-422-run/answer', { id: 'plan-n_refine-1', decision: 'revise' });
    assert.equal(r.status, 422);
    assert.deepEqual((await r.json()).errors, errors);
  } finally { runs.delete('shape-422-run'); }
}));

test('gate off: a held plan is still answered through POST /api/answer (never stranded)', () => withGate(false, async () => {
  const calls = [];
  fakePlanRun('shape-stranded-run', (qid, payload) => { calls.push({ qid, payload }); return true; });
  try {
    const r = await post('/api/answer', { runId: 'shape-stranded-run', id: 'plan-n_refine-1', payload: { decision: 'approve' } });
    assert.equal(r.status, 200, await r.text());
    assert.equal(calls.length, 1);
  } finally { runs.delete('shape-stranded-run'); }
}));
