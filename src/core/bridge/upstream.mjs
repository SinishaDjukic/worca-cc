// src/core/bridge/upstream.mjs
// One Messages request in, one upstream call out (model-bridge-design.md §5).
// `handleMessages` is transport-agnostic: it takes the parsed body and a
// writer for the reply so router.mjs (real http) and the tests (in-memory)
// share every line of the forwarding, translation and error logic.

import { toChatRequest } from './translate/request.mjs';
import { ChatStreamTranslator, SseDataParser, serializeSse } from './translate/stream.mjs';
import { toMessagesResponse } from './translate/response.mjs';
import { mapUpstreamError, mapNetworkError, bridgeErrors, PAYLOAD_CEILING_BYTES } from './errors.mjs';
import { copilotToken, invalidateCopilotToken, copilotApiHost, copilotHeaders, bodyHasImage, requestInitiator } from './providers/copilot.mjs';
import { upstreamSettings, providerReadiness } from './registry.mjs';
import { KeyedSemaphore } from './semaphore.mjs';
import { recordBridgeCall, recordBridgeError } from './telemetry.mjs';

export const semaphore = new KeyedSemaphore();
const PING_INTERVAL_MS = 15_000;
const warned = new Set();

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
      const path = us.api === 'anthropic' ? '/v1/messages' : '/chat/completions';
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
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${us.apiKey}`, ...us.headers },
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
    const t = toChatRequest(body, { upstreamModel: us.model, capabilities: us.capabilities });
    if (t.error) {
      const e = bridgeErrors.unsupported(t.error.message);
      recordBridgeError({ tag, catalogId: entry.id, provider: us.provider, status: e.status, message: e.body.error.message });
      return reply.json(e.status, e.body);
    }
    for (const w of t.warnings) {
      warnOnce(`${entry.id}:${w}`, `[worca] bridge: model ${JSON.stringify(entry.id)}: ${w} has no chat/completions equivalent — dropped`, log);
    }
    outBody = t.body;
  }
  const payload = JSON.stringify(outBody);
  if (Buffer.byteLength(payload) > PAYLOAD_CEILING_BYTES) {
    const e = bridgeErrors.tooLarge();
    return reply.json(e.status, e.body);
  }

  // Concurrency cap (§7.4).
  if (semaphore.active(us.provider) >= us.maxConcurrent) {
    warnOnce(`queue:${us.provider}:${tag}`, `[worca] bridge: requests queued for ${us.provider} (cap ${us.maxConcurrent}) — raise it under Settings › Models › Providers if this is slow`, log);
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
      return reply.json(200, toMessagesResponse(j, { model: entry.id }));
    }

    reply.status(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const translator = new ChatStreamTranslator({ model: entry.id });
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
            const events = translator.push(obj);
            if (events.length) { reply.write(serializeSse(events)); bump(); }
          }
          if (parser.done) break;
        }
        for (const obj of parser.end()) reply.write(serializeSse(translator.push(obj)));
      }
      reply.write(serializeSse(translator.finish()));
    } finally {
      clearInterval(ping);
    }
    return reply.end();
  } finally {
    release();
  }
}
