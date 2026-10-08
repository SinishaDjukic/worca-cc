// test/egress-policy.test.mjs — a hosting platform's outbound network policy
// (WORCA_EGRESS_MODE / _ALLOW / _DENY): parsing, matching, the proxy's decisions on a real
// socket, and the child environment worca hands out only while it enforces a policy.
// The Docker overlay's own behaviour (no mode) is in test/docker-files.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
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

test('child env: a scrubbed agent spawn keeps the proxy variables', () => {
  const vars = egressChildEnv('http://127.0.0.1:41234');
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try {
    const env = buildSpawnEnv(true, []);
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY', 'no_proxy']) assert.equal(env[k], vars[k], k);
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
