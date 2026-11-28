// test/api-models.test.mjs
// Global model catalog HTTP API (configurable-models-design.md §4.10):
// GET/POST/PATCH/DELETE /api/models with masked env values (write-only
// editing, ${VAR} refs readable, masked echoes mean "keep"), the refs preview,
// and the catalog surfacing in /api/config. Sandboxes WORCA_HOME (DB) and
// HOME (settings.json) and opts into the catalog guard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { _resetForTests } from '../src/core/db.mjs';
import { listGlobalModels, settingsFile } from '../src/core/settings.mjs';
import { setNodeModel, writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { projectKey } from '../src/core/store.mjs';
import { EFFORTS } from '../src/core/model-env.mjs';
import { ROLE_LABELS } from '../src/shared/model-roles.mjs';
import { isSecretHeaderName } from '../src/shared/secret-names.mjs';
import { WebSocket } from 'ws';
import { checkRows } from './helpers/rows.mjs';

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
  srv = appServer(app);
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

test('GET /api/models starts empty (predefined + efforts); POST adds a global entry whose env values come back MASKED, ${VAR} refs readable', async () => {
  await checkRows([
    { name: 'GET /api/models: empty catalog + predefined + efforts', run: async () => {
      const { status, body } = await jfetch('/api/models');
      assert.equal(status, 200);
      assert.deepEqual(body.models, []);
      assert.ok(body.predefined.some((m) => m.id === 'claude-opus-5-5'));
      assert.deepEqual(body.efforts, EFFORTS);
    } },
    { name: 'POST /api/models adds a global entry; env values come back MASKED, ${VAR} refs readable', run: async () => {
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
    } },
  ]);
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

test('POST/PATCH /api/models rejections -> 400 (reserved env key, dup id, unknown effort, unknown id)', async () => {
  await checkRows([
    { name: 'POST /api/models rejections -> 400 (reserved env key, dup id, unknown effort)', run: async () => {
      assert.equal((await post('/api/models', { id: 'x1', env: { PATH: '/evil' } })).status, 400);
      assert.equal((await post('/api/models', { id: 'GLM-4.7' })).status, 400);
      assert.equal((await post('/api/models', { id: 'x1', efforts: ['low'] })).status, 400);
      assert.equal((await post('/api/models', {})).status, 400);
    } },
    { name: 'PATCH /api/models/:id: unknown id and reserved key -> 400', run: async () => {
      assert.equal((await patch('/api/models/nope', { label: 'x' })).status, 400);
      assert.equal((await patch('/api/models/glm-4.7', { env: { WORCA_MOCK: '1' } })).status, 400);
    } },
  ]);
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

// Settings › Memory: the defragment model is a ref too. Removing the entry it names clears the
// setting, and — like Ask's apply path — tells open tabs, so their Memory card stops naming it.
test('DELETE /api/models/:id clears Settings › Memory\'s defragment model and broadcasts settings-changed', async () => {
  assert.equal((await post('/api/models', { id: 'dm-glm', label: 'GLM', efforts: ['medium', 'high'] })).status, 200);
  assert.equal((await post('/api/settings', { memoryDefrag: { model: 'dm-glm', effort: 'high' } })).status, 200);
  // The WebSocket endpoint lives on the module's own server (this file's `srv` is a bare app listener).
  const { server } = await import('../ui/server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d)).type); } catch { /* not JSON */ } });
  try {
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    assert.equal((await jfetch('/api/models/dm-glm/refs')).body.memoryDefrag, true, 'the refs preview lists it');
    const del = await jfetch('/api/models/dm-glm', { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(del.body.clearedMemoryDefrag, true);
    const t0 = Date.now();
    while (!frames.includes('settings-changed') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(frames.includes('settings-changed'), `an open Memory tab must repaint — frames: ${frames.join(', ')}`);
    assert.deepEqual((await jfetch('/api/settings')).body.memoryDefrag, { model: null, effort: null });
  } finally {
    ws.close();
    await new Promise((r) => server.close(r));
  }
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

test('POST /api/models/export-plugin: scaffold with value stripping and `cost`; rejections', async () => {
  await checkRows([
    { name: 'POST /api/models/export-plugin: scaffold with value stripping; rejections', run: async () => {
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
      assert.match(readFileSync(join(dest, 'README.md'), 'utf8'), /^worca → Marketplace → Add marketplace → paste the repo URL → Add → Install\.$/m, 'the README walks the Add marketplace dialog');
      assert.match(readFileSync(join(dest, 'README.md'), 'utf8'), /^Model secrets are asked for in the install's Set up step\.$/m, 'model secrets: the install sheet\'s Set up step (P4)');

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
    } },
    { name: 'export-plugin carries `cost` into the generated manifest (pricing is config, not a credential)', run: async () => {
      const { readFileSync } = await import('node:fs');
      const { normalizeManifest } = await import('../src/core/plugin-manifest.mjs');
      await post('/api/models', {
        id: 'exp-priced', label: 'Priced export',
        env: { ANTHROPIC_BASE_URL: 'https://p.example', ANTHROPIC_AUTH_TOKEN: 'sk-live-never-export' },
        cost: { perMtok: { input: 0.5, output: 1.5, cacheWrite1h: 1.2 } },
      });
      await post('/api/models', { id: 'exp-free', cost: { free: true } });
      await post('/api/models', { id: 'exp-unpriced' });

      const dest = join(proj, 'export', 'priced-models');
      const r = await post('/api/models/export-plugin', {
        name: 'priced-models', dest,
        models: [
          { id: 'exp-priced', env: { ANTHROPIC_BASE_URL: 'include', ANTHROPIC_AUTH_TOKEN: 'secret' } },
          { id: 'exp-free' },
          { id: 'exp-unpriced' },
        ],
      });
      assert.equal(r.status, 200);

      const manifest = JSON.parse(readFileSync(join(dest, 'worca-cc-plugin.json'), 'utf8'));
      const byId = Object.fromEntries(manifest.models.map((m) => [m.id, m]));
      assert.deepEqual(byId['exp-priced'].cost, { perMtok: { input: 0.5, output: 1.5, cacheWrite1h: 1.2 } },
        'a shared on-prem model would otherwise be re-priced by NAME on every machine that installs this');
      assert.deepEqual(byId['exp-free'].cost, { free: true });
      assert.equal(byId['exp-unpriced'].cost, undefined, 'no override -> no key');

      // The scaffold must install anywhere this host would, and the secret still never travels.
      assert.equal(normalizeManifest(manifest).ok, true);
      assert.doesNotMatch(readFileSync(join(dest, 'worca-cc-plugin.json'), 'utf8'), /sk-live-never-export/);
    } },
  ]);
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

// ── copies keep their connection; Share keeps harness and connection (P5) ────

test('POST /api/models { copyFrom }: a copy carries its source\'s masked env values', async () => {
  const env = { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'tok-secret-9999' };
  assert.equal((await post('/api/models', { id: 'src', label: 'Source', env })).status, 200);
  const row = (await jfetch('/api/models')).body.models.find((m) => m.id === 'src');
  for (const key of Object.keys(env)) assert.match(row.env[key], /^••/, `${key} is masked in the row`);

  // The page sends the row's masks back; the server fills them from the source.
  const r = await post('/api/models', { id: 'src-copy', label: 'Source copy', env: row.env, copyFrom: 'src' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.doesNotMatch(JSON.stringify(r.body), /tok-secret-9999/, 'the answer still masks');
  for (const [key, value] of Object.entries(env)) {
    const got = await jfetch(`/api/models/src-copy/env-value?${q({ key })}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.value, value, `${key}: the source's stored value, not the mask`);
  }

  // Only the masks are filled: a value the copy typed is its own, even beside a filled mask.
  const own = await post('/api/models', {
    id: 'src-copy2', env: { ...row.env, ANTHROPIC_BASE_URL: 'https://other.example' }, copyFrom: 'src',
  });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.deepEqual(listGlobalModels().find((m) => m.id === 'src-copy2').env, {
    ANTHROPIC_BASE_URL: 'https://other.example', ANTHROPIC_AUTH_TOKEN: 'tok-secret-9999',
  });
});

test('POST /api/models { copyFrom }: a copy keeps a provider connection and its own key', async () => {
  const upstream = {
    provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'https://gw.example/v1', apiKey: 'sk-own-1234',
    headers: { 'X-Team': 'a' },
  };
  assert.equal((await post('/api/models', { id: 'gw', upstream })).status, 200);
  const row = (await jfetch('/api/models')).body.models.find((m) => m.id === 'gw');
  assert.match(row.upstream.apiKey, /^••/, 'the row masks the provider key');

  const r = await post('/api/models', { id: 'gw-copy', upstream: row.upstream, copyFrom: 'gw' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const stored = (id) => listGlobalModels().find((m) => m.id === id).upstream;
  assert.deepEqual(stored('gw-copy'), stored('gw'));

  // The copy's own model and base URL are kept; only the masked key is filled, even at another address.
  const moved = await post('/api/models', {
    id: 'gw-copy2', upstream: { ...row.upstream, model: 'm2', baseUrl: 'https://other.example/v1' }, copyFrom: 'gw',
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(stored('gw-copy2'), { ...stored('gw'), model: 'm2', baseUrl: 'https://other.example/v1' });
  assert.equal(stored('gw-copy2').apiKey, 'sk-own-1234');
});

test('POST /api/models { copyFrom }: refusals', async () => {
  const cases = [
    [{ id: 'x-copy1', copyFrom: 'nope' }, /unknown model to copy from "nope"/],
    [{ id: 'x-copy2', env: { NEW_KEY: '••••••abcd' }, copyFrom: 'src' }, /"NEW_KEY" has no value to copy/],
    [{ id: 'x-copy3', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '••••••abcd' }, copyFrom: 'src' },
      /"apiKey" has no value to copy/],
    [{ id: 'x-copy4', copyFrom: 42 }, /copyFrom must be a model id/],
    // Only a plain-object env is filled: a string is not spread into numbered keys.
    [{ id: 'x-copy5', env: 'str', copyFrom: 'src' }, /env must be an object/],
  ];
  for (const [body, re] of cases) {
    const r = await post('/api/models', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  assert.equal(listGlobalModels().some((m) => m.id.startsWith('x-copy')), false, 'a refused copy stores nothing');
});

test('POST /api/models { copyFrom }: null and "" copy nothing; the source is found in any case', async () => {
  const rows = (await jfetch('/api/models')).body.models;
  const gw = rows.find((m) => m.id === 'gw');
  const src = rows.find((m) => m.id === 'src');
  assert.match(gw.upstream.apiKey, /^••/);
  assert.match(src.env.ANTHROPIC_AUTH_TOKEN, /^••/);
  const stored = (id) => listGlobalModels().find((m) => m.id === id);

  // No copy: a masked key means "keep" with nothing to keep, so it is dropped, never stored as the mask.
  let r = await post('/api/models', { id: 'gw-null', upstream: gw.upstream, copyFrom: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('apiKey' in stored('gw-null').upstream, false);
  assert.equal(stored('gw-null').upstream.baseUrl, 'https://gw.example/v1', 'the rest of the connection is kept');

  // No copy: a masked env value is stored as written.
  r = await post('/api/models', { id: 'src-empty', env: { ANTHROPIC_AUTH_TOKEN: src.env.ANTHROPIC_AUTH_TOKEN }, copyFrom: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored('src-empty').env.ANTHROPIC_AUTH_TOKEN, src.env.ANTHROPIC_AUTH_TOKEN);

  // The source is found as PATCH finds its model: in any case.
  r = await post('/api/models', { id: 'gw-upper', upstream: gw.upstream, copyFrom: 'GW' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored('gw-upper').upstream.apiKey, 'sk-own-1234');
});

test('GET /api/plugins/:name/model-env: a plugin copy learns its harness and connection, never a secret', async () => {
  const { pluginCurrentDir, writePluginsLock, readPluginsLock } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync } = await import('node:fs');
  const cur = pluginCurrentDir('copy-plug');
  mkdirSync(cur, { recursive: true });
  // Split in two: the manifest refuses env on a Codex model, and that drops the whole plugin.
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'copy-plug',
    modelSecrets: [{ key: 'acme' }],
    models: [
      { id: 'p-codex', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-x' } },
      { id: 'p-claude', env: { K: { secret: 'acme' }, L: 'lit' } },
    ],
  }));
  writePluginsLock({
    ...readPluginsLock(),
    'copy-plug': { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true },
  });
  try {
    const codex = await jfetch(`/api/plugins/copy-plug/model-env?${q({ id: 'p-codex' })}`);
    assert.equal(codex.status, 200, JSON.stringify(codex.body));
    assert.equal(codex.body.engine, 'codex');
    assert.equal(codex.body.upstream.model, 'gpt-x');

    const claude = await jfetch(`/api/plugins/copy-plug/model-env?${q({ id: 'p-claude' })}`);
    assert.equal(claude.status, 200, JSON.stringify(claude.body));
    assert.deepEqual(claude.body.secretKeys, ['K']);
    assert.deepEqual(claude.body.env, { L: 'lit' }, 'the secret is asked for, never sent');
    assert.equal('engine' in claude.body, false, 'a Claude plugin model names no harness');
  } finally {
    const { 'copy-plug': _gone, ...rest } = readPluginsLock();
    writePluginsLock(rest);
  }
});

test('isSecretHeaderName: credential-named headers, not names that merely hold "key"', () => {
  for (const h of [
    'X-Api-Key', 'X-Auth-Key', 'X-Access-Key', 'X-Credential', 'Ocp-Apim-Subscription-Key', 'Cookie', 'X-Auth-Token',
    'Proxy-Authorization',
  ]) assert.equal(isSecretHeaderName(h), true, h);
  for (const h of [
    'X-Team', 'X-Ref', 'Accept', 'X-Keyboard-Layout', 'HTTP-Referer', 'X-Title', 'anthropic-version', 'Editor-Version',
    'Copilot-Integration-Id', 'OpenAI-Organization',
  ]) assert.equal(isSecretHeaderName(h), false, h);
});

test('POST /api/models/export-plugin keeps harness and connection and leaves secrets out', async () => {
  const { normalizeManifest } = await import('../src/core/plugin-manifest.mjs');
  for (const body of [
    { id: 'cx', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-x' } },
    { id: 'cp1', engine: 'copilot' },
    { id: 'gw2', upstream: {
      provider: 'openai', api: 'openai-chat', model: 'm', apiKey: 'sk-lit-1234',
      baseUrl: 'https://user:pw-secret-31@gw.example/v1',
      headers: {
        'X-Api-Key': 'hdr-secret-77', 'X-Auth-Key': 'auth-secret-66', 'X-Team': 'a',
        'Ocp-Apim-Subscription-Key': 'sub-secret-55', 'X-Ref': '${TEAM_REF}',
      },
    } },
    // Its only header is a secret, and a token rides as the URL's user.
    { id: 'gw4', upstream: {
      provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'https://tok-secret-21@gw4.example/v1',
      headers: { 'X-Api-Key': 'hdr-secret-78' },
    } },
    { id: 'gw5', upstream: {
      provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'https://:pw-only-13@gw5.example/v1',
      headers: { 'X-Access-Key': 'acc-secret-44', 'X-Keyboard-Layout': 'us', 'X-Credential': 'cred-secret-33', Cookie: 'sid=ck-secret-22' },
    } },
    // A whole-value ${VAR} is config: it travels, as a key and under a secret-looking header name.
    { id: 'gw3', upstream: {
      provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '${GW_KEY}', headers: { 'X-Auth-Token': '${GW_TOKEN}' },
    } },
  ]) {
    const r = await post('/api/models', body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }

  const dest = join(proj, 'export', 'harness-models');
  const r = await post('/api/models/export-plugin', {
    name: 'harness-models', dest, models: [{ id: 'cx' }, { id: 'cp1' }, { id: 'gw2' }, { id: 'gw3' }, { id: 'gw4' }, { id: 'gw5' }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const manifestText = readFileSync(join(dest, 'worca-cc-plugin.json'), 'utf8');
  const readme = readFileSync(join(dest, 'README.md'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const byId = Object.fromEntries(manifest.models.map((m) => [m.id, m]));

  assert.equal(byId.cx.engine, 'codex');
  assert.deepEqual(byId.cx.upstream, { provider: 'openai', api: 'openai-responses', model: 'gpt-x' });
  assert.equal(byId.cp1.engine, 'copilot');
  assert.equal('efforts' in byId.cp1, false, 'its own harness\'s full list is left out');
  assert.equal('engine' in byId.gw2, false, 'Claude Code is the default harness');
  assert.equal('apiKey' in byId.gw2.upstream, false, 'a literal provider key never travels');
  assert.equal(byId.gw2.upstream.baseUrl, 'https://gw.example/v1', 'the URL travels without its user and password');
  assert.deepEqual(byId.gw2.upstream.headers, { 'X-Team': 'a', 'X-Ref': '${TEAM_REF}' });
  assert.equal(byId.gw3.upstream.apiKey, '${GW_KEY}');
  assert.deepEqual(byId.gw3.upstream.headers, { 'X-Auth-Token': '${GW_TOKEN}' });
  assert.equal(byId.gw4.upstream.baseUrl, 'https://gw4.example/v1');
  assert.equal('headers' in byId.gw4.upstream, false, 'no empty headers object when every header was a secret');
  assert.equal(byId.gw5.upstream.baseUrl, 'https://gw5.example/v1');
  assert.deepEqual(byId.gw5.upstream.headers, { 'X-Keyboard-Layout': 'us' });
  // Model order; per model the key, the URL's user and password, then the headers in stored order.
  assert.deepEqual(r.body.omitted, [
    { id: 'gw2', what: 'provider key' }, { id: 'gw2', what: 'base URL credentials' },
    { id: 'gw2', what: 'header X-Api-Key' }, { id: 'gw2', what: 'header X-Auth-Key' },
    { id: 'gw2', what: 'header Ocp-Apim-Subscription-Key' },
    { id: 'gw4', what: 'base URL credentials' }, { id: 'gw4', what: 'header X-Api-Key' },
    { id: 'gw5', what: 'base URL credentials' }, { id: 'gw5', what: 'header X-Access-Key' },
    { id: 'gw5', what: 'header X-Credential' }, { id: 'gw5', what: 'header Cookie' },
  ]);
  assert.match(readme, /^## Not included$/m);
  for (const o of r.body.omitted) assert.ok(readme.includes(`- \`${o.id}\`: ${o.what}\n`), `the README names ${o.id}: ${o.what}`);
  for (const secret of [
    /sk-lit-1234/, /hdr-secret-7[78]/, /auth-secret-66/, /sub-secret-55/, /pw-secret-31/, /tok-secret-21/, /pw-only-13/,
    /acc-secret-44/, /cred-secret-33/, /ck-secret-22/,
  ]) {
    assert.doesNotMatch(manifestText, secret);
    assert.doesNotMatch(readme, secret);
  }
  assert.equal(normalizeManifest(manifest).ok, true);
});

// ── model connectivity test (Models-view Test button) ────────────────────────

test('POST /api/models/:id/test: 404 unknown id, 400 for a plugin model with an unset secret, 200 for a built-in id (mock)', async () => {
  await checkRows([
    { name: 'POST /api/models/:id/test: 404 unknown id; 400 for a plugin model with an unset secret', run: async () => {
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
    } },
    { name: '#422: POST /api/models/:id/test accepts a BUILT-IN id (the Title-generation card offers them)', run: async () => {
      const { PREDEFINED_MODELS } = await import('../src/core/config.mjs');
      const prev = process.env.WORCA_MOCK;
      process.env.WORCA_MOCK = '1';           // never a real spawn under the test PATH guard
      try {
        const r = await post(`/api/models/${PREDEFINED_MODELS[0].id}/test`, {});
        assert.notEqual(r.status, 404, JSON.stringify(r.body));
        assert.equal(r.status, 200);
        assert.equal(typeof r.body.ok, 'boolean');
      } finally {
        if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev;
      }
    } },
  ]);
});

test('every row says whether the test route takes it; team-policy models can be tested', async () => {
  // A cache key no other test reads (assertProjectKey shape); its slug differs from the hide-default seed's.
  const key = 'team-models-0000beef';
  const prev = process.env.WORCA_MOCK;
  process.env.WORCA_MOCK = '1';           // never a real spawn under the test PATH guard
  try {
    assert.equal((await post('/api/models', { id: 'tt-global', label: 'TT global', efforts: ['high'] })).status, 200);
    writeTeamPolicyPrefs(key, { present: true, docKnown: true, slug: 'acme/team-models', headSha: 'abc1234', delegateTo: null, doc: { schema: 1, fields: {}, workspaceRuns: {}, catalogs: { models: [{ id: 'team-glm', label: 'Team GLM', env: { ANTHROPIC_BASE_URL: 'https://glm.example' } }] } } });
    await checkRows([
      { name: 'testable follows the test route', run: async () => {
        const { status, body } = await jfetch('/api/models');
        assert.equal(status, 200);
        assert.ok(body.predefined.length > 0 && body.predefined.every((m) => m.testable === true), 'Claude built-ins are testable');
        assert.ok(body.codex.length > 0 && body.codex.every((m) => m.testable === false), 'Codex built-ins are not');
        assert.ok(body.copilot.length > 0 && body.copilot.every((m) => m.testable === false), 'Copilot built-ins are not');
        assert.ok(body.models.some((m) => m.id === 'tt-global') && body.models.every((m) => m.testable === true), 'globals are testable');
        assert.ok(body.policy.some((m) => m.id === 'team-glm') && body.policy.every((m) => m.testable === true), 'team-policy models are testable');
        assert.ok(body.plugin.every((m) => m.testable === true), 'plugin models are testable');
      } },
      { name: 'a team-policy model can be tested', run: async () => {
        const r = await post('/api/models/team-glm/test', {});
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(typeof r.body.ok, 'boolean');
        assert.equal((await post('/api/models/Team-GLM/test', {})).status, 200, 'ids compare case-insensitively');
      } },
    ]);
  } finally {
    writeTeamPolicyPrefs(key, { present: false });
    await jfetch('/api/models/tt-global', { method: 'DELETE' });
    if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev;
  }
  assert.equal((await jfetch('/api/models')).body.policy.some((m) => m.id === 'team-glm'), false, 'the seed is reset');
});

test('a Codex built-in still answers 404', async () => {
  const prev = process.env.WORCA_MOCK;
  process.env.WORCA_MOCK = '1';
  try {
    const r = await post('/api/models/gpt-6.1-sol/test', {});
    assert.equal(r.status, 404);
    assert.match(r.body.error, /unknown model id/);
  } finally {
    if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev;
  }
});

test('plugin rows carry their harness', async () => {
  const { writePluginsLock, readPluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync } = await import('node:fs');
  const cur = pluginCurrentDir('codex-plug');
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'codex-plug',
    models: [
      { id: 'cp-codex', label: 'CP Codex', engine: 'codex', efforts: ['low', 'high'] },
      { id: 'cp-claude', label: 'CP Claude', env: { ANTHROPIC_BASE_URL: 'https://cp.example' } },
    ],
  }));
  writePluginsLock({
    ...readPluginsLock(),
    'codex-plug': { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true },
  });
  try {
    const { body } = await jfetch('/api/models');
    const codexRow = body.plugin.find((m) => m.id === 'cp-codex');
    assert.ok(codexRow, 'the Codex plugin model is listed');
    assert.equal(codexRow.engine, 'codex');
    assert.equal(codexRow.testable, true);
    const claudeRow = body.plugin.find((m) => m.id === 'cp-claude');
    assert.ok(claudeRow, 'the Claude plugin model is listed');
    assert.equal('engine' in claudeRow, false, 'a Claude plugin model carries no engine (the manifest stores none)');
  } finally {
    const { 'codex-plug': _gone, ...rest } = readPluginsLock();
    writePluginsLock(rest);
  }
});

test('no exported list is mutated', async () => {
  const { PREDEFINED_MODELS, CODEX_BUILTIN_MODELS, COPILOT_BUILTIN_MODELS } = await import('../src/core/config.mjs');
  const { body } = await jfetch('/api/models');
  assert.equal(body.predefined[0].testable, true);
  assert.equal(PREDEFINED_MODELS[0].testable, undefined);
  assert.ok(PREDEFINED_MODELS.every((m) => !('testable' in m)), 'no Claude built-in gains testable');
  assert.ok([...CODEX_BUILTIN_MODELS, ...COPILOT_BUILTIN_MODELS].every((m) => !('testable' in m)));
});

test('an OpenCode Zen entry advertises no efforts — a Zen model takes no reasoning variant, so pickers and the spawn must not offer one', async () => {
  await checkRows([
    { name: 'POST an engine:opencode Zen model (`opencode/*`): its efforts come back empty', run: async () => {
      const r = await post('/api/models', { id: 'opencode/big-pickle', label: 'Big Pickle (Zen)', engine: 'opencode', efforts: ['low', 'high'] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.model.efforts, [], 'a Zen free model advertises no efforts (it takes no variant)');
      assert.deepEqual(listGlobalModels().find((m) => m.id === 'opencode/big-pickle').efforts, []);
    } },
    { name: 'POST an engine:opencode model of another provider keeps its chosen efforts', run: async () => {
      const r = await post('/api/models', { id: 'openrouter/z-ai/glm-5.3-prime', label: 'GLM', engine: 'opencode', efforts: ['low', 'high'] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.model.efforts, ['low', 'high']);
      assert.deepEqual(listGlobalModels().find((m) => m.id === 'openrouter/z-ai/glm-5.3-prime').efforts, ['low', 'high']);
    } },
  ]);
});

// ── the pricing override over HTTP (what the editor form actually sends) ──────

test('POST/PATCH /api/models carry `cost` end-to-end (GET unmasked) and reject a malformed `cost` with the form message', async () => {
  await checkRows([
    { name: 'POST/PATCH /api/models carry `cost` end-to-end, and GET surfaces it unmasked', run: async () => {
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
    } },
    { name: 'POST/PATCH /api/models reject a malformed `cost` with the message the form shows', run: async () => {
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
    } },
  ]);
});

test('a plugin model\'s manifest price reaches GET /api/models and Edit-a-copy', async () => {
  const { writePluginsLock, readPluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cur = pluginCurrentDir('priced-plug');
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'priced-plug',
    models: [
      { id: 'pp-rated', label: 'PP Rated', env: { ANTHROPIC_BASE_URL: 'https://pp.example' },
        cost: { perMtok: { input: 1, output: 3 } } },
      { id: 'pp-plain', label: 'PP Plain' },
    ],
  }));
  writePluginsLock({
    ...readPluginsLock(),
    'priced-plug': { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true },
  });

  const { body } = await jfetch('/api/models');
  const priced = body.plugin.find((m) => m.id === 'pp-rated');
  assert.deepEqual(priced.cost, { perMtok: { input: 1, output: 3 } }, 'pricing is config — surfaced, never masked');
  assert.equal(body.plugin.find((m) => m.id === 'pp-plain').cost, undefined);

  // Edit-a-copy seeds the global copy from the plugin's pricing: a copy that
  // dropped it would revert to the CLI's by-name figure, since a global entry
  // shadows the plugin price whether or not it pins one.
  const copy = await jfetch(`/api/plugins/priced-plug/model-env?${q({ id: 'PP-Rated' })}`);
  assert.equal(copy.status, 200);
  assert.deepEqual(copy.body.cost, { perMtok: { input: 1, output: 3 } });
  assert.equal((await jfetch(`/api/plugins/priced-plug/model-env?${q({ id: 'pp-plain' })}`)).body.cost, undefined);
});

// ── #422: hidden built-ins over HTTP, the title-model setting, a testable built-in ──

test('#422: hideBuiltinModels flags built-ins in /api/config, is echoed by /api/models, and the ask default skips them', async () => {
  const on = await post('/api/settings', { hideBuiltinModels: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.hideBuiltinModels, true);
  try {
    const cfg = await jfetch('/api/config');
    const builtins = cfg.body.models.filter((m) => m.custom === false && m.engine === 'claude');
    assert.ok(builtins.length > 0 && builtins.every((m) => m.hidden === true), 'unshadowed built-ins carry hidden:true');
    assert.ok(cfg.body.models.filter((m) => m.engine === 'codex').every((m) => m.hidden === undefined), 'Codex built-ins are never hidden');
    assert.ok(cfg.body.models.filter((m) => m.custom).every((m) => m.hidden === undefined), 'owned entries never hidden');
    const models = await jfetch('/api/models');
    assert.equal(models.body.hideBuiltinModels, true);
    assert.ok(models.body.predefined.length > 0, 'predefined still shipped — the view collapses it, the id still resolves');
    const ask = await jfetch('/api/ask/models');
    assert.ok(ask.body.default && !ask.body.models.find((m) => m.id === ask.body.default.model).hidden, 'default is a visible model');
  } finally {
    const off = await post('/api/settings', { hideBuiltinModels: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.hideBuiltinModels, false);
  }
  const cfg = await jfetch('/api/config');
  assert.ok(cfg.body.models.every((m) => m.hidden === undefined), 'flag gone once unset');
  const bad = await post('/api/settings', { hideBuiltinModels: 'yes' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /true or false/);
});

// ── P4 (CAT-8, L7): Codex and Copilot hide their built-ins with hideBuiltinEngines ──

const HIDE_ENGINES_OFF = { hideBuiltinEngines: { codex: false, copilot: false } };

test('hideBuiltinEngines round-trips and is validated', async () => {
  // Other open tabs repaint on settings-changed (the WebSocket lives on the module's own server, as above).
  const { server } = await import('../ui/server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d)).type); } catch { /* not JSON */ } });
  try {
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const codex = await post('/api/settings', { hideBuiltinEngines: { codex: true } });
    assert.equal(codex.status, 200, JSON.stringify(codex.body));
    assert.deepEqual(codex.body.hideBuiltinEngines, { codex: true });
    const t0 = Date.now();
    while (!frames.includes('settings-changed') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(frames.includes('settings-changed'), `frames: ${frames.join(', ')}`);
    const swap = await post('/api/settings', { hideBuiltinEngines: { copilot: true, codex: false } });
    assert.equal(swap.status, 200, JSON.stringify(swap.body));
    assert.deepEqual(swap.body.hideBuiltinEngines, { copilot: true }, 'true stores, false deletes, other keys merge');
    const claude = await post('/api/settings', { hideBuiltinEngines: { claude: true } });
    assert.equal(claude.status, 400);
    assert.equal(claude.body.field, 'hideBuiltinEngines');
    const yes = await post('/api/settings', { hideBuiltinEngines: { codex: 'yes' } });
    assert.equal(yes.status, 400);
    assert.equal(yes.body.field, 'hideBuiltinEngines');
    assert.match(yes.body.error, /^“Hide built-in models” must set codex to true or false/);
    const list = await post('/api/settings', { hideBuiltinEngines: ['codex'] });
    assert.equal(list.status, 400);
    assert.equal(list.body.field, 'hideBuiltinEngines');
    assert.match(list.body.error, /can’t read/);
    const got = await jfetch('/api/settings');
    assert.deepEqual(got.body.hideBuiltinEngines, { copilot: true }, 'a refused POST changes nothing; GET carries the key');
    // A hand-edited value that is not { <engine>: true } reads as {} and the next save replaces it.
    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, hideBuiltinEngines: { copilot: true, codex: 'yes' } }, null, 2) + '\n');
    assert.deepEqual((await jfetch('/api/settings')).body.hideBuiltinEngines, {}, 'an invalid stored value hides nothing');
    assert.deepEqual((await jfetch('/api/models')).body.hiddenBuiltins, { claude: false, codex: false, copilot: false });
    const fixed = await post('/api/settings', { hideBuiltinEngines: { codex: true } });
    assert.deepEqual(fixed.body.hideBuiltinEngines, { codex: true }, 'the save starts from {}, not the invalid value');
  } finally {
    ws.close();
    await new Promise((r) => server.close(r));
    const off = await post('/api/settings', HIDE_ENGINES_OFF);
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.hideBuiltinEngines, {});
  }
  assert.equal('hideBuiltinEngines' in JSON.parse(readFileSync(settingsFile(), 'utf8')), false, 'an empty object is removed');
});

test('GET /api/models says what each harness hides', async () => {
  assert.deepEqual((await jfetch('/api/models')).body.hiddenBuiltins, { claude: false, codex: false, copilot: false });
  try {
    assert.equal((await post('/api/settings', { hideBuiltinEngines: { copilot: true } })).status, 200);
    assert.deepEqual((await jfetch('/api/models')).body.hiddenBuiltins, { claude: false, codex: false, copilot: true });
  } finally {
    await post('/api/settings', HIDE_ENGINES_OFF);
  }
});

test('pickers skip hidden Copilot built-ins', async () => {
  try {
    assert.equal((await post('/api/settings', { hideBuiltinEngines: { copilot: true } })).status, 200);
    const cfg = await jfetch('/api/config');
    const copilot = cfg.body.models.filter((m) => m.id.startsWith('copilot/'));
    assert.ok(copilot.length > 0 && copilot.every((m) => m.hidden === true), 'unshadowed Copilot built-ins carry hidden:true');
    assert.ok(cfg.body.models.filter((m) => m.engine === 'codex').every((m) => m.hidden === undefined), 'Codex keeps its own flag');
    assert.ok(cfg.body.models.filter((m) => m.engine === 'claude').every((m) => m.hidden === undefined), 'Claude keeps hideBuiltinModels');
    assert.equal((await post('/api/settings', { hideBuiltinEngines: { codex: true } })).status, 200);
    const both = (await jfetch('/api/config')).body.models;
    const codexBuiltins = both.filter((m) => m.engine === 'codex' && m.builtin === true);
    assert.ok(codexBuiltins.length > 0 && codexBuiltins.every((m) => m.hidden === true), 'unshadowed Codex built-ins carry hidden:true');
    assert.ok(both.filter((m) => m.custom).every((m) => m.hidden === undefined), 'owned entries never hidden');
  } finally {
    await post('/api/settings', HIDE_ENGINES_OFF);
  }
  assert.ok((await jfetch('/api/config')).body.models.every((m) => m.hidden === undefined), 'none hidden once reset');
});

test('a team default hides Claude built-ins until the user chooses', async () => {
  // The #422 test above stored the user's choice (hideBuiltinModelsChosen): start from a user who never chose.
  const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  delete settings.hideBuiltinModels; delete settings.hideBuiltinModelsChosen;
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2) + '\n');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-apimodels-team-'));
  const key = projectKey(dir);
  try {
    writeTeamPolicyPrefs(key, { present: true, docKnown: true, slug: 'acme/hide-default', headSha: 'abc1234', delegateTo: null, doc: { schema: 1, fields: { 'models.hideBuiltins': { kind: 'default', value: true } }, workspaceRuns: {}, catalogs: {} } });
    const withProject = `/api/models?${q({ projectDir: dir })}`;
    assert.equal((await jfetch(withProject)).body.hiddenBuiltins.claude, true, 'the team default applies to its project');
    assert.equal((await jfetch('/api/models')).body.hiddenBuiltins.claude, false, 'no project: the user\'s choice only');
    const off = await post('/api/settings', { hideBuiltinModels: false });
    assert.equal(off.status, 200);
    assert.deepEqual((await jfetch(withProject)).body.hiddenBuiltins, { claude: false, codex: false, copilot: false }, 'turning it off records the user\'s own choice');
  } finally {
    writeTeamPolicyPrefs(key, { present: false });
    await post('/api/settings', { hideBuiltinModels: false });
    await rm(dir, { recursive: true, force: true });
  }
});

test('#422: POST /api/settings titleModel — catalog member stored, unknown id refused, "" clears; deleting the model clears the pick; a stale id is reported', async () => {
  const { PREDEFINED_MODELS } = await import('../src/core/config.mjs');
  const unknown = await post('/api/settings', { titleModel: 'no-such-model' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /The model “no-such-model” is not in the catalog/);
  const builtin = await post('/api/settings', { titleModel: PREDEFINED_MODELS[0].id });
  assert.equal(builtin.status, 200, JSON.stringify(builtin.body));
  assert.equal(builtin.body.titleModel, PREDEFINED_MODELS[0].id);
  assert.deepEqual(builtin.body.titleModelEffective, { model: PREDEFINED_MODELS[0].id, source: 'settings', stale: null });
  // A global entry picked, then deleted → the delete clears the pick (PAN-7: it clears every job that names it).
  const add = await post('/api/models', { id: 'title-only-model', label: 'T', efforts: [], env: {} });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const pick = await post('/api/settings', { titleModel: 'title-only-model' });
  assert.equal(pick.status, 200);
  const del = await jfetch('/api/models/title-only-model', { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.clearedJobs, 1);
  const cleared = await jfetch('/api/settings');
  assert.equal(cleared.body.titleModel, null, 'the delete cleared the pick');
  assert.deepEqual(cleared.body.titleModelEffective, { model: null, source: 'run', stale: null });
  // An id that left the catalog some other way (a hand edit) is still reported stale.
  const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  writeFileSync(settingsFile(), JSON.stringify({ ...raw, titleModel: 'gone-model' }));
  const stale = await jfetch('/api/settings');
  assert.equal(stale.body.titleModel, 'gone-model', 'stored id kept verbatim');
  assert.deepEqual(stale.body.titleModelEffective, { model: null, source: 'run', stale: 'gone-model' });
  const clear = await post('/api/settings', { titleModel: '' });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.titleModel, null);
  assert.deepEqual(clear.body.titleModelEffective, { model: null, source: 'run', stale: null });
});

// PAN-7 / U2b: who uses a model, and a delete that clears every job naming it. The file shares ONE home and the
// :154 row expects an empty catalogue, so these rows come last and remove every model and pick they add.
test('GET /api/models carries uses', async () => {
  const add = await post('/api/models', { id: 'my-gpt' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const role = await post('/api/settings', { modelRoles: { claude: { everyday: { model: 'my-gpt' } } } });
  assert.equal(role.status, 200, JSON.stringify(role.body));
  const { status, body } = await jfetch('/api/models');
  assert.equal(status, 200);
  assert.deepEqual(body.uses['my-gpt'], [{ kind: 'role', engine: 'claude', key: 'everyday', label: ROLE_LABELS.everyday }]);
});

test('refs carry the user-level jobs', async () => {
  // A project node pick is a ref of its own (`nodes`): `jobs` holds the user-level jobs only, so none counts twice.
  await setNodeModel(proj, 'wf_x', 's9_0', { model: 'my-gpt' });
  const { status, body } = await jfetch('/api/models/my-gpt/refs');
  assert.equal(status, 200);
  assert.equal(body.nodes.length, 1);
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].key, 'everyday');
});

test('DELETE clears the jobs and says how many', async () => {
  // A cleared role is a settings change: open tabs repaint their pickers (as for the defragment model above).
  const { server } = await import('../ui/server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d)).type); } catch { /* not JSON */ } });
  try {
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const del = await jfetch('/api/models/my-gpt', { method: 'DELETE' });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.clearedJobs, 1);
    assert.equal(del.body.clearedNodes, 1);
    const t0 = Date.now();
    while (!frames.includes('settings-changed') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(frames.includes('settings-changed'), `frames: ${frames.join(', ')}`);
  } finally {
    ws.close();
    await new Promise((r) => server.close(r));
  }
  const settings = await jfetch('/api/settings');
  assert.equal(settings.body.modelRoles.claude?.everyday, undefined);
  assert.equal((await jfetch('/api/models')).body.uses['my-gpt'], undefined);
});

test('DELETE of an unknown id clears nothing (the catalogue check runs before any clear)', async () => {
  const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  writeFileSync(settingsFile(), JSON.stringify({ ...raw, agentGenModel: { model: 'ghost-model' } }));
  try {
    const del = await jfetch('/api/models/ghost-model', { method: 'DELETE' });
    assert.equal(del.status, 400);
    assert.deepEqual(JSON.parse(readFileSync(settingsFile(), 'utf8')).agentGenModel, { model: 'ghost-model' });
  } finally {
    const { agentGenModel: _gone, ...rest } = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    writeFileSync(settingsFile(), JSON.stringify(rest));
  }
});

test('removing an override of a Codex built-in clears nothing', async () => {
  const add = await post('/api/models', { id: 'gpt-6.1-sol', engine: 'codex', label: 'Sol (mine)' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const role = await post('/api/settings', { modelRoles: { codex: { deep: { model: 'gpt-6.1-sol' } } } });
  assert.equal(role.status, 200, JSON.stringify(role.body));
  assert.deepEqual((await jfetch('/api/models/gpt-6.1-sol/refs')).body.jobs, [], 'an override: the confirm counts no job');
  const del = await jfetch('/api/models/gpt-6.1-sol', { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.predefinedShadow, true);
  assert.equal(del.body.clearedJobs, 0);
  const settings = await jfetch('/api/settings');
  assert.deepEqual(settings.body.modelRoles.codex?.deep, { model: 'gpt-6.1-sol' }, 'the built-in still runs the role');
  const reset = await post('/api/settings', { modelRoles: { codex: { deep: null } } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
});

test('removing an override of a Copilot built-in clears nothing', async () => {
  const id = 'copilot/claude-opus-5.5';
  const add = await post('/api/models', { id, engine: 'copilot', label: 'Opus (mine)' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const role = await post('/api/settings', { modelRoles: { copilot: { deep: { model: id } } } });
  assert.equal(role.status, 200, JSON.stringify(role.body));
  assert.deepEqual((await jfetch(`/api/models/${encodeURIComponent(id)}/refs`)).body.jobs, [], 'an override: the confirm counts no job');
  const del = await jfetch(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.predefinedShadow, true);
  assert.equal(del.body.clearedJobs, 0);
  const settings = await jfetch('/api/settings');
  assert.deepEqual(settings.body.modelRoles.copilot?.deep, { model: id }, 'the built-in still runs the role');
  const reset = await post('/api/settings', { modelRoles: { copilot: { deep: null } } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
});

test('a pick stored under a key named after an Object.prototype member: the catalogue, the refs and a delete still answer', async () => {
  const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  // A hand edit: the settings validators refuse such a key.
  writeFileSync(settingsFile(), JSON.stringify({ ...raw, utilityModels: { constructor: { title: { model: 'proto-m' } } } }));
  try {
    const list = await jfetch('/api/models');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.uses['proto-m'], [{ kind: 'helper', engine: 'constructor', key: 'title', label: 'title' }]);
    const refs = await jfetch('/api/models/constructor/refs');
    assert.equal(refs.status, 200, JSON.stringify(refs.body));
    assert.deepEqual(refs.body.jobs, [], 'no job names `constructor`');
    assert.equal((await post('/api/models', { id: 'proto-m' })).status, 200);
    const del = await jfetch('/api/models/proto-m', { method: 'DELETE' });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.clearedJobs, 1);
    assert.equal(JSON.parse(readFileSync(settingsFile(), 'utf8')).utilityModels, undefined);
  } finally {
    const { utilityModels: _gone, ...rest } = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    writeFileSync(settingsFile(), JSON.stringify(rest));
  }
});

// The fault is planted in node:fs (a builtin's ESM bindings follow its CommonJS object after syncBuiltinESMExports):
// the one settings write that no longer names the model fails, i.e. the job clear that runs after the entry is gone.
test('DELETE: a job clear that fails after the entry is gone still answers 200, says so, and broadcasts', async () => {
  assert.equal((await post('/api/models', { id: 'half-gone' })).status, 200);
  const seed = await post('/api/settings', { memoryDefrag: { model: 'half-gone', effort: 'high' }, modelRoles: { claude: { everyday: { model: 'half-gone' } } } });
  assert.equal(seed.status, 200, JSON.stringify(seed.body));
  const fsCjs = createRequire(import.meta.url)('node:fs');
  const real = fsCjs.writeFileSync;
  const { server } = await import('../ui/server.mjs');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d)).type); } catch { /* not JSON */ } });
  try {
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    // Planted inside the try, right before the DELETE: the finally always puts the real write back.
    fsCjs.writeFileSync = function (p, data, ...rest) {
      if (/settings\.json\.[0-9a-f]{8}\.tmp$/.test(String(p)) && !String(data).includes('"half-gone"')) {
        throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
      }
      return real.call(this, p, data, ...rest);
    };
    syncBuiltinESMExports();
    const del = await jfetch('/api/models/half-gone', { method: 'DELETE' });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.clearedMemoryDefrag, true);
    assert.equal(del.body.clearedJobs, 1, 'only the defragment pick was cleared');
    assert.match(del.body.warning, /EACCES: injected/);
    const t0 = Date.now();
    while (!frames.includes('settings-changed') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(frames.includes('settings-changed'), `frames: ${frames.join(', ')}`);
  } finally {
    fsCjs.writeFileSync = real;
    syncBuiltinESMExports();
    ws.close();
    await new Promise((r) => server.close(r));
  }
  assert.equal(listGlobalModels().some((m) => m.id === 'half-gone'), false, 'the entry is gone');
  assert.deepEqual((await jfetch('/api/settings')).body.modelRoles.claude?.everyday, { model: 'half-gone' }, 'the role the failed clear left');
  const reset = await post('/api/settings', { modelRoles: { claude: { everyday: null } } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
});

test('PATCH /api/config: a node\'s engine sets, an absent one keeps, a bad one is a 400; POST takes it for a step', async () => {
  const at = (r) => r.body.config.workflows.wf_x.nodes.s9_0;
  assert.equal(at(await patch('/api/config', { projectDir: proj, workflowId: 'wf_x', nodes: { s9_0: { model: 'gpt-5.5', engine: 'codex' } } })).engine, 'codex');
  assert.equal(at(await patch('/api/config', { projectDir: proj, workflowId: 'wf_x', nodes: { s9_0: { model: 'gpt-5.5', effort: 'low' } } })).engine, 'codex');
  const bad = await patch('/api/config', { projectDir: proj, workflowId: 'wf_x', nodes: { s9_0: { model: 'gpt-5.5', engine: 'codx' } } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'unknown harness "codx"']);
  const step = await post('/api/config', { projectDir: proj, step: 'planner', model: 'gpt-5.5', engine: 'codex' });
  assert.equal(step.body.config.steps.planner.engine, 'codex');
});
