// src/core/exec-env/relay-usage.mjs
// What a remote spawn's model calls really used, as worca sees it (security evaluation 2026-10-21, E4). Claude Code's
// stream-json in a sandbox is the sandbox's word: root there can write any `result` frame (cost, usage, success) to
// the CLI's stdout. Every model reply passes through worca's half of the relay, so the relay meters the upstream's
// own `usage` per route (one spawn), and the harness books that instead of the sandbox's figure.
import { gunzipSync } from 'node:zlib';
import { estimateCost, liveCostRates, modelCostConfig } from '../config.mjs';
import { UNPRICED_RATES } from '../../broker/usage.mjs';

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

/** Anthropic Messages: SSE frames (message_start, message_delta, message_stop) or one JSON message. */
function anthropicParser(commit) {
  let cur = null;
  const finish = () => { if (cur) { commit(cur.model, cur.usage); cur = null; } };
  return {
    frame(ev) {
      if (ev?.type === 'message_start') { finish(); cur = { model: String(ev.message?.model || ''), usage: overlay(emptyUsage(), ev.message?.usage) }; }
      else if (ev?.type === 'message_delta' && cur) overlay(cur.usage, ev.usage);
      else if (ev?.type === 'message_stop') finish();
    },
    json(m) { if (m?.type === 'message') commit(String(m.model || ''), overlay(emptyUsage(), m.usage)); },
    end: finish,
  };
}

/** An OpenAI usage object (Responses: input_tokens/output_tokens; Chat Completions: prompt_tokens/completion_tokens;
 *  cached reads under *_tokens_details.cached_tokens, which the input count includes) in the result `usage` shape. */
function openaiUsage(u) {
  const input = count(u?.input_tokens ?? u?.prompt_tokens);
  const cached = Math.min(input, count(u?.input_tokens_details?.cached_tokens ?? u?.prompt_tokens_details?.cached_tokens));
  return { ...emptyUsage(), input_tokens: input - cached, cache_read_input_tokens: cached, output_tokens: count(u?.output_tokens ?? u?.completion_tokens) };
}

/** OpenAI Responses (codex, copilot): the terminal response.completed / .incomplete / .failed frame carries the usage. */
function responsesParser(commit) {
  const take = (r) => { if (r?.usage && typeof r.usage === 'object') commit(String(r.model || ''), openaiUsage(r.usage)); };
  return {
    frame(ev) { if (/^response\.(completed|incomplete|failed)$/.test(String(ev?.type || ''))) take(ev.response); },
    json(m) { if (m?.object === 'response') take(m); },
    end() {},
  };
}

/** OpenAI Chat Completions (copilot): the usage rides the last chunk (or the one JSON completion). */
function chatParser(commit) {
  let last = null;
  return {
    frame(ev) { if (ev?.usage && typeof ev.usage === 'object') last = { model: String(ev.model || ''), usage: openaiUsage(ev.usage) }; },
    json(m) { if (m?.object === 'chat.completion' && m.usage) commit(String(m.model || ''), openaiUsage(m.usage)); },
    end() { if (last) { commit(last.model, last.usage); last = null; } },
  };
}

/** One text reply's meter for `parser`: `push(chunk)` the upstream bytes as they arrive, `end()` once. An SSE stream
 *  (the CLIs' calls) or one JSON body; anything else (count_tokens, a reply it cannot parse) reports nothing. Never throws. */
function textMeter(parser) {
  const decoder = new TextDecoder();
  let mode = null; let buf = ''; let skipping = false; let done = false;
  const onLine = (line) => {
    if (!line.startsWith('data:')) return;
    try { parser.frame(JSON.parse(line.slice(5))); } catch { /* not a JSON frame ([DONE]) */ }
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
      if (final) { try { parser.json(JSON.parse(buf)); } catch { /* not one message */ } }
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
    if (final) { if (!skipping) onLine(buf); buf = ''; parser.end(); }
  };
  return {
    push(chunk) { if (!done) { try { take(decoder.decode(chunk, { stream: true }), false); } catch { done = true; } } },
    end() { if (!done) { done = true; try { take(decoder.decode(), true); } catch { /* nothing more to meter */ } } },
  };
}

// ── Cursor (Connect over HTTP/1.1) ──
// A streamed reply is a run of envelopes: 1 flag byte (bit 0 compressed, bit 1 end of stream), a 4-byte big-endian
// length, then the message. agent.v1.AgentService/RunSSE sends AgentServerMessage protos; a turn's usage is
// interaction_update (field 1) → turn_ended (field 14) → input (1), output (2), cache read (3), cache write (4).

/** The fields of one protobuf message: [field number, wire type, value (a number, or a Buffer for LEN)]. Throws on a
 *  malformed message. */
function protoFields(buf) {
  const out = []; let i = 0;
  const varint = () => {
    let n = 0; let mul = 1;
    for (let k = 0; k < 10; k++) {
      if (i >= buf.length) throw new Error('truncated');
      const b = buf[i++]; n += (b & 0x7f) * mul; mul *= 128;
      if (!(b & 0x80)) return n;
    }
    throw new Error('varint too long');
  };
  while (i < buf.length) {
    const key = varint(); const no = Math.floor(key / 8); const wt = key & 7;
    if (wt === 0) out.push([no, wt, varint()]);
    else if (wt === 1) { i += 8; out.push([no, wt, null]); }
    else if (wt === 5) { i += 4; out.push([no, wt, null]); }
    else if (wt === 2) { const len = varint(); if (i + len > buf.length) throw new Error('truncated'); out.push([no, wt, buf.subarray(i, i + len)]); i += len; }
    else throw new Error('unsupported wire type');
    if (i > buf.length) throw new Error('truncated');
  }
  return out;
}
const protoMessage = (fields, no) => fields.find(([n, wt]) => n === no && wt === 2)?.[2] ?? null;
const protoNumber = (fields, no) => { const f = fields.find(([n, wt]) => n === no && wt === 0); return f ? count(f[2]) : 0; };

/** The usage of an AgentServerMessage that ends a turn, or null. */
export function cursorTurnUsage(msg) {
  try {
    const update = protoMessage(protoFields(msg), 1);
    const ended = update && protoMessage(protoFields(update), 14);
    if (!ended) return null;
    const f = protoFields(ended);
    return { ...emptyUsage(), input_tokens: protoNumber(f, 1), output_tokens: protoNumber(f, 2),
      cache_read_input_tokens: protoNumber(f, 3), cache_creation_input_tokens: protoNumber(f, 4) };
  } catch { return null; }
}

function connectMeter(commit) {
  let buf = Buffer.alloc(0); let done = false;
  return {
    push(chunk) {
      if (done) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      while (buf.length >= 5) {
        const flag = buf[0]; const len = buf.readUInt32BE(1);
        if (len > MAX_JSON) { done = true; buf = Buffer.alloc(0); return; }   // not metered: no usage message is this big
        if (buf.length < 5 + len) return;
        let msg = buf.subarray(5, 5 + len); buf = buf.subarray(5 + len);
        if (flag & 2) continue;                       // end of stream: the JSON trailer
        if (flag & 1) { try { msg = gunzipSync(msg, { maxOutputLength: MAX_JSON }); } catch { continue; } }
        const usage = cursorTurnUsage(msg);
        if (usage) commit('', usage);                 // the reply names no model: the dispatched one prices it
      }
    },
    end() { done = true; buf = Buffer.alloc(0); },
  };
}

const NOT_METERED = Object.freeze({ push() {}, end() {} });
const CURSOR_TURN_PATH = '/agent.v1.AgentService/RunSSE';

/** The meter for one reply on `pathname`: by the call's API. Anthropic Messages when the path names no other API (a
 *  Claude route; count_tokens reports nothing). Other Connect calls (Cursor's dashboard and model lists) report nothing. */
function replyMeter(pathname, commit) {
  const p = String(pathname || '');
  if (p.endsWith('/responses')) return textMeter(responsesParser(commit));
  if (p.endsWith('/chat/completions')) return textMeter(chatParser(commit));
  if (p === CURSOR_TURN_PATH) return connectMeter(commit);
  if (/^\/[a-z0-9]+\.v\d+\./i.test(p)) return NOT_METERED;
  return textMeter(anthropicParser(commit));
}

/**
 * The meter of one route: `reply(pathname)` makes the per-reply meter the relay feeds (model-relay.mjs route.meter), and
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
    reply: (pathname = '') => replyMeter(pathname, commit),
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
 * price (or its own override), else the dispatched model's rates. A model with none of those is named in `unpriced`
 * and priced at the broker's fallback, the highest list rate (audit 2.8): the sandbox picks the model a call names,
 * so an unpriced one must never book $0 or the sandbox's own claim.
 */
export function priceRelayUsage(relay, dispatched = null) {
  const byModel = relay?.byModel || {};
  const cfg = dispatched ? modelCostConfig(dispatched) : null;
  if (cfg?.free) return { costUsd: 0, unpriced: [] };
  if (cfg?.perMtok) return { costUsd: estimateCost(relayUsageTotal(relay), cfg.perMtok), unpriced: [] };
  let costUsd = 0; const unpriced = [];
  for (const [model, usage] of Object.entries(byModel)) {
    const rates = (model && liveCostRates(model)) || (dispatched && liveCostRates(dispatched)) || null;
    if (!rates) unpriced.push(model || '(unnamed)');
    costUsd += estimateCost(usage, rates || UNPRICED_RATES);
  }
  return { costUsd, unpriced };
}
