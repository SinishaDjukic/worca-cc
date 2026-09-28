// test/broker-copilot-signin.test.mjs
// GitHub Copilot sign-in on the key page (plans/credential-broker-design.html §5.6): the
// broker runs GitHub's device flow, proves the account has Copilot with a token exchange,
// then seals the GitHub token. The page only ever sees the user code. A fake GitHub
// stands in for github.com and api.github.com.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { openStore } from '../src/broker/store.mjs';
import { createBrokerService } from '../src/broker/service.mjs';
import { createUiHandler } from '../src/broker/ui-server.mjs';
import { isCopilotHost } from '../src/broker/copilot.mjs';

const PUBLIC = 'http://localhost:7071';
const GH = 'gho_approvedsignin000000000000000000000001';
let gh; let ghUrl; let server; let base; let store;
let approved = false;
let polls = 0;

before(async () => {
  gh = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/login/device/code') return json(200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
      if (req.url === '/login/oauth/access_token') { polls++; return json(200, approved ? { access_token: GH } : { error: 'authorization_pending' }); }
      if (req.url === '/copilot_internal/v2/token') {
        return req.headers.authorization === `token ${GH}` ? json(200, { token: 'cp-1', expires_at: Math.floor(Date.now() / 1000) + 1800 }) : json(401, { message: 'Bad credentials' });
      }
      json(404, {});
    });
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  ghUrl = `http://127.0.0.1:${gh.address().port}`;
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 's'.repeat(40), WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'),
    WORCA_BROKER_PUBLIC_URL: PUBLIC, WORCA_IDENTITY_HEADER: 'x-email',
  });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots(), [{ id: 'copilot', upstream: ghUrl, exchangeUrl: `${ghUrl}/copilot_internal/v2/token`, deviceBaseUrl: ghUrl }]);
  store = openStore();
  const service = createBrokerService({ config, slots, store });
  server = http.createServer(createUiHandler({ config, service, store }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); gh?.close(); store?.close(); });

async function session() {
  const me = await fetch(`${base}/api/me`, { headers: { 'x-email': 'ada@acme.dev' } });
  const body = await me.json();
  const cookie = me.headers.get('set-cookie').split(';')[0];
  return { body, post: (p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-email': 'ada@acme.dev', origin: PUBLIC, cookie, 'x-worca-csrf': body.csrf, 'content-type': 'application/json' } }) };
}

test('the Copilot row offers a GitHub sign-in, not a key field', async () => {
  const { body } = await session();
  const cp = body.slots.find((s) => s.id === 'copilot');
  assert.equal(cp.signIn, 'github-device');
  assert.equal(cp.state, 'missing');
});

test('device flow: code shown, pending while unapproved, then the sign-in is verified and sealed', async () => {
  const { post } = await session();
  const start = await (await post('/api/slots/copilot/device')).json();
  assert.deepEqual([start.userCode, start.verificationUri], ['ABCD-1234', 'https://github.com/login/device']);
  assert.ok(!JSON.stringify(start).includes('dev-1'), 'the device code stays in the broker');
  assert.deepEqual(await (await post('/api/slots/copilot/device/poll')).json(), { pending: true, slowDown: false });
  approved = true;
  const done = await (await post('/api/slots/copilot/device/poll')).json();
  assert.deepEqual(done, { state: 'set', suffix: GH.slice(-4), kind: 'api-key' });
  const row = store.getCredential('ada@acme.dev', 'copilot');
  assert.ok(row && !Buffer.from(row.ciphertext).toString('latin1').includes(GH));
  assert.equal((await post('/api/slots/copilot/device/poll')).status, 410, 'a finished flow cannot be polled again');
});

test('the device endpoints need the key page\'s CSRF token, and only a sign-in slot has them', async () => {
  const bare = await fetch(`${base}/api/slots/copilot/device`, { method: 'POST', headers: { 'x-email': 'ada@acme.dev', origin: PUBLIC } });
  assert.equal(bare.status, 403);
  const { post } = await session();
  assert.equal((await post('/api/slots/anthropic/device')).status, 404);
});

test('only GitHub\'s own hosts are trusted as the Copilot API', () => {
  assert.equal(isCopilotHost('https://api.githubcopilot.com'), true);
  assert.equal(isCopilotHost('https://api.business.githubcopilot.com'), true);
  assert.equal(isCopilotHost('https://githubcopilot.com.evil.example'), false);
  assert.equal(isCopilotHost('http://api.githubcopilot.com'), false);
});
