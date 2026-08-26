// test/ask-models-plugin.test.mjs
// askCatalog() against a REAL installed plugin: the fixtures in ask-models.test.mjs
// inject listPluginModels/pluginModelSecretStatus, so this file is what proves the
// actual wiring — plugin rows reach the chat with plugin/hasEnv/secretsMissing.
// Sandbox mirrors test/plugin-models.test.mjs:57-73 (no useTempHome: WORCA_HOME is
// managed by hand here).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { readPluginsLock, writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { modelSecretsSchema } from '../src/core/plugin-models.mjs';
import { askCatalog, validateModelEffort } from '../src/core/ask/models.mjs';

const PLUGIN = 'discretestack-models';
let homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};

/** Fixture-install: current/ as a real dir with a manifest + a lock entry.
 *  (Copied from test/plugin-models.test.mjs:31-40 — there is no shared helper.) */
function installFixture(name, manifest, { enabled = true } = {}) {
  const cur = pluginCurrentDir(name);
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({ name, ...manifest }));
  writePluginsLock({
    ...readPluginsLock(),
    [name]: { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled },
  });
}

const MANIFEST = {
  modelSecrets: [{ key: 'ds-token', label: 'DS token' }, { key: 'ds-other', label: 'Other' }],
  models: [
    { id: 'ds-stable', label: 'DS Stable', efforts: ['medium', 'high'],
      env: { ANTHROPIC_BASE_URL: 'https://api.ds.example', ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' } } },
    { id: 'ds-fast', label: 'DS Fast', efforts: ['medium'],
      env: { ANTHROPIC_AUTH_TOKEN: { secret: 'ds-other' } } },
  ],
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-askpm-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-askpm-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_HOME = worcaHomeDir;            // must precede installFixture: pluginCurrentDir() resolves under it
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
  _resetForTests();
  installFixture(PLUGIN, MANIFEST);
  // writePluginConfig(name, configSchema, values) — schema SECOND, values THIRD
  // (src/core/plugin-config.mjs:198). Seed ds-token only; ds-other stays unset.
  writePluginConfig(PLUGIN, modelSecretsSchema(PLUGIN), { 'ds-token': 'sk-live' });
});

after(async () => {
  _resetForTests();                                  // close the DB while WORCA_HOME still points at the sandbox
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(homeDir, { recursive: true, force: true });
  await rm(worcaHomeDir, { recursive: true, force: true });
});

test('askCatalog surfaces an installed plugin model, with the unset secret named', async () => {
  const { models } = await askCatalog();
  const stable = models.find((m) => m.id === 'ds-stable');
  assert.ok(stable, 'the plugin model reaches the chat catalog');
  assert.equal(stable.custom, 'plugin');
  assert.equal(stable.plugin, PLUGIN);
  assert.equal(stable.hasEnv, true);
  assert.ok(!('secretsMissing' in stable), 'ds-token is set');

  const fast = models.find((m) => m.id === 'ds-fast');
  assert.ok(fast, 'the plugin\'s second model reaches the catalog too');
  assert.deepEqual(fast.secretsMissing, ['ds-other'], 'the unset secret is named for the picker warning');

  assert.deepEqual(await validateModelEffort('ds-stable', 'high'), { ok: true, model: 'ds-stable', effort: 'high' });
});
