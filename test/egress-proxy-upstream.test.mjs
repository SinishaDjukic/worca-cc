// test/egress-proxy-upstream.test.mjs — the local proxy chained to a fake corporate proxy on real sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createProxy } from '../src/core/egress-proxy.mjs';
import { resolveUpstream, createUpstreamConnector } from '../src/core/upstream-proxy.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

const OPEN = { mode: 'open', allow: [], deny: [] };
const CLIENT_AUTHZ = 'Basic Y2xpZW50OnNlY3JldA==';   // a client's own Proxy-Authorization: must never be forwarded
const BASIC_TOKEN = Buffer.from('Domain\\User:Password').toString('base64');
const SECRETS = ['Password', 'a4f49c406510bdcab6824ee7c30fd852', BASIC_TOKEN];

/** Fails when any text a test collected (log lines, response bodies, notices) carries a secret. */
function assertNoSecrets(texts) {
  const joined = texts.join('\n');
  for (const s of SECRETS) assert.ok(!joined.includes(s), `a secret leaked: ${joined}`);
}

function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

/** An http origin that records the headers of every request it gets. */
function headerOrigin() {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => { seen.push(req.headers); res.end('origin ok'); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port, seen }));
  });
}

/** A port nothing listens on: bind port 0, read it, close the server. */
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function chain(fake, { creds = 'Domain%5CUser:Password@', settings = {}, policy = OPEN, upstreamUrl } = {}) {
  const logs = [];
  const upstream = resolveUpstream({ env: { HTTPS_PROXY: upstreamUrl || fake.url(creds) }, settings });
  const connector = createUpstreamConnector(upstream, { log: (l) => logs.push(l) });
  const proxy = createProxy({ policy, connector, log: (l) => logs.push(l) });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return { connector, logs, port: proxy.address().port, close: () => { proxy.close(); connector.close(); } };
}

/** CONNECT through the local proxy (with CLIENT_AUTHZ); resolves with everything read. A refusal
 *  ends when the proxy closes the socket (rawReply); a tunnel ends once `send` has come back as
 *  `echo:<send>`. `timeoutMs` bounds the whole exchange (raised for the Windows closed-port case). */
function connectVia(port, target, { send = 'ping', timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${CLIENT_AUTHZ}\r\n\r\n`));
    let out = '';
    let sent = false;
    s.on('data', (d) => {
      out += d;
      if (!/^HTTP\/1\.1 200/.test(out)) return;
      if (!sent && out.includes('\r\n\r\n')) { sent = true; s.write(send); }
      if (out.includes(`echo:${send}`)) { s.destroy(); resolve(out); }
    });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));   // ECONNRESET on Windows, EPIPE on Linux: the text read so far decides
    setTimeout(() => { s.destroy(); resolve(out); }, timeoutMs).unref();
  });
}

/** A plain absolute-form request through the local proxy; resolves { status, headers, body }. */
function httpVia(port, url, { method = 'GET', body = '', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, agent: false,
      headers: { host: new URL(url).host, 'proxy-authorization': CLIENT_AUTHZ, 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('httpVia timed out')));
    req.end(body);
  });
}

test('NTLM CONNECT: Type 1 and Type 3 on ONE upstream socket, then bytes tunnel both ways', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port });
  const c = await chain(fake);
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(out, /echo:ping/);
    assert.equal(fake.stats.sockets, 1);
    assert.equal(fake.stats.type1, 1);
    assert.equal(fake.stats.type3, 1);
    assert.deepEqual(fake.stats.heads.map((h) => [h.socket, h.line]),
      [[1, 'CONNECT github.com:443 HTTP/1.1'], [1, 'CONNECT github.com:443 HTTP/1.1']]);
    assert.ok(!fake.stats.authHeaders.includes(CLIENT_AUTHZ), 'the client\'s own Proxy-Authorization is never forwarded');
    assert.equal(c.connector.status().state, 'verified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

for (const headNoBody407 of [true, false]) {
  test(`Plain HTTP over NTLM: HEAD probe then GET on ONE socket, response delivered (407 to HEAD ${headNoBody407 ? 'without' : 'with'} a body)`, async () => {
    const o = await echoOrigin();
    const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, headNoBody407 });
    const c = await chain(fake);
    const seen = [];
    try {
      const r = await httpVia(c.port, 'http://example.test/x');
      seen.push(r.body);
      assert.equal(r.status, 200, 'the paused upstream socket is resumed, so the response arrives');
      assert.equal(r.body, 'upstream relayed GET http://example.test/x');
      assert.deepEqual(fake.stats.heads.map((h) => [h.socket, h.line.split(' ')[0]]), [[1, 'HEAD'], [1, 'GET']]);
      assert.equal(fake.stats.type3, 1);
      assert.ok(!fake.stats.authHeaders.includes(CLIENT_AUTHZ), 'plain HTTP drops the client Proxy-Authorization too');
    } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
  });
}

test('Basic CONNECT (auth basic): the exact Basic header goes out, never the client\'s', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const c = await chain(fake, { settings: { auth: 'basic' } });
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(out, /echo:ping/);
    assert.equal(fake.stats.authHeaders[0], `Basic ${BASIC_TOKEN}`);
    assert.ok(!fake.stats.authHeaders.includes(CLIENT_AUTHZ));
    assert.equal(c.connector.status().state, 'verified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('auth none: no Proxy-Authorization reaches the upstream and the tunnel works', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: o.port });
  const c = await chain(fake, { creds: '' });
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /echo:ping/);
    assert.deepEqual(fake.stats.authHeaders, []);
    assert.equal(c.connector.status().state, 'none');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('auth none against an upstream that asks for a login: 407 needs-login', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port });
  const c = await chain(fake, { creds: '' });
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 407/);
    assert.match(out, /x-worca-proxy: needs-login/i);
    assert.equal(c.connector.status().state, 'none');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('loopback and noProxy hosts go direct and never reach the upstream', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port });
  const c = await chain(fake, { settings: { noProxy: '.corp.example' } });
  const seen = [];
  try {
    assert.equal(c.connector.route('localhost'), 'direct');
    assert.equal(c.connector.route('a.corp.example'), 'direct');
    assert.equal(c.connector.route('github.com'), 'upstream');
    const out = await connectVia(c.port, `127.0.0.1:${o.port}`);
    seen.push(out);
    assert.match(out, /echo:ping/);
    assert.equal(fake.stats.heads.length, 0);
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('the direct route behind a connector drops Proxy-Authorization and Proxy-Connection', async () => {
  const origin = await headerOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: origin.port });
  const c = await chain(fake);
  const seen = [];
  try {
    const r = await httpVia(c.port, `http://127.0.0.1:${origin.port}/h`, { headers: { 'proxy-connection': 'keep-alive' } });
    seen.push(r.body);
    assert.equal(r.status, 200);
    assert.equal(origin.seen.length, 1);
    assert.equal(origin.seen[0]['proxy-authorization'], undefined);
    assert.equal(origin.seen[0]['proxy-connection'], undefined);
    assert.equal(fake.stats.heads.length, 0);
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); origin.server.close(); }
});

test('plain HTTP over Basic: relayed with 200, one head with the right Basic header', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const c = await chain(fake, { settings: { auth: 'basic' } });
  const seen = [];
  try {
    const r = await httpVia(c.port, 'http://example.test/b');
    seen.push(r.body);
    assert.equal(r.status, 200);
    assert.equal(r.body, 'upstream relayed GET http://example.test/b');
    assert.equal(fake.stats.heads.length, 1);
    assert.deepEqual(fake.stats.authHeaders, [`Basic ${BASIC_TOKEN}`]);
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('plain HTTP with a wrong password: 407 needs-login and the gate trips', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, password: 'Different' });
  const c = await chain(fake);
  const seen = [];
  try {
    const r = await httpVia(c.port, 'http://example.test/x');
    seen.push(r.body);
    assert.equal(r.status, 407);
    assert.equal(r.headers['x-worca-proxy'], 'needs-login');
    assert.equal(c.connector.status().state, 'tripped');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('plain HTTP, upstream closes after the Type 3: 407 needs-login and the gate trips', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, afterType3: 'close' });
  const c = await chain(fake);
  const seen = [];
  try {
    const r = await httpVia(c.port, 'http://example.test/x');
    seen.push(r.body);
    assert.equal(r.status, 407);
    assert.equal(r.headers['x-worca-proxy'], 'needs-login');
    assert.equal(c.connector.status().state, 'tripped');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('plain HTTP, a 503 from the origin is relayed and the gate is verified', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, status: 503 });
  const c = await chain(fake);
  const seen = [];
  try {
    const r = await httpVia(c.port, 'http://example.test/x');
    seen.push(r.body);
    assert.equal(r.status, 503);
    assert.equal(r.body, 'upstream says 503');
    assert.equal(c.connector.status().state, 'verified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('http.globalAgent is never used: a throwing global agent breaks neither the direct nor the Basic route', async () => {
  const origin = await headerOrigin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: origin.port });
  const c = await chain(fake, { settings: { auth: 'basic' } });
  const saved = http.globalAgent;
  const trap = new http.Agent();
  trap.createConnection = () => { throw new Error('http.globalAgent was used'); };
  http.globalAgent = trap;
  const seen = [];
  try {
    const direct = await httpVia(c.port, `http://127.0.0.1:${origin.port}/d`);
    seen.push(direct.body);
    assert.equal(direct.status, 200);
    assert.equal(direct.body, 'origin ok');
    const viaUpstream = await httpVia(c.port, 'http://example.test/u');
    seen.push(viaUpstream.body);
    assert.equal(viaUpstream.status, 200);
    assert.equal(viaUpstream.body, 'upstream relayed GET http://example.test/u');
  } finally {
    http.globalAgent = saved;
    assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); origin.server.close();
  }
});

test('breaker: one rejected Type 3, then fast 407s and no more credentials upstream', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, password: 'Different' });
  const c = await chain(fake);
  const seen = [];
  try {
    const first = await connectVia(c.port, 'api.anthropic.com:443');
    seen.push(first);
    assert.match(first, /^HTTP\/1\.1 407 Proxy Authentication Required/);
    assert.match(first, /x-worca-proxy: needs-login/i);
    assert.match(first, /proxy needs login/);
    assert.match(first, /restart Worca/);
    assert.equal(fake.stats.type3, 1);
    const sent = fake.stats.authHeaders.length;

    // The gate itself (no network): 10 refusals in under 100 ms, no upstream socket.
    const t0 = performance.now();
    const gated = await Promise.allSettled(Array.from({ length: 10 }, () => c.connector.tunnel({ host: 'github.com', port: 443 })));
    const gateMs = performance.now() - t0;
    assert.ok(gateMs < 100, `ten gate refusals took ${gateMs} ms`);
    for (const g of gated) assert.ok(g.status === 'rejected' && g.reason.status === 407 && g.reason.needsLogin);

    // Over real loopback sockets: each gets 407 needs-login (1000 ms bound tolerates a loaded runner).
    const t1 = performance.now();
    const rest = await Promise.all(Array.from({ length: 10 }, () => connectVia(c.port, 'github.com:443')));
    assert.ok(performance.now() - t1 < 1000, `ten socket refusals took ${performance.now() - t1} ms`);
    seen.push(...rest);
    for (const r of rest) { assert.match(r, /^HTTP\/1\.1 407/); assert.match(r, /x-worca-proxy: needs-login/i); }
    assert.equal(fake.stats.authHeaders.length, sent, 'no credential header after the trip');
    assert.equal(fake.stats.sockets, 1);
    assert.equal(c.connector.status().state, 'tripped');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

for (const afterType3 of ['close', 'silent']) {
  test(`breaker: an upstream that goes ${afterType3} right after the Type 3 trips it too`, async () => {
    const o = await echoOrigin();
    const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, afterType3 });
    const c = await chain(fake, { settings: { timeouts: { authMs: 600 } } });
    const seen = [];
    try {
      const first = await connectVia(c.port, 'github.com:443');
      seen.push(first);
      assert.match(first, /^HTTP\/1\.1 407/, 'the trip answers needs-login, not a bare 502/504');
      assert.equal(c.connector.status().state, 'tripped');
      const rest = await Promise.all(Array.from({ length: 10 }, () => connectVia(c.port, 'github.com:443')));
      seen.push(...rest);
      for (const r of rest) assert.match(r, /^HTTP\/1\.1 407/);
      assert.equal(fake.stats.type3, 1, 'no second Type 3 with the same hash');
    } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
  });
}

test('unverified: five concurrent CONNECTs with a wrong password cost exactly one Type 3', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, password: 'Different' });
  const c = await chain(fake);
  const seen = [];
  try {
    const all = await Promise.all(Array.from({ length: 5 }, () => connectVia(c.port, 'github.com:443')));
    seen.push(...all);
    for (const r of all) assert.match(r, /^HTTP\/1\.1 407/);
    assert.equal(fake.stats.type3, 1);
    assert.ok(fake.stats.type1 <= 1, `type1 = ${fake.stats.type1}`);
    assert.equal(fake.stats.sockets, 1, 'no waiter opened a second upstream socket');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('auto never falls back to Basic: a Basic-only upstream gets 0 Basic headers and the client a 502', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port });
  const c = await chain(fake);   // auth defaults to auto
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 502/);
    assert.match(out, /networkProxy\.auth/);
    assert.equal(fake.stats.basic, 0);
    assert.ok(fake.stats.authHeaders.every((h) => h.startsWith('NTLM ')), 'only the NTLM Type 1 was sent');
    assert.equal(c.connector.status().state, 'unverified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('a 5xx without Proxy-Authenticate proves the login: relayed, gate verified, never a trip', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, status: 503 });
  const c = await chain(fake);
  const seen = [];
  try {
    for (let i = 0; i < 4; i += 1) {
      const out = await connectVia(c.port, `dead${i}.example:443`);
      seen.push(out);
      assert.match(out, /^HTTP\/1\.1 503/, `CONNECT ${i}: the upstream's 503 is passed on`);
      assert.equal(c.connector.status().state, 'verified', `CONNECT ${i}`);
    }
    assert.equal(fake.stats.type3, 4, 'every CONNECT still logs in: nothing was tripped');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('a 5xx that carries Proxy-Authenticate is ambiguous: 2 of them trip an unverified gate', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, status: 503, statusChallenge: true });
  const c = await chain(fake);
  const seen = [];
  try {
    const first = await connectVia(c.port, 'github.com:443');
    seen.push(first);
    assert.match(first, /^HTTP\/1\.1 503/);
    assert.equal(c.connector.status().state, 'unverified');
    const second = await connectVia(c.port, 'github.com:443');
    seen.push(second);
    assert.match(second, /^HTTP\/1\.1 407/);
    assert.match(second, /x-worca-proxy: needs-login/i);
    const third = await connectVia(c.port, 'github.com:443');
    seen.push(third);
    assert.match(third, /^HTTP\/1\.1 407/);
    assert.equal(fake.stats.type3, 2, 'the third CONNECT sends no Type 3');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

/** Slack over authMs for a timed-out answer to reach the client on a loaded runner. */
const AUTH_SLACK_MS = 400;

test('timeouts: an upstream that never answers the Type 1 gives 504 within authMs + slack; no credentials spent', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, silent: true });
  const c = await chain(fake, { settings: { timeouts: { authMs: 600 } } });
  const seen = [];
  try {
    const t0 = performance.now();
    const out = await connectVia(c.port, 'github.com:443');
    const ms = performance.now() - t0;
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 504/);
    assert.ok(ms < 600 + AUTH_SLACK_MS, `504 took ${ms} ms`);
    assert.equal(fake.stats.type3, 0);
    assert.equal(c.connector.status().state, 'unverified', 'only a Type 1 went out');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('closeOn407: a 407 to the Type 1 that closes the connection is a 502 and spends no credentials', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'ntlm', originPort: o.port, closeOn407: true });
  const c = await chain(fake);
  const seen = [];
  try {
    const out = await connectVia(c.port, 'github.com:443');
    seen.push(out);
    assert.match(out, /^HTTP\/1\.1 502/);
    assert.match(out, /closed the connection during NTLM authentication/);
    assert.equal(fake.stats.type3, 0);
    assert.equal(c.connector.status().state, 'unverified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});

test('timeouts: a closed upstream port gives 502 (Windows retries a refused loopback connect ~2 s)', async () => {
  const c = await chain(null, { upstreamUrl: `http://Domain%5CUser:Password@127.0.0.1:${await closedPort()}`,
    settings: { timeouts: { connectMs: 5000 } } });
  try {
    const out = await connectVia(c.port, 'github.com:443', { timeoutMs: 8000 });
    assert.match(out, /^HTTP\/1\.1 502/);
    assert.equal(c.connector.status().state, 'unverified', 'no credentials were sent');
  } finally { assertNoSecrets(c.logs); c.close(); }
});

/** A plain request through the local proxy that the client abandons after `abortMs`. */
function abortedHttpVia(port, url, abortMs) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, agent: false, headers: { host: new URL(url).host } });
    req.on('error', () => resolve());
    req.on('response', (res) => { res.resume(); res.on('end', resolve); });
    setTimeout(() => { req.destroy(); resolve(); }, abortMs);
    req.end();
  });
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

for (const scheme of ['basic', 'ntlm']) {
  test(`plain HTTP (${scheme}): clients that abort before a slow 407 still trip the gate, one credential header in total`, async () => {
    const o = await echoOrigin();
    const fake = await startFakeUpstream({ scheme, originPort: o.port, password: 'Different', rejectDelayMs: 400 });
    const c = await chain(fake, { settings: scheme === 'basic' ? { auth: 'basic' } : {} });
    try {
      for (let i = 0; i < 5; i += 1) await abortedHttpVia(c.port, `http://example.test/a${i}`, 150);
      await settle(500);
      const credentials = scheme === 'basic' ? fake.stats.basic : fake.stats.type3;
      assert.equal(credentials, 1, 'the abandoned request was still judged, so nothing was sent again');
      assert.equal(c.connector.status().state, 'tripped');
      const r = await httpVia(c.port, 'http://example.test/after');
      assert.equal(r.status, 407);
      assert.equal(r.headers['x-worca-proxy'], 'needs-login');
    } finally { assertNoSecrets(c.logs); c.close(); await fake.close(); o.server.close(); }
  });
}

test('plain HTTP over Basic, a closed upstream port: 502 and the gate stays unverified (no credentials went out)', async () => {
  const c = await chain(null, { upstreamUrl: `http://Domain%5CUser:Password@127.0.0.1:${await closedPort()}`,
    settings: { auth: 'basic', timeouts: { connectMs: 5000 } } });
  const seen = [];
  try {
    const r = await httpVia(c.port, 'http://example.test/x').catch((e) => ({ status: 0, body: String(e) }));
    seen.push(r.body);
    assert.equal(r.status, 502);
    assert.equal(r.headers['x-worca-proxy'], undefined);
    assert.equal(c.connector.status().state, 'unverified');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); }
});

test('plain HTTP: hop-by-hop headers are not forwarded, and a 101 from the upstream frees the gate', async () => {
  const o = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'basic', originPort: o.port, status: 101 });
  const c = await chain(fake, { settings: { auth: 'basic' } });
  const seen = [];
  try {
    const up = await httpVia(c.port, 'http://example.test/ws', { headers: { connection: 'Upgrade, X-Hop', upgrade: 'websocket', 'x-hop': '1', 'keep-alive': 'timeout=5', te: 'trailers' } });
    seen.push(up.body);
    assert.equal(up.status, 502);
    const sent = fake.stats.heads[0].headers;
    for (const h of ['upgrade', 'x-hop', 'keep-alive', 'te']) assert.equal(sent[h], undefined, `${h} is not forwarded`);
    assert.doesNotMatch(sent.connection || '', /upgrade/i);
    const next = await httpVia(c.port, 'http://example.test/next');
    seen.push(next.body);
    assert.equal(next.status, 502, 'the next request is answered too: no gate slot leaked');
    assert.notEqual(c.connector.status().state, 'tripped', 'a 101 is no verdict on the login');
  } finally { assertNoSecrets([...c.logs, ...seen]); c.close(); await fake.close(); o.server.close(); }
});
