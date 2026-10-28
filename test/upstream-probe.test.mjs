import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeTargetForModel, probeReachable, ANTHROPIC_API } from '../src/core/upstream-probe.mjs';

const deps = (over = {}) => ({
  findBridgedEntry: () => null,
  resolveModelEnv: () => undefined,
  providerConfig: (p) => ({ baseUrl: p === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com', accountType: 'individual' }),
  copilotApiHost: () => 'https://api.githubcopilot.com',
  brokerEnabled: () => false,
  slotOfBaseUrl: () => null,
  cachedBrokerInfo: () => null,
  ...over,
});

test('default: the Anthropic API; an ambient ANTHROPIC_BASE_URL is used as its ORIGIN only', () => {
  assert.deepEqual(probeTargetForModel(null, { env: {}, deps: deps() }), { origin: ANTHROPIC_API, via: 'default' });
  assert.deepEqual(probeTargetForModel(null, { env: { ANTHROPIC_BASE_URL: 'https://user:pw@gw.example.com/v1?key=s3cret' }, deps: deps() }),
    { origin: 'https://gw.example.com', via: 'ambient' });
});

test('Bedrock / Vertex / Foundry provider modes are not probed (the CLI picks its own host)', () => {
  assert.equal(probeTargetForModel(null, { env: { CLAUDE_CODE_USE_BEDROCK: '1' }, deps: deps() }), null);
});

test('bridged model: the provider upstream, never the loopback bridge URL', () => {
  const bridged = (upstream) => deps({ findBridgedEntry: () => ({ id: 'm', upstream }) });
  assert.deepEqual(probeTargetForModel('m', { env: {}, deps: bridged({ provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' }) }),
    { origin: 'https://openrouter.ai', via: 'bridge' });
  assert.deepEqual(probeTargetForModel('m', { env: {}, deps: bridged({ provider: 'openai' }) }),
    { origin: 'https://api.openai.com', via: 'bridge' });
  assert.deepEqual(probeTargetForModel('m', { env: {}, deps: bridged({ provider: 'copilot' }) }),
    { origin: 'https://api.githubcopilot.com', via: 'bridge' });
});

test('env-style entry: its base URL, or the broker slot upstream behind a broker URL', () => {
  const d = deps({ resolveModelEnv: () => ({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' }) });
  assert.deepEqual(probeTargetForModel('lite', { env: {}, deps: d }), { origin: 'http://127.0.0.1:4000', via: 'env' });
  const viaBroker = deps({
    resolveModelEnv: () => ({ ANTHROPIC_BASE_URL: 'http://broker:7000/p/oai' }),
    slotOfBaseUrl: () => 'oai',
    cachedBrokerInfo: () => ({ slots: [{ id: 'oai', protocol: 'openai', upstream: 'https://api.openai.com' }] }),
  });
  assert.deepEqual(probeTargetForModel('x', { env: {}, deps: viaBroker }), { origin: 'https://api.openai.com', via: 'broker' });
});

test('broker on, default model: the broker anthropic slot upstream, else the Anthropic API', () => {
  const on = (info) => deps({ brokerEnabled: () => true, cachedBrokerInfo: () => info });
  assert.deepEqual(probeTargetForModel(null, { env: {}, deps: on({ slots: [{ id: 'a1', protocol: 'anthropic', upstream: 'https://api.anthropic.com' }] }) }),
    { origin: 'https://api.anthropic.com', via: 'broker' });
  assert.deepEqual(probeTargetForModel(null, { env: {}, deps: on(null) }), { origin: ANTHROPIC_API, via: 'broker' });
});

test('probeTargetForModel never throws', () => {
  assert.equal(probeTargetForModel('m', { env: {}, deps: deps({ findBridgedEntry: () => { throw new Error('boom'); } }) }), null);
});

test('probeReachable: header-less HEAD to the origin; any answer but 502/503/504 is reachable', async () => {
  const seen = [];
  const fetch = (status) => async (url, init) => { seen.push({ url, init }); return new Response(null, { status }); };
  assert.equal(await probeReachable('https://api.anthropic.com', { fetch: fetch(404) }), true);
  assert.equal(await probeReachable('https://api.anthropic.com', { fetch: fetch(401) }), true);
  assert.equal(await probeReachable('https://api.anthropic.com', { fetch: fetch(503) }), false);
  assert.equal(seen[0].url, 'https://api.anthropic.com');
  assert.equal(seen[0].init.method, 'HEAD');
  assert.equal(seen[0].init.headers, undefined, 'no header, so no key, is ever sent');
  assert.equal(seen[0].init.redirect, 'manual');
});

test('probeReachable: a transport error is unreachable; the caller\'s abort is rethrown', async () => {
  assert.equal(await probeReachable('https://x.invalid', { fetch: async () => { throw new TypeError('fetch failed'); } }), false);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(probeReachable('https://x.invalid', { signal: ac.signal, fetch: async (_u, i) => { i.signal.throwIfAborted(); } }));
});
