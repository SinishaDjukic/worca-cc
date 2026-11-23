// test/api-frame-check-remote.test.mjs — the frame check on a hosted (remote) Worca follows the chat's web policy
// (issue 1064 §3). A separate file because REMOTE_MODE is fixed when ui/server.mjs is imported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, srv, port, chat;

function remote(method, path, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey),
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: text ? JSON.parse(text) : null }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-framecheck-remote-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_MOCK: '1', WORCA_ALLOWED_HOSTS: PUBLIC,
    WORCA_CF_ACCESS_TEAM_DOMAIN: TEAM, WORCA_CF_ACCESS_AUD: AUD });
  _resetForTests();
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  const askStore = await import('../src/core/ask/store.mjs');
  chat = askStore.createThread({ title: 'web off' }).id;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(homeDir, { recursive: true, force: true });
});

test('hosted: no chat = web off, nothing is asked', async () => {
  const r = await remote('POST', '/api/tools/frame-check', { url: 'https://example.org/' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { framable: null, reason: 'web-off' });
});

test('hosted: a visible chat whose web access is off answers web-off too', async () => {
  const r = await remote('POST', '/api/tools/frame-check', { url: 'https://example.org/', threadId: chat });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { framable: null, reason: 'web-off' });
});

test('extra: web on — the chat\'s allowlist applies; someone else\'s chat is web off', async () => {
  const askStore = await import('../src/core/ask/store.mjs');
  const s = await remote('POST', '/api/settings', { askWeb: { enabled: true, allowedDomains: ['docs.example.com'] } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const mine = askStore.createThread({ title: 'mine', createdBy: 'me@example.com' }).id;
  const theirs = askStore.createThread({ title: 'theirs', createdBy: 'alice@x.test' }).id;
  assert.deepEqual((await remote('POST', '/api/tools/frame-check', { url: 'https://example.org/', threadId: mine })).body, { framable: null, reason: 'not-allowlisted' });
  assert.deepEqual((await remote('POST', '/api/tools/frame-check', { url: 'https://example.org/', threadId: theirs })).body, { framable: null, reason: 'web-off' });
});
