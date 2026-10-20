// test/extension-pairing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extensionOrigin, extensionRouteKind, decideExtensionRequest, createExtensionPairing,
  TOKEN_PREFIX, PAIR_TTL_MS, PAIR_MAX_PENDING,
} from '../src/core/extension-pairing.mjs';

const CHROME = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const FIREFOX = 'moz-extension://2f1c9a4e-0d4b-4bb3-9a55-6a1f0c3e7d21';
const store = (t = { v: 1_000_000 }) => {
  const dir = mkdtempSync(join(tmpdir(), 'wx-pair-'));
  const file = join(dir, 'extension-pairings.json');
  return { file, t, p: createExtensionPairing({ file: () => file, now: () => t.v }) };
};
const req = (method, path, headers = {}) => ({ method, path, headers: { host: '127.0.0.1:4317', ...headers } });

test('extensionOrigin accepts only chrome-extension:// and moz-extension:// origins', () => {
  assert.equal(extensionOrigin(CHROME), CHROME);
  assert.equal(extensionOrigin(FIREFOX), FIREFOX);
  for (const bad of ['http://localhost:4317', 'https://evil.example', 'null', '', 'chrome-extension://x', 'chrome-extension://abcdefgh/p', undefined]) {
    assert.equal(extensionOrigin(bad), null, String(bad));
  }
});

test('route kinds: pairing, token allowlist, everything else refused (cards, health, HEAD, commands)', () => {
  assert.equal(extensionRouteKind('GET', '/api/extension/hello'), 'pair');
  assert.equal(extensionRouteKind('POST', '/api/extension/pair'), 'pair');
  assert.equal(extensionRouteKind('POST', '/api/ask/threads/t_123/messages'), 'token');
  assert.equal(extensionRouteKind('GET', '/api/projects'), 'token');
  assert.equal(extensionRouteKind('POST', '/api/ask/threads/t_123/cards/c_1'), null);   // M2: act-then-undo actions stay in the full UI
  assert.equal(extensionRouteKind('GET', '/api/health'), null);                         // m7: no fingerprint body
  assert.equal(extensionRouteKind('HEAD', '/api/ask/threads'), null);                   // s2: method-exact
  assert.equal(extensionRouteKind('GET', '/api/ask/commands/status'), null);            // s2
  assert.equal(extensionRouteKind('GET', '/api/Ask/threads'), null);                    // case-sensitive
  assert.equal(extensionRouteKind('POST', '/api/projects'), null);
  assert.equal(extensionRouteKind('GET', '/api/settings'), null);
  assert.equal(extensionRouteKind('GET', '/api/extension/install'), null);   // UI-only: never on the token allowlist
  assert.equal(extensionRouteKind('POST', '/api/run'), null);
  assert.equal(extensionRouteKind('GET', '/api/ask/threads/%2e%2e/messages'), null);
  assert.equal(extensionRouteKind('GET', '/api/ask/threads/t_123/attachments/att_1'), null);   // v5: the sidebar never reads attachments
  assert.equal(extensionRouteKind('GET', '/api/extension/actions/match'), 'token');             // D7: one origin → at most one run
  assert.equal(extensionRouteKind('POST', '/api/extension/actions/match'), null);
  assert.equal(extensionRouteKind('GET', '/api/actions/running'), null);                        // the instance list stays off
  assert.equal(extensionRouteKind('POST', '/api/ask/refs/resolve'), null);                     // chips run worca's GitHub / Azure lookups: full UI only
});

test('decide: non-extension origins pass to S1; non-loopback Host passes to S1; remote mode refuses', () => {
  const verify = () => null;
  assert.equal(decideExtensionRequest(req('GET', '/api/projects', { origin: 'https://evil.example' }), { remoteMode: false, verify }).kind, 'pass');
  assert.equal(decideExtensionRequest(req('GET', '/api/projects', { origin: CHROME, host: 'evil.example' }), { remoteMode: false, verify }).kind, 'pass');
  const r = decideExtensionRequest(req('POST', '/api/extension/pair', { origin: CHROME }), { remoteMode: true, verify });
  assert.equal(r.kind, 'refuse'); assert.equal(r.code, 'extension-remote-mode');
});

test('decide: preflight only for allowlisted routes; token required on token routes', () => {
  const verify = (o, t) => (o === CHROME && t === `${TOKEN_PREFIX}good` ? { id: 'ext_1' } : null);
  const pre = decideExtensionRequest(req('OPTIONS', '/api/ask/threads', { origin: CHROME, 'access-control-request-method': 'POST' }), { remoteMode: false, verify });
  assert.equal(pre.kind, 'preflight');
  assert.equal(decideExtensionRequest(req('OPTIONS', '/api/settings', { origin: CHROME, 'access-control-request-method': 'GET' }), { remoteMode: false, verify }).code, 'extension-route');
  assert.equal(decideExtensionRequest(req('OPTIONS', '/api/ask/threads/t_1/cards/c_1', { origin: CHROME, 'access-control-request-method': 'POST' }), { remoteMode: false, verify }).code, 'extension-route');
  assert.equal(decideExtensionRequest(req('GET', '/api/projects', { origin: CHROME }), { remoteMode: false, verify }).code, 'extension-unpaired');
  const ok = decideExtensionRequest(req('GET', '/api/projects', { origin: CHROME, authorization: `Bearer ${TOKEN_PREFIX}good` }), { remoteMode: false, verify });
  assert.deepEqual([ok.kind, ok.extension.id], ['allow', 'ext_1']);
  assert.equal(decideExtensionRequest(req('POST', '/api/extension/pair', { origin: CHROME }), { remoteMode: false, verify }).kind, 'allow');
  const head = decideExtensionRequest(req('HEAD', '/api/ask/threads', { origin: CHROME, authorization: `Bearer ${TOKEN_PREFIX}good` }), { remoteMode: false, verify });
  assert.equal(head.code, 'extension-route');
});

// Chrome drops Origin from an extension's GET to a host it holds a grant for (activeTab on Worca's own tab): the
// extension's X-Worca-Extension header then names it, with exactly the rules an Origin gets.
test('decide: no Origin + X-Worca-Extension is decided as that extension origin (allowlist, token, Host, remote mode)', () => {
  const verify = (o, t) => (o === CHROME && t === `${TOKEN_PREFIX}good` ? { id: 'ext_1' } : null);
  const opts = { remoteMode: false, verify };
  const x = (h = {}) => ({ 'x-worca-extension': CHROME, ...h });
  assert.deepEqual(decideExtensionRequest(req('GET', '/api/extension/hello', x()), opts), { kind: 'allow', origin: CHROME, extension: null });
  assert.equal(decideExtensionRequest(req('GET', '/api/ask/threads', x()), opts).code, 'extension-unpaired');
  const ok = decideExtensionRequest(req('GET', '/api/ask/threads', x({ authorization: `Bearer ${TOKEN_PREFIX}good` })), opts);
  assert.deepEqual([ok.kind, ok.origin, ok.extension.id], ['allow', CHROME, 'ext_1']);
  assert.equal(decideExtensionRequest(req('GET', '/api/settings', x({ authorization: `Bearer ${TOKEN_PREFIX}good` })), opts).code, 'extension-route');
  assert.equal(decideExtensionRequest(req('GET', '/api/ask/threads', x({ host: 'evil.example' })), opts).kind, 'pass');
  assert.equal(decideExtensionRequest(req('GET', '/api/extension/hello', x()), { remoteMode: true, verify }).code, 'extension-remote-mode');
  // Another extension's token does not open the route for this one.
  const other = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
  assert.equal(decideExtensionRequest(req('GET', '/api/ask/threads', { 'x-worca-extension': other, authorization: `Bearer ${TOKEN_PREFIX}good` }), opts).code, 'extension-unpaired');
  // A header that is not an extension origin is no extension at all: S1 decides, as before.
  assert.equal(decideExtensionRequest(req('GET', '/api/extension/hello', { 'x-worca-extension': 'http://127.0.0.1:4317' }), opts).kind, 'pass');
});

test('decide: Origin and X-Worca-Extension that disagree are refused, without CORS for either', () => {
  const verify = () => ({ id: 'ext_1' });
  const opts = { remoteMode: false, verify };
  const other = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
  for (const origin of [other, 'http://127.0.0.1:4317', 'https://evil.example']) {
    const r = decideExtensionRequest(req('GET', '/api/extension/hello', { origin, 'x-worca-extension': CHROME }), opts);
    assert.deepEqual([r.kind, r.status, r.code, r.origin], ['refuse', 403, 'extension-origin', null], origin);
  }
  const same = decideExtensionRequest(req('GET', '/api/extension/hello', { origin: CHROME, 'x-worca-extension': CHROME }), opts);
  assert.equal(same.kind, 'allow');
});

test('decide: remote mode answers an allowlisted preflight, so the real request reads its extension-remote-mode refusal', () => {
  const opts = { remoteMode: true, verify: () => null };
  const pre = (path, method) => decideExtensionRequest(req('OPTIONS', path, { origin: CHROME, 'access-control-request-method': method, 'access-control-request-headers': 'x-worca-extension' }), opts);
  assert.equal(pre('/api/extension/hello', 'GET').kind, 'preflight');
  assert.equal(pre('/api/settings', 'GET').code, 'extension-remote-mode');
  assert.equal(decideExtensionRequest(req('GET', '/api/extension/hello', { origin: CHROME, 'x-worca-extension': CHROME }), opts).code, 'extension-remote-mode');
});

test('request → approve → poll delivers the token once; the store keeps only its hash at 0600', () => {
  const { p, file } = store();
  const r = p.request({ origin: CHROME, name: 'Worca for Chrome', browser: 'chrome' });
  assert.ok(r.ok); assert.match(r.code, /^\d{6}$/);
  assert.equal(p.poll(r.requestId, { origin: CHROME, pollKey: r.pollKey }).body.status, 'pending');
  assert.equal(p.poll(r.requestId, { origin: FIREFOX, pollKey: r.pollKey }).status, 404);
  assert.equal(p.poll(r.requestId, { origin: CHROME, pollKey: 'wrong' }).status, 404);
  assert.ok(p.resolve(r.requestId, 'approve').ok);
  const got = p.poll(r.requestId, { origin: CHROME, pollKey: r.pollKey });
  assert.equal(got.body.status, 'approved');
  assert.ok(got.body.token.startsWith(TOKEN_PREFIX));
  assert.equal(p.poll(r.requestId, { origin: CHROME, pollKey: r.pollKey }).status, 404);   // once
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(got.body.token));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(p.verify(CHROME, got.body.token).id, got.body.id);
  assert.equal(p.verify(FIREFOX, got.body.token), null);           // bound to its origin
  assert.equal(p.verify(CHROME, `${TOKEN_PREFIX}nope`), null);
});

test('deny, expiry, re-pair rotation, revoke', () => {
  const { p, t } = store();
  const a = p.request({ origin: CHROME, name: 'A', browser: 'chrome' });
  p.resolve(a.requestId, 'deny');
  assert.equal(p.poll(a.requestId, { origin: CHROME, pollKey: a.pollKey }).body.status, 'denied');
  const b = p.request({ origin: CHROME, name: 'B', browser: 'chrome' });
  t.v += PAIR_TTL_MS + 1;
  assert.equal(p.poll(b.requestId, { origin: CHROME, pollKey: b.pollKey }).status, 410);
  assert.equal(p.resolve(b.requestId, 'approve').ok, false);
  const c = p.request({ origin: CHROME, name: 'C', browser: 'chrome' });
  assert.deepEqual(p.resolve(c.requestId, 'approve').replaced, []);   // first pairing: nothing replaced
  const first = p.poll(c.requestId, { origin: CHROME, pollKey: c.pollKey }).body;
  const tok1 = first.token;
  const d = p.request({ origin: CHROME, name: 'C', browser: 'chrome' });
  assert.deepEqual(p.resolve(d.requestId, 'approve').replaced, [first.id]);   // the server closes these sockets (review m3)
  const tok2 = p.poll(d.requestId, { origin: CHROME, pollKey: d.pollKey }).body;
  assert.equal(p.verify(CHROME, tok1), null);                         // rotated
  assert.equal(p.list().paired.length, 1);
  assert.ok(p.revoke(tok2.id));
  assert.equal(p.verify(CHROME, tok2.token), null);
});

test('caps: one pending per origin (replaced), at most PAIR_MAX_PENDING, rate limit', () => {
  const { p } = store();
  const first = p.request({ origin: CHROME, name: 'x', browser: 'chrome' });
  p.request({ origin: CHROME, name: 'x', browser: 'chrome' });
  assert.equal(p.poll(first.requestId, { origin: CHROME, pollKey: first.pollKey }).status, 404);
  for (let i = 1; i < PAIR_MAX_PENDING; i++) assert.ok(p.request({ origin: `moz-extension://aaaaaaaa-0000-0000-0000-00000000000${i}`, browser: 'firefox' }).ok);
  assert.equal(p.request({ origin: FIREFOX, browser: 'firefox' }).code, 'extension-pair-busy');
  for (let i = 0; i < 12; i++) assert.equal(p.request({ origin: FIREFOX, browser: 'firefox' }).code, 'extension-pair-busy');   // v6: busy burns no rate slot
  const { p: q } = store();
  for (let i = 0; i < 10; i++) q.request({ origin: CHROME, browser: 'chrome' });
  assert.equal(q.request({ origin: CHROME, browser: 'chrome' }).code, 'extension-pair-rate');
});

test('an approved token can be collected for one TTL only (v6)', () => {
  const { p, t } = store();
  const r = p.request({ origin: CHROME, browser: 'chrome' });
  p.resolve(r.requestId, 'approve');
  t.v += PAIR_TTL_MS + 1;
  assert.equal(p.poll(r.requestId, { origin: CHROME, pollKey: r.pollKey }).status, 404);
});

test('a re-request reports the pending ids it replaced; names lose bidi/zero-width controls (v8)', () => {
  const { p } = store();
  const a = p.request({ origin: CHROME, name: 'A', browser: 'chrome' });
  assert.deepEqual(a.replacedRequestIds, []);
  const b = p.request({ origin: CHROME, name: 'Wo‮rca​', browser: 'chrome' });
  assert.deepEqual(b.replacedRequestIds, [a.requestId]);   // the pair route broadcasts extension-pairings-changed for each
  assert.equal(b.public.name, 'Wo rca');
});
