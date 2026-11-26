// test/egress-sidecar.test.mjs — the egress sidecar that holds the corporate proxy login (`worca egress`,
// src/egress/main.mjs; #1619): it relays AND logs in to the corporate proxy, its internal API is behind the
// shared secret and write-only, a login is bound to the proxy it was saved for, and an operator's login file
// turns every write off. Real sockets against the fake NTLM proxy; no Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { statSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { startSidecar, echoOrigin, connectVia, until, SECRET } from './helpers/egress-sidecar.mjs';
import { callSidecar } from '../src/core/egress-sidecar-client.mjs';
import { readSidecarConfig } from '../src/egress/main.mjs';

const HASH = 'a4f49c406510bdcab6824ee7c30fd852';   // NT hash of "Password", the fake's password
const LOGIN = { domain: 'Domain', user: 'User', password: 'Password' };
const assertNoSecret = (v) => { const t = JSON.stringify(v); assert.ok(!t.includes(HASH) && !t.includes('Password'), `a secret leaked: ${t}`); };

async function rig({ scheme = 'ntlm', env = {}, creds = '' } = {}) {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ scheme, originPort: origin.port });
  const s = await startSidecar({ HTTPS_PROXY: fake.url(creds), ...env });
  return { origin, fake, s, close: async () => { await s.close(); await fake.close(); await origin.close(); } };
}

test('the sidecar logs in with the saved login: a CONNECT reaches a host only the corporate proxy can reach', async () => {
  const r = await rig();
  try {
    // Before any login the corporate proxy asks for one, and the sidecar says so.
    const before = await connectVia(r.s.proxyPort, 'origin.acme.invalid:443');
    assert.match(before, /^HTTP\/1\.1 407/);
    assert.match(before, /x-worca-proxy: needs-login/i);
    const saved = await r.s.api('POST', '/v1/login', LOGIN);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.state, 'ready');
    assert.equal(saved.body.login.label, 'Domain\\User');
    assert.equal(saved.body.loginBoundTo, `127.0.0.1:${r.fake.port}`);
    assertNoSecret(saved.body);
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    assert.ok(r.fake.stats.type3 >= 1, 'an NTLMv2 Type 3 went to the corporate proxy');
    // The file: the proxy-credentials record and guards, plus the proxy it is bound to.
    const file = join(r.s.dataDir, 'proxy-login.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(rec.ntHash, HASH);
    assert.equal(rec.upstream, `127.0.0.1:${r.fake.port}`);
    assertNoSecret(r.s.logs);
  } finally { await r.close(); }
});

test('plain HTTP goes through the corporate proxy with the login too', async () => {
  const r = await rig();
  try {
    assert.equal((await r.s.api('POST', '/v1/login', LOGIN)).status, 200);
    const body = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: r.s.proxyPort, method: 'GET', path: 'http://intranet.acme.invalid/x', agent: false }, (res) => {
        let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve(`${res.statusCode} ${t}`));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(body, '200 upstream relayed GET http://intranet.acme.invalid/x');
    assert.ok(r.fake.stats.type3 >= 1);
  } finally { await r.close(); }
});

test('a Basic login in the sidecar\'s HTTPS_PROXY (from .env) is used by the sidecar alone', async () => {
  const r = await rig({ scheme: 'basic', creds: 'Domain%5CUser:Password@', env: {} });
  try {
    // auth unset and the URL carries the login: the sidecar falls back to Basic as the URL's clients did.
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    assert.ok(r.fake.stats.basic >= 1);
    const st = await r.s.api('GET', '/v1/status');
    assertNoSecret(st.body);
  } finally { await r.close(); }
});

test('the API: the shared secret, constant answers without it, JSON only, strict fields, write-only', async () => {
  const r = await rig();
  try {
    const url = `http://127.0.0.1:${r.s.apiPort}`;
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/v1/status`)).status, 401);
    assert.equal((await fetch(`${url}/v1/status`, { headers: { authorization: `Bearer ${'x'.repeat(48)}` } })).status, 401);
    assert.equal((await fetch(`${url}/v1/status`, { headers: { authorization: `Bearer ${SECRET}x` } })).status, 401);
    await assert.rejects(callSidecar({ url, secret: 'w'.repeat(48) }, 'GET', '/v1/status'), /refused the shared secret/);
    const auth = { authorization: `Bearer ${SECRET}` };
    assert.equal((await fetch(`${url}/v1/login`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(`${url}/v1/nope`, { headers: auth })).status, 404);
    assert.equal((await r.s.api('POST', '/v1/login', { ...LOGIN, extra: 1 })).status, 400);
    assert.equal((await r.s.api('POST', '/v1/login', { user: 'Domain\\User', ntHash: 'zz' })).status, 400);
    assert.equal((await r.s.api('POST', '/v1/login', { user: 'Domain\\User', password: 'Password', ntHash: HASH })).status, 400);
    assert.equal((await r.s.api('PUT', '/v1/settings', { networkProxy: { fixedPort: 3128 } })).status, 400);
    assert.equal((await r.s.api('PUT', '/v1/settings', { networkProxy: { upstream: 'http://jdoe:pw@proxy.acme.example:8080' } })).status, 400);
    assert.equal((await r.s.api('PUT', '/v1/settings', { networkProxy: { auth: 'kerberos' } })).status, 400);
    // A hash login (a login moved out of a box) works the same and is never shown again.
    const h = await r.s.api('POST', '/v1/login', { user: 'Domain\\User', ntHash: HASH });
    assert.equal(h.status, 200);
    for (const p of ['/v1/status', '/v1/settings']) assertNoSecret((await r.s.api('GET', p)).body);
    const t = await r.s.api('POST', '/v1/test', {});
    assert.equal(t.status, 200);
    assert.equal(t.body.usedSavedLogin, true);
    assertNoSecret(t.body);
    const out = await r.s.api('POST', '/v1/logout', {});
    assert.equal(out.body.deleted, true);
    assert.equal(out.body.login, null);
    assert.equal(existsSync(join(r.s.dataDir, 'proxy-login.json')), false);
  } finally { await r.close(); }
});

test('bound to its proxy: a new host or port deletes the login, and the saved login never goes to a candidate proxy', async () => {
  const r = await rig();
  const other = await startFakeUpstream({ originPort: r.origin.port });
  try {
    assert.equal((await r.s.api('POST', '/v1/login', LOGIN)).status, 200);
    // A test against another proxy: the saved login stays home (no Type 3 there), a typed login may go.
    const t = await r.s.api('POST', '/v1/test', { networkProxy: { upstream: `127.0.0.1:${other.port}` } });
    assert.equal(t.status, 200);
    assert.equal(t.body.usedSavedLogin, false);
    assert.equal(other.stats.type3, 0, 'the saved login never reached the candidate proxy');
    const typed = await r.s.api('POST', '/v1/test', { networkProxy: { upstream: `127.0.0.1:${other.port}` }, login: LOGIN });
    assert.equal(typed.body.ok, true, JSON.stringify(typed.body));
    assert.equal(existsSync(join(r.s.dataDir, 'proxy-login.json')), true, 'a test writes nothing');
    // Saving the other proxy deletes the login before it is used there.
    const put = await r.s.api('PUT', '/v1/settings', { networkProxy: { upstream: `127.0.0.1:${other.port}` } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.loginDropped, true);
    assert.equal(put.body.status.login, null);
    assert.equal(existsSync(join(r.s.dataDir, 'proxy-login.json')), false);
    // A timeout change keeps it.
    assert.equal((await r.s.api('POST', '/v1/login', LOGIN)).status, 200);
    const keep = await r.s.api('PUT', '/v1/settings', { networkProxy: { timeouts: { authMs: 20_000 } } });
    assert.equal(keep.body.loginDropped, false);
    assert.equal(keep.body.status.login.label, 'Domain\\User');
    // A file bound to another proxy (a changed HTTPS_PROXY in .env) is deleted at read, never sent.
    const file = join(r.s.dataDir, 'proxy-login.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), upstream: 'proxy.acme.example:8080' }), { mode: 0o600 });
    const st = await r.s.api('GET', '/v1/status');
    assert.equal(st.body.login, null);
    assert.equal(existsSync(file), false);
    assert.ok(r.s.logs.some((l) => /was for proxy\.acme\.example:8080.*deleted/.test(l)));
  } finally { await other.close(); await r.close(); }
});

test('a wrong password trips the lockout breaker once: proxy needs login, no second Type 3', async () => {
  const r = await rig();
  try {
    assert.equal((await r.s.api('POST', '/v1/login', { ...LOGIN, password: 'wrong' })).status, 200);
    const got = await connectVia(r.s.proxyPort, 'origin.acme.invalid:443');
    assert.match(got, /^HTTP\/1\.1 407/);
    await until(async () => (await r.s.api('GET', '/v1/status')).body.state === 'needs-login');
    const n = r.fake.stats.type3;
    assert.match(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443'), /^HTTP\/1\.1 407/);
    assert.equal(r.fake.stats.type3, n, 'no credentials after the trip');
    assert.ok(JSON.parse(readFileSync(join(r.s.dataDir, 'proxy-login.json'), 'utf8')).rejected, 'the breaker is remembered in the file');
    // A new login reopens it.
    assert.equal((await r.s.api('POST', '/v1/login', LOGIN)).status, 200);
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
  } finally { await r.close(); }
});

test('managed mode: the operator\'s login file logs in, and every write is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-egress-op-'));
  const file = join(dir, 'proxy-login.secret.json');
  writeFileSync(file, JSON.stringify({ v: 1, domain: 'Domain', user: 'User', ntHash: HASH }), { mode: 0o600 });
  const r = await rig({ env: { WORCA_EGRESS_LOGIN_FILE: file } });
  try {
    const st = await r.s.api('GET', '/v1/status');
    assert.equal(st.body.managed, true);
    assert.equal(st.body.managedBy, 'operator');
    assert.equal(st.body.login.label, 'Domain\\User');
    assertNoSecret(st.body);
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    for (const [m, p, b] of [['POST', '/v1/login', LOGIN], ['POST', '/v1/logout', {}], ['PUT', '/v1/settings', { networkProxy: { auth: 'ntlm' } }],
      ['POST', '/v1/test', { login: LOGIN }], ['POST', '/v1/test', { networkProxy: { upstream: 'proxy.acme.example:8080' } }]]) {
      const res = await r.s.api(m, p, b);
      assert.equal(res.status, 409, `${m} ${p}`);
      assert.equal(res.body.code, 'MANAGED');
    }
    assert.equal((await r.s.api('POST', '/v1/test', {})).body.ok, true, 'a test with the operator\'s login is allowed');
    assert.equal(existsSync(join(r.s.dataDir, 'proxy-login.json')), false, 'nothing written');
  } finally { await r.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the allowlist overlay keeps its meaning when the sidecar also logs in', async () => {
  const r = await rig({ env: { WORCA_EGRESS_ALLOWLIST: '1', WORCA_EGRESS_ALLOW: '.acme.invalid' } });
  try {
    assert.equal((await r.s.api('POST', '/v1/login', LOGIN)).status, 200);
    assert.match(await connectVia(r.s.proxyPort, 'evil.example.org:443'), /^HTTP\/1\.1 403/);
    await until(async () => /echo:ping/.test(await connectVia(r.s.proxyPort, 'origin.acme.invalid:443')));
    assert.equal((await r.s.api('GET', '/v1/status')).body.policy.mode, 'allowlist');
  } finally { await r.close(); }
});

test('config: the secret is required to be long, the ports must differ, no API without a secret', async () => {
  assert.match(readSidecarConfig({ WORCA_EGRESS_DATA_DIR: '/x', WORCA_EGRESS_SECRET: 'short' }).errors.join(), /too short/);
  assert.match(readSidecarConfig({ WORCA_EGRESS_DATA_DIR: '/x', WORCA_EGRESS_PORT: '3128', WORCA_EGRESS_API_PORT: '3128' }).errors.join(), /must differ/);
  assert.match(readSidecarConfig({}).errors.join(), /WORCA_EGRESS_DATA_DIR is required/);
  assert.equal(readSidecarConfig({ WORCA_EGRESS_DATA_DIR: '/x' }).config.policy.mode, 'open');
  const dir = mkdtempSync(join(tmpdir(), 'worca-egress-sf-'));
  writeFileSync(join(dir, 's'), `${'f'.repeat(40)}\n`);
  assert.equal(readSidecarConfig({ WORCA_EGRESS_DATA_DIR: '/x', WORCA_EGRESS_SECRET_FILE: join(dir, 's') }).config.secret, 'f'.repeat(40));
  rmSync(dir, { recursive: true, force: true });
  const s = await startSidecar({ WORCA_EGRESS_SECRET: '' });
  try { assert.equal(s.apiPort, undefined); assert.ok(s.logs.some((l) => /internal API is off/.test(l))); } finally { await s.close(); }
});
