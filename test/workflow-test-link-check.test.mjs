// test/workflow-test-link-check.test.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9), with a fake transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, linkState, LINKS_MAX } from '../src/core/workflow-tests/link-check.mjs';
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
