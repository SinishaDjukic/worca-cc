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

const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'docs-review.md' }],
};
const MD = '# Agent: Docs Writer\n\nYou write docs.\n';

test('GET /api/agents carries origin + mockWriterRoles and EXCLUDES markdown', async () => {
  const r = await get('/api/agents');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data.agents) && data.agents.length >= 9);
  assert.ok(data.agents.every((a) => a.origin === 'builtin' || a.origin === 'user'));
  assert.ok(data.agents.every((a) => !('markdown' in a)));
  // mockWriterRoles is a CLOSED list (the mock switch in claude-runner.mjs),
  // unlike the open channel vocabulary it will replace in Task 12.
  assert.ok(Array.isArray(data.mockWriterRoles));
  assert.ok(data.mockWriterRoles.includes('generic-verifier') && data.mockWriterRoles.includes('clarify'));
  assert.ok(!data.agents.some((a) => a.key === 'workspaceScanner'), 'workspace-only excluded by default');
  const all = await (await get('/api/agents?all=1')).json();
  assert.ok(all.agents.some((a) => a.key === 'workspaceScanner'), '?all=1 includes workspace-only');
});

// NOTE: this one is GREEN before the change — the 11 builtin sidecars already
// carry v2 ports (P1 seeded them). It is a REGRESSION PIN on that seed data, not
// a red-to-green test for this task. Keep it; do not "fix" it into failing.
test('GET /api/agents carries the v2 port fields the composer and the editor need', async () => {
  const { agents } = await (await get('/api/agents')).json();
  const planner = agents.find((a) => a.key === 'planner');
  assert.equal(planner.metaVersion, 2);
  assert.ok(Array.isArray(planner.inputs) && planner.inputs.some((p) => p.id === 'task'));
  assert.ok(Array.isArray(planner.outputs) && planner.outputs.some((p) => p.id === 'plan'));
  assert.equal(typeof planner.portSummary, 'string');
  assert.ok(planner.portSummary.length > 0);
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
  const wf = await post('/api/workflows', { name: 'Uses Docs', steps: [[{ id: 's0_0', key: 'docsWriter' }]], feedbacks: [] });
  assert.equal(wf.status, 201, 'user agent validates in a workflow');
  const r = await del('/api/agents/docsWriter');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Uses Docs/);
});

test('GET /api/agents channels is the open-vocabulary union: built-ins + custom ids from agents', async () => {
  const meta = {
    displayName: 'Spec Maker', description: 'emits a spec', color: 'blue', runnerType: 'producer',
    consumes: ['plan'], produces: ['spec'], order: 50,
    channelDefs: [{ id: 'spec', kind: 'json', filename: 'api-spec.json' }],
  };
  const c = await post('/api/agents', { meta, markdown: '# Agent: Spec Maker\n\nYou emit specs.\n' });
  assert.equal(c.status, 201);
  const data = await (await get('/api/agents')).json();
  assert.ok(data.channels.includes('plan'), 'built-ins still present');
  assert.ok(data.channels.includes('spec'), 'custom channel id surfaced');
  assert.ok(data.channels.indexOf('spec') > data.channels.indexOf('decomposition'), 'customs appended after built-ins');
  assert.equal(new Set(data.channels).size, data.channels.length, 'deduped');
  await del('/api/agents/specMaker');
});
