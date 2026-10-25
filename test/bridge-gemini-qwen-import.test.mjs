// test/bridge-gemini-qwen-import.test.mjs
// Gemini and Qwen models as OpenAI-compatible entries (docs/models.md › Gemini and Qwen models): the importer knows
// both hosts (Google's own list carries the windows; Qwen's carries ids only), an endpoint's own key rides the
// imported entries, and the OpenAI-compatible provider's key never goes to another host — an OpenRouter key on the
// Providers card is not sent to Google or Alibaba.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listEndpointModels, catalogEntryForEndpointModel } from '../src/core/bridge/providers/endpoint.mjs';
import { providerKeyFor, upstreamSettings, providerReadiness } from '../src/core/bridge/registry.mjs';
import { endpointModelsForImport } from '../src/core/bridge/provider-ops.mjs';
import { GEMINI_OPENAI_BASE_URL, QWEN_OPENAI_BASE_URL, QWEN_CN_OPENAI_BASE_URL, isQwenBaseUrl, isGeminiBaseUrl } from '../src/core/model-env.mjs';
import { checkRows } from './helpers/rows.mjs';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function stub(routes, log = []) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push({ url: u, headers: init.headers || {} });
    for (const [path, body] of Object.entries(routes)) if (u.includes(path)) return typeof body === 'function' ? body(init) : json(body);
    return new Response('not found', { status: 404 });
  };
}

// The shape of GET https://generativelanguage.googleapis.com/v1beta/models (trimmed; ids illustrative).
const GEMINI_NATIVE = { models: [
  { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', inputTokenLimit: 1048576, outputTokenLimit: 65536, thinking: true, supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding', inputTokenLimit: 2048, outputTokenLimit: 1, supportedGenerationMethods: ['embedContent'] },
  { name: 'models/imagen-4.0-generate-001', displayName: 'Imagen 4', inputTokenLimit: 480, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'] },
] };

test('hosts: Gemini and Qwen base URLs are recognised by host only', async () => {
  await checkRows([
    { name: 'isGeminiBaseUrl', run: async () => {
      assert.equal(isGeminiBaseUrl(GEMINI_OPENAI_BASE_URL), true);
      assert.equal(isGeminiBaseUrl('https://example.com/v1beta/openai'), false);
    } },
    { name: 'isQwenBaseUrl: international and mainland China; nothing else on aliyuncs.com', run: async () => {
      assert.equal(isQwenBaseUrl(QWEN_OPENAI_BASE_URL), true);
      assert.equal(isQwenBaseUrl(QWEN_CN_OPENAI_BASE_URL), true);
      assert.equal(isQwenBaseUrl('https://oss.aliyuncs.com/v1'), false);
      assert.equal(isQwenBaseUrl('https://dashscope.aliyuncs.com.evil.example/v1'), false);
    } },
  ]);
});

test('listEndpointModels → Gemini: Google\'s own list with the key in x-goog-api-key, windows read, non-chat models greyed', async () => {
  const log = [];
  const r = await listEndpointModels(GEMINI_OPENAI_BASE_URL, { apiKey: 'AIza-test', fetch: stub({ '/v1beta/models?': GEMINI_NATIVE }, log) });
  assert.equal(r.server, 'gemini');
  assert.deepEqual(log.map((l) => l.url), ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'], 'no local-server probes against a hosted API');
  assert.equal(log[0].headers['x-goog-api-key'], 'AIza-test');
  assert.equal(log[0].headers.authorization, undefined);
  const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
  assert.equal(by['gemini-embedding-001'], undefined, 'a model without generateContent is not listed');
  assert.equal(by['gemini-3-flash'].servedContext, 1048576);
  assert.equal(by['gemini-3-flash'].maxOutputTokens, 65536);
  assert.equal(by['gemini-3-flash'].reasoning, true);
  assert.equal(by['imagen-4.0-generate-001'].kind, 'other');
  assert.ok(r.warnings.some((w) => /bills every call/.test(w)));

  const entry = catalogEntryForEndpointModel(by['gemini-3-flash'], { server: r.server, baseUrl: r.baseUrl, providerBaseUrl: 'https://openrouter.ai/api/v1', apiKey: '${GEMINI_API_KEY}' });
  assert.equal(entry.id, 'google-gemini-3-flash');
  assert.equal(entry.upstream.model, 'gemini-3-flash');
  assert.equal(entry.upstream.baseUrl, GEMINI_OPENAI_BASE_URL);
  assert.equal(entry.upstream.apiKey, '${GEMINI_API_KEY}');
  assert.deepEqual(entry.upstream.capabilities, { reasoning: true, maxPromptTokens: 1048576, maxOutputTokens: 65536 });
  assert.equal(entry.cost, undefined, 'a hosted model is never claimed free');
});

test('listEndpointModels → Gemini: the OpenAI list is the fallback, its `models/` prefix stripped', async () => {
  const r = await listEndpointModels(GEMINI_OPENAI_BASE_URL, { apiKey: 'k', fetch: stub({ '/v1beta/openai/models': { data: [{ id: 'models/gemini-3-flash' }] } }) });
  assert.deepEqual(r.models.map((m) => m.id), ['gemini-3-flash']);
  assert.equal(r.models[0].servedContext, null);
});

test('listEndpointModels → Qwen: ids from the compatible-mode list, no probes, no window pinned', async () => {
  const log = [];
  const r = await listEndpointModels(QWEN_OPENAI_BASE_URL, { apiKey: 'sk-ds', fetch: stub({ '/compatible-mode/v1/models': { data: [{ id: 'qwen3-max', owned_by: 'system' }, { id: 'qwen-plus' }] } }, log) });
  assert.equal(r.server, 'qwen');
  assert.equal(log.length, 1);
  assert.equal(log[0].headers.authorization, 'Bearer sk-ds');
  assert.deepEqual(r.models.map((m) => m.id), ['qwen-plus', 'qwen3-max']);
  assert.ok(r.warnings.some((w) => /prompt limit by hand/.test(w)));
  const entry = catalogEntryForEndpointModel(r.models[1], { server: r.server, baseUrl: r.baseUrl, providerBaseUrl: 'https://api.openai.com/v1' });
  assert.equal(entry.id, 'dashscope-qwen3-max');
  assert.equal(entry.cost, undefined);
});

test('providerKeyFor: the provider\'s key only on its own origin', async () => {
  const cfg = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' };
  await checkRows([
    { name: 'no base URL of its own: the provider\'s key', run: async () => assert.equal(providerKeyFor({}, cfg), 'sk-or') },
    { name: 'the provider\'s origin (another path): the provider\'s key', run: async () => assert.equal(providerKeyFor({ baseUrl: 'https://OpenRouter.ai/api/v1/' }, cfg), 'sk-or') },
    { name: 'another host: none', run: async () => assert.equal(providerKeyFor({ baseUrl: GEMINI_OPENAI_BASE_URL }, cfg), '') },
    { name: 'another port: none', run: async () => assert.equal(providerKeyFor({ baseUrl: 'https://openrouter.ai:8443/api/v1' }, cfg), '') },
  ]);
});

// ── with settings: the bridge and the import ────────────────────────────────

let home;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, WORCA_HOME: process.env.WORCA_HOME, GEMINI_TEST_KEY: process.env.GEMINI_TEST_KEY };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-gemini-import-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_HOME;
  process.env.GEMINI_TEST_KEY = 'AIza-from-env';
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ providers: { openai: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-secret' } } }));
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(home, { recursive: true, force: true });
});

test('the bridge: an OpenRouter key on the provider card is never sent to Gemini; the entry\'s own key is', async () => {
  const gemini = { provider: 'openai', api: 'openai-chat', model: 'gemini-3-flash', baseUrl: GEMINI_OPENAI_BASE_URL };
  assert.equal(upstreamSettings(gemini).apiKey, '');
  const ready = providerReadiness(gemini);
  assert.equal(ready.ok, false);
  assert.match(ready.message, /no API key for https:\/\/generativelanguage\.googleapis\.com — the provider's key is for https:\/\/openrouter\.ai/);
  assert.equal(upstreamSettings({ ...gemini, apiKey: '${GEMINI_TEST_KEY}' }).apiKey, 'AIza-from-env');
  assert.equal(providerReadiness({ ...gemini, apiKey: '${GEMINI_TEST_KEY}' }).ok, true);
  const openrouter = { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3-max' };
  assert.equal(upstreamSettings(openrouter).apiKey, 'sk-or-secret', 'an entry on the provider\'s own host still gets its key');
});

test('endpointModelsForImport: the listing uses the endpoint\'s own key and the rows carry it; without one, no OpenRouter key goes to Google', async () => {
  const log = [];
  const f = stub({ '/v1beta/models?': GEMINI_NATIVE }, log);
  const r = await endpointModelsForImport({ baseUrl: GEMINI_OPENAI_BASE_URL, apiKey: '${GEMINI_TEST_KEY}', fetch: f });
  assert.equal(log[0].headers['x-goog-api-key'], 'AIza-from-env');
  assert.equal(r.models.find((m) => m.id === 'gemini-3-flash').catalogId, 'google-gemini-3-flash');

  log.length = 0;
  await endpointModelsForImport({ baseUrl: GEMINI_OPENAI_BASE_URL, fetch: f });
  assert.equal(log[0].headers['x-goog-api-key'], undefined, 'the OpenRouter key stays home');

  await assert.rejects(endpointModelsForImport({ baseUrl: GEMINI_OPENAI_BASE_URL, apiKey: '${NOT_SET_ANYWHERE_X}', fetch: f }), /NOT_SET_ANYWHERE_X\} is not set/);
});
