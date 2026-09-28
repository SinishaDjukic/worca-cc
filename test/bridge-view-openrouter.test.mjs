// test/bridge-view-openrouter.test.mjs
// The model editor's OpenRouter routing (docs/models.md › OpenRouter): under
// Connection › Advanced, fallback models, provider order, allow-fallbacks and
// sort — shown only for an openai chat-completions entry whose base URL (its
// own, else the provider's) is OpenRouter's, round-tripped through
// set/collect, and never collected for any other endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderConnectionSection, applyConnectionMode, setModelUpstream, collectConnection, degradationLine } from '../ui/public/bridge-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const PROVIDERS = (baseUrl) => ({
  copilot: { connected: false },
  openai: { configured: true, keySet: true, baseUrl, maxConcurrent: 2 },
  anthropic: { configured: false, keySet: false, baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
});
const OR_UPSTREAM = {
  provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b:free', baseUrl: 'https://openrouter.ai/api/v1',
  capabilities: { toolCalls: true, reasoning: true },
  openrouter: { models: ['qwen/qwen3.8-27b'], provider: { order: ['ModelRun', 'Chutes'], allow_fallbacks: false, sort: 'throughput' } },
};

test('OpenRouter routing: rendered from the stored block, visible for an OpenRouter chat entry, and collected back', () => {
  const conn = renderConnectionSection({ id: 'or-qwen', upstream: OR_UPSTREAM }, { doc, providers: PROVIDERS('https://api.openai.com/v1') });
  const or = conn.querySelector('.mv-conn-or');
  assert.ok(or, 'rendered');
  assert.equal(or.hidden, false);
  assert.equal(conn.querySelector('.mv-conn-or-models').value, 'qwen/qwen3.8-27b');
  assert.equal(conn.querySelector('.mv-conn-or-order').value, 'ModelRun, Chutes');
  assert.equal(conn.querySelector('.mv-conn-or-fallbacks').checked, false);
  assert.equal(conn.querySelector('.mv-conn-or-sort').value, 'throughput');
  assert.deepEqual(collectConnection(conn).upstream.openrouter, OR_UPSTREAM.openrouter);
});

test('OpenRouter routing: defaults collect nothing (allow fallbacks on, no sort, empty lists)', () => {
  const conn = renderConnectionSection({ id: 'or-plain', upstream: { ...OR_UPSTREAM, openrouter: undefined } }, { doc, providers: PROVIDERS('') });
  assert.equal(conn.querySelector('.mv-conn-or-fallbacks').checked, true);
  assert.equal(conn.querySelector('.mv-conn-or-sort').value, '');
  assert.equal(collectConnection(conn).upstream.openrouter, undefined);
  conn.querySelector('.mv-conn-or-models').value = ' a/b , , c/d ';
  conn.querySelector('.mv-conn-or-sort').value = 'price';
  assert.deepEqual(collectConnection(conn).upstream.openrouter, { models: ['a/b', 'c/d'], provider: { sort: 'price' } });
});

test('OpenRouter routing: follows the provider\'s base URL when the entry has none, and hides (and is not collected) elsewhere', () => {
  const viaProvider = renderConnectionSection({ id: 'x', upstream: { ...OR_UPSTREAM, baseUrl: undefined } }, { doc, providers: PROVIDERS('https://openrouter.ai/api/v1') });
  assert.equal(viaProvider.querySelector('.mv-conn-or').hidden, false);

  const gw = renderConnectionSection({ id: 'y', upstream: { ...OR_UPSTREAM, baseUrl: 'https://gw.example/v1' } }, { doc, providers: PROVIDERS('https://openrouter.ai/api/v1') });
  assert.equal(gw.querySelector('.mv-conn-or').hidden, true);
  assert.equal(collectConnection(gw).upstream.openrouter, undefined, 'a hidden block is never stored');

  // Typing an OpenRouter base URL reveals it; switching to the Responses API hides it again.
  gw.querySelector('.mv-conn-baseurl').value = 'https://openrouter.ai/api/v1';
  applyConnectionMode(gw);
  assert.equal(gw.querySelector('.mv-conn-or').hidden, false);
  gw.querySelector('.mv-conn-api').value = 'openai-responses';
  applyConnectionMode(gw);
  assert.equal(gw.querySelector('.mv-conn-or').hidden, true);
});

test('OpenRouter routing: setModelUpstream fills and clears the fields', () => {
  const conn = renderConnectionSection(null, { doc, providers: PROVIDERS('https://openrouter.ai/api/v1') });
  setModelUpstream(conn, OR_UPSTREAM);
  assert.equal(conn.querySelector('.mv-conn-or-order').value, 'ModelRun, Chutes');
  assert.deepEqual(collectConnection(conn).upstream.openrouter, OR_UPSTREAM.openrouter);
  setModelUpstream(conn, { ...OR_UPSTREAM, openrouter: undefined });
  assert.equal(conn.querySelector('.mv-conn-or-models').value, '');
  assert.equal(conn.querySelector('.mv-conn-or-fallbacks').checked, true);
  assert.equal(collectConnection(conn).upstream.openrouter, undefined);
});

test('degradation line: a chat model with reasoning shows its thinking; without, unchanged', () => {
  assert.equal(degradationLine({ upstream: { api: 'openai-chat', capabilities: { reasoning: true } } }),
    'translated — reasoning shown but not carried across turns, no WebSearch/WebFetch');
  assert.equal(degradationLine({ upstream: { api: 'openai-chat', capabilities: {} } }), 'translated — no thinking blocks, no WebSearch/WebFetch');
});
