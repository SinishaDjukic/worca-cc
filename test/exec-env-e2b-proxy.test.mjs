// test/exec-env-e2b-proxy.test.mjs — the e2b SDK and the corporate proxy. The SDK sends every request through its
// own undici Agent, never fetch's global dispatcher (env-proxy.mjs), so e2bConnection() hands it the env proxy
// itself; NO_PROXY or loopback for the API or sandbox host keeps a self-hosted E2B direct. The real-SDK case runs
// Sandbox.list with the connection's options against a fake CONNECT proxy that records each target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { e2bConnection, e2bProxy } from '../src/core/exec-env/e2b-config.mjs';

const PROXY = 'http://127.0.0.1:3128';
const CLOUD = { E2B_API_KEY: 'e2b_1234567890abcdef', HTTPS_PROXY: PROXY };

test('e2bProxy: the env proxy for E2B Cloud, as worca\'s own fetch() picks it', () => {
  assert.equal(e2bProxy({}), null);
  assert.equal(e2bProxy(CLOUD), PROXY);
  assert.equal(e2bProxy({ HTTPS_PROXY: 'http://a', https_proxy: 'http://b' }), 'http://b');
  assert.equal(e2bProxy({ HTTP_PROXY: PROXY }), PROXY, 'https falls back to the http proxy, as EnvHttpProxyAgent does');
  assert.equal(e2bProxy({ HTTPS_PROXY: PROXY, E2B_API_URL: 'http://e2b.corp.example:3000' }), null, 'an http API takes only an http proxy');
  assert.equal(e2bProxy({ HTTP_PROXY: PROXY, E2B_API_URL: 'http://e2b.corp.example:3000' }), PROXY);
  assert.equal(e2bConnection(CLOUD).opts.proxy, PROXY);
  assert.equal('proxy' in e2bConnection({ E2B_API_KEY: 'k' }).opts, false);
});

test('e2bProxy: NO_PROXY or loopback for the API or the sandbox host goes direct', () => {
  assert.equal(e2bProxy({ ...CLOUD, NO_PROXY: 'api.e2b.app' }), null);
  assert.equal(e2bProxy({ ...CLOUD, no_proxy: '.e2b.app' }), null, 'sandboxes are <port>-<id>.<domain>');
  assert.equal(e2bProxy({ ...CLOUD, NO_PROXY: '*' }), null);
  assert.equal(e2bProxy({ ...CLOUD, NO_PROXY: 'github.com,.corp.example' }), PROXY);
  assert.equal(e2bProxy({ ...CLOUD, E2B_API_URL: 'http://localhost:3000', HTTP_PROXY: PROXY }), null, 'a local VM stays direct');
  assert.equal(e2bProxy({ ...CLOUD, E2B_DOMAIN: 'e2b.corp.example', NO_PROXY: '.corp.example' }), null);
  assert.equal(e2bProxy({ ...CLOUD, E2B_API_URL: 'https://api.e2b.corp.example', E2B_SANDBOX_URL: 'https://sb.lan', NO_PROXY: 'sb.lan' }), null);
});

let sdk = null;
try { sdk = await import('e2b'); } catch { /* optional dependency */ }

test('the e2b SDK goes through the env proxy with the connection\'s options', { skip: sdk ? false : 'the optional e2b package is not installed' }, async () => {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.url); res.writeHead(502).end(); });
  server.on('connect', (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { E2B_API_KEY: 'e2b_1234567890abcdef', E2B_API_URL: 'https://api.upstream.invalid', HTTPS_PROXY: url };
    const { opts } = e2bConnection(env);
    const pager = sdk.Sandbox.list({ ...opts, requestTimeoutMs: 10_000 });
    await assert.rejects(pager.nextItems());
    assert.ok(seen.length > 0 && seen.every((t) => t === 'api.upstream.invalid:443'), JSON.stringify(seen));
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
});
