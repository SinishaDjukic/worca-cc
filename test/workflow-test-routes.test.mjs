// test/workflow-test-routes.test.mjs — D33, Review Focus 8: the change frame is sent only while the flag is on and names
// the test as testRunId. registerWorkflowTestRoutes on a fake app, with a run handler that refuses every try (403).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { registerWorkflowTestRoutes, WORKFLOW_TEST_ROUTES } from '../src/core/workflow-tests/routes.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import * as service from '../src/core/workflow-tests/service.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftroutes-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

function boot(extra = {}) {
  const seen = [];
  const handlers = new Map();
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, (path, ...fns) => {
    seen.push([m.toUpperCase(), path]);
    handlers.set(`${m.toUpperCase()} ${path}`, fns.at(-1));   // the handler after the flag gate
  }]));
  const frames = [];
  const { runner } = registerWorkflowTestRoutes(app, { broadcast: (f) => frames.push(f), deps: {
    startRun: async () => ({ status: 403, body: { error: 'total cost limit reached' } }),
    liveRun: () => null, stopRun: async () => {}, answer: () => false, mockMode: () => true, ...extra,
  } });
  return { runner, frames, seen, handlers };
}
/** Call one registered handler with a fake request; resolves to { status, body }. */
function invoke(handler, req) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); } };
    handler({ params: {}, query: {}, body: {}, headers: {}, ...req }, res);
  });
}
async function workflowWithExample() {
  await writeGraphWorkflow({ id: 'wf_rt', name: 'Routes', domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  return store.createExample('wf_rt', { name: 'Bulk', request: 'Write the brief.', tries: 1 });
}

test('every route is registered, in WORKFLOW_TEST_ROUTES order', () => {
  assert.deepEqual(boot().seen, WORKFLOW_TEST_ROUTES.map((r) => [r.method, r.path]));
});

test('no frame while the flag is off; with it on, testRunId (never runId) and the toast text when it ends', async () => {
  delete process.env.WORCA_FLAGS;
  const ex = await workflowWithExample();
  const off = boot();
  const r1 = await off.runner.start({ workflowId: 'wf_rt', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await off.runner.idle(r1.id);
  assert.equal(store.readTestRun(r1.id).stopReason, 'budget');
  assert.deepEqual(off.frames, [], 'D33: silent while the flag is off');
  process.env.WORCA_FLAGS = 'workflowTests';
  const on = boot();
  const r2 = await on.runner.start({ workflowId: 'wf_rt', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await on.runner.idle(r2.id);
  assert.ok(on.frames.length && on.frames.every((f) => f.testRunId === r2.id && !('runId' in f)));
  const last = on.frames.at(-1);
  assert.deepEqual([last.finished, last.status, last.title], [true, 'stopped', 'Routes: Tried once: Bulk']);
});

test('POST …/runs/:run/stop stops a running test: its try is stopped, the test says the person stopped it', async () => {
  const ex = await workflowWithExample();
  let release;
  const latch = new Promise((r) => { release = r; });
  let started;
  const tryStarted = new Promise((r) => { started = r; });
  let ended = false;
  const { runner, handlers } = boot({
    startRun: async () => { started(); return { status: 200, body: { runId: 'k_try', pipelineId: null } }; },
    liveRun: () => ({ orch: { state: { totalCostUsd: 0 } }, status: ended ? 'stopped' : 'running', launch: latch, pipelineId: null }),
    stopRun: async () => { ended = true; release(); },
  });
  const run = await runner.start({ workflowId: 'wf_rt', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await tryStarted;
  assert.equal(store.readTestRun(run.id).status, 'running');
  const r = await invoke(handlers.get('POST /api/workflows/:id/tests/runs/:run/stop'), { params: { id: 'wf_rt', run: String(run.id) } });
  assert.deepEqual([r.status, r.body.run.status, r.body.run.stopReason], [200, 'stopped', 'person']);
  assert.deepEqual(store.triesOfRun(run.id).map((t) => t.status), ['stopped']);
  const p = await invoke(handlers.get('GET /api/workflows/:id/tests/runs/:run'), { params: { id: 'wf_rt', run: String(run.id) } });
  assert.ok(Number.isFinite(p.body.takenMs) && p.body.takenMs >= 0, `boards 27/28: a stopped test says how long it took (${p.body.takenMs})`);
});

test('takenMs (boards 27/28): the time its own tries ran, overlaps once, the stopped gap before Finish the rest left out', () => {
  const at = (min) => new Date(Date.UTC(2026, 9, 27, 10, min)).toISOString();
  const tri = (from, to, runId = 7) => ({ runId, startedAt: from == null ? null : at(from), finishedAt: to == null ? null : at(to) });
  const run = (over = {}) => ({ id: 7, status: 'done', createdAt: at(0), finishedAt: at(90), ...over });
  const min = (ms) => ms / 60000;
  // Three at a time from 0 to 20, then a stop; Finish the rest from 60 to 75.
  assert.equal(min(service.takenMs(run(), [tri(0, 10), tri(5, 20), tri(2, 12), tri(60, 75)])), 35);
  assert.equal(service.takenMs(run({ status: 'running' }), [tri(0, 10)]), null, 'while it runs: the time left says it');
  assert.equal(min(service.takenMs(run(), [tri(0, 10), tri(null, null), tri(3, null)])), 10, 'a try never started or never ended adds nothing');
  assert.equal(min(service.takenMs(run(), [tri(0, 10), tri(1, 30, 6)])), 10, 'a try reused from an earlier test is not this test\'s time');
  assert.equal(min(service.takenMs(run({ finishedAt: at(4) }), [])), 4, 'no try ran (the quick check stopped it): the test\'s own start and end');
  assert.equal(service.takenMs(run({ finishedAt: null }), []), null, 'no times at all');
});

test('the dialog says when the connectors preview failed, instead of showing no connectors (previewError)', async () => {
  await workflowWithExample();
  const W = '/api/workflows/:id/tests/plan';
  const failing = boot({ connectorsPreview: async () => { throw new Error('registry unreadable'); } });
  const r = await invoke(failing.handlers.get(`GET ${W}`), { params: { id: 'wf_rt' }, query: { b: 'draft', tries: '1' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.connectors.previewError, r.body.connectors.pretend, r.body.connectors.off], [true, [], []]);
  const ok = boot({ connectorsPreview: async () => ({ copies: [], fileServers: [] }) });
  const r2 = await invoke(ok.handlers.get(`GET ${W}`), { params: { id: 'wf_rt' }, query: { b: 'draft', tries: '1' } });
  assert.equal('previewError' in r2.body.connectors, false);
});
