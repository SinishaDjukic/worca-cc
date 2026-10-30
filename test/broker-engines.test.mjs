// test/broker-engines.test.mjs — with the credential broker on, an engine runs only when one of its sign-in modes can sit
// in a broker slot (decision 5): Claude, Codex (openai slot), Copilot (copilot-pat) and Cursor (cursor) sign in through
// the broker, an own login (a ChatGPT, keychain or Cursor sign-in) never does. One refusal
// (broker-client.mjs brokerEngineRefusal) serves runs, GET /api/engines, Ask chats and the pickers (engine-locks.mjs);
// the boot guard also finds Codex/Cursor keys in the env and Codex's stored sign-in.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { brokerEngineRefusal, setBrokerInfoForTest, resetBrokerClient } from '../src/core/broker-client.mjs';
import { engineReadiness, engineLocks } from '../src/core/engines/readiness.mjs';
import { resetEngineReadiness } from '../src/core/engines/ready-cache.mjs';
import { findLocalCredentials, credentialFiles, MODEL_CREDENTIAL_ENV_KEYS } from '../src/core/broker-guard.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { setEngineLocks, engineLock, lockEngineOptions } from '../ui/public/engine-locks.mjs';
import { ENGINES, setCatalogForTest } from '../src/shared/engine-switch.mjs';

const BROKER = { WORCA_BROKER_URL: 'http://broker.internal:8080' };
const prevUrl = process.env.WORCA_BROKER_URL;
afterEach(() => {
  if (prevUrl === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prevUrl;
  setEngineLocks(null); setCatalogForTest(null); resetBrokerClient();
});
const refusalOf = (e) => `the credential broker is on, and ${e} signs in with its own credentials, which the broker cannot bill or revoke`;
/** The catalog with `engine`'s key modes removed: its own login is all it has. */
const ownOnly = (engine) => ({ ...ENGINES, [engine]: { ...ENGINES[engine], signIn: { modes: ENGINES[engine].signIn.modes.filter((m) => m.kind === 'own') } } });

test('brokerEngineRefusal: only with the broker on, never for Claude or mock, and only when no sign-in mode has a slot', () => {
  assert.equal(brokerEngineRefusal('codex', {}), null);
  assert.equal(brokerEngineRefusal('claude', BROKER), null);
  assert.equal(brokerEngineRefusal('mock', BROKER), null);
  assert.equal(brokerEngineRefusal(null, BROKER), null);
  assert.equal(brokerEngineRefusal('codex', BROKER, ['openai']), null, 'its API key sits in the openai slot');
  assert.equal(brokerEngineRefusal('codex', BROKER, []), refusalOf('codex'), 'no openai slot: only its ChatGPT sign-in is left');
  for (const e of ['codex', 'copilot', 'cursor']) assert.equal(brokerEngineRefusal(e, BROKER), null, `${e}: its key mode has a built-in slot`);
  assert.equal(brokerEngineRefusal('cursor', BROKER, ['anthropic', 'openai']), refusalOf('cursor'), 'a broker without a cursor slot');
  setCatalogForTest(ownOnly('codex'));
  assert.equal(brokerEngineRefusal('codex', BROKER), refusalOf('codex'), 'an own-only engine is refused');
});

test('readiness: with the broker on, every engine with a slot is ready (mock: no preflight); an own-only one is not (broker: true)', async () => {
  process.env.WORCA_BROKER_URL = BROKER.WORCA_BROKER_URL;
  resetEngineReadiness();
  const boom = async () => { throw new Error('spawned'); };
  const list = await engineReadiness({ preflights: { claude: async () => ({}), codex: boom, copilot: boom, cursor: boom, gemini: boom, goose: boom, opencode: boom, qwen: boom }, mock: true, force: true });
  assert.deepEqual(list.find((e) => e.name === 'claude'), { name: 'claude', label: 'Claude', ready: true, reason: null });
  // Every engine has a key mode in a slot (Gemini CLI, Qwen Code, Goose and OpenCode: google, openai, anthropic, openrouter).
  for (const name of ['codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']) {
    assert.deepEqual(list.find((e) => e.name === name), { name, label: ENGINES[name].label, ready: true, reason: null }, name);
  }
  setCatalogForTest(ownOnly('cursor'));
  resetEngineReadiness();
  const own = (await engineReadiness({ preflights: { claude: async () => ({}), codex: boom, copilot: boom, cursor: boom }, mock: true, force: true })).find((e) => e.name === 'cursor');
  assert.equal(own.ready, false);
  assert.equal(own.broker, true);
  assert.match(own.reason, /credential broker is on/);
  resetEngineReadiness();
});

test('engineLocks (GET /api/engine-locks): empty without the broker; with it, only the engines without a slot', () => {
  assert.deepEqual(engineLocks({}), []);
  // Every engine has a key mode in a slot.
  assert.deepEqual(engineLocks(BROKER).map((e) => e.name), []);
  setCatalogForTest(ownOnly('copilot'));
  const locks = engineLocks(BROKER);
  assert.deepEqual(locks.map((e) => e.name), ['copilot']);
  assert.ok(locks.every((e) => e.broker === true && /credential broker is on/.test(e.reason)));
});

test('guard: Codex and Cursor keys in the env are credentials', () => {
  assert.ok(MODEL_CREDENTIAL_ENV_KEYS.includes('CODEX_API_KEY'));
  assert.ok(MODEL_CREDENTIAL_ENV_KEYS.includes('CURSOR_API_KEY'));
  const findings = findLocalCredentials({ env: { CODEX_API_KEY: 'sk-x', CURSOR_API_KEY: 'key_123', OTHER: 'x' } });
  assert.deepEqual(findings, ['env CODEX_API_KEY (set, 4 chars)', 'env CURSOR_API_KEY (set, 7 chars)']);
});

test("guard: a stored Codex sign-in under an agent or server HOME is found", () => {
  const home = '/home/worca-agent';
  const login = join(home, '.codex', 'auth.json');
  const files = credentialFiles([home], { exists: (p) => p === login });
  assert.deepEqual(files, [{ path: login, kind: 'codex-login' }]);
  assert.deepEqual(findLocalCredentials({ files }), [`${login}: a stored Codex sign-in`]);
});

test('Ask catalog: Codex rows are offered under the broker while it has an openai slot', async () => {
  const deps = {
    listModels: async () => [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', custom: false, hasEnv: false },
      { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'high'], custom: false, hasEnv: false, engine: 'codex' },
    ],
    pluginModels: () => [], secretStatus: () => [], effortless: () => new Set(),
    askPrefs: () => ({ engine: 'codex', slots: {} }), codexAvailable: () => true,
  };
  const open = await createAskModels(deps).askCatalog();
  assert.ok(open.models.some((m) => m.id === 'gpt-5.5'), 'offered without the broker');
  assert.equal(open.askEngine, 'codex');
  process.env.WORCA_BROKER_URL = BROKER.WORCA_BROKER_URL;
  const brokered = await createAskModels(deps).askCatalog();
  assert.ok(brokered.models.some((m) => m.id === 'gpt-5.5'), 'the built-in openai slot carries its key');
  assert.equal(brokered.askEngine, 'codex');
  setBrokerInfoForTest({ slots: [{ id: 'anthropic' }] });
  const noSlot = await createAskModels(deps).askCatalog();
  assert.ok(!noSlot.models.some((m) => m.id === 'gpt-5.5'), 'a broker without an openai slot');
  assert.equal(noSlot.askEngine, 'claude');
});

test('engine-locks: locked options are disabled with the reason; the caller learns when the selection is locked', () => {
  setEngineLocks([{ name: 'claude', ready: true }, { name: 'codex', ready: false, broker: true, reason: 'broker on' }, { name: 'cursor', ready: false, reason: 'not signed in' }]);
  assert.equal(engineLock('codex'), 'broker on');
  assert.equal(engineLock('cursor'), null, 'a sign-in the user can fix is not a lock');
  const opt = (value, textContent) => ({ value, textContent, disabled: false, title: '' });
  const select = { value: 'codex', options: [opt('', 'Default'), opt('claude', 'Claude'), opt('codex', 'Codex (Beta)'), opt('cursor', 'Cursor (Beta)')] };
  assert.equal(lockEngineOptions(select), true);
  assert.equal(lockEngineOptions(select), true, 'idempotent');
  assert.deepEqual(select.options.map((o) => [o.value, o.disabled, o.textContent]), [
    ['', false, 'Default'], ['claude', false, 'Claude'], ['codex', true, 'Codex (Beta): off while the credential broker is on'], ['cursor', false, 'Cursor (Beta)'],
  ]);
  assert.equal(select.options[2].title, 'broker on');
  select.value = 'claude';
  assert.equal(lockEngineOptions(select), false);
  setEngineLocks(null);
  assert.equal(engineLock('codex'), null);
});

test('the broker preflight maps a codex model to the openai slot, never the anthropic one', async () => {
  await import('../src/core/config.mjs');   // registers the model catalog's reader (broker-routing.mjs setModelEngineReader)
  const { modelSlot } = await import('../src/core/broker-routing.mjs');
  process.env.WORCA_BROKER_URL = BROKER.WORCA_BROKER_URL;
  assert.deepEqual(modelSlot('gpt-6.1-sol'), { slot: 'openai' }, "a codex catalog model: Codex's key mode slot");
  assert.deepEqual(modelSlot('claude-sonnet-5'), { slot: 'anthropic' });
});

test('the broker preflight maps a Goose or OpenCode model to the slot of the provider its id names', async () => {
  const { modelSlot, setModelEngineReader } = await import('../src/core/broker-routing.mjs');
  await import('../src/core/config.mjs');
  process.env.WORCA_BROKER_URL = BROKER.WORCA_BROKER_URL;
  const owners = { 'google/gemini-2.5-flash': 'goose', 'openrouter/qwen3': 'opencode', 'anthropic/claude-sonnet-5': 'opencode' };
  setModelEngineReader((id) => owners[id] ?? null);
  try {
    assert.deepEqual(modelSlot('google/gemini-2.5-flash'), { slot: 'google' });
    assert.deepEqual(modelSlot('openrouter/qwen3'), { slot: 'openrouter' });
    assert.deepEqual(modelSlot('anthropic/claude-sonnet-5'), { slot: 'anthropic' });
  } finally {
    const { engineOfModel } = await import('../src/core/config.mjs');
    setModelEngineReader((id) => engineOfModel(id));
  }
});
