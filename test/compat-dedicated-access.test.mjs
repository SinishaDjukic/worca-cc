// test/compat-dedicated-access.test.mjs
// A dedicated deployment behind Cloudflare Access (worca-01 style, docs/deploy-railway.md) keeps
// working exactly as before the hosted-platform changes (W1–W7, B1–B4): it sets only the
// variables below, and none of the platform's opt-ins (WORCA_IDENTITY_ISSUER, WORCA_HEARTBEAT_*,
// WORCA_AWAY_PER_PERSON) switch on by themselves. Resuming the runs a restart's drain paused is a
// default (runs redesign Known bug 11) that a dedicated deployment also gets; WORCA_AUTO_RESUME=0
// turns it off. Any other change that alters this deployment's behaviour must fail here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';
import { readRemoteAccessConfig, checkRemoteAccessConfig } from '../src/core/remote-access.mjs';

useTempHome(after);

const PUBLIC = 'worca-01.example.com';
// The dedicated deployment's remote-access variables: a suffix entry is allowed there (W2 applies
// only with an issuer).
const DEDICATED_ENV = {
  WORCA_MOCK: '1',
  WORCA_ALLOWED_HOSTS: `${PUBLIC},.internal.example.com`,
  WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM,
  WORCA_CF_ACCESS_AUD: AUD,
};
const PLATFORM_VARS = ['WORCA_IDENTITY_ISSUER', 'WORCA_IDENTITY_JWKS_URL', 'WORCA_IDENTITY_AUDIENCE', 'WORCA_HEARTBEAT_URL', 'WORCA_HEARTBEAT_TOKEN', 'WORCA_AUTO_RESUME', 'WORCA_AWAY_PER_PERSON'];

const key = makeAccessKey();
const fakeCerts = certsFetch({ keys: [key] });
const realFetch = globalThis.fetch;
const outbound = [];
let srv, port, mod;

before(async () => {
  for (const k of PLATFORM_VARS) delete process.env[k];
  Object.assign(process.env, DEDICATED_ENV);
  globalThis.fetch = (url, opts) => {
    outbound.push(String(url));
    return String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts);
  };
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  for (const k of Object.keys(DEDICATED_ENV)) delete process.env[k];
});

function get(path, headers = {}) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, headers: { host: PUBLIC, ...headers } }, (resp) => {
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: body ? JSON.parse(body) : null }));
    });
    r.on('error', rej);
    r.end();
  });
}
const withToken = (claims) => ({ 'cf-access-jwt-assertion': signAccessJwt(key, claims) });

test('the config is valid with no errors or warnings, and the identity check is Cloudflare Access', () => {
  const cfg = readRemoteAccessConfig(DEDICATED_ENV);
  assert.deepEqual(checkRemoteAccessConfig(cfg, { bindHost: '::' }), { errors: [], warnings: [] });
  assert.equal(cfg.identity.provider, 'cloudflare-access');
  assert.equal(cfg.conflictingIdentity, false);
});

test('Access tokens work as before; the 401 hint still names Cloudflare Access', async () => {
  const r = await get('/api/projects');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'unauthorized: sign in through the identity proxy (Cloudflare Access)');
  assert.equal((await get('/api/projects', { ...withToken(), origin: `https://${PUBLIC}` })).status, 200);
});

test('a platform identity header means nothing here', async () => {
  assert.equal((await get('/api/projects', { 'x-worca-identity': signAccessJwt(key) })).status, 401);
});

test('suffix entries in WORCA_ALLOWED_HOSTS keep working', async () => {
  assert.equal((await get('/api/projects', { ...withToken(), host: 'box.internal.example.com' })).status, 200);
});

test('a WebSocket opened with a short-lived Access token is NOT closed at its expiry (W7 is issuer-only)', async () => {
  const exp = Math.floor(Date.now() / 1000) + 1;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: PUBLIC, origin: `https://${PUBLIC}`, ...withToken({ exp }) } });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let closed = null;
  ws.on('close', (c) => { closed = c; });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(closed, null, 'still open after the token expired');
  ws.close();
});

test('nothing is sent anywhere but the Access certs endpoint (no heartbeat)', () => {
  assert.deepEqual([...new Set(outbound)].filter((u) => u !== CERTS_URL), []);
});
