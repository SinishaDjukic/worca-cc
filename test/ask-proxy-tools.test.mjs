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
  const fetchImpl = async (url, o) => { seen.push([url, o.headers['x-worca-ask-proxy'], JSON.parse(o.body)]); return { ok: true, json: async () => ({ result: { flag: true, state: 'ready' } }) }; };
  const d = defaultProxyDeps({ env: { WORCA_ASK_PROXY: '{"url":"http://127.0.0.1:4317/api/ask/proxy"}', ASK_PROXY_TOKEN: 'tok' }, fetchImpl });
  assert.deepEqual(await d.proxy.status(), { flag: true, state: 'ready' });
  assert.deepEqual(seen, [['http://127.0.0.1:4317/api/ask/proxy', 'tok', { op: 'status' }]]);
});

const proxy = (o = {}) => ({ flagOn: () => true, status: async () => ({ flag: true, state: 'ready' }), test: async () => ({ ok: true, results: [] }),
  testOff: null, validateChange: async (i) => ({ ok: true, card: { type: 'proxy', kind: 'settings', patch: i } }), validateFlagOn: async () => ({ ok: true, card: { type: 'proxy', kind: 'flag' } }), ...o });

test('proxy tools: listed only with the bundle; flag off answers clearly; tests and proposals delegate', async () => {
  const none = createAskTools({ limits: ASK_LIMITS }).list().map((t) => t.name);
  assert.ok(!none.includes('get_network_proxy'));
  const t = createAskTools({ limits: ASK_LIMITS, proxy: proxy() });
  const names = t.list().map((x) => x.name);
  for (const n of ['get_network_proxy', 'test_network_proxy', 'propose_network_proxy_change', 'propose_corporate_proxy_on']) assert.ok(names.includes(n), n);
  assert.deepEqual(await t.call('get_network_proxy', {}), { flag: true, state: 'ready' });

  const off = createAskTools({ limits: ASK_LIMITS, proxy: proxy({ flagOn: () => false }) });
  const g = await off.call('get_network_proxy', {});
  assert.equal(g.flag, false);
  assert.match(g.howToTurnOn, /propose_corporate_proxy_on/);
  assert.match(g.howToTurnOn, /Settings › Labs/);
  assert.equal((await off.call('test_network_proxy', {})).code, 'FLAG_OFF');
  assert.equal((await off.call('propose_corporate_proxy_on', {})).ok, true, 'the flag card is the one proposal that works with the flag off');

  const bridgeSaysOff = createAskTools({ limits: ASK_LIMITS, proxy: proxy({ status: async () => ({ flag: false }) }) });
  assert.equal((await bridgeSaysOff.call('get_network_proxy', {})).flag, false, 'the server\'s flag answer wins');

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

test('applyProxyChange: settings go through saveSettings (the PUT path); the flag through setFlags', async () => {
  const saved = []; const flags = [];
  const io = { saveSettings: async (p) => { saved.push(p); return { networkProxy: p, restartNeeded: true }; },
    setFlags: async (p) => { flags.push(p); }, flagOn: () => false, validateChange: async () => ({ ok: true, card: { patch: { upstream: 'p.acme.test:3128' } } }),
    validateFlagOn: async () => ({ ok: true }) };
  assert.deepEqual(await applyProxyChange({ type: 'proxy', kind: 'settings', patch: { upstream: 'p.acme.test:3128' } }, io),
    { ok: true, detail: 'Saved. Restart Worca to apply.' });
  assert.deepEqual(saved, [{ upstream: 'p.acme.test:3128' }]);
  assert.equal((await applyProxyChange({ type: 'proxy', kind: 'flag', set: { corporateProxy: true } }, io)).detail,
    'Corporate proxy is on. Restart Worca to start the local proxy.');
  assert.deepEqual(flags, [{ corporateProxy: true }]);
  assert.match((await applyProxyChange({ type: 'proxy', kind: 'flag', set: { corporateProxy: true } }, { ...io, flagOn: () => true })).detail, /already on/);
  assert.equal(flags.length, 1, 'already on: no setFlags call');
  await assert.rejects(applyProxyChange({ type: 'proxy', kind: 'settings', patch: {} }, { ...io, validateChange: async () => ({ ok: false, errors: ['nothing would change'] }) }), /nothing would change/);
});
