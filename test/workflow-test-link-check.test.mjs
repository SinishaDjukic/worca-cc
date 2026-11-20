// test/workflow-test-link-check.test.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9), with a fake transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, linkState, linkCarriesData, linkUrlOk, linkDefaults, LINKS_MAX } from '../src/core/workflow-tests/link-check.mjs';
import { httpsTransport, makeGuardedLookup } from '../src/core/ask/web-fetch.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { judgeTry } from '../src/shared/workflow-tests/checks.mjs';

const site = (routes) => {
  const seen = [];
  const transport = async ({ url }) => {
    seen.push(url.href);
    const r = routes[url.href];
    if (r instanceof Error) throw r;
    return { status: r ? r.status : 404, headers: r && r.location ? { location: r.location } : {}, destroy: () => {} };
  };
  return { transport, seen };
};

test('a link works on 2xx (or 401, 403, 429) after at most 3 redirects; http is tried as https; a private host name fails', async () => {
  const s = site({ 'https://a.example/x': { status: 301, location: '/y' }, 'https://a.example/y': { status: 200 },
    'https://b.example/z': { status: 200 }, 'https://c.example/': { status: 403 },
    'https://in.example/': Object.assign(new Error('refused'), { code: 'EWORCA_BLOCKED' }) });
  assert.equal(await linkState('https://a.example/x', { transport: s.transport }), 'works');
  assert.equal(await linkState('http://b.example/z', { transport: s.transport }), 'works');
  assert.ok(s.seen.includes('https://b.example/z'), 'http became https');
  assert.equal(await linkState('https://c.example/', { transport: s.transport }), 'works', 'P4-Q9: the site answered but refuses bots');
  assert.equal(await linkState('https://in.example/', { transport: s.transport }), 'broken', 'resolves to a private address');
  assert.equal(await linkState('https://user:pw@a.example/x', { transport: s.transport }), 'broken', 'no credentials in a link');
  const loop = site({ 'https://l.example/1': { status: 302, location: '/2' }, 'https://l.example/2': { status: 302, location: '/3' },
    'https://l.example/3': { status: 302, location: '/4' }, 'https://l.example/4': { status: 302, location: '/5' } });
  assert.equal(await linkState('https://l.example/1', { transport: loop.transport }), 'broken');
});

test('C1: IP-address hosts and ports other than 443 are refused on every hop, and never dialled', async () => {
  const s = site({ 'https://a.example/to-ip': { status: 301, location: 'https://127.0.0.1/' },
    'https://a.example/to-port': { status: 302, location: 'https://a.example:8443/' }, 'https://a.example/ok': { status: 200 } });
  // 2130706433 is 127.0.0.1 written as one number: the URL parser turns it into the address, so the same rule refuses it.
  for (const raw of ['https://127.0.0.1/', 'https://[::1]/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data/',
    'https://2130706433/', 'https://a.example:8443/', 'http://a.example:8080/']) {
    assert.equal(await linkState(raw, { transport: s.transport }), 'broken', raw);
  }
  assert.deepEqual(s.seen, [], 'the transport was never called');
  assert.equal(await linkState('https://a.example/to-ip', { transport: s.transport }), 'broken', 'a redirect to an IP-address host');
  assert.equal(await linkState('https://a.example/to-port', { transport: s.transport }), 'broken', 'a redirect to another port');
  assert.deepEqual(s.seen, ['https://a.example/to-ip', 'https://a.example/to-port'], 'the redirect targets were never dialled');
  assert.equal(await linkState('https://a.example:443/ok', { transport: s.transport }), 'works', 'the default port is fine');
});

test('I12: no answer at all is broken when another link answered, and not checked when none did', async () => {
  const err = (code) => Object.assign(new Error(code), { code });
  const down = site({ 'https://a.example/x': err('EAI_AGAIN'), 'https://b.example/y': err('ENOTFOUND') });
  assert.deepEqual(await checkLinks('https://a.example/x and https://b.example/y', { transport: down.transport }),
    { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' });
  const half = site({ 'https://a.example/x': { status: 200 }, 'https://made-up.example/y': err('ENOTFOUND') });
  assert.deepEqual(await checkLinks('https://a.example/x and https://made-up.example/y', { transport: half.transport }),
    { met: false, value: 'Not working: https://made-up.example/y' });
  const refused = site({ 'https://a.example/x': err('ECONNREFUSED') });
  assert.deepEqual(await checkLinks('https://127.0.0.1/admin and https://a.example/x', { transport: refused.transport }),
    { met: false, value: 'Not working: https://127.0.0.1/admin' }, 'a refused link is broken, whatever the network');
  const hang = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal(await linkState('https://slow.example/', { transport: hang, timeoutMs: 10 }), 'unreached', 'a hop that timed out before any answer');
});

test('N9: a link that may carry data is never opened; alone it leaves the check not checked', async () => {
  const s = site({ 'https://a.example/x': { status: 200 } });
  const data = `https://b.example/c?d=${'QUJD'.repeat(30)}`;
  assert.equal(await linkState(data, { transport: s.transport }), 'skipped');
  assert.deepEqual(s.seen, [], 'never dialled');
  assert.deepEqual(await checkLinks(`See ${data}`, { transport: s.transport }),
    { met: false, notChecked: true, value: 'Not checked: Worca does not open links that may carry data' });
  assert.deepEqual(await checkLinks(`https://a.example/x and ${data}`, { transport: s.transport }), { met: true, value: 'Met · 1 of 2 checked' });
});

test('M19: checkLinks starts no new link after its overall deadline', async () => {
  let t = 0;
  const s = site(Object.fromEntries([1, 2, 3].map((i) => [`https://a.example/${i}`, { status: 200 }])));
  const slow = async (o) => { t += 60_000; return s.transport(o); };
  assert.deepEqual(await checkLinks('https://a.example/1 https://a.example/2 https://a.example/3', { transport: slow, now: () => t, deadlineMs: 120_000 }),
    { met: true, value: 'Met · 2 of 3 checked' });
});

test('checkLinks: no links, all fine, one broken, and at most 20 checked', async () => {
  const s = site({ 'https://a.example/x': { status: 200 } });
  assert.deepEqual(await checkLinks('No links.', { transport: s.transport }), { met: true, value: 'No links' });
  assert.deepEqual(await checkLinks('See https://a.example/x.', { transport: s.transport }), { met: true, value: 'Met' });
  assert.deepEqual(await checkLinks('https://a.example/x and https://gone.example/page', { transport: s.transport }),
    { met: false, value: 'Not working: https://gone.example/page' });
  const many = Array.from({ length: 25 }, (_, i) => `https://a.example/x?${i}`).join(' ');
  const ok = site(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`https://a.example/x?${i}`, { status: 200 }])));
  assert.deepEqual(await checkLinks(many, { transport: ok.transport }), { met: true, value: `Met · ${LINKS_MAX} of 25 checked` });
  assert.equal(ok.seen.length, LINKS_MAX);
});

test('checkTry runs a links check after the try finished, with its own checker', async () => {
  const outcome = { facts: { status: 'done', costUsd: 0 }, text: 'See https://a.example/x', files: [], name: 'r.md', source: 'work' };
  const v = await checkTry({ basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'links' }] },
    outcome, { checkLinks: async () => ({ met: false, value: 'Not working: https://a.example/x' }) });
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [['Every link works', false, 'Not working: https://a.example/x']]);
});

test('M20: a project try whose copy is gone still runs its links check (it reads only the result)', async () => {
  const outcome = { facts: { status: 'done', costUsd: 0 }, text: 'See https://a.example/x', files: [], name: 'r.md', source: 'work',
    project: { checkoutDir: null, touched: [], total: 0 } };
  const v = await checkTry({ basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'links' }] },
    outcome, { checkLinks: async () => ({ met: true, value: 'Met' }) });
  assert.deepEqual(v.checks.map((c) => [c.met, c.value, !!c.worcaProblem]), [[true, 'Met', false]]);
});

test('I12: a check Worca could not run does not decide the try', async () => {
  const outcome = { facts: { status: 'done', costUsd: 0 }, text: 'See https://a.example/x', files: [], name: 'r.md', source: 'work' };
  const v = await checkTry({ basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'links' }] },
    outcome, { checkLinks: async () => ({ met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' }) });
  assert.equal(v.passed, true);
  assert.deepEqual(v.checks.map((c) => [c.met, c.notChecked]), [[false, true]]);
  const basics = { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null };
  assert.equal(judgeTry({ basics }, { status: 'done' }, [{ label: 'x', met: false }]).passed, false, 'an ordinary missed check still fails');
});

test('N9: a host name is a data channel too (the DNS query leaks it before any connection): such a link is never opened', async () => {
  const hex = (n) => Array.from({ length: n }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join('');
  const s = site({ 'https://docs.github.com/x': { status: 200 } });
  const repro = `https://${hex(63)}.${hex(63)}.${hex(63)}.attacker.example/`;
  assert.equal(linkUrlOk(new URL(repro)), true, 'the URL rule alone lets it through');
  assert.equal(linkCarriesData(new URL(repro)), true, 'over 100 characters, and labels that are hex');
  assert.equal(await linkState(repro, { transport: s.transport }), 'skipped');
  for (const host of [`${hex(20)}.attacker.example`, 'mfrggzdfmztwq2lknnwg23tpobyxe43u.attacker.example', 'mzxw6ytboi4dsnzq.attacker.example',
    'gezdgnbvgy3tqojqgezdgnbvgy.attacker.example', 'a1b2c3d4e5f6g7h8i9.attacker.example', `${'x'.repeat(40)}.${'y'.repeat(40)}.${'z'.repeat(40)}.example`]) {
    assert.equal(linkCarriesData(new URL(`https://${host}/`)), true, host);
    assert.equal(await linkState(`https://${host}/`, { transport: s.transport }), 'skipped', host);
  }
  assert.deepEqual(s.seen, [], 'never dialled');
  const hop = site({ 'https://docs.github.com/to-data': { status: 302, location: `https://${hex(32)}.attacker.example/` } });
  assert.equal(await linkState('https://docs.github.com/to-data', { transport: hop.transport }), 'skipped', 'a redirect to such a host is not followed');
  assert.deepEqual(hop.seen, ['https://docs.github.com/to-data']);
  assert.deepEqual(await checkLinks(`See ${repro}`, { transport: s.transport }),
    { met: false, notChecked: true, value: 'Not checked: Worca does not open links that may carry data' });
  for (const host of ['docs.github.com', 'en.wikipedia.org', 'my-company-intranet-docs.example.com', 's3.eu-central-1.amazonaws.com',
    'a1b2.cloudfront.net', 'www.bbc.co.uk', 'mybucket-prod-2024.s3.amazonaws.com', 'international-business-machines.example.com', 'github.com']) {
    assert.equal(linkCarriesData(new URL(`https://${host}/`)), false, host);
  }
  const ok = site({ 'https://docs.github.com/x': { status: 200 }, 'https://en.wikipedia.org/wiki/X': { status: 200 } });
  assert.deepEqual(await checkLinks('https://docs.github.com/x https://en.wikipedia.org/wiki/X', { transport: ok.transport }), { met: true, value: 'Met' });
});

test('I12: a TLS failure or a reset on the first hop is not the workflow\'s fault; a real HTTP error still is', async () => {
  const err = (code) => Object.assign(new Error(code), { code });
  const net = site({ 'https://a.example/x': err('ECONNRESET'), 'https://b.example/y': err('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
    'https://c.example/z': err('ERR_TLS_CERT_ALTNAME_INVALID'), 'https://d.example/w': err('EPROTO') });
  for (const u of ['https://a.example/x', 'https://b.example/y', 'https://c.example/z', 'https://d.example/w']) {
    assert.equal(await linkState(u, { transport: net.transport }), 'unreached', u);
  }
  assert.deepEqual(await checkLinks('https://a.example/x https://b.example/y https://c.example/z', { transport: net.transport }),
    { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' });
  const blocked = site({ 'https://in.example/': err('EWORCA_BLOCKED') });
  assert.equal(await linkState('https://in.example/', { transport: blocked.transport }), 'broken', 'a private address stays broken');
  const http = site({ 'https://g.example/a': { status: 410 }, 'https://g.example/b': { status: 503 }, 'https://g.example/c': { status: 404 } });
  for (const u of ['https://g.example/a', 'https://g.example/b', 'https://g.example/c']) assert.equal(await linkState(u, { transport: http.transport }), 'broken', u);
});

test('P4-Q9: two minutes is a hard cap per check; a link cut off by it is not checked, never broken', async () => {
  const answer = (status, headers = {}) => Promise.resolve({ status, headers, destroy: () => {} });
  // A host that never answers and ignores the signal: the cap must hold all the same.
  const hang = (seen) => ({ url }) => {
    seen.push(url.href);
    if (url.hostname === 'ok.example') return answer(200);
    if (url.hostname === 'hop.example' && url.pathname === '/1') return answer(302, { location: '/2' });
    return new Promise(() => {});
  };
  const t0 = Date.now();
  const seen = [];
  assert.deepEqual(await checkLinks('https://ok.example/1 https://stuck.example/2 https://ok.example/3', { transport: hang(seen), deadlineMs: 50 }),
    { met: true, value: 'Met · 1 of 3 checked' }, 'the answered link counts; the cut one and the one never started do not');
  assert.deepEqual(seen, ['https://ok.example/1', 'https://stuck.example/2']);
  assert.deepEqual(await checkLinks('https://ok.example/1 https://hop.example/1', { transport: hang([]), deadlineMs: 50 }),
    { met: true, value: 'Met · 1 of 2 checked' }, 'cut off on a redirect hop, after another link answered: still not broken');
  assert.deepEqual(await checkLinks('https://stuck.example/2', { transport: hang([]), deadlineMs: 50 }),
    { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' });
  assert.ok(Date.now() - t0 < 5_000, 'far below the 15 s hop timeout: the deadline cut each hop');
  const ctrl = new AbortController();
  const p = linkState('https://hop.example/1', { transport: hang([]), signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  assert.equal(await p, 'unreached', 'linkState: a link cut off by the deadline is unreached, on any hop');
});

test('the default transport is Ask\'s httpsTransport, and its guarded lookup refuses a private address before any socket', async () => {
  assert.equal(linkDefaults.transport, httpsTransport, 'link-check opens links through Ask\'s transport');
  // Behaviour, not source text: with no lookup passed, localhost (resolved by the OS, never by network DNS, and direct even
  // behind a proxy) is refused before any socket. If the guard were unwired this would dial 127.0.0.1:443 locally and fail.
  await assert.rejects(httpsTransport({ url: new URL('https://localhost/'), env: {}, headers: {} }),
    (e) => e.code === 'EWORCA_BLOCKED', 'whose default lookup is the guarded one');
  const calls = [];
  const spy = async (o) => { calls.push(Object.keys(o).sort()); return { status: 200, headers: {}, destroy: () => {} }; };
  const real = linkDefaults.transport;
  linkDefaults.transport = spy;
  try {
    assert.equal(await linkState('https://localhost/x'), 'works');
    assert.deepEqual(await checkLinks('https://localhost/y'), { met: true, value: 'Met' });
  } finally { linkDefaults.transport = real; }
  assert.deepEqual(calls, [['headers', 'signal', 'url'], ['headers', 'signal', 'url']], 'used by default, and never with a lookup of its own');
  const asked = [];
  const lookup = makeGuardedLookup((host, _o, cb) => { asked.push(host); cb(null, [{ address: '10.0.0.5', family: 4 }]); });
  await assert.rejects(httpsTransport({ url: new URL('https://intranet.example/'), lookup, env: { HTTPS_PROXY: 'http://proxy.example:3128' }, headers: {} }),
    (e) => e.code === 'EWORCA_BLOCKED', 'behind a proxy: refused before the tunnel is opened');
  await assert.rejects(httpsTransport({ url: new URL('https://intranet.example/'), lookup, env: {}, headers: {} }),
    (e) => e.code === 'EWORCA_BLOCKED', 'direct: refused at the lookup, before any connection');
  assert.deepEqual(asked, ['intranet.example', 'intranet.example']);
});
