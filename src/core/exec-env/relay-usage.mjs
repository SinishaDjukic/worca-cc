// src/core/exec-env/relay-usage.mjs
// What a remote spawn's model calls really used, as worca sees it (security evaluation 2026-10-21, E4). Claude Code's
// stream-json in a sandbox is the sandbox's word: root there can write any `result` frame (cost, usage, success) to
// the CLI's stdout. Every model reply passes through worca's half of the relay, so the relay meters the upstream's
// own `usage` per route (one spawn), and the harness books that instead of the sandbox's figure.
import { estimateCost, liveCostRates, modelCostConfig } from '../config.mjs';

const MAX_JSON = 4 << 20;    // a non-streamed reply bigger than this is not metered (the CLI streams)
const MAX_LINE = 1 << 20;    // an SSE line longer than this is skipped (usage frames are small)
const FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const EPHEMERAL = ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'];
const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const emptyUsage = () => ({ ...Object.fromEntries(FIELDS.map((k) => [k, 0])), cache_creation: Object.fromEntries(EPHEMERAL.map((k) => [k, 0])) });

/** Copy the known token counts of `src` over `dst` (a field `src` lacks keeps its value): message_delta repeats them. */
function overlay(dst, src) {
  if (!src || typeof src !== 'object') return dst;
  for (const k of FIELDS) if (Number.isFinite(src[k])) dst[k] = count(src[k]);
  if (src.cache_creation && typeof src.cache_creation === 'object') {
    dst.cache_creation ||= {};
    for (const k of EPHEMERAL) if (Number.isFinite(src.cache_creation[k])) dst.cache_creation[k] = count(src.cache_creation[k]);
  }
  return dst;
}

function addInto(total, usage) {
  for (const k of FIELDS) total[k] += count(usage[k]);
  for (const k of EPHEMERAL) total.cache_creation[k] += count(usage.cache_creation?.[k]);
}

/** One reply's meter: `push(chunk)` the upstream bytes as they arrive, `end()` once. Reports each finished message
 *  as `commit(model, usage)`. An SSE stream (the CLI's calls) or one JSON message; anything else (count_tokens, a
 *  reply it cannot parse) reports nothing. Never throws. */
function replyMeter(commit) {
  const decoder = new TextDecoder();
  let mode = null; let buf = ''; let skipping = false; let cur = null; let done = false;
  const finish = () => { if (cur) { commit(cur.model, cur.usage); cur = null; } };
  const onFrame = (ev) => {
    if (ev?.type === 'message_start') { finish(); cur = { model: String(ev.message?.model || ''), usage: overlay(emptyUsage(), ev.message?.usage) }; }
    else if (ev?.type === 'message_delta' && cur) overlay(cur.usage, ev.usage);
    else if (ev?.type === 'message_stop') finish();
  };
  const onLine = (line) => {
    if (!line.startsWith('data:')) return;
    try { onFrame(JSON.parse(line.slice(5))); } catch { /* not a JSON frame */ }
  };
  const take = (text, final) => {
    if (mode === null) {
      const t = text.trimStart();
      if (!t) return;
      mode = t[0] === '{' ? 'json' : 'sse';
    }
    if (mode === 'json') {
      buf += text;
      if (buf.length > MAX_JSON) { done = true; buf = ''; return; }
      if (final) {
        try { const m = JSON.parse(buf); if (m?.type === 'message') commit(String(m.model || ''), overlay(emptyUsage(), m.usage)); } catch { /* not one message */ }
      }
      return;
    }
    buf += text;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (skipping) { skipping = false; continue; }
      onLine(line);
    }
    if (buf.length > MAX_LINE) { buf = ''; skipping = true; }
    if (final) { if (!skipping) onLine(buf); buf = ''; finish(); }
  };
  return {
    push(chunk) { if (!done) { try { take(decoder.decode(chunk, { stream: true }), false); } catch { done = true; } } },
    end() { if (!done) { done = true; try { take(decoder.decode(), true); } catch { /* nothing more to meter */ } } },
  };
}

/**
 * The meter of one route: `reply()` makes the per-reply meter the relay feeds (model-relay.mjs route.meter), and
 * `take()` hands over what finished since the last take: `{ messages, byModel: { <model>: usage } }`. A message is
 * counted when it ends (message_stop, or its reply ends): a reply still streaming at a take is in the next one.
 */
export function createRouteMeter() {
  let pending = { messages: 0, byModel: {} };
  const commit = (model, usage) => {
    pending.messages += 1;
    addInto(pending.byModel[model] ||= emptyUsage(), usage);
  };
  return {
    reply: () => replyMeter(commit),
    take() { const out = pending; pending = { messages: 0, byModel: {} }; return out; },
  };
}

/** The token totals of a take, over every model, in the result `usage` shape. */
export function relayUsageTotal(relay) {
  const total = emptyUsage();
  for (const u of Object.values(relay?.byModel || {})) addInto(total, u);
  return total;
}

/**
 * Price what the relay measured for a spawn of `dispatched` (the node's model id, or null for the CLI default):
 * `{ costUsd, unpriced: string[] }`. The dispatched model's own cost override ({free}, {perMtok}) prices every call
 * of the spawn, as it prices the CLI's figure (config.mjs resolveModelCost); else each reply's model at its list
 * price (or its own override), else the dispatched model's rates. A model with none of those is `unpriced`, and
 * `costUsd` covers the rest only.
 */
export function priceRelayUsage(relay, dispatched = null) {
  const byModel = relay?.byModel || {};
  const cfg = dispatched ? modelCostConfig(dispatched) : null;
  if (cfg?.free) return { costUsd: 0, unpriced: [] };
  if (cfg?.perMtok) return { costUsd: estimateCost(relayUsageTotal(relay), cfg.perMtok), unpriced: [] };
  let costUsd = 0; const unpriced = [];
  for (const [model, usage] of Object.entries(byModel)) {
    const rates = (model && liveCostRates(model)) || (dispatched && liveCostRates(dispatched)) || null;
    if (rates) costUsd += estimateCost(usage, rates); else unpriced.push(model || '(unnamed)');
  }
  return { costUsd, unpriced };
}
