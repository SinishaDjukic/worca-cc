// test/ask-proxy-tools.test.mjs — the corporate proxy chat tools (docs/network-proxy.md "From Chat"): the bundle's
// bridge client (proxy-deps.mjs), the four tools in tools.mjs, their labels, and the card's apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProxyDeps, applyProxyChange } from '../src/core/ask/proxy-deps.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { labelForTool } from '../src/core/ask/events.mjs';

test('defaultProxyDeps: the bridge only with a loopback URL and a token; the token rides a header', async () => {
  assert.equal(defaultProxyDeps({ env: {} }).proxy.status, null);
  assert.equal(defaultProxyDeps({ env: { WORCA_ASK_PROXY: '{"url":"http://evil.test/api/ask/proxy"}', ASK_PROXY_TOKEN: 't' } }).proxy.status, null);
  const seen = [];
  const fetchImpl = async (url, o) => { seen.push([url, o.headers['x-worca-ask-proxy'], JSON.parse(o.body)]); return { ok: true, json: async () => ({ result: { enabled: true, state: 'ready' } }) }; };
  const d = defaultProxyDeps({ env: { WORCA_ASK_PROXY: '{"url":"http://127.0.0.1:4317/api/ask/proxy"}', ASK_PROXY_TOKEN: 'tok' }, fetchImpl });
  assert.deepEqual(await d.proxy.status(), { enabled: true, state: 'ready' });
  assert.deepEqual(seen, [['http://127.0.0.1:4317/api/ask/proxy', 'tok', { op: 'status' }]]);
});

const proxy = (o = {}) => ({ status: async () => ({ enabled: true, state: 'ready' }), test: async () => ({ ok: true, results: [] }),
  testOff: null, validateChange: async (i) => ({ ok: true, card: { type: 'proxy', kind: 'settings', patch: i } }), validateFlagOn: async () => ({ ok: true, card: { type: 'proxy', kind: 'enable' } }), ...o });

test('proxy tools: listed only with the bundle; the proxy off is read and tested like on; proposals delegate', async () => {
  const none = createAskTools({ limits: ASK_LIMITS }).list().map((t) => t.name);
  assert.ok(!none.includes('get_network_proxy'));
  const t = createAskTools({ limits: ASK_LIMITS, proxy: proxy() });
  const names = t.list().map((x) => x.name);
  for (const n of ['get_network_proxy', 'test_network_proxy', 'propose_network_proxy_change', 'propose_corporate_proxy_on']) assert.ok(names.includes(n), n);
  assert.deepEqual(await t.call('get_network_proxy', {}), { enabled: true, state: 'ready' });

  const off = createAskTools({ limits: ASK_LIMITS, proxy: proxy({ status: async () => ({ enabled: false, state: 'off' }) }) });
  assert.deepEqual(await off.call('get_network_proxy', {}), { enabled: false, state: 'off' });
  assert.deepEqual(await off.call('test_network_proxy', {}), { ok: true, results: [] }, 'the saved values are tested with the proxy off too');
  assert.equal((await off.call('propose_corporate_proxy_on', {})).ok, true);
  for (const d of t.list().filter((x) => /proxy/.test(x.name))) assert.doesNotMatch(d.description, /Labs|Restart Worca|restarted|FLAG_OFF|RESTART_NEEDED/, d.name);

  const relay = createAskTools({ limits: ASK_LIMITS, proxy: proxy({ test: null, testOff: 'agent isolation text' }) });
  assert.deepEqual(await relay.call('test_network_proxy', {}), { ok: false, code: 'PROXY_AGENT_BLOCKED', error: 'agent isolation text' });

  const noBridge = createAskTools({ limits: ASK_LIMITS, proxy: proxy({ status: null, test: null }) });
  assert.equal((await noBridge.call('get_network_proxy', {})).available, false);

  assert.deepEqual(await t.call('propose_network_proxy_change', { upstream: 'p.acme.test:3128' }), { ok: true, card: { type: 'proxy', kind: 'settings', patch: { upstream: 'p.acme.test:3128' } } });
  assert.equal(labelForTool('mcp__worca__test_network_proxy'), 'Testing the corporate proxy');
});

test('no tool takes a password: the schemas forbid it', () => {
  const t = createAskTools({ limits: ASK_LIMITS, proxy: proxy() });
  for (const d of t.list().filter((x) => /proxy/.test(x.name))) {
    assert.equal(d.inputSchema.additionalProperties, false, d.name);
    assert.ok(!JSON.stringify(d.inputSchema.properties || {}).match(/"(password|user|domain|login)"/), d.name);
  }
});

test('applyProxyChange: settings and the enable card go through saveSettings (the PUT path), live', async () => {
  const saved = [];
  const io = { saveSettings: async (p) => { saved.push(p); return { networkProxy: p, restartNeeded: false, pending: [] }; },
    enabledNow: () => false, validateChange: async () => ({ ok: true, card: { patch: { upstream: 'p.acme.test:3128' } } }) };
  assert.deepEqual(await applyProxyChange({ type: 'proxy', kind: 'settings', patch: { upstream: 'p.acme.test:3128' } }, io),
    { ok: true, detail: 'Saved. New connections use it now.' });
  assert.deepEqual(saved, [{ upstream: 'p.acme.test:3128' }]);
  assert.equal((await applyProxyChange({ type: 'proxy', kind: 'enable', patch: { enabled: true } }, io)).detail, 'Saved. New connections use it now.');
  assert.deepEqual(saved.at(-1), { enabled: true });
  assert.equal((await applyProxyChange({ type: 'proxy', kind: 'flag', set: { corporateProxy: true } }, io)).ok, true, 'a card proposed before the upgrade still applies');
  assert.deepEqual(saved.at(-1), { enabled: true });
  const n = saved.length;
  assert.match((await applyProxyChange({ type: 'proxy', kind: 'enable' }, { ...io, enabledNow: () => true })).detail, /already on/);
  assert.equal(saved.length, n, 'already on: nothing saved');
  const port = { ...io, saveSettings: async () => ({ pending: ['fixedPort'] }) };
  assert.equal((await applyProxyChange({ type: 'proxy', kind: 'settings', patch: { fixedPort: 3128 } }, port)).detail,
    'Saved. New connections use it now. The local proxy port applies at the next start.');
  await assert.rejects(applyProxyChange({ type: 'proxy', kind: 'settings', patch: {} }, { ...io, validateChange: async () => ({ ok: false, errors: ['nothing would change'] }) }), /nothing would change/);
});

test('applyProxyChange: an untested upstream is tested first; a failed test saves nothing', async () => {
  const UNTESTED = { refused: { status: 409, body: { code: 'UNTESTED', error: 'Test these proxy settings first' } } };
  const card = { type: 'proxy', kind: 'settings', patch: { upstream: 'p2.acme.test:3128' } };
  const base = { validateChange: async () => ({ ok: true, card: { patch: card.patch } }) };
  const calls = [];
  let saves = 0;
  const pass = { ...base, saveSettings: async (p) => { calls.push(['save', p]); return ++saves === 1 ? UNTESTED : { pending: [] }; },
    test: async (p) => { calls.push(['test', p]); return { status: 200, body: { ok: true } }; } };
  assert.deepEqual(await applyProxyChange(card, pass), { ok: true, detail: 'Saved. New connections use it now.' });
  assert.deepEqual(calls.map((c) => c[0]), ['save', 'test', 'save']);
  const failSaves = [];
  const fail = { ...base, saveSettings: async (p) => { failSaves.push(p); return UNTESTED; },
    test: async () => ({ status: 200, body: { ok: false } }) };
  await assert.rejects(applyProxyChange(card, fail), (err) => err.code === 'UNTESTED' && /the proxy test did not pass/.test(err.message));
  assert.equal(failSaves.length, 1, 'only the refused attempt: nothing was written');
});
