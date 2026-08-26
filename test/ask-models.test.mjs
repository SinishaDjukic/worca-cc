// test/ask-models.test.mjs
// P1/T7: the chat's model catalog = predefined ids ⊕ user GLOBAL models (D8,
// ask-worca-design.md §6.9); plugin-only entries are excluded but a plugin that
// SHADOWS a predefined id keeps that id in the list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskModels, askCatalog, validateModelEffort } from '../src/core/ask/models.mjs';
import { PREDEFINED_MODELS, EFFORTS } from '../src/core/config.mjs';

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

const FAKE = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
  { id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], custom: 'plugin', plugin: 'p', hasEnv: true },
  { id: 'my-global', label: 'Mine', efforts: ['medium', 'high'], custom: 'global', hasEnv: true, costUnreliable: true },
  { id: 'plugin-only-model', label: 'Plug', efforts: ['medium'], custom: 'plugin', plugin: 'p', hasEnv: false },
];
const models = createAskModels({ listModels: async (dir) => { assert.equal(dir, ''); return FAKE; } });

test('askCatalog: predefined ∪ global, plugin-only dropped, plugin-shadowed predefined kept as custom:false', async () => {
  const cat = await models.askCatalog();
  assert.deepEqual(cat.models, [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
    { id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], custom: false },
    { id: 'my-global', label: 'Mine', efforts: ['medium', 'high'], custom: 'global' },
  ]);
  assert.deepEqual(cat.efforts, EFFORTS);
  assert.notEqual(cat.models[0].efforts, FAKE[0].efforts, 'efforts arrays are copies');
});

test('validateModelEffort: ok with the catalog casing; effort must belong to the entry', async () => {
  assert.deepEqual(await models.validateModelEffort('CLAUDE-OPUS-5', 'high'), { ok: true, model: 'claude-opus-5', effort: 'high' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'medium'), { ok: true, model: 'my-global', effort: 'medium' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', 'low'), { ok: false, error: 'effort "low" is not available for model "claude-opus-5"' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'max'), { ok: false, error: 'effort "max" is not available for model "my-global"' });
  assert.deepEqual(await models.validateModelEffort('plugin-only-model', 'medium'), { ok: false, error: 'unknown model "plugin-only-model"' });
  assert.deepEqual(await models.validateModelEffort('', 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort(undefined, 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', ''), { ok: false, error: 'effort is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5', 42), { ok: false, error: 'effort is required' });
});

test('bound defaults use the real catalog: every predefined id is present with custom:false or global', async () => {
  const cat = await askCatalog();
  for (const m of PREDEFINED_MODELS) {
    const e = cat.models.find((x) => x.id.toLowerCase() === m.id.toLowerCase());
    assert.ok(e, `${m.id} present`);
    assert.ok(e.custom === false || e.custom === 'global');
  }
  assert.ok(!cat.models.some((m) => m.custom === 'plugin' || m.custom === 'project'), 'no plugin/project entries survive the filter');
  assert.equal((await validateModelEffort('claude-opus-5', 'high')).ok, true, 'the D8 initial choice validates');
});
