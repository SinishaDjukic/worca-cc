// test/setup-network-live.test.mjs — the setup assistant's "Network applies on Next" end to end on the real server
// (docs/setup-assistant.md): on a fresh home behind an NTLM proxy, a Test with the typed login passes, the
// network-only POST /api/setup/apply turns the proxy on live (D8: the local proxy starts and Worca's fetch
// dispatcher is re-installed, wired as the server's boot wires it), and step 3's Copilot sign-in, made by the
// server itself, then reaches the corporate proxy through the local proxy, logged in with that account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';
import { startLiveEgress } from '../src/core/egress-policy.mjs';
import { reinstallEnvProxy } from '../src/core/env-proxy.mjs';
import { readProxyLogin } from '../src/core/proxy-credentials.mjs';

useTempHome(after);

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'WORCA_EGRESS_PROXY_URL', 'WORCA_CORPORATE_PROXY_URL'];
const JSONH = { 'Content-Type': 'application/json' };
let sandboxHome, srv, base, testing, origin, fake, live, fetchProxy = null;
const prevEnv = {};

const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, body: b === undefined ? undefined : JSON.stringify(b) });
  const text = await r.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text };
};

/** A stand-in for github.com behind the corporate proxy: the fake upstream tunnels every CONNECT here. */
function githubOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', () => c.end()); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-setup-net-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', ...PROXY_ENV]) prevEnv[k] = process.env[k];
  for (const k of PROXY_ENV) delete process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';   // the Copilot notice writes settings in the sandboxed HOME
  const mod = await import('../ui/server.mjs');
  testing = mod._testing;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  origin = await githubOrigin();
  fake = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: origin.port });
  // The server's boot (ui/server.mjs isMain): the live egress over process.env, and D8's fetch re-install.
  live = await startLiveEgress({ env: process.env, log: () => {}, onEnvChange: () => { fetchProxy = reinstallEnvProxy(fetchProxy); } });
  testing.setLiveEgress(live);
});
after(async () => {
  testing?.setLiveEgress(null);
  fetchProxy?.restore();
  await live?.close();
  await fake?.close();
  origin?.server.close();
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
});

test('fresh home: Test with the typed login, the network-only apply, then a server-side Copilot call goes through the local proxy', async () => {
  assert.equal(live.current().status, 'off', 'a fresh home starts direct');
  assert.equal(readProxyLogin(), null, 'no saved login');
  const networkProxy = { enabled: true, upstream: `http://127.0.0.1:${fake.port}`, auth: 'auto', noProxy: null };
  const login = { domain: 'ACME', user: 'jdoe', password: 'S3cret!' };

  const t = await call('POST', '/api/proxy/test', { networkProxy, login });
  assert.equal(t.status, 200, t.text);
  assert.equal(t.body.ok, true, t.text);

  const a = await call('POST', '/api/setup/apply', { network: { networkProxy, login } });
  assert.equal(a.status, 202, a.text);
  assert.deepEqual(a.body.steps.map((s) => s.id), ['proxy-swap', 'proxy-login']);
  let job;
  const t0 = Date.now();
  do { await new Promise((r) => setTimeout(r, 20)); job = (await call('GET', `/api/setup/apply/${a.body.id}`)).body; } while (!job.done && Date.now() - t0 < 5000);
  assert.equal(job.ok, true, JSON.stringify(job));

  const egress = live.current();
  assert.equal(egress.status, 'on', 'D8: the local proxy started live');
  assert.equal(process.env.HTTPS_PROXY, egress.url, 'the server env points at the local proxy');
  assert.equal(fetchProxy?.status, 'on', 'Worca\'s fetch dispatcher was re-installed');
  assert.equal(egress.connector.status().login, 'ACME\\jdoe', 'the connector logs in with the saved account');

  const ack = await call('POST', '/api/providers/copilot/acknowledge', {});
  assert.equal(ack.status, 200, ack.text);
  const heads = fake.stats.heads.length;
  const type3 = fake.stats.type3;
  await call('POST', '/api/providers/copilot/login', {});   // the stand-in is no TLS server: the answer is an error
  const seen = fake.stats.heads.slice(heads).map((h) => h.line);
  assert.ok(seen.includes('CONNECT github.com:443 HTTP/1.1'), `the device-flow call reached the corporate proxy: ${JSON.stringify(seen)}`);
  assert.ok(fake.stats.type3 > type3, 'and logged in there with NTLM');
});
