// test/env-proxy.test.mjs
// useEnvProxy(): Node's fetch() ignores HTTP(S)_PROXY unless the process opts in, so on a
// proxy-only network every outbound call died with "fetch failed" (Copilot sign-in first).
// Unit cases use a fake `api`; the real cases run whichever path this Node takes
// (http.setGlobalProxyFromEnv, else undici's EnvHttpProxyAgent) against a local proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { useEnvProxy, reinstallEnvProxy } from '../src/core/env-proxy.mjs';
import { egressChildEnv } from '../src/core/egress-policy.mjs';
import { checkRows } from './helpers/rows.mjs';

const LOOPBACK = 'localhost,127.0.0.1,::1,[::1]';

function fakeApi() {
  const calls = [];
  return { calls, setGlobalProxyFromEnv: (env) => { calls.push(env); return () => {}; } };
}

test('no proxy variables: fetch is left alone', () => {
  const api = fakeApi();
  assert.equal(useEnvProxy({ env: { NO_PROXY: 'corp.example' }, api }).status, 'off');
  assert.equal(api.calls.length, 0);
});

test('NO_PROXY merge: loopback appended; no_proxy and NO_PROXY entries both kept; absent NO_PROXY gets loopback only', async () => {
  await checkRows([
    { name: 'a proxy is set: loopback is appended to NO_PROXY, the existing entries kept', run: async () => {
      const api = fakeApi();
      const r = useEnvProxy({ env: { HTTPS_PROXY: 'http://proxy.corp:8080', no_proxy: 'corp.example' }, api });
      assert.equal(r.status, 'on');
      assert.equal(api.calls.length, 1);
      const passed = api.calls[0];
      assert.equal(passed.HTTPS_PROXY, 'http://proxy.corp:8080');
      assert.equal(passed.no_proxy, `corp.example,${LOOPBACK}`);
      assert.equal(passed.NO_PROXY, passed.no_proxy);
    } },
    { name: 'no_proxy and NO_PROXY both set: entries from both survive', run: async () => {
      const api = fakeApi();
      useEnvProxy({ env: { HTTPS_PROXY: 'http://proxy.corp:8080', no_proxy: 'corp.example', NO_PROXY: 'jira.corp,corp.example' }, api });
      assert.equal(api.calls[0].NO_PROXY, `corp.example,jira.corp,${LOOPBACK}`);
    } },
    { name: 'a proxy with no NO_PROXY at all still keeps loopback direct', run: async () => {
      const api = fakeApi();
      useEnvProxy({ env: { http_proxy: 'http://proxy.corp:8080' }, api });
      assert.equal(api.calls[0].NO_PROXY, LOOPBACK);
    } },
  ]);
});

test('a Node without setGlobalProxyFromEnv falls back to undici\'s EnvHttpProxyAgent', () => {
  const made = [];
  let dispatcher = 'original';
  const undici = {
    EnvHttpProxyAgent: class { constructor(o) { made.push(o); } close() { return Promise.resolve(); } },
    getGlobalDispatcher: () => dispatcher,
    setGlobalDispatcher: (d) => { dispatcher = d; },
  };
  const r = useEnvProxy({ env: { HTTPS_PROXY: 'http://proxy.corp:8080', NO_PROXY: 'corp.example' }, api: {}, undici });
  assert.equal(r.status, 'on');
  assert.deepEqual(made, [{ httpProxy: undefined, httpsProxy: 'http://proxy.corp:8080', noProxy: `corp.example,${LOOPBACK}` }]);
  assert.ok(dispatcher instanceof undici.EnvHttpProxyAgent);
  r.restore();
  assert.equal(dispatcher, 'original');
});

test('neither API available: unsupported, never throws', () => {
  assert.equal(useEnvProxy({ env: { HTTPS_PROXY: 'http://proxy.corp:8080' }, api: {}, undici: null }).status, 'unsupported');
});

test('a malformed proxy URL: invalid, never throws, and the message hides the URL', () => {
  const r = useEnvProxy({ env: { HTTPS_PROXY: 'http://user:s3cret@[not-a-host' } });
  assert.equal(r.status, 'invalid');
  assert.match(r.error, /proxy/i);
  assert.doesNotMatch(r.error, /s3cret/);
});

test('real fetch: an outside host goes through the proxy, loopback (v4 and v6) goes direct', async () => {
  const seen = [];
  // The proxy only records what it was asked for (absolute-form GET or CONNECT), then refuses.
  const proxy = http.createServer((req, res) => { seen.push(req.url); res.writeHead(502).end(); });
  proxy.on('connect', (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  const direct = http.createServer((req, res) => res.end('direct'));
  await Promise.all([proxy, direct].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const direct6 = http.createServer((req, res) => res.end('direct6'));
  const has6 = await new Promise((r) => { direct6.once('error', () => r(false)); direct6.listen(0, '::1', () => r(true)); });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const r = useEnvProxy({ env: { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl } });
  try {
    assert.equal(r.status, 'on');
    await fetch('http://upstream.invalid/login/device/code').catch(() => {});
    assert.ok(seen.some((u) => u.includes('upstream.invalid')), `the proxy saw: ${JSON.stringify(seen)}`);
    const res = await fetch(`http://127.0.0.1:${direct.address().port}/`);
    assert.equal(await res.text(), 'direct');
    if (has6) {
      const res6 = await fetch(`http://[::1]:${direct6.address().port}/`);
      assert.equal(await res6.text(), 'direct6');
    }
    assert.ok(!seen.some((u) => /127\.0\.0\.1|::1/.test(u)), `loopback must not reach the proxy: ${JSON.stringify(seen)}`);
  } finally {
    r.restore();
    const servers = has6 ? [proxy, direct, direct6] : [proxy, direct];
    await Promise.all(servers.map((s) => new Promise((done) => { s.closeAllConnections?.(); s.close(done); })));
  }
});

test('corporate proxy: the child env of the local proxy turns fetch proxying on, noProxy hosts and loopback direct', () => {
  const api = fakeApi();
  const r = useEnvProxy({ env: egressChildEnv('http://127.0.0.1:41234', ['intranet.example']), api });
  assert.equal(r.status, 'on');
  assert.equal(api.calls.length, 1);
  const noProxy = api.calls[0].NO_PROXY.split(',');
  for (const h of ['intranet.example', '127.0.0.1', 'localhost', '::1', '[::1]']) assert.ok(noProxy.includes(h), h);
  assert.equal(api.calls[0].HTTPS_PROXY, 'http://127.0.0.1:41234');
});

test('reinstallEnvProxy: restores the previous install, then installs from the new env', () => {
  const calls = [];
  const api = { setGlobalProxyFromEnv: (e) => { calls.push(e.HTTPS_PROXY); return () => calls.push('restore'); } };
  const first = useEnvProxy({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' }, api });
  const second = reinstallEnvProxy(first, { env: { HTTPS_PROXY: 'http://127.0.0.1:2' }, api });
  assert.deepEqual(calls, ['http://127.0.0.1:1', 'restore', 'http://127.0.0.1:2']);
  assert.equal(second.status, 'on');
});
