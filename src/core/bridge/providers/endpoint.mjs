// src/core/bridge/providers/endpoint.mjs
// Discovery for OpenAI-compatible endpoints (model-bridge-design.md §8.4, the Copilot import's
// shape for a server you run yourself): ask a base URL what it serves, and turn a pick into a
// catalog entry. Pure over an injected `fetch`; nothing here reads settings or writes anything.
//
// `GET /v1/models` is the only call every server answers, and it carries ids and nothing else —
// not the context window, not whether the model can call tools, both of which decide whether a
// Worca pipeline can use it at all. So each server is probed on its own endpoint first and the
// OpenAI list is the fallback:
//
//   llama.cpp   GET {root}/props        default_generation_settings.n_ctx is the window ONE request
//                                       gets (-c split across --parallel slots), chat_template_caps
//                                       says whether the template takes tools, modalities vision.
//               GET {base}/models       data[].meta.n_ctx / n_ctx_train / n_params.
//   Ollama      GET {root}/api/tags     details.context_length is what the model was TRAINED for;
//                                       capabilities carries tools / vision / thinking.
//               GET {root}/api/ps       a loaded model's real context_length, when one is loaded.
//   LM Studio   GET {root}/api/v0/models  type (llm | vlm | embeddings), state, max_context_length,
//                                       loaded_context_length.
//   vLLM / other  GET {base}/models     ids, plus max_model_len where the server sets it.
//
// The window a model is SERVED with and the one it was TRAINED for are different numbers, and only
// the served one may become a prompt limit: Ollama serves 4096 by default however large the model
// is, and llama.cpp divides -c across its slots. When the served value is unknown the entry is
// built WITHOUT a prompt limit and the caller's warning says so — a wrong window is worse than
// none, because the CLI would compact against a number the endpoint never had.

const SERVERS = Object.freeze({
  'llama.cpp': 'llama.cpp', ollama: 'Ollama', lmstudio: 'LM Studio', vllm: 'vLLM', 'openai-compatible': 'OpenAI-compatible',
});
/** The catalog-id prefix per server, so two endpoints' models never collide. */
const ID_PREFIX = Object.freeze({ 'llama.cpp': 'llama', ollama: 'ollama', lmstudio: 'lmstudio', vllm: 'vllm', 'openai-compatible': 'local' });
/** Below this a pipeline thrashes the CLI's auto-compact (docs/models.md Troubleshooting). */
export const MIN_PIPELINE_WINDOW = 65536;
const DEFAULT_TIMEOUT_MS = 10_000;

/** The server root of a base URL: the same URL without its trailing `/v1` (`/props` lives there). */
export function endpointRoot(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

const num = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const has = (list, name) => Array.isArray(list) && list.includes(name);
/** `qwen3-coder:30b`, `/models/Qwen3.6-35B.gguf` → a catalog-id stem. */
export function slugModelId(id) {
  const base = String(id || '').split(/[\\/]/).pop().replace(/\.gguf$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model';
}
const GB = (n) => (num(n) ? `${(n / 1e9).toFixed(1)} GB` : null);

/**
 * One JSON GET (or POST) that never throws: `null` on any failure, so a probe for a server that is
 * not there costs one request and no error handling at the call sites.
 */
async function json(f, url, { timeoutMs, headers = {}, body = null } = {}) {
  try {
    const r = await f(url, {
      ...(body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } } : { headers }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function llamaModels(list, props) {
  const caps = (props && props.chat_template_caps) || {};
  const modal = (props && props.modalities) || {};
  const rows = Array.isArray(list && list.data) ? list.data : [];
  const slots = num(props && props.total_slots);
  return rows.map((m) => {
    const meta = m.meta || {};
    return {
      id: String(m.id ?? props?.model_alias ?? ''),
      name: String(m.id ?? props?.model_alias ?? ''),
      kind: 'llm',
      servedContext: num(meta.n_ctx),
      trainedContext: num(meta.n_ctx_train),
      toolCalls: caps.supports_tools === true || caps.supports_tool_calls === true,
      vision: modal.vision === true,
      reasoning: caps.supports_reasoning_effort === true,
      loaded: true,
      detail: [meta.ftype, meta.n_params ? `${(meta.n_params / 1e9).toFixed(0)}B` : null, slots > 1 ? `${slots} slots` : null].filter(Boolean).join(' · ') || null,
    };
  }).filter((m) => m.id);
}

function ollamaModels(tags, ps) {
  const loaded = new Map((Array.isArray(ps && ps.models) ? ps.models : []).map((m) => [String(m.name ?? m.model), num(m.context_length)]));
  return (Array.isArray(tags && tags.models) ? tags.models : []).map((m) => {
    const id = String(m.name ?? m.model ?? '');
    const d = m.details || {};
    const caps = m.capabilities;
    return {
      id,
      name: id,
      kind: has(caps, 'embedding') ? 'embedding' : 'llm',
      servedContext: loaded.get(id) ?? null,
      trainedContext: num(d.context_length),
      toolCalls: has(caps, 'tools'),
      vision: has(caps, 'vision'),
      reasoning: has(caps, 'thinking'),
      loaded: loaded.has(id),
      detail: [d.parameter_size, d.quantization_level, GB(m.size)].filter(Boolean).join(' · ') || null,
    };
  }).filter((m) => m.id);
}

function lmStudioModels(list) {
  return (Array.isArray(list && list.data) ? list.data : []).map((m) => {
    const type = String(m.type || '');
    return {
      id: String(m.id ?? ''),
      name: String(m.id ?? ''),
      kind: type === 'embeddings' ? 'embedding' : 'llm',
      servedContext: num(m.loaded_context_length),
      trainedContext: num(m.max_context_length),
      // LM Studio does not report tool support; its LLMs generally take tools, and a model that
      // cannot is refused at the first call rather than silently mis-flagged here.
      toolCalls: type === 'llm' || type === 'vlm',
      vision: type === 'vlm',
      reasoning: false,
      loaded: m.state === 'loaded',
      detail: [m.quantization, m.arch, m.publisher].filter(Boolean).join(' · ') || null,
    };
  }).filter((m) => m.id);
}

function openAiModels(list) {
  return (Array.isArray(list && list.data) ? list.data : []).map((m) => ({
    id: String(m.id ?? ''),
    name: String(m.id ?? ''),
    kind: 'llm',
    // vLLM reports the served length here; nothing else on the generic surface does.
    servedContext: num(m.max_model_len),
    trainedContext: null,
    toolCalls: null,           // unknown, not "no"
    vision: null,
    reasoning: null,
    loaded: null,
    detail: typeof m.owned_by === 'string' && m.owned_by ? m.owned_by : null,
  })).filter((m) => m.id);
}

/** What the caller must know before pinning a prompt limit on what this server reports. */
function warningsFor(server, models, props) {
  const w = [];
  if (server === 'ollama') {
    w.push('Ollama serves a 4096-token window by default, whatever the model was trained for: start it with OLLAMA_CONTEXT_LENGTH=65536 (or set num_ctx on the model) and load the model, then re-import — otherwise set the prompt limit by hand to what it really serves.');
  }
  if (server === 'llama.cpp') {
    const slots = num(props && props.total_slots);
    if (slots > 1) w.push(`llama-server splits its -c window across ${slots} slots, so one request gets the window shown here, not the whole -c.`);
  }
  if (server === 'lmstudio' && models.some((m) => m.kind !== 'embedding' && !m.servedContext)) {
    w.push('LM Studio reports a model\'s real window only while it is loaded; for the others the number shown is what the model supports, and the prompt limit is left unset.');
  }
  if (server === 'openai-compatible' && models.every((m) => !m.servedContext)) {
    w.push('This endpoint does not report context windows — set each model\'s prompt limit by hand after importing.');
  }
  const small = models.filter((m) => m.kind !== 'embedding' && m.servedContext && m.servedContext < MIN_PIPELINE_WINDOW);
  if (small.length) w.push(`${small.length === 1 ? 'One model serves' : `${small.length} models serve`} less than ${MIN_PIPELINE_WINDOW} tokens — a pipeline thrashes the CLI's auto-compact below that.`);
  return w;
}

/**
 * Ask an OpenAI-compatible endpoint what it serves.
 * @param {string} baseUrl  the endpoint's OpenAI base URL (…/v1)
 * @param {{apiKey?:string, fetch?:typeof fetch, timeoutMs?:number}} [opts]
 * @returns {Promise<{server:string, serverLabel:string, baseUrl:string, models:Array<object>, warnings:string[]}>}
 * @throws {Error} when nothing answers at all (the caller shows it as the connection failure it is)
 */
export async function listEndpointModels(baseUrl, { apiKey = '', fetch: f = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl is required');
  const root = endpointRoot(base);
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const opt = { timeoutMs, headers };
  let server = 'openai-compatible';
  let models = [];
  let props = null;

  const props0 = await json(f, `${root}/props`, opt);
  if (props0 && (props0.default_generation_settings || props0.chat_template_caps)) {
    server = 'llama.cpp';
    props = props0;
    models = llamaModels(await json(f, `${base}/models`, opt), props0);
    if (!models.length) {
      const n = num(props0.default_generation_settings && props0.default_generation_settings.n_ctx);
      const id = String(props0.model_alias || props0.model_path || '').split(/[\\/]/).pop();
      if (id) models = [{ id, name: id, kind: 'llm', servedContext: n, trainedContext: null, toolCalls: props0.chat_template_caps?.supports_tools === true, vision: props0.modalities?.vision === true, reasoning: false, loaded: true, detail: null }];
    }
  }
  if (!models.length) {
    const tags = await json(f, `${root}/api/tags`, opt);
    if (tags && Array.isArray(tags.models)) {
      server = 'ollama';
      models = ollamaModels(tags, await json(f, `${root}/api/ps`, opt));
    }
  }
  if (!models.length) {
    const lms = await json(f, `${root}/api/v0/models`, opt);
    if (lms && Array.isArray(lms.data) && lms.data.some((m) => m && m.type)) {
      server = 'lmstudio';
      models = lmStudioModels(lms);
    }
  }
  if (!models.length) {
    const list = await json(f, `${base}/models`, opt);
    if (!list) throw new Error(`no OpenAI-compatible model list at ${base}/models — is the server running, and is the base URL right?`);
    models = openAiModels(list);
    if (models.some((m) => m.servedContext)) server = 'vllm';
  }
  models.sort((a, b) => (Number(b.kind !== 'embedding') - Number(a.kind !== 'embedding')) || (Number(b.loaded === true) - Number(a.loaded === true)) || a.id.localeCompare(b.id));
  return { server, serverLabel: SERVERS[server], baseUrl: base, models, warnings: warningsFor(server, models, props) };
}

/**
 * A discovered model as a catalog entry (§8.4's Copilot shape, for a server you run).
 * `baseUrl` rides the ENTRY when it differs from the provider's, so one catalog can hold an Ollama
 * and a llama.cpp model at once. A prompt limit is pinned only from a window the server really
 * serves; `maxOutputTokens` is never guessed — no local server reports one.
 * @param {object} m           a row from listEndpointModels
 * @param {{server:string, baseUrl:string, providerBaseUrl?:string}} ctx
 */
export function catalogEntryForEndpointModel(m, { server = 'openai-compatible', baseUrl, providerBaseUrl = '' } = {}) {
  const capabilities = {
    ...(m.toolCalls === true || m.toolCalls === false ? { toolCalls: m.toolCalls } : {}),
    ...(m.vision === true ? { vision: true } : {}),
    ...(m.reasoning === true ? { reasoning: true } : {}),
    ...(num(m.servedContext) ? { maxPromptTokens: num(m.servedContext) } : {}),
  };
  const own = String(baseUrl || '').replace(/\/+$/, '');
  const provider = String(providerBaseUrl || '').replace(/\/+$/, '');
  return {
    id: `${ID_PREFIX[server] || 'local'}-${slugModelId(m.id)}`,
    label: `${m.name || m.id} (${SERVERS[server] || 'local'})`,
    ...(m.reasoning === true ? {} : { efforts: ['medium'] }),
    upstream: {
      provider: 'openai', api: 'openai-chat', model: m.id,
      ...(own && own !== provider ? { baseUrl: own } : {}),
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
    },
    cost: { free: true },       // a model on your own machine bills nothing; never "cost not verified"
  };
}

/** Whether a discovered model can carry a pipeline at all (the sheet greys the rest). */
export function importableModel(m) {
  if (!m || m.kind === 'embedding') return { ok: false, why: 'an embedding model — not a chat model' };
  if (m.toolCalls === false) return { ok: false, why: 'no tool calls — a pipeline agent cannot run without them' };
  return { ok: true };
}

export { SERVERS as ENDPOINT_SERVERS };
