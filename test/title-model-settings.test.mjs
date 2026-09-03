// test/title-model-settings.test.mjs
// #422: the two new stored settings (titleModel, hideBuiltinModels), the
// `hidden` flag composeCatalog puts on UNSHADOWED built-ins, catalogHasModel,
// and the Ask default that skips hidden built-ins while still validating them.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, titleModel, setTitleModel, assertTitleModelInput,
  hideBuiltinModels, setHideBuiltinModels, assertHideBuiltinModelsInput, SETTINGS_POST_KEYS, addGlobalModel,
} from '../src/core/settings.mjs';
import { listModels, catalogHasModel, PREDEFINED_MODELS } from '../src/core/config.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { _resetForTests } from '../src/core/db.mjs';

let home, whome;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-tms-home-'));
  whome = await mkdtemp(join(tmpdir(), 'worca-cc-tms-whome-'));
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
beforeEach(async () => {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{}\n', 'utf8');
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all([home, whome].map((d) => rm(d, { recursive: true, force: true })));
});

test('both keys are registered in SETTINGS_POST_KEYS (the route\'s clear-root exemption)', () => {
  assert.ok(SETTINGS_POST_KEYS.includes('titleModel'));
  assert.ok(SETTINGS_POST_KEYS.includes('hideBuiltinModels'));
});

test('titleModel: null by default; set/clear round-trips; whitespace trimmed; invalid stored value warns to null', async () => {
  assert.equal(titleModel(), null);
  assert.deepEqual(await setTitleModel('  my-model '), { titleModel: 'my-model' });
  assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).titleModel, 'my-model');
  assert.deepEqual(await setTitleModel(''), { titleModel: null });
  assert.equal('titleModel' in JSON.parse(await readFile(settingsFile(), 'utf8')), false, 'clear deletes the key');
  await writeFile(settingsFile(), JSON.stringify({ titleModel: 42 }), 'utf8');
  const warn = console.warn; const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try { assert.equal(titleModel(), null); } finally { console.warn = warn; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /invalid titleModel/);
});

test('assertTitleModelInput: empty/null clear; non-string, blank, or over-long rejected', () => {
  assertTitleModelInput(''); assertTitleModelInput(null); assertTitleModelInput(undefined); assertTitleModelInput('x');
  for (const bad of [42, true, '   ', 'y'.repeat(201), {}]) assert.throws(() => assertTitleModelInput(bad), /titleModel must be a model id/);
});

test('hideBuiltinModels: false by default; true persists; false deletes the key; only booleans accepted', async () => {
  assert.equal(hideBuiltinModels(), false);
  assert.deepEqual(await setHideBuiltinModels(true), { hideBuiltinModels: true });
  assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).hideBuiltinModels, true);
  assert.deepEqual(await setHideBuiltinModels(false), { hideBuiltinModels: false });
  assert.equal('hideBuiltinModels' in JSON.parse(await readFile(settingsFile(), 'utf8')), false);
  for (const bad of ['true', 1, null, undefined]) assert.throws(() => assertHideBuiltinModelsInput(bad), /must be true or false/);
});

test('composeCatalog: hideBuiltinModels marks UNSHADOWED built-ins hidden — a global copy of a built-in id is not hidden', async () => {
  await addGlobalModel({ id: PREDEFINED_MODELS[0].id, label: 'my copy' });
  await addGlobalModel({ id: 'own-model' });
  let cat = await listModels('');
  assert.ok(cat.every((m) => m.hidden === undefined), 'nothing hidden by default');
  await setHideBuiltinModels(true);
  cat = await listModels('');
  const shadowed = cat.find((m) => m.id === PREDEFINED_MODELS[0].id);
  assert.equal(shadowed.custom, 'global');
  assert.equal(shadowed.hidden, undefined, 'the user OWNS this entry');
  assert.equal(cat.find((m) => m.id === 'own-model').hidden, undefined);
  const builtins = cat.filter((m) => m.custom === false);
  assert.equal(builtins.length, PREDEFINED_MODELS.length - 1);
  assert.ok(builtins.every((m) => m.hidden === true), 'every other built-in is hidden');
  assert.equal(cat.length, PREDEFINED_MODELS.length + 1, 'hidden entries are STILL in the catalog (they must resolve)');
});

test('catalogHasModel: built-in, global, plugin-less; case-insensitive; hidden built-ins still count', async () => {
  await addGlobalModel({ id: 'own-model' });
  await setHideBuiltinModels(true);
  assert.equal(catalogHasModel(PREDEFINED_MODELS[0].id), true);
  assert.equal(catalogHasModel(PREDEFINED_MODELS[0].id.toUpperCase()), true);
  assert.equal(catalogHasModel('OWN-model'), true);
  assert.equal(catalogHasModel('nope'), false);
  assert.equal(catalogHasModel(''), false);
  assert.equal(catalogHasModel(undefined), false);
});

test('askCatalog: the D8 default skips hidden built-ins → first owned model; a hidden id still validates', async () => {
  const fake = [
    { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high'], custom: false, hasEnv: false, hidden: true },
    { id: 'claude-haiku-4-5', label: 'Haiku', efforts: ['medium', 'high'], custom: false, hasEnv: false, hidden: true },
    { id: 'corp-model', label: 'Corp', efforts: ['high'], custom: 'global', hasEnv: true },
  ];
  const { askCatalog, validateModelEffort } = createAskModels({ listModels: async () => fake, pluginModels: () => [] });
  const cat = await askCatalog();
  assert.deepEqual(cat.default, { model: 'corp-model', effort: 'high' });
  assert.equal(cat.models.find((m) => m.id === 'claude-opus-5').hidden, true, 'flag shipped to the picker');
  assert.equal(cat.models.find((m) => m.id === 'corp-model').hidden, undefined);
  assert.deepEqual(await validateModelEffort('claude-opus-5', 'high'), { ok: true, model: 'claude-opus-5', effort: 'high' });
  // With every entry hidden the default is still SOMETHING (never null on a non-empty catalog).
  const { askCatalog: allHidden } = createAskModels({ listModels: async () => fake.slice(0, 2), pluginModels: () => [] });
  assert.equal((await allHidden()).default.model, 'claude-opus-5');
});
