// src/core/bridge/upstream.mjs
// One Messages request in, one upstream call out (model-bridge-design.md §5).
// `handleMessages` is transport-agnostic: it takes the parsed body and a
// writer for the reply so router.mjs (real http) and the tests (in-memory)
// share every line of the forwarding, translation and error logic.

import { toChatRequest } from './translate/request.mjs';
import { ChatStreamTranslator, SseDataParser, serializeSse } from './translate/stream.mjs';
import { toMessagesResponse } from './translate/response.mjs';
import { toResponsesRequest } from './translate/responses-request.mjs';
import { ResponsesStreamTranslator, toMessagesResponseFromResponses } from './translate/responses-stream.mjs';
import { mapUpstreamError, mapNetworkError, bridgeErrors, anthropicError, isFailedResponseOverflow, PAYLOAD_CEILING_BYTES } from './errors.mjs';
import { copilotToken, invalidateCopilotToken, copilotApiHost, copilotHeaders, bodyHasImage, requestInitiator } from './providers/copilot.mjs';
import { upstreamSettings, providerReadiness } from './registry.mjs';
import { KeyedSemaphore } from './semaphore.mjs';
import { recordBridgeCall, recordBridgeError, recordBridgeCost } from './telemetry.mjs';
import { isOpenRouter, adaptOpenRouterChatBody, OPENROUTER_HEADERS } from './openrouter.mjs';
import { unsupportedSchemaKeyword, withToolSchemaKeywordsDropped, refusedToolName, withoutTools } from './translate/schema-keywords.mjs';

export const semaphore = new KeyedSemaphore();
const PING_INTERVAL_MS = 15_000;
const warned = new Set();

// What an upstream model's tool grammar refused (translate/schema-keywords.mjs):
// schema keywords to drop, and whole tools no drop can fix. Learned per provider
// + base URL + upstream model for the life of the process, so only the first
// request after a boot pays each refusal round trip.
const schemaDrops = new Map();   // key -> { keywords:Set<string>, tools:Set<string> }
const MAX_SCHEMA_RETRIES = 6;
export function _resetSchemaKeywordDrops() { schemaDrops.clear(); }
function applySchemaDrops(body, d) {
  return d ? withoutTools(withToolSchemaKeywordsDropped(body, d.keywords), d.tools) : body;
}

/** Once-per-process warning (dropped fields, queue notices). */
function warnOnce(key, line, log) {
  if (warned.has(key)) return;
  warned.add(key);
  (log || console.warn)(line);
}
export function _resetBridgeWarnings() { warned.clear(); }

/**
 * Resolve auth + URL + headers for an upstream call.
 * @returns {Promise<{url:string, headers:object, provider:string, retryAuth?:() => Promise<object>}>}
 */
async function prepareUpstream(us, body, { fetch: f, requestHeaders }) {
  if (us.provider === 'copilot') {
    const initiator = requestInitiator(body);
    const vision = bodyHasImage(body);
    const build = async (force) => {
      const { token, apiHost } = await copilotToken(us.githubToken, { fetch: f, force });
      const host = apiHost || copilotApiHost(us.accountType);
      const path = us.api === 'anthropic' ? '/v1/messages' : us.api === 'openai-responses' ? '/responses' : '/chat/completions';
      const headers = { ...copilotHeaders(token, { vision, initiator }), ...us.headers };
      if (us.api === 'anthropic') {
        headers['anthropic-version'] = requestHeaders['anthropic-version'] || '2023-06-01';
        if (requestHeaders['anthropic-beta']) headers['anthropic-beta'] = requestHeaders['anthropic-beta'];
      }
      return { url: `${host}${path}`, headers, initiator };
    };
    const first = await build(false);
    return { ...first, provider: 'copilot', retryAuth: () => { invalidateCopilotToken(us.githubToken); return build(true); } };
  }
  const initiator = requestInitiator(body);
  if (us.api === 'anthropic') {
    const base = (us.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    const headers = {
      'content-type': 'application/json',
      'x-api-key': us.apiKey,
      'anthropic-version': requestHeaders['anthropic-version'] || '2023-06-01',
      ...(requestHeaders['anthropic-beta'] ? { 'anthropic-beta': requestHeaders['anthropic-beta'] } : {}),
      ...us.headers,
    };
    return { url, headers, provider: us.provider, initiator };
  }
  const base = (us.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return {
    url: `${base}/${us.api === 'openai-responses' ? 'responses' : 'chat/completions'}`,
    headers: {
      'content-type': 'application/json',
      ...(us.apiKey ? { authorization: `Bearer ${us.apiKey}` } : {}),
      ...(isOpenRouter(base) ? OPENROUTER_HEADERS : {}),   // an entry's own headers still win
      ...us.headers,
    },
    provider: us.provider,
    initiator,
  };
}

/**
 * Serve one /v1/messages request.
 * @param {object} args
 * @param {object} args.entry   findBridgedEntry() result
 * @param {object} args.body    parsed Messages request
 * @param {Record<string,string>} args.requestHeaders  lower-cased incoming headers
 * @param {string} [args.tag]   telemetry tag (execution id)
 * @param {AbortSignal} [args.signal]  aborts when the CLI disconnects
 * @param {typeof fetch} [args.fetch]
 * @param {(line:string)=>void} [args.log]
 * @param {object} reply  { status(code, headers), write(chunk), end(), json(status, obj, headers?) }
 */
export async function handleMessages({ entry, body, requestHeaders = {}, tag = '', signal, fetch: f = globalThis.fetch, log }, reply) {
  const upstream = entry.upstream;
  const ready = providerReadiness(upstream);
  if (!ready.ok) {
    const e = ready.reason === 'terms' ? bridgeErrors.termsNotAcknowledged(upstream.provider) : bridgeErrors.notSignedIn(upstream.provider, ready.message.split('— ')[1] || ready.message);
    recordBridgeError({ tag, catalogId: entry.id, provider: upstream.provider, status: e.status, message: e.body.error.message });
    return reply.json(e.status, e.body);
  }
  const us = upstreamSettings(upstream);

  // Body → upstream body.
  let outBody;
  if (us.api === 'anthropic') {
    outBody = { ...body, model: us.model };
  } else {
    const responses = us.api === 'openai-responses';
    const t = (responses ? toResponsesRequest : toChatRequest)(body, { upstreamModel: us.model, capabilities: us.capabilities });
    if (t.error) {
      const e = bridgeErrors.unsupported(t.error.message);
      recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: e.status, message: e.body.error.message });
      return reply.json(e.status, e.body);
    }
    for (const w of t.warnings) {
      const line = w === 'max_tokens clamped'
        ? 'max_tokens clamped to the model\'s output limit'
        : `${w} has no ${responses ? 'Responses API' : 'chat/completions'} equivalent — dropped`;
      warnOnce(`${entry.id}:${w}`, `[worca] bridge: model ${JSON.stringify(entry.id)}: ${line}`, log);
    }
    outBody = !responses && isOpenRouter(us.baseUrl) ? adaptOpenRouterChatBody(t.body, us) : t.body;
  }
  const dropKey = `${us.provider}|${us.baseUrl || ''}|${us.model}`;
  if (us.api !== 'anthropic') outBody = applySchemaDrops(outBody, schemaDrops.get(dropKey));
  let payload = JSON.stringify(outBody);
  if (Buffer.byteLength(payload) > PAYLOAD_CEILING_BYTES) {
    const e = bridgeErrors.tooLarge();
    return reply.json(e.status, e.body);
  }

  // Concurrency cap (§7.4).
  if (semaphore.active(us.provider) >= us.maxConcurrent) {
    warnOnce(`queue:${us.provider}:${tag}`, `[worca] bridge: requests queued for ${us.provider} (cap ${us.maxConcurrent}) — raise it under Settings › Providers if this is slow`, log);
  }
  let release;
  try {
    release = await semaphore.acquire(us.provider, us.maxConcurrent, { signal });
  } catch {
    return reply.end();  // the CLI went away while waiting
  }

  try {
    let prep;
    try {
      prep = await prepareUpstream(us, body, { fetch: f, requestHeaders });
    } catch (err) {
      const status = err && err.code === 'AUTH' ? 401 : 502;
      const e = status === 401
        ? bridgeErrors.notSignedIn(us.provider, err.message)
        : mapNetworkError(err, { provider: us.provider });
      recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: e.status, message: e.body.error.message });
      return reply.json(e.status, e.body);
    }
    recordBridgeCall({ tag, catalogId: entry.id, provider: us.provider, api: us.api, initiator: prep.initiator });

    const doFetch = (p) => f(p.url, { method: 'POST', headers: p.headers, body: payload, signal });
    let res;
    try {
      res = await doFetch(prep);
      if (res.status === 401 && prep.retryAuth) {
        const again = await prep.retryAuth();
        res = await doFetch(again);
      }
      // A tool schema the upstream's grammar cannot take: drop the keyword it
      // names from every tool schema — or, when no keyword is named, leave that
      // one tool out — remember it for this model, and retry. Once per new
      // keyword / tool, so a refusal that survives the fix is answered, not looped.
      for (let i = 0; i < MAX_SCHEMA_RETRIES && res.status === 400 && us.api !== 'anthropic' && Array.isArray(outBody.tools) && outBody.tools.length; i++) {
        const text = await res.clone().text().catch(() => '');
        const msg = mapUpstreamError(400, text, { provider: us.provider }).body.error.message;
        const kw = unsupportedSchemaKeyword(msg);
        const tool = kw ? null : refusedToolName(msg);
        const d = schemaDrops.get(dropKey) || { keywords: new Set(), tools: new Set() };
        if (kw && !d.keywords.has(kw)) {
          d.keywords.add(kw);
          warnOnce(`schema-kw:${dropKey}:${kw}`, `[worca] bridge: ${us.provider} model ${JSON.stringify(us.model)} refuses the tool-schema keyword "${kw}" — dropping it from tool schemas`, log);
        } else if (tool && !d.tools.has(tool)) {
          d.tools.add(tool);
          warnOnce(`schema-tool:${dropKey}:${tool}`, `[worca] bridge: ${us.provider} model ${JSON.stringify(us.model)} cannot take the schema of tool "${tool}" — leaving it out of this model's requests`, log);
        } else break;
        schemaDrops.set(dropKey, d);
        outBody = applySchemaDrops(outBody, d);
        payload = JSON.stringify(outBody);
        res = await doFetch(prep);
      }
    } catch (err) {
      if (signal && signal.aborted) return reply.end();
      const e = mapNetworkError(err, { provider: us.provider });
      recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: e.status, message: e.body.error.message });
      return reply.json(e.status, e.body);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const e = mapUpstreamError(res.status, text, { provider: us.provider, retryAfter: res.headers.get('retry-after') });
      recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: res.status, message: e.body.error.message });
      if (log) log(`[worca] bridge: ${us.provider} answered ${res.status} for ${JSON.stringify(entry.id)}: ${e.body.error.message}`);
      return reply.json(e.status, e.body, e.headers);
    }

    const streaming = body.stream === true;
    if (us.api === 'anthropic') {
      // Byte passthrough: the SSE stream (or JSON body) is the CLI's own dialect.
      const ct = res.headers.get('content-type') || (streaming ? 'text/event-stream' : 'application/json');
      reply.status(200, { 'content-type': ct, 'cache-control': 'no-cache' });
      if (!res.body) return reply.end();
      for await (const chunk of res.body) reply.write(chunk);
      return reply.end();
    }

    if (!streaming) {
      const j = await res.json();
      if (us.api === 'openai-responses' && j && j.status === 'failed') {
        // A buffered Responses body reports its failure with HTTP 200: answer it as the error it is.
        const fe = j.error && typeof j.error === 'object' ? j.error : {};
        const e = isFailedResponseOverflow(fe.code, fe.message)
          ? bridgeErrors.tooLarge()
          : anthropicError(502, 'api_error', `${us.provider}: upstream error — ${fe.message || fe.code || 'the response failed'}`);
        recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: 200, message: e.body.error.message });
        return reply.json(e.status, e.body);
      }
      if (us.api === 'openai-chat') recordBridgeCost({ tag, costUsd: j && j.usage ? j.usage.cost : undefined });
      return reply.json(200, us.api === 'openai-responses'
        ? toMessagesResponseFromResponses(j, { model: entry.id, upstreamModel: us.model })
        : toMessagesResponse(j, { model: entry.id }));
    }

    reply.status(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const translator = us.api === 'openai-responses'
      ? new ResponsesStreamTranslator({ model: entry.id, upstreamModel: us.model })
      : new ChatStreamTranslator({ model: entry.id });
    // A Responses stream can fail mid-flight (response.failed / error): book it
    // like an upstream refusal, so the Test button can name the reason. The
    // chat stream's events pass through untouched.
    const booked = (events) => {
      if (us.api === 'openai-responses') {
        for (const e of events) {
          if (e.event === 'error') recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: 200, message: e.data.error.message });
        }
      }
      return events;
    };
    const parser = new SseDataParser();
    const decoder = new TextDecoder();
    let ping = setInterval(() => reply.write('event: ping\ndata: {"type":"ping"}\n\n'), PING_INTERVAL_MS);
    if (ping.unref) ping.unref();
    const bump = () => { clearInterval(ping); ping = setInterval(() => reply.write('event: ping\ndata: {"type":"ping"}\n\n'), PING_INTERVAL_MS); if (ping.unref) ping.unref(); };
    try {
      if (res.body) {
        for await (const chunk of res.body) {
          const text = decoder.decode(chunk, { stream: true });
          for (const obj of parser.feed(text)) {
            const events = booked(translator.push(obj));
            if (events.length) { reply.write(serializeSse(events)); bump(); }
          }
          if (parser.done) break;
        }
        for (const obj of parser.end()) reply.write(serializeSse(booked(translator.push(obj))));
      }
      reply.write(serializeSse(booked(translator.finish())));
      if (translator.costUsd != null) recordBridgeCost({ tag, costUsd: translator.costUsd });
    } finally {
      clearInterval(ping);
    }
    return reply.end();
  } finally {
    release();
  }
}
