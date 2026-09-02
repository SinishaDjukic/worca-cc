// test/api-workflows.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

// Outer isolation that outlives the per-suite before/after: /api/run returns a
// runId and the orchestrator finishes ASYNC in-process, so a store write can
// land after this file's before/after restores WORCA_HOME. Keeping a temp
// home set for the whole file means that late write still goes to temp, not ~.
useTempHome(after);

let homeDir, srv, base, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

/** A minimal VALID v2 graph body — the only shape POST /api/workflows takes
 *  after the v2 break (the v1 steps/feedbacks body is refused with 400). */
const graphBody = (name) => ({
  version: 2, name, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});

before(async () => {
  // Redirect the global ~/.worca-cc (workflow store) into a sandbox.
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1'; // keep /api/run offline
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  // Windows: a pipeline dir whose log a finished run still holds open answers
  // ENOTEMPTY/EBUSY for a moment; retry like test/cli-resume.test.mjs does.
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('GET /api/workflows lists the built-in default first', async () => {
  const r = await fetch(`${base}/api/workflows`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.workflows));
  assert.equal(j.workflows[0].id, 'wf_default');
  assert.equal(j.workflows[0].name, 'Default');
  // After the v2 break the built-in default IS the graph: nodes + wires, no steps.
  assert.equal(j.workflows[0].version, 2);
  assert.equal(j.workflows[0].nodes.length, 7);
  assert.equal(j.workflows[0].steps, undefined, 'no v1 topology on the default');
});

test('GET /api/workflows/:id returns the default template', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.id, 'wf_default');
  assert.ok(Array.isArray(j.wires), 'a graph template carries wires, not feedbacks');
});

test('GET /api/workflows/:id is 404 for an unknown id', async () => {
  const r = await fetch(`${base}/api/workflows/wf_does_not_exist`);
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error);
});

test('POST /api/workflows creates a valid template -> 201, then it lists', async () => {
  const r = await fetch(`${base}/api/workflows`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify(graphBody('Quick Fix')),
  });
  assert.equal(r.status, 201);
  const { workflow } = await r.json();
  assert.equal(workflow.name, 'Quick Fix');
  assert.match(workflow.id, /^wf_/);
  assert.ok(workflow.createdAt && workflow.updatedAt, 'stamped on write');

  // It now appears in the list (after the always-present default).
  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(list.workflows.some((w) => w.id === workflow.id && w.name === 'Quick Fix'));
});

test('DELETE /api/workflows/wf_default is refused -> 400', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default`, { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('DELETE /api/workflows/:id is 404 for an unknown id', async () => {
  const r = await fetch(`${base}/api/workflows/wf_missing_xyz`, { method: 'DELETE' });
  assert.equal(r.status, 404);
});

test('workflow API rejects path-traversal ids (no read, no delete)', async () => {
  // GET traversal must NOT 200-with-foreign-content; expect 404 (unknown/rejected).
  const g = await fetch(`${base}/api/workflows/${encodeURIComponent('../../package')}`);
  assert.equal(g.status, 404);
  // DELETE traversal must be refused (400 or 404) and never unlink anything.
  const d = await fetch(`${base}/api/workflows/${encodeURIComponent('../../package')}`, { method: 'DELETE' });
  assert.ok(d.status === 404 || d.status === 400, `expected 404/400, got ${d.status}`);
});

test('DELETE /api/workflows/:id removes a created template', async () => {
  // Create one to delete.
  const created = await (await fetch(`${base}/api/workflows`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify(graphBody('Disposable')),
  })).json();
  const id = created.workflow.id;

  const del = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true });

  // Gone from the list (default still present).
  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(!list.workflows.some((w) => w.id === id));
  assert.ok(list.workflows.some((w) => w.id === 'wf_default'));
});

test('GET /api/agents returns the palette registry as an ordered array', async () => {
  const r = await fetch(`${base}/api/agents`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.agents), 'agents is an array (palette render order)');
  // The 4 legacy + 2 new agents from the CONTRACT are present.
  const keys = j.agents.map((a) => a.key);
  for (const k of ['planner', 'refiner', 'implementer', 'reviewer',
                   'manualTestsChecklist', 'manualWebUiTesting']) {
    assert.ok(keys.includes(k), `registry includes ${k}`);
  }
  // Each pill carries what the palette needs to render.
  const planner = j.agents.find((a) => a.key === 'planner');
  assert.ok(planner.displayName, 'has a displayName');
  assert.ok(planner.color, 'has a color token');
  // Sorted ascending by .order (palette render order).
  const orders = j.agents.map((a) => a.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'ordered by .order');
});

test('POST /api/run starts with the implicit default workflow', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await fetch(`${base}/api/run`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir, prompt: 'demo task', mock: true }),
  });
  assert.equal(r.status, 200);
  assert.match((await r.json()).runId, /[0-9a-f-]{8,}/);
  await rm(projectDir, { recursive: true, force: true });
});

test('POST /api/run accepts an explicit workflowId', async () => {
  // Create a custom workflow, then run it.
  const wf = await (await fetch(`${base}/api/workflows`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify(graphBody('Run Me')),
  })).json();

  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await fetch(`${base}/api/run`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir, prompt: 'demo task', mock: true, workflowId: wf.workflow.id }),
  });
  assert.equal(r.status, 200, 'a known workflowId is accepted');
  assert.ok((await r.json()).runId);
  await rm(projectDir, { recursive: true, force: true });
});

test('POST /api/run rejects an unknown workflowId -> 400', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await fetch(`${base}/api/run`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir, prompt: 'demo task', mock: true, workflowId: 'wf_nope' }),
  });
  assert.equal(r.status, 400, 'an unknown workflow is a client error before the run starts');
  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config sets a node model+effort and a feedback cycle count', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rc-'));
  const wfId = 'wf_quickfix';

  let r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({
      projectDir, workflowId: wfId,
      nodes: { s1_0: { model: 'claude-opus-4-8', effort: 'high' } },
      feedbacks: { fb_0: { maxCycles: 3 } },
      activeWorkflowId: wfId,
    }),
  });
  assert.equal(r.status, 200);

  // GET reflects the run-config under config.workflows[wfId] + activeWorkflowId.
  r = await fetch(`${base}/api/config?${new URLSearchParams({ projectDir })}`);
  const j = await r.json();
  assert.deepEqual(j.config.workflows[wfId].nodes.s1_0, { model: 'claude-opus-4-8', effort: 'high' });
  assert.equal(j.config.workflows[wfId].feedbacks.fb_0.maxCycles, 3);
  assert.equal(j.config.activeWorkflowId, wfId);

  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config preserves legacy steps alongside workflows', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rc-'));
  // Set a legacy per-role step via the existing POST route.
  await fetch(`${base}/api/config`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir, step: 'reviewer', model: 'claude-opus-4-8', effort: 'max' }),
  });
  // Then a run-config node via PATCH.
  await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({
      projectDir, workflowId: 'wf_default',
      nodes: { s0_0: { model: 'claude-sonnet-4-6', effort: 'high' } },
    }),
  });
  const j = await (await fetch(`${base}/api/config?${new URLSearchParams({ projectDir })}`)).json();
  // Both coexist (backward-compatible: legacy steps untouched).
  assert.deepEqual(j.config.steps.reviewer, { model: 'claude-opus-4-8', effort: 'max' });
  assert.deepEqual(j.config.workflows.wf_default.nodes.s0_0, { model: 'claude-sonnet-4-6', effort: 'high' });
  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config without projectDir -> 400', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ workflowId: 'wf_default', nodes: {} }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/workflows rejects a v1 body with 400 and never writes a row', async () => {
  const res = await fetch(`${base}/api/workflows`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'Legacy', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'v1 pipeline templates are no longer accepted — save a graph (version 2)');
  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.equal(list.workflows.some((w) => w.name === 'Legacy'), false);
});
