// test/api-models.test.mjs
// Global model catalog HTTP API (configurable-models-design.md §4.10):
// GET/POST/PATCH/DELETE /api/models with masked env values (write-only
// editing, ${VAR} refs readable, masked echoes mean "keep"), the refs preview,
// and the catalog surfacing in /api/config. Sandboxes WORCA_HOME (DB) and
// HOME (settings.json) and opts into the catalog guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { listGlobalModels } from '../src/core/settings.mjs';
import { setNodeModel } from '../src/core/config.mjs';
import { EFFORTS } from '../src/core/model-env.mjs';

let proj, srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
const q = (o) => new URLSearchParams(o).toString();
const jfetch = async (path, opts) => {
  const r = await fetch(`${base}${path}`, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (path, body) => jfetch(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const patch = (path, body) => jfetch(path, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apimodels-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apimodels-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME sandboxed above
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-apimodels-proj-'));
  const { app } = await import('../ui/server.mjs'); // imported => does not bind a port
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all([proj, homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('GET /api/models: empty catalog + predefined + efforts', async () => {
  const { status, body } = await jfetch('/api/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models, []);
  assert.ok(body.predefined.some((m) => m.id === 'claude-opus-5'));
  assert.deepEqual(body.efforts, EFFORTS);
});

test('POST /api/models adds a global entry; env values come back MASKED, ${VAR} refs readable', async () => {
  const { status, body } = await post('/api/models', {
    id: 'glm-4.7', label: 'GLM (proxy)', efforts: ['high', 'medium'],
    env: { ANTHROPIC_BASE_URL: 'https://proxy.example/v1', ANTHROPIC_AUTH_TOKEN: 'sk-live-abcdef1234', X_REF: '${MY_VAR}' },
  });
  assert.equal(status, 200);
  assert.equal(body.model.id, 'glm-4.7');
  assert.deepEqual(body.model.efforts, ['medium', 'high']);
  assert.equal(body.model.env.ANTHROPIC_BASE_URL, '••••••e/v1', 'literal masked to a suffix');
  assert.equal(body.model.env.ANTHROPIC_AUTH_TOKEN, '••••••1234');
  assert.equal(body.model.env.X_REF, '${MY_VAR}', 'a whole-value ref is config, not a secret');
  // The store holds the RAW values (same process — read the core directly).
  const raw = listGlobalModels().find((m) => m.id === 'glm-4.7');
  assert.equal(raw.env.ANTHROPIC_AUTH_TOKEN, 'sk-live-abcdef1234');
});

test('the global entry reaches /api/config for projects AND project-less', async () => {
  for (const path of ['/api/config', `/api/config?${q({ projectDir: proj })}`]) {
    const { body } = await jfetch(path);
    const glm = body.models.find((m) => m.id === 'glm-4.7');
    assert.ok(glm, `present in ${path}`);
    assert.equal(glm.custom, 'global');
    assert.equal(glm.hasEnv, true);
    assert.equal(glm.env, undefined, 'env values never enter the catalog shape');
  }
});

test('POST /api/models rejections -> 400 (reserved env key, dup id, unknown effort)', async () => {
  assert.equal((await post('/api/models', { id: 'x1', env: { PATH: '/evil' } })).status, 400);
  assert.equal((await post('/api/models', { id: 'GLM-4.7' })).status, 400);
  assert.equal((await post('/api/models', { id: 'x1', efforts: ['low'] })).status, 400);
  assert.equal((await post('/api/models', {})).status, 400);
});

test('PATCH /api/models/:id: write-only env — masked echoes mean KEEP, null deletes, strings set', async () => {
  const { status, body } = await patch('/api/models/glm-4.7', {
    label: 'GLM routed',
    env: {
      ANTHROPIC_AUTH_TOKEN: '••••••1234',      // masked echo -> keep the stored value
      ANTHROPIC_BASE_URL: 'https://new.example', // real string -> set
      X_REF: null,                                // delete
    },
  });
  assert.equal(status, 200);
  assert.equal(body.model.label, 'GLM routed');
  const raw = listGlobalModels().find((m) => m.id === 'glm-4.7');
  assert.equal(raw.env.ANTHROPIC_AUTH_TOKEN, 'sk-live-abcdef1234', 'echo kept the secret');
  assert.equal(raw.env.ANTHROPIC_BASE_URL, 'https://new.example');
  assert.equal(raw.env.X_REF, undefined, 'null deleted the key');
});

test('PATCH /api/models/:id: unknown id and reserved key -> 400', async () => {
  assert.equal((await patch('/api/models/nope', { label: 'x' })).status, 400);
  assert.equal((await patch('/api/models/glm-4.7', { env: { WORCA_MOCK: '1' } })).status, 400);
});

test('PATCH /api/config with an unknown node model -> 400 (validation parity over HTTP)', async () => {
  const { status } = await patch('/api/config', {
    projectDir: proj, workflowId: 'wf_x', nodes: { s0_0: { model: 'no-such-model' } },
  });
  assert.equal(status, 400);
});

test('refs preview + DELETE /api/models/:id clears cross-project refs', async () => {
  await setNodeModel(proj, 'wf_x', 's2_0', { model: 'glm-4.7', effort: 'high' });

  const refs = await jfetch(`/api/models/${encodeURIComponent('glm-4.7')}/refs`);
  assert.equal(refs.status, 200);
  assert.equal(refs.body.predefinedShadow, false);
  assert.equal(refs.body.nodes.length, 1);
  assert.equal(refs.body.nodes[0].nodeId, 's2_0');

  const del = await jfetch(`/api/models/${encodeURIComponent('glm-4.7')}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.body.clearedNodes, 1);
  assert.deepEqual(del.body.models, []);

  assert.equal((await jfetch(`/api/models/${encodeURIComponent('glm-4.7')}`, { method: 'DELETE' })).status, 400, 'second delete: unknown id');
});
