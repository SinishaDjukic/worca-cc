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

test('GET /api/models/:id/env-value reveals raw values (per key and whole map); GET surface stays masked', async () => {
  const one = await jfetch(`/api/models/glm-4.7/env-value?${q({ key: 'ANTHROPIC_AUTH_TOKEN' })}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body, { key: 'ANTHROPIC_AUTH_TOKEN', value: 'sk-live-abcdef1234' });

  const all = await jfetch('/api/models/glm-4.7/env-value');
  assert.equal(all.status, 200);
  assert.equal(all.body.env.ANTHROPIC_AUTH_TOKEN, 'sk-live-abcdef1234');
  assert.equal(all.body.env.ANTHROPIC_BASE_URL, 'https://new.example', 'reflects the earlier PATCH');

  assert.equal((await jfetch(`/api/models/nope/env-value`)).status, 400);
  assert.equal((await jfetch(`/api/models/glm-4.7/env-value?${q({ key: 'NOT_THERE' })}`)).status, 400);

  // The reveal endpoint does not weaken the default surface.
  const masked = (await jfetch('/api/models')).body.models.find((m) => m.id === 'glm-4.7');
  assert.match(masked.env.ANTHROPIC_AUTH_TOKEN, /^••/);
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

test('POST /api/models/promote moves a legacy entry global; its refs SURVIVE (unlike delete)', async () => {
  const { addCustomModel } = await import('../src/core/config.mjs');
  await addCustomModel(proj, { id: 'legacy-m', label: 'Legacy M' });
  await setNodeModel(proj, 'wf_p', 's1_0', { model: 'legacy-m' });

  const r = await post('/api/models/promote', { projectDir: proj, id: 'legacy-m' });
  assert.equal(r.status, 200);
  assert.ok(r.body.models.some((m) => m.id === 'legacy-m'), 'now in the global catalog');
  assert.deepEqual(r.body.config.customModels, [], 'project copy dropped');

  const cfg = await jfetch(`/api/config?${q({ projectDir: proj })}`);
  assert.equal(cfg.body.models.find((m) => m.id === 'legacy-m').custom, 'global');
  assert.deepEqual(cfg.body.config.workflows.wf_p.nodes.s1_0, { model: 'legacy-m' }, 'node ref survived promotion');

  assert.equal((await post('/api/models/promote', { projectDir: proj, id: 'nope' })).status, 400);
});

// ── plugin model entries + export scaffold (design §9.5, §9.7) ───────────────

test('GET /api/models: plugin entries — masked literals, readable refs, secret markers + set-ness', async () => {
  const { writePluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cur = pluginCurrentDir('ds-models');
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'ds-models',
    modelSecrets: [{ key: 'ds-token', label: 'DS token' }],
    models: [{
      id: 'ds-plugged', label: 'DS Plugged', efforts: ['medium', 'high'],
      env: {
        ANTHROPIC_BASE_URL: 'https://api.ds.example',
        X_REF: '${MY_VAR}',
        ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' },
      },
    }],
  }));
  writePluginsLock({ 'ds-models': { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true } });

  const { body } = await jfetch('/api/models');
  const pm = body.plugin.find((m) => m.id === 'ds-plugged');
  assert.ok(pm, 'plugin entry surfaced');
  assert.equal(pm.plugin, 'ds-models');
  assert.deepEqual(pm.efforts, ['medium', 'high']);
  assert.equal(pm.env.ANTHROPIC_BASE_URL, '••••••mple', 'literal masked');
  assert.equal(pm.env.X_REF, '${MY_VAR}', 'ref readable');
  assert.equal(pm.env.ANTHROPIC_AUTH_TOKEN, '(secret: ds-token)');
  assert.deepEqual(pm.secrets, [{ key: 'ds-token', label: 'DS token', set: false }]);

  // The plugin model is selectable: it reaches the /api/config catalog.
  const cfg = await jfetch(`/api/config?${q({ projectDir: proj })}`);
  const inCatalog = cfg.body.models.find((m) => m.id === 'ds-plugged');
  assert.equal(inCatalog.custom, 'plugin');
  assert.equal(inCatalog.plugin, 'ds-models');
});

test('PUT /api/plugins/:name/config { target: modelSecrets } round-trips set-ness, never values', async () => {
  const put = (path, body) => jfetch(path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const r = await put('/api/plugins/ds-models/config', { target: 'modelSecrets', values: { 'ds-token': 'sk-team-secret' } });
  assert.equal(r.status, 200);

  const cfg = await jfetch('/api/plugins/ds-models/config');
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.body.models.schema.map((f) => f.key), ['ds-token']);
  assert.deepEqual(cfg.body.models.values, { 'ds-token': { set: true } }, 'redacted marker only');

  const models = await jfetch('/api/models');
  assert.deepEqual(models.body.plugin.find((m) => m.id === 'ds-plugged').secrets,
    [{ key: 'ds-token', label: 'DS token', set: true }]);

  // No modelSecrets declared -> 400 on the target write.
  const { writePluginsLock, readPluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cur = pluginCurrentDir('bare-plug');
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({ name: 'bare-plug' }));
  writePluginsLock({ ...readPluginsLock(), 'bare-plug': { repo: 'r', subdir: '', pinnedSha: 'y'.repeat(40), version: '1', enabled: true } });
  const bad = await put('/api/plugins/bare-plug/config', { target: 'modelSecrets', values: { x: 'y' } });
  assert.equal(bad.status, 400);
});

test('POST /api/models/export-plugin: scaffold with value stripping; rejections', async () => {
  const { readFileSync, existsSync, writeFileSync, mkdirSync } = await import('node:fs');
  await post('/api/models', {
    id: 'exp-m', label: 'Exportable', efforts: ['medium'],
    env: { ANTHROPIC_BASE_URL: 'https://x.example', ANTHROPIC_AUTH_TOKEN: 'sk-live-strip-me', X_REF: '${VV}' },
  });
  const dest = join(proj, 'export', 'team-models');
  const r = await post('/api/models/export-plugin', {
    name: 'team-models', description: 'Team routing', dest,
    models: [{ id: 'EXP-M', env: { ANTHROPIC_BASE_URL: 'include', ANTHROPIC_AUTH_TOKEN: 'secret', X_REF: 'include' } }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.dir, dest);
  assert.deepEqual(r.body.modelSecrets, [{ key: 'anthropic-auth-token', label: 'ANTHROPIC_AUTH_TOKEN' }]);

  const manifest = JSON.parse(readFileSync(join(dest, 'worca-cc-plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'team-models');
  assert.equal(manifest.version, '0.1.0');
  const [m] = manifest.models;
  assert.equal(m.id, 'exp-m', 'stored id casing, not the request casing');
  assert.equal(m.label, 'Exportable');
  assert.deepEqual(m.efforts, ['medium']);
  assert.equal(m.env.ANTHROPIC_BASE_URL, 'https://x.example', 'include -> verbatim');
  assert.equal(m.env.X_REF, '${VV}', 'ref text travels as-is');
  assert.deepEqual(m.env.ANTHROPIC_AUTH_TOKEN, { secret: 'anthropic-auth-token' });
  assert.deepEqual(manifest.modelSecrets, [{ key: 'anthropic-auth-token', label: 'ANTHROPIC_AUTH_TOKEN' }]);
  const blob = readFileSync(join(dest, 'worca-cc-plugin.json'), 'utf8') + readFileSync(join(dest, 'README.md'), 'utf8');
  assert.doesNotMatch(blob, /sk-live-strip-me/, 'secret value stripped from every scaffold file');
  assert.ok(existsSync(join(dest, 'README.md')));

  // Rejections.
  const cases = [
    [{ name: 'Bad Name', dest: join(proj, 'x1'), models: [{ id: 'exp-m' }] }, /kebab-case/],
    [{ name: 'ok-name', dest: join(proj, 'x2'), models: [] }, /non-empty array/],
    [{ name: 'ok-name', dest: join(proj, 'x3'), models: [{ id: 'nope' }] }, /unknown global model id/],
    [{ name: 'ok-name', dest: join(proj, 'x4'), models: [{ id: 'exp-m', env: { NOT_THERE: 'include' } }] }, /has no env key/],
    [{ name: 'ok-name', dest: join(proj, 'x5'), models: [{ id: 'exp-m', env: { X_REF: 'wat' } }] }, /include \| secret \| omit/],
    [{ name: 'ok-name', dest: '', models: [{ id: 'exp-m' }] }, /dest is required/],
    [{ name: 'ok-name', dest, models: [{ id: 'exp-m' }] }, /not empty/],
  ];
  for (const [bodyIn, re] of cases) {
    const bad = await post('/api/models/export-plugin', bodyIn);
    assert.equal(bad.status, 400, JSON.stringify(bodyIn));
    assert.match(bad.body.error, re);
  }
});

test('GET /api/plugins/:name/model-env: raw literals/refs for Edit-a-copy; secrets listed, never resolved', async () => {
  const r = await jfetch(`/api/plugins/ds-models/model-env?${q({ id: 'DS-Plugged' })}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 'ds-plugged');
  assert.equal(r.body.env.ANTHROPIC_BASE_URL, 'https://api.ds.example', 'literal RAW, not masked');
  assert.equal(r.body.env.X_REF, '${MY_VAR}');
  assert.equal(r.body.env.ANTHROPIC_AUTH_TOKEN, undefined, 'secret value never present');
  assert.deepEqual(r.body.secretKeys, ['ANTHROPIC_AUTH_TOKEN']);
  assert.doesNotMatch(JSON.stringify(r.body), /sk-team-secret/, 'the stored plugin secret does not leak');

  assert.equal((await jfetch(`/api/plugins/ds-models/model-env?${q({ id: 'nope' })}`)).status, 400);
  assert.equal((await jfetch(`/api/plugins/ghost/model-env?${q({ id: 'x' })}`)).status, 404);
});

// ── model connectivity test (Models-view Test button) ────────────────────────

test('POST /api/models/:id/test: 404 unknown id; 400 for a plugin model with an unset secret', async () => {
  const r404 = await post('/api/models/no-such-model/test', {});
  assert.equal(r404.status, 404);
  assert.match(r404.body.error, /unknown model id/);

  // A fresh plugin whose model references a secret nobody has set yet — the
  // route must refuse before spawning anything.
  const { writePluginsLock, readPluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cur = pluginCurrentDir('unset-plug');
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'unset-plug',
    modelSecrets: [{ key: 'up-token', label: 'UP token' }],
    models: [{ id: 'up-model', label: 'UP', env: { ANTHROPIC_AUTH_TOKEN: { secret: 'up-token' } } }],
  }));
  writePluginsLock({
    ...readPluginsLock(),
    'unset-plug': { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true },
  });

  const r400 = await post('/api/models/up-model/test', {});
  assert.equal(r400.status, 400);
  assert.match(r400.body.error, /up-token.*not set/);
});

// ── the pricing override over HTTP (what the editor form actually sends) ──────

test('POST/PATCH /api/models carry `cost` end-to-end, and GET surfaces it unmasked', async () => {
  const add = await post('/api/models', {
    id: 'priced-api', label: 'Priced', efforts: [],
    env: { ANTHROPIC_BASE_URL: 'https://p' },
    cost: { perMtok: { input: 0.5, output: 1.5 } },
  });
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.model.cost, { perMtok: { input: 0.5, output: 1.5 } });
  // Pricing is configuration, never a credential — it must NOT come back masked.
  const got = (await jfetch('/api/models')).body.models.find((m) => m.id === 'priced-api');
  assert.deepEqual(got.cost, { perMtok: { input: 0.5, output: 1.5 } });
  assert.match(got.env.ANTHROPIC_BASE_URL, /^••/, 'env still masked alongside it');

  // The editor replaces the table wholesale (it is small) rather than merging.
  const toFree = await patch('/api/models/priced-api', { cost: { free: true } });
  assert.deepEqual(toFree.body.model.cost, { free: true });

  // 'Trust the CLI' sends null — an explicit clear, since the form shows the state.
  const cleared = await patch('/api/models/priced-api', { cost: null });
  assert.equal(cleared.body.model.cost, undefined);
  assert.equal(listGlobalModels().find((m) => m.id === 'priced-api').cost, undefined);

  // An unrelated edit omits `cost` entirely -> the stored override is kept.
  await patch('/api/models/priced-api', { cost: { perMtok: { input: 2 } } });
  const relabel = await patch('/api/models/priced-api', { label: 'Renamed' });
  assert.equal(relabel.body.model.label, 'Renamed');
  assert.deepEqual(relabel.body.model.cost, { perMtok: { input: 2 } }, 'omitted means keep');
});

test('POST/PATCH /api/models reject a malformed `cost` with the message the form shows', async () => {
  const bad = await post('/api/models', { id: 'bad-cost', cost: { perMtok: {} } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /must define at least one rate/);
  assert.equal(listGlobalModels().some((m) => m.id === 'bad-cost'), false, 'a rejected add leaves nothing behind');

  const neg = await post('/api/models', { id: 'bad-cost', cost: { perMtok: { input: -1 } } });
  assert.equal(neg.status, 400);
  assert.match(neg.body.error, /finite number >= 0/);

  const unknown = await patch('/api/models/priced-api', { cost: { perMtok: { bogus: 1 } } });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown cost\.perMtok rate "bogus"/);
});
