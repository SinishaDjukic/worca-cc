// test/frame-check.test.mjs — the server's framing check (issue 1064 §3): verdicts, the cache, and every SSRF refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createFrameCheck, checkTarget, FRAME_CHECK_LIMITS } from '../src/core/frame-check.mjs';
import { makeGuardedLookup } from '../src/core/ask/web-fetch.mjs';

function fake(routes) {
  const calls = [];
  const transport = async ({ url, method, headers }) => {
    calls.push({ at: `${method} ${url.href}`, headers });
    const r = routes[`${method} ${url.href}`];
    if (!r) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    if (r.wait) await new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })), r.wait));
    return { status: r.status, headers: r.headers || {}, destroy() {} };
  };
  return { calls, transport };
}

test('verdicts: XFO, frame-ancestors, none; HEAD 405 falls back to GET; no cookie header', async () => {
  const f = fake({
    'HEAD https://a.example/x': { status: 200, headers: { 'x-frame-options': 'DENY' } },
    'HEAD https://b.example/': { status: 200, headers: { 'content-security-policy': "frame-ancestors 'none'" } },
    'HEAD https://c.example/': { status: 200 },
    'HEAD https://d.example/': { status: 405 },
    'GET https://d.example/': { status: 200, headers: { 'x-frame-options': 'sameorigin' } },
  });
  const fc = createFrameCheck({ transport: f.transport });
  assert.deepEqual(await fc.check('https://a.example/x'), { framable: false, reason: 'X-Frame-Options' });
  assert.deepEqual(await fc.check('https://b.example/'), { framable: false, reason: 'frame-ancestors' });
  assert.deepEqual(await fc.check('https://c.example/'), { framable: true, reason: null });
  assert.deepEqual(await fc.check('https://d.example/'), { framable: false, reason: 'X-Frame-Options' });
  assert.ok(f.calls.every((c) => !Object.keys(c.headers).some((k) => k.toLowerCase() === 'cookie')));
});

test('one request per origin while cached; unknown expires sooner', async () => {
  let t = 0;
  const f = fake({ 'HEAD https://c.example/': { status: 200 } });
  const fc = createFrameCheck({ transport: f.transport, now: () => t });
  await fc.check('https://c.example/a'); await fc.check('https://c.example/b');
  assert.equal(f.calls.length, 1);
  t = 60 * 60_000 + 1; await fc.check('https://c.example/');
  assert.equal(f.calls.length, 2);
  const down = fake({});
  const fd = createFrameCheck({ transport: down.transport, now: () => t });
  assert.equal((await fd.check('https://e.example/')).framable, null);
  t += 61_000; await fd.check('https://e.example/');
  assert.equal(down.calls.length, 2);
});

test('refused before any request: scheme, login, port, loopback, private IPs, dotless and .local names', async () => {
  const f = fake({});
  const fc = createFrameCheck({ transport: f.transport });
  const rows = [['ftp://a.example/', 'scheme'], ['https://u:p@a.example/', 'login'], ['https://a.example:8443/', 'port'],
    ['http://localhost/', 'loopback'], ['http://127.0.0.9/', 'loopback'], ['http://[::1]/', 'private-address'],
    ['http://10.1.2.3/', 'private-address'], ['http://169.254.169.254/', 'private-address'], ['http://[::ffff:127.0.0.1]/', 'private-address'],
    ['http://[fd00::1]/', 'private-address'], ['http://intranet/', 'private-name'], ['http://box.local/', 'private-name'], ['http://x.corp/', 'private-name']];
  for (const [u, why] of rows) assert.deepEqual(await fc.check(u), { framable: null, reason: why }, u);
  assert.equal(f.calls.length, 0);
});

test('every redirect hop is checked again; more than 3 hops stop', async () => {
  const f = fake({
    'HEAD https://r.example/': { status: 302, headers: { location: 'http://127.0.0.1/admin' } },
    'HEAD https://s.example/': { status: 301, headers: { location: 'https://10.0.0.1/' } },
    'HEAD https://h1.example/': { status: 302, headers: { location: 'https://h2.example/' } },
    'HEAD https://h2.example/': { status: 302, headers: { location: 'https://h3.example/' } },
    'HEAD https://h3.example/': { status: 302, headers: { location: 'https://h4.example/' } },
    'HEAD https://h4.example/': { status: 302, headers: { location: 'https://h5.example/' } },
  });
  const fc = createFrameCheck({ transport: f.transport });
  assert.deepEqual(await fc.check('https://r.example/'), { framable: null, reason: 'loopback' });
  assert.deepEqual(await fc.check('https://s.example/'), { framable: null, reason: 'private-address' });
  assert.deepEqual(await fc.check('https://h1.example/'), { framable: null, reason: 'redirects' });
  assert.ok(!f.calls.some((c) => /127\.0\.0\.1|10\.0\.0\.1|h5/.test(c.at)));
});

test('a name that resolves to a private address is refused at connect time (real transport, guarded lookup)', async () => {
  const lookup = makeGuardedLookup((h, o, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]));
  const fc = createFrameCheck({ lookup });
  assert.deepEqual(await fc.check('http://public-looking.example/'), { framable: null, reason: 'private-address' });
  const mixed = makeGuardedLookup((h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]));
  assert.deepEqual(await createFrameCheck({ lookup: mixed }).check('https://x.example/'), { framable: null, reason: 'private-address' });
});

test('deadline: a slow site is unknown, never a hang', async () => {
  const f = fake({ 'HEAD https://slow.example/': { status: 200, wait: 30 } });
  const fc = createFrameCheck({ transport: f.transport });
  assert.deepEqual(await fc.check('https://slow.example/'), { framable: null, reason: 'timeout' });
});

test('a remote Worca follows the chat\'s web policy: off or not allowlisted asks nothing', async () => {
  const f = fake({ 'HEAD https://ok.example/': { status: 200 } });
  const fc = createFrameCheck({ transport: f.transport });
  assert.deepEqual(await fc.check('https://ok.example/', { policy: { enabled: false } }), { framable: null, reason: 'web-off' });
  assert.deepEqual(await fc.check('https://ok.example/', { policy: { enabled: true, allowedDomains: ['other.example'] } }), { framable: null, reason: 'not-allowlisted' });
  assert.equal(f.calls.length, 0);
  assert.equal((await fc.check('https://ok.example/', { policy: { enabled: true, allowedDomains: ['ok.example'] } })).framable, true);
});

test('a remote Worca checks every redirect hop against the chat\'s allowlist too (v3)', async () => {
  const f = fake({ 'HEAD https://ok.example/': { status: 302, headers: { location: 'https://evil.example/collect?x=1' } },
    'HEAD https://evil.example/collect?x=1': { status: 200 } });
  const fc = createFrameCheck({ transport: f.transport });
  assert.deepEqual(await fc.check('https://ok.example/', { policy: { enabled: true, allowedDomains: ['ok.example'] } }),
    { framable: null, reason: 'not-allowlisted' });
  assert.deepEqual(f.calls.map((c) => c.at), ['HEAD https://ok.example/']);
});

test('the cache is keyed by origin, the asking page and the policy (v3)', async () => {
  const f = fake({ 'HEAD https://c.example/': { status: 200 } });
  const fc = createFrameCheck({ transport: f.transport });
  await fc.check('https://c.example/', { pageOrigins: ['http://a.test:1'] });
  await fc.check('https://c.example/', { pageOrigins: ['http://b.test:2'] });
  assert.equal(f.calls.length, 2);
  assert.equal((await fc.check('https://c.example/', { pageOrigins: ['http://a.test:1'] })).cached, true);
});

test('a transport that never answers ends at the deadline and frees its slot (v3)', async () => {
  const fc = createFrameCheck({ transport: () => new Promise(() => {}), limits: { ...FRAME_CHECK_LIMITS, timeoutMs: 30, inflightMax: 1 } });
  assert.deepEqual(await fc.check('https://hang.example/'), { framable: null, reason: 'timeout' });
  assert.equal((await fc.check('https://hang2.example/')).reason, 'timeout');   // not 'busy': the slot was freed
});

test('never through an env proxy: the proxy would resolve the name itself (v3, SSRF)', async () => {
  let connections = 0;
  const srv = createServer((s) => { connections += 1; s.destroy(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const KEYS = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.HTTPS_PROXY = process.env.https_proxy = `http://127.0.0.1:${srv.address().port}`;
  try {
    const lookup = makeGuardedLookup((h, o, cb) => cb(Object.assign(new Error('no such name'), { code: 'ENOTFOUND' })));
    const v = await createFrameCheck({ lookup }).check('https://jenkins.corp-internal.example/');
    assert.equal(v.framable, null);
    assert.equal(connections, 0);
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await new Promise((r) => srv.close(r));
  }
});

test('checkTarget alone', () => {
  assert.equal(checkTarget(new URL('https://example.org/')), null);
  assert.equal(checkTarget(new URL('https://93.184.216.34/')), null);
});
