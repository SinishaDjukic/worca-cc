// test/bridge-endpoint.test.mjs
// Discovery for OpenAI-compatible endpoints (src/core/bridge/providers/endpoint.mjs): each server
// is recognised on its own surface and normalised to one row shape, the window ONE request gets is
// kept apart from the window the model supports, a model a pipeline cannot use is blocked, and a
// pick becomes a catalog entry. The fetch stubs mirror real answers — the llama.cpp and Ollama ones
// were taken from llama-server b10964 and Ollama on this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listEndpointModels, catalogEntryForEndpointModel, importableModel, endpointRoot, slugModelId, MIN_PIPELINE_WINDOW,
} from '../src/core/bridge/providers/endpoint.mjs';

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const notFound = () => new Response('not found', { status: 404 });

/** A fetch that answers only the routes it is given; everything else 404s, and every call is logged. */
function stub(routes, log = []) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push(u);
    for (const [path, body] of Object.entries(routes)) {
      if (u.endsWith(path)) return typeof body === 'function' ? body(init) : json(body);
    }
    return notFound();
  };
}

const LLAMA_PROPS = {
  default_generation_settings: { n_ctx: 4096, params: {} },
  total_slots: 2, model_alias: 'qwen3.6-35b', model_path: '/models/Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf',
  modalities: { vision: false, video: false, audio: false },
  chat_template_caps: { supports_tools: true, supports_tool_calls: true, supports_reasoning_effort: false },
  build_info: 'b10964',
};
const LLAMA_MODELS = { object: 'list', data: [{ id: 'qwen3.6-35b', object: 'model', owned_by: 'llamacpp', meta: { n_ctx: 4096, n_ctx_train: 262144, n_params: 35505251456, size: 12563137024, ftype: 'Q2_K - Medium' } }] };
const OLLAMA_TAGS = { models: [
  { name: 'qwen3-coder:30b', model: 'qwen3-coder:30b', size: 18556700761, capabilities: ['completion', 'tools'], details: { parameter_size: '30.5B', quantization_level: 'Q4_K_M', context_length: 262144, family: 'qwen3moe' } },
  { name: 'glm-4.7-flash:latest', model: 'glm-4.7-flash:latest', size: 19019270897, capabilities: ['completion', 'tools', 'thinking'], details: { parameter_size: '29.9B', quantization_level: 'Q4_K_M', context_length: 202752 } },
  { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest', size: 274302450, capabilities: ['embedding'], details: { parameter_size: '137M', quantization_level: 'F16', context_length: 2048 } },
] };

test('llama.cpp: /props identifies it, /v1/models gives the served window apart from the trained one', async () => {
  const log = [];
  const r = await listEndpointModels('http://127.0.0.1:8080/v1', { fetch: stub({ '/props': LLAMA_PROPS, '/v1/models': LLAMA_MODELS }, log) });
  assert.equal(r.server, 'llama.cpp');
  assert.equal(r.serverLabel, 'llama.cpp');
  assert.equal(r.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.ok(log[0].endsWith('/props'), '/props is probed at the ROOT, not under /v1');
  assert.equal(log[0], 'http://127.0.0.1:8080/props');
  assert.deepEqual(r.models, [{
    id: 'qwen3.6-35b', name: 'qwen3.6-35b', kind: 'llm', servedContext: 4096, trainedContext: 262144,
    toolCalls: true, vision: false, reasoning: false, loaded: true, detail: 'Q2_K - Medium · 36B · 2 slots',
  }]);
  assert.match(r.warnings.join('\n'), /serving 2 slots in parallel; the window shown is what ONE request gets/);
  assert.match(r.warnings.join('\n'), /One model serves less than 65536 tokens/);
});

test('llama.cpp: a build whose /v1/models carries no meta still yields the model from /props', async () => {
  const r = await listEndpointModels('http://x/v1', { fetch: stub({ '/props': LLAMA_PROPS, '/v1/models': { data: [] } }) });
  assert.equal(r.server, 'llama.cpp');
  assert.deepEqual(r.models.map((m) => [m.id, m.servedContext, m.toolCalls]), [['qwen3.6-35b', 4096, true]]);
});

test('Ollama: /api/tags carries capabilities and the TRAINED window; /api/ps the served one; embeddings are blocked', async () => {
  const r = await listEndpointModels('http://127.0.0.1:11434/v1', { fetch: stub({
    '/api/tags': OLLAMA_TAGS,
    '/api/ps': { models: [{ name: 'qwen3-coder:30b', context_length: 65536 }] },
  }) });
  assert.equal(r.server, 'ollama');
  const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
  assert.equal(by['qwen3-coder:30b'].servedContext, 65536, 'the loaded model\'s real window');
  assert.equal(by['qwen3-coder:30b'].trainedContext, 262144);
  assert.equal(by['qwen3-coder:30b'].loaded, true);
  assert.equal(by['qwen3-coder:30b'].detail, '30.5B · Q4_K_M · 18.6 GB');
  assert.equal(by['glm-4.7-flash:latest'].servedContext, null, 'not loaded: no served window to pin');
  assert.equal(by['glm-4.7-flash:latest'].reasoning, true, 'capability "thinking"');
  assert.equal(by['nomic-embed-text:latest'].kind, 'embedding');
  assert.deepEqual(importableModel(by['nomic-embed-text:latest']), { ok: false, why: 'an embedding model — not a chat model' });
  assert.deepEqual(importableModel(by['qwen3-coder:30b']), { ok: true });
  assert.match(r.warnings[0], /Ollama serves a 4096-token window by default/);
  assert.equal(r.models[r.models.length - 1].kind, 'embedding', 'chat models sort first');
});

test('LM Studio: types, loaded state and the two windows; vLLM and a bare list fall back', async () => {
  const lms = await listEndpointModels('http://127.0.0.1:1234/v1', { fetch: stub({ '/api/v0/models': { data: [
    { id: 'qwen3-coder-30b', type: 'llm', state: 'loaded', max_context_length: 262144, loaded_context_length: 32768, quantization: 'Q4_K_M', arch: 'qwen3moe' },
    { id: 'gemma-3-27b', type: 'vlm', state: 'not-loaded', max_context_length: 131072 },
    { id: 'nomic-embed', type: 'embeddings', state: 'not-loaded', max_context_length: 2048 },
  ] } }) });
  assert.equal(lms.server, 'lmstudio');
  assert.deepEqual(lms.models.map((m) => [m.id, m.servedContext, m.trainedContext, m.vision, m.loaded, m.kind]), [
    ['qwen3-coder-30b', 32768, 262144, false, true, 'llm'],
    ['gemma-3-27b', null, 131072, true, false, 'llm'],
    ['nomic-embed', null, 2048, false, false, 'embedding'],
  ]);
  assert.match(lms.warnings.join('\n'), /only while it is loaded/);
  assert.match(lms.warnings.join('\n'), /serves less than 65536/);

  const vllm = await listEndpointModels('http://gpu.lan:8000/v1', { fetch: stub({ '/v1/models': { data: [{ id: 'Qwen/Qwen3-32B', max_model_len: 131072 }] } }) });
  assert.equal(vllm.server, 'vllm');
  assert.deepEqual(vllm.models.map((m) => [m.id, m.servedContext, m.toolCalls]), [['Qwen/Qwen3-32B', 131072, null]]);
  assert.deepEqual(vllm.warnings, [], 'a 128k window needs no warning');

  const bare = await listEndpointModels('https://gw.example.com/v1', { fetch: stub({ '/v1/models': { data: [{ id: 'gpt-4o-mini', owned_by: 'acme' }] } }) });
  assert.equal(bare.server, 'openai-compatible');
  assert.equal(bare.models[0].toolCalls, null, 'unknown, not "no"');
  assert.match(bare.warnings[0], /does not report context windows/);
  assert.deepEqual(importableModel(bare.models[0]), { ok: true }, 'unknown tool support does not block');
});

test('a key is sent when the provider has one, and a dead endpoint is an error that names the URL', async () => {
  const seen = [];
  await listEndpointModels('https://gw.example.com/v1', { apiKey: 'sk-test', fetch: async (url, init) => { seen.push(init.headers.authorization); return url.endsWith('/v1/models') ? json({ data: [{ id: 'm' }] }) : notFound(); } });
  assert.ok(seen.every((a) => a === 'Bearer sk-test'), 'every probe carries the key');
  await assert.rejects(() => listEndpointModels('http://127.0.0.1:9/v1', { fetch: async () => { throw new Error('ECONNREFUSED'); } }),
    /no OpenAI-compatible model list at http:\/\/127\.0\.0\.1:9\/v1\/models/);
  await assert.rejects(() => listEndpointModels(''), /baseUrl is required/);
});

test('a model with no tool calls is blocked: a pipeline agent cannot run without them', () => {
  assert.deepEqual(importableModel({ kind: 'llm', toolCalls: false }), { ok: false, why: 'no tool calls — a pipeline agent cannot run without them' });
  assert.equal(importableModel({ kind: 'llm', toolCalls: true }).ok, true);
  assert.equal(importableModel(null).ok, false);
});

test('the catalog entry: served window only, own base URL only when it differs, free, one effort unless it reasons', () => {
  const m = { id: 'qwen3-coder:30b', name: 'qwen3-coder:30b', servedContext: 65536, trainedContext: 262144, toolCalls: true, vision: false, reasoning: false };
  const e = catalogEntryForEndpointModel(m, { server: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', providerBaseUrl: 'https://api.openai.com/v1' });
  assert.deepEqual(e, {
    id: 'ollama-qwen3-coder-30b', label: 'qwen3-coder:30b (Ollama)', efforts: ['medium'],
    upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen3-coder:30b', baseUrl: 'http://127.0.0.1:11434/v1', capabilities: { toolCalls: true, maxPromptTokens: 65536 } },
    cost: { free: true },
  });
  // The trained window is never pinned: the CLI would compact against a window the server never had.
  const unknown = catalogEntryForEndpointModel({ ...m, servedContext: null }, { server: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' });
  assert.equal(unknown.upstream.capabilities.maxPromptTokens, undefined);
  assert.equal(unknown.upstream.capabilities.toolCalls, true);
  // An entry on the provider's own base URL carries none of its own.
  const same = catalogEntryForEndpointModel(m, { server: 'openai-compatible', baseUrl: 'http://gw/v1/', providerBaseUrl: 'http://gw/v1' });
  assert.equal(same.upstream.baseUrl, undefined);
  assert.equal(same.id, 'local-qwen3-coder-30b');
  // A reasoning model keeps every effort; vision rides as a capability.
  const think = catalogEntryForEndpointModel({ ...m, reasoning: true, vision: true }, { server: 'llama.cpp', baseUrl: 'http://x/v1' });
  assert.equal(think.efforts, undefined);
  assert.deepEqual(think.upstream.capabilities, { toolCalls: true, vision: true, reasoning: true, maxPromptTokens: 65536 });
  assert.equal(think.id, 'llama-qwen3-coder-30b');
});

test('ids become catalog ids, and the root of a base URL drops only a trailing /v1', () => {
  assert.equal(slugModelId('qwen3-coder:30b'), 'qwen3-coder-30b');
  assert.equal(slugModelId('/models/Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf'), 'qwen3-6-35b-a3b-ud-q2-k-xl');
  assert.equal(slugModelId('Qwen/Qwen3-32B'), 'qwen3-32b');
  assert.equal(slugModelId(''), 'model');
  assert.equal(slugModelId('!!!'), 'model');
  assert.equal(slugModelId('x'.repeat(80)).length, 48);
  assert.equal(endpointRoot('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080');
  assert.equal(endpointRoot('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080');
  assert.equal(endpointRoot('http://gw.example.com/openai/v1'), 'http://gw.example.com/openai');
  assert.equal(endpointRoot('http://gw.example.com'), 'http://gw.example.com');
  assert.equal(MIN_PIPELINE_WINDOW, 65536);
});
