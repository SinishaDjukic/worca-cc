import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

// Outer isolation that outlives the per-suite before/after — lifted VERBATIM
// from test/api-workflows.test.mjs:1-36 (only the mkdtemp prefix differs).
useTempHome(after);

let homeDir, srv, base, prevHome;

before(async () => {
  // Redirect the global ~/.worca-cc (workflow store) into a sandbox.
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfgraphapi-'));
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

// NOTE: the tests in this file are ORDER-DEPENDENT — rows accumulate in the one
// sandbox home, and the `?archived=1` case expects exactly ['Arch Me'].
// node:test runs a file's top-level tests sequentially, so that is safe; do not
// reorder them and do not add a passing save before the 422 case.
const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const GOOD = {
  version: 2, name: 'Api Graph', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

test('POST /api/workflows with version 2 saves a graph row', async () => {
  const r = await api('POST', '/api/workflows', GOOD);
  assert.equal(r.status, 201);
  assert.equal(r.body.workflow.version, 2);
  assert.deepEqual(r.body.workflow.nodes.map((n) => n.id), ['n_task', 'n_plan', 'n_end']);
  const row = prepare('SELECT version, graph FROM workflows WHERE id = ?').get(r.body.workflow.id);
  assert.equal(row.version, 2);
  assert.ok(JSON.parse(row.graph).wires.length === 2);
});

test('an invalid graph is 422 with the SHARED validator issues, byte for byte', async () => {
  // w3 must be a DISTINCT pair into an already-wired input. Repeating w1's
  // endpoints would make it a duplicate PAIR, and V6 runs BEFORE V7, so
  // errors[0].code would be 'V6' — the identity assertion would still hold, but
  // the rule under test would not be the one pinned.
  const bad = { ...GOOD, wires: [...GOOD.wires,
    { id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }] };
  const r = await api('POST', '/api/workflows', bad);
  assert.equal(r.status, 422);
  const portsFn = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  const expected = validateGraph({ ...bad, id: '', name: bad.name }, portsFn);
  assert.deepEqual(r.body.errors, expected.errors);
  assert.deepEqual(r.body.warnings, expected.warnings);
  assert.equal(r.body.errors[0].code, 'V7', "the single-wire rule is what n_end.result's second wire trips");
  assert.equal(prepare('SELECT count(*) AS n FROM workflows').get().n, 1, 'nothing was written');
});

test('a malformed nodes/wires entry is 422, never a 500 and never a written row', async () => {
  // `nodes:[{}], wires:[{}]` used to 500 with "Cannot read properties of
  // undefined (reading 'node')" — the validator indexed the id-less node under
  // `undefined`, so the endpoint-less wire resolved through it and threw.
  const bare = await api('POST', '/api/workflows', { version: 2, name: 'Bare', nodes: [{}], wires: [{}] });
  assert.equal(bare.status, 422);
  assert.equal(bare.body.error, 'invalid graph');
  assert.ok(bare.body.errors.some((e) => e.code === 'V2'));
  assert.ok(bare.body.errors.some((e) => e.code === 'V5'));
  // A `null` node validated CLEAN and was written; Ask's shapeWorkflow then threw
  // for every thread until the row was deleted.
  const nulled = await api('POST', '/api/workflows', { ...GOOD, name: 'Nulled', nodes: [null, ...GOOD.nodes] });
  assert.equal(nulled.status, 422);
  assert.ok(nulled.body.errors.some((e) => e.code === 'V1' && /nodes\[0\] must be an object \(got null\)/.test(e.message)));
  assert.equal(prepare('SELECT count(*) AS n FROM workflows').get().n, 1, 'nothing was written');
});

test('a v2 save validates agent node config against the model catalog', async () => {
  // Parity with the v1 branch (`ui/server.mjs:3150-3156`): without it a body
  // carrying `config: { model: 'nope' }` is stored and only fails at the spawn.
  const bad = { ...GOOD, name: 'Bad Model',
    nodes: GOOD.nodes.map((n) => (n.id === 'n_plan' ? { ...n, config: { model: 'nope' } } : n)) };
  const r = await api('POST', '/api/workflows', bad);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown model "nope"', 'the same text PATCH .../defaults returns');
  assert.equal(prepare('SELECT count(*) AS n FROM workflows').get().n, 1, 'nothing was written');
});

test('GET /api/workflows/:id — 404 with the archive message', async () => {
  const saved = (await api('POST', '/api/workflows', { ...GOOD, name: 'Arch Me' })).body.workflow;
  assert.equal((await api('GET', `/api/workflows/${saved.id}`)).status, 200);
  getDb();
  prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', saved.id);
  const gone = await api('GET', `/api/workflows/${saved.id}`);
  assert.equal(gone.status, 404);
  assert.match(gone.body.error, /was archived by the v2 upgrade \(v1 template, not runnable\)/);
  const ghost = await api('GET', '/api/workflows/wf_nope');
  assert.equal(ghost.status, 404);
  assert.equal(ghost.body.error, 'unknown workflowId "wf_nope"');
});

test('GET /api/workflows hides archived rows; ?archived=1 shows ONLY them', async () => {
  const live = await api('GET', '/api/workflows');
  assert.equal(live.body.workflows[0].id, 'wf_default');
  assert.equal(live.body.workflows.some((w) => w.name === 'Arch Me'), false);
  const arch = await api('GET', '/api/workflows?archived=1');
  assert.deepEqual(arch.body.workflows.map((w) => w.name), ['Arch Me']);
  assert.ok(arch.body.workflows.every((w) => w.archivedAt));
});

test('PATCH /api/workflows/:id/defaults rewrites a v2 node config', async () => {
  const saved = (await api('POST', '/api/workflows', { ...GOOD, name: 'Defaults' })).body.workflow;
  const r = await api('PATCH', `/api/workflows/${saved.id}/defaults`, { defaults: { n_plan: { fanOut: true } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.defaults, { n_plan: { fanOut: true } });
  assert.deepEqual(r.body.workflow.nodes.find((n) => n.id === 'n_plan').config, { fanOut: true });
});

test('PATCH /api/config writes wire budgets and GET /api/config emits them', async () => {
  const patch = await api('PATCH', '/api/config',
    { projectDir: homeDir, workflowId: 'wf_g', wires: { w5: { maxCycles: 4 }, w9: { maxCycles: 0 } } });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.body.config.workflows.wf_g.wires, { w5: { maxCycles: 4 }, w9: { maxCycles: 1 } });
  const get = await api('GET', `/api/config?projectDir=${encodeURIComponent(homeDir)}`);
  assert.deepEqual(get.body.config.workflows.wf_g.wires.w5, { maxCycles: 4 });
  assert.deepEqual(get.body.config.workflows.wf_g.feedbacks, {}, 'both keys are emitted during coexistence');
});

test('PATCH /api/config without a workflowId refuses wire config', async () => {
  const r = await api('PATCH', '/api/config', { projectDir: homeDir, wires: { w5: { maxCycles: 2 } } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /workflowId is required to set wire config/);
});

test('DELETE /api/config/workflow clears nodes AND wires', async () => {
  // A catalog id: PATCH /api/config -> setNodeModel validates against listModels().
  await api('PATCH', '/api/config',
    { projectDir: homeDir, workflowId: 'wf_g', nodes: { n_plan: { model: 'claude-sonnet-5' } } });
  const res = await fetch(`${base}/api/config/workflow?projectDir=${encodeURIComponent(homeDir)}&workflowId=wf_g`,
    { method: 'DELETE' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.config.workflows.wf_g, undefined);
});

// MAJ-1: the three run-config arms wrote `workflowId` into the normalized tables
// with no shape check, so '__proto__' poisoned readWorkflowsMap for the whole
// project. isSafeWorkflowId (workflows.mjs) is now the ONE gate; the recovery
// route (DELETE /api/config/workflow) deliberately stays ungated so an
// already-poisoned row can still be cleared.
test('PATCH /api/config refuses an unsafe workflowId on every arm', async () => {
  const arms = [
    ['nodes', { nodes: { n_plan: { model: 'claude-sonnet-5' } } }],
    ['feedbacks', { feedbacks: { fb_0: { maxCycles: 2 } } }],
    ['wires', { wires: { w5: { maxCycles: 2 } } }],
  ];
  for (const [what, arm] of arms) {
    const r = await api('PATCH', '/api/config', { projectDir: homeDir, workflowId: '__proto__', ...arm });
    assert.equal(r.status, 400, `${what} arm must be a client error`);
    assert.match(r.body.error, /invalid workflowId/, `${what} arm message`);
  }
  const act = await api('PATCH', '/api/config', { projectDir: homeDir, activeWorkflowId: 'hasOwnProperty' });
  assert.equal(act.status, 400, 'activeWorkflowId arm must be a client error');
  assert.match(act.body.error, /invalid workflowId/);
  const get = await api('GET', `/api/config?projectDir=${encodeURIComponent(homeDir)}`);
  assert.equal(get.status, 200, 'GET /api/config is not poisoned');
  assert.equal(Object.prototype.hasOwnProperty.call(get.body.config.workflows, '__proto__'), false,
    'no row was written for the refused id');
});

test('PATCH /api/config still accepts a safe workflowId', async () => {
  const r = await api('PATCH', '/api/config',
    { projectDir: homeDir, workflowId: 'wf_safe-id', wires: { w1: { maxCycles: 2 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.config.workflows['wf_safe-id'].wires, { w1: { maxCycles: 2 } });
});

// C-3: a save named "Default" used to answer 201 with an invisible, unreadable,
// undeletable wf_default row. 422 is the same code the shared validator's
// refusal uses, and the body carries NO issues array so app.js's saveWorkflow
// hands `error` straight to the save dialog's .sd-msg.
test('POST /api/workflows refuses a name that slugs onto wf_default with a 422', async () => {
  const before = prepare('SELECT COUNT(*) AS n FROM workflows').get().n;
  for (const name of ['Default', '  dEfAuLt  ', 'default!!']) {
    const r = await api('POST', '/api/workflows', { ...GOOD, name });
    assert.equal(r.status, 422, `name ${JSON.stringify(name)}`);
    assert.deepEqual(r.body, { error: 'the name "Default" is reserved — choose another name' });
    assert.equal(r.body.errors, undefined, 'no issues array: the dialog must render `error` verbatim');
  }
  assert.equal(prepare('SELECT COUNT(*) AS n FROM workflows').get().n, before, 'no row was written');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_default').n, 0);
  const list = await api('GET', '/api/workflows');
  assert.equal(list.body.workflows.filter((w) => w.id === 'wf_default').length, 1,
    'only the built-in, still with its own 7 nodes');
  assert.equal(list.body.workflows.find((w) => w.id === 'wf_default').nodes.length, 7);
});

// MAJ-5: two "Save a copy" clicks both mint wf_full-copy; the second used to
// answer 201 while silently replacing the first and inheriting its createdAt.
test('POST /api/workflows answers 409 when the MINTED id is already taken', async () => {
  const first = await api('POST', '/api/workflows', { ...GOOD, name: 'Full copy' });
  assert.equal(first.status, 201);
  assert.equal(first.body.workflow.id, 'wf_full-copy');

  // A DIFFERENT but equally legal graph (task -> planner -> refiner -> end):
  // exactly one end node, every input wired, so the 422 arm cannot mask the 409.
  const bigger = { ...GOOD, name: 'Full copy',
    nodes: [GOOD.nodes[0], GOOD.nodes[1],
      { id: 'n_ref', kind: 'agent', key: 'refiner', x: 450, y: 0, config: {} }, GOOD.nodes[2]],
    wires: [GOOD.wires[0],
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_ref', port: 'plan' } },
      { id: 'w3', from: { node: 'n_ref', port: 'plan' }, to: { node: 'n_end', port: 'result' } }] };
  const clash = await api('POST', '/api/workflows', bigger);
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.body, {
    error: 'a pipeline with the id "wf_full-copy" already exists — choose another name',
    id: 'wf_full-copy',
  });
  assert.equal(clash.body.errors, undefined, 'no issues array: the dialog renders `error` verbatim');

  const still = await api('GET', '/api/workflows/wf_full-copy');
  assert.equal(still.body.nodes.length, 3, 'the first copy is intact');
  assert.equal(still.body.nodes.some((n) => n.id === 'n_ref'), false, 'the clashing graph was NOT written');
  assert.equal(still.body.createdAt, first.body.workflow.createdAt);

  // The in-place re-save (body.id present) must still succeed — this is the
  // ordinary Save on a loaded row and it may not be broken by the 409.
  const resave = await api('POST', '/api/workflows', { ...bigger, id: 'wf_full-copy' });
  assert.equal(resave.status, 201);
  assert.equal(resave.body.workflow.nodes.length, 4);
  assert.equal(resave.body.workflow.createdAt, first.body.workflow.createdAt, 'createdAt is preserved in place');
});

// MAJ-2: an oversized POST used to run the O(n^2) loop analysis on the raw body
// and then answer with an N+3-entry error array (>2x amplification). The 422
// body is now O(1) whatever the input size.
test('POST /api/workflows answers ONE V1 issue for an over-limit graph', async () => {
  const nodes = [...GOOD.nodes];
  for (let i = 0; i < 500; i++) nodes.push({ id: `n_x${i}`, kind: 'agent', key: 'planner', x: i, y: 0, config: {} });
  const r = await api('POST', '/api/workflows', { ...GOOD, name: 'Too Big', nodes });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'invalid graph');
  assert.equal(r.body.errors.length, 1, `one issue, got ${r.body.errors.length}`);
  assert.equal(r.body.errors[0].code, 'V1');
  assert.equal(r.body.errors[0].message, 'template has 503 nodes — the limit is 80');
  assert.deepEqual(r.body.warnings, []);
  assert.equal(prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_too-big').n, 0);
});
