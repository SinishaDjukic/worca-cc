// test/providers-broker.test.mjs
// The Providers card's data with the credential broker on (provider-ops.mjs providersState):
// worca's own provider settings hold no key, so each provider reports the slot it spends from
// and the viewer's own state in it on the key page. A fake broker answers /internal/*.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { providersState } from '../src/core/bridge/provider-ops.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';

const SECRET = 'p'.repeat(40);
let server; let url;
let mode = 'multi';
let down = false;
const SLOTS = [
  { id: 'anthropic', auth: 'x-api-key', protocol: 'anthropic', upstream: 'https://api.anthropic.com' },
  { id: 'openai', auth: 'bearer', protocol: 'openai', upstream: 'https://api.openai.com' },
  { id: 'openrouter', auth: 'bearer', protocol: 'openai', upstream: 'https://openrouter.ai' },
  { id: 'copilot', auth: 'copilot', protocol: 'openai', upstream: 'https://api.githubcopilot.com' },
];
const saved = {};
const KEYS = ['WORCA_BROKER_URL', 'WORCA_BROKER_SECRET'];

before(async () => {
  server = http.createServer((req, res) => {
    const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${SECRET}`) return json(401, {});
    if (req.url === '/internal/info') return json(200, { mode, slots: SLOTS, publicUrl: 'https://keys.example.com' });
    if (req.url.startsWith('/internal/people/')) {
      if (down) return json(500, { error: 'store unavailable' });
      const who = decodeURIComponent(req.url.split('/')[3]);
      return json(200, { person: who, slots: who === 'ada@acme.dev'
        ? [{ id: 'openai', state: 'set', suffix: 'bvlA', label: 'OpenAI API key' }, { id: 'copilot', state: 'set', suffix: 'ztYC' }, { id: 'anthropic', state: 'missing' }]
        : [{ id: 'openai', state: 'missing' }, { id: 'copilot', state: 'invalid' }] });
    }
    json(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.WORCA_BROKER_URL = url;
  process.env.WORCA_BROKER_SECRET = SECRET;
  mode = 'multi'; down = false;
  resetBrokerClient();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetBrokerClient();
});

test('each provider names its slot and the viewer\'s own state in it', async () => {
  const s = await providersState({ person: 'ada@acme.dev' });
  assert.equal(s.broker.enabled, true);
  assert.equal(s.broker.keyPage, 'https://keys.example.com');
  assert.deepEqual(s.broker.providers.copilot, { slot: 'copilot', state: 'set', suffix: 'ztYC' });
  // The OpenAI-compatible provider spends from the slot its base URL's origin pins (api.openai.com here).
  assert.deepEqual(s.broker.providers.openai, { slot: 'openai', state: 'set', suffix: 'bvlA', label: 'OpenAI API key' });
  assert.equal(s.broker.providers.anthropic.state, 'missing');
  // worca's own settings still say what they say: no key held here.
  assert.equal(s.openai.configured, false);

  const bob = await providersState({ person: 'bob@acme.dev' });
  assert.equal(bob.broker.providers.openai.state, 'missing');
  assert.equal(bob.broker.providers.copilot.state, 'invalid');
});

test('nobody signed in in multi mode: slots without states, and a sign-in hint', async () => {
  const s = await providersState({ person: null });
  assert.equal(s.broker.signInNeeded, true);
  assert.equal(s.broker.providers.openai.slot, 'openai');
  assert.equal(s.broker.providers.openai.state, undefined);
});

test('single mode reads the one local set; an unreachable key store is reported, never thrown', async () => {
  mode = 'single';
  resetBrokerClient();
  const s = await providersState({ person: null });
  assert.equal(s.broker.signInNeeded, undefined);
  assert.ok(['missing', 'invalid'].includes(s.broker.providers.openai.state));
  down = true;
  const d = await providersState({ person: 'ada@acme.dev' });
  assert.match(d.broker.error, /store unavailable|HTTP 500/);
});

test('broker off: no broker block beyond enabled:false', async () => {
  delete process.env.WORCA_BROKER_URL;
  resetBrokerClient();
  const s = await providersState({ person: 'ada@acme.dev' });
  assert.deepEqual(s.broker, { enabled: false });
});
