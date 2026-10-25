// test/proxy-host.test.mjs — src/core/proxy-host.mjs, the corporate proxy's shared server logic (the /api/proxy
// routes, the chat's proxy bridge and the proxy card). In-process: fakes for every io, the real proxyState.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyHost, TESTED_TTL_MS } from '../src/core/proxy-host.mjs';
import { assertNetworkProxyInput, mergeNetworkProxy } from '../src/core/settings.mjs';

const HASH = Buffer.from('8846f7eaee8fb117ad06bdd830b7586c', 'hex');
const LOGIN = { id: 'lg1', domain: 'ACME', user: 'jdoe', ntHash: HASH, savedAt: '2026-10-20T08:00:00.000Z', rejected: null };

function host({ settings = { upstream: 'http://proxy.acme.test:8080', auth: 'ntlm' }, login = LOGIN, egress = null, check, now } = {}) {
  const calls = { rejected: [], reload: 0, saved: [] };
  let stored = { ...settings };
  const E = egress && { ...egress, reloadLogin: () => { calls.reload += 1; } };
  const h = createProxyHost({
    egress: () => E,
    io: {
      env: () => ({}),
      settings: () => ({ ...stored }),
      preview: (p) => { assertNetworkProxyInput(p); return mergeNetworkProxy(stored, p); },
      enabled: () => stored.enabled === true,
      ...(now ? { now } : {}),
      // The REAL validation + merge, so a saved upstream is normalised to http://host:port exactly as
      // setNetworkProxy stores it.
      saveNetworkProxy: async (p) => { calls.saved.push(p); assertNetworkProxyInput(p); stored = mergeNetworkProxy(stored, p); return { ...stored }; },
      readLogin: () => login,
      markLoginRejected: (id, o) => { calls.rejected.push([id, o]); return true; },
      checkUpstream: check || (async (up) => ({ ok: true, upstream: { upstream: `${up.host}:${up.port}` }, results: [{ host: 'github.com', ok: true, via: 'upstream', ms: 3 }] })),
    },
  });
  return { h, calls };
}
const running = (upstream, state = 'verified') => ({ status: 'on', url: 'http://127.0.0.1:41000', connector: { status: () => ({ upstream, auth: 'ntlm', source: 'settings', login: 'ACME\\jdoe', loginId: 'lg1', state }) } });

test('chatStatus never carries the NT hash, in any encoding', () => {
  const { h } = host({ egress: running('proxy.acme.test:8080') });
  const s = JSON.stringify(h.chatStatus());
  for (const enc of ['hex', 'base64', 'base64url']) assert.ok(!s.includes(HASH.toString(enc)), enc);
  assert.ok(!/ntHash/i.test(s));
  const v = h.chatStatus();
  assert.equal(v.login.account, 'ACME\\jdoe');
  assert.equal(v.login.present, true);
  assert.equal(v.upstream.hostPort, 'proxy.acme.test:8080');
  assert.equal(v.upstream.source, 'settings');
  assert.equal(v.local.url, 'http://127.0.0.1:41000');
  assert.equal(v.connector.state, 'verified');
  assert.equal('restart' in v, false, 'changes apply live: no restart field');
});

test('chatStatus: enabled follows networkProxy.enabled', async () => {
  const { h } = host();
  assert.equal(h.chatStatus().enabled, false);
  await h.saveSettings({ enabled: false });
  assert.equal(h.chatStatus().enabled, false);
});

test('test(): NOT_CONFIGURED, UPSTREAM_INVALID, a candidate host, TEST_RUNNING', async () => {
  assert.equal((await host({ settings: {} }).h.test()).body.code, 'NOT_CONFIGURED');
  // resolveUpstream answers {source, error} only when parseUpstreamUrl fails; https:// is the documented case.
  assert.equal((await host({ settings: { upstream: 'https://proxy.acme.test:8080' } }).h.test()).body.code, 'UPSTREAM_INVALID');
  assert.equal((await host({ settings: { upstream: 'http://proxy.acme.test:8080', auth: 'basic' }, login: null, egress: running('proxy.acme.test:8080') }).h.test()).status, 200);
  const other = host({ egress: running('old.acme.test:8080') });
  const r = await other.h.test({ upstream: 'proxy2.acme.test:3128' });
  assert.deepEqual([r.status, r.body.upstream], [200, 'proxy2.acme.test:3128'], 'the candidate is tested, not the running host');
  assert.equal(other.calls.saved.length, 0, 'a test writes nothing');
  assert.equal((await other.h.test({ auth: 'kerberos' })).status, 400);
  let release; let checks = 0;
  const done = { ok: true, upstream: { upstream: 'proxy.acme.test:8080' }, results: [] };
  // Only the first check blocks: the one after the release must answer, or the test never ends.
  const slow = host({ egress: running('proxy.acme.test:8080'), check: () => (checks++ ? Promise.resolve(done) : new Promise((r2) => { release = () => r2(done); })) });
  const first = slow.h.test();
  assert.equal((await slow.h.test()).body.code, 'TEST_RUNNING');
  release(); await first;
  assert.equal((await slow.h.test()).status, 200, 'the lock is released');
});

test('test(): a trip marks the login rejected and reloads the running connector', async () => {
  const { h, calls } = host({ egress: running('proxy.acme.test:8080'), check: async (up, o) => {
    o.onTrip({ upstream: 'proxy.acme.test:8080', loginId: 'lg1' });
    return { ok: false, upstream: { upstream: 'proxy.acme.test:8080' }, results: [{ host: 'github.com', ok: false, via: 'upstream', ms: 9, status: 407, needsLogin: true }] };
  } });
  const r = await h.test();
  assert.equal(r.body.ok, false);
  assert.deepEqual(calls.rejected, [['lg1', { upstream: 'proxy.acme.test:8080' }]]);
  assert.equal(calls.reload, 1);
});

test('R-sec-2: a pass older than TESTED_TTL_MS no longer satisfies the gate; an unrecorded test never does', async () => {
  let t = 1_000_000;
  const { h, calls } = host({ settings: { enabled: true, upstream: 'http://proxy.acme.test:8080', auth: 'none' }, login: null, now: () => t });
  const patch = { enabled: true, upstream: 'http://other.acme.test:3128', auth: 'none' };
  await h.test(patch);                                                  // the chat tool's way: record false
  assert.equal((await h.saveSettings(patch)).refused.body.code, 'UNTESTED');
  await h.test(patch, { record: true });
  t += TESTED_TTL_MS + 60_000;                                          // 11 minutes later
  assert.equal((await h.saveSettings(patch)).refused.body.code, 'UNTESTED');
  assert.equal(calls.saved.length, 0, 'a refused save writes nothing');
  await h.test(patch, { record: true });
  assert.equal((await h.saveSettings(patch)).refused, undefined);
  assert.equal(calls.saved.length, 1);
});

test('architect-2-1: saving the running upstream again is never refused, also after a login change moved status().auth', async () => {
  const running = { upstream: 'proxy.acme.test:8080', auth: 'auto' };   // status() after useLogin: auth 'auto', not the resolved mode
  const { h, calls } = host({ settings: { enabled: true, upstream: 'http://proxy.acme.test:8080' }, login: null,
    egress: { connector: { status: () => running } } });
  const r = await h.saveSettings({ enabled: true, upstream: 'http://proxy.acme.test:8080', noProxy: 'intranet.acme.test' });
  assert.equal(r.refused, undefined, 'same host:port and auth as the saved values: no test needed');
  assert.equal(calls.saved.length, 1);
  const moved = await h.saveSettings({ enabled: true, upstream: 'http://proxy.acme.test:3128' });
  assert.equal(moved.refused.body.code, 'UNTESTED', 'a new port still needs a test');
});

test('saveSettings: turning off and a fixedPort-only change need no test; the port change is pending', async () => {
  const { h, calls } = host({ settings: { enabled: true, upstream: 'http://proxy.acme.test:8080' }, login: null, egress: running('proxy.acme.test:8080') });
  const port = await h.saveSettings({ fixedPort: 3128 });
  assert.equal(port.refused, undefined);
  assert.deepEqual([port.restartNeeded, port.pending, port.notes.fixedPort], [true, ['fixedPort'], 'Applies at the next start']);
  const off = await h.saveSettings({ enabled: false, upstream: 'http://elsewhere.acme.test:1' });
  assert.equal(off.refused, undefined, 'turning off needs no test');
  assert.equal(calls.saved.length, 2);
});
