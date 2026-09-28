// src/broker/usage.mjs
// Usage of one proxied request (plans/credential-broker-design.html §6.1). A tap
// sees the response body as it streams past, WITHOUT buffering it, and pulls the
// token counts out of Anthropic SSE / JSON and OpenAI final chunks. When the
// upstream reports its own USD figure (OpenRouter's `usage.cost`) that figure wins;
// otherwise the usage is priced from the shared list-price table. Pure.
import { listPriceFor } from '../core/list-prices.mjs';

const MAX_LINE = 1 << 20;   // an SSE line longer than this is skipped, never buffered further
const MAX_JSON = 4 << 20;   // a non-streamed JSON body larger than this is not parsed for usage

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
  if (obj.model) u.model = obj.model;
  const us = obj.usage || (obj.response && obj.response.usage);
  if (!us || typeof us !== 'object') return;
  const input = us.prompt_tokens ?? us.input_tokens;
  const output = us.completion_tokens ?? us.output_tokens;
  if (Number.isFinite(input)) u.inputTokens = input;
  if (Number.isFinite(output)) u.outputTokens = output;
  const cached = us.prompt_tokens_details?.cached_tokens ?? us.input_tokens_details?.cached_tokens;
  if (Number.isFinite(cached)) u.cacheReadTokens = cached;
  if (Number.isFinite(us.cost)) u.reportedUsd = us.cost;
}

/**
 * A usage tap for one response.
 * @param {'anthropic'|'openai'} protocol
 * @param {string|null} contentType  the response's content-type
 * @returns {{write:(chunk:Buffer|string)=>void, end:()=>ReturnType<typeof emptyUsage>}}
 */
export function createUsageTap(protocol, contentType) {
  const u = emptyUsage();
  const apply = protocol === 'openai' ? applyOpenAI : applyAnthropic;
  const sse = /text\/event-stream/i.test(String(contentType || ''));
  let buf = '';
  let jsonParts = [];
  let jsonLen = 0;
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
        if (jsonLen <= MAX_JSON) { jsonParts.push(s); jsonLen += s.length; }
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
      }
      jsonParts = [];
      return u;
    },
  };
}

/** USD for a usage record: the upstream's own figure, else list price, else 0. */
export function priceUsage(u, rates = listPriceFor(u.model)) {
  if (Number.isFinite(u.reportedUsd)) return u.reportedUsd;
  if (!rates) return 0;
  return ((u.inputTokens || 0) * (rates.input || 0)
    + (u.outputTokens || 0) * (rates.output || 0)
    + (u.cacheReadTokens || 0) * (rates.cacheRead || 0)
    + (u.cacheWriteTokens || 0) * (rates.cacheWrite || 0)) / 1e6;
}
