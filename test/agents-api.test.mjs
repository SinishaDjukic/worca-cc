// test/agents-api.test.mjs — /api/agents CRUD route surface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let srv, base, homeDir, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-agentsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

// meta v2: the save path validates typed ports, so the fixture declares them.
const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: '{base}-docs-review.md' }],
};
const MD = '# Agent: Docs Writer\n\nYou write docs.\n';

test('GET /api/agents carries origin + ports and EXCLUDES markdown', async () => {
  const r = await get('/api/agents');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.agents) && data.agents.length >= 9);
  assert.ok(data.agents.every((a) => a.origin === 'builtin' || a.origin === 'user'));
  assert.ok(data.agents.every((a) => !('markdown' in a)));
  assert.ok(data.agents.every((a) => Array.isArray(a.inputs) && Array.isArray(a.outputs)));
  assert.equal('channels' in data, false, 'the v1 channel vocabulary is gone from the payload');
  assert.ok(!data.agents.some((a) => a.key === 'workspaceScanner'), 'workspace-only excluded by default');
  const all = await (await get('/api/agents?all=1')).json();
  assert.ok(all.agents.some((a) => a.key === 'workspaceScanner'), '?all=1 includes workspace-only');
});

test('POST -> 201, GET :key (full incl. markdown), PUT, DELETE round-trip', async () => {
  const c = await post('/api/agents', { meta: META, markdown: MD });
  assert.equal(c.status, 201);
  const created = await c.json();
  assert.equal(created.meta.key, 'docsWriter');
  assert.equal(created.meta.origin, 'user');

  const g = await get('/api/agents/docsWriter');
  assert.equal(g.status, 200);
  assert.equal((await g.json()).markdown, MD);

  const u = await put('/api/agents/docsWriter', { meta: { ...META, displayName: 'Docs v2' }, markdown: MD + 'x\n' });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).meta.displayName, 'Docs v2');

  const d = await del('/api/agents/docsWriter');
  assert.equal(d.status, 200);
  assert.equal((await get('/api/agents/docsWriter')).status, 404);
});

test('built-in guardrails: PUT/DELETE planner -> 409, duplicate POST -> 409, bad body -> 400', async () => {
  assert.equal((await put('/api/agents/planner', { meta: META })).status, 409);
  const delB = await del('/api/agents/planner');
  assert.equal(delB.status, 409);
  assert.match((await delB.json()).error, /duplicate it/i);
  await post('/api/agents', { meta: META, markdown: MD });
  assert.equal((await post('/api/agents', { meta: META, markdown: MD })).status, 409);
  assert.equal((await post('/api/agents', { meta: META, markdown: '' })).status, 400);
  assert.equal((await get('/api/agents/..%2Fetc')).status, 404);
  await del('/api/agents/docsWriter');
});

test('DELETE a workflow-referenced agent -> 409; POST /api/workflows accepts a user-agent key', async () => {
  await post('/api/agents', { meta: META, markdown: MD });
  // A v2 graph: the save route validates topology through validateGraph, so the
  // reference has to be a real node in a valid template (task -> planner -> docs -> end).
  const wf = await post('/api/workflows', {
    name: 'Uses Docs', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
      { id: 'n_docs', kind: 'agent', key: 'docsWriter', x: 600, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 880, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_docs', port: 'plan' } },
      { id: 'w3', from: { node: 'n_docs', port: 'review' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  assert.equal(wf.status, 201, 'user agent validates in a workflow');
  const r = await del('/api/agents/docsWriter');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Uses Docs/);
});

test('GET /api/agents surfaces a user agent\'s custom port ids verbatim', async () => {
  // v2 has no channel list to register against: whatever the sidecar declares as a
  // port id IS the vocabulary, so a custom id needs no allow-listing anywhere.
  const meta = {
    metaVersion: 2, displayName: 'Spec Maker', description: 'emits a spec', color: 'blue',
    runnerType: 'producer', order: 50,
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'spec', type: 'json', filename: 'api-spec.json' }],
  };
  const c = await post('/api/agents', { meta, markdown: '# Agent: Spec Maker\n\nYou emit specs.\n' });
  assert.equal(c.status, 201);
  const data = await (await get('/api/agents')).json();
  const made = data.agents.find((a) => a.key === 'specMaker');
  assert.deepEqual(made.outputs.map((p) => p.id), ['spec']);
  assert.equal(made.outputs[0].filename, 'api-spec.json');
  assert.deepEqual(made.inputs.map((p) => p.id), ['plan']);
  await del('/api/agents/specMaker');
});
