// test/provider-ops-probe-kind.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { updateProvider } from '../src/core/settings.mjs';
import { testProviderConnection } from '../src/core/bridge/provider-ops.mjs';
import { checkRows } from './helpers/rows.mjs';

const saved = {};
before(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) saved[k] = process.env[k];
  const home = mkdtempSync(join(tmpdir(), 'probe-kind-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = mkdtempSync(join(tmpdir(), 'probe-kind-wh-'));
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
  _resetForTests();
  await updateProvider('openai', { apiKey: 'sk-test', baseUrl: 'https://gw.example.com/v1' });
});
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } _resetForTests(); });

const answer = (status) => async () => new Response(JSON.stringify({ data: [] }), { status });

test('failures carry a kind the pre-run check can act on', async () => {
  await checkRows([
    { name: '401 → auth', run: async () => assert.equal((await testProviderConnection('openai', { fetch: answer(401) })).kind, 'auth') },
    { name: '404 → status', run: async () => assert.equal((await testProviderConnection('openai', { fetch: answer(404) })).kind, 'status') },
    { name: 'refused → unreachable', run: async () => {
      const r = await testProviderConnection('openai', { fetch: async () => { throw new TypeError('fetch failed'); } });
      assert.equal(r.kind, 'unreachable'); assert.match(r.message, /endpoint unreachable/);
    } },
    { name: 'timeoutMs aborts → timeout', run: async () => {
      // AbortSignal.timeout never holds the event loop open; a real fetch's socket does, so the fake holds a timer.
      const hang = (_u, { signal }) => new Promise((_r, rej) => {
        const held = setInterval(() => {}, 1000);
        signal.addEventListener('abort', () => { clearInterval(held); rej(signal.reason); }, { once: true });
      });
      const r = await testProviderConnection('openai', { fetch: hang, timeoutMs: 30 });
      assert.equal(r.kind, 'timeout');
    } },
    { name: 'copilot not signed in → config', run: async () => assert.equal((await testProviderConnection('copilot', {})).kind, 'config') },
    { name: 'ok stays ok', run: async () => assert.equal((await testProviderConnection('openai', { fetch: answer(200) })).ok, true) },
  ]);
});
