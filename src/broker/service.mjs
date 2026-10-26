// src/broker/service.mjs
// The broker's core (plans/credential-broker-design.html §6.4): credential
// resolution, the /p/<slot>/… proxy, key verification, and the /internal API the
// worca server calls. Both HTTP listeners (main.mjs) hand requests here; the key
// page (ui-server.mjs) uses the credential methods.
import { seal, open, suffixOf, keyId } from './vault.mjs';
import { isAllowedPath, pathIssue, validatePluginSlots, PLUGIN_SLOT_PREFIX } from './slots.mjs';
import { resolveToken, tokenFromHeaders, parseMintRequest, mintToken, safeEqual, normalizeBillTo } from './tokens.mjs';
import { createUsageTap, priceUsage, listRatesFor, requestWithUsage, UNPRICED_RATES } from './usage.mjs';
import { scrubText, createByteScrubber, createConnectScrubber, connectReplyProblem, isConnectStream, CONNECT_IDENTITY } from './scrub.mjs';
import { createLimits } from './limits.mjs';
import { createCopilotExchange, parseGithubSecret, refreshGithubToken, isCopilotHost } from './copilot.mjs';
import { cursorAccessToken, invalidateCursorToken, CONNECT_CODES } from './cursor.mjs';
import { copilotTokenProblem, COPILOT_PAT_HEADERS, COPILOT_CLI_API_VERSION } from './copilot-token.mjs';
import { fetchUpstream } from './upstream-request.mjs';

export const MAX_REQUEST_BYTES = 32 << 20;
// Every request body is held in memory until its upstream call ends, so the bodies of all
// calls in flight, across every token, share one budget sized for the container's
// `mem_limit: 256m` (docker/compose.broker.yml): two bodies at the size cap fit.
export const INFLIGHT_BODY_BYTES = 64 << 20;
// A 2xx answer to a GET (model lists, OpenRouter's key info) is read whole and scrubbed.
const MAX_SCRUBBED_BODY = 8 << 20;
const MAX_ERROR_BODY = 64 << 10;
const CRED_CACHE_MS = 30_000;
export const UPSTREAM_IDLE_MS = 10 * 60_000;
// A request body must keep arriving (idle) and be all there in time (total): see readBody.
export const BODY_IDLE_MS = 15_000;
export const BODY_TOTAL_MS = 120_000;
// A client that stops reading a streamed answer this long is treated as gone: the rest is read and booked (V7).
export const CLIENT_DRAIN_MS = 60_000;

const REQUEST_HEADER_ALLOW = new Set([
  'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent', 'openai-beta',
  'http-referer', 'x-title', 'x-openrouter-title', 'x-openrouter-categories',
]);
const REQUEST_HEADER_ALLOW_PREFIX = ['x-stainless-'];
const RESPONSE_HEADER_ALLOW = new Set(['content-type', 'request-id', 'x-request-id', 'retry-after']);
const RESPONSE_HEADER_ALLOW_PREFIX = ['anthropic-ratelimit-', 'x-ratelimit-'];

/** Headers copied from the agent's request to the upstream: an allowlist (plus the slot's own), never a denylist. */
export function upstreamRequestHeaders(incoming, extra = []) {
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    const key = k.toLowerCase();
    if (REQUEST_HEADER_ALLOW.has(key) || REQUEST_HEADER_ALLOW_PREFIX.some((p) => key.startsWith(p)) || (extra && extra.includes(key))) out[key] = v;
  }
  // The usage tap reads the body as it streams: ask for it uncompressed.
  out['accept-encoding'] = 'identity';
  return out;
}

/** Headers copied from the upstream's response back to the agent. */
export function agentResponseHeaders(incoming) {
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    const key = k.toLowerCase();
    if (RESPONSE_HEADER_ALLOW.has(key) || RESPONSE_HEADER_ALLOW_PREFIX.some((p) => key.startsWith(p))) out[key] = v;
  }
  return out;
}

/** The error body a client of `protocol` understands, with a `worca-broker:` message. */
export function brokerError(protocol, status, type, message) {
  const msg = `worca-broker: ${message}`;
  const body = protocol === 'openai'
    ? { error: { message: msg, type, code: type } }
    : protocol === 'connect'
      ? { code: CONNECT_CODES[status] || 'unknown', message: msg }
      : { type: 'error', error: { type, message: msg } };
  return { status, body };
}

/** The headers of `incoming` a slot lists in `names` (its responseHeaders), minus any whose value holds a secret. */
function pickHeaders(incoming, names, secrets = []) {
  if (!Array.isArray(names) || !names.length) return {};
  const values = secrets.map((x) => String(x || '')).filter((x) => x.length >= 8);
  const out = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (names.includes(k.toLowerCase()) && !values.some((x) => String(v).includes(x))) out[k.toLowerCase()] = v;
  }
  return out;
}

function sendJson(res, status, body, extra = {}) {
  if (res.headersSent) { res.destroy(); return; }
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store', ...extra });
  res.end(s);
}

/**
 * The request body, at most `limit` bytes (else E_TOO_LARGE). `take(n)`, when given, is asked
 * for each chunk's bytes, and a refusal ends the read with E_BUSY. A refused read leaves the
 * request paused, so the caller can still answer; answer with `connection: close` and drop it.
 */
/** The body of `req`, at most `limit` bytes. `take(n)` holds each chunk in the shared budget. A body that stalls
 *  for `idleMs` or is not all there after `totalMs` is refused (E_TIMEOUT): a declared length holds its share
 *  of the budget until then, and with no deadline a client that never sends it holds it for good (V6). */
function readBody(req, limit, take = null, { idleMs = 0, totalMs = 0 } = {}) {
  return new Promise((resolveP, rejectP) => {
    const parts = []; let n = 0; let stopped = false;
    let idle = null;
    const total = totalMs > 0 ? setTimeout(() => stop('E_TIMEOUT'), totalMs) : null;
    const clear = () => { clearTimeout(idle); clearTimeout(total); };
    const arm = () => { if (idleMs > 0) { clearTimeout(idle); idle = setTimeout(() => stop('E_TIMEOUT'), idleMs); } };
    const stop = (code) => { if (stopped) return; stopped = true; clear(); req.pause(); rejectP(Object.assign(new Error(code), { code })); };
    arm();
    req.on('data', (c) => {
      if (stopped) return;
      arm();
      n += c.length;
      if (n > limit) { stop('E_TOO_LARGE'); return; }
      if (take && !take(c.length)) { stop('E_BUSY'); return; }
      parts.push(c);
    });
    req.on('end', () => { if (stopped) return; stopped = true; clear(); resolveP(Buffer.concat(parts)); });
    req.on('error', (err) => { if (stopped) return; stopped = true; clear(); rejectP(err); });
    req.on('close', () => stop('E_CLOSED'));
  });
}

/** A human name for a slot in messages: "Anthropic API key". */
const slotName = (slot) => slot.label || slot.id;
const hostOf = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };

/** The beta header a Claude subscription (OAuth) token needs on every API call. */
export const OAUTH_BETA = 'oauth-2025-04-20';

/** 'subscription' (sk-ant-oat…, from `claude setup-token`), 'github', or 'api-key'. Pure. */
export function credentialKind(slot, secret) {
  if (slot && slot.auth === 'github-user') return 'github';
  if (slot && slot.protocol === 'anthropic' && /^sk-ant-oat\d*-/.test(String(secret || ''))) return 'subscription';
  return 'api-key';
}

/** Comma-joined betas without duplicates. Pure. */
export function mergeBetas(...lists) {
  const out = [];
  for (const l of lists) for (const b of String(l || '').split(',').map((s) => s.trim()).filter(Boolean)) if (!out.includes(b)) out.push(b);
  return out.join(',');
}

/** The slot auth styles whose derived token can expire early: a 401 gets one retry with a fresh one (send/onResponse). */
const RETRY_ON_401 = Object.freeze(['copilot', 'copilot-pat', 'cursor-exchange']);

/**
 * @param {{config:object, slots:object[], store:object, log?:(line:string)=>void, now?:()=>number,
 *          requestImpl?:(url:URL, opts:object)=>import('node:http').ClientRequest}} o
 *   requestImpl defaults to fetchUpstream: fetch, so HTTP(S)_PROXY applies on every Node (env-proxy.mjs).
 */
export function createBrokerService({ config, slots: baseSlots, store, log = () => {}, now = Date.now, requestImpl, fetchImpl = globalThis.fetch }) {
  // The built-in and operator slots, then the plugin slots worca registers
  // (PUT /internal/plugin-slots), which survive a broker restart in the store.
  let slots = baseSlots;
  let slotById = new Map();
  const useSlots = (pluginSlots) => {
    slots = Object.freeze([...baseSlots, ...pluginSlots]);
    slotById = new Map(slots.map((s) => [s.id, s]));
  };
  // One log line per model the price tables lack, so the operator sees what the fallback rate books.
  const unpricedSeen = new Set();
  const noteUnpriced = (model, slotId) => {
    const key = `${slotId}|${model || ''}`;
    if (unpricedSeen.has(key) || unpricedSeen.size > 1000) return;
    unpricedSeen.add(key);
    const r = config.unpricedRates || UNPRICED_RATES;
    log(`no list price for ${model ? `model ${model}` : 'a response that names no model'} on ${slotId}: booked at the fallback rate ($${r.input} in / $${r.output} out per million tokens; WORCA_BROKER_UNPRICED_USD_PER_MTOK)`);
  };
  let storedPluginSlots = [];
  try { storedPluginSlots = validatePluginSlots(store.getPluginSlots ? store.getPluginSlots() : [], baseSlots.map((s) => s.id)); }
  catch (err) { log(`stored plugin slots ignored: ${err.message}`); }
  useSlots(storedPluginSlots);
  const limits = createLimits({ store, config, now });
  const credCache = new Map();

  // The bytes of request bodies (and scrubbed responses) held by calls in flight.
  const bodyBudget = config.inflightBodyBytes || INFLIGHT_BODY_BYTES;
  let bodyBytes = 0;
  /** One call's share of the budget: take(n) holds n more bytes if they fit, release() frees them all. */
  function bodyHold() {
    let held = 0;
    return {
      take(n) { if (bodyBytes + n > bodyBudget) return false; bodyBytes += n; held += n; return true; },
      held: () => held,
      release() { bodyBytes -= held; held = 0; },
    };
  }
  const doRequest = requestImpl || fetchUpstream;
  const exchanges = new Map();
  /** The Copilot token exchange for a slot (one per slot: its fallback host and exchange URL). */
  const copilotFor = (slot) => {
    if (!exchanges.has(slot.id)) {
      exchanges.set(slot.id, createCopilotExchange({
        fetchImpl, now, defaultHost: new URL(slot.upstream).origin,
        ...(slot.exchangeUrl ? { exchangeUrl: slot.exchangeUrl } : {}),
      }));
    }
    return exchanges.get(slot.id);
  };

  const cursorCache = new Map();   // Cursor access tokens, per API key (src/broker/cursor.mjs)
  const patHosts = new Map();      // the Copilot API host GitHub names for each fine-grained PAT

  /** The Copilot API host for a fine-grained PAT, as the CLI finds it: `endpoints.api` of GET copilot_internal/user
   *  (lookupUrl, else api.github.com), a GitHub host only (isCopilotHost); else the slot's own upstream. Cached per PAT
   *  in `cache` (successes only). A 401/403 throws with `.status`. */
  async function copilotPatHost(slot, pat, cache = patHosts) {
    if (cache.has(pat)) return cache.get(pat);
    const r = await fetchImpl(`${(slot.lookupUrl || 'https://api.github.com').replace(/\/+$/, '')}/copilot_internal/user`, {
      headers: { authorization: `Bearer ${pat}`, accept: 'application/json', 'x-github-api-version': COPILOT_CLI_API_VERSION },
      redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (!r.ok) {
      const denied = r.status === 401 || r.status === 403;
      throw Object.assign(new Error(`GitHub answered ${r.status} to the Copilot account lookup${denied ? ': check that the token has the Copilot Requests permission' : ''}`), denied ? { status: r.status } : {});
    }
    let api = '';
    try { api = String((await r.json())?.endpoints?.api || '').replace(/\/+$/, ''); } catch { api = ''; }
    const origin = api && isCopilotHost(api) ? new URL(api).origin : new URL(slot.upstream).origin;
    cache.set(pat, origin);
    return origin;
  }

  /** Where a request for `slot` goes and the credential headers it carries. May throw (Copilot exchange, Cursor's key
   *  exchange, the PAT check and lookup: a refused one with `.status`). */
  async function upstreamAuth(slot, secret, { force = false, incoming = {} } = {}) {
    if (slot.auth === 'copilot') {
      const t = await copilotFor(slot).token(secret, { force });
      return { origin: t.host, headers: { authorization: `Bearer ${t.token}` }, secrets: [t.token] };
    }
    if (slot.auth === 'cursor-exchange') {
      const origin = new URL(slot.upstream).origin;
      if (force) invalidateCursorToken(cursorCache, secret);
      const secrets = [];
      const t = await cursorAccessToken({ apiKey: secret, origin, fetchImpl, now, cache: cursorCache, secrets, keyName: 'your Cursor API key' });
      return { origin, headers: { authorization: `Bearer ${t}` }, secrets };
    }
    if (slot.auth === 'copilot-pat') {
      // Checked at use too: a single-mode key (WORCA_BROKER_KEY_COPILOT_PAT) never passes saveCredential.
      const problem = copilotTokenProblem(secret, { name: 'This token', where: 'the broker signs Copilot calls' });
      if (problem) throw Object.assign(new Error(problem), { status: 403 });
      if (force) patHosts.delete(secret);
      const origin = await copilotPatHost(slot, secret);
      return { origin, headers: { authorization: `Bearer ${secret}`, ...COPILOT_PAT_HEADERS }, secrets: [secret] };
    }
    return { origin: new URL(slot.upstream).origin, headers: authHeaders(slot, secret, incoming), secrets: [] };
  }

  const whereToAdd = (slot) => (config.mode === 'multi' && config.publicUrl
    ? `add one at ${config.publicUrl}`
    : `set WORCA_BROKER_KEY_${slot.id.toUpperCase().replace(/-/g, '_')} on the broker`);

  /** Replace the plugin slots (validated, stored). Returns them; throws on a bad list. */
  function setPluginSlots(list) {
    const next = validatePluginSlots(list, baseSlots.map((s) => s.id));
    store.replacePluginSlots(next, now());
    useSlots(next);
    credCache.clear();
    log(`${new Date(now()).toISOString()} plugin slots: ${next.map((s) => s.id).join(', ') || '(none)'}`);
    return next;
  }

  // ── credentials ─────────────────────────────────────────────────────────────

  /** Why a saved key may not go to the slot's current upstream, or null. */
  function movedUpstream(slot, row) {
    if (!row || !row.upstream || slot.auth === 'copilot') return null;
    const origin = new URL(slot.upstream).origin;
    if (row.upstream === origin) return null;
    return `this key was saved for ${hostOf(row.upstream)}, and ${slotName(slot)} now points at ${hostOf(origin)}: enter it again`;
  }

  /** Why the operator's key may not go to a plugin slot's current upstream, or null. worca registers
   *  plugin slots over /internal (so can anyone holding the shared secret): the upstream is not the
   *  operator's word, and the key goes only to the origin WORCA_BROKER_KEY_<SLOT>_ORIGIN names. */
  function unapprovedOrigin(slot) {
    if (!slot.id.startsWith(PLUGIN_SLOT_PREFIX)) return null;
    const origin = new URL(slot.upstream).origin;
    const approved = config.singleKeyOrigins?.[slot.id];
    if (approved === origin) return null;
    const v = `WORCA_BROKER_KEY_${slot.id.toUpperCase().replace(/-/g, '_')}`;
    return `${approved ? `${v} is approved for ${hostOf(approved)}, and ${slotName(slot)} now points at ${hostOf(origin)}: ` : ''}set ${v}_ORIGIN=${origin} on the broker to send it there`;
  }

  /** {secret} (null secret for a keyless slot), or {missing:true}, or {error}. */
  function resolveCredential(billTo, slot) {
    if (slot.credential === 'none' || slot.auth === 'none') return { secret: null, row: null };
    const ck = `${billTo}|${slot.id}`;
    const hit = credCache.get(ck);
    if (hit && now() - hit.at < CRED_CACHE_MS) return hit.value;
    let value;
    if (config.mode === 'single' || (slot.credential === 'operator' && config.allowTeamKeys)) {
      const secret = config.singleKeys[slot.id];
      const why = secret ? unapprovedOrigin(slot) : null;
      value = !secret ? { missing: true } : why ? { error: why } : { secret, row: null };
    } else if (slot.credential === 'operator') {
      value = { missing: true };
    } else {
      const row = store.getCredential(billTo, slot.id);
      if (!row) value = { missing: true };
      else if (!config.vaultKey) value = { error: 'the broker has no vault key' };
      else if (movedUpstream(slot, row)) value = { error: movedUpstream(slot, row) };
      else {
        try { value = { secret: open(config.vaultKey, row, { billTo, slot: slot.id }), row }; }
        catch { value = { error: 'this key cannot be decrypted (the vault key changed); enter it again' }; }
      }
    }
    credCache.set(ck, { at: now(), value });
    return value;
  }

  function authHeaders(slot, secret, incoming = {}) {
    if (!secret || slot.auth === 'none') return {};
    // A Claude subscription token goes as a Bearer with the OAuth beta the API requires
    // for it (merged with the betas the CLI asked for), never as x-api-key.
    if (credentialKind(slot, secret) === 'subscription') {
      return { authorization: `Bearer ${secret}`, 'anthropic-beta': mergeBetas(incoming['anthropic-beta'], OAUTH_BETA) };
    }
    if (slot.auth === 'x-api-key') return { 'x-api-key': secret };
    if (slot.auth === 'github-user') return { authorization: `token ${parseGithubSecret(secret).token}` };
    return { authorization: `Bearer ${secret}` };
  }

  /** One request to a slot's verify path with `secret`. {ok} or {ok:false, error}. */
  function verifyCredential(slot, secret) {
    if (!slot.verify) return Promise.resolve({ ok: true });
    if (slot.auth === 'copilot') {
      return copilotFor(slot).token(secret, { force: true }).then(() => ({ ok: true }), (err) => ({ ok: false, status: err.status, error: scrubText(err.message, [secret]) }));
    }
    // A refused exchange or lookup (401/403) means the key is wrong: "rejected"; anything else says why it failed.
    const refused = (err) => ({ ok: false, status: err.status, error: scrubText(err.status === 401 || err.status === 403 ? `rejected (${err.message})` : err.message, [secret]) });
    if (slot.auth === 'cursor-exchange') {
      return cursorAccessToken({ apiKey: secret, origin: new URL(slot.upstream).origin, fetchImpl, now, cache: new Map(), secrets: [], keyName: 'your Cursor API key' })
        .then(() => ({ ok: true }), refused);
    }
    if (slot.auth === 'copilot-pat') {
      const problem = copilotTokenProblem(secret, { name: 'This token', where: 'the broker signs Copilot calls' });
      if (problem) return Promise.resolve({ ok: false, status: 422, error: problem });
      return copilotPatHost(slot, secret, new Map()).then(() => ({ ok: true }), refused);
    }
    // What to ask: the slot's verify request; a Claude subscription can't list models, so it
    // gets the smallest possible message (one output token of the smallest model); GitHub: /user.
    const sub = credentialKind(slot, secret) === 'subscription';
    const spec = sub
      ? { method: 'POST', path: '/v1/messages', body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }) }
      : slot.auth === 'github-user' ? { method: 'GET', path: '/user' } : slot.verify;
    return new Promise((resolveP) => {
      const url = new URL(spec.path, slot.upstream);
      const headers = { accept: 'application/json', 'accept-encoding': 'identity', ...authHeaders(slot, secret), ...(spec.body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(spec.body)) } : {}) };
      if (slot.protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
      if (slot.auth === 'github-user') headers['user-agent'] = 'worca-broker';
      let req;
      try { req = doRequest(url, { method: spec.method || 'GET', headers, timeout: 15_000 }); }
      catch (err) { resolveP({ ok: false, error: `cannot reach ${url.host}: ${err.message}` }); return; }
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', (err) => resolveP({ ok: false, error: `cannot reach ${url.host}: ${err.message}` }));
      req.on('response', (r) => {
        const parts = []; let n = 0;
        r.on('data', (c) => { if (n < MAX_ERROR_BODY) { parts.push(c); n += c.length; } });
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) { resolveP({ ok: true }); return; }
          // A plugin's gateway may have no model list: only a refusal says the key is wrong.
          if (!sub && spec.lenient && (r.statusCode === 404 || r.statusCode === 405)) { resolveP({ ok: true }); return; }
          let detail = Buffer.concat(parts).toString('utf8');
          try { const j = JSON.parse(detail); detail = j?.error?.message || j?.message || detail; } catch { /* text */ }
          resolveP({ ok: false, status: r.statusCode, error: scrubText(`${r.statusCode}: ${String(detail).slice(0, 300)}`, [secret, parseGithubSecret(secret).token]) });
        });
        r.on('error', (err) => resolveP({ ok: false, error: err.message }));
      });
      req.end(spec.body);
    });
  }

  /** Verify, then seal and store a person's credential. */
  async function saveCredential(billTo, slotId, secret) {
    const slot = slotById.get(slotId);
    if (!slot || slot.credential !== 'per-person') return { ok: false, status: 404, error: 'unknown slot' };
    if (!config.vaultKey) return { ok: false, status: 500, error: 'the broker has no vault key' };
    const s = String(secret || '').trim();
    if (s.length < 8 || s.length > 4096 || /\s/.test(s)) return { ok: false, status: 422, error: 'that does not look like a key: paste the whole value, without spaces' };
    // Only a fine-grained PAT is ever stored for the copilot-pat slot: said before anything is sent anywhere.
    if (slot.auth === 'copilot-pat') {
      const problem = copilotTokenProblem(s, { name: 'This token', where: 'the broker signs Copilot calls' });
      if (problem) return { ok: false, status: 422, error: problem };
    }
    const v = await verifyCredential(slot, s);
    if (!v.ok) return { ok: false, status: 422, error: `${slotName(slot)} was not accepted: ${v.error}` };
    const kind = credentialKind(slot, s);
    const suffix = suffixOf(slot.auth === 'github-user' ? parseGithubSecret(s).token : s);
    store.putCredential({ billTo, slot: slotId, sealed: seal(config.vaultKey, s, { billTo, slot: slotId }), suffix, kind, upstream: new URL(slot.upstream).origin, verifiedAt: now(), now: now() });
    credCache.delete(`${billTo}|${slotId}`);
    log(`${new Date(now()).toISOString()} credential saved: ${billTo} ${slotId} (${kind})`);
    return { ok: true, suffix, kind };
  }

  async function testCredential(billTo, slotId) {
    const slot = slotById.get(slotId);
    if (!slot) return { ok: false, status: 404, error: 'unknown slot' };
    const c = resolveCredential(billTo, slot);
    if (c.missing) return { ok: false, status: 404, error: 'no key saved' };
    if (c.error) return { ok: false, status: 409, error: c.error };
    const v = await verifyCredential(slot, c.secret);
    if (c.row) store.setVerify(billTo, slotId, { ok: v.ok, error: v.error, now: now() });
    return v.ok ? { ok: true } : { ok: false, status: 422, error: v.error };
  }

  function deleteCredential(billTo, slotId) {
    credCache.delete(`${billTo}|${slotId}`);
    const n = store.deleteCredential(billTo, slotId);
    if (n) log(`${new Date(now()).toISOString()} credential deleted: ${billTo} ${slotId}`);
    return n > 0;
  }

  /** Status of every slot for one person. Never includes a secret. */
  function slotStatus(billTo) {
    const rows = config.mode === 'multi' ? new Map(store.listCredentials(billTo).map((r) => [r.slot, r])) : new Map();
    return slots.map((slot) => {
      const base = {
        id: slot.id, label: slot.label, protocol: slot.protocol, credential: slot.credential, keyHint: slot.keyHint || '',
        ...(slot.signIn ? { signIn: slot.signIn } : {}),
        ...(slot.plugin ? { plugin: slot.plugin, host: hostOf(slot.upstream) } : {}),
      };
      if (slot.credential === 'none' || slot.auth === 'none') return { ...base, state: 'keyless' };
      if (config.mode === 'single') {
        const k = config.singleKeys[slot.id];
        const why = k ? unapprovedOrigin(slot) : null;
        if (why) return { ...base, state: 'invalid', verifyError: why };
        return { ...base, state: k ? 'set' : 'missing', ...(k ? { kind: credentialKind(slot, k) } : {}) };
      }
      if (slot.credential === 'operator') return { ...base, state: config.allowTeamKeys && config.singleKeys[slot.id] ? 'operator' : 'missing' };
      const r = rows.get(slot.id);
      if (!r) return { ...base, state: 'missing' };
      const stale = config.vaultKey && r.key_id !== keyId(config.vaultKey);
      const moved = movedUpstream(slot, r);
      return {
        ...base,
        state: stale || moved ? 'invalid' : (r.verify_error ? 'invalid' : 'set'),
        suffix: r.suffix, kind: r.kind || null, createdAt: r.created_at, updatedAt: r.updated_at, lastUsedAt: r.last_used_at,
        verifiedAt: r.verified_at, verifyError: stale ? 'the vault key changed: enter this key again' : (moved || r.verify_error),
        dailyUsd: r.daily_usd, monthlyUsd: r.monthly_usd,
      };
    });
  }

  /** Re-encrypt rows sealed with WORCA_BROKER_VAULT_KEY_OLD. Returns counts. */
  function rotateVault() {
    if (!config.vaultKey) return { rotated: 0, unreadable: 0 };
    const cur = keyId(config.vaultKey);
    let rotated = 0; let unreadable = 0;
    for (const r of store.allCredentials()) {
      if (r.key_id === cur) continue;
      if (config.vaultKeyOld && r.key_id === keyId(config.vaultKeyOld)) {
        try {
          const secret = open(config.vaultKeyOld, r, { billTo: r.bill_to, slot: r.slot });
          store.resealCredential(r.bill_to, r.slot, seal(config.vaultKey, secret, { billTo: r.bill_to, slot: r.slot }));
          rotated++;
          continue;
        } catch { /* fall through */ }
      }
      unreadable++;
    }
    return { rotated, unreadable };
  }

  // ── proxy ───────────────────────────────────────────────────────────────────

  async function handleProxy(req, res) {
    const started = now();
    const raw = String(req.url || '');
    if (!raw.startsWith('/p/')) { sendJson(res, 404, { error: 'not found' }); return; }
    const q = raw.indexOf('?');
    const rawPath = q >= 0 ? raw.slice(0, q) : raw;
    const query = q >= 0 ? raw.slice(q) : '';
    const m = /^\/p\/([a-z][a-z0-9-]{1,31})(\/.*)?$/.exec(rawPath);
    const slot = m ? slotById.get(m[1]) : null;
    if (!slot) { const e = brokerError('anthropic', 404, 'not_found_error', 'unknown credential slot'); sendJson(res, e.status, e.body); return; }
    const rest = m[2] || '/';
    const fail = (status, type, message, extra) => { const e = brokerError(slot.protocol, status, type, message); sendJson(res, e.status, e.body, extra); };
    // Every credential refusal is a 403, never a 401: the Claude Code CLI retries a 401 up
    // to ten times with growing backoff (minutes of a hung spawn for a key that isn't
    // there), and stops at once on a 403, printing our message. The body still says
    // authentication_error, and recoverable-error.mjs reads `worca-broker:` as `auth`.
    const refuseAuth = (message) => fail(403, 'authentication_error', message);

    // The CLI's connectivity probe: answered here, never forwarded, no token needed.
    if (req.method === 'HEAD' && rest === '/api/hello') { res.writeHead(200, { 'content-length': '0' }); res.end(); return; }
    if (pathIssue(rest) || !isAllowedPath(slot, req.method, rest)) {
      fail(403, 'permission_error', `${req.method} ${rest} is not allowed for slot ${slot.id}`);
      return;
    }
    const t = resolveToken(store, tokenFromHeaders(req.headers), now());
    if (t.error) {
      refuseAuth(t.error === 'missing' ? 'no token: this port only serves worca agents' : 'token expired or revoked');
      return;
    }
    const tok = t.row;
    if (!tok.slots.includes(slot.id)) { fail(403, 'permission_error', `this token may not use slot ${slot.id}`); return; }

    const cred = resolveCredential(tok.bill_to, slot);
    if (cred.missing) { refuseAuth(`no ${slotName(slot)} for ${tok.bill_to}. ${capital(whereToAdd(slot))}`); return; }
    if (cred.error) { refuseAuth(`${slotName(slot)} for ${tok.bill_to}: ${cred.error}`); return; }
    // A Claude subscription belongs to one person. On a shared instance it is only used by a
    // spawn under that person's own agent user; any other spawn could hand it to someone
    // else, which for a subscription is account sharing, not just a wrong bill.
    const subscription = credentialKind(slot, cred.secret) === 'subscription';
    if (subscription && config.mode === 'multi' && !tok.isolated) {
      refuseAuth(`${tok.bill_to}'s Claude subscription is only used by agents that run under their own user, and this spawn doesn't. ` +
        'Use an API key on the key page, or ask the operator to run agents under their own users (docs/credential-broker.md)');
      return;
    }

    // A body refused before or while it arrives: answer, then drop the connection, so the
    // rest of the body is never read.
    const refuseBody = (code) => {
      res.on('finish', () => req.destroy());
      if (code === 'E_TOO_LARGE') fail(413, 'request_too_large', 'request body is too large', { connection: 'close' });
      else if (code === 'E_TIMEOUT') fail(408, 'invalid_request_error', 'the request body did not arrive in time', { connection: 'close' });
      else if (code === 'E_BACKGROUND') fail(400, 'invalid_request_error', 'background responses are not supported through the broker: their cost cannot be booked', { connection: 'close' });
      else fail(503, 'overloaded_error', 'the broker is busy with other large requests, retry in a few seconds', { connection: 'close', 'retry-after': '2' });
    };
    const declared = req.headers['content-length'] === undefined ? NaN : Number(req.headers['content-length']);
    if (declared > MAX_REQUEST_BYTES) { refuseBody('E_TOO_LARGE'); return; }

    const admit = limits.acquire({ tokenRow: tok, slot, credentialRow: cred.row });
    if (!admit.release) {
      fail(admit.status, admit.kind === 'rate' ? 'rate_limit_error' : 'permission_error', admit.message,
        admit.retryAfter ? { 'retry-after': String(admit.retryAfter) } : {});
      return;
    }

    // A declared length is held up front, so a call that can't fit is refused before any of
    // its body is read; a chunked body is held as it arrives.
    const hold = bodyHold();
    const sized = Number.isFinite(declared);
    if (sized && !hold.take(declared)) { admit.release(); refuseBody('E_BUSY'); return; }
    let body;
    try {
      body = requestWithUsage(slot, rest, await readBody(req, MAX_REQUEST_BYTES, sized ? null : hold.take,
        { idleMs: config.bodyIdleMs ?? BODY_IDLE_MS, totalMs: config.bodyTotalMs ?? BODY_TOTAL_MS }));
    } catch (err) {
      admit.release(); hold.release();
      if (['E_TOO_LARGE', 'E_BUSY', 'E_TIMEOUT', 'E_BACKGROUND'].includes(err.code)) refuseBody(err.code);
      else res.destroy();
      return;
    }

    // A Connect slot asks for uncompressed messages (the reply scrub reads gzip too: a server may mirror the request's).
    const baseHeaders = { ...upstreamRequestHeaders(req.headers, slot.headers), ...(slot.protocol === 'connect' ? CONNECT_IDENTITY : {}),
      'content-length': String(body.length) };
    // Copilot's gateway answers from a Chat Completions or a Messages endpoint on one slot. Cursor's turn stream
    // (RunSSE) carries its usage; its unary calls carry none (as the relay meters them, relay-usage.mjs).
    const tapProtocol = /\/v1\/messages$/.test(rest) ? 'anthropic'
      : slot.protocol === 'connect' && rest !== '/agent.v1.AgentService/RunSSE' ? 'none' : slot.protocol;

    // Calls with no per-call price record tokens and book no dollars: a Claude subscription,
    // Copilot and Cursor (billed per seat and premium request, not per token) and a keyless slot
    // (local models). Everything else is priced, an unlisted model at the fallback rate.
    const plan = subscription ? 'subscription'
      : slot.auth === 'copilot' || slot.auth === 'copilot-pat' ? 'copilot'
        : slot.auth === 'cursor-exchange' ? 'cursor' : null;
    // A slot that sends no key (auth or credential 'none') is keyless, as resolveCredential treats it (V12).
    const priced = !plan && slot.credential !== 'none' && slot.auth !== 'none';
    let settled = false;
    const finish = (status, usage) => {
      if (settled) return; settled = true;
      admit.release(); hold.release();
      const usd = usage && priced ? priceUsage(usage, config.unpricedRates || UNPRICED_RATES) : 0;
      if (usd > 0 && !Number.isFinite(usage.reportedUsd) && !listRatesFor(usage.model)) noteUnpriced(usage.model, slot.id);
      try {
        store.insertUsage({
          at: now(), billTo: tok.bill_to, slot: slot.id, spawnId: tok.spawn_id, runId: tok.run_id,
          model: usage?.model ?? null, status, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
          cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens, usd, ms: now() - started,
          plan,
        });
        store.addSpend(tok.hash, usd);
        if (cred.row) store.markUsed(tok.bill_to, slot.id, now());
      } catch (err) { log(`usage write failed: ${err.message}`); }
      limits.invalidate(tok.bill_to, slot.id);
      log(`${new Date(now()).toISOString()} ${tok.bill_to} ${slot.id} ${usage?.model || '-'} ${status} in=${usage?.inputTokens || 0} out=${usage?.outputTokens || 0} usd=${usd.toFixed(4)} ${now() - started}ms`);
    };

    let up = null;
    // Once a streamed answer has started, every way it ends books what the tap read (V7), never $0.
    let tap = null; let tapStatus = 0;
    let authSecrets = [];   // derived credentials (a Copilot token) to scrub along with the stored one
    // A client that hangs up does not end the upstream call: the response is read to its end
    // and booked in full. Cutting it short would book only the output counted at
    // message_start, so an agent could abort every stream and spend unbooked. The provider
    // then finishes the response, so a dropped call costs what a finished one would; the
    // upstream idle timeout still ends a stalled one.
    let clientGone = false;
    res.on('close', () => { if (!res.writableFinished) clientGone = true; });

    /** One attempt. Copilot and Cursor (RETRY_ON_401) get exactly one retry with a fresh exchange (or host lookup) on a
     *  401: a derived token expired early. Only a 401 after the retry marks the person's key rejected. */
    const send = async (attempt) => {
      let auth;
      try { auth = await upstreamAuth(slot, cred.secret, { force: attempt > 0, incoming: req.headers }); }
      catch (err) {
        finish(err.status || 502, null);
        if (err.status === 401 || err.status === 403) {
          if (cred.row) { store.setVerify(tok.bill_to, slot.id, { ok: false, error: err.message, now: now() }); credCache.delete(`${tok.bill_to}|${slot.id}`); }
          refuseAuth(`your ${slotName(slot)} no longer works (${err.message}). ${capital(whereToAdd(slot))}`);
        } else fail(502, 'api_error', `upstream unreachable: ${err.message}`);
        return;
      }
      authSecrets = auth.secrets;
      const target = new URL(rest + query, auth.origin);
      if (target.origin !== auth.origin) { finish(403, null); fail(403, 'permission_error', 'destination refused'); return; }
      try { up = doRequest(target, { method: req.method, headers: { ...baseHeaders, ...auth.headers }, timeout: UPSTREAM_IDLE_MS }); }
      catch { finish(502, null); fail(502, 'api_error', 'upstream unreachable'); return; }
      up.on('timeout', () => up.destroy(new Error('upstream idle timeout')));
      up.on('error', () => {
        finish(tap ? tapStatus : 502, tap ? tap.end() : null);
        if (!res.headersSent) fail(502, 'api_error', 'upstream unreachable');
        else res.destroy();
      });
      up.on('response', (ur) => onResponse(ur, attempt));
      up.end(body);
      // The body is forwarded: its bytes leave the shared budget now, not when a long stream ends (V13),
      // and the reference goes with them, so a long stream does not keep an uncounted Buffer alive.
      // A slot that may send it again after a 401 (RETRY_ON_401) keeps its bytes until the answer is past that.
      if (attempt > 0 || !RETRY_ON_401.includes(slot.auth)) { body = null; hold.release(); }
    };

    const onResponse = (ur, attempt) => {
      const status = ur.statusCode || 502;
      if (status === 401 && attempt === 0 && RETRY_ON_401.includes(slot.auth)) {
        ur.resume();
        if (slot.auth === 'copilot') copilotFor(slot).invalidate(cred.secret);
        send(1);
        return;
      }
      body = null; hold.release();
      if (status >= 300 && status < 400) {
        ur.resume();
        finish(502, null);
        fail(502, 'api_error', 'upstream redirect refused');
        return;
      }
      if (status >= 400) {
        const parts = []; let n = 0;
        ur.on('data', (c) => { if (n < MAX_ERROR_BODY) { parts.push(c); n += c.length; } });
        ur.on('end', () => {
          const text = scrubText(Buffer.concat(parts).toString('utf8'), [cred.secret, ...authSecrets]);
          finish(status, null);
          if ((status === 401 || status === 403) && cred.row) {
            store.setVerify(tok.bill_to, slot.id, { ok: false, error: `${status} from the provider`, now: now() });
            credCache.delete(`${tok.bill_to}|${slot.id}`);
            let detail = text;
            try { const j = JSON.parse(text); detail = j?.error?.message || detail; } catch { /* text */ }
            refuseAuth(`your ${slotName(slot)} was rejected by the provider (${String(detail).slice(0, 200)}). Replace it: ${whereToAdd(slot)}`);
            return;
          }
          const h = { ...agentResponseHeaders(ur.headers), ...pickHeaders(ur.headers, slot.responseHeaders, [cred.secret, ...authSecrets]) };
          h['content-length'] = String(Buffer.byteLength(text));
          if (!res.headersSent) { res.writeHead(status, h); res.end(text); }
        });
        ur.on('error', () => { finish(status, null); res.destroy(); });
        return;
      }
      if (req.method === 'GET') {
        // A metadata read can echo the key (OpenRouter's /api/v1/key labels it, masked), so it
        // is read whole and scrubbed like an error. Calls that make the model write stream
        // through untouched: the model never sees the key, and scrubbing key shapes there
        // would rewrite what it wrote.
        const parts = [];
        ur.on('data', (c) => {
          if (settled) return;
          const tooLarge = hold.held() + c.length > MAX_SCRUBBED_BODY;
          if (tooLarge || !hold.take(c.length)) {
            ur.destroy(); finish(tooLarge ? 502 : 503, null);
            if (tooLarge) fail(502, 'api_error', 'upstream response too large');
            else fail(503, 'overloaded_error', 'the broker is busy with other large requests, retry in a few seconds', { 'retry-after': '2' });
            return;
          }
          parts.push(c);
        });
        ur.on('end', () => {
          const text = scrubText(Buffer.concat(parts).toString('utf8'), [cred.secret, ...authSecrets]);
          finish(status, null);
          const h = { ...agentResponseHeaders(ur.headers), ...pickHeaders(ur.headers, slot.responseHeaders, [cred.secret, ...authSecrets]) };
          h['content-length'] = String(Buffer.byteLength(text));
          res.writeHead(status, h); res.end(text);
        });
        ur.on('error', () => { if (!settled) { finish(status, null); res.destroy(); } });
        return;
      }
      tap = createUsageTap(tapProtocol, ur.headers['content-type']); tapStatus = status;
      // A Cursor reply can echo the access token the broker derived (or the key): scrubbed on the way out, as the relay
      // does (model-relay.mjs), a streamed reply message by message (a gzip message inflated first). A reply the broker
      // cannot read is refused before anything reaches the client; the tap still reads and books it. The tap reads the
      // raw bytes. Model output of the other slots streams untouched.
      const scrubbed = slot.auth === 'cursor-exchange';
      const unreadable = scrubbed ? connectReplyProblem(ur.headers) : null;
      if (unreadable) {
        tapStatus = 502;
        ur.on('data', (c) => tap.write(c));
        ur.on('end', () => finish(502, tap.end()));
        ur.on('error', () => finish(502, tap.end()));
        fail(502, 'api_error', `Cursor sent ${unreadable}, which the broker cannot check for credentials`);
        return;
      }
      res.writeHead(status, { ...agentResponseHeaders(ur.headers), ...pickHeaders(ur.headers, slot.responseHeaders, [cred.secret, ...authSecrets]) });
      const secrets = [cred.secret, ...authSecrets];
      const scrub = !scrubbed ? null
        : isConnectStream(ur.headers['content-type']) ? createConnectScrubber(secrets, { maxMessage: MAX_REQUEST_BYTES }) : createByteScrubber(secrets);
      // A client that stops reading (never hangs up) would pause the upstream until its idle timeout, which
      // books nothing: after CLIENT_DRAIN_MS it counts as gone, and the rest is read and booked as for a hang-up.
      let drainTimer = null;
      const resume = () => { clearTimeout(drainTimer); ur.resume(); };
      res.on('close', resume);   // a pause waiting for 'drain' would never end once the client is gone
      ur.on('data', (c) => {
        tap.write(c);
        if (clientGone) return;
        const out = scrub ? scrub.push(c) : c;
        // A message the scrub cannot read: the client's stream is cut (as for a hang-up, the rest is read and booked).
        if (out === null) { clientGone = true; log(`${tok.bill_to} ${slot.id}: cut a reply with a message the broker cannot check for credentials`); res.destroy(); return; }
        if (!res.write(out)) {
          ur.pause(); res.once('drain', resume);
          drainTimer = setTimeout(() => { clientGone = true; res.destroy(); resume(); }, config.clientDrainMs ?? CLIENT_DRAIN_MS);
        }
      });
      ur.on('end', () => { if (!clientGone) res.end(scrub ? scrub.flush() : undefined); finish(status, tap.end()); });
      ur.on('error', () => { finish(status, tap.end()); res.destroy(); });
    };
    await send(0);
  }

  // ── internal API (worca server → broker) ───────────────────────────────────

  async function handleInternal(req, res) {
    const auth = String(req.headers.authorization || '');
    const presented = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] || '';
    if (!presented || !safeEqual(presented, config.secret)) { sendJson(res, 401, { error: 'unauthorized' }); return; }
    const url = new URL(req.url, 'http://broker');
    const p = url.pathname;
    let body = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      try { const b = await readBody(req, 64 << 10); body = b.length ? JSON.parse(b.toString('utf8')) : {}; }
      catch {
        res.on('finish', () => req.destroy());
        sendJson(res, 400, { error: 'body must be JSON (at most 64 KB)' }, { connection: 'close' });
        return;
      }
    }
    if (req.method === 'GET' && p === '/internal/info') {
      sendJson(res, 200, {
        version: config.version || null, mode: config.mode, publicUrl: config.publicUrl,
        // upstream: the pinned origin, so worca can map a bridged model's base URL to its slot
        // (routing only; it never learns a key). auth: 'copilot' marks the Copilot slot.
        slots: slots.map((s) => ({
          id: s.id, label: s.label, protocol: s.protocol, credential: s.credential, upstream: new URL(s.upstream).origin, auth: s.auth,
          ...(s.plugin ? { plugin: s.plugin } : {}),
        })),
      });
      return;
    }
    // The slots worca derives from enabled plugins' models (src/core/plugin-broker-slots.mjs):
    // the whole set each time, so a disabled plugin's slots go away.
    if (req.method === 'PUT' && p === '/internal/plugin-slots') {
      let next;
      try { next = setPluginSlots(body?.slots ?? []); }
      catch (err) { sendJson(res, 400, { error: err.message }); return; }
      sendJson(res, 200, { slots: next.map((s) => s.id) });
      return;
    }
    if (req.method === 'POST' && p === '/internal/tokens') {
      const r = parseMintRequest(body, { slotIds: [...slotById.keys()], maxTtlMs: config.tokenMaxTtlMs });
      if (r.error) { sendJson(res, 400, { error: r.error }); return; }
      if (config.mode === 'single') r.req.billTo = normalizeBillTo(r.req.billTo) || 'local';
      sendJson(res, 200, mintToken(store, r.req, now()));
      return;
    }
    let m = /^\/internal\/tokens\/([A-Za-z0-9._:-]{1,128})$/.exec(p);
    if (req.method === 'DELETE' && m) { sendJson(res, 200, { revoked: store.revokeSpawn(m[1], now()) }); return; }
    if (req.method === 'POST' && p === '/internal/tokens/revoke') {
      const { issuer, exceptIssuer, runId, billTo } = body || {};
      const f = { issuer: str(issuer), exceptIssuer: str(exceptIssuer), runId: str(runId), billTo: billTo ? normalizeBillTo(billTo) : null };
      if (!f.issuer && !f.exceptIssuer && !f.runId && !f.billTo) { sendJson(res, 400, { error: 'name issuer, exceptIssuer, runId or billTo' }); return; }
      sendJson(res, 200, { revoked: store.revokeWhere(f, now()) });
      return;
    }
    m = /^\/internal\/people\/([^/]+)\/slots$/.exec(p);
    if (req.method === 'GET' && m) {
      const who = normalizeBillTo(decodeURIComponent(m[1]));
      if (!who) { sendJson(res, 400, { error: 'bad person' }); return; }
      sendJson(res, 200, { person: who, keyPage: config.publicUrl, slots: slotStatus(who) });
      return;
    }
    // "Push as me": the acting person's GitHub user token, for ONE git or gh call worca makes
    // itself (never an agent). A GitHub App user token close to expiry is renewed first.
    if (req.method === 'POST' && p === '/internal/github-token') {
      const slot = [...slotById.values()].find((s) => s.auth === 'github-user');
      if (!slot) { sendJson(res, 404, { error: '"push as me" is not set up on the broker (WORCA_BROKER_GITHUB_CLIENT_ID)', code: 'not_configured' }); return; }
      const who = normalizeBillTo(body?.person);
      if (!who || who === 'local') { sendJson(res, 400, { error: 'person must be a signed-in person\'s email' }); return; }
      const c = resolveCredential(who, slot);
      if (c.missing) { sendJson(res, 404, { error: `${who} has not connected GitHub${config.publicUrl ? ` (key page: ${config.publicUrl})` : ''}`, code: 'not_connected' }); return; }
      if (c.error) { sendJson(res, 409, { error: c.error }); return; }
      let g = parseGithubSecret(c.secret);
      if (g.refreshToken && g.expiresAt && g.expiresAt - now() < 5 * 60_000) {
        try {
          const next = await refreshGithubToken({ refreshToken: g.refreshToken, clientId: slot.clientId, clientSecret: config.github?.clientSecret, fetchImpl, ...(slot.deviceBaseUrl ? { baseUrl: slot.deviceBaseUrl } : {}), now: now() });
          g = parseGithubSecret(next);
          store.putCredential({ billTo: who, slot: slot.id, sealed: seal(config.vaultKey, next, { billTo: who, slot: slot.id }), suffix: suffixOf(g.token), kind: 'github', upstream: new URL(slot.upstream).origin, verifiedAt: now(), now: now() });
          credCache.delete(`${who}|${slot.id}`);
        } catch (err) {
          store.setVerify(who, slot.id, { ok: false, error: err.message, now: now() });
          credCache.delete(`${who}|${slot.id}`);
          sendJson(res, 409, { error: err.message, code: 'expired' });
          return;
        }
      }
      store.markUsed(who, slot.id, now());
      log(`${new Date(now()).toISOString()} github token handed to worca for ${who}`);
      sendJson(res, 200, { token: g.token, expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null });
      return;
    }
    if (req.method === 'GET' && p === '/internal/usage/summary') {
      const iso = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
      sendJson(res, 200, { rows: store.summarizeUsage({ since: iso(url.searchParams.get('since')), until: iso(url.searchParams.get('until')) }) });
      return;
    }
    if (req.method === 'GET' && p === '/internal/usage') {
      const who = url.searchParams.get('billTo');
      sendJson(res, 200, {
        rows: store.queryUsage({
          since: url.searchParams.get('since'), billTo: who ? normalizeBillTo(who) : null,
          runId: url.searchParams.get('runId'), spawnId: url.searchParams.get('spawnId'), limit: url.searchParams.get('limit'),
        }),
      });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  }

  return {
    get slots() { return slots; },
    get slotById() { return slotById; },
    limits, fetchImpl,
    resolveCredential, verifyCredential, saveCredential, testCredential, deleteCredential, slotStatus, rotateVault, setPluginSlots,
    handleProxy, handleInternal,
    /** Router for the private port: /internal/*, /healthz, /p/*. */
    handlePrivate(req, res) {
      const u = String(req.url || '');
      if (!u.startsWith('/')) { sendJson(res, 400, { error: 'absolute-form requests are refused' }); return; }
      if (req.method === 'GET' && (u === '/healthz' || u.startsWith('/healthz?'))) { sendJson(res, 200, { ok: true, version: config.version || null, mode: config.mode }); return; }
      if (u.startsWith('/internal/')) { handleInternal(req, res).catch(() => sendJson(res, 500, { error: 'internal error' })); return; }
      handleProxy(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }); else res.destroy(); });
    },
  };
}

function str(v) { return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v) ? v : null; }
function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
