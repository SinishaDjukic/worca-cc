// test/ask-models.test.mjs
// The chat's model catalog = the composed catalog minus legacy per-project entries
// (D8, ask-worca-design.md §6.9). Plugin models are IN, carrying plugin/hasEnv/
// costUnreliable/secretsMissing; composeCatalog's precedence (global > plugin >
// built-in) is inherited, not re-implemented here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskModels, askCatalog, validateModelEffort } from '../src/core/ask/models.mjs';
import { PREDEFINED_MODELS, EFFORTS } from '../src/core/config.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

// The real catalog reads settings.json under HOME (global models) and the
// model_cost_flags table under WORCA_HOME — sandbox both so the bound-defaults
// test never sees the developer's own models.
useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-models-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

// What composeCatalog() would emit: the plugin has already won/lost its shadows,
// so every entry here carries id/label/efforts/custom/hasEnv (config.mjs:188-218).
const FAKE = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
  { id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], custom: 'plugin', plugin: 'p', hasEnv: true },
  { id: 'my-global', label: 'Mine', efforts: ['medium', 'high'], custom: 'global', hasEnv: true, costUnreliable: true },
  { id: 'plugin-only-model', label: 'Plug', efforts: ['medium'], custom: 'plugin', plugin: 'p', hasEnv: true },
  { id: 'legacy-project-model', label: 'Legacy', efforts: ['medium', 'high'], custom: 'project', hasEnv: false },
];
// listPluginModels() shape (plugin-models.mjs:49-53): `secrets` is always present.
const PLUGIN_MODELS = [
  { plugin: 'p', id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], env: { A: { secret: 'TOKEN' } }, secrets: ['TOKEN'] },
  { plugin: 'p', id: 'plugin-only-model', label: 'Plug', efforts: ['medium'], env: { A: { secret: 'MISSING' } }, secrets: ['MISSING'] },
];
// pluginModelSecretStatus(plugin) shape (plugin-models.mjs:96).
const SECRET_STATUS = {
  p: [{ key: 'TOKEN', label: 'Token', set: true }, { key: 'MISSING', label: 'Missing', set: false }],
};
const models = createAskModels({
  listModels: async (dir) => { assert.equal(dir, ''); return FAKE; },
  pluginModels: () => PLUGIN_MODELS,
  secretStatus: (name) => SECRET_STATUS[name] || [],
});

test('askCatalog: plugin entries survive with plugin/hasEnv/costUnreliable; project entries do not', async () => {
  const cat = await models.askCatalog();
  assert.deepEqual(cat.models, [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], custom: 'plugin', hasEnv: true, plugin: 'p' },
    { id: 'my-global', label: 'Mine', efforts: ['medium', 'high'], custom: 'global', hasEnv: true, costUnreliable: true },
    { id: 'plugin-only-model', label: 'Plug', efforts: ['medium'], custom: 'plugin', hasEnv: true, plugin: 'p', secretsMissing: ['MISSING'] },
  ]);
  assert.deepEqual(cat.efforts, EFFORTS);
  assert.notEqual(cat.models[0].efforts, FAKE[0].efforts, 'efforts arrays are copies');
  assert.ok(!cat.models.some((m) => m.custom === 'project'), 'legacy per-project entries stay excluded');
  assert.ok(!('secretsMissing' in cat.models[1]), 'a plugin model whose secret IS set carries no warning');
});

test('askCatalog: precedence is inherited from composeCatalog, one entry per id', async () => {
  const cat = await models.askCatalog();
  const ids = cat.models.map((m) => m.id);
  assert.deepEqual(ids, [...new Set(ids)], 'no duplicate ids');
  // The plugin SHADOW of a predefined id keeps the plugin origin (it is what runs).
  const haiku = cat.models.find((m) => m.id === 'claude-haiku-4-5');
  assert.equal(haiku.custom, 'plugin');
  assert.equal(haiku.plugin, 'p');
  assert.equal(haiku.label, 'Haiku (via plugin)');
});

test('askCatalog: default comes from ASK_LIMITS, validated against the catalog', async () => {
  const cat = await models.askCatalog();
  assert.deepEqual(cat.default, { model: 'claude-opus-5', effort: 'high' });

  // Default id gone -> first entry wins, effort clamped to what that entry offers.
  const gone = createAskModels({
    listModels: async () => [{ id: 'only-one', label: 'One', efforts: ['medium'], custom: 'global', hasEnv: false }],
    pluginModels: () => [], secretStatus: () => [],
  });
  assert.deepEqual((await gone.askCatalog()).default, { model: 'only-one', effort: 'medium' });

  // Empty catalog -> no default at all (the client keeps its own cold-start pick).
  const empty = createAskModels({ listModels: async () => [], pluginModels: () => [], secretStatus: () => [] });
  const cat3 = await empty.askCatalog();
  assert.deepEqual(cat3.models, []);
  assert.equal(cat3.default, null);
});

test('validateModelEffort: widens to plugin models; effort must belong to the entry', async () => {
  assert.deepEqual(await models.validateModelEffort('CLAUDE-OPUS-5', 'high'), { ok: true, model: 'claude-opus-5', effort: 'high' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'medium'), { ok: true, model: 'my-global', effort: 'medium' });
  assert.deepEqual(await models.validateModelEffort('plugin-only-model', 'medium'), { ok: true, model: 'plugin-only-model', effort: 'medium' },
    'a plugin model is now selectable — a missing secret is a warning, not a block (D9)');
  assert.deepEqual(await models.validateModelEffort('legacy-project-model', 'medium'), { ok: false, error: 'unknown model "legacy-project-model"' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', 'low'), { ok: false, error: 'effort "low" is not available for model "claude-opus-5"' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'max'), { ok: false, error: 'effort "max" is not available for model "my-global"' });
  assert.deepEqual(await models.validateModelEffort('', 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort(undefined, 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', ''), { ok: false, error: 'effort is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', 42), { ok: false, error: 'effort is required' });
});

test('validateModelEffort: no secret probe on the per-message path', async () => {
  // Every POST …/messages validates, and validation keeps only id/efforts. Building
  // secretsMissing there costs a second listPluginModels() plus a manifest + two
  // config-bucket reads per plugin — all discarded, and all synchronous.
  let plugins = 0;
  let secrets = 0;
  const probed = createAskModels({
    listModels: async () => FAKE,
    pluginModels: () => { plugins += 1; return PLUGIN_MODELS; },
    secretStatus: (name) => { secrets += 1; return SECRET_STATUS[name] || []; },
  });
  assert.deepEqual(await probed.validateModelEffort('plugin-only-model', 'medium'),
    { ok: true, model: 'plugin-only-model', effort: 'medium' });
  assert.equal(plugins, 0, 'no second listPluginModels() per chat message');
  assert.equal(secrets, 0, 'no per-plugin manifest/secrets read per chat message');

  // …and the picker's own fetch still gets the warning.
  const cat = await probed.askCatalog();
  assert.deepEqual(cat.models.find((m) => m.id === 'plugin-only-model').secretsMissing, ['MISSING']);
  assert.equal(plugins, 1, 'the catalog path still probes, once');
});

test('bound defaults use the real catalog: every predefined id is present, no project entries', async () => {
  const cat = await askCatalog();
  for (const m of PREDEFINED_MODELS) {
    const e = cat.models.find((x) => x.id.toLowerCase() === m.id.toLowerCase());
    assert.ok(e, `${m.id} present`);
    assert.ok(e.custom === false || e.custom === 'global' || e.custom === 'plugin');
    assert.equal(typeof e.hasEnv, 'boolean');
  }
  assert.ok(!cat.models.some((m) => m.custom === 'project'), 'project entries never reach the project-less chat');
  assert.deepEqual(cat.default, { model: ASK_LIMITS.defaultModel, effort: ASK_LIMITS.defaultEffort });
  assert.equal((await validateModelEffort('claude-opus-5', 'high')).ok, true, 'the D8 initial choice validates');
});
