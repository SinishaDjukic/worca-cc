// test/api-remote-access.test.mjs
// ui/server.mjs with remote access ON (WORCA_ALLOWED_HOSTS + Cloudflare Access):
// the Host allowlist, the identity middleware, the WebSocket upgrade check, the
// trimmed /api/health and the in-container exemption. The certs endpoint is a
// patched global fetch (the verifier is built at import, with the default
// fetchImpl), so no network. Requests that must look remote carry the public
// Host; http.request is used because fetch() drops a caller-set Host header.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

useTempHome(after);

const PUBLIC = 'worca-01.example.com';
const key = makeAccessKey();
const keysRef = { keys: [key] };
const fakeCerts = certsFetch(keysRef);
const realFetch = globalThis.fetch;
let srv, port;

before(async () => {
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  const mod = await import('../ui/server.mjs');
  srv = mod.server; // the module's server carries the /ws upgrade handler
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  for (const k of ['WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD']) delete process.env[k];
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

test('no token from the public host -> 401 with a sign-in hint', async () => {
  const r = await get('/api/projects');
  assert.equal(r.status, 401);
  assert.match(r.body.error, /^unauthorized: sign in through/);
});

test('a valid Access token from the public host passes', async () => {
  const r = await get('/api/projects', { ...withToken(), origin: `https://${PUBLIC}` });
  assert.equal(r.status, 200);
});

test('invalid tokens are refused: other app, expired, tampered', async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await get('/api/projects', withToken({ aud: ['aud-worca-02'] }))).status, 401);
  assert.equal((await get('/api/projects', withToken({ exp: now - 300 }))).status, 401);
  const [h, p] = signAccessJwt(key).split('.');
  assert.equal((await get('/api/projects', { 'cf-access-jwt-assertion': `${h}.${p}.AAAA` })).status, 401);
});

test('a host outside the allowlist is 403 before any token check, naming the setting', async () => {
  const r = await get('/api/projects', { ...withToken(), host: 'worca-02.example.com' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden: host not allowed (see WORCA_ALLOWED_HOSTS)');
  const o = await get('/api/projects', { ...withToken(), origin: 'https://evil.net' });
  assert.equal(o.status, 403, 'cross-site Origin with a valid cookie-borne token is still refused');
});

test('/api/health answers remotely without a token, with name + version only', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['name', 'version']);
});

test('in-container callers (loopback peer + loopback Host) are exempt and see the full health', async () => {
  const projects = await realFetch(`http://127.0.0.1:${port}/api/projects`);
  assert.equal(projects.status, 200);
  const health = await (await realFetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(health.pid, process.pid);
});

function wsOutcome(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, resp) => { resolve(resp.statusCode); resp.resume(); });
    ws.on('error', () => resolve('error'));
  });
}

test('WebSocket upgrade: token required from the public host, refused otherwise', async () => {
  const origin = `https://${PUBLIC}`;
  assert.equal(await wsOutcome({ host: PUBLIC, origin }), 401);
  assert.equal(await wsOutcome({ host: PUBLIC, origin, ...withToken() }), 'open');
  assert.equal(await wsOutcome({ host: PUBLIC, origin, ...withToken({ aud: 'other' }) }), 401);
  assert.equal(await wsOutcome({ host: 'evil.net', ...withToken() }), 403);
  assert.equal(await wsOutcome({ host: '127.0.0.1', origin: 'http://127.0.0.1' }), 'open', 'in-container');
});
