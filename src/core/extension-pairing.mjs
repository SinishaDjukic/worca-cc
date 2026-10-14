// src/core/extension-pairing.mjs
// The Worca browser extension (docs/browser-extension.md). worca's API has no auth and runs agents, so S1
// (ui/server.mjs) refuses every non-loopback Origin — chrome-extension:// and moz-extension:// included. This module
// opens exactly one door, local mode only: an extension origin on a loopback Host may (a) ask to be paired — a person
// approves it in the Worca UI against a matching 6-digit code — and (b) with its own token, reach an allowlist of
// routes. The store keeps sha256(token) only (0600); a token is bound to the origin it was issued to.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeJsonAtomic } from './json-atomic.mjs';
import { LOCAL_HOSTNAMES, hostnameOf } from './remote-access.mjs';

export const EXTENSION_WS_PROTOCOL = 'worca-ext';
export const TOKEN_PREFIX = 'wex_';
export const PAIR_TTL_MS = 2 * 60 * 1000;
export const PAIR_MAX_PENDING = 3;
export const PAIR_RATE = Object.freeze({ max: 10, windowMs: 10 * 60 * 1000 });
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const BROWSERS = new Set(['chrome', 'edge', 'firefox']);
const EXT_ID_RE = /^[a-z0-9-]{8,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

/** "chrome-extension://<id>" | "moz-extension://<uuid>" (normalised) or null for anything else. */
export function extensionOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'chrome-extension:' && u.protocol !== 'moz-extension:') return null;
  const id = String(u.hostname || '').toLowerCase();
  if (!EXT_ID_RE.test(id) || u.port || u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) return null;
  return `${u.protocol}//${id}`;
}

const route = (method, re) => Object.freeze({ method, re });
const SEG = '[A-Za-z0-9_-]{1,128}';
/** Open to an UNPAIRED extension: tell "not running" from "not paired" (hello) and ask to pair. Not /api/health (m7). */
export const EXTENSION_PAIR_ROUTES = Object.freeze([
  route('GET', /^\/api\/extension\/hello$/),
  route('POST', /^\/api\/extension\/pair$/),
  route('GET', new RegExp(`^/api/extension/pair/${SEG}$`)),
]);
/** The token's allowlist (Clarify token-scope: Ask + Pinpoint + read-only project/workspace listing). The cards route
 *  (POST /api/ask/threads/:id/cards/:cardId) is deliberately NOT here: it runs settings/clone/schedule/stop/revert
 *  actions — exactly what a page's prompt injection would aim at. Cards act in the full Worca UI only. */
export const EXTENSION_TOKEN_ROUTES = Object.freeze([
  route('GET', /^\/api\/extension\/status$/),
  route('GET', /^\/api\/ask\/models$/),
  route('GET', /^\/api\/ask\/threads$/),
  route('POST', /^\/api\/ask\/threads$/),
  route('GET', new RegExp(`^/api/ask/threads/${SEG}$`)),
  route('PATCH', new RegExp(`^/api/ask/threads/${SEG}$`)),
  route('POST', new RegExp(`^/api/ask/threads/${SEG}/messages$`)),
  route('POST', new RegExp(`^/api/ask/threads/${SEG}/stop$`)),
  // No attachment download: the sidebar never reads attachments back (v5, review suggestion).
  route('POST', /^\/api\/pinpoint$/),
  route('GET', /^\/api\/projects$/),
  route('GET', /^\/api\/workspaces$/),
  // Read-only: one page origin → at most the matching running Action's {url, projectKey, workspaceId, runId, runTitle}
  // (the sidebar pre-pins a page chat to that run's project). Never /api/actions/running: that lists every instance.
  route('GET', /^\/api\/extension\/actions\/match$/),
]);

/** 'pair' | 'token' | null for a method + path (req.path: no query string, not decoded; method- and case-exact). */
export function extensionRouteKind(method, path) {
  const m = String(method || '').toUpperCase();
  const p = String(path || '');
  const hit = (list) => list.some((r) => r.method === m && r.re.test(p));
  if (hit(EXTENSION_PAIR_ROUTES)) return 'pair';
  if (hit(EXTENSION_TOKEN_ROUTES)) return 'token';
  return null;
}

export function bearerToken(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || '').trim());
  return m ? m[1] : null;
}

/**
 * What the gate does with one request. {kind:'pass'} = not an extension request on a loopback Host: S1 decides,
 * exactly as before. Otherwise 'preflight' | 'allow' | 'refuse' — all carry the origin CORS is answered for.
 * @param {{method:string, path:string, headers:object}} req
 * @param {{remoteMode:boolean, verify:(origin:string, token:string|null) => object|null}} o
 */
export function decideExtensionRequest(req, { remoteMode, verify }) {
  // The extension names itself in X-Worca-Extension on every call, because Chrome sends an extension's GET WITHOUT an
  // Origin to a host the extension holds a grant for (activeTab on the tab showing Worca). With no Origin, that header
  // is the extension origin, under exactly the rules below (loopback Host, allowlist, the token for token routes). A
  // web page cannot send it cross-origin without a CORS preflight, which only extension origins pass; a request with
  // no Origin comes from a non-browser local caller, which can already reach the API (S1). Both present and differing:
  // refused, with no CORS for either.
  const named = req.headers['x-worca-extension'];
  const origin = extensionOrigin(req.headers.origin ?? named);
  if (req.headers.origin != null && named != null && extensionOrigin(named) !== extensionOrigin(req.headers.origin)) {
    return { kind: 'refuse', origin: null, status: 403, code: 'extension-origin', error: 'forbidden: Origin and X-Worca-Extension disagree' };
  }
  if (!origin) return { kind: 'pass' };
  const host = String(hostnameOf(req.headers.host) || '').toLowerCase();
  if (!LOCAL_HOSTNAMES.has(host)) return { kind: 'pass' };   // the DNS-rebinding belt holds for extensions too
  const preflight = req.method === 'OPTIONS';
  const method = preflight ? String(req.headers['access-control-request-method'] || '') : req.method;
  const kind = extensionRouteKind(method, req.path);
  // Remote mode still answers an allowlisted preflight: every call carries X-Worca-Extension, so even the hello probe
  // preflights, and a refused preflight makes fetch throw ("not running") instead of reading this refusal.
  if (remoteMode && !(preflight && kind)) {
    return { kind: 'refuse', origin, status: 403, code: 'extension-remote-mode', error: 'forbidden: the browser extension works with a local Worca only (remote access is on)' };
  }
  if (!kind) return { kind: 'refuse', origin, status: 403, code: 'extension-route', error: 'forbidden: this route is not open to the browser extension' };
  if (preflight) return { kind: 'preflight', origin };
  if (kind === 'pair') return { kind: 'allow', origin, extension: null };
  const extension = verify(origin, bearerToken(req.headers.authorization));
  if (!extension) return { kind: 'refuse', origin, status: 401, code: 'extension-unpaired', error: 'unauthorized: pair this browser extension with Worca first' };
  return { kind: 'allow', origin, extension };
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Worca extension';
const safeEq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const sha = (t) => createHash('sha256').update(String(t)).digest();
const publicEntry = (e) => ({ id: e.id, origin: e.origin, name: e.name, browser: e.browser, createdAt: e.createdAt, lastUsedAt: e.lastUsedAt || null });
const publicPending = (p) => ({ requestId: p.requestId, code: p.code, name: p.name, browser: p.browser, origin: p.origin, expiresAt: p.expiresAt });
const validEntry = (e) => !!(e && typeof e.id === 'string' && extensionOrigin(e.origin) === e.origin && HASH_RE.test(String(e.tokenSha256 || '')));

/**
 * @param {{file: () => string, now?: () => number}} o  `file` is resolved per use (never worcaHome() at import).
 */
export function createExtensionPairing({ file, now = () => Date.now() } = {}) {
  let state = null;
  const pending = new Map();   // requestId -> request (memory only: a restart drops every unanswered request)
  const rate = new Map();      // origin -> request timestamps in the window

  function load() {
    if (state) return state;
    try {
      const j = JSON.parse(readFileSync(file(), 'utf8'));
      state = { paired: Array.isArray(j && j.paired) ? j.paired.filter(validEntry) : [] };
    } catch {
      state = { paired: [] };
    }
    return state;
  }
  const save = () => writeJsonAtomic(file(), { version: 1, paired: load().paired }, { mode: 0o600 });

  function sweep() {
    const t = now();
    for (const [id, p] of pending) {
      if (p.state === 'pending' && p.expiresAt <= t) p.state = 'expired';
      // An approved/denied answer is dropped at its own expiresAt (approve resets it: the collect window is one TTL,
      // and the plaintext token leaves memory then). An expired request lingers one more TTL so a poll can read 410.
      else if (p.state !== 'pending' && p.state !== 'expired' && p.expiresAt <= t) pending.delete(id);
      if (p.expiresAt + PAIR_TTL_MS <= t) pending.delete(id);
    }
    // Forget origins whose timestamps all aged out, so forged origins cannot grow the map without bound.
    for (const [o, h] of rate) if (!h.some((x) => t - x < PAIR_RATE.windowMs)) rate.delete(o);
  }
  function pendingPublic() {
    sweep();
    return [...pending.values()].filter((p) => p.state === 'pending').map(publicPending);
  }

  function request({ origin, name, browser }) {
    sweep();
    if (!origin) return { ok: false, status: 400, code: 'extension-origin', error: 'pairing must come from a browser extension' };
    const t = now();
    const hits = (rate.get(origin) || []).filter((x) => t - x < PAIR_RATE.windowMs);
    if (hits.length >= PAIR_RATE.max) return { ok: false, status: 429, code: 'extension-pair-rate', error: 'too many pairing requests: wait a few minutes' };
    // v8: report the ids this request replaces, so the route can close their prompts in every Worca tab.
    const replacedRequestIds = [];
    for (const [id, p] of pending) if (p.origin === origin && p.state === 'pending') { pending.delete(id); replacedRequestIds.push(id); }
    const waiting = [...pending.values()].filter((p) => p.state === 'pending').length;
    if (waiting >= PAIR_MAX_PENDING) return { ok: false, status: 429, code: 'extension-pair-busy', error: 'other pairing requests are waiting for an answer in Worca', replacedRequestIds };
    // Count only a request that was actually queued: a 'busy' refusal must not burn the origin's rate budget.
    hits.push(t);
    rate.set(origin, hits);
    const p = {
      requestId: randomBytes(16).toString('base64url'),
      origin,
      name: cleanName(name),
      browser: BROWSERS.has(browser) ? browser : 'other',
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      pollKey: randomBytes(24).toString('base64url'),
      expiresAt: t + PAIR_TTL_MS,
      state: 'pending',
      token: null,
      id: null,
    };
    pending.set(p.requestId, p);
    return { ok: true, requestId: p.requestId, code: p.code, pollKey: p.pollKey, expiresAt: p.expiresAt, public: publicPending(p), replacedRequestIds };
  }

  function poll(requestId, { origin, pollKey }) {
    sweep();
    const p = pending.get(requestId);
    if (!p || p.origin !== origin || !safeEq(p.pollKey, pollKey)) return { status: 404, body: { error: 'no such pairing request', code: 'extension-pair-unknown' } };
    if (p.state === 'pending') return { status: 200, body: { status: 'pending', expiresAt: p.expiresAt } };
    pending.delete(requestId);
    if (p.state === 'approved') return { status: 200, body: { status: 'approved', token: p.token, id: p.id } };
    if (p.state === 'denied') return { status: 200, body: { status: 'denied' } };
    return { status: 410, body: { status: 'expired' } };
  }

  /** verdict 'approve' | 'deny' — called only for a person in the Worca UI (the server checks the caller). */
  function resolve(requestId, verdict) {
    sweep();
    const p = pending.get(requestId);
    if (!p) return { ok: false, status: 404, code: 'extension-pair-unknown', error: 'this pairing request is gone (answered or expired)' };
    if (p.state !== 'pending') return { ok: false, status: 409, code: 'extension-pair-answered', error: `this pairing request is already ${p.state}` };
    if (verdict !== 'approve') { p.state = 'denied'; return { ok: true, state: 'denied', replaced: [] }; }
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const s = load();
    const entry = {
      id: `ext_${randomBytes(6).toString('hex')}`,
      origin: p.origin, name: p.name, browser: p.browser,
      tokenSha256: sha(token).toString('hex'),
      createdAt: new Date(now()).toISOString(),
      lastUsedAt: null,
    };
    const prev = s.paired;
    // Re-pairing rotates the token. The ids it replaces go back to the server, which closes their open sockets
    // (4003) exactly as revoke does, so a socket opened with the old token stops receiving ask-* frames (review m3).
    const replaced = s.paired.filter((e) => e.origin === p.origin).map((e) => e.id);
    s.paired = [...s.paired.filter((e) => e.origin !== p.origin), entry];
    try { save(); } catch (err) { s.paired = prev; throw err; }
    p.state = 'approved';
    p.token = token;
    p.id = entry.id;
    p.expiresAt = now() + PAIR_TTL_MS;   // the window the extension has to collect it
    return { ok: true, state: 'approved', entry: publicEntry(entry), replaced };
  }

  function touch(e) {
    const t = now();
    if (e.lastUsedAt && t - Date.parse(e.lastUsedAt) < TOUCH_EVERY_MS) return;
    e.lastUsedAt = new Date(t).toISOString();
    try { save(); } catch { /* attribution only: never fail a request on it */ }
  }

  function verify(origin, token) {
    if (!origin || typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 128) return null;
    const h = sha(token);
    for (const e of load().paired) {
      if (e.origin !== origin) continue;
      const stored = Buffer.from(e.tokenSha256, 'hex');
      if (stored.length === h.length && timingSafeEqual(stored, h)) { touch(e); return publicEntry(e); }
    }
    return null;
  }

  function revoke(id) {
    const s = load();
    const hit = s.paired.find((e) => e.id === id);
    if (!hit) return null;
    s.paired = s.paired.filter((e) => e.id !== id);
    save();
    return publicEntry(hit);
  }

  return {
    request, poll, resolve, verify, revoke, pendingPublic,
    list: () => ({ paired: load().paired.map(publicEntry), pending: pendingPublic() }),
  };
}
