// src/broker/service.mjs
// The broker's core (plans/credential-broker-design.html §6.4): credential
// resolution, the /p/<slot>/… proxy, key verification, and the /internal API the
// worca server calls. Both HTTP listeners (main.mjs) hand requests here; the key
// page (ui-server.mjs) uses the credential methods.
import http from 'node:http';
import https from 'node:https';
import { seal, open, suffixOf, keyId } from './vault.mjs';
import { isAllowedPath, pathIssue } from './slots.mjs';
import { resolveToken, tokenFromHeaders, parseMintRequest, mintToken, safeEqual, normalizeBillTo } from './tokens.mjs';
import { createUsageTap, priceUsage } from './usage.mjs';
import { scrubText } from './scrub.mjs';
import { createLimits } from './limits.mjs';
import { createCopilotExchange, parseGithubSecret, refreshGithubToken } from './copilot.mjs';

export const MAX_REQUEST_BYTES = 32 << 20;
const MAX_ERROR_BODY = 64 << 10;
const CRED_CACHE_MS = 30_000;
const UPSTREAM_IDLE_MS = 10 * 60_000;

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
    : { type: 'error', error: { type, message: msg } };
  return { status, body };
}

function sendJson(res, status, body, extra = {}) {
  if (res.headersSent) { res.destroy(); return; }
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store', ...extra });
  res.end(s);
}

function readBody(req, limit) {
  return new Promise((resolveP, rejectP) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { rejectP(Object.assign(new Error('too large'), { code: 'E_TOO_LARGE' })); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolveP(Buffer.concat(parts)));
    req.on('error', rejectP);
  });
}

/** A human name for a slot in messages: "Anthropic API key". */
const slotName = (slot) => slot.label || slot.id;

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

/**
 * @param {{config:object, slots:object[], store:object, log?:(line:string)=>void, now?:()=>number,
 *          requestImpl?:(url:URL, opts:object)=>import('node:http').ClientRequest}} o
 */
export function createBrokerService({ config, slots, store, log = () => {}, now = Date.now, requestImpl, fetchImpl = globalThis.fetch }) {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const limits = createLimits({ store, config, now });
  const credCache = new Map();
  const doRequest = requestImpl || ((url, opts) => (url.protocol === 'https:' ? https : http).request(url, opts));
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

  /** Where a request for `slot` goes and the credential headers it carries. May throw (Copilot exchange). */
  async function upstreamAuth(slot, secret, { force = false, incoming = {} } = {}) {
    if (slot.auth === 'copilot') {
      const t = await copilotFor(slot).token(secret, { force });
      return { origin: t.host, headers: { authorization: `Bearer ${t.token}` }, secrets: [t.token] };
    }
    return { origin: new URL(slot.upstream).origin, headers: authHeaders(slot, secret, incoming), secrets: [] };
  }

  const whereToAdd = (slot) => (config.mode === 'multi' && config.publicUrl
    ? `add one at ${config.publicUrl}`
    : `set WORCA_BROKER_KEY_${slot.id.toUpperCase().replace(/-/g, '_')} on the broker`);

  // ── credentials ─────────────────────────────────────────────────────────────

  /** {secret} (null secret for a keyless slot), or {missing:true}, or {error}. */
  function resolveCredential(billTo, slot) {
    if (slot.credential === 'none' || slot.auth === 'none') return { secret: null, row: null };
    const ck = `${billTo}|${slot.id}`;
    const hit = credCache.get(ck);
    if (hit && now() - hit.at < CRED_CACHE_MS) return hit.value;
    let value;
    if (config.mode === 'single' || (slot.credential === 'operator' && config.allowTeamKeys)) {
      const secret = config.singleKeys[slot.id];
      value = secret ? { secret, row: null } : { missing: true };
    } else if (slot.credential === 'operator') {
      value = { missing: true };
    } else {
      const row = store.getCredential(billTo, slot.id);
      if (!row) value = { missing: true };
      else if (!config.vaultKey) value = { error: 'the broker has no vault key' };
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
    const v = await verifyCredential(slot, s);
    if (!v.ok) return { ok: false, status: 422, error: `${slotName(slot)} was not accepted: ${v.error}` };
    const kind = credentialKind(slot, s);
    const suffix = suffixOf(slot.auth === 'github-user' ? parseGithubSecret(s).token : s);
    store.putCredential({ billTo, slot: slotId, sealed: seal(config.vaultKey, s, { billTo, slot: slotId }), suffix, kind, verifiedAt: now(), now: now() });
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
      const base = { id: slot.id, label: slot.label, protocol: slot.protocol, credential: slot.credential, keyHint: slot.keyHint || '', ...(slot.signIn ? { signIn: slot.signIn } : {}) };
      if (slot.credential === 'none' || slot.auth === 'none') return { ...base, state: 'keyless' };
      if (config.mode === 'single') {
        const k = config.singleKeys[slot.id];
        return { ...base, state: k ? 'set' : 'missing', ...(k ? { kind: credentialKind(slot, k) } : {}) };
      }
      if (slot.credential === 'operator') return { ...base, state: config.allowTeamKeys && config.singleKeys[slot.id] ? 'operator' : 'missing' };
      const r = rows.get(slot.id);
      if (!r) return { ...base, state: 'missing' };
      const stale = config.vaultKey && r.key_id !== keyId(config.vaultKey);
      return {
        ...base,
        state: stale ? 'invalid' : (r.verify_error ? 'invalid' : 'set'),
        suffix: r.suffix, kind: r.kind || null, createdAt: r.created_at, updatedAt: r.updated_at, lastUsedAt: r.last_used_at,
        verifiedAt: r.verified_at, verifyError: stale ? 'the vault key changed: enter this key again' : r.verify_error,
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

    const admit = limits.acquire({ tokenRow: tok, slot, credentialRow: cred.row });
    if (!admit.release) {
      fail(admit.status, admit.kind === 'rate' ? 'rate_limit_error' : 'permission_error', admit.message,
        admit.retryAfter ? { 'retry-after': String(admit.retryAfter) } : {});
      return;
    }

    let body;
    try { body = await readBody(req, MAX_REQUEST_BYTES); }
    catch (err) {
      admit.release();
      if (err.code === 'E_TOO_LARGE') fail(413, 'request_too_large', 'request body is too large');
      else res.destroy();
      return;
    }

    const baseHeaders = { ...upstreamRequestHeaders(req.headers, slot.headers), 'content-length': String(body.length) };
    // Copilot's gateway answers from a Chat Completions or a Messages endpoint on one slot.
    const tapProtocol = /\/v1\/messages$/.test(rest) ? 'anthropic' : slot.protocol;

    let settled = false;
    const finish = (status, usage) => {
      if (settled) return; settled = true;
      admit.release();
      // A subscription call has no per-call price: tokens are recorded, dollars are not.
      const usd = usage && !subscription ? priceUsage(usage) : 0;
      try {
        store.insertUsage({
          at: now(), billTo: tok.bill_to, slot: slot.id, spawnId: tok.spawn_id, runId: tok.run_id,
          model: usage?.model ?? null, status, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
          cacheReadTokens: usage?.cacheReadTokens, cacheWriteTokens: usage?.cacheWriteTokens, usd, ms: now() - started,
          plan: subscription ? 'subscription' : null,
        });
        store.addSpend(tok.hash, usd);
        if (cred.row) store.markUsed(tok.bill_to, slot.id, now());
      } catch (err) { log(`usage write failed: ${err.message}`); }
      limits.invalidate(tok.bill_to, slot.id);
      log(`${new Date(now()).toISOString()} ${tok.bill_to} ${slot.id} ${usage?.model || '-'} ${status} in=${usage?.inputTokens || 0} out=${usage?.outputTokens || 0} usd=${usd.toFixed(4)} ${now() - started}ms`);
    };

    let up = null;
    let authSecrets = [];   // derived credentials (a Copilot token) to scrub along with the stored one
    res.on('close', () => { if (!settled && up) up.destroy(); });

    /** One attempt. Copilot gets exactly one retry with a fresh exchange on a 401 (its token expired early). */
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
        finish(502, null);
        if (!res.headersSent) fail(502, 'api_error', 'upstream unreachable');
        else res.destroy();
      });
      up.on('response', (ur) => onResponse(ur, attempt));
      up.end(body);
    };

    const onResponse = (ur, attempt) => {
      const status = ur.statusCode || 502;
      if (status === 401 && slot.auth === 'copilot' && attempt === 0) {
        ur.resume();
        copilotFor(slot).invalidate(cred.secret);
        send(1);
        return;
      }
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
          const h = agentResponseHeaders(ur.headers);
          h['content-length'] = String(Buffer.byteLength(text));
          if (!res.headersSent) { res.writeHead(status, h); res.end(text); }
        });
        ur.on('error', () => { finish(status, null); res.destroy(); });
        return;
      }
      const tap = createUsageTap(tapProtocol, ur.headers['content-type']);
      res.writeHead(status, agentResponseHeaders(ur.headers));
      ur.on('data', (c) => {
        tap.write(c);
        if (!res.write(c)) { ur.pause(); res.once('drain', () => ur.resume()); }
      });
      ur.on('end', () => { res.end(); finish(status, tap.end()); });
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
    if (req.method === 'POST') {
      try { const b = await readBody(req, 64 << 10); body = b.length ? JSON.parse(b.toString('utf8')) : {}; }
      catch { sendJson(res, 400, { error: 'body must be JSON (at most 64 KB)' }); return; }
    }
    if (req.method === 'GET' && p === '/internal/info') {
      sendJson(res, 200, {
        version: config.version || null, mode: config.mode, publicUrl: config.publicUrl,
        // upstream: the pinned origin, so worca can map a bridged model's base URL to its slot
        // (routing only; it never learns a key). auth: 'copilot' marks the Copilot slot.
        slots: slots.map((s) => ({ id: s.id, label: s.label, protocol: s.protocol, credential: s.credential, upstream: new URL(s.upstream).origin, auth: s.auth })),
      });
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
          store.putCredential({ billTo: who, slot: slot.id, sealed: seal(config.vaultKey, next, { billTo: who, slot: slot.id }), suffix: suffixOf(g.token), kind: 'github', verifiedAt: now(), now: now() });
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
    slots, slotById, limits, fetchImpl,
    resolveCredential, verifyCredential, saveCredential, testCredential, deleteCredential, slotStatus, rotateVault,
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
