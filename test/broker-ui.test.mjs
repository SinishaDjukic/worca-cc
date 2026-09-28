// test/broker-ui.test.mjs
// The key page in multi mode (plans/credential-broker-design.html §7.1, §8.2): the
// broker verifies the Access token itself, keys are verified before they are stored
// and never read back, each person sees only their own rows, and a state-changing
// request must come from the key page (Origin + CSRF).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { openStore } from '../src/broker/store.mjs';
import { createBrokerService } from '../src/broker/service.mjs';
import { createUiHandler, createIdentity, CSP } from '../src/broker/ui-server.mjs';
import { mintToken, parseMintRequest } from '../src/broker/tokens.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';
import { makeAccessKey, signAccessJwt, certsFetch, TEAM } from './helpers/access-jwt.mjs';

const PUBLIC = 'https://worca-01-keys.example.com';
const KEYS_AUD = 'aud-keys-app';
let up; let server; let base; let store; let service; let config;
const key = makeAccessKey();

before(async () => {
  up = await startFakeUpstream();
  ({ config } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 's'.repeat(40), WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'),
    WORCA_BROKER_PUBLIC_URL: PUBLIC, WORCA_BROKER_RETURN_URL: 'https://worca-01.example.com',
    WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: KEYS_AUD, WORCA_BROKER_DEFAULT_DAILY_USD: '50',
  }));
  const slots = mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: up.url }]);
  store = openStore();
  service = createBrokerService({ config, slots, store });
  const identity = createIdentity(config, { fetchImpl: certsFetch({ keys: [key] }) });
  server = http.createServer(createUiHandler({ config, service, store, identity }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await up?.close(); store?.close(); });

const jwt = (email, aud = KEYS_AUD) => signAccessJwt(key, { email, aud: [aud] });

async function session(email) {
  const res = await fetch(`${base}/api/me`, { headers: { 'cf-access-jwt-assertion': jwt(email) } });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const me = await res.json();
  const call = (method, path, body, { origin = PUBLIC, csrf = me.csrf, withCookie = true } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
      'cf-access-jwt-assertion': jwt(email), 'content-type': 'application/json',
      ...(origin ? { origin } : {}), ...(csrf ? { 'x-worca-csrf': csrf } : {}), ...(withCookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { me, call };
}

test('no token, a token for another application, or a bad signature: 401; healthz stays open', async () => {
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/me`, { headers: { 'cf-access-jwt-assertion': jwt('ada@acme.dev', 'aud-worca-app') } })).status, 401);
  assert.equal((await fetch(`${base}/`, { headers: { 'cf-access-jwt-assertion': `${jwt('ada@acme.dev')}x` } })).status, 401);
  assert.equal((await fetch(`${base}/healthz`, { headers: { host: 'healthcheck.railway.app' } })).status, 200);
});

test('the page is served with a strict CSP and no framing', async () => {
  const res = await fetch(`${base}/`, { headers: { 'cf-access-jwt-assertion': jwt('ada@acme.dev') } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-security-policy'), CSP);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /Your model credentials/);
});

test('save verifies with the provider first: a bad key is refused and nothing is stored', async () => {
  const { call } = await session('ada@acme.dev');
  const res = await call('PUT', '/api/slots/anthropic', { secret: 'sk-ant-wrong-key-000000000' });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /not accepted: 401/);
  assert.equal(store.getCredential('ada@acme.dev', 'anthropic'), null);
});

test('a good key is stored encrypted, shown only as its last 4 characters, and never read back', async () => {
  const { call } = await session('ada@acme.dev');
  const res = await call('PUT', '/api/slots/anthropic', { secret: GOOD_KEY });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: 'set', suffix: GOOD_KEY.slice(-4), kind: 'api-key' });
  const row = store.getCredential('ada@acme.dev', 'anthropic');
  assert.ok(!Buffer.from(row.ciphertext).toString('latin1').includes(GOOD_KEY));
  const me = await (await fetch(`${base}/api/me`, { headers: { 'cf-access-jwt-assertion': jwt('ada@acme.dev') } })).json();
  const slot = me.slots.find((s) => s.id === 'anthropic');
  assert.equal(slot.state, 'set');
  assert.ok(!JSON.stringify(me).includes(GOOD_KEY));
  // Test re-verifies the stored key.
  assert.equal((await call('POST', '/api/slots/anthropic/test')).status, 200);
});

test('each person sees and changes only their own credentials', async () => {
  const bob = await session('bob@acme.dev');
  assert.equal(bob.me.slots.find((s) => s.id === 'anthropic').state, 'missing');
  await bob.call('DELETE', '/api/slots/anthropic');
  assert.ok(store.getCredential('ada@acme.dev', 'anthropic'), 'Bob deleting "his" key leaves Ada\'s alone');
});

test('a spawn billed to Ada uses Ada\'s key; one billed to Bob gets a clear "no key" error', async () => {
  const mk = (billTo, spawnId) => mintToken(store, parseMintRequest({ billTo, slots: ['anthropic'], spawnId, kind: 'aux', issuer: 'srv' }, { slotIds: ['anthropic'], maxTtlMs: 1e9 }).req).token;
  const privateServer = http.createServer((req, res) => service.handlePrivate(req, res));
  await new Promise((r) => privateServer.listen(0, '127.0.0.1', r));
  const pbase = `http://127.0.0.1:${privateServer.address().port}`;
  try {
    up.requests.length = 0;
    const ada = await fetch(`${pbase}/p/anthropic/v1/models`, { headers: { 'x-api-key': mk('ada@acme.dev', 'sp-ada') } });
    assert.equal(ada.status, 200);
    assert.equal(up.requests.at(-1).headers['x-api-key'], GOOD_KEY);
    const bob = await fetch(`${pbase}/p/anthropic/v1/models`, { headers: { 'x-api-key': mk('bob@acme.dev', 'sp-bob') } });
    assert.equal(bob.status, 403, 'a 403, not a 401: the CLI retries a 401 for minutes');
    assert.match((await bob.json()).error.message, new RegExp(`no Anthropic API key or Claude subscription for bob@acme\\.dev\\. Add one at ${PUBLIC.replace(/\./g, '\\.')}`));
  } finally {
    privateServer.closeAllConnections?.();
    privateServer.close();
  }
});

test('state changes need the key page\'s Origin and the CSRF token that /api/me issued', async () => {
  const { call } = await session('ada@acme.dev');
  assert.equal((await call('DELETE', '/api/slots/anthropic', undefined, { origin: 'https://worca-01.example.com' })).status, 403, 'a sibling site cannot delete a key');
  assert.equal((await call('DELETE', '/api/slots/anthropic', undefined, { origin: null })).status, 403);
  assert.equal((await call('DELETE', '/api/slots/anthropic', undefined, { csrf: 'x'.repeat(43) })).status, 403);
  assert.equal((await call('DELETE', '/api/slots/anthropic', undefined, { withCookie: false })).status, 403);
  assert.ok(store.getCredential('ada@acme.dev', 'anthropic'), 'still there');
});

test('personal caps may not exceed the team default', async () => {
  const { call } = await session('ada@acme.dev');
  assert.equal((await call('PUT', '/api/budget/anthropic', { dailyUsd: 80 })).status, 422);
  const ok = await call('PUT', '/api/budget/anthropic', { dailyUsd: 20, monthlyUsd: '' });
  assert.equal(ok.status, 200);
  assert.equal(store.getCredential('ada@acme.dev', 'anthropic').daily_usd, 20);
});

test('delete removes the key; the next proxied request says so', async () => {
  const { call } = await session('ada@acme.dev');
  assert.equal((await call('DELETE', '/api/slots/anthropic')).status, 200);
  assert.equal(store.getCredential('ada@acme.dev', 'anthropic'), null);
  assert.equal(service.resolveCredential('ada@acme.dev', service.slotById.get('anthropic')).missing, true);
});
