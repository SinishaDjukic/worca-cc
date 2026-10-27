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
