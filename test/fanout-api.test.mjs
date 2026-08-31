// test/fanout-api.test.mjs — fanOut passthrough on the config endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let proj, srv, base, prevHome, homeDir;
const JSONH = { 'Content-Type': 'application/json' };
const q = (o) => new URLSearchParams(o).toString();

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-fanout-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // /api/config (POST step + PATCH node) drives setStep/setNodeModel, persisting
  // fanOut to the DB. Reset the db.mjs singleton so it reopens against THIS home
  // before the first request and again in teardown, isolating these writes in the
  // shared `node --test` run.
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-fanout-proj-'));
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

test('POST /api/config persists a step fanOut', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, step: 'planner', fanOut: true }),
  });
  assert.equal(r.status, 200);
  const g = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
  const j = await g.json();
  assert.equal(j.config.steps.planner.fanOut, true);
});

test('PATCH /api/config persists a node fanOut', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, workflowId: 'wf_default', nodes: { s2_0: { fanOut: true } } }),
  });
  assert.equal(r.status, 200);
  const g = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
  const j = await g.json();
  assert.equal(j.config.workflows.wf_default.nodes.s2_0.fanOut, true);
});

// ── the sub-agent model policy rides the same two endpoints ──────────────────

test('GET /api/config ships the sub-agent model vocabulary', async () => {
  const g = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
  const j = await g.json();
  assert.deepEqual(j.subagentModels, ['sonnet', 'opus', 'fable', 'auto', 'inherit'],
    'a fixed alias enum plus the two modes — the CLI Task tool refuses catalog ids, and haiku is off the menu');
});

test('POST /api/config persists a step subagentModel', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, step: 'planner', subagentModel: 'auto' }),
  });
  assert.equal(r.status, 200);
  const j = await (await fetch(`${base}/api/config?${q({ projectDir: proj })}`)).json();
  assert.equal(j.config.steps.planner.subagentModel, 'auto');
});

test('PATCH /api/config persists a node subagentModel', async () => {
  const r = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, workflowId: 'wf_default', nodes: { s2_0: { subagentModel: 'opus' } } }),
  });
  assert.equal(r.status, 200);
  const j = await (await fetch(`${base}/api/config?${q({ projectDir: proj })}`)).json();
  assert.equal(j.config.workflows.wf_default.nodes.s2_0.subagentModel, 'opus');
});

test('an off-vocabulary sub-agent model is a 400 on both writers', async () => {
  const post = await fetch(`${base}/api/config`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, step: 'planner', subagentModel: 'haiku' }),
  });
  assert.equal(post.status, 400);
  assert.match((await post.json()).error, /unknown sub-agent model "haiku"/);

  const patch = await fetch(`${base}/api/config`, {
    method: 'PATCH', headers: JSONH,
    body: JSON.stringify({ projectDir: proj, workflowId: 'wf_default', nodes: { s2_0: { subagentModel: 'haiku' } } }),
  });
  assert.equal(patch.status, 400);
});
