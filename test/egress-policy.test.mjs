// test/egress-policy.test.mjs — a hosting platform's outbound network policy
// (WORCA_EGRESS_MODE / _ALLOW / _DENY): parsing, matching, the proxy's decisions on a real
// socket, and the child environment worca hands out only while it enforces a policy.
// The Docker overlay's own behaviour (no mode) is in test/docker-files.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ALLOW, parseHostList, parseAllow, hostMatches, isAllowed, readEgressPolicy, decide,
  splitHostPort, normalizeHost, refusalText, createProxy,
} from '../src/core/egress-proxy.mjs';
import {
  startEgressPolicy, egressChildEnv, inheritsEgressProxy, egressNotice, egressSummary, EGRESS_PROXY_VAR,
} from '../src/core/egress-policy.mjs';
import { deploymentFacts } from '../src/core/deployment.mjs';
import { buildSpawnEnv } from '../src/core/claude-runner.mjs';

const PLATFORM_ALLOW = 'app.worca.dev,worca-run-broker.railway.internal';

test('mode: missing or blank is open and not enforced (an instance from before the policy)', () => {
  for (const env of [{}, { WORCA_EGRESS_MODE: '' }, { WORCA_EGRESS_MODE: '   ' }]) {
    const p = readEgressPolicy({ ...env, WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid' });
    assert.equal(p.mode, 'open');
    assert.equal(p.enforced, false);
  }
});

test('mode: open, block and allow, any case and padding; anything else fails closed as allow', () => {
  assert.deepEqual([readEgressPolicy({ WORCA_EGRESS_MODE: 'open' }).enforced, readEgressPolicy({ WORCA_EGRESS_MODE: 'open' }).mode], [false, 'open']);
  assert.equal(readEgressPolicy({ WORCA_EGRESS_MODE: ' BLOCK ' }).mode, 'block');
  assert.equal(readEgressPolicy({ WORCA_EGRESS_MODE: 'Allow' }).mode, 'allow');
  for (const bad of ['deny', 'off', 'allowlist', '0', 'opn']) {
    const p = readEgressPolicy({ WORCA_EGRESS_MODE: bad });
    assert.equal(p.mode, 'allow', bad);
    assert.equal(p.enforced, true, bad);
    assert.equal(p.invalidMode, bad);
  }
});

test('lists: comma-separated, trimmed, lower-cased; blanks, duplicates, ports and trailing dots dropped', () => {
  assert.deepEqual(parseHostList(' A.com, .B.org ,,a.com, ,'), ['a.com', '.b.org']);
  assert.deepEqual(parseHostList('Example.COM.,api.example.com:8443,.Sub.Example.com.'), ['example.com', 'api.example.com', '.sub.example.com']);
  assert.deepEqual(parseHostList(''), []);
  assert.deepEqual(parseHostList(undefined), []);
  assert.deepEqual(parseHostList(',,  ,'), []);
  // The platform's empty blocklist placeholder is an ordinary entry that matches nothing real.
  const p = readEgressPolicy({ WORCA_EGRESS_MODE: 'block', WORCA_EGRESS_DENY: '.invalid' });
  assert.deepEqual(p.deny, ['.invalid']);
  assert.equal(decide('example.com', p).ok, true);
  assert.equal(decide('github.com', p).ok, true);
  // DEFAULT_ALLOW belongs to the Docker overlay only: a mode never falls back to it.
  const a = readEgressPolicy({ WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: '', WORCA_EGRESS_DENY: '.invalid' });
  assert.deepEqual(a.allow, []);
  for (const h of DEFAULT_ALLOW.filter((x) => !x.startsWith('.'))) assert.equal(decide(h, a).ok, false, h);
  assert.deepEqual(parseAllow(''), [...DEFAULT_ALLOW], 'the overlay keeps its default');
});

test('matching: a leading dot is subdomains only under a mode; the overlay still matches the apex', () => {
  assert.equal(hostMatches('example.com', '.example.com', { subdomainsOnly: true }), false);
  assert.equal(hostMatches('api.example.com', '.example.com', { subdomainsOnly: true }), true);
  assert.equal(hostMatches('a.b.example.com', '.example.com', { subdomainsOnly: true }), true);
  assert.equal(hostMatches('notexample.com', '.example.com', { subdomainsOnly: true }), false, 'dot boundary');
  assert.equal(hostMatches('example.com', '.example.com'), true, 'legacy: the apex too');
  assert.equal(isAllowed('github.com', ['.github.com']), true, 'overlay behaviour unchanged');
  // Exact entries, case, trailing dot.
  assert.equal(hostMatches('API.Example.COM.', 'api.example.com', { subdomainsOnly: true }), true);
  assert.equal(hostMatches('evil-api.example.com', 'api.example.com', { subdomainsOnly: true }), false);
  assert.equal(hostMatches('x.api.example.com', 'api.example.com', { subdomainsOnly: true }), false);
  assert.equal(hostMatches('', 'a.com'), false);
});

test('host parsing: ports ignored, IPv6 brackets stripped', () => {
  assert.deepEqual(splitHostPort('Example.com:443'), { host: 'example.com', port: 443 });
  assert.deepEqual(splitHostPort('example.com'), { host: 'example.com', port: null });
  assert.deepEqual(splitHostPort('[::1]:8080'), { host: '::1', port: 8080 });
  assert.equal(normalizeHost('[2001:DB8::1]'), '2001:db8::1');
  assert.equal(normalizeHost('Example.com..'), 'example.com');
});

test('decide: allow mode lets only listed hosts through; block mode stops only listed ones; DENY wins', () => {
  const allow = readEgressPolicy({
    WORCA_EGRESS_MODE: 'allow',
    WORCA_EGRESS_ALLOW: `${PLATFORM_ALLOW},.acme.example,api.anthropic.com`,
    WORCA_EGRESS_DENY: 'secret.acme.example',
  });
  assert.equal(decide('app.worca.dev', allow).ok, true, 'the platform\'s own hosts are listed first');
  assert.equal(decide('worca-run-broker.railway.internal', allow).ok, true);
  assert.equal(decide('api.anthropic.com', allow).ok, true);
  assert.equal(decide('git.acme.example', allow).ok, true);
  assert.deepEqual(decide('acme.example', allow), { ok: false, rule: 'not-allowed' }, 'the apex is not a subdomain');
  assert.deepEqual(decide('secret.acme.example', allow), { ok: false, rule: 'deny' }, 'DENY wins over a matching ALLOW');
  assert.equal(decide('github.com', allow).ok, false);
  assert.equal(decide('', allow).ok, false);

  const block = readEgressPolicy({
    WORCA_EGRESS_MODE: 'block',
    WORCA_EGRESS_ALLOW: PLATFORM_ALLOW,
    WORCA_EGRESS_DENY: '.tracker.example, pastebin.example',
  });
  assert.equal(decide('github.com', block).ok, true);
  assert.equal(decide('registry.npmjs.org', block).ok, true);
  assert.equal(decide('pastebin.example', block).ok, false);
  assert.equal(decide('PASTEBIN.example.', block).ok, false);
  assert.equal(decide('a.tracker.example', block).ok, false);
  assert.equal(decide('tracker.example', block).ok, true, 'the apex of a subdomain entry stays reachable');
});

test('refusal text names the host and the organization\'s outbound policy', () => {
  const allow = readEgressPolicy({ WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid' });
  assert.match(refusalText('github.com', allow), /github\.com/);
  assert.match(refusalText('github.com', allow), /organization's outbound network policy/);
  assert.match(refusalText('github.com', allow), /not on the allowlist/);
  const block = readEgressPolicy({ WORCA_EGRESS_MODE: 'block', WORCA_EGRESS_DENY: 'evil.example' });
  assert.match(refusalText('evil.example', block), /on the blocklist/);
  assert.equal(refusalText('x.example', null), 'egress denied: x.example\n', 'the overlay keeps its text');
});

// --- the proxy on a real socket ---------------------------------------------------------------

function origin() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => res.end(`origin saw ${req.url}`));
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function rawRequest(port, text) {
  return new Promise((res, rej) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(text));
    let out = '';
    sock.on('data', (d) => { out += d; });
    sock.on('end', () => res(out));
    sock.on('error', rej);
    setTimeout(() => { sock.destroy(); res(out); }, 1500).unref();
  });
}

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}

test('proxy, allow mode: plain HTTP and CONNECT to a listed host pass; others get a legible 403', async () => {
  const o = await origin();
  const lines = [];
  const policy = readEgressPolicy({ WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: `${PLATFORM_ALLOW},127.0.0.1`, WORCA_EGRESS_DENY: '.invalid' });
  const proxy = createProxy({ policy, log: (l) => lines.push(l) });
  const pport = await listen(proxy);
  try {
    const ok = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/ok HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\nConnection: close\r\n\r\n`);
    assert.match(ok, /^HTTP\/1\.1 200/);
    assert.match(ok, /origin saw \/ok/);

    const tunnel = await rawRequest(pport, `CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\n\r\nGET /t HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(tunnel, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(tunnel, /origin saw \/t/);

    const http403 = await rawRequest(pport, 'GET http://github.com/ HTTP/1.1\r\nHost: github.com\r\nConnection: close\r\n\r\n');
    assert.match(http403, /^HTTP\/1\.1 403/);
    assert.match(http403, /x-worca-egress: denied/i);
    assert.match(http403, /outbound connection to github\.com refused: your organization's outbound network policy/);

    const connect403 = await rawRequest(pport, 'CONNECT GitHub.com.:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n');
    assert.match(connect403, /^HTTP\/1\.1 403 Forbidden/);
    assert.match(connect403, /content-length: \d+/i);
    assert.match(connect403, /outbound connection to github\.com refused/);

    assert.deepEqual(lines.map((l) => l.split(' ').slice(1, 3).join(' ')),
      ['ALLOW GET', 'ALLOW CONNECT', 'DENY GET', 'DENY CONNECT']);
  } finally {
    proxy.close();
    o.server.close();
  }
});

test('proxy, block mode: DENY refuses both CONNECT and HTTP, everything else relays', async () => {
  const o = await origin();
  const policy = readEgressPolicy({ WORCA_EGRESS_MODE: 'block', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: 'blocked.example,.bad.example' });
  const proxy = createProxy({ policy });
  const pport = await listen(proxy);
  try {
    const ok = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/any HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    assert.match(ok, /origin saw \/any/, 'an unlisted host is reachable in block mode');
    const h = await rawRequest(pport, 'GET http://blocked.example/ HTTP/1.1\r\nHost: blocked.example\r\nConnection: close\r\n\r\n');
    assert.match(h, /^HTTP\/1\.1 403/);
    assert.match(h, /blocked\.example/);
    const c = await rawRequest(pport, 'CONNECT x.bad.example:8443 HTTP/1.1\r\nHost: x.bad.example:8443\r\n\r\n');
    assert.match(c, /^HTTP\/1\.1 403/);
    assert.match(c, /on the blocklist/);
  } finally {
    proxy.close();
    o.server.close();
  }
});

// --- enforcement in worca's own process -------------------------------------------------------

test('child env: proxy variables only while enforcing; loopback is the only bypass', async () => {
  for (const mode of [undefined, '', 'open']) {
    const env = { WORCA_EGRESS_MODE: mode, WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid', PATH: '/bin' };
    if (mode === undefined) delete env.WORCA_EGRESS_MODE;
    const before = { ...env };
    const r = await startEgressPolicy({ env });
    assert.equal(r.status, 'off');
    assert.deepEqual(env, before, `mode ${mode}: env untouched`);
    assert.equal(egressNotice(r), null);
  }

  const env = { WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid', NO_PROXY: 'broker,github.com' };
  const r = await startEgressPolicy({ env });
  try {
    assert.equal(r.status, 'on');
    assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) assert.equal(env[k], r.url, k);
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1', 'a NO_PROXY entry would be a way around the policy');
    assert.equal(env.no_proxy, env.NO_PROXY);
    assert.equal(env[EGRESS_PROXY_VAR], r.url);
    assert.equal(inheritsEgressProxy(env), true);
    assert.match(egressNotice(r).text, /outbound network policy: allow \(allow 2 hosts, deny 0 hosts\)/);

    // A worca started under this one reuses the proxy instead of starting a second.
    const child = { ...env };
    const again = await startEgressPolicy({ env: child });
    assert.equal(again.status, 'inherited');
    assert.equal(child.HTTPS_PROXY, r.url);

    // The proxy actually answers with the policy.
    const port = Number(new URL(r.url).port);
    const denied = await rawRequest(port, 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    assert.match(denied, /^HTTP\/1\.1 403/);
  } finally {
    await r.close();
  }
});

test('child env: a scrubbed agent spawn keeps the proxy variables and the corporate-proxy marker', () => {
  const vars = egressChildEnv('http://127.0.0.1:41234', [], { corporate: true });
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try {
    const env = buildSpawnEnv(true, []);
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy', 'WORCA_CORPORATE_PROXY_URL']) assert.equal(env[k], vars[k], k);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('notice: an invalid mode and a replaced proxy are warnings', async () => {
  const env = { WORCA_EGRESS_MODE: 'strict', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid', HTTPS_PROXY: 'http://corp:3128' };
  const r = await startEgressPolicy({ env });
  try {
    const n = egressNotice(r);
    assert.equal(n.level, 'warn');
    assert.match(n.text, /WORCA_EGRESS_MODE="strict" is not open, block or allow, so allow applies/);
    assert.match(n.text, /replaced/);
    assert.notEqual(env.HTTPS_PROXY, 'http://corp:3128');
  } finally {
    await r.close();
  }
});

test('summary and Ask context: the mode, never the placeholder', () => {
  assert.deepEqual(egressSummary({}), { mode: 'open', enforced: false, allow: [], deny: [] });
  assert.deepEqual(egressSummary({ WORCA_EGRESS_MODE: 'block', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid' }),
    { mode: 'block', enforced: true, allow: [], deny: [] });
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1' }).egress, undefined);
  assert.equal(deploymentFacts({ WORCA_CONTAINER: '1', WORCA_EGRESS_MODE: 'open' }).egress, undefined);
  assert.equal(deploymentFacts({ WORCA_EGRESS_MODE: 'block' }, { remoteMode: true }).egress, 'block');
  assert.equal(deploymentFacts({ WORCA_EGRESS_MODE: 'nonsense' }, { remoteMode: true }).egress, 'allow');
});

test('the proxy module stays standalone: the image runs it as one file outside the package', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/core/egress-proxy.mjs', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const i of imports) assert.match(i, /^node:/, `${i} would not resolve from /usr/local/lib`);
});

// --- denial of service: nothing a client or an upstream does may take the proxy (and worca) down --

import { PROXY_LIMITS } from '../src/core/egress-proxy.mjs';
import { superviseProxy } from '../src/core/egress-policy.mjs';

const BLOCK = { mode: 'block', allow: [], deny: ['.invalid'] };

async function alive(pport, o) {
  const r = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/alive HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  assert.match(r, /origin saw \/alive/, 'the proxy still serves');
}

function closedPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

test('limits: sane defaults', () => {
  assert.ok(PROXY_LIMITS.maxConnections > 0 && PROXY_LIMITS.maxHeaderSize <= 64 * 1024);
  assert.ok(PROXY_LIMITS.headersTimeoutMs <= 60_000 && PROXY_LIMITS.connectTimeoutMs <= 60_000);
});

test('DoS: malformed CONNECT and request lines get 400, never an exception', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK });
  const pport = await listen(proxy);
  try {
    // An out-of-range port used to throw ERR_SOCKET_BAD_PORT from net.connect and kill the process.
    for (const target of ['example.com:99999', 'example.com:0', ':443', '[]:443', 'example.com:-1']) {
      const r = await rawRequest(pport, `CONNECT ${target} HTTP/1.1\r\nHost: x\r\n\r\n`);
      assert.match(r, /^HTTP\/1\.1 400/, target);
    }
    for (const line of ['GET /relative HTTP/1.1', 'GET https://example.com/ HTTP/1.1', 'GET ftp://example.com/ HTTP/1.1', 'GET http:// HTTP/1.1']) {
      const r = await rawRequest(pport, `${line}\r\nHost: x\r\nConnection: close\r\n\r\n`);
      assert.match(r, /^HTTP\/1\.1 400/, line);
    }
    const garbage = await rawRequest(pport, '\x00\x01\x02 not http at all\r\n\r\n');
    assert.match(garbage, /^HTTP\/1\.1 400|^$/);
    await alive(pport, o);
  } finally { proxy.close(); o.server.close(); }
});

test('DoS: an oversized request head is refused (431) and a slow one times out', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK, limits: { maxHeaderSize: 1024, headersTimeoutMs: 300 } });
  const pport = await listen(proxy);
  try {
    const big = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/ HTTP/1.1\r\nHost: x\r\nX-Pad: ${'a'.repeat(4096)}\r\n\r\n`);
    assert.match(big, /^HTTP\/1\.1 431/);
    // Slow loris: half a head, then silence. The proxy must hang up by itself.
    const closed = await new Promise((res) => {
      const sock = net.connect(pport, '127.0.0.1', () => sock.write('GET http://127.0.0.1/ HTTP/1.1\r\nHost: x\r\n'));
      sock.on('error', () => {});
      sock.on('close', () => res(true));
      setTimeout(() => { res(false); sock.destroy(); }, 3000).unref();
    });
    assert.equal(closed, true, 'an unfinished head is dropped after headersTimeout');
    await alive(pport, o);
  } finally { proxy.close(); o.server.close(); }
});

test('DoS: an upstream that refuses or never answers is a 502/504, not a crash or a hang', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK, limits: { connectTimeoutMs: 300 } });
  const pport = await listen(proxy);
  const dead = await closedPort();
  try {
    const c = await rawRequest(pport, `CONNECT 127.0.0.1:${dead} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(c, /^HTTP\/1\.1 502/);
    const h = await rawRequest(pport, `GET http://127.0.0.1:${dead}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(h, /^HTTP\/1\.1 502/);
    // A blackholed address: either the connect timeout (504) or an unreachable network (502).
    const t = await rawRequest(pport, 'CONNECT 10.255.255.1:443 HTTP/1.1\r\nHost: x\r\n\r\n');
    assert.match(t, /^HTTP\/1\.1 50[24]/);
    await alive(pport, o);
  } finally { proxy.close(); o.server.close(); }
});

test('DoS: an upstream that dies mid-response does not crash the proxy', async () => {
  const bad = http.createServer((req, res) => { res.writeHead(200, { 'content-length': '1000' }); res.write('partial'); setTimeout(() => res.socket.destroy(), 20); });
  await new Promise((r) => bad.listen(0, '127.0.0.1', r));
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK });
  const pport = await listen(proxy);
  try {
    const r = await rawRequest(pport, `GET http://127.0.0.1:${bad.address().port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(r, /partial/);
    await alive(pport, o);
  } finally { proxy.close(); bad.close(); o.server.close(); }
});

test('DoS: idle tunnels are closed, connections are capped, the proxy refuses to relay to itself', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK, limits: { idleTimeoutMs: 300, maxConnections: 2 } });
  const pport = await listen(proxy);
  try {
    const self = await rawRequest(pport, `CONNECT 127.0.0.1:${pport} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(self, /^HTTP\/1\.1 400/);

    const open = (text) => new Promise((res) => {
      const sock = net.connect(pport, '127.0.0.1', () => sock.write(text));
      let got = '';
      sock.on('data', (d) => { got += d; });
      sock.on('error', () => {});
      sock.on('close', () => res({ sock, got, closed: true }));
      setTimeout(() => res({ sock, got, closed: false }), 1500).unref();
    });
    // An idle tunnel: established, then silent. It must be closed by the idle timeout.
    const idle = await open(`CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(idle.got, /200 Connection Established/);
    assert.equal(idle.closed, true, 'idle tunnel closed');

    // Two held connections fill the cap; a third is dropped at accept.
    const held = [];
    for (let i = 0; i < 2; i++) {
      held.push(await new Promise((res) => { const s = net.connect(pport, '127.0.0.1', () => res(s)); s.on('error', () => {}); }));
    }
    await new Promise((r) => setTimeout(r, 50));
    const third = await new Promise((res) => {
      const s = net.connect(pport, '127.0.0.1', () => s.write('GET http://127.0.0.1/ HTTP/1.1\r\nHost: x\r\n\r\n'));
      let got = '';
      s.on('data', (d) => { got += d; });
      s.on('error', () => res('error'));
      s.on('close', () => res(got || 'closed'));
    });
    assert.ok(third === 'closed' || third === 'error', `third connection refused, got ${third}`);
    for (const s of held) s.destroy();
  } finally { proxy.close(); o.server.close(); }
});

test('DoS: a logger that throws cannot take the proxy down', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK, log: () => { throw new Error('log sink broke'); } });
  const pport = await listen(proxy);
  try {
    await alive(pport, o);
    const r = await rawRequest(pport, 'CONNECT x.invalid:443 HTTP/1.1\r\nHost: x\r\n\r\n');
    assert.match(r, /^HTTP\/1\.1 403/);
  } finally { proxy.close(); o.server.close(); }
});

test('supervisor: a proxy that stops listening comes back on the same port; stop() is final', async () => {
  const o = await origin();
  const proxy = createProxy({ policy: BLOCK });
  const pport = await listen(proxy);
  const lines = [];
  const sup = superviseProxy(proxy, pport, { log: (l) => lines.push(l), baseDelayMs: 20 });
  try {
    proxy.close();   // something closed it behind worca's back
    const back = await new Promise((res) => {
      const t0 = Date.now();
      const poll = () => (proxy.listening ? res(true) : Date.now() - t0 > 3000 ? res(false) : setTimeout(poll, 20));
      poll();
    });
    assert.equal(back, true);
    assert.equal(proxy.address().port, pport, 'children keep the address they were given');
    assert.equal(sup.restarts(), 1);
    await alive(pport, o);
    proxy.emit('error', new Error('EMFILE'));   // an error while listening is only logged
    assert.ok(lines.some((l) => /EMFILE/.test(l)));
    assert.equal(proxy.listening, true);
  } finally {
    await sup.stop();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(proxy.listening, false, 'not restarted after stop()');
    o.server.close();
  }
});

// --- the corporate proxy (settings networkProxy.enabled) ----------------------------------------

import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

const FLAG_OFF = () => false;
const FLAG_ON = () => true;
const CORP_SECRETS = ['Password', 'a4f49c406510bdcab6824ee7c30fd852', Buffer.from('Domain\\User:Password').toString('base64')];
const assertNoCorpSecrets = (text) => { for (const s of CORP_SECRETS) assert.ok(!String(text).includes(s), `secret in: ${text}`); };

test('corporate proxy: the default gate is settings networkProxy.enabled (no injection)', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  try {
    const offEnv = { HTTPS_PROXY: fake.url() };
    let settingsRead = 0;
    const counting = () => { settingsRead += 1; return { networkProxy: { enabled: false, upstream: fake.url(), fixedPort: 3128 } }; };
    const off = await startEgressPolicy({ env: offEnv, settings: counting });
    assert.equal(off.status, 'off');
    assert.deepEqual(offEnv, { HTTPS_PROXY: fake.url() });
    assert.equal(off.fixedPort, undefined, 'proxy off: no fixedPort is bound');
    assert.equal(settingsRead, 1, 'proxy off: networkProxy is read once, for enabled');
    const onEnv = { HTTPS_PROXY: fake.url() };
    const on = await startEgressPolicy({ env: onEnv, settings: () => ({ networkProxy: { enabled: true } }) });
    try {
      assert.equal(on.status, 'on');
      assert.equal(onEnv.HTTPS_PROXY, on.url);
    } finally { await on.close(); }
  } finally { await fake.close(); o.server.close(); }
});

test('corporate proxy, flag off, no login in HTTP(S)_PROXY: env untouched whatever settings say', async () => {
  const env = { HTTPS_PROXY: 'http://corp.example:8080', NO_PROXY: 'intranet.example', PATH: '/bin' };
  const before = { ...env };
  let settingsRead = 0;
  const r = await startEgressPolicy({ env, proxyOn: FLAG_OFF, settings: () => { settingsRead += 1; return { networkProxy: { upstream: 'http://x:1' } }; } });
  assert.equal(r.status, 'off');
  assert.deepEqual(env, before);
  assert.equal(settingsRead, 0, 'flag off: settings are not even read');
  assert.equal(egressNotice(r), null);
});

test('corporate proxy, flag on: HTTP(S)_PROXY becomes the upstream and children get a credential-free loopback URL', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port });
  const corpUrl = fake.url('Domain%5CUser:Password@');
  const env = { HTTPS_PROXY: corpUrl, NO_PROXY: 'intranet.example', ALL_PROXY: corpUrl, npm_config_https_proxy: corpUrl,
    npm_config_proxy: corpUrl.replace('%5C', '%5c'), PATH: '/bin' };   // a differently encoded copy is caught too
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings: () => ({}) });
  try {
    assert.equal(r.status, 'on');
    assert.equal(r.boundAddress, '127.0.0.1', 'loopback only, never 0.0.0.0');
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'npm_config_https_proxy', 'npm_config_proxy']) {
      assert.equal(env[k], r.url, k);
      assert.ok(!env[k].includes('@'), `${k} carries no credentials`);
    }
    assert.deepEqual([...r.scrubbedKeys].sort(), ['ALL_PROXY', 'npm_config_https_proxy', 'npm_config_proxy']);
    assert.equal(egressChildEnv(r.url, ['*']).NO_PROXY, '*', 'noProxy "*" is written alone');
    assert.equal(env.PATH, '/bin');
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1,intranet.example');
    assert.equal(env.WORCA_CORPORATE_PROXY_URL, r.url, 'flag on with a connector: the browser-launch marker (D14)');
    assert.equal(r.replacedProxy, false);
    assert.match(egressNotice(r).text, /^Corporate proxy: via 127\.0\.0\.1:\d+ \(NTLMv2\), logged in as Domain\\User, local proxy http:\/\/127\.0\.0\.1:\d+/);
    assertNoCorpSecrets(egressNotice(r).text);
    assertNoCorpSecrets(JSON.stringify(r.upstream));
    const tunnel = await rawRequest(Number(new URL(r.url).port), 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /t HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.match(tunnel, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(tunnel, /origin saw \/t/);
    assert.equal(fake.stats.type3, 1);

    const child = { ...env };
    const again = await startEgressPolicy({ env: child, proxyOn: FLAG_ON, settings: () => ({}) });
    assert.equal(again.status, 'inherited', 'a worca under this one reuses the proxy, never chains to it');
  } finally { await r.close(); await fake.close(); o.server.close(); }
});

test('corporate proxy + allow mode: allowed hosts are forwarded to the upstream, denied hosts never reach it', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const env = { WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: PLATFORM_ALLOW, WORCA_EGRESS_DENY: '.invalid', HTTPS_PROXY: fake.url() };
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings: () => ({}) });
  try {
    const port = Number(new URL(r.url).port);
    const ok = await rawRequest(port, 'CONNECT app.worca.dev:443 HTTP/1.1\r\nHost: app.worca.dev:443\r\n\r\nGET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.match(ok, /origin saw \/a/);
    const denied = await rawRequest(port, 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    assert.match(denied, /^HTTP\/1\.1 403/);
    assert.deepEqual(fake.stats.heads.map((h) => h.line), ['CONNECT app.worca.dev:443 HTTP/1.1']);
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1', 'the policy keeps loopback as the only bypass');
    assert.equal(env.WORCA_CORPORATE_PROXY_URL, r.url);
    const n = egressNotice(r);
    assert.doesNotMatch(n.text, /replaced/);
    assert.match(n.text, /then forwarded to the corporate proxy 127\.0\.0\.1:\d+ \(no login\)/);
  } finally { await r.close(); await fake.close(); o.server.close(); }
});

test('corporate proxy end to end: a child process fetch with the child env reaches the NTLM upstream', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port });
  const env = { HTTPS_PROXY: fake.url('Domain%5CUser:Password@') };
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings: () => ({}) });
  try {
    const envProxy = pathToFileURL(fileURLToPath(new URL('../src/core/env-proxy.mjs', import.meta.url))).href;
    const script = `import { useEnvProxy } from ${JSON.stringify(envProxy)}; useEnvProxy();
      const res = await fetch('http://example.test/x'); console.log(res.status, await res.text());`;
    // async execFile, never spawnSync: the local proxy runs on THIS process's event loop.
    const out = await new Promise((resolve, reject) => {
      execFile(process.execPath, ['--input-type=module', '-e', script],
        { env: { ...process.env, ...env, WORCA_HOST_PID: '' }, timeout: 20_000 },
        (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout.trim())));
    });
    // undici before v7 (Node 22) tunnels http:// targets with CONNECT, so the fake relays the GET to the origin;
    // later undici (Node 26) sends a plain proxy GET, which the fake answers itself. Either way it went upstream.
    const heads = JSON.stringify(fake.stats.heads);
    if (out === '200 origin saw /x') assert.ok(fake.stats.heads.some((h) => h.line === 'CONNECT example.test:80 HTTP/1.1'), heads);
    else {
      assert.equal(out, '200 upstream relayed GET http://example.test/x');
      assert.ok(fake.stats.heads.some((h) => h.line === 'GET http://example.test/x HTTP/1.1'), heads);
    }
    assert.equal(fake.stats.type3, 1);
    assert.ok(!JSON.stringify(env).includes('@'), 'the child env carries no credentials');
  } finally { await r.close(); await fake.close(); o.server.close(); }
});

test('corporate proxy, flag on: no upstream anywhere is off; a bad one is a warning without the URL', async () => {
  const env = { PATH: '/bin' };
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings: () => ({}) });
  assert.equal(r.status, 'off');
  assert.deepEqual(env, { PATH: '/bin' });
  const bad = await startEgressPolicy({ env: { HTTPS_PROXY: 'http://u:s3cret@corp.example:1' }, proxyOn: FLAG_ON,
    settings: () => ({ networkProxy: { upstream: 'https://corp.example:8443' } }) });
  assert.equal(bad.status, 'off');
  const n = egressNotice(bad);
  assert.equal(n.level, 'warn');
  assert.match(n.text, /^Corporate proxy: the upstream proxy must be an http:\/\/ URL/);
  assert.doesNotMatch(n.text, /s3cret|corp\.example:8443/);
});

// --- the saved login (worca proxy login, src/core/proxy-credentials.mjs) ------------------------

import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveProxyLogin, readProxyLogin, markLoginRejected, PROXY_LOGIN_FILE } from '../src/core/proxy-credentials.mjs';
import { ntHash } from '../src/core/ntlm.mjs';

const ACME = { domain: 'ACME', user: 'jdoe', password: 'S3cret!' };
const CONNECT_GH = 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /t HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n';

async function untilTrue(cond, ms = 3000, step = 10) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}

/** A fake NTLM upstream for ACME\jdoe / S3cret!, a temp home, and a policy started on it. */
async function savedLoginRig(t, { fakeOpts = {}, networkProxy = {}, password = 'S3cret!', marked = false, policyOpts = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'worca-egress-login-'));
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: o.port, ...fakeOpts });
  const saved = password ? saveProxyLogin({ ...ACME, password }, { home }) : null;
  if (saved && marked) markLoginRejected(saved.id, { home, upstream: `127.0.0.1:${fake.port}` });
  const logs = [];
  const env = {};
  const r = await startEgressPolicy({
    env, proxyOn: FLAG_ON, log: (l) => logs.push(l),
    settings: () => ({ networkProxy: { upstream: fake.url(), ...networkProxy } }),
    login: () => readProxyLogin({ home }),
    watchLogin: () => () => {},
    markRejected: (id, opts) => markLoginRejected(id, { ...opts, home }),
    ...policyOpts,
  });
  t.after(async () => { await r.close(); await fake.close(); o.server.close(); rmSync(home, { recursive: true, force: true }); });
  return { home, fake, r, logs, env, saved, port: r.url ? Number(new URL(r.url).port) : 0 };
}

test('saved login: one marked rejected boots tripped and the upstream sees no credentials', async (t) => {
  const { r, fake, port } = await savedLoginRig(t, { marked: true });
  assert.equal(r.connector.status().state, 'tripped');
  const n = egressNotice(r);
  assert.equal(n.level, 'warn');
  assert.match(n.text, /^Corporate proxy: via 127\.0\.0\.1:\d+ \(NTLMv2\): proxy needs login/);
  const out = await rawRequest(port, CONNECT_GH);
  assert.match(out, /^HTTP\/1\.1 407/);
  assert.equal(fake.stats.authHeaders.length, 0);
});

test('saved login: the boot line names it, and reloadLogin picks up a new save', async (t) => {
  const { r, home, port } = await savedLoginRig(t, { marked: true });
  const fresh = await savedLoginRig(t);
  const n = egressNotice(fresh.r);
  assert.equal(n.level, 'info');
  assert.match(n.text, /^Corporate proxy: via 127\.0\.0\.1:\d+ \(NTLMv2\), logged in as ACME\\jdoe, local proxy/);
  saveProxyLogin(ACME, { home });
  assert.equal(r.reloadLogin(), true);
  assert.equal(r.connector.status().state, 'unverified');
  assert.equal(r.reloadLogin(), false, 'nothing changed since');
  assert.match(await rawRequest(port, CONNECT_GH), /origin saw \/t/);
});

test('saved login: a marker written by a second process trips the running connector', async (t) => {
  const { r, home, fake, port, saved } = await savedLoginRig(t);
  assert.equal(markLoginRejected(saved.id, { home, upstream: 'x' }), true);   // e.g. worca proxy test
  assert.equal(r.reloadLogin(), true);
  assert.equal(r.connector.status().state, 'tripped');
  const before = fake.stats.authHeaders.length;
  assert.match(await rawRequest(port, CONNECT_GH), /^HTTP\/1\.1 407/);
  assert.equal(fake.stats.authHeaders.length, before);
});

test('saved login: a 407 to a handshake begun before a new login leaves the new login unmarked', async (t) => {
  const { r, home, fake, port } = await savedLoginRig(t, { password: 'wrong', fakeOpts: { holdType3: true } });
  const pending = rawRequest(port, CONNECT_GH);
  await untilTrue(() => fake.stats.type3 === 1);
  saveProxyLogin(ACME, { home });
  assert.equal(r.reloadLogin(), true);
  fake.release();
  assert.match(await pending, /^HTTP\/1\.1 407/);
  assert.equal(readProxyLogin({ home }).rejected, null);
  assert.equal(r.connector.status().state, 'unverified');
});

test('saved login: the default watcher swaps a new login in without a restart', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'worca-egress-watch-'));
  const prev = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', domain: 'ACME', user: 'jdoe', password: 'S3cret!', originPort: o.port });
  const r = await startEgressPolicy({ env: {}, proxyOn: FLAG_ON, loginPollMs: 50, settings: () => ({ networkProxy: { upstream: fake.url() } }) });
  t.after(async () => {
    await r.close(); await fake.close(); o.server.close();
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });
  assert.equal(r.connector.status().state, 'none', 'no login at boot');
  saveProxyLogin(ACME);   // the default home: WORCA_HOME/.worca-cc
  await untilTrue(() => r.connector.status().state === 'unverified', 3000, 25);
  assert.equal(r.connector.status().auth, 'auto');
});

test('saved login: a file that turns unreadable keeps a tripped connector tripped, logged once', { skip: process.platform === 'win32' }, async (t) => {
  const { r, home, logs, saved } = await savedLoginRig(t, { marked: true });
  chmodSync(join(home, PROXY_LOGIN_FILE), 0o644);
  assert.equal(r.reloadLogin(), false);
  assert.equal(r.connector.status().state, 'tripped');
  assert.equal(r.connector.status().loginId, saved.id);
  assert.equal(logs.filter((l) => /cannot be used/.test(l)).length, 1);
  assert.match(logs.find((l) => /cannot be used/.test(l)), /^Corporate proxy:/);
  const n = logs.length;
  assert.equal(r.reloadLogin(), false);
  assert.equal(logs.length, n, 'the same error is not logged again');
});

test('saved login: an explicit auth none never sends it, and the watcher leaves it alone', async (t) => {
  let watcher = null;
  const { r, home, fake, port } = await savedLoginRig(t, { networkProxy: { auth: 'none' }, policyOpts: { watchLogin: (fn) => { watcher = fn; return () => {}; } } });
  assert.equal(r.connector.status().auth, 'none');
  assert.ok(watcher, 'the watcher runs whenever the proxy is on (a swap may bring a login-taking upstream)');
  await rawRequest(port, CONNECT_GH);
  saveProxyLogin(ACME, { home });
  watcher();
  r.reloadLogin();
  assert.equal(r.connector.status().auth, 'none');
  await rawRequest(port, CONNECT_GH);
  assert.equal(fake.stats.authHeaders.length, 0);
});

test('saved login: a tripped handshake logs neither the password nor the hash', async (t) => {
  const { logs, port, r } = await savedLoginRig(t, { password: 'wrong' });
  assert.match(await rawRequest(port, CONNECT_GH), /^HTTP\/1\.1 407/);
  assert.equal(r.connector.status().state, 'tripped');
  assert.ok(logs.some((l) => /^Corporate proxy: .*did not accept/.test(l)), logs.join('\n'));
  const joined = logs.join('\n');
  for (const s of ['wrong', 'S3cret!', ntHash('wrong').toString('hex')]) assert.ok(!joined.includes(s), joined);
});

test('sourceEnv: the proxy variables before the swap, and never a parent\'s local proxy', async (t) => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const env = { HTTPS_PROXY: fake.url(), PATH: '/bin' };
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings: () => ({}), login: () => null });
  t.after(async () => { await r.close(); await fake.close(); o.server.close(); });
  assert.equal(r.sourceEnv.HTTPS_PROXY, fake.url());
  assert.equal(env.HTTPS_PROXY, r.url);
  const local = 'http://127.0.0.1:9';
  const child = { [EGRESS_PROXY_VAR]: local, HTTPS_PROXY: local, HTTP_PROXY: local, https_proxy: local, http_proxy: local, PATH: '/bin' };
  const inh = await startEgressPolicy({ env: child, proxyOn: FLAG_ON, settings: () => ({}) });
  assert.equal(inh.status, 'inherited');
  for (const k of [EGRESS_PROXY_VAR, 'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) assert.equal(k in inh.sourceEnv, false, k);
  const off = await startEgressPolicy({ env: { PATH: '/bin' }, proxyOn: FLAG_OFF });
  assert.deepEqual(off.sourceEnv, { PATH: '/bin' });
});

// ── Fixed local port (slice 3, D11-D14) ──
// `closedPort()` gives a port nothing listens on. A parallel process can take that port between
// closedPort() and the listen (an accepted, rare race: the test then fails with the EADDRINUSE
// message itself, and a re-run passes).
import { cmdProxy } from '../src/cli/proxy.mjs';
import { CORPORATE_PROXY_VAR } from '../src/core/proxy-credentials.mjs';

function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'worca-egress-fixedport-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test('fixedPort: the local proxy listens on 127.0.0.1:fixedPort and `worca proxy status` prints that URL', async (t) => {
  const fake = await startFakeUpstream({ scheme: 'none', originPort: 9 });
  t.after(() => fake.close());
  const port = await closedPort();
  const settings = () => ({ networkProxy: { upstream: fake.url(), fixedPort: port } });
  const env = {};
  const r = await startEgressPolicy({ env, proxyOn: FLAG_ON, settings, login: () => null });
  t.after(() => r.close());
  assert.equal(r.status, 'on');
  assert.equal(r.url, `http://127.0.0.1:${port}`);
  assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${port}`);
  assert.equal(env.WORCA_CORPORATE_PROXY_URL, `http://127.0.0.1:${port}`);
  const lines = [];
  const code = await cmdProxy(['status'], { out: (l) => lines.push(l), fail: () => {}, err: () => {}, env: {},
    settings: () => ({ networkProxy: { ...settings().networkProxy, enabled: true } }), home: tempHome(t) });
  assert.notEqual(code, 3, 'not needs-login');
  assert.ok(lines.includes(`Local proxy: http://127.0.0.1:${port}`), lines.join('\n'));
});

test('WORCA_CORPORATE_PROXY_URL: one value in proxy-credentials, spawn.mjs and the promo-kit cdp helper', async () => {
  const { SPAWN_ENV_BASE } = await import('../src/core/engines/spawn.mjs');
  assert.equal(CORPORATE_PROXY_VAR, 'WORCA_CORPORATE_PROXY_URL');
  assert.ok(SPAWN_ENV_BASE.includes(CORPORATE_PROXY_VAR), 'a scrubbed agent spawn keeps the marker');
  const cdp = readFileSync(fileURLToPath(new URL('../assets/promo-kit/tools/cdp.mjs', import.meta.url)), 'utf8');
  assert.ok(cdp.includes(`env.${CORPORATE_PROXY_VAR}`), 'cdp.mjs (a standalone asset) reads the same name');
});

test('fixedPort busy (another program): a clear EADDRINUSE error naming the port and the setting', async (t) => {
  const squatter = net.createServer((c) => c.destroy());
  await new Promise((r) => squatter.listen(0, '127.0.0.1', r));
  t.after(() => squatter.close());
  const port = squatter.address().port;
  const settings = () => ({ networkProxy: { upstream: 'http://127.0.0.1:9', fixedPort: port } });
  const r = await startEgressPolicy({ env: {}, proxyOn: FLAG_ON, settings, login: () => null });
  assert.equal(r.status, 'off');
  assert.equal(r.upstreamError, `the local proxy cannot listen on 127.0.0.1:${port}: another program already uses that port (EADDRINUSE). Free the port or change networkProxy.fixedPort`);
  assert.match(egressNotice(r).text, /^Corporate proxy: the local proxy cannot listen on 127\.0\.0\.1:\d+/);
  assert.equal(egressNotice(r).level, 'warn');
  await assert.rejects(startEgressPolicy({ env: { WORCA_EGRESS_MODE: 'block' }, proxyOn: FLAG_ON, settings, login: () => null }),
    /cannot listen on 127\.0\.0\.1:\d+: another program already uses that port \(EADDRINUSE\)/);
});

test('fixedPort held by another Worca: this one falls back to a free port and says so', async (t) => {
  const port = await closedPort();
  const settings = () => ({ networkProxy: { upstream: 'http://127.0.0.1:9', fixedPort: port } });
  const first = await startEgressPolicy({ env: {}, proxyOn: FLAG_ON, settings, login: () => null });
  t.after(() => first.close());
  const second = await startEgressPolicy({ env: {}, proxyOn: FLAG_ON, settings, login: () => null });
  t.after(() => second.close());
  assert.equal(second.status, 'on');
  assert.notEqual(second.url, `http://127.0.0.1:${port}`);
  assert.equal(second.fixedPortShared, true);
  assert.match(egressNotice(second).text, new RegExp(`127\\.0\\.0\\.1:${port} is served by another Worca`));
});

test('fixedPort, flag off with an enforced policy: the policy proxy starts on another port and settings are not read', async (t) => {
  const port = await closedPort();
  let reads = 0;
  // An enforced policy starts a local proxy even with the flag off: the case where fixedPort could leak in.
  const r = await startEgressPolicy({ env: { WORCA_EGRESS_MODE: 'block', HTTPS_PROXY: 'http://corp.example:8080' }, proxyOn: FLAG_OFF,
    settings: () => { reads += 1; return { networkProxy: { fixedPort: port } }; } });
  t.after(() => r.close());
  assert.equal(r.status, 'on');
  assert.notEqual(r.url, `http://127.0.0.1:${port}`);
  assert.equal(reads, 0);
  assert.equal(r.fixedPort, undefined);
  const refused = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(true));
  });
  assert.equal(refused, true);
});

// ── Live changes (setup assistant slice 2, D7–D10): swap the upstream without a restart ──
import { mock } from 'node:test';
import { writeFileSync } from 'node:fs';
import { createUpstreamConnector, resolveUpstream } from '../src/core/upstream-proxy.mjs';
import { setNetworkProxy, settingsFile } from '../src/core/settings.mjs';

/** Open a CONNECT tunnel and keep it; send() writes one keep-alive GET and resolves with the reply. */
function openTunnel(port, target) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let buf = ''; let waiter = null;
    sock.on('data', (d) => {
      buf += d;
      if (!waiter && /^HTTP\/1\.1 200/.test(buf) && buf.includes('\r\n\r\n')) { buf = ''; resolve(tunnel); return; }
      if (waiter && /origin saw \S+/.test(buf)) { const w = waiter; waiter = null; const out = buf; buf = ''; w(out); }
    });
    sock.on('error', reject);
    const tunnel = { send: (path) => new Promise((r) => { waiter = r; sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`); }), close: () => sock.destroy(), sock };
  });
}

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('useConnector: new tunnels take the new connector, an open tunnel finishes on the old one, which then closes', async () => {
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const b = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const conn = (fake) => {
    const c = createUpstreamConnector(resolveUpstream({ env: {}, settings: { upstream: fake.url() } }));
    const close = c.close; c.closed = 0; c.close = () => { c.closed += 1; close(); };
    return c;
  };
  const ca = conn(a); const cb = conn(b);
  const server = createProxy({ policy: { mode: 'open', allow: [], deny: [] }, connector: ca });
  await listen(server);
  const port = server.address().port;
  try {
    const old = await openTunnel(port, 'github.com:443');
    assert.equal(server.useConnector(cb, {}), ca, 'returns the connector it replaced');
    assert.equal(server.connector(), cb);
    assert.equal(ca.closed, 0, 'an open tunnel keeps the old connector alive');
    assert.match(await old.send('/still-a'), /origin saw \/still-a/);
    const aSockets = a.stats.sockets;
    const fresh = await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.match(fresh, /origin saw \/b/);
    assert.equal(a.stats.sockets, aSockets, 'the new tunnel never reached A');
    assert.ok(b.stats.sockets >= 1, 'it went through B');
    old.close();
    const t0 = Date.now();
    while (ca.closed === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ca.closed, 1, 'the old connector closed once its last tunnel ended');
    server.useConnector(null);
    const direct = await rawRequest(port, `CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: x\r\n\r\nGET /d HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(direct, /origin saw \/d/);
  } finally { server.close(); await a.close(); await b.close(); o.server.close(); }
});

import { startLiveEgress, liveKeyOf, isWorcaProxy } from '../src/core/egress-policy.mjs';

test('AC-2.2: a changed host applies to new connections; HTTPS_PROXY stays the same', async () => {
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const b = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const env = { PATH: '/bin' };
  let np = { enabled: true, upstream: a.url() };
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: np }), login: () => null, watch: () => () => {} });
  try {
    const r = live.current();
    assert.equal(r.status, 'on');
    const url = env.HTTPS_PROXY;
    const port = Number(new URL(url).port);
    const old = await openTunnel(port, 'github.com:443');
    np = { enabled: true, upstream: b.url() };
    const out = await live.apply(np);
    assert.equal(out.changed, true);
    assert.equal(env.HTTPS_PROXY, url, 'children keep the same HTTPS_PROXY');
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${b.port}`);
    const bBefore = b.stats.sockets;
    assert.match(await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /n HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /origin saw \/n/);
    assert.ok(b.stats.sockets > bBefore);
    assert.match(await old.send('/o'), /origin saw \/o/, 'the open tunnel finishes on A');
    old.close();
  } finally { await live.close(); await a.close(); await b.close(); o.server.close(); }
});

test('AC-2.3/AC-2.4: off at boot starts nothing; turning on starts the local proxy; turning off goes direct on the same address', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const env = { PATH: '/bin' };
  const onEnvChange = mock.fn();
  const live = await startLiveEgress({ env, settings: () => ({}), login: () => null, watch: () => () => {}, onEnvChange });
  try {
    assert.equal(live.current().status, 'off');
    assert.deepEqual(env, { PATH: '/bin' }, 'never on: no local proxy, env untouched');
    await live.apply({ enabled: true, upstream: fake.url() });
    assert.equal(live.current().status, 'on');
    const url = env.HTTPS_PROXY;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(onEnvChange.mock.callCount(), 1, 'Worca re-installs its fetch dispatcher (D8)');
    const port = Number(new URL(url).port);
    assert.match(await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /on HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /origin saw \/on/);
    await live.apply({ enabled: false, upstream: fake.url() });
    assert.equal(env.HTTPS_PROXY, url);
    assert.equal(env.WORCA_CORPORATE_PROXY_URL, undefined, 'off: no browser-launch marker');
    assert.equal(live.current().connector, null);
    const before = fake.stats.sockets;
    assert.match(await rawRequest(port, `CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: x\r\n\r\nGET /off HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`), /origin saw \/off/);
    assert.equal(fake.stats.sockets, before, 'off: the upstream is never contacted');
  } finally { await live.close(); await fake.close(); o.server.close(); }
});

test('AC-2.6: a second process watching settings.json swaps within 5 s', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'worca-live-'));
  const prevHome = process.env.HOME; process.env.HOME = home;
  t.after(() => { process.env.HOME = prevHome; rmSync(home, { recursive: true, force: true }); });
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const b = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  await setNetworkProxy({ enabled: true, upstream: a.url() });
  const live = await startLiveEgress({ env: { PATH: '/bin' }, login: () => null, pollMs: 200 });
  try {
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${a.port}`);
    await setNetworkProxy({ upstream: b.url() });          // as the server's save, from another process
    const t0 = Date.now();
    while (live.current().upstream?.upstream !== `127.0.0.1:${b.port}` && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${b.port}`);
    assert.ok(Date.now() - t0 < 5000);
  } finally { await live.close(); await a.close(); await b.close(); o.server.close(); }
});

test('AC-2.7 (core): a fixedPort change switches at once; the old port keeps answering for the children holding it', async () => {
  const fake = await startFakeUpstream({ scheme: 'none', originPort: 1 });
  const p1 = await freePort(); const p2 = await freePort();
  const env = {}; let envChanges = 0;
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: { enabled: true, upstream: fake.url(), fixedPort: p1 } }), login: () => null, watch: () => () => {}, onEnvChange: () => { envChanges += 1; } });
  try {
    assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${p1}`);
    const out = await live.apply({ enabled: true, upstream: fake.url(), fixedPort: p2 });
    assert.deepEqual(out.pending, []);
    assert.equal(out.changed, true);
    assert.equal(out.portSwitched, p2);
    assert.equal(await isWorcaProxy(p1), true, 'the old port still answers');
    assert.equal(await isWorcaProxy(p2), true, 'the new port answers now');
    assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${p2}`, 'new children get the new port');
    assert.equal(live.current().url, `http://127.0.0.1:${p2}`);
    assert.equal(live.current().fixedPort, p2);
    assert.equal(envChanges, 1);
    assert.deepEqual((await live.apply({ enabled: true, upstream: fake.url(), fixedPort: p2 })).pending, [], 'applying it again changes nothing');
  } finally { await live.close(); await fake.close(); }
  assert.equal(await isWorcaProxy(p2), false, 'close() stops the extra listener too');
});

test('AC-2.7 (core): a new fixedPort that another program holds is said at once; the proxy stays where it was', async () => {
  const fake = await startFakeUpstream({ scheme: 'none', originPort: 1 });
  const p1 = await freePort();
  const holder = net.createServer().listen(0, '127.0.0.1'); await once(holder, 'listening');
  const taken = holder.address().port;
  const env = {};
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: { enabled: true, upstream: fake.url(), fixedPort: p1 } }), login: () => null, watch: () => () => {} });
  try {
    const out = await live.apply({ enabled: true, upstream: fake.url(), fixedPort: taken });
    assert.match(out.upstreamError, /^saved, but the local proxy cannot listen on 127\.0\.0\.1:\d+: another program already uses that port/);
    assert.equal(out.changed, false);
    assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${p1}`);
    assert.equal(await isWorcaProxy(p1), true);
  } finally { await live.close(); await fake.close(); holder.close(); }
});

test('liveKeyOf: key order and fixedPort do not change the key', () => {
  assert.equal(liveKeyOf({ upstream: 'http://p:1', enabled: true, fixedPort: 1 }), liveKeyOf({ enabled: true, upstream: 'http://p:1' }));
  assert.notEqual(liveKeyOf({ enabled: true, upstream: 'http://p:1' }), liveKeyOf({ enabled: true, upstream: 'http://p:2' }));
});

test('R-sec-5: a settings.json that is not JSON, or is deleted, leaves the running connector alone (real watcher)', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'worca-live-'));
  const prevHome = process.env.HOME; process.env.HOME = home;
  t.after(() => { process.env.HOME = prevHome; rmSync(home, { recursive: true, force: true }); });
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  await setNetworkProxy({ enabled: true, upstream: a.url() });
  const live = await startLiveEgress({ env: { PATH: '/bin' }, login: () => null, pollMs: 50 });
  try {
    const conn = live.current().connector;
    writeFileSync(settingsFile(), '{not json');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(live.current().connector, conn, 'bad JSON: same connector');
    rmSync(settingsFile());
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(live.current().connector, conn, 'deleted file: same connector');
  } finally { await live.close(); await a.close(); o.server.close(); }
});

test('Decision 6a: a swap to an upstream that does not resolve keeps the running connector', async () => {
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const live = await startLiveEgress({ env: { PATH: '/bin' }, settings: () => ({ networkProxy: { enabled: true, upstream: a.url() } }), login: () => null, watch: () => () => {} });
  try {
    const conn = live.current().connector;
    const out = await live.apply({ enabled: true, upstream: 'http://:0' });
    assert.equal(out.changed, false);
    assert.ok(out.upstreamError);
    assert.equal(live.current().connector, conn);
  } finally { await live.close(); await a.close(); o.server.close(); }
});

test('R-sec-6: after a swap to a credentialed upstream, only the local URL is in env', async () => {
  const o = await origin();
  const a = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const b = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const env = { PATH: '/bin' };
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: { enabled: true, upstream: a.url() } }), login: () => null, watch: () => () => {} });
  try {
    env.MY_TOOL_PROXY = `http://u:secret@127.0.0.1:${b.port}`;   // set after boot, under a non-proxy name
    assert.match(env.MY_TOOL_PROXY, /secret/, 'precondition: the credentialed value is in env before the swap');
    const out = await live.apply({ enabled: true, upstream: `http://u:secret@127.0.0.1:${b.port}`, auth: 'basic' });
    assert.equal(out.changed, true, 'the swap really happened (security-2-1: never pass vacuously)');
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${b.port}`);
    assert.equal(env.MY_TOOL_PROXY, env.HTTPS_PROXY, 'the scrubbed variable now names the local URL');
    for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /secret/, `${k} carries no userinfo`);
  } finally { await live.close(); await a.close(); await b.close(); o.server.close(); }
});

// --- a login in HTTP(S)_PROXY with networkProxy.enabled unset: the proxy starts anyway ----------------

for (const scheme of ['ntlm', 'basic', 'digest']) {
  test(`credentialed HTTPS_PROXY, enabled unset (${scheme} upstream): the proxy starts, children get no password, requests go through`, async () => {
    const o = await origin();
    const fake = await startFakeUpstream({ scheme, originPort: o.port });
    const corpUrl = fake.url('Domain%5CUser:Password@');
    const env = { HTTPS_PROXY: corpUrl, HTTP_PROXY: corpUrl, PATH: '/bin' };
    const logs = [];
    const r = await startEgressPolicy({ env, settings: () => ({}), login: () => null, watchLogin: () => () => {}, log: (l) => logs.push(l) });
    try {
      assert.equal(r.status, 'on');
      assert.equal(r.autoStarted, true);
      for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /Password/, `${k} carries no password`);
      assert.equal(env.HTTPS_PROXY, r.url);
      assert.match(egressNotice(r).text, /started because HTTP\(S\)_PROXY carries a login/);
      const port = Number(new URL(r.url).port);
      assert.match(await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /t HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /origin saw \/t/);
      assert.match(await rawRequest(port, `GET http://127.0.0.2:${o.port}/plain HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 200[^]*upstream relayed GET .*\/plain/);
      if (scheme === 'ntlm') {
        assert.ok(fake.stats.type3 >= 1);
        assert.equal(fake.stats.basic + fake.stats.digest, 0, 'NTLM offered: no password scheme');
      } else {
        assert.ok(fake.stats[scheme] >= 1, `the URL login went as ${scheme}`);
        assert.ok(logs.some((l) => /offers no NTLM, so the login from HTTPS_PROXY is sent as/.test(l)), logs.join('\n'));
      }
      for (const l of logs) assert.doesNotMatch(l, /Password/);
    } finally { await r.close(); await fake.close(); o.server.close(); }
  });
}

test('credentialed HTTPS_PROXY, enabled true: auth auto still never falls back to Basic', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const env = { HTTPS_PROXY: fake.url('Domain%5CUser:Password@'), PATH: '/bin' };
  const r = await startEgressPolicy({ env, settings: () => ({ networkProxy: { enabled: true } }), login: () => null, watchLogin: () => () => {} });
  try {
    assert.equal(r.autoStarted, false);
    const out = await rawRequest(Number(new URL(r.url).port), 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n');
    assert.match(out, /^HTTP\/1\.1 502/);
    assert.match(out, /offers only Basic/);
    assert.equal(fake.stats.basic, 0);
  } finally { await r.close(); await fake.close(); o.server.close(); }
});

test('credentialed HTTPS_PROXY, enabled false: nothing starts, env untouched, and the notice says children go direct', async () => {
  const env = { HTTPS_PROXY: 'http://ACME%5Cjdoe:pw@corp.example:8080', PATH: '/bin' };
  const before = { ...env };
  const r = await startEgressPolicy({ env, settings: () => ({ networkProxy: { enabled: false } }) });
  assert.equal(r.status, 'off');
  assert.equal(r.loginWithheld, true);
  assert.deepEqual(env, before);
  const n = egressNotice(r);
  assert.equal(n.level, 'warn');
  assert.match(n.text, /turned off \(networkProxy\.enabled is false\).*get no proxy and go direct; turn on Use a corporate proxy/);
  assert.doesNotMatch(n.text, /pw|jdoe/);
});

test('auto-started proxy: a save that leaves enabled unset keeps the upstream; enabled false drops it', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const env = { HTTPS_PROXY: fake.url('Domain%5CUser:Password@'), PATH: '/bin' };
  const live = await startLiveEgress({ env, settings: () => ({}), login: () => null, watchLogin: () => () => {}, watch: () => () => {} });
  try {
    assert.equal(live.current().autoStarted, true);
    const port = Number(new URL(env.HTTPS_PROXY).port);
    const out = await live.apply({ noProxy: 'intranet.example' });
    assert.equal(out.changed, true);
    assert.ok(live.current().connector, 'still chained to the upstream from HTTPS_PROXY');
    assert.match(await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /kept HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /origin saw \/kept/);
    await live.apply({ enabled: false });
    assert.equal(live.current().connector, null);
    for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /Password/, `${k} carries no password`);
  } finally { await live.close(); await fake.close(); o.server.close(); }
});

for (const scheme of ['basic', 'digest']) {
  test(`auto-started proxy, ${scheme} upstream: plain HTTP as the very first request falls back too`, async () => {
    const o = await origin();
    const fake = await startFakeUpstream({ scheme, originPort: o.port });
    const env = { HTTPS_PROXY: fake.url('Domain%5CUser:Password@'), PATH: '/bin' };
    const r = await startEgressPolicy({ env, settings: () => ({}), login: () => null, watchLogin: () => () => {} });
    try {
      const port = Number(new URL(r.url).port);
      assert.match(await rawRequest(port, `GET http://127.0.0.2:${o.port}/first HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 200[^]*upstream relayed GET .*\/first/);
      assert.match(await rawRequest(port, `GET http://127.0.0.2:${o.port}/second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 200[^]*\/second/);
      assert.ok(fake.stats[scheme] >= 2);
    } finally { await r.close(); await fake.close(); o.server.close(); }
  });
}

test('auto-start chains to the HTTPS_PROXY that carries the login, never to an upstream left in settings', async () => {
  const o = await origin();
  const envProxy = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const stale = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const env = { HTTPS_PROXY: envProxy.url('Domain%5CUser:Password@'), PATH: '/bin' };
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: { upstream: stale.url() } }), login: () => null,
    watchLogin: () => () => {}, watch: () => () => {} });
  try {
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${envProxy.port}`);
    await live.apply({ upstream: stale.url(), noProxy: 'intranet.example' });
    assert.equal(live.current().upstream.upstream, `127.0.0.1:${envProxy.port}`, 'a live save keeps it too');
    const port = Number(new URL(env.HTTPS_PROXY).port);
    assert.match(await rawRequest(port, 'CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\nGET /env HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'), /origin saw \/env/);
    assert.equal(stale.stats.sockets, 0, 'the settings upstream is never contacted');
  } finally { await live.close(); await envProxy.close(); await stale.close(); o.server.close(); }
});

test('opted out at boot: clearing networkProxy.enabled auto-starts without a restart', async () => {
  const o = await origin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const env = { HTTPS_PROXY: fake.url('Domain%5CUser:Password@'), PATH: '/bin' };
  const live = await startLiveEgress({ env, settings: () => ({ networkProxy: { enabled: false } }), login: () => null,
    watchLogin: () => () => {}, watch: () => () => {} });
  try {
    assert.equal(live.current().status, 'off');
    const out = await live.apply({});
    assert.equal(out.changed, true);
    assert.equal(live.current().status, 'on');
    assert.equal(live.current().autoStarted, true);
    for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /Password/, `${k} carries no password`);
  } finally { await live.close(); await fake.close(); o.server.close(); }
});
