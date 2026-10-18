// test/api-shape-first.test.mjs — Shape it first on the server (spec D2, D9, D10, D12): the hello feature, `shape` on
// POST /api/run, the gated workflow list, POST /api/runs/:id/answer and its never-stranded fallback.
// Boot = the server-mock-mode recipe (temp home + WORCA_MOCK BEFORE the dynamic import; listen on the MODULE server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { shipKit, stubShip, withShip, ghCalls } from './helpers/ship-world.mjs';
import { getDb } from '../src/core/db.mjs';
import { createThread, linkRun as askLinkRun, listMessages } from '../src/core/ask/store.mjs';

useTempHome(after);

let srv, base, wsBase, runs;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
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
  if (savedFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = savedFlags;
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
  assert.equal((await hello()).flags.shapeFirst, false);
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
  assert.equal((await hello()).flags.shapeFirst, true);
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
  const answer = (qid, payload, by) => { calls.push({ qid, payload, by }); return true; };
  fakePlanRun('shape-route-run', answer);
  try {
    let r = await post('/api/runs/shape-route-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 200, await r.text());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload, { decision: 'approve' });

    fakePlanRun('shape-route-run', answer);   // the answer settled the held id; hold it again
    r = await post('/api/runs/shape-route-run/answer', { id: 'plan-n_refine-1', decision: 'revise', feedback: 'f', source: 'check' });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(calls[1].payload, { decision: 'revise', feedback: 'f', source: 'check' });

    r = await post('/api/runs/shape-route-run/answer', { id: 'some-other-id', decision: 'approve' });
    assert.equal(r.status, 409);
    r = await post('/api/runs/no-such-run/answer', { id: 'plan-n_refine-1', decision: 'approve' });
    assert.equal(r.status, 404);
    assert.equal(calls.length, 2, 'refused answers never reached the run');
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

test('gate off: the plan text and Save to plans/ routes are 404', () => withGate(false, async () => {
  assert.equal((await fetch(`${base}/api/runs/x/plan`)).status, 404);
  assert.equal((await post('/api/runs/x/plan/save', {})).status, 404);
}));

/** Answer clarify asks until a plan ask other than `skipId` is open; returns it. */
async function untilPlanAsk(runId, skipId = null) {
  const entry = runs.get(runId);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const pq = entry.pendingQuestion;
    if (pq && pq.kind === 'plan' && pq.id !== skipId) return pq;
    if (pq && pq.kind !== 'plan') {
      const a = await post('/api/answer', { runId, id: pq.id, payload: { answers: [] } });
      assert.equal(a.status, 200, await a.text());
    }
    assert.ok(!settled.has(String(entry.status || '')), `the run settled (${entry.status}) before the plan stop`);
    await sleep(50);
  }
  throw new Error(`run ${runId} never reached a plan ask`);
}

test('gate on: a shaped run serves its plan text, saves it to plans/, revises with perspectives and approves', () => withGate(true, async () => {
  const dir = gitDir('shape-plan');
  const r = await post('/api/run', { prompt: 'Add a charts page.', projectDir: dir, shape: { perspectives: ['qa'] } });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const { runId } = JSON.parse(text);
  const entry = runs.get(runId);

  const pq = await untilPlanAsk(runId);
  let g = await fetch(`${base}/api/runs/${runId}/plan`);
  assert.equal(g.status, 200);
  const body = await g.json();
  assert.equal(body.file, pq.plan.file);
  assert.equal(body.text, readFileSync(pq.plan.file, 'utf8'));
  assert.equal(body.truncated, false);
  assert.ok(body.name.endsWith('.md'));
  g = await fetch(`${base}/api/runs/${runId}/plan?round=99`);
  assert.equal(g.status, 404);

  let s = await post(`/api/runs/${runId}/plan/save`, {});
  let saved = await s.json();
  assert.equal(s.status, 200, JSON.stringify(saved));
  assert.match(saved.path, /^plans\/.+\.md$/);
  assert.equal(readFileSync(join(dir, saved.path), 'utf8'), body.text);
  s = await post(`/api/runs/${runId}/plan/save`, {});
  assert.equal(s.status, 409);
  assert.equal((await s.json()).error, 'exists');
  s = await post(`/api/runs/${runId}/plan/save`, { overwrite: true });
  saved = await s.json();
  assert.equal(s.status, 200, JSON.stringify(saved));
  const row = (await hello()).runs.find((x) => x.runId === runId);
  assert.equal(row.shaping.savedTo, saved.path);

  let a = await post(`/api/runs/${runId}/answer`, { id: pq.id, decision: 'revise', feedback: 'Cover the threats too.', perspectives: ['qa', 'security'] });
  assert.equal(a.status, 200, await a.text());
  const pq2 = await untilPlanAsk(runId, pq.id);
  assert.deepEqual(pq2.plan.perspectives, ['product', 'qa', 'security']);

  a = await post(`/api/runs/${runId}/answer`, { id: pq2.id, decision: 'approve' });
  assert.equal(a.status, 200, await a.text());
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
  assert.ok(entry.events.some((e) => e.type === 'state' && e.shaping?.approved?.file === pq2.plan.file), 'a state frame carries shaping.approved');
  const after = (await hello()).runs.find((x) => x.runId === runId);
  assert.equal(after.shaping.approved.file, pq2.plan.file);
}));

test('gate on: Save to plans/ refuses a workspace run and saves a single-project one', () => withGate(true, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'worca-cc-shape-save-'));
  const planFile = join(tmp, 'plan.md');
  writeFileSync(planFile, '# Plan\n');
  const projectDir = gitDir('shape-save');
  const stand = (id, extra) => runs.set(id, { id, kind: 'workspace-run', status: 'running', events: [], title: 'Charts page',
    projectDir, pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: { file: planFile } }, ...extra });
  stand('shape-save-ws', { workspaceId: 'ws1' });
  stand('shape-save-one', {});
  try {
    let r = await post('/api/runs/shape-save-ws/plan/save', {});
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /needs a single-project run/);
    assert.equal(existsSync(join(projectDir, 'plans')), false, 'the refusal wrote nothing');

    r = await post('/api/runs/shape-save-one/plan/save', {});
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(readFileSync(join(projectDir, body.path), 'utf8'), '# Plan\n');
  } finally { runs.delete('shape-save-ws'); runs.delete('shape-save-one'); }
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

const STATS = { questions: { asked: 2, skipped: 1 }, revises: [{ round: 1, by: 'person' }], shapeScore: 0.875,
  reviewCycles: 2, checklist: null, cost: { shaping: 12.5, building: 30 } };

test('GET /api/runs/:id returns state.shapeStats for a shaped run and no shapeStats for an unshaped one', async () => {
  const dir = gitDir('shape-stats-detail');
  const shaped = await seedPipeline(dir, { title: 'shaped', status: 'done', shapeStats: STATS });
  const plain = await seedPipeline(dir, { title: 'plain', status: 'done' });
  const get = async (id) => (await fetch(`${base}/api/runs/${id}?projectDir=${encodeURIComponent(dir)}`)).json();
  assert.deepEqual((await get(shaped.id)).state.shapeStats, STATS);
  assert.equal('shapeStats' in (await get(plain.id)).state, false);
});

test('Ask before each run from the card persists, and run 2\'s plan ask opens as a "Plan · run 2" step card', () => withGate(true, async () => {
  const { createSliceFeature, featureApprovesEach } = await import('../src/core/shape/features.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const { stepChip } = await import('../ui/public/shape/step-card.mjs');
  // `runs` is the file's module-level binding, set in before() from the server module (there is no _testing.runs).
  const dir = gitDir();
  const p1 = 'asf00000001';
  seedPipelineRow({ id: p1, projectKey: projectKey(dir), status: 'done', title: p1, branch: { source: 'main', feature: 'feat/a' } });   // outside any tx
  const f = createSliceFeature({ pipelineId: p1, projectDir: dir, title: 'Charts', perspectives: ['product'], workflowId: 'wf_shape',
    outline: { why: 'w', slices: [1, 2].map((i) => ({ id: `s${i}`, title: `Part ${i}`, goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M' })) }, base: { mock: true }, approveEach: false });
  const r = await post(`/api/shape/features/${f.id}/approve-each`, { on: true });
  assert.equal(r.status, 200);
  assert.equal((await (await fetch(`${base}/api/shape/features/${f.id}`)).json()).approveEach, true);
  assert.equal(featureApprovesEach(f.id), true);
  // Run 2 raises its plan ask (orchestrator-slices.test.mjs:327 proves "Approve each on → always a plan ask").
  const p2 = 'asf00000002';
  seedPipelineRow({ id: p2, projectKey: projectKey(dir), status: 'running', title: p2, branch: { source: 'feat/a', feature: 'feat/b' } });
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(p2, f.id);
  const pq = { id: 'q-plan-2', kind: 'plan', plan: { round: 1 } };
  runs.set('live-asf2', { id: 'live-asf2', kind: 'run', pipelineId: p2, status: 'running', events: [], pendingQuestion: pq, orch: { state: { shaping: {} } } });
  try {
    const card = await (await fetch(`${base}/api/shape/pipelines/${p1}/card`)).json();
    assert.equal(card.feature.ask.index, 2);
    assert.equal(card.feature.ask.kind, 'plan');
    assert.equal(stepChip(pq, { shaping: { feature: { id: f.id, index: card.feature.ask.index, total: 2 } } }), 'Plan · run 2');
  } finally { runs.delete('live-asf2'); }
}));

// ── Shaper s4: the Ship card (offerShipCard, POST /api/ask/threads/:id/cards/:cardId on a `ship` card) ───────────────
const shipSlice = (n) => ({ id: `s${n}`, title: `Slice ${n}`, goal: `Goal ${n}`, inScope: [`do ${n}`], outOfScope: [], acceptance: [`ok ${n}`],
  dependsOn: [], estimate: 'M' });
let shipSeq = 0;
const ship = shipKit({ nextId: () => `sc${String(++shipSeq).padStart(8, '0')}`,
  outlineOf: (n) => ({ why: 'because', slices: Array.from({ length: n }, (_, i) => shipSlice(i + 1)) }) });
after(ship.cleanup);

test('Ship card: offered once; other verbs 400; ship-one ships once; a second ship is 409', () => withShip(async () => {
  const { _testing: testing } = await import('../ui/server.mjs');
  const seen = []; stubShip(seen);
  const world = ship.shipWorld();
  const thread = createThread();
  askLinkRun(thread.id, { runId: world.pids[0], pipelineId: world.pids[0], cardId: 'card_00000001' });
  await testing.offerShipCard(world.pids[2]);
  await testing.offerShipCard(world.pids[2]);
  const ships = listMessages(thread.id).flatMap((m) => m.blocks || []).filter((b) => b.card && b.card.type === 'ship');
  assert.equal(ships.length, 1, 'offered once');
  assert.deepEqual({ title: ships[0].card.title, runs: ships[0].card.runs, state: ships[0].state }, { title: 'Charts', runs: 3, state: 'proposed' });
  const url = `/api/ask/threads/${thread.id}/cards/${ships[0].id}`;
  assert.equal((await post(url, { verb: 'revert' })).status, 400);
  assert.equal((await post(url, { state: 'applied' })).status, 400);
  assert.equal(ghCalls(seen, 'create').length, 0, 'a refused verb ships nothing');
  const r = await post(url, { verb: 'ship-one', release: { version: 'v1.12.0' } });
  assert.equal(r.status, 200, await r.clone().text());
  const block = (await r.json()).block;
  assert.equal(block.state, 'applied');
  assert.equal(block.card.result.mode, 'one');
  const again = await post(url, { verb: 'ship-one' });
  assert.equal(again.status, 409, 'a second ship');
  assert.equal((await again.json()).error, 'card is applied');
  assert.equal(ghCalls(seen, 'create').length, 1, 'shipped once');
  assert.equal(getDb().prepare('SELECT release_version FROM shape_features WHERE id = ?').get(world.f.id).release_version, 'v1.12.0');
  assert.equal((await post(`/api/shape/features/${world.f.id}/ship`, { mode: 'stacked' })).status, 409);
}));

test('Ship card: Not now declines it (no release allowed); it cannot ship any more', () => withShip(async () => {
  const { _testing: testing } = await import('../ui/server.mjs');
  const seen = []; stubShip(seen);
  const world = ship.shipWorld();
  const thread = createThread();
  askLinkRun(thread.id, { runId: world.pids[0], pipelineId: world.pids[0], cardId: 'card_00000002' });
  const msg = await testing.offerShipCard(world.pids[2]);
  const url = `/api/ask/threads/${thread.id}/cards/${msg.blocks[0].id}`;
  assert.equal((await post(url, { verb: 'not-now', release: { version: 'v1.0.0' } })).status, 400);
  const r = await post(url, { verb: 'not-now' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).block.state, 'declined');
  assert.equal((await post(url, { verb: 'ship-stacked' })).status, 409);
  assert.equal(seen.filter((a) => a[0] === 'gh' && a[1] === 'pr').length, 0);
}));

// ── Shaper s5: Ask for changes, the Route card, thread replies, card-started runs and fix rounds ────────────────────
const { execSync: sh } = await import('node:child_process');
const blocksOf = (threadId) => listMessages(threadId).flatMap((m) => m.blocks || []).filter((b) => b && b.kind === 'card');
async function pipelineOfRun(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = runs.get(runId); if (e && e.pipelineId) return e.pipelineId; await sleep(50); }
  throw new Error(`run ${runId} has no pipeline`);
}
const branchRow = (pid) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid)?.branch || 'null');
/** The run's branch record once its worktree is set up, then the run is stopped: these cases read only the stored
 *  marker, and a run under the suite's fresh HOME waits at its Clarify questions. */
async function branchThenStop(runId, ms = 90000) {
  const pid = await pipelineOfRun(runId, ms);
  const t0 = Date.now();
  while (!branchRow(pid)?.worktreeDir && Date.now() - t0 < ms) await sleep(50);
  const e = runs.get(runId);
  if (e && !settled.has(String(e.status || ''))) await post('/api/stop', { runId });
  await untilSettled(runId);
  return { pid, branch: branchRow(pid) };
}
/** A finished plain run on `feat/x` in a real repo, with PR 41 open and a thread that follows it. */
async function doneRunWithPr(tag) {
  const { persistPrState } = await import('../src/core/artifacts.mjs');
  const dir = gitDir(tag);
  sh('git branch feat/x', { cwd: dir });
  const src = sh('git rev-parse --abbrev-ref HEAD', { cwd: dir }).toString().trim();
  const { id } = await seedPipeline(dir, { title: 'Add a chart', status: 'done', branch: { source: src, feature: 'feat/x' } });
  persistPrState(id, { url: 'https://github.com/o/r/pull/41', number: 41, state: 'OPEN' });
  const thread = createThread();
  askLinkRun(thread.id, { runId: `run-${id}`, pipelineId: id, cardId: 'card_s5000001' });
  return { dir, id, thread };
}

test('s5 gate off: /changes and /reply are 404', () => withGate(false, async () => {
  const thread = createThread();
  assert.equal((await post(`/api/ask/threads/${thread.id}/changes`, { pipelineId: 'aaaa0001', text: 'x' })).status, 404);
  assert.equal((await post(`/api/ask/threads/${thread.id}/reply`, { text: 'x' })).status, 404);
}));

test('s5: /changes posts a changes card with the run\'s PR; foreign verbs 400; Not now declines once', () => withGate(true, async () => {
  const { id, thread } = await doneRunWithPr('s5-changes');
  const r = await post(`/api/ask/threads/${thread.id}/changes`, { pipelineId: id, text: 'make it blue' });
  assert.equal(r.status, 201, await r.clone().text());
  const card = blocksOf(thread.id).at(-1);
  assert.equal(card.card.type, 'changes');
  assert.equal(card.card.landing.target.pr.number, 41);
  assert.equal(card.card.landing.title, 'Changes to Add a chart · same branch, same PR');
  const url = `/api/ask/threads/${thread.id}/cards/${card.id}`;
  assert.equal((await post(url, { verb: 'ship-one' })).status, 400);
  const nn = await post(url, { verb: 'not-now' });
  assert.equal(nn.status, 200);
  assert.equal((await nn.json()).block.state, 'declined');
  assert.equal((await post(url, { verb: 'not-now' })).status, 409);
}));

test('s5: a round starts tag-exempt with its origin\'s bare-key tag (saved before key:value) and carries round 2', () => withGate(true, async () => {
  const { id, thread } = await doneRunWithPr('s5-round');
  getDb().prepare("INSERT INTO run_tags (pipeline_id, key, value) VALUES (?, 'acme', '')").run(id);
  await post(`/api/ask/threads/${thread.id}/changes`, { pipelineId: id, text: 'make it blue' });
  const card = blocksOf(thread.id).at(-1);
  assert.deepEqual(card.card.run.tags, ['acme']);
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { verb: 'start' });
  assert.equal(r.status, 200, await r.clone().text());
  const block = (await r.json()).block;
  assert.deepEqual([block.state, block.card.result.round, block.card.result.pr], ['applied', 2, 41]);
  const { branch } = await branchThenStop(block.card.result.runId);
  assert.deepEqual(branch.roundOf, { pipelineId: id, round: 2, request: 'make it blue' });
  // The HTTP body cannot claim either: `_cardStart` from a body is not the exemption, `roundOf` from a body is no marker.
  const dir = gitDir('s5-body');
  const bad = await post('/api/run', { prompt: 'x', projectDir: dir, _cardStart: true, tags: ['acme'] });
  assert.equal(bad.status, 400, await bad.clone().text());
  const plain = await post('/api/run', { prompt: 'x', projectDir: dir, roundOf: { pipelineId: id, round: 2, request: 'x' } });
  assert.equal(plain.status, 200, await plain.clone().text());
  const { runId } = await plain.json();
  assert.equal((await branchThenStop(runId)).branch.roundOf, undefined);
}));

test('s5: Route cards from /reply: Save for later stores an idea; Own run now starts from the base with no marker', () => withGate(true, async () => {
  const { createSliceFeature, featureView } = await import('../src/core/shape/features.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir('s5-route');
  sh('git branch dev', { cwd: dir });
  const p1 = 'asf5r0001';
  seedPipelineRow({ id: p1, projectKey: projectKey(dir), status: 'done', title: p1, branch: { source: 'dev', feature: 'feat/a' } });
  const f = createSliceFeature({ pipelineId: p1, projectDir: dir, title: 'Charts', perspectives: ['product'], workflowId: 'wf_shape',
    outline: { why: 'w', slices: [1, 2].map((i) => ({ id: `s${i}`, title: `Part ${i}`, goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M' })) } });
  const thread = createThread();
  askLinkRun(thread.id, { runId: 'run-asf5r1', pipelineId: p1, cardId: 'card_s5r00001' });
  const q = await post(`/api/ask/threads/${thread.id}/reply`, { text: 'why is it slow?' });
  assert.deepEqual(await q.json(), { action: 'chat' });
  assert.equal(listMessages(thread.id).length, 0, 'a question adds no row');
  const one = await (await post(`/api/ask/threads/${thread.id}/reply`, { text: 'also export a PNG' })).json();
  assert.equal(one.action, 'route');
  const routeUrl = `/api/ask/threads/${thread.id}/cards/${one.message.blocks[0].id}`;
  assert.equal((await post(routeUrl, { verb: 'start' })).status, 400, 'a changes-card verb on a Route card');
  assert.equal((await post(routeUrl, { verb: 'add', where: 'later' })).status, 400, 'Add needs next or extra');
  const save = await post(routeUrl, { verb: 'save' });
  assert.equal(save.status, 200, await save.clone().text());
  assert.equal(featureView(f.id).notes.ideas, 1);
  assert.equal((await post(routeUrl, { verb: 'own' })).status, 409, 'a second answer');
  assert.equal(featureView(f.id).notes.ideas, 1, 'the second answer changed nothing');
  const two = await (await post(`/api/ask/threads/${thread.id}/reply`, { text: 'hotfix: login is broken' })).json();
  const own = await post(`/api/ask/threads/${thread.id}/cards/${two.message.blocks[0].id}`, { verb: 'own' });
  assert.equal(own.status, 200, await own.clone().text());
  const { runId } = (await own.json()).block.card.result;
  const { branch } = await branchThenStop(runId);
  assert.equal(branch.source, 'dev');
  assert.equal(branch.roundOf, undefined);
}));

test('s5: a reply that answers an open revisable plan step is the person\'s revise; no Route card', () => withGate(true, async () => {
  const thread = createThread();
  const seen = [];
  runs.set('live-s5plan', { id: 'live-s5plan', kind: 'run', status: 'running', events: [], pipelineId: 'asf5p0001',
    orch: { answer: (...a) => { seen.push(a); return true; } },
    pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: { revisable: true } } });
  askLinkRun(thread.id, { runId: 'live-s5plan', pipelineId: 'asf5p0001', cardId: 'card_s5p00001' });
  try {
    const r = await (await post(`/api/ask/threads/${thread.id}/reply`, { text: 'shorter please' })).json();
    assert.deepEqual([r.action, r.stepId], ['answered', 'plan-n_refine-1']);
    assert.deepEqual(seen[0].slice(0, 2), ['plan-n_refine-1', { decision: 'revise', feedback: 'shorter please' }]);
    assert.equal(blocksOf(thread.id).filter((b) => b.card.type === 'route').length, 0);
  } finally { runs.delete('live-s5plan'); }
}));

test('s5: a Watch PR fix run started through prWatcherDeps is stored as round 2 of the PR\'s run; no block in its thread', () => withGate(true, async () => {
  const { _testing: testing } = await import('../ui/server.mjs');
  const { id, dir, thread } = await doneRunWithPr('s5-fix');
  const before = blocksOf(thread.id).length;
  const runId = `fix-${id}`;
  const r = await testing.prWatcherDeps.startRun({ prompt: 'fix it', projectDir: dir, mock: true, featureBranch: 'feat/x', syncBeforeStart: false },
    { startedBy: 'pr-watch', runId, roundOf: { pipelineId: id, request: 'fix failing checks', kinds: ['checks'] } });   // no pr_watch_runs reservation here
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { pid, branch } = await branchThenStop(runId);
  assert.deepEqual(branch.roundOf, { pipelineId: id, round: 2, request: 'fix failing checks', by: 'watch', kinds: ['checks'] });
  const got = await (await fetch(`${base}/api/ask/runs/${id}`)).json();
  assert.deepEqual(got.extras.rounds.map((x) => [x.round, x.pipelineId, x.by]), [[2, pid, 'watch']]);
  assert.equal(blocksOf(thread.id).length, before);
}));
