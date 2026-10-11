// test/broker-engines.test.mjs — with the credential broker on, only Claude Code runs: another engine signs in with its
// own credentials, which the broker can neither bill per person nor keep from the agent. One refusal
// (broker-client.mjs brokerEngineRefusal) serves runs, GET /api/engines, Ask chats and the pickers (engine-locks.mjs);
// the boot guard also finds Codex/Cursor keys in the env and Codex's stored sign-in.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { brokerEngineRefusal } from '../src/core/broker-client.mjs';
import { engineReadiness, engineLocks } from '../src/core/engines/readiness.mjs';
import { resetEngineReadiness } from '../src/core/engines/ready-cache.mjs';
import { findLocalCredentials, credentialFiles, MODEL_CREDENTIAL_ENV_KEYS } from '../src/core/broker-guard.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { setEngineLocks, engineLock, lockEngineOptions } from '../ui/public/engine-locks.mjs';

const BROKER = { WORCA_BROKER_URL: 'http://broker.internal:8080' };
const prevUrl = process.env.WORCA_BROKER_URL;
afterEach(() => { if (prevUrl === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prevUrl; setEngineLocks(null); });

test('brokerEngineRefusal: only with the broker on, and never for Claude or mock', () => {
  assert.equal(brokerEngineRefusal('codex', {}), null);
  assert.equal(brokerEngineRefusal('claude', BROKER), null);
  assert.equal(brokerEngineRefusal('mock', BROKER), null);
  assert.equal(brokerEngineRefusal(null, BROKER), null);
  for (const e of ['codex', 'cursor', 'copilot']) {
    assert.equal(brokerEngineRefusal(e, BROKER), `the credential broker is on, and ${e} signs in with its own credentials, which the broker cannot bill or revoke`);
  }
});

test('readiness: with the broker on, every engine but Claude is not ready (broker: true), even in mock, and no preflight runs', async () => {
  process.env.WORCA_BROKER_URL = BROKER.WORCA_BROKER_URL;
  resetEngineReadiness();
  const boom = async () => { throw new Error('spawned'); };
  const list = await engineReadiness({ preflights: { claude: async () => ({}), codex: boom, copilot: boom, cursor: boom }, mock: true, force: true });
  assert.deepEqual(list.find((e) => e.name === 'claude'), { name: 'claude', label: 'Claude', ready: true, reason: null });
  for (const name of ['codex', 'copilot', 'cursor']) {
    const e = list.find((x) => x.name === name);
    assert.equal(e.ready, false, name);
    assert.equal(e.broker, true, name);
    assert.match(e.reason, /credential broker is on/);
  }
  resetEngineReadiness();
});

test('engineLocks (GET /api/engine-locks): empty without the broker; every engine but Claude with it, no preflight', () => {
  assert.deepEqual(engineLocks({}), []);
  const locks = engineLocks(BROKER);
  assert.deepEqual(locks.map((e) => e.name), ['codex', 'copilot', 'cursor']);
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

test('Ask catalog: no Codex rows while the broker is on, so new chats start on Claude', async () => {
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
  assert.ok(!brokered.models.some((m) => m.id === 'gpt-5.5'));
  assert.equal(brokered.askEngine, 'claude');
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
    ['', false, 'Default'], ['claude', false, 'Claude'], ['codex', true, 'Codex (Beta) — off while the credential broker is on'], ['cursor', false, 'Cursor (Beta)'],
  ]);
  assert.equal(select.options[2].title, 'broker on');
  select.value = 'claude';
  assert.equal(lockEngineOptions(select), false);
  setEngineLocks(null);
  assert.equal(engineLock('codex'), null);
});
