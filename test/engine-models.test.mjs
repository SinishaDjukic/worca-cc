// test/engine-models.test.mjs — which engine a model id belongs to (cascading-settings-design.md
// §3.1a, §4.2): the catalog first (user layers before built-ins), then the Claude alias rule.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineOfModel, catalogHasModel, modelForEngine, CODEX_BUILTIN_MODELS, codexModelLabel } from '../src/core/config.mjs';
import { CODEX_PRICES } from '../src/core/engines/codex.mjs';
import { CODEX_EFFORTS, EFFORTS, ALL_EFFORTS, effortsForEngine } from '../src/core/model-env.mjs';

const dirs = [];
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
let home;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'worca-engine-models-'));
  dirs.push(home);
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** settings.json as a user (or an older worca) left it — no validation on the way in. */
const writeSettings = (obj) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj));
};

test('efforts are per engine', () => {
  assert.deepEqual(CODEX_EFFORTS, ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(effortsForEngine('codex'), CODEX_EFFORTS);
  assert.deepEqual(effortsForEngine('claude'), EFFORTS);
  assert.deepEqual(effortsForEngine(undefined), EFFORTS, 'no engine = Claude');
  assert.deepEqual(ALL_EFFORTS, ['medium', 'high', 'xhigh', 'max', 'minimal', 'low']);
});

test('the Codex built-ins are the CODEX_PRICES rows, in that order, with Codex efforts', () => {
  assert.deepEqual(CODEX_BUILTIN_MODELS.map((m) => m.id), Object.keys(CODEX_PRICES));
  assert.ok(CODEX_BUILTIN_MODELS.every((m) => JSON.stringify(m.efforts) === JSON.stringify(CODEX_EFFORTS)));
  assert.equal(codexModelLabel('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.equal(codexModelLabel('gpt-5.5'), 'GPT-5.5');
  assert.equal(codexModelLabel('gpt-5.3-codex-spark'), 'GPT-5.3 Codex Spark');
});

test('engineOfModel: catalog first, then the Claude alias rule, else unknown', () => {
  assert.equal(engineOfModel('claude-opus-5-5'), 'claude');
  assert.equal(engineOfModel('gpt-5.6-sol'), 'codex');
  assert.equal(engineOfModel('GPT-5.6-SOL'), 'codex', 'case-insensitive');
  assert.equal(engineOfModel('sonnet'), 'claude', 'a Claude alias');
  assert.equal(engineOfModel('claude-some-future-id'), 'claude');
  assert.equal(engineOfModel('gpt-5.2-codex'), null, 'an id no catalog knows');
  assert.equal(engineOfModel(''), null);
  assert.equal(engineOfModel(undefined), null);
});

test('catalogHasModel: any engine, or one engine', () => {
  assert.equal(catalogHasModel('gpt-5.5'), true);
  assert.equal(catalogHasModel('gpt-5.5', { engine: 'codex' }), true);
  assert.equal(catalogHasModel('gpt-5.5', { engine: 'claude' }), false);
  assert.equal(catalogHasModel('claude-haiku-4-5', { engine: 'claude' }), true);
  assert.equal(catalogHasModel('sonnet'), false, 'an alias is not a catalog entry');
});

test('modelForEngine keeps an id for its own engine and an unknown id everywhere', () => {
  assert.equal(modelForEngine('gpt-5.5', 'codex'), 'gpt-5.5');
  assert.equal(modelForEngine('gpt-5.5', 'claude'), undefined);
  assert.equal(modelForEngine('claude-sonnet-5', 'codex'), undefined);
  assert.equal(modelForEngine('my-proxy-model', 'claude'), 'my-proxy-model');
  assert.equal(modelForEngine('my-proxy-model', 'codex'), 'my-proxy-model');
  assert.equal(modelForEngine(undefined, 'codex'), undefined);
});

test('a user entry with a Codex built-in id stays the user\'s (Review Focus 1)', () => {
  // An install from before this change: a Claude-engine global named like a Codex built-in.
  writeSettings({ models: [{ id: 'gpt-5.5', label: 'GPT-5.5 via OpenRouter', env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' } }] });
  assert.equal(engineOfModel('gpt-5.5'), 'claude', 'the user layer is read before the built-ins');
  assert.equal(modelForEngine('gpt-5.5', 'claude'), 'gpt-5.5', 'Claude runs keep sending it');
});
