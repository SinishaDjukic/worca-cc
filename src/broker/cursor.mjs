// src/broker/cursor.mjs
// Cursor's API key → access token exchange (POST /auth/exchange_user_api_key, as cursor-agent does with
// CURSOR_API_KEY) and its Connect call shapes, shared by the broker's `cursor` slot (service.mjs) and worca's model
// relay (core/exec-env/relay-route.mjs): one copy. Pure: no core/ imports.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const CURSOR_TOKEN_MARGIN_MS = 5 * 60_000;   // exchanged again this long before the access token expires
export const CURSOR_TOKEN_FALLBACK_MS = 30 * 60_000; // …or after this long when it names no expiry
const EXCHANGE_TIMEOUT_MS = 15_000;
// The Connect calls one headless cursor-agent turn makes over HTTP/1.1 (useHttp1ForAgent), exact: the broker's cursor
// slot and both relay routes admit these and nothing else, since each call is signed with the person's access token
// and only RunSSE is metered. Not /auth/* (the exchange is worca's or the broker's), not AgentService/Run (HTTP/2
// bidi, which neither the relay nor the broker can carry).
export const CURSOR_PATHS = Object.freeze([['POST', '/agent.v1.AgentService/RunSSE'], ['POST', '/aiserver.v1.AiService/GetUsableModels'],
  ['POST', '/aiserver.v1.BidiService/BidiAppend'], ['POST', '/aiserver.v1.DashboardService/GetMe']]);
// Not x-ghost-mode: privacy mode is the person's own Cursor setting, never the caller's to pick.
export const CURSOR_FORWARD = Object.freeze(['connect-protocol-version', 'connect-timeout-ms', 'connect-content-encoding', 'content-encoding',
  'x-cursor-client-type', 'x-cursor-client-version', 'x-request-id', 'traceparent']);
/** Connect error codes for the statuses worca and the broker refuse with. */
export const CONNECT_CODES = Object.freeze({ 403: 'permission_denied', 413: 'resource_exhausted', 429: 'resource_exhausted', 502: 'unavailable', 504: 'deadline_exceeded', 529: 'unavailable' });

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const addAll = (list, values) => { for (const v of values || []) if (!list.includes(v)) list.push(v); };
const cacheKey = (apiKey) => `cursor-token:${sha(apiKey)}`;

/** The `exp` of a JWT, in ms, or null. */
export function jwtExpiry(token) {
  try { const exp = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))?.exp; return Number.isFinite(exp) ? exp * 1000 : null; }
  catch { return null; }
}

/** Forget the cached access token for `apiKey` (a 401 from api2: the next call exchanges again). */
export function invalidateCursorToken(cache, apiKey) { cache.delete(cacheKey(apiKey)); }

/**
 * Cursor's API key exchanged for an access token, cached per key in `cache` until CURSOR_TOKEN_MARGIN_MS before its
 * `exp`. Both tokens it returns go into `secrets`. One exchange at a time per key. A refused exchange throws with
 * `.status` (the broker refuses that as a dead key, not as an unreachable upstream).
 * @param {{apiKey:string, origin:string, fetchImpl?:Function, now?:()=>number, cache:Map, secrets:string[], keyName?:string}} o
 */
export function cursorAccessToken({ apiKey, origin, fetchImpl = globalThis.fetch, now = Date.now, cache, secrets, keyName = 'CURSOR_API_KEY' }) {
  const key = cacheKey(apiKey);
  const hit = cache.get(key);
  if (hit?.token && hit.renewAt > now()) { addAll(secrets, hit.secrets); return Promise.resolve(hit.token); }
  if (hit?.pending) return hit.pending.then((t) => { addAll(secrets, cache.get(key)?.secrets); return t; });
  const pending = (async () => {
    const r = await fetchImpl(`${origin}/auth/exchange_user_api_key`, {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: '{}', redirect: 'manual', signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) });
    if (!r.ok) throw Object.assign(new Error(`Cursor answered ${r.status} to the API key exchange${r.status === 401 || r.status === 403 ? `: check ${keyName}` : ''}`), { status: r.status });
    const j = await r.json();
    if (typeof j?.accessToken !== 'string' || !j.accessToken) throw new Error('Cursor returned no access token for the API key');
    const exp = jwtExpiry(j.accessToken);
    const got = [j.accessToken, ...(typeof j.refreshToken === 'string' ? [j.refreshToken] : [])];
    cache.set(key, { token: j.accessToken, secrets: got, renewAt: exp ? exp - CURSOR_TOKEN_MARGIN_MS : now() + CURSOR_TOKEN_FALLBACK_MS });
    return j.accessToken;
  })();
  cache.set(key, { pending });
  const out = pending.then((t) => { addAll(secrets, cache.get(key)?.secrets); return t; });
  out.catch(() => { if (cache.get(key)?.pending === pending) cache.delete(key); });
  return out;
}

// The relay's token-count shape (core/exec-env/relay-usage.mjs keeps its own copy for its other parsers).
const FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const EPHEMERAL = ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'];
const count = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const emptyUsage = () => ({ ...Object.fromEntries(FIELDS.map((k) => [k, 0])), cache_creation: Object.fromEntries(EPHEMERAL.map((k) => [k, 0])) });

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

/** Feed Connect stream bytes; `onUsage(usage)` for each turn-ended AgentServerMessage. Returns {push(chunk), end()}.
 *  An envelope larger than `maxMessage` stops the reader (no usage message is that big). */
export function connectUsageReader(onUsage, { maxMessage = 4 << 20 } = {}) {
  let buf = Buffer.alloc(0); let done = false;
  return {
    push(chunk) {
      if (done) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      while (buf.length >= 5) {
        const flag = buf[0]; const len = buf.readUInt32BE(1);
        if (len > maxMessage) { done = true; buf = Buffer.alloc(0); return; }   // not metered: no usage message is this big
        if (buf.length < 5 + len) return;
        let msg = buf.subarray(5, 5 + len); buf = buf.subarray(5 + len);
        if (flag & 2) continue;                       // end of stream: the JSON trailer
        if (flag & 1) { try { msg = gunzipSync(msg, { maxOutputLength: maxMessage }); } catch { continue; } }
        const usage = cursorTurnUsage(msg);
        if (usage) onUsage(usage);                    // the reply names no model: the dispatched one prices it
      }
    },
    end() { done = true; buf = Buffer.alloc(0); },
  };
}
