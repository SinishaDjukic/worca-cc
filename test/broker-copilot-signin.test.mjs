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
import { isCopilotHost, copilotHostCheck, createCopilotExchange, startDeviceFlow } from '../src/broker/copilot.mjs';

const PUBLIC = 'http://localhost:7071';
const GH = 'gho_approvedsignin000000000000000000000001';
let gh; let ghUrl; let server; let base; let store;
let approved = false;
const REFUSED = 'gho_refusedsignin00000000000000000000009';
let approvedToken = GH;
let polls = 0;

before(async () => {
  gh = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/login/device/code') return json(200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
      if (req.url === '/login/oauth/access_token') { polls++; return json(200, approved ? { access_token: approvedToken } : { error: 'authorization_pending' }); }
      if (req.url === '/copilot_internal/v2/token') {
        if (req.headers.authorization === `token ${REFUSED}`) return json(403, { message: 'Forbidden', error_details: { message: 'Copilot is not enabled for your account', url: 'https://github.com/settings/copilot' } });
        return req.headers.authorization === `token ${GH}` ? json(200, { token: 'cp-1', expires_at: Math.floor(Date.now() / 1000) + 1800 }) : json(401, { message: 'Bad credentials' });
      }
      json(404, {});
    });
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  ghUrl = `http://127.0.0.1:${gh.address().port}`;
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 's'.repeat(40), WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'),
    WORCA_BROKER_PUBLIC_URL: PUBLIC, WORCA_IDENTITY_HEADER: 'x-email', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1',
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

async function session(email = 'ada@acme.dev') {
  const me = await fetch(`${base}/api/me`, { headers: { 'x-email': email } });
  const body = await me.json();
  const cookie = me.headers.get('set-cookie').split(';')[0];
  return { body, post: (p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-email': email, origin: PUBLIC, cookie, 'x-worca-csrf': body.csrf, 'content-type': 'application/json' } }) };
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

test('a GHE.com slot trusts only its own tenant\'s gateway; without a tenant the check is today\'s isCopilotHost', () => {
  const t = copilotHostCheck('acme.ghe.com');
  assert.equal(t('https://copilot-api.acme.ghe.com'), true);
  assert.equal(t('https://api.githubcopilot.com'), true);
  for (const bad of ['https://copilot-api.other.ghe.com', 'https://acme.ghe.com.evil.example', 'http://copilot-api.acme.ghe.com', 'https://copilot-api.acme.ghe.com:8443', 'https://u@copilot-api.acme.ghe.com', 'https://evilacme.ghe.com']) {
    assert.equal(t(bad), false, bad);
  }
  for (const none of [null, undefined, '']) {
    const c = copilotHostCheck(none);
    assert.equal(c('https://copilot-api.acme.ghe.com'), false);
    assert.equal(c('https://api.githubcopilot.com'), true);
    assert.equal(c('https://githubcopilot.com.evil.example'), false);
  }
});

test('exchange on a tenant slot: endpoints.api on the tenant is used; an untrusted one falls back to slot.upstream', async () => {
  const run = async (api) => {
    const urls = [];
    const ex = createCopilotExchange({
      exchangeUrl: 'https://api.acme.ghe.com/copilot_internal/v2/token', defaultHost: 'https://copilot-api.acme.ghe.com',
      allowHost: copilotHostCheck('acme.ghe.com'),
      fetchImpl: async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ token: 't', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api } }) }; },
    });
    return { urls, t: await ex.token('gho_x') };
  };
  const own = await run('https://proxy.acme.ghe.com/');
  assert.equal(own.t.host, 'https://proxy.acme.ghe.com');
  assert.deepEqual(own.urls, ['https://api.acme.ghe.com/copilot_internal/v2/token']);
  assert.equal((await run('https://evil.example')).t.host, 'https://copilot-api.acme.ghe.com');
  assert.equal((await run('https://copilot-api.other.ghe.com')).t.host, 'https://copilot-api.acme.ghe.com');
});

test('device flow fallback verificationUri follows baseUrl', async () => {
  const f = async () => ({ ok: true, status: 200, json: async () => ({ device_code: 'd', user_code: 'U' }) });
  assert.equal((await startDeviceFlow({ fetchImpl: f })).verificationUri, 'https://github.com/login/device');
  assert.equal((await startDeviceFlow({ fetchImpl: f, baseUrl: 'https://acme.ghe.com' })).verificationUri, 'https://acme.ghe.com/login/device');
});

test('mismatched tenants in exchangeUrl and deviceBaseUrl are refused; one tenant, or one URL alone, is fine', () => {
  const slot = (o) => [{ id: 'copilot', upstream: 'https://copilot-api.acme.ghe.com', ...o }];
  assert.throws(() => mergeSlots(builtinSlots(), slot({ exchangeUrl: 'https://api.acme.ghe.com/copilot_internal/v2/token', deviceBaseUrl: 'https://other.ghe.com' })),
    /exchangeUrl and deviceBaseUrl name different GHE\.com tenants/);
  const ok = mergeSlots(builtinSlots(), slot({ exchangeUrl: 'https://api.acme.ghe.com/copilot_internal/v2/token', deviceBaseUrl: 'https://acme.ghe.com' }));
  assert.equal(ok.find((x) => x.id === 'copilot').deviceBaseUrl, 'https://acme.ghe.com');
  mergeSlots(builtinSlots(), slot({ exchangeUrl: 'https://api.acme.ghe.com/copilot_internal/v2/token' }));
  mergeSlots(builtinSlots(), slot({ exchangeUrl: 'https://api.github.com/copilot_internal/v2/token', deviceBaseUrl: 'https://acme.ghe.com' }));
});

// ── GitHub's refusal of the exchange ─────────────────────────────────────────

const refusal = (status, body, headers = {}) => async () => ({
  ok: false, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: new Map(Object.entries(headers)),
});
const TENANT_EXCHANGE = 'https://api.acme.ghe.com/copilot_internal/v2/token';
const WITH_REASON = { message: 'Forbidden', error_details: { message: 'No Copilot seat', url: 'https://acme.ghe.com/settings/copilot' } };

test('exchange refusal: sign-in and token phases name the host and GitHub\'s reason; the stored phase keeps today\'s text (reason appended)', async () => {
  const mk = (res) => createCopilotExchange({ exchangeUrl: TENANT_EXCHANGE, fetchImpl: res, log: () => {} });
  for (const phase of ['sign-in', 'token']) {
    await assert.rejects(mk(refusal(403, WITH_REASON)).token('gho_x', { phase }), (e) => {
      assert.equal(e.status, 403); assert.equal(e.code, 'AUTH'); assert.equal(e.host, 'acme.ghe.com');
      assert.match(e.message, /acme\.ghe\.com/);
      assert.match(e.message, /GitHub says: "No Copilot seat" \(https:\/\/acme\.ghe\.com\/settings\/copilot\)/);
      assert.doesNotMatch(e.message, /stored token|sign in again/i);
      if (phase === 'token') assert.match(e.message, /for this token on/);
      return true;
    }, phase);
  }
  await assert.rejects(mk(refusal(401, '')).token('gho_x'), (e) => e.message === 'GitHub refused the sign-in (401): sign in to Copilot again' && e.status === 401);
  await assert.rejects(mk(refusal(403, WITH_REASON)).token('gho_x'), (e) => e.message.startsWith('GitHub refused the sign-in (403): sign in to Copilot again') && /GitHub says: "No Copilot seat"/.test(e.message));
  await assert.rejects(mk(refusal(500, '')).token('gho_x', { phase: 'sign-in' }), /HTTP 500/);
  await assert.rejects(createCopilotExchange({ fetchImpl: refusal(401, '') }).token('gho_x', { phase: 'sign-in' }), (e) => e.host === 'github.com' && /github\.com/.test(e.message));
});

test('exchange refusal log: status, URL and GitHub\'s message; never the GitHub token', async () => {
  const lines = [];
  const ex = createCopilotExchange({ exchangeUrl: TENANT_EXCHANGE, log: (l) => lines.push(l), fetchImpl: refusal(403, { message: 'Seat missing for gho_secretvalue0000000000000000' }) });
  await ex.token('gho_secretvalue0000000000000000', { phase: 'sign-in' }).catch(() => {});
  assert.equal(lines.length, 1);
  assert.match(lines[0], /403/);
  assert.ok(lines[0].includes(TENANT_EXCHANGE));
  assert.match(lines[0], /Seat missing/);
  assert.ok(!lines[0].includes('gho_secretvalue'), lines[0]);
  const bare = [];
  await createCopilotExchange({ exchangeUrl: TENANT_EXCHANGE, log: (l) => bare.push(l), fetchImpl: refusal(401, '') }).token('gho_y').catch(() => {});
  assert.match(bare[0], /answered 401: no reason/);
});

test('device sign-in refused by Copilot: the key page shows GitHub\'s reason, never "sign in again", and nothing is sealed', async () => {
  const email = 'bob@acme.dev';
  const { post } = await session(email);
  approved = true; approvedToken = REFUSED;
  try {
    assert.equal((await post('/api/slots/copilot/device')).status, 200);
    const res = await post('/api/slots/copilot/device/poll');
    assert.equal(res.status, 422);
    const { error } = await res.json();
    assert.match(error, /GitHub Copilot was not accepted|Copilot.*was not accepted/i);
    assert.match(error, /the sign-in on github\.com worked/);
    assert.match(error, /GitHub says: "Copilot is not enabled for your account" \(https:\/\/github\.com\/settings\/copilot\)/);
    assert.doesNotMatch(error, /stored token|sign in again|sign in to Copilot again/i);
  } finally { approvedToken = GH; }
  assert.equal(store.getCredential(email, 'copilot') ?? null, null);
  const me = await (await fetch(`${base}/api/me`, { headers: { 'x-email': email } })).json();
  assert.equal(me.slots.find((x) => x.id === 'copilot').state, 'missing');
});
