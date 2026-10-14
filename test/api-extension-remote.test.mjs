// test/api-extension-remote.test.mjs
// ui/server.mjs with remote access ON: the browser extension is refused, S1 and the identity check are unchanged.
// Its own file because the remote config is read at import. Setup as test/api-remote-access.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { useTempHome } from './helpers/temp-home.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, certsFetch } from './helpers/access-jwt.mjs';

useTempHome(after);

const PUBLIC = 'worca-01.example.com';
const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
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
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  for (const k of ['WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD']) delete process.env[k];
});

/** method + path + headers → { status, headers, body }. Host defaults to PUBLIC (the remote host). */
function call(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: PUBLIC, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, body }); });
    });
    r.on('error', reject);
    r.end();
  });
}

test('remote mode, loopback Host: pairing is refused with extension-remote-mode (and the refusal is readable)', async () => {
  const r = await call('POST', '/api/extension/pair', { host: `127.0.0.1:${port}`, origin: CHROME });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'extension-remote-mode');
  assert.equal(r.headers['access-control-allow-origin'], CHROME);   // the gate answered, not S1
});

test('remote mode, public Host: an extension origin meets S1 exactly as before', async () => {
  const r = await call('GET', '/api/projects', { origin: CHROME });   // host: PUBLIC
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'forbidden: host not allowed (see WORCA_ALLOWED_HOSTS)');
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('remote mode, loopback Host: a token route is refused too, before any token check', async () => {
  const r = await call('GET', '/api/ask/threads', { host: `127.0.0.1:${port}`, origin: CHROME, authorization: 'Bearer wex_anything' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'extension-remote-mode');   // decideExtensionRequest checks remoteMode before the route kind
});
