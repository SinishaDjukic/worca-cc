// test/ask-chat-engine.test.mjs — the chat's engine and the Ask catalog per engine (cascading-settings-design.md D12, D17, §8 test 14).
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskModels, chatEngine } from '../src/core/ask/models.mjs';
import { CODEX_EFFORTS } from '../src/core/model-env.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: askEngine / models.<engine>.ask are user keys, so HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-2b-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});
const ROWS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false, engine: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hasEnv: false, engine: 'claude' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: [...CODEX_EFFORTS], custom: false, hasEnv: false, engine: 'codex', builtin: true },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: [...CODEX_EFFORTS], custom: false, hasEnv: false, engine: 'codex', builtin: true },
];
// Task 0 (a) was NOT CONFIRMED (plans/ask-on-codex-spike.md): CODEX_ASK_LOCKDOWN is null, so by default the catalog hides
// Codex. These tests inject codexAvailable to cover the catalog a lockable codex gets.
const mk = (prefs = { engine: 'claude', slots: {} }, { codexAvailable = () => true } = {}) => createAskModels({ listModels: async () => ROWS, pluginModels: () => [], secretStatus: () => [], effortless: () => new Set(), askPrefs: () => prefs, codexAvailable });

test('askCatalog: no Codex rows while this codex cannot be locked down; askEngine codex falls back to claude', async () => {
  const cat = await mk({ engine: 'codex', slots: {} }, { codexAvailable: () => false }).askCatalog();
  assert.deepEqual(cat.models.map((m) => m.id), ['claude-opus-5-5', 'claude-haiku-4-5']);
  assert.equal(cat.defaults.codex, null);
  assert.equal(cat.askEngine, 'claude');
  assert.deepEqual(cat.default, cat.defaults.claude);
});


test('chatEngine: the engine of the thread model; unknown or empty is claude', () => {
  assert.equal(chatEngine({ model: 'gpt-5.5' }), 'codex');
  assert.equal(chatEngine({ model: 'claude-opus-5-5' }), 'claude');
  assert.equal(chatEngine({ model: null }), 'claude');
  assert.equal(chatEngine({ model: 'nope-xyz' }), 'claude');
});

test('askCatalog: both engines; a Codex row says so, a Claude row carries no engine key; defaults per engine', async () => {
  const cat = await mk().askCatalog();
  assert.deepEqual(cat.models.map((m) => m.id), ['claude-opus-5-5', 'claude-haiku-4-5', 'gpt-6-astra', 'gpt-5.5']);
  assert.equal('engine' in cat.models[0], false);
  assert.equal(cat.models[3].engine, 'codex');
  assert.deepEqual(cat.models[3].efforts, CODEX_EFFORTS);
  assert.deepEqual(cat.defaults, { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-6-astra', effort: 'medium' } });
  assert.equal(cat.askEngine, 'claude');
  assert.deepEqual(cat.default, cat.defaults.claude);
});

test('askEngine codex and the Ask slots pick the new-chat default', async () => {
  const cat = await mk({ engine: 'codex', slots: { codex: { model: 'gpt-5.5', effort: 'low' }, claude: { model: 'claude-haiku-4-5' } } }).askCatalog();
  assert.equal(cat.askEngine, 'codex');
  assert.deepEqual(cat.default, { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(cat.defaults.claude, { model: 'claude-haiku-4-5', effort: 'high' });
});

test('validateModelEffort: any engine before the first turn; inside a chat only its engine', async () => {
  const m = mk();
  assert.deepEqual(await m.validateModelEffort('gpt-5.5', 'low'), { ok: true, model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(await m.validateModelEffort('claude-opus-5-5', 'high', { engine: 'codex' }),
    { ok: false, error: 'this chat runs on Codex; start a new chat to use Claude' });
  assert.deepEqual(await m.validateModelEffort('gpt-5.5', 'low', { engine: 'claude' }),
    { ok: false, error: 'this chat runs on Claude; start a new chat to use Codex' });
  assert.deepEqual(await m.validateModelEffort('gpt-5.5', 'max'), { ok: false, error: 'effort "max" is not available for model "gpt-5.5"' });
});

test('the event-turn fallback stays on the chat\'s engine', async () => {
  const cat = await mk().askCatalog({ withSecrets: false });
  assert.equal(cat.defaults[chatEngine({ model: 'gpt-5.5' })].model, 'gpt-6-astra');
});
