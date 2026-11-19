// test/bridge-openrouter-provider.test.mjs
// OpenRouter as a provider of its own on the bridge (models menu P2): an OpenRouter entry (provider openai, its
// effective base URL on openrouter.ai) takes its key, its concurrency cap and its routing defaults from the
// `providers.openrouter` block. The key chain: the entry's own key, else the block's key (only over https), else the
// OpenAI-compatible row's key while that row itself points at openrouter.ai (today's origin rule). OpenRouter calls
// queue apart from other OpenAI-compatible calls; routing goes field by field (the model's value wins, the row fills
// the rest; an OpenAI Responses call gets none). No request reaches the real openrouter.ai: `fetch` is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateProvider, updateOpenRouter } from '../src/core/settings.mjs';
import { openRouterKeyFor, openRouterRouting, upstreamSettings, providerReadiness } from '../src/core/bridge/registry.mjs';
import { handleMessages, semaphore, _resetBridgeWarnings } from '../src/core/bridge/upstream.mjs';
import { checkRows } from './helpers/rows.mjs';

const OR = 'https://openrouter.ai/api/v1';
const LOCAL = 'http://127.0.0.1:11434/v1';
const GATEWAY = 'https://gateway.example.com/v1';
const entry = (x = {}) => ({ provider: 'openai', api: 'openai-chat', model: 'x-ai/grok-4.7', ...x });
const NONE = { value: '', source: '' };

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-or-provider-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}

/** Run `fn` with OPENROUTER_KEY unset (tools/test.mjs does not drop it), restoring it after. */
async function withoutOpenRouterKey(fn) {
  const prev = process.env.OPENROUTER_KEY;
  delete process.env.OPENROUTER_KEY;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.OPENROUTER_KEY; else process.env.OPENROUTER_KEY = prev;
  }
}

function fakeReply() {
  const r = { statusCode: 0, headers: null, chunks: [], body: null, ended: false };
  return Object.assign(r, {
    status(code, headers) { r.statusCode = code; r.headers = headers; },
    write(c) { r.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); },
    end() { r.ended = true; },
    json(status, obj, headers) { r.statusCode = status; r.body = obj; r.headers = headers || null; r.ended = true; },
  });
}
function sseResponse(chunks) {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const okStream = () => sseResponse([{ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }]);
const BODY = { model: 'or-grok', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'hi' }] };

/** A fetch whose every call waits until `open()`; calls made after it answer at once. */
function heldFetch() {
  let open;
  const gate = new Promise((r) => { open = r; });
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url, authorization: init.headers.authorization }); await gate; return okStream(); };
  return { fetch, seen, open };
}
const tick = () => new Promise((r) => setImmediate(r));

// ── the key chain (pure, plain cfg) ───────────────────────────────────────────

test('openRouterKeyFor: the entry\'s key, else the block\'s (https only), else the OpenAI-compatible row\'s while it is on OpenRouter', async () => {
  await withoutOpenRouterKey(() => checkRows([
    { name: 'the entry\'s own key comes first', run: async () => assert.deepEqual(
      openRouterKeyFor(entry({ baseUrl: OR, apiKey: 'sk-entry' }), { openrouter: { apiKey: 'sk-or' }, openai: { baseUrl: OR, apiKey: 'sk-old' } }),
      { value: 'sk-entry', source: 'entry' }) },
    { name: 'the block\'s key, while the OpenAI-compatible row points at a local server', run: async () => assert.deepEqual(
      openRouterKeyFor(entry({ baseUrl: OR }), { openrouter: { apiKey: 'sk-or' }, openai: { baseUrl: LOCAL, apiKey: 'sk-local' } }),
      { value: 'sk-or', source: 'openrouter' }) },
    { name: 'no block key, the OpenAI-compatible row on OpenRouter: its key (today\'s answer)', run: async () => assert.deepEqual(
      openRouterKeyFor(entry(), { openai: { baseUrl: OR, apiKey: 'sk-old' } }),
      { value: 'sk-old', source: 'openai-legacy' }) },
    { name: 'no key anywhere, the OpenAI-compatible row on OpenRouter: none, from no link', run: async () => assert.deepEqual(
      openRouterKeyFor(entry(), { openrouter: {}, openai: { baseUrl: OR } }), NONE) },
    { name: 'no block key, the OpenAI-compatible row on a local server: none (its key never goes to OpenRouter)', run: async () => assert.deepEqual(
      openRouterKeyFor(entry({ baseUrl: OR }), { openai: { baseUrl: LOCAL, apiKey: 'sk-local' } }), NONE) },
    { name: 'block ${OPENROUTER_KEY} unset with openai on OR holding sk-old: the chain stops, the legacy key is not tried', run: async () => assert.deepEqual(
      openRouterKeyFor(entry(), { openrouter: { apiKey: '${OPENROUTER_KEY}' }, openai: { baseUrl: OR, apiKey: 'sk-old' } }),
      { value: '', source: 'openrouter' }) },
    { name: 'an http://openrouter.ai/api/v1 entry with a block key: none (the block key goes only over https)', run: async () => assert.deepEqual(
      openRouterKeyFor(entry({ baseUrl: 'http://openrouter.ai/api/v1' }), { openrouter: { apiKey: 'sk-or' } }), NONE) },
    { name: 'an https://eu.openrouter.ai/api/v1 entry with only the openai row on OR: none (today\'s origin rule)', run: async () => assert.equal(
      openRouterKeyFor(entry({ baseUrl: 'https://eu.openrouter.ai/api/v1' }), { openai: { baseUrl: OR, apiKey: 'sk-old' } }).value, '') },
    { name: 'an entry that is not OpenRouter\'s never gets the block key', run: async () => assert.deepEqual(
      openRouterKeyFor(entry({ baseUrl: GATEWAY }), { openrouter: { apiKey: 'sk-or' }, openai: { baseUrl: OR, apiKey: 'sk-old' } }), NONE) },
  ]));
});

// ── routing, field by field (pure) ────────────────────────────────────────────

test('openRouterRouting: the model\'s value wins, the row\'s default fills what is missing', async () => {
  const row = { openrouter: { order: ['anthropic', 'google'], sort: 'price', allowFallbacks: false } };
  await checkRows([
    { name: 'no entry routing: the row\'s defaults', run: async () => assert.deepEqual(
      openRouterRouting(entry(), row), { provider: { order: ['anthropic', 'google'], sort: 'price', allow_fallbacks: false } }) },
    { name: 'the entry\'s sort wins; order and allow_fallbacks from the row', run: async () => assert.deepEqual(
      openRouterRouting(entry({ openrouter: { provider: { sort: 'latency' } } }), row),
      { provider: { order: ['anthropic', 'google'], sort: 'latency', allow_fallbacks: false } }) },
    { name: 'the entry\'s models, order and allow_fallbacks win; the row fills the sort', run: async () => assert.deepEqual(
      openRouterRouting(entry({ openrouter: { models: ['a/b'], provider: { order: ['xai'], allow_fallbacks: true } } }), row),
      { models: ['a/b'], provider: { order: ['xai'], sort: 'price', allow_fallbacks: true } }) },
    { name: 'an empty row and no entry routing: undefined', run: async () => assert.equal(openRouterRouting(entry(), { openrouter: {} }), undefined) },
    { name: 'the row at its defaults and no entry routing: undefined', run: async () => assert.equal(
      openRouterRouting(entry(), { openrouter: { apiKey: '', maxConcurrent: 8, order: [], sort: '', allowFallbacks: true } }), undefined) },
    { name: 'the entry\'s allow_fallbacks false against the row\'s true', run: async () => assert.deepEqual(
      openRouterRouting(entry({ openrouter: { provider: { allow_fallbacks: false } } }), { openrouter: { allowFallbacks: true } }),
      { provider: { allow_fallbacks: false } }) },
  ]);
});

// ── with settings ─────────────────────────────────────────────────────────────

test('upstreamSettings: an OpenRouter entry takes key and cap from the block and queues as openrouter; others as today', async () => {
  await withSandbox(async () => {
    await updateProvider('openai', { baseUrl: LOCAL, maxConcurrent: 5 });
    await updateOpenRouter({ apiKey: 'sk-or', maxConcurrent: 3 });
    const or = upstreamSettings(entry({ baseUrl: OR }));
    assert.deepEqual([or.queue, or.maxConcurrent, or.apiKey], ['openrouter', 3, 'sk-or']);
    assert.equal(or.provider, 'openai', 'errors and telemetry still name the openai provider');
    const local = upstreamSettings(entry({ model: 'qwen3' }));
    assert.deepEqual([local.queue, local.maxConcurrent], ['openai', 5]);
    assert.deepEqual(openRouterKeyFor(entry({ baseUrl: OR })), { value: 'sk-or', source: 'openrouter' }, 'the default cfg reads the stored settings');
  });
});

test('upstreamSettings: the person who set OpenRouter up on the OpenAI-compatible row keeps the same base, key and routing', async () => {
  await withSandbox(async () => {
    await updateProvider('openai', { baseUrl: OR, apiKey: 'sk-old' });
    const us = upstreamSettings(entry({ openrouter: { provider: { sort: 'price' } } }));
    assert.deepEqual([us.baseUrl, us.apiKey, us.openrouter], [OR, 'sk-old', { provider: { sort: 'price' } }]);
  });
});

test('providerReadiness: an OpenRouter entry\'s key state, and why it is not ready', async () => {
  const run = (setup, upstream, check) => async () => withSandbox(async () => { await setup(); check(providerReadiness(upstream)); });
  await withoutOpenRouterKey(() => checkRows([
    { name: 'no key anywhere: set the OpenRouter key', run: run(async () => {}, entry({ baseUrl: OR }), (r) => assert.deepEqual(r,
      { ok: false, reason: 'no_key', message: 'provider openai: no API key — set the OpenRouter key under Models › Providers' })) },
    { name: 'block ${OPENROUTER_KEY} unset: the variable is not set', run: run(async () => { await updateOpenRouter({ apiKey: '${OPENROUTER_KEY}' }); },
      entry({ baseUrl: OR }), (r) => { assert.equal(r.ok, false); assert.match(r.message, /\$\{VAR\} is not set/); }) },
    { name: 'the entry\'s own ${OPENROUTER_KEY} unset, nothing else: the variable is not set', run: run(async () => {},
      entry({ baseUrl: OR, apiKey: '${OPENROUTER_KEY}' }), (r) => { assert.equal(r.ok, false); assert.match(r.message, /\$\{VAR\} is not set/); }) },
    { name: 'the OpenAI-compatible row on OR with an unset ${OPENROUTER_KEY}, no block: the variable is not set', run: run(async () => {
      await updateProvider('openai', { baseUrl: OR, apiKey: '${OPENROUTER_KEY}' });
    }, entry(), (r) => { assert.equal(r.ok, false); assert.match(r.message, /\$\{VAR\} is not set/); }) },
    { name: 'block sk-or with openai on a local server holding sk-local: ready', run: run(async () => {
      await updateOpenRouter({ apiKey: 'sk-or' });
      await updateProvider('openai', { baseUrl: LOCAL, apiKey: 'sk-local' });
    }, entry({ baseUrl: OR }), (r) => assert.deepEqual(r, { ok: true })) },
    { name: 'block sk-or and an http://openrouter.ai/api/v1 entry: the key goes only over https', run: run(async () => { await updateOpenRouter({ apiKey: 'sk-or' }); },
      entry({ baseUrl: 'http://openrouter.ai/api/v1' }), (r) => assert.deepEqual(r,
        { ok: false, reason: 'no_key', message: 'provider openai: the OpenRouter key goes only over https — use https://openrouter.ai/api/v1 as the model\'s base URL' })) },
    { name: 'another OpenAI-compatible endpoint without a key: today\'s words', run: run(async () => {
      await updateProvider('openai', { baseUrl: GATEWAY, apiKey: null });
    }, entry({ model: 'gpt-x' }), (r) => assert.deepEqual(r, { ok: false, reason: 'no_key', message: 'provider openai: no API key — open Models › Providers' })) },
  ]));
});

// ── through handleMessages ────────────────────────────────────────────────────

test('handleMessages: eight OpenRouter calls in flight do not delay another OpenAI-compatible endpoint, and the reverse', async () => {
  await withSandbox(async () => {
    _resetBridgeWarnings();
    await updateOpenRouter({ apiKey: 'sk-or', maxConcurrent: 8 });
    await updateProvider('openai', { baseUrl: GATEWAY, apiKey: 'sk-gw', maxConcurrent: 8 });
    const orEntry = { id: 'or-grok', upstream: entry({ baseUrl: OR }) };
    const gwEntry = { id: 'gw-gpt', upstream: entry({ model: 'gpt-x' }) };
    const logged = [];
    const call = (e, f, tag) => handleMessages({ entry: e, body: BODY, tag, fetch: f, log: (l) => logged.push(l) }, fakeReply());
    const halves = [
      { many: orEntry, manyKey: 'openrouter', one: gwEntry, oneKey: 'openai', oneBase: GATEWAY, oneAuth: 'Bearer sk-gw' },
      { many: gwEntry, manyKey: 'openai', one: orEntry, oneKey: 'openrouter', oneBase: OR, oneAuth: 'Bearer sk-or' },
    ];
    for (const h of halves) {
      const held = heldFetch();
      const calls = [];
      let settled = false;
      try {
        for (let i = 0; i < 8; i++) calls.push(call(h.many, held.fetch, `${h.manyKey}-${i}`));
        await tick();
        assert.equal(semaphore.active(h.manyKey), 8, `${h.manyKey}: eight calls in flight`);
        assert.equal(held.seen.length, 8);
        calls.push(call(h.one, held.fetch, `${h.oneKey}-probe`).then(() => { settled = true; }));
        await tick();
        assert.equal(settled, false, 'the probe waits on its held fetch, not on a slot');
        assert.deepEqual(held.seen.slice(8), [{ url: `${h.oneBase}/chat/completions`, authorization: h.oneAuth }], `${h.oneKey}: the probe's fetch ran`);
        assert.equal(semaphore.queued(h.oneKey), 0, `${h.oneKey}: nothing queued`);
      } finally {
        held.open();   // drain even on a failed check, or the slots stay taken and later tests wait forever
        await Promise.all(calls);
      }
      assert.equal(settled, true);
      assert.deepEqual([semaphore.active('openrouter'), semaphore.active('openai')], [0, 0], 'drained before the next half');
    }
    assert.deepEqual(logged.filter((l) => /requests queued/.test(l)), [], 'no call queued');
  });
});

test('handleMessages: a call over a cap queues on its own queue; the OpenRouter line names the OpenRouter row', async () => {
  await withSandbox(async () => {
    _resetBridgeWarnings();
    await updateOpenRouter({ apiKey: 'sk-or', maxConcurrent: 1 });
    await updateProvider('openai', { baseUrl: GATEWAY, apiKey: 'sk-gw', maxConcurrent: 1 });
    const logged = [];
    const held = heldFetch();
    const call = (e) => handleMessages({ entry: e, body: BODY, tag: 'cap', fetch: held.fetch, log: (l) => logged.push(l) }, fakeReply());
    const calls = [];
    try {
      for (const e of [{ id: 'or-grok', upstream: entry({ baseUrl: OR }) }, { id: 'gw-gpt', upstream: entry({ model: 'gpt-x' }) }]) {
        calls.push(call(e));
        await tick();
        calls.push(call(e));
        await tick();
      }
      assert.deepEqual([semaphore.active('openrouter'), semaphore.queued('openrouter'), semaphore.active('openai'), semaphore.queued('openai'), held.seen.length], [1, 1, 1, 1, 2]);
      assert.deepEqual(logged, [
        '[worca] bridge: requests queued for OpenRouter (cap 1) — raise it on the OpenRouter row under Models › Providers if this is slow',
        '[worca] bridge: requests queued for openai (cap 1) — raise it under Models › Providers if this is slow',
      ], 'one line per queue, even on one tag');
    } finally {
      held.open();
      await Promise.all(calls);
    }
    assert.deepEqual([semaphore.active('openrouter'), semaphore.queued('openrouter'), semaphore.active('openai'), semaphore.queued('openai'), held.seen.length], [0, 0, 0, 0, 4]);
  });
});

test('handleMessages: the row\'s routing defaults fill the model\'s routing; an OpenAI Responses call gets none', async () => {
  await withSandbox(async () => {
    _resetBridgeWarnings();
    await updateOpenRouter({ apiKey: 'sk-or', order: ['anthropic'], sort: 'price', allowFallbacks: false });
    const seen = [];
    const fetch = async (url, init) => { seen.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return okStream(); };
    const upstream = entry({ baseUrl: OR, openrouter: { provider: { sort: 'latency' } } });
    const reply = fakeReply();
    await handleMessages({ entry: { id: 'or-grok', upstream }, body: BODY, tag: 'or-body', fetch, log: () => {} }, reply);
    assert.equal(reply.statusCode, 200);
    assert.equal(seen[0].url, `${OR}/chat/completions`);
    assert.deepEqual(seen[0].body.provider, { order: ['anthropic'], sort: 'latency', allow_fallbacks: false });
    assert.equal(seen[0].headers.authorization, 'Bearer sk-or');
    await handleMessages({ entry: { id: 'or-grok-r', upstream: { ...upstream, api: 'openai-responses' } }, body: BODY, tag: 'or-body-r', fetch, log: () => {} }, fakeReply());
    assert.equal(seen[1].url, `${OR}/responses`);
    assert.equal(seen[1].body.provider, undefined);
    assert.equal(seen[1].body.models, undefined);
  });
});

test('handleMessages: a block key in an unset ${OPENROUTER_KEY} answers not signed in and never calls out', async () => {
  await withSandbox(() => withoutOpenRouterKey(async () => {
    _resetBridgeWarnings();
    await updateProvider('openai', { baseUrl: OR, apiKey: 'sk-old' });
    await updateOpenRouter({ apiKey: '${OPENROUTER_KEY}' });
    let calls = 0;
    const reply = fakeReply();
    await handleMessages({ entry: { id: 'or-grok', upstream: entry() }, body: BODY, tag: 'or-unset', fetch: async () => { calls += 1; return okStream(); }, log: () => {} }, reply);
    assert.equal(reply.statusCode, 401);
    assert.equal(reply.body.error.type, 'authentication_error');
    assert.match(reply.body.error.message, /^provider openai: not signed in — .*the API key's \$\{VAR\} is not set/);
    assert.equal(calls, 0);
  }));
});
