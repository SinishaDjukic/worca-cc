// test/api-model-switch.test.mjs
// GET/POST /api/pipelines/:id/models — a paused run's stages + switch (model-switch.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';

let srv; let base; let dir; let runs; let readPipelineForResume;
let prevHome; let prevMock;
const homeDir = await mkdtemp(join(tmpdir(), 'api-msw-home-'));

before(async () => {
  prevHome = process.env.WORCA_HOME; prevMock = process.env.WORCA_MOCK;
  process.env.WORCA_HOME = homeDir; process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  const { addProject } = await import('../src/core/projects.mjs');
  ({ readPipelineForResume } = await import('../src/core/artifacts.mjs'));
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
async function seed(status = 'paused') {
  const rp = graphResumePoint({ pipelineDir: dir });
  const steps = [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused', sessionId: 's' }];
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
  assert.equal(r1.status, 409); assert.equal(r1.body.code, 'NOT_PAUSED');
  const id = await seed();
  const r2 = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_plan: { model: 'nope' } } });
  assert.equal(r2.status, 400); assert.equal(r2.body.code, 'INVALID_SELECTION');
  const r3 = await req('GET', '/api/pipelines/doesnotexist/models');
  assert.equal(r3.status, 404);
});

test('a live run entry of the pipeline refuses the switch with 409 LIVE', async () => {
  const id = await seed();
  runs.set('r-live', { id: 'r-live', pipelineId: id, status: 'running', orch: {} });
  try {
    const r = await req('POST', `/api/pipelines/${id}/models`, { changes: { n_plan: { model: 'claude-opus-5-5' } } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'LIVE');
    assert.equal(readPipelineForResume(id).resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan').model, '');
  } finally { runs.delete('r-live'); }
});
