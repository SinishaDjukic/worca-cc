// test/api-shape-first.test.mjs — Shape it first on the server (spec D2, D9, D10, D12): the hello feature, `shape` on
// POST /api/run, the workflow list, POST /api/runs/:id/answer and its never-stranded fallback.
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
import { readRunTags } from '../src/core/run-tags-store.mjs';
import { editRunLabels, readRunLabels } from '../src/core/run-labels-store.mjs';
import { createThread, linkRun as askLinkRun, listMessages, appendMessage as askAppendMessage } from '../src/core/ask/store.mjs';

useTempHome(after);

let srv, base, wsBase, runs;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const savedMock = process.env.WORCA_MOCK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

test('hello carries no shapeFirst flag and wf_shape follows Memory defragment', async () => {
  assert.equal('shapeFirst' in (await hello()).flags, false);
  const { workflows } = await (await fetch(`${base}/api/workflows`)).json();
  const ids = workflows.map((w) => w.id);
  assert.equal(ids.indexOf('wf_shape'), ids.indexOf('wf_memory_defrag') + 1);
});

test('an unknown perspective is a 400 naming it, and the shape workflows cannot be deleted', async () => {
  const r = await post('/api/run', { prompt: 'x', projectDir: neverCreatedDir(), shape: { perspectives: ['ops'] } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /ops/);
  for (const id of ['wf_shape', 'wf_shape_ux']) {
    const d = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE' });
    assert.equal(d.status, 400, id);
    assert.match((await d.json()).error, /cannot be deleted/);
  }
});

test('a shaped mock run stops at the plan approval and approving finishes it', async () => {
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
  const rr = pq.plan.roleReviews;
  assert.ok(rr && rr.rounds.length >= 1, 'the plan ask carries the role reviews');
  assert.ok(rr.rounds.every((r) => r.pass === rr.rounds.at(-1).pass), 'the current pass only');
  assert.ok(rr.rounds.at(-1).roles.some((r) => r.key === 'qa'));

  const a = await post(`/api/runs/${runId}/answer`, { id: pq.id, decision: 'approve' });
  assert.equal(a.status, 200, await a.text());
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done', JSON.stringify({ status: done.status, reason: done.pauseReason, detail: done.pauseDetail }));
});

test('the plan route answers the held id and refuses the rest', async () => {
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
});

test('an invalid answer is a 422 with the run\'s field errors', async () => {
  const errors = [{ path: 'feedback', code: 'required', message: 'revise needs feedback text' }];
  fakePlanRun('shape-422-run', () => { throw Object.assign(new Error('invalid'), { code: 'INVALID_ANSWER', errors }); });
  try {
    const r = await post('/api/runs/shape-422-run/answer', { id: 'plan-n_refine-1', decision: 'revise' });
    assert.equal(r.status, 422);
    assert.deepEqual((await r.json()).errors, errors);
  } finally { runs.delete('shape-422-run'); }
});

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

test('a shaped run serves its plan text, saves it to plans/, revises with perspectives and approves', async () => {
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
});

test('Save to plans/ refuses a workspace run and saves a single-project one', async () => {
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
});

test('a held plan is also answered through POST /api/answer (never stranded)', async () => {
  const calls = [];
  fakePlanRun('shape-stranded-run', (qid, payload) => { calls.push({ qid, payload }); return true; });
  try {
    const r = await post('/api/answer', { runId: 'shape-stranded-run', id: 'plan-n_refine-1', payload: { decision: 'approve' } });
    assert.equal(r.status, 200, await r.text());
    assert.equal(calls.length, 1);
  } finally { runs.delete('shape-stranded-run'); }
});

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

test('Ask before each run from the card persists, and run 2\'s plan ask opens as a "Plan · run 2" step card', async () => {
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
});

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

const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (!(await fn())) { if (Date.now() > end) throw new Error('timed out'); await sleep(25); } };
/** One Ask turn. The previous turn's row can read 'done' a beat before its job leaves askInFlight → 409 'turn in flight': retry. */
const postTurn = async (threadId, text) => {
  const end = Date.now() + 10000;
  for (;;) {
    const r = await post(`/api/ask/threads/${threadId}/messages`, { text, model: 'claude-opus-5-5', effort: 'high' });
    if (r.status !== 409 || Date.now() > end) return r;
    await sleep(50);
  }
};
/** A two-run feature whose run 1 is the origin pipeline `p1`, and a thread that follows it. */
async function seedFeature(tag, p1) {
  const { createSliceFeature } = await import('../src/core/shape/features.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir(tag);
  sh('git branch dev', { cwd: dir });
  seedPipelineRow({ id: p1, projectKey: projectKey(dir), status: 'done', title: p1, branch: { source: 'dev', feature: 'feat/a' } });
  const f = createSliceFeature({ pipelineId: p1, projectDir: dir, title: 'Charts', perspectives: ['product'], workflowId: 'wf_shape',
    outline: { why: 'w', slices: [1, 2].map((i) => ({ id: `s${i}`, title: `Part ${i}`, goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'M' })) } });
  const thread = createThread();
  askLinkRun(thread.id, { runId: `run-${p1}`, pipelineId: p1, cardId: 'card_5f000001' });
  return { dir, f, thread };
}

test('s5: /changes posts a changes card with the run\'s PR; foreign verbs 400; Not now declines once', async () => {
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
});

test('s5: a round starts tag-exempt with its origin\'s bare-key tag (saved before key:value) and carries round 2', async () => {
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
});

test('s2: a round started from a run with tags and labels carries both', async () => {
  const { id, thread } = await doneRunWithPr('s2-round');
  getDb().prepare("INSERT INTO run_tags (pipeline_id, key, value) VALUES (?, 'client', 'acme')").run(id);
  editRunLabels(id, ['hotfix']);
  await post(`/api/ask/threads/${thread.id}/changes`, { pipelineId: id, text: 'make it blue' });
  const card = blocksOf(thread.id).at(-1);
  assert.deepEqual([card.card.run.tags, card.card.run.labels], [['client:acme'], ['hotfix']]);
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { verb: 'start' });
  assert.equal(r.status, 200, await r.clone().text());
  const block = (await r.json()).block;
  const { pid } = await branchThenStop(block.card.result.runId);
  assert.deepEqual([readRunTags(pid), readRunLabels(pid)], [['client:acme'], ['hotfix']]);
});

test('ordinary stays ordinary: in a thread with a finished run, chat messages are Ask turns — no card, and /reply is gone', async () => {
  const { thread } = await doneRunWithPr('s5-ordinary');
  assert.equal((await post(`/api/ask/threads/${thread.id}/reply`, { text: 'make it blue' })).status, 404);
  for (const text of ['summarize the diff', 'thanks, now open the PR']) {
    const r = await postTurn(thread.id, text);
    assert.ok(r.status < 300, await r.clone().text());
    await waitFor(() => listMessages(thread.id).filter((m) => m.role === 'assistant' && m.status === 'done').length
      === listMessages(thread.id).filter((m) => m.role === 'user').length);
  }
  assert.deepEqual(listMessages(thread.id).filter((m) => m.role === 'user').map((m) => m.text), ['summarize the diff', 'thanks, now open the PR']);
  assert.equal(blocksOf(thread.id).filter((b) => b.card && (b.card.type === 'changes' || b.card.type === 'route')).length, 0);
});

test('propose_changes (askShapeAction) posts the same changes card /reply posted: the run\'s PR, round 2', async () => {
  const { _testing: t } = await import('../ui/server.mjs');
  const { id, thread } = await doneRunWithPr('s5-tool-changes');
  const r = t.askShapeAction({ kind: 'changes', pipelineId: id, request: 'make it blue' }, thread.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.block.state, 'proposed');
  assert.equal(r.block.card.type, 'changes');
  assert.equal(r.block.card.landing.title, 'Changes to Add a chart · same branch, same PR');
  assert.equal(r.block.card.landing.target.pr.number, 41);
  assert.equal(r.block.card.landing.start, 'Start round 2');
  assert.match(t.askShapeAction({ kind: 'route', featureId: 'f1', text: 'x', guess: 'add', reason: 'r' }, thread.id).notice, /^Not applied: route_message is for a chat that follows a feature/);
  assert.equal(t.askShapeAction({ kind: 'changes', pipelineId: 'beef0001', request: 'x' }, thread.id).notice, 'Not applied: this chat does not follow run beef0001');
  assert.equal(listMessages(thread.id).length, 0, 'askShapeAction itself appends nothing: the turn stores the block');
});

test('route_message (askShapeAction): the model\'s guess on the Route card; Save for later stores an idea; Own run now starts from the base', async () => {
  const { _testing: t } = await import('../ui/server.mjs');
  const { featureView } = await import('../src/core/shape/features.mjs');
  const { f, thread } = await seedFeature('s5-tool-route', 'asf5t0001');
  const r = t.askShapeAction({ kind: 'route', featureId: f.id, text: 'also export a PNG', guess: 'save', reason: 'nothing to plan it into yet' }, thread.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.block.card.guess, { choice: 'save', where: null, reason: 'nothing to plan it into yet' });
  assert.equal(r.block.card.primary, 'Save for later');
  assert.equal(t.askShapeAction({ kind: 'changes', pipelineId: 'asf5t0001', request: 'x' }, thread.id).notice, 'Not applied: Charts still has runs to go: use route_message');
  // The card applies through the unchanged card route, stored the way turn.mjs stores it (card ids match ASK_ID_RE: 8 hex).
  const msg = askAppendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_5e000002', ...r.block }] });
  const routeUrl = `/api/ask/threads/${thread.id}/cards/${msg.blocks[0].id}`;
  assert.equal((await post(routeUrl, { verb: 'start' })).status, 400, 'a changes-card verb on a Route card');
  const save = await post(routeUrl, { verb: 'save' });
  assert.equal(save.status, 200, await save.clone().text());
  assert.equal(featureView(f.id).notes.ideas, 1);
  assert.equal((await post(routeUrl, { verb: 'own' })).status, 409, 'a second answer');
  const two = t.askShapeAction({ kind: 'route', featureId: f.id, text: 'hotfix: login is broken', guess: 'own', reason: 'a fix that cannot wait' }, thread.id);
  const m2 = askAppendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_5e000003', ...two.block }] });
  const own = await post(`/api/ask/threads/${thread.id}/cards/${m2.blocks[0].id}`, { verb: 'own' });
  assert.equal(own.status, 200, await own.clone().text());
  const { branch } = await branchThenStop((await own.json()).block.card.result.runId);
  assert.equal(branch.source, 'dev');
  assert.equal(branch.roundOf, undefined);
});

test('an open Plan step: free text is an Ask turn (never the step\'s answer) and both tools are refused', async () => {
  const { _testing: t } = await import('../ui/server.mjs');
  const p1 = 'asf5o0001';
  const { f, thread } = await seedFeature('s5-open', p1);
  // Run 1 of the feature IS the origin pipeline (createSliceFeature stores slice 1 with pipeline_id = p1), so a live entry
  // driving p1 with a pending plan ask makes featureView(…, { live: liveSliceOf }).ask = { index: 1, kind: 'plan' }.
  const seen = [];
  runs.set('live-s5open', { id: 'live-s5open', kind: 'run', status: 'running', events: [], pipelineId: p1,
    orch: { answer: (...a) => { seen.push(a); return true; }, state: {} },
    pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: { revisable: true } } });
  try {
    assert.match(t.askShapeAction({ kind: 'route', featureId: f.id, text: 'shorter please', guess: 'add', reason: 'r' }, thread.id).notice, /Run 1 is waiting at its Plan step/);
    assert.match(t.askShapeAction({ kind: 'changes', pipelineId: p1, request: 'shorter please' }, thread.id).notice, /Run 1 is waiting at its Plan step/);
    const r = await postTurn(thread.id, 'shorter please');
    assert.ok(r.status < 300, await r.clone().text());
    await waitFor(() => listMessages(thread.id).some((m) => m.role === 'assistant' && m.status === 'done'));
    assert.equal(seen.length, 0, 'the step was not answered from the chat');
    assert.equal(blocksOf(thread.id).filter((b) => b.card && (b.card.type === 'changes' || b.card.type === 'route')).length, 0, 'no Changes or Route card');
  } finally { runs.delete('live-s5open'); }
});

test('the turn context: a followed run gives ctx.shape', async () => {
  const { _testing: t } = await import('../ui/server.mjs');
  const { id, thread } = await doneRunWithPr('s5-ctx');
  const ctx = await t.resolveAskContext(thread.id, {}, []);
  assert.deepEqual(ctx.shape, { run: { id, title: 'Add a chart', status: 'done', finished: true, pr: { number: 41, state: 'open' }, rounds: 1 } });
});

test('s5: a Watch PR fix run started through prWatcherDeps is stored as round 2 of the PR\'s run; no block in its thread', async () => {
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
});
