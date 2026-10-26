// src/broker/usage.mjs
// Usage of one proxied request (plans/credential-broker-design.html §6.1). A tap
// sees the response body as it streams past, WITHOUT buffering it, and pulls the
// token counts out of Anthropic SSE / JSON and OpenAI final chunks. When the
// upstream reports its own USD figure (OpenRouter's `usage.cost`) that figure wins;
// otherwise the usage is priced from the shared list-price tables, and a model they
// don't list (or a response that names none) at the fallback rate: the highest list
// rate unless the operator sets WORCA_BROKER_UNPRICED_USD_PER_MTOK. Never $0, or a
// model missing from the table would spend past every budget. Pure.
import { PREDEFINED_LIST_PRICES, CODEX_PRICES, codexCachedRate, listPriceFor } from '../core/list-prices.mjs';
import { connectUsageReader } from './cursor.mjs';

const MAX_LINE = 1 << 20;   // an SSE line longer than this is skipped, never buffered further
const MAX_JSON = 4 << 20;   // a non-streamed JSON body larger than this is not parsed whole for usage
const EDGE = 64 << 10;      // ...but its head (the model) and tail (the usage) are kept, and read on their own (V8)

/** The JSON object after the last `"<key>":` in `text`, or null. Strings are skipped, so braces in them don't count. */
function lastObjectAt(text, key) {
  const at = text.lastIndexOf(`"${key}"`);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  if (open < 0 || !/^"[^"]*"\s*:\s*$/.test(text.slice(at, open))) return null;
  let depth = 0; let inStr = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(text.slice(open, i + 1)); } catch { return null; } }
  }
  return null;
}

/** What an over-cap JSON answer says it cost: the model from its head, the last `usage` object from its tail. */
function bigJsonSummary(head, tail) {
  const m = /"model"\s*:\s*"((?:[^"\\]|\\.){1,200})"/.exec(head);
  return { model: m ? m[1] : null, usage: lastObjectAt(tail, 'usage') };
}

export function emptyUsage() {
  return { model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedUsd: null };
}

function applyAnthropic(u, obj) {
  if (!obj || typeof obj !== 'object') return;
  const msg = obj.type === 'message_start' ? obj.message : (obj.type === 'message' ? obj : null);
  if (msg) {
    if (msg.model) u.model = msg.model;
    const us = msg.usage || {};
    if (Number.isFinite(us.input_tokens)) u.inputTokens = us.input_tokens;
    if (Number.isFinite(us.output_tokens)) u.outputTokens = us.output_tokens;
    if (Number.isFinite(us.cache_read_input_tokens)) u.cacheReadTokens = us.cache_read_input_tokens;
    if (Number.isFinite(us.cache_creation_input_tokens)) u.cacheWriteTokens = us.cache_creation_input_tokens;
  }
  if (obj.type === 'message_delta' && obj.usage) {
    // Cumulative counts: the last delta wins.
    if (Number.isFinite(obj.usage.output_tokens)) u.outputTokens = obj.usage.output_tokens;
    if (Number.isFinite(obj.usage.input_tokens)) u.inputTokens = obj.usage.input_tokens;
    if (Number.isFinite(obj.usage.cache_read_input_tokens)) u.cacheReadTokens = obj.usage.cache_read_input_tokens;
    if (Number.isFinite(obj.usage.cache_creation_input_tokens)) u.cacheWriteTokens = obj.usage.cache_creation_input_tokens;
  }
}

function applyOpenAI(u, obj) {
  if (!obj || typeof obj !== 'object') return;
  // A streamed Responses reply names its model only on the response object (response.created, response.completed).
  if (obj.model) u.model = obj.model; else if (obj.response?.model) u.model = obj.response.model;
  const us = obj.usage || (obj.response && obj.response.usage);
  if (!us || typeof us !== 'object') return;
  const input = us.prompt_tokens ?? us.input_tokens;
  const output = us.completion_tokens ?? us.output_tokens;
  // The input count includes the cached reads: they are booked at their own rate, so they are taken out of it.
  const cached = us.prompt_tokens_details?.cached_tokens ?? us.input_tokens_details?.cached_tokens;
  if (Number.isFinite(input)) u.inputTokens = Number.isFinite(cached) ? Math.max(0, input - cached) : input;
  if (Number.isFinite(output)) u.outputTokens = output;
  if (Number.isFinite(cached)) u.cacheReadTokens = cached;
  if (Number.isFinite(us.cost)) u.reportedUsd = us.cost;
}

/**
 * A usage tap for one response.
 * @param {'anthropic'|'openai'|'connect'|'none'} protocol  'connect': Cursor's RunSSE envelopes (every turn's usage
 *   summed, no model named); 'none': a reply that reports no usage (Cursor's unary calls)
 * @param {string|null} contentType  the response's content-type
 * @returns {{write:(chunk:Buffer|string)=>void, end:()=>ReturnType<typeof emptyUsage>}}
 */
export function createUsageTap(protocol, contentType) {
  const u = emptyUsage();
  if (protocol === 'none') return { write() {}, end: () => u };
  if (protocol === 'connect') {
    const reader = connectUsageReader((t) => {
      u.inputTokens += t.input_tokens || 0; u.outputTokens += t.output_tokens || 0;
      u.cacheReadTokens += t.cache_read_input_tokens || 0; u.cacheWriteTokens += t.cache_creation_input_tokens || 0;
    }, { maxMessage: MAX_JSON });
    return { write: (chunk) => reader.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk), end: () => { reader.end(); return u; } };
  }
  const apply = protocol === 'openai' ? applyOpenAI : applyAnthropic;
  const sse = /text\/event-stream/i.test(String(contentType || ''));
  let buf = '';
  let jsonParts = [];
  let jsonLen = 0;
  let head = ''; let tail = '';
  let skipping = false;

  const onLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try { apply(u, JSON.parse(data)); } catch { /* not JSON: ignore */ }
  };

  return {
    write(chunk) {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!sse) {
        if (head.length < EDGE) head += s.slice(0, EDGE - head.length);
        tail = (tail + s).slice(-EDGE);
        jsonLen += s.length;
        if (jsonLen <= MAX_JSON) jsonParts.push(s);
        else jsonParts = [];
        return;
      }
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (skipping) { skipping = false; continue; }
        onLine(line);
      }
      if (buf.length > MAX_LINE) { buf = ''; skipping = true; }
    },
    end() {
      if (sse) { if (buf && !skipping) onLine(buf.replace(/\r$/, '')); }
      else if (jsonLen && jsonLen <= MAX_JSON) {
        try { apply(u, JSON.parse(jsonParts.join(''))); } catch { /* not JSON */ }
      } else if (jsonLen) {
        const { model, usage } = bigJsonSummary(head, tail);
        if (usage) apply(u, protocol === 'openai' ? { model, usage } : { type: 'message', model, usage });
      }
      jsonParts = [];
      return u;
    },
  };
}

/** The list-price row (USD per million tokens) for an Anthropic or OpenAI model id, or null. */
export function listRatesFor(modelId) {
  const anthropic = listPriceFor(modelId);
  if (anthropic) return anthropic;
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '') : '';
  const cx = Object.hasOwn(CODEX_PRICES, id) ? CODEX_PRICES[id] : null;
  return cx ? { input: cx[0], output: cx[1], cacheRead: codexCachedRate(cx), cacheWrite: cx[0] } : null;
}

const RATE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const ALL_LISTED = [...Object.values(PREDEFINED_LIST_PRICES), ...Object.keys(CODEX_PRICES).map(listRatesFor)];
/** The default fallback for a model with no list price: the highest list rate of each kind. */
export const UNPRICED_RATES = Object.freeze(Object.fromEntries(RATE_FIELDS.map((f) => [f, Math.max(...ALL_LISTED.map((r) => r[f] || 0))])));

/**
 * The operator's fallback (WORCA_BROKER_UNPRICED_USD_PER_MTOK): "input,output" in USD per
 * million tokens, cache reads at 0.1x and cache writes at 1.25x input; "0" books unpriced
 * models at $0. null when unset, NaN when malformed.
 */
export function unpricedRates(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const parts = t.split(',').map((x) => x.trim());
  const nums = parts.map(Number);
  if (parts.some((x) => x === '') || nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  if (nums.length === 1 && nums[0] === 0) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (nums.length !== 2) return NaN;
  const [input, output] = nums;
  return { input, output, cacheRead: +(input * 0.1).toFixed(6), cacheWrite: +(input * 1.25).toFixed(6) };
}

/** USD for a usage record: the upstream's own figure, else the list price, else the fallback rate. */
export function priceUsage(u, unpriced = UNPRICED_RATES) {
  if (Number.isFinite(u.reportedUsd)) return u.reportedUsd;
  const rates = listRatesFor(u.model) || unpriced;
  return ((u.inputTokens || 0) * (rates.input || 0)
    + (u.outputTokens || 0) * (rates.output || 0)
    + (u.cacheReadTokens || 0) * (rates.cacheRead || 0)
    + (u.cacheWriteTokens || 0) * (rates.cacheWrite || 0)) / 1e6;
}

/**
 * The request body to send upstream, changed so the response reports what it cost: a streamed
 * OpenAI chat completion carries usage only with `stream_options.include_usage`, and OpenRouter
 * returns its own cost only with `usage.include`. The agent writes the body, so the broker sets
 * both rather than trust it to. A Responses call with `background` is refused (E_BACKGROUND). Anything else, or a
 * body that is not a JSON object, passes as is.
 * @param {{id:string, protocol:string, upstream:string}} slot
 * @param {string} path  the upstream path
 * @param {Buffer} body
 * @returns {Buffer}
 */
export function requestWithUsage(slot, path, body) {
  if (slot.protocol !== 'openai' || !body.length) return body;
  const responses = /\/responses$/.test(path);
  if (!responses && !/\/chat\/completions$/.test(path)) return body;
  let req;
  try { req = JSON.parse(body.toString('utf8')); } catch { return body; }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return body;
  // A background response is answered later, to a poll this call never sees: its cost could not be booked.
  if (responses) {
    if (req.background != null && req.background !== false) throw Object.assign(new Error('background responses are not supported'), { code: 'E_BACKGROUND' });
    return body;
  }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  let changed = false;
  // Any stream value but false/absent may be read as a stream upstream (1, "true"): usage is asked for then too.
  if (req.stream != null && req.stream !== false && req.stream_options?.include_usage !== true) {
    req.stream_options = { ...obj(req.stream_options), include_usage: true };
    changed = true;
  }
  if ((slot.id === 'openrouter' || new URL(slot.upstream).hostname === 'openrouter.ai') && req.usage?.include !== true) {
    req.usage = { ...obj(req.usage), include: true };
    changed = true;
  }
  return changed ? Buffer.from(JSON.stringify(req)) : body;
}
