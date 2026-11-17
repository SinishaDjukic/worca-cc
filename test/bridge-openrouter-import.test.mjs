// test/bridge-openrouter-import.test.mjs
// OpenRouter as an OpenAI-compatible endpoint (docs/models.md "OpenRouter"): its /models carries
// what the generic list does not — the window it serves, the output cap, supported parameters,
// modalities and per-token prices — so the import reads them instead of asking the user to type
// them. Remote endpoints get a host-named id prefix instead of `local-`, an entry imported under
// the old prefix is still found by a re-import, and a key test reports the account's limits.
// The fixture rows are trimmed from the live https://openrouter.ai/api/v1/models (2026-09-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  listEndpointModels, catalogEntryForEndpointModel, importableModel, isOpenRouter, endpointIdPrefix,
} from '../src/core/bridge/providers/endpoint.mjs';
import { openRouterKeyInfo, formatOpenRouterKeyInfo, endpointModelsForImport, importEndpointModels } from '../src/core/bridge/provider-ops.mjs';
import { addGlobalModel, listGlobalModels } from '../src/core/settings.mjs';
import { renderEndpointSheet, endpointRowMatches } from '../ui/public/bridge-view.mjs';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function stub(routes, log = []) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push({ url: u, init });
    for (const [path, body] of Object.entries(routes)) if (u.endsWith(path)) return typeof body === 'function' ? body(init) : json(body);
    return new Response('not found', { status: 404 });
  };
}

const OR_BASE = 'https://openrouter.ai/api/v1';
const OR_MODELS = JSON.parse(readFileSync(new URL('./fixtures/bridge/openrouter-models.json', import.meta.url), 'utf8'));

test('isOpenRouter / endpointIdPrefix: OpenRouter and other remote hosts get their own prefix, local keeps `local`', () => {
  assert.equal(isOpenRouter(OR_BASE), true);
  assert.equal(isOpenRouter('https://OpenRouter.ai/api/v1/'), true);
  assert.equal(isOpenRouter('https://eu.openrouter.ai/api/v1'), true);
  assert.equal(isOpenRouter('https://notopenrouter.ai/v1'), false);
  assert.equal(isOpenRouter('not a url'), false);
  assert.equal(endpointIdPrefix('openrouter', OR_BASE), 'openrouter');
  assert.equal(endpointIdPrefix('openai-compatible', 'http://127.0.0.1:8000/v1'), 'local');
  assert.equal(endpointIdPrefix('openai-compatible', 'http://gpu.local:8000/v1'), 'local');
  assert.equal(endpointIdPrefix('openai-compatible', 'https://api.groq.com/openai/v1'), 'groq');
  assert.equal(endpointIdPrefix('openai-compatible', 'https://api.together.xyz/v1'), 'together');
  assert.equal(endpointIdPrefix('openai-compatible', 'https://llm-gw.corp.example.com/v1'), 'llm-gw');
  assert.equal(endpointIdPrefix('vllm', 'https://gpu.example.com/v1'), 'vllm', 'a recognised server keeps its own prefix');
  assert.equal(endpointIdPrefix('ollama', 'http://127.0.0.1:11434/v1'), 'ollama');
});

test('OpenRouter: one /models call (no local-server probes), every field that decides a pipeline is read', async () => {
  const log = [];
  const r = await listEndpointModels(OR_BASE, { apiKey: 'k', fetch: stub({ '/api/v1/models': OR_MODELS }, log) });
  assert.equal(r.server, 'openrouter');
  assert.equal(r.serverLabel, 'OpenRouter');
  assert.deepEqual(log.map((l) => l.url), [`${OR_BASE}/models`], 'no /props, /api/tags or /api/v0/models probes against a hosted API');
  const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
  const q = by['qwen/qwen3.8-27b:free'];
  assert.equal(q.name, 'Qwen: Qwen3.8 27B (free)');
  assert.equal(q.kind, 'llm');
  assert.equal(q.servedContext, 262144, 'OpenRouter serves the window it lists');
  assert.equal(q.maxOutputTokens, 235929);
  assert.equal(q.toolCalls, true);
  assert.equal(q.reasoning, true);
  assert.equal(q.vision, true);
  assert.deepEqual(q.pricing, { free: true });
  assert.equal(q.free, true);
  assert.match(q.detail, /free/);
  const s = by['anthropic/claude-sonnet-4.5'];
  assert.deepEqual(s.pricing, { perMtok: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });
  assert.equal(s.free, false);
  assert.match(s.detail, /\$3 \/ \$15 per M/);
  assert.equal(by['sao10k/l3-lunaris-8b'].toolCalls, false, 'no `tools` in supported_parameters is a known "no"');
  assert.equal(by['sao10k/l3-lunaris-8b'].reasoning, false);
  assert.equal(by['google/gemini-3-pro-image'].kind, 'llm', 'text is among the outputs');
  assert.equal(by['openrouter/auto'].pricing, null, 'a negative (variable) price pins nothing');
  assert.equal(by['openrouter/auto'].servedContext, 2000000, 'top_provider null falls back to context_length');
  assert.ok(!r.warnings.some((w) => /does not report context windows/.test(w)));
  assert.ok(r.warnings.some((w) => /:free models run on a pool OpenRouter shares/.test(w)), 'the shared-pool 429 is explained up front');
});

test('OpenRouter: blocked rows, and the catalog entry pins window, output cap, capabilities and the listed price', async () => {
  const r = await listEndpointModels(OR_BASE, { fetch: stub({ '/api/v1/models': OR_MODELS }) });
  const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
  assert.equal(importableModel(by['sao10k/l3-lunaris-8b']).ok, false);
  assert.equal(importableModel(by['qwen/qwen3.8-27b:free']).ok, true);

  const q = catalogEntryForEndpointModel(by['qwen/qwen3.8-27b:free'], { server: 'openrouter', baseUrl: OR_BASE, providerBaseUrl: OR_BASE });
  assert.equal(q.id, 'openrouter-qwen-qwen3-8-27b-free', 'the vendor stays in the id: two vendors ship same-named models');
  assert.equal(q.label, 'Qwen: Qwen3.8 27B (free) (OpenRouter)');
  assert.equal(q.efforts, undefined, 'a reasoning model keeps every effort');
  assert.deepEqual(q.upstream, {
    provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b:free',
    // An OpenRouter listing always stores the base it was listed from, even when the OpenAI-compatible row points
    // there too: a later edit of that row cannot move the entry (bridge-endpoint pins "no baseUrl" for other hosts).
    baseUrl: OR_BASE,
    // 235929 is most of the window: pinned as the output cap, prompt + max_tokens would overflow
    // the window on the first large turn, so the cap is left to the CLI.
    capabilities: { toolCalls: true, vision: true, reasoning: true, maxPromptTokens: 262144 },
  });
  assert.deepEqual(q.cost, { free: true });

  const s = catalogEntryForEndpointModel(by['anthropic/claude-sonnet-4.5'], { server: 'openrouter', baseUrl: OR_BASE, providerBaseUrl: 'https://api.openai.com/v1' });
  assert.equal(s.upstream.baseUrl, OR_BASE, 'OpenRouter while the provider points elsewhere: the entry carries its own URL');
  assert.equal(s.upstream.capabilities.maxOutputTokens, 64000);
  assert.deepEqual(s.cost, { perMtok: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } });

  const auto = catalogEntryForEndpointModel(by['openrouter/auto'], { server: 'openrouter', baseUrl: OR_BASE });
  assert.equal(auto.cost, undefined, 'a variable price is left unset (cost not verified) rather than claimed free');
});

test('the generic path is unchanged: a remote gateway without windows still warns, ids are host-named', async () => {
  const r = await listEndpointModels('https://api.groq.com/openai/v1', { fetch: stub({ '/openai/v1/models': { data: [{ id: 'llama-3.3-70b', owned_by: 'Meta' }] } }) });
  assert.equal(r.server, 'openai-compatible');
  assert.equal(r.models[0].toolCalls, null);
  assert.ok(r.warnings.some((w) => /does not report context windows/.test(w)));
  const e = catalogEntryForEndpointModel(r.models[0], { server: r.server, baseUrl: r.baseUrl });
  assert.equal(e.id, 'groq-llama-3-3-70b');
  const local = catalogEntryForEndpointModel(r.models[0], { server: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' });
  assert.equal(local.id, 'local-llama-3-3-70b');
});

test('openRouterKeyInfo: GET {base}/key with the key, normalised; the key itself and its label never come back', async () => {
  const log = [];
  const f = stub({ '/api/v1/key': { data: {
    label: 'sk-or-v1-216...03c', limit: 10, limit_remaining: 9.5, usage: 0.5, usage_daily: 0.1, is_free_tier: false,
    free_model_daily_requests: { used: 3, limit: 1000, remaining: 997 }, rate_limit: { requests: 20, interval: '10s' },
  } } }, log);
  const info = await openRouterKeyInfo(OR_BASE, 'sk-or-secret', { fetch: f });
  assert.equal(log[0].url, `${OR_BASE}/key`);
  assert.equal(log[0].init.headers.authorization, 'Bearer sk-or-secret');
  assert.deepEqual(info, {
    limit: 10, limitRemaining: 9.5, usage: 0.5, usageDaily: 0.1, isFreeTier: false,
    freeDaily: { used: 3, limit: 1000, remaining: 997 }, rateLimit: { requests: 20, interval: '10s' },
  });
  assert.ok(!JSON.stringify(info).includes('sk-or'), 'neither the key nor its label (a key fragment) is returned');
  const line = formatOpenRouterKeyInfo(info);
  assert.equal(line, 'credit $9.50 of $10.00 left · free-model requests today 997 / 1000 · rate limit 20 per 10s');
  assert.equal(formatOpenRouterKeyInfo({ limit: null, usage: 1.25, isFreeTier: true, freeDaily: null }), 'no credit limit · $1.25 used · free tier');
  // The live API answers `requests: -1` for a key with no rate limit of its own: nothing to show.
  const unlimited = await openRouterKeyInfo(OR_BASE, 'k', { fetch: stub({ '/api/v1/key': { data: { limit: null, usage: 0, rate_limit: { requests: -1, interval: '10s' } } } }) });
  assert.equal(unlimited.rateLimit, null);
  assert.equal(await openRouterKeyInfo(OR_BASE, 'k', { fetch: stub({}) }), null, 'a failure is null, never a throw');
  assert.equal(await openRouterKeyInfo(OR_BASE, '', { fetch: stub({}) }), null, 'no key, no call');
});

test('the OpenRouter sheet: price in the detail, per-row filter data, and the Free / Tools / window filters', async () => {
  const r = await listEndpointModels(OR_BASE, { fetch: stub({ '/api/v1/models': OR_MODELS }) });
  const models = r.models.map((m) => ({ ...m, catalogId: `openrouter-${m.id}`, importable: importableModel(m).ok, ...(importableModel(m).ok ? {} : { blocked: importableModel(m).why }) }));
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const sheet = renderEndpointSheet({ ...r, models }, { doc });
  doc.body.appendChild(sheet);
  assert.equal(sheet.dataset.server, 'openrouter');
  assert.doesNotMatch(sheet.textContent, /a model on your own machine bills nothing/, 'a hosted API is not "your own machine"');
  const row = (id) => sheet.querySelector(`tbody tr[data-id="${id}"]`);
  assert.equal(row('qwen/qwen3.8-27b:free').dataset.free, '1');
  assert.equal(row('qwen/qwen3.8-27b:free').dataset.tools, '1');
  assert.equal(row('qwen/qwen3.8-27b:free').dataset.ctx, '262144');
  assert.equal(row('anthropic/claude-sonnet-4.5').dataset.free, '0');
  const bar = sheet.querySelector('.mvi-or-filters');
  assert.ok(bar, 'OpenRouter gets the filter bar');
  const free = bar.querySelector('.mvi-f-free'); const tools = bar.querySelector('.mvi-f-tools'); const ctx = bar.querySelector('.mvi-f-ctx');
  assert.ok(free && tools && ctx);
  assert.deepEqual([...ctx.options].map((o) => o.value), ['0', '65536', '131072', '262144', '1000000']);
  // Nothing set: every row passes.
  assert.ok(models.every((m) => endpointRowMatches(row(m.id), sheet, '')));
  free.checked = true;
  assert.deepEqual(models.filter((m) => endpointRowMatches(row(m.id), sheet, '')).map((m) => m.id), ['qwen/qwen3.8-27b:free']);
  free.checked = false; tools.checked = true; ctx.value = '262144';
  assert.deepEqual(models.filter((m) => endpointRowMatches(row(m.id), sheet, '')).map((m) => m.id).sort(), ['anthropic/claude-sonnet-4.5', 'openrouter/auto', 'qwen/qwen3.8-27b:free']);
  assert.deepEqual(models.filter((m) => endpointRowMatches(row(m.id), sheet, 'claude')).map((m) => m.id), ['anthropic/claude-sonnet-4.5'], 'and the text query still applies');

  // A local server's sheet has no filter bar, and its rows still match on text alone.
  const local = renderEndpointSheet({ server: 'ollama', serverLabel: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', warnings: [], models: [{ id: 'a', name: 'a', importable: true }] }, { doc });
  assert.equal(local.querySelector('.mvi-or-filters'), null);
  assert.match(local.textContent, /a model on your own machine bills nothing/);
  assert.equal(endpointRowMatches(local.querySelector('tbody tr'), local, 'a'), true);
  assert.equal(endpointRowMatches(local.querySelector('tbody tr'), local, 'zzz'), false);
});

test('the Providers card: OpenRouter is a row of its own, so the OpenAI-compatible row offers no preset; the UI and the CLI alias name one URL', async () => {
  const { renderProvidersCard, collectProviderRow, OPENROUTER_PRESET } = await import('../ui/public/bridge-view.mjs');
  const { OPENROUTER_BASE_URL } = await import('../src/core/bridge/provider-ops.mjs');
  assert.equal(OPENROUTER_PRESET.baseUrl, OPENROUTER_BASE_URL, 'the UI preset and the CLI alias point at the same URL');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const card = renderProvidersCard({ openai: { configured: false, keySet: false, baseUrl: 'https://api.openai.com/v1', maxConcurrent: 8 }, anthropic: {} }, { doc, split: true });
  doc.body.appendChild(card);
  assert.equal(card.querySelector('.mv-pv-preset'), null);
  assert.deepEqual(collectProviderRow(card, 'openai'), { baseUrl: 'https://api.openai.com/v1', maxConcurrent: 8 });
});

// ── Imports store their address; the listing key is the OpenRouter row's (providers.openrouter) ──

const OR = OR_BASE;
const LOCAL = 'http://127.0.0.1:8080/v1';

/** A sandboxed HOME holding `settings`, no broker, and OPENROUTER_KEY unset (all restored afterwards). */
async function withSandbox(settings, fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-orimport-'));
  const keys = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_BROKER_URL', 'OPENROUTER_KEY'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_BROKER_URL; delete process.env.OPENROUTER_KEY;
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify(settings), 'utf8');
  try { return await fn(home); } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}
const authOf = (log) => log.map((l) => (l.init.headers || {}).authorization);
const QWEN = 'qwen/qwen3.8-27b:free';
const QWEN_ID = 'openrouter-qwen-qwen3-8-27b-free';

test('re-import: an OpenRouter entry stored without a base URL gains the address, and keeps the label you gave it', async () => {
  await withSandbox({ providers: { openai: { baseUrl: OR } } }, async () => {
    await addGlobalModel({ id: QWEN_ID, label: 'Mine', upstream: { provider: 'openai', api: 'openai-chat', model: QWEN } });
    const r = await importEndpointModels([QWEN], { baseUrl: OR, fetch: stub({ '/api/v1/models': OR_MODELS }) });
    assert.deepEqual([r.created.length, r.updated.length], [0, 1]);
    const e = listGlobalModels().find((m) => m.id === QWEN_ID);
    assert.equal(e.upstream.baseUrl, OR, 'a later edit of the OpenAI-compatible row cannot move it any more');
    assert.equal(e.label, 'Mine');
  });
});

test('listing OpenRouter: the OpenRouter row\'s key, never the local server\'s, and never stored on an entry', async () => {
  const listed = async (opts = {}) => {
    const log = [];
    await endpointModelsForImport({ baseUrl: OR, ...opts, fetch: stub({ '/api/v1/models': OR_MODELS }, log) });
    return authOf(log);
  };
  await withSandbox({ providers: { openai: { baseUrl: LOCAL, apiKey: 'sk-local' }, openrouter: { apiKey: 'sk-or' } } }, async () => {
    assert.deepEqual(await listed(), ['Bearer sk-or']);
    const log = [];
    const r = await importEndpointModels([QWEN], { baseUrl: OR, fetch: stub({ '/api/v1/models': OR_MODELS }, log) });
    assert.deepEqual(r.created, [QWEN_ID]);
    assert.deepEqual(authOf(log), ['Bearer sk-or'], 'the import lists through the same chain');
    const e = listGlobalModels().find((m) => m.id === QWEN_ID);
    assert.equal(e.upstream.baseUrl, OR);
    assert.equal(e.upstream.apiKey, undefined, 'the row\'s key stays on the row: the entry carries none of its own');
  });
  await withSandbox({ providers: { openai: { baseUrl: LOCAL, apiKey: 'sk-local' } } }, async () => {
    assert.deepEqual(await listed(), [undefined], 'no OpenRouter key: no Authorization, and never the local server\'s key');
    // The setup assistant's overlay: the OpenAI-compatible row it is about to point at OpenRouter supplies the key.
    assert.deepEqual(await listed({ providerBaseUrl: OR, providerApiKey: 'sk-planned' }), ['Bearer sk-planned']);
  });
});
