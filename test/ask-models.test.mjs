// test/ask-models.test.mjs
// The chat's model catalog = the composed catalog minus legacy per-project entries
// (D8, ask-worca-design.md §6.9). Plugin models are IN, carrying plugin/hasEnv/
// costUnreliable/secretsMissing; composeCatalog's precedence (global > plugin >
// built-in) is inherited, not re-implemented here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
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
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
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
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false },
    { id: 'claude-haiku-4-5', label: 'Haiku (via plugin)', efforts: ['medium', 'high'], custom: 'plugin', hasEnv: true, plugin: 'p' },
    { id: 'my-global', label: 'Mine', efforts: ['medium', 'high'], custom: 'global', hasEnv: true, costUnreliable: true },
    { id: 'plugin-only-model', label: 'Plug', efforts: ['medium'], custom: 'plugin', hasEnv: true, plugin: 'p', secretsMissing: ['MISSING'] },
  ]);
  assert.deepEqual(cat.efforts, EFFORTS);
  assert.notEqual(cat.models[0].efforts, FAKE[0].efforts, 'efforts arrays are copies');
  assert.ok(!cat.models.some((m) => m.custom === 'project'), 'legacy per-project entries stay excluded');
  assert.ok(!('secretsMissing' in cat.models[1]), 'a plugin model whose secret IS set carries no warning');
});

test('askCatalog: default comes from ASK_LIMITS, validated against the catalog', async () => {
  const cat = await models.askCatalog();
  assert.deepEqual(cat.default, { model: 'claude-opus-5-5', effort: 'high' });

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
  assert.deepEqual(await models.validateModelEffort('CLAUDE-OPUS-5-5', 'high'), { ok: true, model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'medium'), { ok: true, model: 'my-global', effort: 'medium' });
  assert.deepEqual(await models.validateModelEffort('plugin-only-model', 'medium'), { ok: true, model: 'plugin-only-model', effort: 'medium' },
    'a plugin model is now selectable — a missing secret is a warning, not a block (D9)');
  assert.deepEqual(await models.validateModelEffort('legacy-project-model', 'medium'), { ok: false, error: 'unknown model "legacy-project-model"' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5-5', 'low'), { ok: false, error: 'effort "low" is not available for model "claude-opus-5-5"' });
  assert.deepEqual(await models.validateModelEffort('my-global', 'max'), { ok: false, error: 'effort "max" is not available for model "my-global"' });
  assert.deepEqual(await models.validateModelEffort('', 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort(undefined, 'high'), { ok: false, error: 'model is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5-5', ''), { ok: false, error: 'effort is required' });
  assert.deepEqual(await models.validateModelEffort('claude-opus-5-5', 42), { ok: false, error: 'effort is required' });
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
  assert.equal((await validateModelEffort('claude-opus-5-5', 'high')).ok, true, 'the D8 initial choice validates');
});

test('askCatalog: Codex models are offered with their engine and validate (Plan 2, design D12)', async () => {
  const withCodex = createAskModels({
    listModels: async () => [...FAKE, { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, hasEnv: false, engine: 'codex' }],
    pluginModels: () => PLUGIN_MODELS,
    secretStatus: (name) => SECRET_STATUS[name] || [],
    askPrefs: () => ({ engine: 'claude', slots: {} }),
    codexAvailable: () => true,   // a lockable codex (Task 0 (a) was NOT CONFIRMED on 0.146, so the real catalog hides Codex)
  });
  const cat = await withCodex.askCatalog();
  assert.equal(cat.models.find((m) => m.id === 'gpt-5.5').engine, 'codex');
  assert.deepEqual(await withCodex.validateModelEffort('gpt-5.5', 'low'), { ok: true, model: 'gpt-5.5', effort: 'low' });
});

// An engine whose CLI is not installed here (its chat descriptor's notInstalled: a stat, never a spawn) is named in
// `notReady`; its rows stay, so a chat already on it still validates and its turn says why it cannot run.
const CODEX_ROW = { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], custom: false, hasEnv: false, engine: 'codex' };
const codexCatalog = (deps = {}) => createAskModels({
  listModels: async () => [...FAKE, CODEX_ROW],
  pluginModels: () => PLUGIN_MODELS,
  secretStatus: (name) => SECRET_STATUS[name] || [],
  askPrefs: () => ({ engine: 'codex', slots: {} }),
  codexAvailable: () => true,
  ...deps,
});

test('askCatalog: Codex not installed — notReady names it, a new chat starts on Claude, the rows stay', async () => {
  const why = 'OpenAI Codex is not installed: codex was not found. Install it, or set WORCA_CODEX_BIN to its path.';
  const m = codexCatalog({ notInstalled: (e) => (e === 'codex' ? why : null) });
  const cat = await m.askCatalog();
  assert.deepEqual(cat.notReady, { codex: why });
  assert.deepEqual(cat.setupDocs, { codex: 'https://github.com/worca-org/worca/blob/dev/docs/models.md#codex' }, 'More harnesses links its setup section');
  assert.equal(cat.askEngine, 'claude', 'the Ask engine falls back to Claude');
  assert.deepEqual(cat.default, cat.defaults.claude);
  assert.equal(cat.defaults.codex.model, 'gpt-5.5', "a chat already on Codex keeps its engine's default");
  assert.ok(cat.models.some((x) => x.id === 'gpt-5.5' && x.engine === 'codex'), 'the rows stay for a chat already on Codex');
  // A chat already on Codex is not refused by validation: its turn says why Codex cannot run (the chat engine gate).
  assert.deepEqual(await m.validateModelEffort('gpt-5.5', 'low', { engine: 'codex' }), { ok: true, model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(await m.eventPick({ model: 'gpt-5.5', effort: 'low' }, 'codex'), { ok: true, model: 'gpt-5.5', effort: 'low' });
});

test('askCatalog: Codex installed — no notReady, the Ask engine stays Codex (today\'s payload)', async () => {
  const cat = await codexCatalog({ notInstalled: () => null }).askCatalog();
  assert.equal('notReady' in cat, false);
  assert.equal('setupDocs' in cat, false);
  assert.equal(cat.askEngine, 'codex');
  assert.equal(cat.default.model, 'gpt-5.5');
});

test('askCatalog: an engine with no rows is checked too (the picker\'s More harnesses leaves it out)', async () => {
  const seen = [];
  const m = createAskModels({ listModels: async () => FAKE, pluginModels: () => [], secretStatus: () => [], askPrefs: () => ({ engine: 'claude', slots: {} }),
    notInstalled: (e) => { seen.push(e); return e === 'gemini' ? 'Gemini CLI is not installed' : null; } });
  const cat = await m.askCatalog();
  assert.equal(cat.models.some((x) => x.engine === 'gemini'), false, 'Gemini has no rows here');
  assert.deepEqual(cat.notReady, { gemini: 'Gemini CLI is not installed' });
  assert.deepEqual(cat.setupDocs, { gemini: 'https://github.com/worca-org/worca/blob/dev/docs/models.md#gemini-cli-and-qwen-code' });
  assert.ok(seen.includes('claude') && seen.includes('qwen') && seen.includes('goose'), 'every chat engine is checked, Claude too');
});

test('askCatalog: Claude Code not installed — notReady names it as any engine, and a new chat starts on one that is installed', async () => {
  const why = 'Claude Code is not installed: claude was not found. Install it, or set WORCA_CLAUDE_BIN to its path.';
  const m = codexCatalog({ askPrefs: () => ({ engine: 'claude', slots: {} }), notInstalled: (e) => (e === 'claude' ? why : null) });
  const cat = await m.askCatalog();
  assert.deepEqual(cat.notReady, { claude: why });
  assert.deepEqual(cat.setupDocs, { claude: 'https://github.com/worca-org/worca/blob/dev/docs/models.md#claude-code' });
  assert.equal(cat.askEngine, 'codex', 'the Ask engine falls back to the first installed engine');
  assert.deepEqual(cat.default, cat.defaults.codex);
  assert.ok(cat.models.some((x) => !x.engine), 'the Claude rows stay for a chat already on Claude');
  assert.deepEqual(await m.validateModelEffort('claude-opus-5-5', 'high', { engine: 'claude' }), { ok: true, model: 'claude-opus-5-5', effort: 'high' });
});

test('askCatalog: no engine installed — every one in notReady; a new chat keeps the Ask engine (the pickers ask for a harness)', async () => {
  const cat = await codexCatalog({ notInstalled: (e) => `${e} is not installed` }).askCatalog();
  assert.equal(Object.keys(cat.notReady).length, 7, 'every chat engine');
  assert.equal(cat.askEngine, 'codex', 'the Ask engine, which has a model');
  assert.deepEqual(cat.default, cat.defaults.codex);
  const onClaude = await createAskModels({ listModels: async () => FAKE, pluginModels: () => [], secretStatus: () => [],
    askPrefs: () => ({ engine: 'gemini', slots: {} }), notInstalled: (e) => `${e} is not installed` }).askCatalog();
  assert.equal(onClaude.askEngine, 'claude', 'an Ask engine with no model: Claude, which always has built-ins');
});

test('askCatalog default notInstalled: Claude\'s configured binary decides (WORCA_CLAUDE_BIN), never in mock mode', async () => {
  const keep = { bin: process.env.WORCA_CLAUDE_BIN, mock: process.env.WORCA_MOCK, orch: process.env.ORCH_MOCK };
  const missing = join(sandboxHome, 'no-such-dir', 'claude');
  const cat = () => createAskModels({ listModels: async () => FAKE, pluginModels: () => [], secretStatus: () => [], askPrefs: () => ({ engine: 'claude', slots: {} }) }).askCatalog();
  try {
    delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
    process.env.WORCA_CLAUDE_BIN = missing;
    assert.equal((await cat()).notReady?.claude, `Claude Code is not installed: ${missing} was not found. Install it, or set WORCA_CLAUDE_BIN to its path.`);
    process.env.WORCA_CLAUDE_BIN = process.execPath;
    assert.equal((await cat()).notReady?.claude, undefined, 'a binary that exists');
    process.env.WORCA_CLAUDE_BIN = missing;
    process.env.WORCA_MOCK = '1';
    assert.equal('notReady' in await cat(), false, 'mock mode has every engine');
  } finally {
    for (const [k, v] of [['WORCA_CLAUDE_BIN', keep.bin], ['WORCA_MOCK', keep.mock], ['ORCH_MOCK', keep.orch]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('chat descriptor notInstalled: the configured binary decides; a descriptor naming none is never "not installed"', async () => {
  const { makeChatDescriptor } = await import('../src/core/engines/chat-descriptor.mjs');
  const missing = join(sandboxHome, 'no-such-dir', 'codex');
  assert.equal(makeChatDescriptor({ engine: 'codex', lockdown: () => true, bin: () => missing }).notInstalled(),
    `OpenAI Codex is not installed: ${missing} was not found. Install it, or set WORCA_CODEX_BIN to its path.`);
  assert.equal(makeChatDescriptor({ engine: 'codex', lockdown: () => true, bin: () => process.execPath }).notInstalled(), null, 'a binary that exists');
  assert.equal(makeChatDescriptor({ engine: 'codex', lockdown: () => true }).notInstalled(), null);
});

test('askCatalog default notInstalled: mock mode has every engine', async () => {
  const prev = process.env.WORCA_MOCK;
  process.env.WORCA_MOCK = '1';
  try {
    const cat = await codexCatalog().askCatalog();
    assert.equal('notReady' in cat, false);
    assert.equal(cat.askEngine, 'codex');
  } finally { if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev; }
});

// A bridged row that is not ready names the Providers row that fixes it (Models › Providers › <row>).
const needsKey = (id, extra = {}) => ({ id, label: id, efforts: ['medium', 'high'], custom: 'global', hasEnv: false, bridged: 'openai', upstreamApi: 'openai-chat', needsSignIn: true, signInReason: 'no_key', ...extra });
const signInOf = async (deps, id) => (await createAskModels({ pluginModels: () => [], secretStatus: () => [], askPrefs: () => ({ engine: 'claude', slots: {} }), ...deps }).askCatalog()).models.find((m) => m.id === id).signInMessage;

test('signInMessage names the Providers row: OpenRouter for a model on openrouter.ai, else the bridged provider\'s row', async () => {
  const listModels = () => [needsKey('or-m'), needsKey('cp-m', { bridged: 'copilot', signInReason: 'not_signed_in' })];
  assert.equal(await signInOf({ listModels, isOpenRouterModel: () => true }, 'or-m'), 'No API key for OpenRouter — Models › Providers › OpenRouter.');
  assert.equal(await signInOf({ listModels, isOpenRouterModel: () => false }, 'or-m'), 'No API key for OpenAI-compatible — Models › Providers › OpenAI-compatible.');
  assert.equal(await signInOf({ listModels, isOpenRouterModel: () => false }, 'cp-m'), 'Not signed in to GitHub Copilot — Models › Providers › GitHub Copilot.');
});

test('signInMessage: the default reader finds an OpenRouter model by its catalogue entry\'s openrouter.ai base URL', async () => {
  const prevAllow = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
    await writeFile(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify({ models: [
      { id: 'or-m', label: 'OR', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3-coder', baseUrl: 'https://openrouter.ai/api/v1' } },
      { id: 'oa-m', label: 'OA', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1' } },
    ] }));
    const listModels = () => [needsKey('or-m'), needsKey('oa-m')];
    assert.equal(await signInOf({ listModels }, 'or-m'), 'No API key for OpenRouter — Models › Providers › OpenRouter.');
    assert.equal(await signInOf({ listModels }, 'oa-m'), 'No API key for OpenAI-compatible — Models › Providers › OpenAI-compatible.');
  } finally {
    if (prevAllow === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = prevAllow;
    await rm(join(sandboxHome, '.worca-cc', 'settings.json'), { force: true });
  }
});
