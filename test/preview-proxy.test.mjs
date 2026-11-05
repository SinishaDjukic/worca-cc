// test/preview-proxy.test.mjs — the Browser tab's preview proxy (issue 1064): loopback only, allowed ports only, a
// live token per port, sandboxed pages, root-relative URLs moved under the prefix, and WebSocket upgrades (HMR).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { JSDOM } from 'jsdom';
import {
  parsePreviewPath, portRefusal, createPreviewTokens, framingRefused, rewriteLocation, rewriteHtml, logicalUrl,
  upstreamRequestHeaders, responseHeaders, createPreviewProxy, previewPrefix, SANDBOX_CSP, rewriteCss, previewShim, sendPreviewNote,
} from '../src/core/preview-proxy.mjs';
import { PICK_SHIM } from '../src/core/preview-proxy.mjs';
import { cssSelector } from '../src/shared/element-snippet.mjs';

const TOK = 'abcdefghijklmnopqrstuvwx';   // 24 chars, the minted shape

test('parsePreviewPath: port, token and the rest with its query; refusals for anything else', () => {
  assert.deepEqual(parsePreviewPath(`/preview/5173/${TOK}/src/a.js?v=1`), { port: 5173, token: TOK, rest: '/src/a.js?v=1', bare: false });
  assert.deepEqual(parsePreviewPath(`/preview/5173/${TOK}?x=1`), { port: 5173, token: TOK, rest: '?x=1', bare: true });
  assert.deepEqual(parsePreviewPath(`/preview/5173/${TOK}/`), { port: 5173, token: TOK, rest: '/', bare: false });
  for (const bad of [`/preview/0/${TOK}/`, `/preview/65536/${TOK}/`, `/preview/example.com/${TOK}/`, `/preview/5173/short/`,
    `/preview/5173@evil.com/${TOK}/`, `/preview/127.0.0.1:5173/${TOK}/`, '/preview/5173/', `/api/preview/5173/${TOK}/`, '', null]) {
    assert.equal(parsePreviewPath(bad), null, String(bad));
  }
});

test('portRefusal: the range and running instances only, never Worca itself', () => {
  const range = { low: 4400, high: 4499 };
  assert.equal(portRefusal(4400, { range }), null);
  assert.equal(portRefusal(4499, { range }), null);
  assert.equal(portRefusal(4500, { range }), 'PORT_NOT_ALLOWED');
  assert.equal(portRefusal(4399, { range }), 'PORT_NOT_ALLOWED');
  assert.equal(portRefusal(3000, { range, held: [3000] }), null, 'a running instance on a typed port');
  assert.equal(portRefusal(3000, { range, held: [3001] }), 'PORT_NOT_ALLOWED');
  assert.equal(portRefusal(4411, { range, self: 4411 }), 'SELF', 'Worca inside its own range');
  assert.equal(portRefusal(4411, { range, held: [4411], self: 4411 }), 'SELF');
  assert.equal(portRefusal(NaN, { range }), 'BAD_PORT');
  assert.equal(portRefusal(70000, { range }), 'BAD_PORT');
  assert.equal(portRefusal(4400, {}), 'PORT_NOT_ALLOWED', 'no range: nothing but instances');
});

test('portRefusal: all local ports by default mode, SELF and BAD_PORT still refused first', () => {
  const range = { low: 4400, high: 4499 };
  assert.equal(portRefusal(3000, { all: true, range }), null, 'all: a hand-started dev server');
  assert.equal(portRefusal(1, { all: true }), null);
  assert.equal(portRefusal(65535, { all: true }), null);
  assert.equal(portRefusal(4411, { all: true, range, self: 4411 }), 'SELF', 'SELF wins over all');
  assert.equal(portRefusal(3000, { all: true, self: 3000, held: [3000] }), 'SELF');
  assert.equal(portRefusal(0, { all: true }), 'BAD_PORT');
  assert.equal(portRefusal(70000, { all: true }), 'BAD_PORT');
  assert.equal(portRefusal(3000, { all: false, range }), 'PORT_NOT_ALLOWED', 'range mode is today\'s rule');
});

test('tokens: bound to one port, expire, and the oldest goes at the cap', () => {
  let t = 1000;
  let n = 0;
  const tokens = createPreviewTokens({ now: () => t, ttlMs: 100, max: 2, mint: () => `tok${String(n += 1).padStart(21, '0')}` });
  const a = tokens.issue(4400);
  assert.equal(tokens.check(a, 4400), null);
  assert.equal(tokens.check(a, 4401), 'TOKEN_PORT');
  assert.equal(tokens.check('nope', 4400), 'TOKEN_UNKNOWN');
  const b = tokens.issue(4401);
  tokens.issue(4402);
  assert.equal(tokens.check(a, 4400), 'TOKEN_UNKNOWN', 'evicted at the cap');
  assert.equal(tokens.check(b, 4401), null);
  t += 100;
  assert.equal(tokens.check(b, 4401), 'TOKEN_EXPIRED');
  assert.equal(tokens.size(), 1);
});

test('framingRefused: X-Frame-Options and frame-ancestors, unless they allow Worca', () => {
  const page = ['http://127.0.0.1:4317'];
  assert.equal(framingRefused({}, page), null);
  assert.equal(framingRefused({ 'x-frame-options': 'DENY' }, page), 'X-Frame-Options');
  assert.equal(framingRefused({ 'x-frame-options': 'sameorigin' }, page), 'X-Frame-Options');
  assert.equal(framingRefused({ 'x-frame-options': 'ALLOW-FROM https://x' }, page), null, 'browsers ignore ALLOW-FROM');
  assert.equal(framingRefused({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }, page), 'frame-ancestors');
  assert.equal(framingRefused({ 'content-security-policy': "frame-ancestors 'self'" }, page), 'frame-ancestors');
  assert.equal(framingRefused({ 'content-security-policy': 'frame-ancestors *' }, page), null);
  assert.equal(framingRefused({ 'content-security-policy': 'frame-ancestors http://127.0.0.1:4317/' }, page), null);
  assert.equal(framingRefused({ 'content-security-policy': ["script-src 'self'", "frame-ancestors 'none'"] }, page), 'frame-ancestors');
});

test('URLs: redirects, the logical address and the HTML rewrite stay under the prefix', () => {
  const prefix = previewPrefix(5173, TOK);
  assert.equal(rewriteLocation('/login', 5173, prefix), `${prefix}login`);
  assert.equal(rewriteLocation(`${prefix}x`, 5173, prefix), `${prefix}x`);
  assert.equal(rewriteLocation('http://localhost:5173/a?b#c', 5173, prefix), `${prefix}a?b#c`);
  assert.equal(rewriteLocation('http://localhost:9999/a', 5173, prefix), 'http://localhost:9999/a');
  assert.equal(rewriteLocation('//evil.com/x', 5173, prefix), '//evil.com/x');
  assert.equal(rewriteLocation('https://example.com/', 5173, prefix), 'https://example.com/');
  assert.equal(logicalUrl(`http://127.0.0.1:4317${prefix}about?x=1#h`, 5173, prefix), 'http://localhost:5173/about?x=1#h');
  assert.equal(logicalUrl('http://127.0.0.1:4317/api/runs', 5173, prefix), null);

  const html = '<!doctype html><html><head><title>x</title><link href="/a.css"></head><body>'
    + '<script type="module" src="/@vite/client"></script><img src=/i.png srcset="/s.png 1x, //cdn/x.png 2x">'
    + `<a href="//cdn.example/x">c</a><a href="${prefix}ok">k</a><form action="/go"></form><div style="background:url('/bg.png')"></div></body></html>`;
  const out = rewriteHtml(html, { prefix, port: 5173 });
  assert.match(out, new RegExp(`<head><script>\\(function\\(\\)\\{var P="${prefix.replace(/\//g, '\\/')}"`), 'the shim comes first in <head>');
  assert.ok(out.indexOf('type="importmap"') < out.indexOf('<link'), 'the import map precedes every module');
  assert.ok(out.includes(`"imports":{"/":"${prefix}","${prefix}":"${prefix}"}`));
  assert.ok(out.includes('history[n]=function(s,t,u){var r=f.call(this,s,t,u==null?u:fix(u))'), 'pushState stays under the prefix');
  assert.ok(out.includes('replace:!!rep') && out.includes('tell(n==="replaceState")'), 'replaceState reports itself as a replace');
  assert.ok(out.includes(`<link href="${prefix}a.css">`));
  assert.ok(out.includes(`src="${prefix}@vite/client"`));
  assert.ok(out.includes(`<img src=${prefix}i.png`));
  assert.ok(out.includes(`srcset="${prefix}s.png 1x, //cdn/x.png 2x"`));
  assert.ok(out.includes('href="//cdn.example/x"'), 'protocol-relative stays');
  assert.ok(out.includes(`href="${prefix}ok"`) && !out.includes(`${prefix}${prefix.slice(1)}`), 'never prefixed twice');
  assert.ok(out.includes(`action="${prefix}go"`));
  assert.ok(out.includes(`url('${prefix}bg.png')`));
  const bare = rewriteHtml('<p>hi</p>', { prefix, port: 5173 });
  assert.ok(bare.startsWith('<script>') && bare.endsWith('<p>hi</p>'), 'no head: injected first');
  assert.ok(rewriteHtml('<header><head lang="en"><x>', { prefix, port: 5173 }).startsWith('<header><head lang="en"><script>'), '<header> is not <head>');
  assert.equal(rewriteHtml('<li><img src="/a.png"></li>', { prefix, port: 5173, inject: false }), `<li><img src="${prefix}a.png"></li>`,
    'a fetched fragment: URLs only, no second shim');
});

test('rewriteCss: root-relative url() and @import move under the prefix, once', () => {
  const prefix = previewPrefix(5173, TOK);
  const tail = 'c{background:url(//cdn/x.png)}d{background:url(data:x)}';
  assert.equal(rewriteCss(`@import "/base.css";@font-face{src:url(/_next/static/media/f.woff2)}a{background:url('/a.png')}b{background:url(${prefix}b.png)}${tail}`, prefix),
    `@import "${prefix}base.css";@font-face{src:url(${prefix}_next/static/media/f.woff2)}a{background:url('${prefix}a.png')}b{background:url(${prefix}b.png)}${tail}`);
});

test('the shim moves root-relative URLs a script sets: setAttribute, innerHTML and a <style>\'s text', () => {
  const prefix = previewPrefix(5173, TOK);
  const dom = new JSDOM('<!doctype html><head></head><body></body>', { url: `http://127.0.0.1:4317${prefix}`, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(previewShim(prefix, 5173));
  const d = w.document;
  const img = d.createElement('img');
  img.setAttribute('src', '/vite.svg');
  assert.equal(img.getAttribute('src'), `http://127.0.0.1:4317${prefix}vite.svg`, 'React and Vue set src through setAttribute');
  img.setAttribute('alt', '/not-a-url');
  assert.equal(img.getAttribute('alt'), '/not-a-url', 'only URL attributes');
  img.setAttribute('src', '//cdn.example/x.png');
  assert.equal(img.getAttribute('src'), '//cdn.example/x.png', 'protocol-relative stays');
  const div = d.createElement('div');
  div.innerHTML = '<img src="/a.png"><p style="background:url(/b.png)">x</p>';
  assert.ok(div.innerHTML.includes(`src="${prefix}a.png"`) && div.innerHTML.includes(`url(${prefix}b.png)`), div.innerHTML);
  const st = d.createElement('style');
  st.textContent = 'a{background:url("/c.svg")}';
  assert.equal(st.textContent, `a{background:url("${prefix}c.svg")}`, 'Vite puts CSS in through textContent');
  const st2 = d.createElement('style');
  st2.appendChild(d.createTextNode('b{background:url(/d.svg)}'));
  assert.equal(st2.textContent, `b{background:url(${prefix}d.svg)}`, 'style-loader appends a text node');
  const p = d.createElement('p');
  p.textContent = 'url(/e.svg)';
  assert.equal(p.textContent, 'url(/e.svg)', 'text outside a <style> is left alone');
  w.close();
});

test('rewriteHtml stays linear on a page full of unclosed tags (a dev server is not trusted to be well-formed)', () => {
  const prefix = previewPrefix(5173, TOK);
  const t0 = performance.now();
  const out = rewriteHtml('<head '.repeat(80000) + '<html ', { prefix, port: 5173 });
  assert.ok(performance.now() - t0 < 500, `took ${Math.round(performance.now() - t0)} ms`);
  assert.ok(out.startsWith('<script>'), 'no closed head or html tag: injected first');
});

test('headers: no Worca credential goes up; nothing unsafe comes down; the page is sandboxed', () => {
  const prefix = previewPrefix(5173, TOK);
  const up = upstreamRequestHeaders({ host: '127.0.0.1:4317', origin: 'null', cookie: 'worca=1', authorization: 'Bearer x',
    'cf-access-jwt-assertion': 'jwt', 'x-forwarded-for': '1.2.3.4', 'x-worca-ui-token': 't', 'x-person': 'a@b', connection: 'keep-alive, x-hop',
    'x-hop': '1', referer: `http://127.0.0.1:4317${prefix}page`, accept: 'text/html', 'accept-encoding': 'gzip' },
  { port: 5173, prefix, drop: ['x-person'] });
  assert.deepEqual(up, { host: 'localhost:5173', origin: 'http://localhost:5173', referer: 'http://localhost:5173/page', accept: 'text/html', 'accept-encoding': 'identity' });
  const ws = upstreamRequestHeaders({ host: 'h', upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'k' }, { port: 5173, prefix, upgrade: true });
  assert.deepEqual(ws, { host: 'localhost:5173', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'k' });
  const idp = upstreamRequestHeaders({ host: 'h', origin: 'https://evil.example', 'x-auth-request-access-token': 'ya29', 'x-goog-iap-jwt-assertion': 'j',
    'x-goog-authenticated-user-email': 'e', 'x-amzn-oidc-data': 'd', 'x-pomerium-jwt-assertion': 'p', 'x-ms-token-aad-id-token': 'm',
    'x-ms-client-principal': 'c' }, { port: 5173, prefix });
  assert.deepEqual(idp, { host: 'localhost:5173', origin: 'https://evil.example', 'accept-encoding': 'identity' },
    'identity proxies\' tokens stay home; another site\'s Origin goes up as sent, for the dev server\'s own check');
  assert.equal(upstreamRequestHeaders({ origin: 'http://127.0.0.1:4317' }, { port: 5173, prefix, origins: ['http://127.0.0.1:4317'] }).origin,
    'http://localhost:5173', 'Worca\'s own page: the app\'s origin');

  const down = responseHeaders({ 'set-cookie': ['a=1'], 'clear-site-data': '"*"', 'strict-transport-security': 'max-age=1', 'x-frame-options': 'DENY',
    'content-security-policy': "img-src 'self'", 'access-control-allow-origin': 'http://localhost:5173', location: '/next', 'content-type': 'text/css',
    'cross-origin-resource-policy': 'same-origin', 'transfer-encoding': 'chunked', nel: '{"report_to":"x"}', 'report-to': '{}',
    'reporting-endpoints': 'x="https://e"', 'accept-ch': 'Sec-CH-UA', 'critical-ch': 'Sec-CH-UA', 'set-login': 'logged-in',
    connection: 'x-hop-down', 'x-hop-down': '1' }, { port: 5173, prefix, opaque: true });
  assert.deepEqual(down, { 'content-type': 'text/css', location: `${prefix}next`, 'content-security-policy': ["img-src 'self'", SANDBOX_CSP],
    'referrer-policy': 'no-referrer', 'access-control-allow-origin': 'null', vary: 'Origin' });
  assert.doesNotMatch(SANDBOX_CSP, /allow-same-origin/);
});

// ── through a real socket ─────────────────────────────────────────────────────────────────────────
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });
const listen = (srv, host = '127.0.0.1') => new Promise((r) => srv.listen(0, host, () => { closers.push(() => new Promise((d) => { srv.closeAllConnections?.(); srv.close(() => d()); })); r(srv.address().port); }));

async function rig({ upstreamHost = '127.0.0.1', isWorca, hostCacheMs } = {}) {
  const seen = [];
  const app = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'sid=1' }); return res.end('<html><head></head><body><script src="/main.js"></script></body></html>'); }
      if (req.url === '/main.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('import "/dep.js";'); }
      if (req.url === '/framed') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return res.end('<p>no</p>'); }
      if (req.url === '/app.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end('a{background:url(/bg.png)}'); }
      if (req.url === '/moved') { res.writeHead(302, { location: '/' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ echo: body }));
    });
  });
  app.on('upgrade', (req, socket) => {
    seen.push({ method: 'UPGRADE', url: req.url, headers: req.headers });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSet-Cookie: x=1\r\n\r\n');
    socket.on('data', (d) => socket.write(`echo:${d}`));
    socket.on('end', () => socket.destroy());
  });
  const target = await listen(app, upstreamHost);
  const tokens = createPreviewTokens();
  const held = [target];
  const proxy = createPreviewProxy({ tokens, refuse: (p) => portRefusal(p, { range: null, held }), pageOrigins: () => ['http://127.0.0.1'],
    isWorca, hostCacheMs });
  const front = http.createServer((req, res) => proxy.handle(req, res));
  front.on('upgrade', (req, socket, head) => proxy.upgrade(req, socket, head));
  const port = await listen(front);
  closers.push(async () => proxy.closeAll());   // first at teardown: server.close() never ends upgraded sockets
  return { seen, target, tokens, held, port, token: tokens.issue(target), proxy };
}
function get(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('latin1');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
function rawUpgrade(port, path) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let text = '';
    s.on('data', (d) => {
      text += d;
      if (/^HTTP\/1\.1 101/.test(text) && text.includes('\r\n\r\n') && !text.includes('echo:')) s.write('ping');
      if (text.includes('echo:ping') || !/^HTTP\/1\.1 101/.test(text)) { s.destroy(); resolve(text); }
    });
    s.on('error', () => resolve(text));
    s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: null\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
}

test('proxy: an HTML page is rewritten and sandboxed; scripts stream; bodies and redirects pass; cookies never do', async () => {
  const r = await rig();
  const base = previewPrefix(r.target, r.token);
  const page = await get(r.port, base, { headers: { cookie: 'worca=secret', 'sec-fetch-dest': 'iframe' } });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(`<script src="${base}main.js">`));
  assert.ok(page.text.includes('type="importmap"'));
  assert.equal(page.headers['set-cookie'], undefined);
  assert.match(String(page.headers['content-security-policy']), /sandbox allow-scripts/);
  assert.equal(Number(page.headers['content-length']), Buffer.byteLength(page.text, 'latin1'));
  assert.equal(r.seen.at(-1).headers.cookie, undefined, 'Worca\'s cookie stays home');
  assert.equal(r.seen.at(-1).headers.host, `localhost:${r.target}`);
  const js = await get(r.port, `${base}main.js`, { headers: { origin: 'null' } });
  assert.equal(js.text, 'import "/dep.js";', 'not HTML: as sent (the import map moves it)');
  assert.equal(js.headers['access-control-allow-origin'], 'null', 'module scripts from the opaque page');
  const pre = await get(r.port, `${base}api`, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-a' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-headers'], 'x-a');
  const posted = await get(r.port, `${base}api`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' });
  assert.deepEqual(JSON.parse(posted.text), { echo: 'hello' });
  const sheet = await get(r.port, `${base}app.css`);
  assert.equal(sheet.text, `a{background:url(${base}bg.png)}`, 'a stylesheet\'s url() resolves against the origin: moved too');
  assert.equal(Number(sheet.headers['content-length']), sheet.text.length);
  const moved = await get(r.port, `${base}moved`);
  assert.equal(moved.headers.location, base);
  const bare = await get(r.port, base.slice(0, -1) + '?a=1');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.location, `${base}?a=1`);
});

test('proxy: a frame-refusing page shows the note, only when it is the framed document', async () => {
  const r = await rig();
  const base = previewPrefix(r.target, r.token);
  const framed = await get(r.port, `${base}framed`, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert.match(framed.text, /This site cannot be shown here/);
  assert.match(framed.text, /"FRAME_REFUSED"/);
  const fetched = await get(r.port, `${base}framed`, { headers: { 'sec-fetch-dest': 'empty' } });
  assert.match(fetched.text, /<p>no<\/p>/);
  assert.equal(fetched.headers['x-frame-options'], undefined);
  const fragment = await get(r.port, base, { headers: { 'sec-fetch-dest': 'empty' } });
  assert.ok(fragment.text.includes(`<script src="${base}main.js">`), 'fetched HTML: its URLs still move');
  assert.ok(!fragment.text.includes('importmap'), 'but it gets no shim or import map of its own');
});

test('proxy refusals: unknown, expired or other-port tokens, ports outside the set, nothing listening', async () => {
  const r = await rig();
  const other = r.tokens.issue(r.target + 1);
  assert.match((await get(r.port, previewPrefix(r.target, 'x'.repeat(24)))).text, /"TOKEN_UNKNOWN"/);
  assert.match((await get(r.port, previewPrefix(r.target, other))).text, /"TOKEN_PORT"/);
  const elsewhere = r.tokens.issue(4999);
  const out = await get(r.port, previewPrefix(4999, elsewhere));
  assert.equal(out.status, 403);
  assert.match(out.text, /"PORT_NOT_ALLOWED"/);
  r.held.push(4999);
  const gone = await get(r.port, previewPrefix(4999, elsewhere));
  assert.equal(gone.status, 502);
  assert.match(gone.text, /"NOT_LISTENING"/);
  assert.equal((await get(r.port, '/preview/nope')).status, 404);
  assert.equal(r.seen.length, 0, 'not one request reached the dev server');
});

test('proxy: a server that binds only ::1 (Vite on macOS) is found', async (t) => {
  const probe = net.createServer();
  const v6 = await new Promise((r) => { probe.once('error', () => r(false)); probe.listen(0, '::1', () => probe.close(() => r(true))); });
  if (!v6) return t.skip('no IPv6 loopback here');
  const r = await rig({ upstreamHost: '::1' });
  const page = await get(r.port, previewPrefix(r.target, r.token));
  assert.equal(page.status, 200);
});

test('proxy: WebSocket upgrades (HMR) pipe both ways; a bad token or port is refused before any byte goes up', async () => {
  const r = await rig();
  const base = previewPrefix(r.target, r.token);
  const ok = await rawUpgrade(r.port, `${base}?token=hmr`);
  assert.match(ok, /^HTTP\/1\.1 101/);
  assert.doesNotMatch(ok, /Set-Cookie/i);
  assert.match(ok, /echo:ping/);
  const up = r.seen.at(-1);
  assert.equal(up.url, '/?token=hmr');
  assert.equal(up.headers.origin, `http://localhost:${r.target}`, 'Origin null becomes the app\'s own');
  const n = r.seen.length;
  assert.match(await rawUpgrade(r.port, previewPrefix(r.target, 'y'.repeat(24))), /^HTTP\/1\.1 403/);
  assert.match(await rawUpgrade(r.port, previewPrefix(4998, r.tokens.issue(4998))), /^HTTP\/1\.1 403/);
  assert.match(await rawUpgrade(r.port, '/preview/x/'), /^HTTP\/1\.1 404/);
  assert.equal(r.seen.length, n);
});

test('proxy: a status below 100, or a 101 to a plain request, gets a 502 note, and Worca keeps serving', async () => {
  const raw = net.createServer((s) => {
    s.on('error', () => {});
    s.once('data', (d) => {
      const line = String(d);
      s.end(line.startsWith('GET /odd') ? 'HTTP/1.1 099 Weird\r\nContent-Length: 0\r\n\r\n'
        : line.startsWith('GET /switch') ? 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
          : 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok');
    });
  });
  const target = await listen(raw);
  const tokens = createPreviewTokens();
  const proxy = createPreviewProxy({ tokens, refuse: (p) => portRefusal(p, { held: [target] }) });
  const front = http.createServer((req, res) => proxy.handle(req, res));
  const port = await listen(front);
  const base = previewPrefix(target, tokens.issue(target));
  const odd = await get(port, `${base}odd`);
  assert.equal(odd.status, 502, 'writeHead(99) would throw in the response listener and end Worca');
  // Bounded: with no answer at all, a plain await would hang to the file's timeout instead of failing.
  const sw = await Promise.race([get(port, `${base}switch`), new Promise((r) => setTimeout(() => r({ status: 'no answer in 2 s', text: '' }), 2000))]);
  assert.deepEqual([sw.status, /"UPSTREAM"/.test(sw.text)], [502, true], 'a 101 emits neither response nor error');
  assert.equal((await get(port, `${base}fine`)).text, 'ok', 'still serving');
});

test('proxy: a tab that leaves mid-handshake leaves no socket open at the dev server', async () => {
  let upstreamSocket = null;
  let ended = false;
  const slow = http.createServer();
  slow.on('upgrade', (req, socket) => {   // never answers
    upstreamSocket = socket;
    socket.on('error', () => {});
    socket.once('end', () => { ended = true; });
    closers.push(async () => socket.destroy());
  });
  const target = await listen(slow);
  const tokens = createPreviewTokens();
  const proxy = createPreviewProxy({ tokens, refuse: (p) => portRefusal(p, { held: [target] }) });
  const front = http.createServer();
  front.on('upgrade', (req, socket, head) => proxy.upgrade(req, socket, head));
  const port = await listen(front);
  closers.push(async () => proxy.closeAll());
  const c = net.connect(port, '127.0.0.1');
  c.write(`GET ${previewPrefix(target, tokens.issue(target))} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  for (let i = 0; i < 100 && !upstreamSocket; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(upstreamSocket, 'precondition: the handshake reached the dev server');
  c.destroy();
  for (let i = 0; i < 100 && !ended; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(ended, true, 'the proxy closed its side');
});

test('proxy: a streamed answer the dev server cuts mid-body (a restart under SSE HMR) ends the browser\'s request too', async () => {
  const raw = net.createServer((s) => {
    s.on('error', () => {});
    s.once('data', () => {
      s.write('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n6\r\ndata:1\r\n');
      setTimeout(() => s.destroy(), 50);
    });
  });
  const target = await listen(raw);
  const tokens = createPreviewTokens();
  const proxy = createPreviewProxy({ tokens, refuse: (p) => portRefusal(p, { held: [target] }) });
  const front = http.createServer((req, res) => proxy.handle(req, res));
  const port = await listen(front);
  let settled = false;
  let status = 0;
  const r = http.get({ host: '127.0.0.1', port, path: `${previewPrefix(target, tokens.issue(target))}events` }, (res) => {
    status = res.statusCode;
    res.on('data', () => {});
    res.on('error', () => {});
    res.once('close', () => { settled = true; });
  });
  r.on('error', () => { settled = true; });
  // A flag, not an await: without the fix the response never ends, and an await would hang to the file's timeout.
  for (let i = 0; i < 100 && !settled; i++) await new Promise((d) => setTimeout(d, 10));
  r.destroy();
  assert.equal(status, 200, 'precondition: the stream started');
  assert.equal(settled, true, 'the cut reaches the browser');
});

test('proxy: a Worca that starts later on a token\'s port is refused once the host is resolved again, on pages and upgrades', async () => {
  let worca = false;
  const asked = [];
  const r = await rig({ hostCacheMs: 40, isWorca: async (host, port) => { asked.push([host, port]); return worca; } });
  const prefix = previewPrefix(r.target, r.token);
  assert.equal((await get(r.port, prefix)).status, 200, 'a dev server: served');
  assert.deepEqual(asked, [['127.0.0.1', r.target]], 'asked on the host it dials');
  assert.equal(await r.proxy.worcaAt(r.target), false);
  worca = true;   // the dev server went, a Worca now answers on the port
  assert.equal(await r.proxy.worcaAt(r.target), true, 'the mint\'s check asks afresh');
  await new Promise((d) => setTimeout(d, 60));   // past the host cache
  const before = r.seen.length;
  const page = await get(r.port, prefix, { headers: { origin: 'null' } });
  assert.equal(page.status, 409);
  assert.match(page.text, /"WORCA_INSTANCE"/);
  assert.match(String(page.headers['content-security-policy']), /^sandbox /);
  assert.match(await rawUpgrade(r.port, prefix), /^HTTP\/1\.1 409 /);
  assert.equal(r.seen.length, before, 'nothing reached the Worca');
});

test('proxy: one host probe for a burst of requests, and a probe that throws refuses', async () => {
  let calls = 0;
  const r = await rig({ isWorca: async () => { calls += 1; await new Promise((d) => setTimeout(d, 30)); return false; } });
  const prefix = previewPrefix(r.target, r.token);
  const all = await Promise.all([0, 1, 2, 3, 4].map(() => get(r.port, prefix)));
  assert.deepEqual(all.map((x) => x.status), [200, 200, 200, 200, 200]);
  assert.equal(calls, 1, 'a page\'s burst of asset requests shares one probe');
  const t = await rig({ isWorca: async () => { throw new Error('probe broke'); } });
  assert.equal((await get(t.port, previewPrefix(t.target, t.token))).status, 409, 'fails closed');
});

test('Pick shim: the parent turns it on; a click picks the element (the page never sees it); Escape cancels', async () => {
  const dom = new JSDOM('<body><main><p id="a">one</p><button>go</button></main></body>', { runScripts: 'outside-only', url: 'http://127.0.0.1:4317/preview/5173/tok/' });
  const w = dom.window;
  w.eval(PICK_SHIM);
  const got = [];
  w.addEventListener('message', (e) => { if (e.data && String(e.data.type).startsWith('worca-preview:pick')) got.push(e.data); });
  let pageClicks = 0;
  let winClicks = 0;
  w.addEventListener('click', () => { winClicks += 1; }, true);   // the page's own capture listener on window, after the shim's
  const btn = w.document.querySelector('button');
  btn.addEventListener('click', () => { pageClicks += 1; });
  w.document.elementFromPoint = () => btn;   // jsdom lays nothing out
  const fromParent = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: w }));
  const fromPage = (data) => w.dispatchEvent(new w.MessageEvent('message', { data, source: null }));
  fromPage({ type: 'worca-preview:pick', on: true });                    // not the parent: ignored
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(pageClicks, 1);
  fromParent({ type: 'worca-preview:pick', on: true });
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(pageClicks, 1, 'the picking click never reaches the page');
  assert.equal(winClicks, 1, 'not even a capture listener on window (stopImmediatePropagation)');
  const pick = got.find((m) => m.type === 'worca-preview:picked');
  assert.equal(pick.selector, cssSelector(btn));
  assert.match(pick.snippet, /<button>go<\/button>/);
  fromParent({ type: 'worca-preview:pick', on: true });
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(got.some((m) => m.type === 'worca-preview:pick-cancel'));
});

test('the proxy\'s own note pages carry their code in x-worca-preview-note', () => {
  const heads = {};
  const res = { writeHead: (s, h) => Object.assign(heads, h), end() {} };
  sendPreviewNote(res, 502, 'NOT_LISTENING', 'Nothing answers on this port yet.');
  assert.equal(heads['x-worca-preview-note'], 'NOT_LISTENING');
});

test('the Pick shim survives the latin1 send: ASCII only, and the page gets it byte for byte', () => {
  assert.match(PICK_SHIM, /^[\x00-\x7f]*$/);
  const html = rewriteHtml('<html><head></head><body><p>x</p></body></html>', { prefix: '/preview/5173/tok/', port: 5173, inject: true });
  assert.ok(Buffer.from(html, 'latin1').toString('utf8').includes(`<script>${PICK_SHIM}</script>`));
});

test('a revoked preview token is unknown at once', () => {
  const t = createPreviewTokens();
  const k = t.issue(5173);
  t.revoke(k);
  assert.equal(t.check(k, 5173), 'TOKEN_UNKNOWN');
});
