// test/ask-web-proxy.test.mjs
// web_fetch through HTTPS_PROXY (docs/guardrails.md "Web access"): a fake CONNECT proxy in front of
// a local TLS server with a throwaway certificate for docs.example.com (made by openssl at test
// time; skipped where openssl is missing). The resolver is faked, so nothing leaves this machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkRows } from './helpers/rows.mjs';
import { createWebFetcher, httpsTransport, makeGuardedLookup, WEB_LIMITS } from '../src/core/ask/web-fetch.mjs';
import { httpsProxyFor } from '../src/core/env-proxy.mjs';

const HOST = 'docs.example.com';
const ALLOW = [HOST];
const resolveTo = (address) => makeGuardedLookup((h, o, cb) => cb(null, [{ address, family: 4 }]));
const noDns = makeGuardedLookup((h, o, cb) => cb(Object.assign(new Error('no dns'), { code: 'ENOTFOUND' })));

let cert = null; let target; let proxy; let proxyUrl; const seen = [];
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worca-web-proxy-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
      '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`, '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    cert = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  } catch { cert = null; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!cert) return;
  target = https.createServer(cert, (req, res) => { res.setHeader('content-type', 'text/plain'); res.end(`hello via tunnel ${req.url}`); });
  const targetPort = await listen(target);
  // The fake proxy sends every CONNECT to the local TLS server; 'user:wrong' credentials get a 407.
  proxy = http.createServer((req, res) => { res.statusCode = 405; res.end(); });
  proxy.on('connect', (req, sock, head) => {
    seen.push({ target: req.url, auth: req.headers['proxy-authorization'] || null });
    if (req.headers['proxy-authorization'] === `Basic ${Buffer.from('user:wrong').toString('base64')}`) {
      sock.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
    }
    const up = net.connect(targetPort, '127.0.0.1', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});
after(() => { target?.close(); target?.closeAllConnections?.(); proxy?.close(); proxy?.closeAllConnections?.(); });

const fetcher = (env, lookup) => createWebFetcher({ allowedDomains: ALLOW, lookup, transport: (o) => httpsTransport({ ...o, env, ca: cert.cert }) });

test('httpsProxyFor: HTTPS_PROXY then HTTP_PROXY; NO_PROXY hosts, domains, ports, * and loopback go direct', async () => {
  await checkRows([
    { name: 'no proxy set ⇒ direct', run: () => assert.equal(httpsProxyFor(HOST, { env: {} }), null) },
    { name: 'HTTPS_PROXY wins, HTTP_PROXY is the fallback', run: () => {
      assert.equal(httpsProxyFor(HOST, { env: { HTTPS_PROXY: 'http://a:1', HTTP_PROXY: 'http://b:2' } }), 'http://a:1');
      assert.equal(httpsProxyFor(HOST, { env: { http_proxy: 'http://b:2' } }), 'http://b:2');
    } },
    { name: 'NO_PROXY entries: host, domain, .domain, *.domain, port, *', run: () => {
      const env = (no) => ({ HTTPS_PROXY: 'http://p:1', NO_PROXY: no });
      for (const no of [HOST, 'example.com', '.example.com', '*.example.com', 'EXAMPLE.com:443', 'other.org, example.com', '*']) assert.equal(httpsProxyFor(HOST, { env: env(no) }), null, no);
      for (const no of ['ample.com', 'docs.example.com:8443', 'other.org', '']) assert.equal(httpsProxyFor(HOST, { env: env(no) }), 'http://p:1', no);
      assert.equal(httpsProxyFor(HOST, { env: { HTTPS_PROXY: 'http://p:1', no_proxy: 'example.com' } }), null);
    } },
    { name: 'loopback is always direct', run: () => {
      for (const h of ['localhost', 'localhost.', '127.0.0.1', '::1', '[::1]']) assert.equal(httpsProxyFor(h, { env: { HTTPS_PROXY: 'http://p:1' } }), null, h);
    } },
    { name: 'a trailing dot names the same host, on either side', run: () => {
      for (const [h, no] of [[`${HOST}.`, HOST], [HOST, `${HOST}.`], [`${HOST}.`, '.example.com.']]) assert.equal(httpsProxyFor(h, { env: { HTTPS_PROXY: 'http://p:1', NO_PROXY: no } }), null, `${h} / ${no}`);
    } },
  ]);
});

test('web_fetch tunnels through HTTPS_PROXY, stays direct for NO_PROXY, and still refuses private targets', async (t) => {
  if (!cert) { t.skip('openssl is not available'); return; }
  await checkRows([
    { name: 'tunnels through the proxy (CONNECT host:443, TLS verified for the host) and reads the page', run: async () => {
      seen.length = 0;
      const r = await fetcher({ HTTPS_PROXY: proxyUrl }, resolveTo('93.184.216.34')).fetch(`https://${HOST}/guide`);
      assert.equal(r.text, 'hello via tunnel /guide');
      assert.deepEqual(seen, [{ target: `${HOST}:443`, auth: null }]);
    } },
    { name: 'a proxy-only network (no local DNS answer) still tunnels: the proxy resolves', run: async () => {
      seen.length = 0;
      assert.equal((await fetcher({ HTTP_PROXY: proxyUrl }, noDns).fetch(`https://${HOST}/`)).text, 'hello via tunnel /');
      assert.equal(seen.length, 1);
    } },
    { name: 'proxy credentials go in Proxy-Authorization; a 407 is a clear refusal', run: async () => {
      seen.length = 0;
      const u = new URL(proxyUrl); u.username = 'user'; u.password = 'p@ss';
      assert.equal((await fetcher({ HTTPS_PROXY: u.href }, noDns).fetch(`https://${HOST}/`)).text, 'hello via tunnel /');
      assert.equal(seen[0].auth, `Basic ${Buffer.from('user:p@ss').toString('base64')}`);
      u.password = 'wrong';
      await assert.rejects(fetcher({ HTTPS_PROXY: u.href }, noDns).fetch(`https://${HOST}/`), (e) => /proxy refused the tunnel to docs\.example\.com \(HTTP 407\)/.test(e.message) && !e.message.includes('wrong'));
    } },
    { name: 'a host resolving to a private or loopback address is refused before the proxy is contacted', run: async () => {
      seen.length = 0;
      for (const a of ['127.0.0.1', '10.0.0.1', '169.254.169.254']) {
        await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl }, resolveTo(a)).fetch(`https://${HOST}/`), { code: 'blocked-address' }, a);
      }
      assert.equal(seen.length, 0);
    } },
    { name: 'NO_PROXY goes direct: the guarded lookup dials (and refuses 127.0.0.1), the proxy never sees it', run: async () => {
      seen.length = 0;
      await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl, NO_PROXY: 'example.com' }, resolveTo('127.0.0.1')).fetch(`https://${HOST}/`), { code: 'blocked-address' });
      await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl, NO_PROXY: 'example.com' }, noDns).fetch(`https://${HOST}/`), { code: 'network' });
      assert.equal(seen.length, 0);
    } },
    { name: 'NO_PROXY still applies to the trailing-dot spelling of an allowlisted host', run: async () => {
      seen.length = 0;
      await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl, NO_PROXY: HOST }, resolveTo('127.0.0.1')).fetch(`https://${HOST}./`), { code: 'blocked-address' });
      assert.equal(seen.length, 0);
    } },
    { name: 'a stalled DNS pre-check ends at the deadline', run: async () => {
      const stalled = (h, o, cb) => { const keepAlive = setTimeout(() => cb(null, [{ address: '93.184.216.34', family: 4 }]), 5000); keepAlive.unref(); };
      const f = createWebFetcher({ allowedDomains: ALLOW, lookup: stalled, limits: { ...WEB_LIMITS, timeoutMs: 50 }, transport: (o) => httpsTransport({ ...o, env: { HTTPS_PROXY: proxyUrl }, ca: cert.cert }) });
      const t0 = Date.now();
      await assert.rejects(f.fetch(`https://${HOST}/`), { code: 'timeout' });
      assert.ok(Date.now() - t0 < 2000);
    } },
    { name: 'a certificate the proxy cannot fake: an untrusted cert through the tunnel fails TLS', run: async () => {
      const plain = createWebFetcher({ allowedDomains: ALLOW, lookup: noDns, transport: (o) => httpsTransport({ ...o, env: { HTTPS_PROXY: proxyUrl } }) });
      await assert.rejects(plain.fetch(`https://${HOST}/`), (e) => e.code === 'network' && /CERT|SELF_SIGNED|certificate/i.test(e.message));
    } },
    { name: 'IP-literal and non-allowlisted URLs are refused before any connection', run: async () => {
      seen.length = 0;
      await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl }, noDns).fetch('https://127.0.0.1/'), /IP-address URLs/);
      await assert.rejects(fetcher({ HTTPS_PROXY: proxyUrl }, noDns).fetch('https://intranet.corp/'), { code: 'not-allowlisted' });
      assert.equal(seen.length, 0);
    } },
    { name: 'a malformed proxy URL is refused without echoing it', run: async () => {
      await assert.rejects(fetcher({ HTTPS_PROXY: 'not a url secret' }, noDns).fetch(`https://${HOST}/`), (e) => /not a valid proxy URL/.test(e.message) && !e.message.includes('secret'));
    } },
  ]);
});
