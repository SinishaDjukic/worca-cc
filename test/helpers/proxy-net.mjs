// test/helpers/proxy-net.mjs — the real-fetch proxy case of test/env-proxy.test.mjs, for a
// spawned child: a local proxy that records what it was asked for, direct loopback servers,
// and the proxy variables set in this process so scrubbedEnv() hands them to the child.
import assert from 'node:assert/strict';
import http from 'node:http';

const PROXY_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

/** The host a test lists in NO_PROXY: a direct fetch of it fails in DNS, never at the proxy. */
export const NO_PROXY_HOST = 'nop.invalid';

/**
 * Start the proxy and the direct servers. The proxy records each absolute-form GET or CONNECT
 * target in `seen`, then refuses with 502. `targets` are the URLs the child fetches, in order:
 * an outside https host (through the proxy), the NO_PROXY host, loopback v4 and, when this
 * host has it, v6 (both direct, so their servers answer).
 */
export async function startProxyNet() {
  const seen = [];
  const proxy = http.createServer((req, res) => { seen.push(req.url); res.writeHead(502).end(); });
  proxy.on('connect', (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  const direct = http.createServer((req, res) => res.end('direct'));
  await Promise.all([proxy, direct].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const direct6 = http.createServer((req, res) => res.end('direct6'));
  const has6 = await new Promise((r) => { direct6.once('error', () => r(false)); direct6.listen(0, '::1', () => r(true)); });
  const servers = has6 ? [proxy, direct, direct6] : [proxy, direct];
  return {
    seen,
    has6,
    proxyUrl: `http://127.0.0.1:${proxy.address().port}`,
    targets: [
      'https://upstream.invalid/op',
      `https://${NO_PROXY_HOST}/op`,
      `http://127.0.0.1:${direct.address().port}/op`,
      ...(has6 ? [`http://[::1]:${direct6.address().port}/op`] : []),
    ],
    close: () => Promise.all(servers.map((s) => new Promise((done) => { s.closeAllConnections?.(); s.close(done); }))),
  };
}

/** Set exactly `vars` among the six proxy variables (the rest unset); returns the restore. */
export function setProxyEnv(vars) {
  const saved = Object.fromEntries(PROXY_NAMES.map((k) => [k, process.env[k]]));
  for (const k of PROXY_NAMES) delete process.env[k];
  Object.assign(process.env, vars);
  return () => {
    for (const k of PROXY_NAMES) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

/**
 * The routing a child's fetch() must show for `net.targets`. `results` are its outcomes in the
 * same order: { url, status, body } for a response, { url, error } for a failed fetch.
 */
export function assertProxyRouting(net, results) {
  const seen = JSON.stringify(net.seen);
  assert.ok(net.seen.some((u) => u.startsWith('upstream.invalid')), `the outside host must reach the proxy; it saw: ${seen}`);
  assert.ok(!net.seen.some((u) => u.includes(NO_PROXY_HOST)), `a NO_PROXY host must go direct; the proxy saw: ${seen}`);
  assert.ok(!net.seen.some((u) => /127\.0\.0\.1|::1/.test(u)), `loopback must not reach the proxy; it saw: ${seen}`);
  assert.deepEqual(results.map((r) => r.url), net.targets, 'the child fetched every target, in order');
  assert.ok(results[1].error, `the NO_PROXY host was fetched directly and failed in DNS: ${JSON.stringify(results[1])}`);
  assert.deepEqual(results.slice(2).map((r) => r.body), net.has6 ? ['direct', 'direct6'] : ['direct'], 'loopback answered directly');
}
