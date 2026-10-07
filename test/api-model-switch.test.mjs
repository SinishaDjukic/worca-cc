// test/api-model-switch.test.mjs
// GET/POST /api/pipelines/:id/models — a running or paused run's stages + switch (model-switch.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let srv; let base; let dir; let runs; let readPipelineForResume; let getDb; let GraphOrchestrator;
let prevHome; let prevMock;
const homeDir = await mkdtemp(join(tmpdir(), 'api-msw-home-'));

before(async () => {
  prevHome = process.env.WORCA_HOME; prevMock = process.env.WORCA_MOCK;
  process.env.WORCA_HOME = homeDir; process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  const { addProject } = await import('../src/core/projects.mjs');
  ({ readPipelineForResume } = await import('../src/core/artifacts.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ GraphOrchestrator } = await import('../src/core/orchestrator.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('api-msw');
  await addProject({ name: 'api-msw', path: dir });
});
after(async () => {
  await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
});

async function req(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const DEFAULT_STEPS = [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused', sessionId: 's' }];
async function seed(status = 'paused', steps = DEFAULT_STEPS) {
  const rp = graphResumePoint({ pipelineDir: dir });
  return (await seedPipeline(dir, { title: 'msw', status, stepper: rp.manifest, resumePoint: rp, steps })).id;
}

test('GET lists stages + the run project catalog; POST switches and persists', async () => {
  const id = await seed();
  const g = await req('GET', `/api/pipelines/${id}/models`);
  assert.equal(g.status, 200);
  assert.equal(g.body.stages.find((s) => s.nodeId === 'n_plan').state, 'paused');
  assert.ok(g.body.models.length > 0);
  const p = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.changed.map((c) => c.nodeId), ['n_plan']);
  assert.equal(readPipelineForResume(id).resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan').model, 'claude-opus-5-5');
});

test('refusals map to the error envelope', async () => {
  const done = await seed('done');
  const r1 = await req('POST', `/api/pipelines/${done}/models`, { changes: { n_plan: { model: 'claude-opus-5-5' } } });
  assert.equal(r1.status, 409); assert.equal(r1.body.code, 'NOT_SWITCHABLE_STATUS');
  const id = await seed();
  const r2 = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_plan: { model: 'nope' } } });
  assert.equal(r2.status, 400); assert.equal(r2.body.code, 'INVALID_SELECTION');
  const r3 = await req('GET', '/api/pipelines/doesnotexist/models');
  assert.equal(r3.status, 404);
});

test('a run this server drives: GET describes it live; POST goes to its orchestrator', async () => {
  const id = await seed('running', []);
  const { manifest } = graphResumePoint({ pipelineDir: dir });
  const calls = [];
  const orch = {
    state: { status: 'running' },
    modelSwitchSnapshot: () => ({ manifest, steps: [{ nodeId: 'n_plan', status: 'start' }], active: ['n_plan'], runDefault: 'claude-fable-5-1' }),
    switchModels: async (changes, opts) => {
      calls.push([changes, opts.by]);
      return { ok: true, pipelineId: id, changed: [{ nodeId: 'n_impl' }], skipped: [{ nodeId: 'n_plan', label: 'Planner', reason: 'running' }], stages: [], stepper: manifest, warnings: [] };
    },
  };
  runs.set('r-live', { id: 'r-live', pipelineId: id, status: 'running', orch });
  try {
    const g = await req('GET', `/api/pipelines/${id}/models`);
    assert.equal(g.status, 200);
    assert.equal(g.body.status, 'running'); assert.equal(g.body.runDefault, 'claude-fable-5-1');
    assert.equal(g.body.stages.find((s) => s.nodeId === 'n_plan').state, 'running');
    const p = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_impl: { model: 'claude-opus-5-5' } } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.skipped.map((s) => s.reason), ['running']);
    assert.deepEqual(calls[0][0], { n_impl: { model: 'claude-opus-5-5' } });
  } finally { runs.delete('r-live'); }
});

test('a pausing entry answers 409 NOT_RUNNING (the orchestrator\'s own gate)', async () => {
  const id = await seed('running', []);
  const orch = { state: { status: 'pausing' }, pauseRequested: true,
    _assertModelSwitchable: GraphOrchestrator.prototype._assertModelSwitchable,
    switchModels: GraphOrchestrator.prototype.switchModels };
  runs.set('r-pausing', { id: 'r-pausing', pipelineId: id, status: 'pausing', orch });
  try {
    const r = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_impl: { model: 'claude-opus-5-5' } } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'NOT_RUNNING');
  } finally { runs.delete('r-pausing'); }
});

test('a run another process drives: GET from the store; a dead owner answers 409 NO_OWNER', async () => {
  const id = await seed('running', [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' }]);
  getDb().prepare('UPDATE pipelines SET owner_pid = ?, owner_host = ? WHERE id = ?').run(2147483646, (await import('node:os')).hostname(), id);
  const g = await req('GET', `/api/pipelines/${id}/models`);
  assert.equal(g.body.status, 'running');
  assert.equal(g.body.stages.find((s) => s.nodeId === 'n_plan').state, 'running');
  const r = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_impl: { model: 'claude-opus-5-5' } } });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'NO_OWNER');
});
