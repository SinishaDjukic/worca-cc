// test/api-workflows.test.mjs — the v2 /api/workflows surface: GET lists the
// built-in GRAPH_DEFAULT_WORKFLOW first then the stored graphs, POST validates
// the posted template through validateGraph over registryPortsFn(registry) — the
// SYNTHESIZING ports function, which is what lets an unsaved template's
// `pass -> <agent>.await` and End wires resolve — and answers 422 {errors,
// warnings} when a rule blocks. Harness = the long-standing Variant A boot
// (import the app => no port bind, mount it on an ephemeral port).
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
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

/**
 * A valid v2 graph: task -> planner -> implementer -> reviewer, the blocking
 * review looping back to implementer.fix, and reviewer.pass gating the checklist
 * through its SYNTHESIZED `await` port before the checklist lands on End. The
 * await wire is the point: it exists only because the route validates through
 * registryPortsFn, never through the raw registry meta ports.
 */
function awaitWiredTemplate(name) {
  return {
    name, version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 200, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 880, y: 200, config: {} },
      { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1160, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 1440, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
      { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
      { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
      { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
      { id: 'w7', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
      { id: 'w8', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

/** The smallest valid graph: task -> planner -> end. */
function minimalTemplate(name) {
  return {
    name, version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

test('GET /api/workflows lists the built-in default first as a v2 graph', async () => {
  const r = await fetch(`${base}/api/workflows`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.workflows));
  const def = j.workflows[0];
  assert.equal(def.id, 'wf_default');
  assert.equal(def.name, 'Default');
  assert.equal(def.version, 2, 'v2 only — the v1 steps/feedbacks shape is gone');
  assert.ok(Array.isArray(def.nodes) && Array.isArray(def.wires));
  assert.equal(def.steps, undefined, 'no v1 steps array');
  assert.equal(def.feedbacks, undefined, 'no v1 feedbacks array');
  // The default carries the seven-node topology including the Task and End cards.
  assert.deepEqual(
    def.nodes.map((n) => n.id),
    ['n_task', 'n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review', 'n_end'],
  );
  assert.equal(def.nodes.find((n) => n.id === 'n_task').kind, 'task');
  assert.equal(def.nodes.find((n) => n.id === 'n_end').kind, 'end');
  assert.equal(def.wires.length, 10);
});

test('GET /api/workflows/:id returns the default v2 template', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.id, 'wf_default');
  assert.equal(j.version, 2);
  assert.ok(Array.isArray(j.nodes) && Array.isArray(j.wires));
});

test('GET /api/workflows/:id is 404 for an unknown id', async () => {
  const r = await fetch(`${base}/api/workflows/wf_does_not_exist`);
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error);
});

test('POST /api/workflows rejects a v1 steps/feedbacks payload -> 422 {errors, warnings}', async () => {
  const r = await post('/api/workflows', { name: 'Legacy', steps: [], feedbacks: [] });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.ok(Array.isArray(j.errors) && j.errors.length >= 1, 'carries validateGraph errors');
  assert.ok(Array.isArray(j.warnings), 'carries a warnings array even when errors block');
  assert.ok(j.errors.some((e) => e.code === 'V1'), 'a v1 payload is not a version-2 template');
  assert.ok(j.errors.every((e) => typeof e.code === 'string' && typeof e.msg === 'string'));
});

test('POST /api/workflows rejects an unknown agent key -> 422 V4', async () => {
  const tpl = minimalTemplate('Bogus');
  tpl.nodes[1].key = 'notAnAgent';
  const r = await post('/api/workflows', tpl);
  assert.equal(r.status, 422);
  const j = await r.json();
  const v4 = j.errors.find((e) => e.code === 'V4');
  assert.ok(v4, 'unknown key is V4');
  assert.equal(v4.msg, "agent 'notAnAgent' is not loaded — a metaVersion-1 sidecar must be migrated to 2");
  assert.equal(v4.nodeId, 'n_plan');
});

test('POST /api/workflows rejects a second wire into one input -> 422 V7', async () => {
  const tpl = minimalTemplate('Double Wired');
  tpl.wires.push({ id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } });
  const r = await post('/api/workflows', tpl);
  assert.equal(r.status, 422);
  const j = await r.json();
  const v7 = j.errors.find((e) => e.code === 'V7');
  assert.ok(v7, 'every input accepts at most one inbound wire');
  assert.equal(v7.wireId, 'w3');
});

test('POST /api/workflows: a template wiring reviewer.pass -> checklist.await saves CLEAN', async () => {
  // Proof the route validates through registryPortsFn: the `await` input is
  // SYNTHESIZED per agent node and appears in no sidecar, so a non-synthesizing
  // portsFn would fail this wire with V5.
  const r = await post('/api/workflows', awaitWiredTemplate('Await Wired'));
  assert.equal(r.status, 201, 'the synthesized await port resolves');
  const { workflow, warnings } = await r.json();
  assert.deepEqual(warnings, [], 'clean topology has no warnings');
  assert.equal(workflow.name, 'Await Wired');
  assert.equal(workflow.version, 2);
  assert.match(workflow.id, /^wf_/);
  assert.ok(workflow.createdAt && workflow.updatedAt, 'stamped on write');
  assert.equal(workflow.nodes.length, 6, 'the posted graph is persisted, not blanked');
  assert.equal(workflow.wires.length, 8);

  // It round-trips through the store, await wire and loop budget intact.
  const stored = await (await fetch(`${base}/api/workflows/${workflow.id}`)).json();
  assert.deepEqual(stored.wires.find((w) => w.id === 'w6').to, { node: 'n_check', port: 'await' });
  assert.deepEqual(stored.wires.find((w) => w.id === 'w5').config, { maxCycles: 3 });

  // And it lists (after the always-present default).
  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(list.workflows.some((w) => w.id === workflow.id && w.name === 'Await Wired'));
});

test('POST /api/workflows persists the canvas view state and re-saves in place', async () => {
  const first = await (await post('/api/workflows', {
    ...minimalTemplate('Canvassed'), canvas: { x: 10, y: 20, zoom: 1.5 },
  })).json();
  const id = first.workflow.id;

  assert.deepEqual(first.workflow.canvas, { x: 10, y: 20, zoom: 1.5 }, 'view state round-trips');

  // Renaming under the SAME id must update that row, not mint wf_renamed: only a
  // forwarded body.id can do that (writeWorkflow otherwise slugs from the name).
  const again = await post('/api/workflows', { ...minimalTemplate('Renamed'), id, domain: 'general' });
  assert.equal(again.status, 201);
  const { workflow } = await again.json();
  assert.equal(workflow.id, id, 'an explicit id re-saves in place instead of minting a second row');
  assert.equal(workflow.name, 'Renamed');
  assert.equal(workflow.domain, 'general');
  assert.equal(workflow.createdAt, first.workflow.createdAt, 'createdAt is preserved across re-saves');

  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.equal(list.workflows.filter((w) => w.id === id).length, 1);
  assert.ok(!list.workflows.some((w) => w.id === 'wf_renamed'), 'no second row minted from the new name');
});

test('POST /api/workflows without a name -> 400', async () => {
  const r = await post('/api/workflows', { ...minimalTemplate('x'), name: '  ' });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('POST /api/workflows refuses to shadow the built-in default -> 400', async () => {
  const r = await post('/api/workflows', { ...minimalTemplate('Default'), id: 'wf_default' });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
  // The built-in is still the one GET serves.
  const def = await (await fetch(`${base}/api/workflows/wf_default`)).json();
  assert.equal(def.nodes.length, 7);
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
  const created = await (await post('/api/workflows', minimalTemplate('Disposable'))).json();
  const id = created.workflow.id;

  const del = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true });

  // Gone from the list (default still present).
  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(!list.workflows.some((w) => w.id === id));
  assert.ok(list.workflows.some((w) => w.id === 'wf_default'));
});

test('POST /api/run starts with the implicit default workflow', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true });
  assert.equal(r.status, 200);
  assert.match((await r.json()).runId, /[0-9a-f-]{8,}/);
  await rm(projectDir, { recursive: true, force: true });
});

test('POST /api/run accepts an explicit workflowId', async () => {
  const wf = await (await post('/api/workflows', minimalTemplate('Run Me'))).json();

  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, workflowId: wf.workflow.id });
  assert.equal(r.status, 200, 'a known workflowId is accepted');
  assert.ok((await r.json()).runId);
  await rm(projectDir, { recursive: true, force: true });
});

test('POST /api/run rejects an unknown workflowId -> 400', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-run-'));
  const r = await post('/api/run', { projectDir, prompt: 'demo task', mock: true, workflowId: 'wf_nope' });
  assert.equal(r.status, 400, 'an unknown workflow is a client error before the run starts');
  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config sets a node model+effort and a per-WIRE cycle budget', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rc-'));
  const wfId = 'wf_quickfix';

  let r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({
      projectDir, workflowId: wfId,
      nodes: { n_impl: { model: 'claude-opus-4-8', effort: 'high' } },
      wires: { w5: { maxCycles: 6 } },
      activeWorkflowId: wfId,
    }),
  });
  assert.equal(r.status, 200);

  // GET reflects the run-config under config.workflows[wfId] + activeWorkflowId.
  r = await fetch(`${base}/api/config?${new URLSearchParams({ projectDir })}`);
  const j = await r.json();
  assert.deepEqual(j.config.workflows[wfId].nodes.n_impl, { model: 'claude-opus-4-8', effort: 'high' });
  assert.deepEqual(j.config.workflows[wfId].wires.w5, { maxCycles: 6 });
  assert.equal(j.config.activeWorkflowId, wfId);

  // The overlay is a per-wire UPSERT: a second PATCH replaces the budget.
  await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ projectDir, workflowId: wfId, wires: { w5: { maxCycles: 2 }, w9: { maxCycles: 4 } } }),
  });
  const after2 = await (await fetch(`${base}/api/config?${new URLSearchParams({ projectDir })}`)).json();
  assert.deepEqual(after2.config.workflows[wfId].wires, { w5: { maxCycles: 2 }, w9: { maxCycles: 4 } });

  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config rejects wire budgets without a workflowId -> 400', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rc-'));
  const r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ projectDir, wires: { w5: { maxCycles: 6 } } }),
  });
  assert.equal(r.status, 400);
  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config preserves legacy steps alongside workflows', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-rc-'));
  // Set a legacy per-role step via the existing POST route.
  await post('/api/config', { projectDir, step: 'reviewer', model: 'claude-opus-4-8', effort: 'max' });
  // Then a run-config node via PATCH.
  await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({
      projectDir, workflowId: 'wf_default',
      nodes: { n_plan: { model: 'claude-sonnet-4-6', effort: 'high' } },
    }),
  });
  const j = await (await fetch(`${base}/api/config?${new URLSearchParams({ projectDir })}`)).json();
  // Both coexist (backward-compatible: legacy steps untouched).
  assert.deepEqual(j.config.steps.reviewer, { model: 'claude-opus-4-8', effort: 'max' });
  assert.deepEqual(j.config.workflows.wf_default.nodes.n_plan, { model: 'claude-sonnet-4-6', effort: 'high' });
  await rm(projectDir, { recursive: true, force: true });
});

test('PATCH /api/config without projectDir -> 400', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ workflowId: 'wf_default', nodes: {} }),
  });
  assert.equal(r.status, 400);
});
