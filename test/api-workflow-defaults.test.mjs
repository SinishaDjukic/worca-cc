// test/api-workflow-defaults.test.mjs — the two endpoints the New-Pipeline
// accordion's header actions call (newpipeline-ux-design.md §4.4/§4.5):
//   PATCH  /api/workflows/:id/defaults  -> "Save as workflow defaults"
//   DELETE /api/config/workflow         -> "Reset"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, projectDir, srv, base, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfdefapi-'));
  projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfdefproj-'));
  await mkdir(join(projectDir, '.git'), { recursive: true }); // look like a repo
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (path, body) => fetch(`${base}${path}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });

// POST /api/workflows takes ONLY a v2 graph after the break. V2 pins node ids to
// /^n_[a-z0-9]{1,32}$/, so the old n0/n1 become n_a/n_b, and a node's per-node
// defaults ARE its `config` block (§4) rather than a `defaults` key inside steps.
async function makeWorkflow(name) {
  const r = await post('/api/workflows', {
    version: 2, name, domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_b', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_b', port: 'plan' } },
      { id: 'w3', from: { node: 'n_b', port: 'review' }, to: { node: 'n_end', port: 'result' } }],
  });
  assert.equal(r.status, 201, `create ${name}`);
  return (await r.json()).workflow.id;
}

/** A saved graph's per-node block, as GET /api/workflows/:id serves it. */
const nodeConfig = (tpl, id) => tpl.nodes.find((n) => n.id === id).config;

// ── PATCH /api/workflows/:id/defaults ───────────────────────────────────────

test('PATCH .../defaults stores per-node defaults and echoes the flattened map', async () => {
  const id = await makeWorkflow('Defaults Happy');
  const r = await patch(`/api/workflows/${id}/defaults`, {
    defaults: { n_a: { model: 'claude-opus-4-8', effort: 'high', fanOut: true }, n_b: { fanOut: false } },
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.defaults, {
    n_a: { model: 'claude-opus-4-8', effort: 'high', fanOut: true },
    n_b: { fanOut: false },
  });
  // GET reflects it, so a reload paints the same rows.
  const got = await (await fetch(`${base}/api/workflows/${id}`)).json();
  assert.deepEqual(nodeConfig(got, 'n_a'), { model: 'claude-opus-4-8', effort: 'high', fanOut: true });
});

test('PATCH .../defaults rejects an unknown model, a bad effort, and an effort with no model', async () => {
  const id = await makeWorkflow('Defaults Validation');
  for (const [defaults, re] of [
    [{ n_a: { model: 'no-such-model' } }, /unknown model/],
    [{ n_a: { model: 'claude-opus-4-8', effort: 'ludicrous' } }, /unknown effort/],
    [{ n_a: { effort: 'high' } }, /select a model/],
  ]) {
    const r = await patch(`/api/workflows/${id}/defaults`, { defaults });
    assert.equal(r.status, 400, JSON.stringify(defaults));
    assert.match((await r.json()).error, re);
  }
  // Nothing partial was written.
  const got = await (await fetch(`${base}/api/workflows/${id}`)).json();
  assert.deepEqual(nodeConfig(got, 'n_a'), {}, 'an untouched node keeps an EMPTY config, never a defaults key');
});

test('PATCH .../defaults: 400 on a non-object body, 404 unknown id, 400 on the built-in default', async () => {
  const id = await makeWorkflow('Defaults Shape');
  assert.equal((await patch(`/api/workflows/${id}/defaults`, { defaults: 'nope' })).status, 400);
  assert.equal((await patch('/api/workflows/wf_ghost/defaults', { defaults: {} })).status, 404);
  const frozen = await patch('/api/workflows/wf_default/defaults', { defaults: { s0_0: { fanOut: true } } });
  assert.equal(frozen.status, 400);
  assert.match((await frozen.json()).error, /cannot store defaults/);
});

test('POST /api/workflows validates defaults that ride along inside node config', async () => {
  const r = await post('/api/workflows', {
    version: 2, name: 'Smuggled', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_a', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'no-such-model' } },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /unknown model/);
});

// ── DELETE /api/config/workflow ─────────────────────────────────────────────

const readConfigApi = async () =>
  (await (await fetch(`${base}/api/config?projectDir=${encodeURIComponent(projectDir)}`)).json()).config;

test('DELETE /api/config/workflow drops that workflow\'s node + feedback overrides only', async () => {
  const keep = await makeWorkflow('Keep Mine');
  const drop = await makeWorkflow('Drop Mine');
  for (const id of [keep, drop]) {
    await patch('/api/config', {
      projectDir, workflowId: id,
      nodes: { n_a: { model: 'claude-opus-4-8', effort: 'high' } },
      feedbacks: { fb: { maxCycles: 9 } },
    });
  }
  const r = await fetch(
    `${base}/api/config/workflow?projectDir=${encodeURIComponent(projectDir)}&workflowId=${encodeURIComponent(drop)}`,
    { method: 'DELETE' },
  );
  assert.equal(r.status, 200);
  const cfg = (await r.json()).config;
  assert.equal(cfg.workflows[drop], undefined, 'reset workflow has no overrides left');
  assert.deepEqual(cfg.workflows[keep].nodes.n_a, { model: 'claude-opus-4-8', effort: 'high' }, 'other workflow untouched');
  assert.equal(cfg.workflows[keep].feedbacks.fb.maxCycles, 9);
});

test('resetting wf_default also clears the legacy per-role steps (where its overrides live)', async () => {
  await post('/api/config', { projectDir, step: 'planner', model: 'claude-opus-4-8', effort: 'high' });
  await patch('/api/config', { projectDir, workflowId: 'wf_default', nodes: { s0_0: { model: 'claude-haiku-4-5' } } });
  assert.ok((await readConfigApi()).steps.planner, 'precondition: a legacy step exists');

  const r = await fetch(
    `${base}/api/config/workflow?projectDir=${encodeURIComponent(projectDir)}&workflowId=wf_default`,
    { method: 'DELETE' },
  );
  assert.equal(r.status, 200);
  const cfg = (await r.json()).config;
  assert.deepEqual(cfg.steps, {}, 'legacy steps cleared — otherwise the run would still use the old model');
  assert.equal(cfg.workflows.wf_default, undefined);
});

test('DELETE /api/config/workflow is idempotent and 400s without its two ids', async () => {
  const again = await fetch(
    `${base}/api/config/workflow?projectDir=${encodeURIComponent(projectDir)}&workflowId=wf_default`,
    { method: 'DELETE' },
  );
  assert.equal(again.status, 200, 'resetting an already-clean project is a no-op');
  assert.equal((await fetch(`${base}/api/config/workflow?workflowId=wf_default`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(
    `${base}/api/config/workflow?projectDir=${encodeURIComponent(projectDir)}`, { method: 'DELETE' },
  )).status, 400);
});
