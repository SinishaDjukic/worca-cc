// src/core/exec-env/relay-usage.mjs
// What a remote spawn's model calls really used, as worca sees it (security evaluation 2026-10-21, E4). Claude Code's
// stream-json in a sandbox is the sandbox's word: root there can write any `result` frame (cost, usage, success) to
// the CLI's stdout. Every model reply passes through worca's half of the relay, so the relay meters the upstream's
// own `usage` per route (one spawn), and the harness books that instead of the sandbox's figure.
import { estimateCost, liveCostRates } from '../config.mjs';
import { connectUsageReader } from '../../broker/cursor.mjs';
import { lastObjectAt, UNPRICED_RATES } from '../../broker/usage.mjs';
export { cursorTurnUsage } from '../../broker/cursor.mjs';   // test/exec-env-engine-route.test.mjs imports it from here

const MAX_JSON = 4 << 20;    // a non-streamed reply bigger than this is not parsed whole…
const EDGE = 64 << 10;       // …but its head (the model) and tail (the usage) are kept and read on their own, as the broker does
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
    big(model, tail) { const u = lastObjectAt(tail, 'usage'); if (u) this.json({ type: 'message', model, usage: u }); },
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
    big(model, tail) { const u = lastObjectAt(tail, 'usage'); if (u) take({ model, usage: u }); },
    end() {},
  };
}

/** OpenAI Chat Completions (copilot): the usage rides the last chunk (or the one JSON completion). */
function chatParser(commit) {
  let last = null;
  return {
    frame(ev) { if (ev?.usage && typeof ev.usage === 'object') last = { model: String(ev.model || ''), usage: openaiUsage(ev.usage) }; },
    json(m) { if (m?.object === 'chat.completion' && m.usage) commit(String(m.model || ''), openaiUsage(m.usage)); },
    big(model, tail) { const u = lastObjectAt(tail, 'usage'); if (u) commit(model, openaiUsage(u)); },
    end() { if (last) { commit(last.model, last.usage); last = null; } },
  };
}

/** The Gemini API's usageMetadata (Gemini CLI, and the google provider of Qwen Code, Goose and OpenCode) in the result
 *  `usage` shape: the prompt count includes its cached part; thinking is billed as output. */
export function geminiUsage(u) {
  const prompt = count(u?.promptTokenCount);
  const cached = Math.min(prompt, count(u?.cachedContentTokenCount));
  return { ...emptyUsage(), input_tokens: prompt - cached, cache_read_input_tokens: cached,
    output_tokens: count(u?.candidatesTokenCount) + count(u?.thoughtsTokenCount) };
}

/** Gemini generateContent / streamGenerateContent: each chunk may repeat the running usageMetadata, so the last one of a
 *  reply counts. Without ?alt=sse the stream is one JSON array of chunks. */
function geminiParser(commit) {
  let last = null;
  const see = (ev) => { if (ev?.usageMetadata && typeof ev.usageMetadata === 'object') last = { model: String(ev.modelVersion || ''), usage: geminiUsage(ev.usageMetadata) }; };
  const end = () => { if (last) { commit(last.model, last.usage); last = null; } };
  return { frame: see, json(m) { for (const ev of Array.isArray(m) ? m : [m]) see(ev); end(); },
    big(model, tail) { const u = lastObjectAt(tail, 'usageMetadata'); if (u) { see({ modelVersion: model, usageMetadata: u }); end(); } }, end };
}

/** One text reply's meter for `parser`: `push(chunk)` the upstream bytes as they arrive, `end()` once. An SSE stream
 *  (the CLIs' calls) or one JSON body; anything else (count_tokens, a reply it cannot parse) reports nothing. A JSON
 *  body over MAX_JSON is not parsed whole: its usage is read from its last EDGE characters (parser.big), its model from
 *  its first, so a reply made large on purpose is still metered. Never throws. */
function textMeter(parser) {
  const decoder = new TextDecoder();
  let mode = null; let buf = ''; let skipping = false; let done = false;
  let head = ''; let tail = ''; let over = false;
  const onLine = (line) => {
    if (!line.startsWith('data:')) return;
    try { parser.frame(JSON.parse(line.slice(5))); } catch { /* not a JSON frame ([DONE]) */ }
  };
  const take = (text, final) => {
    if (mode === null) {
      const t = text.trimStart();
      if (!t) return;
      mode = t[0] === '{' || t[0] === '[' ? 'json' : 'sse';
    }
    if (mode === 'json') {
      if (head.length < EDGE) head += text.slice(0, EDGE - head.length);
      tail = (tail + text).slice(-EDGE);
      if (!over) { buf += text; if (buf.length > MAX_JSON) { over = true; buf = ''; } }
      if (!final) return;
      if (!over) { try { parser.json(JSON.parse(buf)); } catch { /* not one message */ } return; }
      const m = /"(?:model|modelVersion)"\s*:\s*"((?:[^"\\]|\\.){1,200})"/.exec(head) || /"modelVersion"\s*:\s*"((?:[^"\\]|\\.){1,200})"/.exec(tail);
      parser.big?.(m ? m[1] : '', tail);
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
// The envelope reader and the AgentServerMessage usage parser live in src/broker/cursor.mjs (the broker meters the same
// stream): one copy.
const connectMeter = (commit) => connectUsageReader((u) => commit('', u), { maxMessage: MAX_JSON });

const NOT_METERED = Object.freeze({ push() {}, end() {} });
const CURSOR_TURN_PATH = '/agent.v1.AgentService/RunSSE';

/** The meter for one reply on `pathname`: by the call's API. Anthropic Messages when the path names no other API (a
 *  Claude route, an anthropic provider's; count_tokens reports nothing). Other Connect calls (Cursor's dashboard and model
 *  lists), Gemini's countTokens and model lists report nothing. */
function replyMeter(pathname, commit) {
  const p = String(pathname || '');
  if (p.endsWith('/responses')) return textMeter(responsesParser(commit));
  // Chat Completions, also behind an Azure deployment and a Databricks serving endpoint (goose).
  if (p.endsWith('/chat/completions') || /^\/serving-endpoints\/[^/]+\/invocations$/.test(p)) return textMeter(chatParser(commit));
  if (/:(streamGenerateContent|generateContent)$/.test(p)) return textMeter(geminiParser(commit));
  if (/:countTokens$|\/models$|^\/api\/2\.0\//.test(p)) return NOT_METERED;
  if (p === CURSOR_TURN_PATH) return connectMeter(commit);
  if (/^\/[a-z0-9]+\.v\d+\./i.test(p)) return NOT_METERED;
  return textMeter(anthropicParser(commit));
}

/**
 * The meter of one route: `reply(pathname, checked)` makes the per-reply meter the relay feeds (model-relay.mjs
 * route.meter), and `take()` hands over what finished since the last take: `{ messages, byModel: { <model>: usage } }`.
 * A message is counted when it ends (message_stop, or its reply ends): a reply still streaming at a take is in the next
 * one. `checked`: the model the relay held the call to ('' the step's own, which priceRelayUsage prices as the
 * dispatched model); its usage is booked under it, whatever name the reply gives (a dated alias, a version). null:
 * under the reply's own model.
 */
export function createRouteMeter() {
  let pending = { messages: 0, byModel: {} };
  const commit = (model, usage) => {
    pending.messages += 1;
    addInto(pending.byModel[model] ||= emptyUsage(), usage);
  };
  return {
    reply: (pathname = '', checked = null) => replyMeter(pathname, checked != null ? (_model, usage) => commit(checked, usage) : commit),
    take() { const out = pending; pending = { messages: 0, byModel: {} }; return out; },
  };
}

/** The token totals of a take, over every model, in the result `usage` shape. */
export function relayUsageTotal(relay) {
  const total = emptyUsage();
  for (const u of Object.values(relay?.byModel || {})) addInto(total, u);
  return total;
}

/** Whether a reply's `model` is the dispatched model `dispatched`: the same id, the id without the provider an engine's
 *  model id names (`google/gemini-2.5-flash` → `gemini-2.5-flash`), or one of those with a date or version suffix the
 *  vendor adds (`-20250929`, `-2025-09-29`, `-001`). Case-insensitive; Claude's `[1m]` context suffix aside. */
/** `id` and, when it names a provider (`google/gemini-2.5-flash`), the id without it. */
const withoutProvider = (id) => { const s = String(id || '').trim(); const i = s.indexOf('/'); return i > 0 ? [s, s.slice(i + 1)] : [s]; };

export function isDispatchedModel(model, dispatched) {
  const m = String(model || '').trim().toLowerCase().replace(/\[1m\]$/, '');
  const d = String(dispatched || '').trim().toLowerCase().replace(/\[1m\]$/, '');
  if (!m || !d) return false;
  return withoutProvider(d).some((id) => m === id
    || (m.startsWith(`${id}-`) && /^(\d{8}|\d{4}-\d{2}-\d{2}|\d{3})$/.test(m.slice(id.length + 1))));
}

/**
 * Price what the relay measured for a spawn of `dispatched` (the node's model id, or null for the CLI default):
 * `{ costUsd, unpriced: string[] }`. Each reply is priced by its own model: the dispatched model's (its cost override,
 * {free} or {perMtok}, as config.mjs resolveModelCost prices the CLI's figure, else its list price) only for a reply
 * of that model (isDispatchedModel) or booked under '' (a call the relay held to the step's own model, a turn that
 * names none: Cursor's); any other model by its own override or
 * list price only. A model with none is named in `unpriced` (cost unknown, which a cost cap stops at) and priced at
 * the broker's fallback, the highest list rate (audit 2.8): the sandbox picks the model a call names, so an unpriced
 * one never books $0 or the sandbox's own claim, and a free or cheap step model never prices a call made on another.
 */
export function priceRelayUsage(relay, dispatched = null) {
  const byModel = relay?.byModel || {};
  let costUsd = 0; const unpriced = [];
  for (const [model, usage] of Object.entries(byModel)) {
    const own = !model || isDispatchedModel(model, dispatched);
    // The step's own: its id's price (an override, or a list price), else the list price of the id the CLI sends.
    const rates = own
      ? ([...(dispatched ? withoutProvider(dispatched) : []), ...(model ? [model] : [])].map((id) => liveCostRates(id)).find(Boolean) || null)
      : liveCostRates(model);
    if (!rates) unpriced.push(model || '(unnamed)');
    costUsd += estimateCost(usage, rates || UNPRICED_RATES);
  }
  return { costUsd, unpriced };
}
