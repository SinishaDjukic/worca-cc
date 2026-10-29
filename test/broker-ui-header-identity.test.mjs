// test/broker-ui-header-identity.test.mjs
// The key page with header identity (WORCA_IDENTITY_HEADER): the header is believed only
// from the identity proxy's own address (WORCA_IDENTITY_TRUSTED_PROXIES), never from any
// other peer on the compose/private network, and the CSRF token is one the broker issued
// to that person, not any cookie/header pair a script makes up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { openStore } from '../src/broker/store.mjs';
import { createBrokerService } from '../src/broker/service.mjs';
import { createUiHandler } from '../src/broker/ui-server.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const PUBLIC = 'https://keys.example.com';
const ENV = {
  WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 's'.repeat(40), WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'),
  WORCA_BROKER_PUBLIC_URL: PUBLIC, WORCA_IDENTITY_HEADER: 'X-Forwarded-Email',
};
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

async function start(trusted) {
  const up = await startFakeUpstream();
  const { config, errors } = readBrokerConfig({ ...ENV, WORCA_IDENTITY_TRUSTED_PROXIES: trusted });
  assert.deepEqual(errors, []);
  const store = openStore();
  const service = createBrokerService({ config, slots: mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: up.url }]), store });
  const server = http.createServer(createUiHandler({ config, service, store }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  closers.push(async () => { server.close(); await up.close(); store.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, service };
}

test('multi mode with an identity header needs the proxy addresses it may come from', () => {
  const missing = readBrokerConfig(ENV).errors;
  assert.ok(missing.some((e) => /WORCA_IDENTITY_TRUSTED_PROXIES/.test(e)), missing.join('\n'));
  const bad = readBrokerConfig({ ...ENV, WORCA_IDENTITY_TRUSTED_PROXIES: '10.0.0.0/40, proxy' }).errors;
  assert.ok(bad.some((e) => /WORCA_IDENTITY_TRUSTED_PROXIES/.test(e) && /10\.0\.0\.0\/40/.test(e)), bad.join('\n'));
  const ok = readBrokerConfig({ ...ENV, WORCA_IDENTITY_TRUSTED_PROXIES: '172.30.0.10, 10.8.0.0/16 fd00::/8' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.identity, { kind: 'header', header: 'x-forwarded-email', trustedProxies: ['172.30.0.10', '10.8.0.0/16', 'fd00::/8'] });
  // Single mode has no key page: the header is unused there, so nothing to require.
  assert.deepEqual(readBrokerConfig({ ...ENV, WORCA_BROKER_MODE: 'single', WORCA_BROKER_VAULT_KEY: '' }).errors, []);
});

test('the identity header from a peer that is not the trusted proxy is refused, and nothing changes', async () => {
  const { base, service } = await start('10.99.0.7');          // the test client is 127.0.0.1
  const me = await fetch(`${base}/api/me`, { headers: { 'x-forwarded-email': 'victim@acme.dev' } });
  assert.equal(me.status, 403);
  assert.match((await me.json()).error, /trusted proxy/);
  const put = await fetch(`${base}/api/slots/anthropic`, {
    method: 'PUT',
    headers: { 'x-forwarded-email': 'victim@acme.dev', origin: PUBLIC, cookie: `__Host-wb_csrf=${'a'.repeat(43)}`, 'x-worca-csrf': 'a'.repeat(43), 'content-type': 'application/json' },
    body: JSON.stringify({ secret: GOOD_KEY }),
  });
  assert.equal(put.status, 403);
  assert.equal(service.slotStatus('victim@acme.dev').find((s) => s.id === 'anthropic').state, 'missing');
  assert.equal((await fetch(`${base}/healthz`)).status, 200, 'the health check needs no identity');
});

test('from the trusted proxy the page works, but only with a CSRF token the broker issued to that person', async () => {
  const { base, service } = await start('127.0.0.1');
  const as = (email) => ({ 'x-forwarded-email': email, origin: PUBLIC, 'content-type': 'application/json' });
  const res = await fetch(`${base}/api/me`, { headers: { 'x-forwarded-email': 'ada@acme.dev' } });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const { csrf } = await res.json();
  const put = (headers) => fetch(`${base}/api/slots/anthropic`, { method: 'PUT', headers, body: JSON.stringify({ secret: GOOD_KEY }) });

  // A pair a script made up matches itself, but the broker never issued it.
  const forged = 'a'.repeat(43);
  assert.equal((await put({ ...as('ada@acme.dev'), cookie: `__Host-wb_csrf=${forged}`, 'x-worca-csrf': forged })).status, 403);
  // Ada's token does not act for Bob.
  assert.equal((await put({ ...as('bob@acme.dev'), cookie, 'x-worca-csrf': csrf })).status, 403);
  assert.equal(service.slotStatus('bob@acme.dev').find((s) => s.id === 'anthropic').state, 'missing');
  // Ada's own, from her page.
  assert.equal((await put({ ...as('ada@acme.dev'), cookie, 'x-worca-csrf': csrf })).status, 200);

  // /api/me keeps a still-valid token, and replaces one issued to someone else.
  const again = await fetch(`${base}/api/me`, { headers: { 'x-forwarded-email': 'ada@acme.dev', cookie } });
  assert.equal((await again.json()).csrf, csrf);
  const bob = await (await fetch(`${base}/api/me`, { headers: { 'x-forwarded-email': 'bob@acme.dev', cookie } })).json();
  assert.notEqual(bob.csrf, csrf);
});
