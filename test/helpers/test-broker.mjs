// test/helpers/test-broker.mjs
// A real single-mode credential broker on loopback for the credential rows (test/claude-runner-broker.test.mjs brokerFor,
// generalised): its anthropic, openai, openrouter, google, copilot-pat and cursor slots point at `upstream` (test/helpers/engine-upstream.mjs),
// keyed with `keys` (WORCA_BROKER_KEY_<SLOT>). `on()` points worca at it (WORCA_BROKER_URL, WORCA_BROKER_SECRET);
// sealBrokerSecret() moves the secret out of process.env on first use, so a test sets it again before each run and
// calls resetBrokerClient() afterwards (broker-client.mjs caches its config and info).
import assert from 'node:assert/strict';
import { readBrokerConfig } from '../../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../../src/broker/slots.mjs';
import { startBroker } from '../../src/broker/main.mjs';
import { resetBrokerClient } from '../../src/core/broker-client.mjs';

export const BROKER_SECRET = 'b'.repeat(48);
export const ENGINE_SLOTS = Object.freeze(['anthropic', 'openai', 'openrouter', 'google', 'copilot-pat', 'cursor']);

/**
 * @param {{upstream:{url:string}, keys?:Record<string,string>}} o  keys: WORCA_BROKER_KEY_ANTHROPIC, _OPENAI, _OPENROUTER, _GOOGLE,
 *   _COPILOT_PAT, _CURSOR
 * @returns {Promise<{url:string, secret:string, store:object, close:()=>Promise<void>, on:()=>void, tokens:()=>object[]}>}
 */
export async function startTestBroker({ upstream, keys = {} }) {
  const { config, errors } = readBrokerConfig({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: BROKER_SECRET, WORCA_BROKER_HOST: '127.0.0.1',
    WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '0', ...keys });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots(), ENGINE_SLOTS.map((id) => ({ id, upstream: upstream.url, ...(id === 'copilot-pat' ? { lookupUrl: upstream.url } : {}) })));
  const b = await startBroker({ config: { ...config, port: 0, uiPort: 0, uiEnabled: false }, slots, log: () => {} });
  const url = `http://127.0.0.1:${b.ports.private}`;
  return {
    url, secret: BROKER_SECRET, store: b.store,
    close: () => b.close(),
    on: () => { process.env.WORCA_BROKER_URL = url; process.env.WORCA_BROKER_SECRET = BROKER_SECRET; resetBrokerClient(); },
    /** Every spawn token the broker minted (rows of its tokens table). */
    tokens: () => b.store.db.prepare('SELECT spawn_id, slots, kind, revoked_at FROM tokens').all(),
  };
}
