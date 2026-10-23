// src/core/upstream-proxy.mjs — the corporate (upstream) proxy the local proxy chains to.
//
// Behind the `corporateProxy` flag (checked in egress-policy.mjs). createProxy in egress-proxy.mjs
// receives the connector built here and calls route()/tunnel()/forward() for hosts that go to the
// upstream; egress-proxy.mjs itself keeps importing node: modules only (the Docker sidecar runs
// it as one file). NTLM authenticates a CONNECTION: Type 1 -> 407/Type 2 -> Type 3 run on one
// socket, the 407 body drained, never closed in between.
//
// Lockout breaker: the first 407 to a Type 3 (or a Basic header) stops all credential sending;
// clients get 407 "proxy needs login" without any upstream contact until reset() or a restart.
import net from 'node:net';
import http from 'node:http';
import { inspect } from 'node:util';
import { Buffer } from 'node:buffer';
import { parseHostList, hostMatches, normalizeHost } from './egress-proxy.mjs';
import { ntHash, type1Message, parseType2, type3Message, NtlmError } from './ntlm.mjs';

export const UPSTREAM_TIMEOUTS = Object.freeze({ connectMs: 30_000, authMs: 15_000, idleMs: 10 * 60_000 });
export const AUTH_MODES = Object.freeze(['auto', 'none', 'basic', 'ntlm']);
export const AUTH_LABELS = Object.freeze({ auto: 'NTLMv2', none: 'no login', basic: 'Basic, cleartext', ntlm: 'NTLMv2' });
/** Verified logins in flight at once: a password change mid-flight spends at most this many attempts. */
export const MAX_PARALLEL_HANDSHAKES = 2;
/** Strikes that trip an unverified gate: a 5xx WITH a Proxy-Authenticate challenge after credentials
 *  weighs 1, a close/reset/timeout/malformed head 2. A plain 5xx is never a strike (D11). */
export const MAX_UNCONFIRMED = 2;
const MS_MIN = 500;
const MS_MAX = 60 * 60_000;
const MAX_HEAD = 16 * 1024;
const MAX_407_BODY = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export class ProxyError extends Error {
  constructor(status, message, { needsLogin = false } = {}) {
    super(message);
    this.status = status;
    this.needsLogin = needsLogin;
  }
}

/** The login, kept for the life of the process. Exactly one secret is kept: the NT hash for
 *  auto/ntlm, the Basic token only for an explicit auth 'basic' (a reversible copy of the
 *  password, so never built otherwise). The password string goes out of scope after
 *  construction. Never printable. */
export class ProxyCredentials {
  #ntHash; #basic;
  /** `ntHash` (a 16-byte Buffer) is a saved login (src/core/proxy-credentials.mjs): NTLMv2 only. */
  constructor({ domain = '', user, password, raw, ntHash: hash = null }, auth) {
    this.domain = String(domain);
    this.user = String(user);
    this.saved = hash !== null;
    this.#ntHash = auth === 'basic' ? null : (hash ? Buffer.from(hash) : ntHash(password));
    this.#basic = auth === 'basic' && !hash ? Buffer.from(`${raw ?? user}:${password}`, 'utf8').toString('base64') : null;
  }
  get ntHash() { return this.#ntHash; }
  get basicToken() { return this.#basic; }
  get label() { return this.domain ? `${this.domain}\\${this.user}` : this.user; }
  toJSON() { return { user: this.label, secret: '[redacted]' }; }
  toString() { return `ProxyCredentials(${this.label}, [redacted])`; }
  [inspect.custom]() { return this.toString(); }
}

/** "host:port", bracketing an IPv6 host. */
export const upstreamLabel = (h, p) => `${h.includes(':') ? `[${h}]` : h}:${p}`;
const hostPort = upstreamLabel;

/** "http://DOMAIN%5Cuser:pass@host:port" -> { host, port, credentials } or { error } (never quoting the value). */
export function parseUpstreamUrl(raw) {
  const s = String(raw ?? '').trim();
  let u;
  try { u = new URL(s.includes('://') ? s : `http://${s}`); } catch { return { error: 'the upstream proxy URL is not valid' }; }
  if (u.protocol !== 'http:') return { error: `the upstream proxy must be an http:// URL (${u.protocol}// is not supported)` };
  const host = normalizeHost(u.hostname);
  if (!host) return { error: 'the upstream proxy URL has no host' };
  let user; let password;
  try { user = decodeURIComponent(u.username); password = decodeURIComponent(u.password); } catch { return { error: 'the upstream proxy URL has a malformed user name or password' }; }
  let credentials = null;
  if (user) {
    const sep = user.search(/[\\/]/);
    credentials = sep >= 0
      ? { domain: user.slice(0, sep), user: user.slice(sep + 1), password, raw: `${user.slice(0, sep)}\\${user.slice(sep + 1)}` }
      : { domain: '', user, password, raw: user };
  }
  return { host, port: u.port ? Number(u.port) : 80, credentials };
}

/** NO_PROXY-style list -> { all, list } ("*.x" == ".x"; "*" == everything). */
export function parseNoProxy(value) {
  const parts = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((e) => String(e).trim()).filter(Boolean);
  const all = parts.includes('*');
  const list = parseHostList(parts.filter((e) => e !== '*').map((e) => (e.startsWith('*.') ? e.slice(1) : e)).join(','));
  return { all, list };
}

export function goesDirect(host, noProxy) {
  const h = normalizeHost(host);
  if (LOOPBACK.has(h)) return true;
  return !!noProxy && (noProxy.all || noProxy.list.some((e) => hostMatches(h, e)));
}

const clampMs = (v, d) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), MS_MIN), MS_MAX) : d);

/**
 * The upstream from settings.json `networkProxy` (first) or the env's proxy URL, or null.
 * @returns {null | {error: string, source: string} | {source: 'settings'|'env', host: string, port: number,
 *   auth: string, credentials: ProxyCredentials|null, noProxy: {all: boolean, list: string[]},
 *   timeouts: {connectMs: number, authMs: number, idleMs: number}, warnings: string[]}}
 *   `login` is a readProxyLogin() record (or null): a saved login wins over the URL's user name
 *   (D6), and `urlCredentials` keeps the URL login as the fallback a logout returns to.
 *   `requestedAuth` is the auth mode the user set, or null (D23).
 */
export function resolveUpstream({ env = process.env, settings, login = null } = {}) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const configured = typeof s.upstream === 'string' ? s.upstream.trim() : '';
  const raw = configured || env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || '';
  if (!raw) return null;
  const source = configured ? 'settings' : 'env';
  const p = parseUpstreamUrl(raw);
  if (p.error) return { source, error: p.error };
  const warnings = [];
  let creds = p.credentials;
  if (configured && creds) {
    creds = null;
    warnings.push('settings.json networkProxy.upstream carries a user name or password, which Worca ignores (a password never goes into settings.json)');
  }
  const saved = login && !login.error && login.ntHash ? login : null;
  let usedLogin = null;
  // D23: what the user chose, or null. An explicit 'none' turns the saved login off.
  const requestedAuth = AUTH_MODES.includes(s.auth) ? s.auth : null;
  if (saved && requestedAuth === 'none') {
    warnings.push('networkProxy.auth is none, so the saved login (worca proxy login) is not used');
  } else if (saved && s.auth !== 'basic') {
    if (creds) warnings.push('a login is saved (worca proxy login), so the user name and password in the proxy URL are not used');
    creds = { domain: saved.domain, user: saved.user, ntHash: saved.ntHash };
    usedLogin = { id: saved.id, label: saved.domain ? `${saved.domain}\\${saved.user}` : saved.user, savedAt: saved.savedAt, rejected: saved.rejected || null };
  } else if (saved && !creds) {
    warnings.push('networkProxy.auth is basic, but the saved login keeps only an NT hash, which Basic cannot use; put the login in the HTTP(S)_PROXY URL or set auth to auto');
  }
  if (login && login.error) warnings.push(`the saved login cannot be used (${login.error})`);
  // The URL login stays the fallback a logout returns to (D6); Basic never swaps logins.
  const urlCreds = !configured && p.credentials ? p.credentials : null;
  let auth = requestedAuth || (creds ? 'auto' : 'none');
  if (auth !== 'none' && !creds) {
    warnings.push(`networkProxy.auth is ${auth}, but no login is saved and the upstream URL has no credentials, so no login is sent`);
    auth = 'none';
  }
  const t = s.timeouts && typeof s.timeouts === 'object' ? s.timeouts : {};
  const timeouts = Object.fromEntries(Object.entries(UPSTREAM_TIMEOUTS).map(([k, d]) => [k, clampMs(t[k], d)]));
  const noProxy = parseNoProxy(s.noProxy !== undefined ? s.noProxy : (env.no_proxy || env.NO_PROXY || ''));
  return { source, host: p.host, port: p.port, auth, requestedAuth, credentials: creds ? new ProxyCredentials(creds, auth) : null,
    urlCredentials: urlCreds && auth !== 'basic' ? new ProxyCredentials(urlCreds, 'auto') : null,
    login: usedLogin, noProxy, timeouts, warnings };
}

/**
 * The lockout breaker. acquire() resolves with an idempotent release(); it rejects with a 407
 * ProxyError once tripped. Unverified: 1 handshake at a time. Verified: up to maxParallel.
 * After credentials were written: accepted() on proof, rejected() on a 407, unconfirmed() on
 * an ambiguous outcome (weight 2 for close/reset/timeout/malformed, 1 for a 5xx that carries a
 * Proxy-Authenticate challenge; a plain 5xx is accepted() by the caller).
 */
export function createAuthGate({ maxParallel = MAX_PARALLEL_HANDSHAKES, tripped = '' } = {}) {
  // `tripped`: start shut, with this reason (a login the corporate proxy already rejected).
  let state = tripped ? 'tripped' : 'unverified';
  let reason = tripped || '';
  let active = 0;
  let strikes = 0;
  const waiting = [];
  const limit = () => (state === 'verified' ? maxParallel : 1);
  const trippedError = () => new ProxyError(407, reason, { needsLogin: true });
  const ticket = () => {
    let open = true;
    return () => { if (!open) return; open = false; active -= 1; pump(); };
  };
  function pump() {
    while (waiting.length && (state === 'tripped' || active < limit())) {
      const w = waiting.shift();
      if (state === 'tripped') { w.reject(trippedError()); continue; }
      active += 1;
      w.resolve(ticket());
    }
  }
  function rejected(why) {
    if (state === 'tripped') return false;
    state = 'tripped'; reason = why; pump();
    return true;
  }
  return {
    state: () => state,
    acquire() {
      if (state === 'tripped') return Promise.reject(trippedError());
      if (active < limit()) { active += 1; return Promise.resolve(ticket()); }
      return new Promise((resolve, reject) => { waiting.push({ resolve, reject }); });
    },
    accepted() { if (state === 'tripped') return; state = 'verified'; strikes = 0; pump(); },
    /** @returns {boolean} true when this call tripped it */
    rejected,
    /** An outcome that neither proves nor refutes the login. Verified: drop back to one login
     *  at a time. Unverified: add `weight` strikes and trip at MAX_UNCONFIRMED.
     *  @returns {boolean} true when this call tripped it */
    unconfirmed(why, weight = 1) {
      if (state === 'tripped') return false;
      if (state === 'verified') { state = 'unverified'; strikes = 0; return false; }
      strikes += weight;
      return strikes >= MAX_UNCONFIRMED ? rejected(why) : false;
    },
    reset() { state = 'unverified'; reason = ''; strikes = 0; pump(); },
  };
}

/** "HTTP/1.1 407 ...\r\nK: v..." (no trailing blank line) -> { status, headers: Map<lower, string[]>, persistent } or null. */
export function parseResponseHead(text) {
  const lines = String(text).split('\r\n');
  const m = /^HTTP\/1\.([01]) (\d{3})(?: .*)?$/.exec(lines[0] || '');
  if (!m) return null;
  const headers = new Map();
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    if (i <= 0) return null;
    const k = l.slice(0, i).trim().toLowerCase();
    headers.set(k, [...(headers.get(k) || []), l.slice(i + 1).trim()]);
  }
  const conn = [...(headers.get('connection') || []), ...(headers.get('proxy-connection') || [])].join(',').toLowerCase();
  const persistent = m[1] === '1' ? !/\bclose\b/.test(conn) : /\bkeep-alive\b/.test(conn);
  return { status: Number(m[2]), headers, persistent };
}

/** The schemes a 407 offers: [{ scheme: 'ntlm'|'basic'|'negotiate'|'digest', token }]. */
export function authChallenges(head) {
  const out = [];
  for (const v of head.headers.get('proxy-authenticate') || []) {
    for (const m of v.matchAll(/(?:^|,\s*)(NTLM|Negotiate|Basic|Digest)\b\s*([A-Za-z0-9+/=]*)/gi)) {
      out.push({ scheme: m[1].toLowerCase(), token: m[1].toLowerCase() === 'ntlm' ? m[2] : '' });
    }
  }
  return out;
}

/** Read one response head from `socket`; resolves { status, headers, persistent, rest } and leaves the socket paused. */
function readResponseHead(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData); socket.off('end', onEnd); socket.off('close', onEnd); socket.off('error', onErr);
      socket.pause();
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) { if (buf.length > MAX_HEAD) finish(new ProxyError(502, 'the corporate proxy sent an oversized response head')); return; }
      const head = parseResponseHead(buf.subarray(0, end).toString('latin1'));
      if (!head) { finish(new ProxyError(502, 'the corporate proxy sent a malformed response')); return; }
      finish(null, { ...head, rest: buf.subarray(end + 4) });
    };
    const onEnd = () => finish(new ProxyError(502, 'the corporate proxy closed the connection during authentication'));
    const onErr = (e) => finish(new ProxyError(502, `the corporate proxy connection failed (${e && e.code ? e.code : 'error'})`));
    const timer = setTimeout(() => finish(new ProxyError(504, 'the corporate proxy did not answer in time')), Math.max(1, timeoutMs));
    socket.on('data', onData); socket.once('end', onEnd); socket.once('close', onEnd); socket.once('error', onErr);
    socket.resume();
  });
}

/** Index just past a complete chunked body in `buf`, -1 while incomplete, -2 when malformed. */
function chunkedEnd(buf) {
  let i = 0;
  for (;;) {
    const eol = buf.indexOf('\r\n', i);
    if (eol < 0) return -1;
    const size = parseInt(buf.subarray(i, eol).toString('latin1').split(';')[0].trim(), 16);
    if (!Number.isFinite(size) || size < 0) return -2;
    if (size === 0) {
      let j = eol + 2;
      for (;;) {
        const e = buf.indexOf('\r\n', j);
        if (e < 0) return -1;
        if (e === j) return e + 2;
        j = e + 2;
      }
    }
    i = eol + 2 + size + 2;
    if (i > buf.length) return -1;
  }
}

/**
 * Consume the body of `head` (a 407) so the next head can go on the same socket. `noBody`: the
 * 407 answered a HEAD, which has no body whatever Content-Length says (RFC 9110 §9.3.2), so
 * nothing is awaited; bytes a non-compliant proxy already sent with the head are discarded,
 * since nothing legitimate can follow before the Type 3 is written.
 */
function drainBody(socket, head, timeoutMs, { noBody = false } = {}) {
  if (noBody) { socket.pause(); return Promise.resolve(Buffer.alloc(0)); }
  const chunked = (head.headers.get('transfer-encoding') || []).join(',').toLowerCase().includes('chunked');
  const length = Number((head.headers.get('content-length') || ['0'])[0]);
  if (!chunked && (!Number.isInteger(length) || length < 0 || length > MAX_407_BODY)) {
    return Promise.reject(new ProxyError(502, 'the corporate proxy sent a 407 body Worca cannot read'));
  }
  return new Promise((resolve, reject) => {
    let buf = head.rest;
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); socket.off('data', onData); socket.off('close', onClose); socket.pause();
      if (err) { reject(err); return; }
      const end = chunked ? chunkedEnd(buf) : length;
      resolve(buf.subarray(end));
    };
    const check = () => {
      if (buf.length > MAX_407_BODY + 1024) return done(new ProxyError(502, 'the corporate proxy sent an oversized 407 body'));
      const end = chunked ? chunkedEnd(buf) : (buf.length >= length ? length : -1);
      if (end === -2) return done(new ProxyError(502, 'the corporate proxy sent a malformed 407 body'));
      if (end >= 0) done(null);
    };
    const onData = (c) => { buf = Buffer.concat([buf, c]); check(); };
    const onClose = () => done(new ProxyError(502, 'the corporate proxy closed the connection during NTLM authentication'));
    const timer = setTimeout(() => done(new ProxyError(504, 'the corporate proxy did not answer in time')), Math.max(1, timeoutMs));
    socket.on('data', onData); socket.once('close', onClose);
    check();
    if (!settled) socket.resume();
  });
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.on('error', () => {});   // the owner adds its own handlers; never an unhandled 'error'
    const fail = (err) => { s.destroy(); reject(err); };
    const onTimeout = () => fail(new ProxyError(504, `the corporate proxy ${hostPort(host, port)} did not accept a connection in time`));
    const onError = (e) => fail(new ProxyError(502, `the corporate proxy ${hostPort(host, port)} is unreachable (${e && e.code ? e.code : 'error'})`));
    s.setTimeout(timeoutMs, onTimeout);
    s.once('error', onError);
    s.once('connect', () => { s.setTimeout(0); s.off('timeout', onTimeout); s.off('error', onError); resolve(s); });
  });
}

/**
 * @param {ReturnType<typeof resolveUpstream>} upstream  a resolved upstream without `error`
 * @param {{log?: (line: string) => void, now?: () => number, startTripped?: boolean,
 *   onTrip?: (t: {upstream: string, loginId: string|null}) => void, loginId?: string|null}} [opts]
 *   startTripped: the saved login is already marked rejected, so the gate starts shut. onTrip: called
 *   once when a handshake of the CURRENT login trips the gate, with that login's id (D7).
 */
export function createUpstreamConnector(upstream, { log = () => {}, now = Date.now, startTripped = false, onTrip = () => {},
  loginId = upstream.login ? upstream.login.id : null } = {}) {
  const T = upstream.timeouts;
  const urlCreds = upstream.urlCredentials || null;
  /** The login in use. A new object per swap; `gen` grows by one each time (D7). */
  let cur = { gen: 0, creds: upstream.credentials, auth: upstream.auth, loginId };
  const label = hostPort(upstream.host, upstream.port);
  const directAgent = new http.Agent({ keepAlive: false });
  const say = (l) => { try { log(l); } catch { /* a logger must not take the proxy down */ } };
  const needsLogin = `proxy needs login: the corporate proxy ${label} did not accept the credentials, so Worca stopped sending them to keep the account from being locked. Run \`worca proxy login\` (or Log in under Settings › Network proxy) with the right password; a login in HTTPS_PROXY needs a corrected URL, then restart Worca.`;
  const gate = createAuthGate({ tripped: startTripped ? needsLogin : '' });
  /** A handshake's outcome counts only for the login it started with. */
  const live = (ctx) => ctx.gen === cur.gen;
  const asProxyError = (err) => (err instanceof ProxyError ? err
    : new ProxyError(502, `the corporate proxy ${label} failed (${err && err.code ? err.code : 'error'})`));
  const loginError = () => new ProxyError(407, needsLogin, { needsLogin: true });

  /** The one log line that names the user, written once, when this call tripped the gate. */
  function tripped(ctx, scheme) {
    say(`${label} did not accept the ${scheme} login for ${ctx.creds.label}; no credentials are sent until a new login is saved (proxy needs login).`);
    try { onTrip({ upstream: label, loginId: ctx.loginId }); } catch { /* marking the file must not take the proxy down */ }
    return loginError();
  }
  // A stale ctx (an older login) never touches the gate: its outcome says nothing about the new login.
  /** A 407 to credentials: trip at once (D11). */
  const trip = (ctx, scheme) => (live(ctx) && gate.rejected(needsLogin) ? tripped(ctx, scheme) : loginError());
  /** A close, reset, timeout or malformed answer after credentials went out (D11, weight 2). */
  const strike = (ctx, scheme, err) => (live(ctx) && gate.unconfirmed(needsLogin, 2) ? tripped(ctx, scheme) : asProxyError(err));
  /**
   * Judge the status that answered credentials; returns the refusal to send, or null to go on
   * (the caller relays the answer, a 5xx included). A 5xx proves the login: the proxy went on to
   * the origin, so dead hosts never trip the breaker. Only a 5xx that ALSO carries a
   * Proxy-Authenticate challenge is ambiguous, a weight-1 strike (D11).
   */
  function judge(ctx, status, scheme, challenged) {
    if (status === 407) return trip(ctx, scheme);
    if (status >= 500 && challenged) return live(ctx) && gate.unconfirmed(needsLogin, 1) ? tripped(ctx, scheme) : null;
    if (live(ctx)) gate.accepted();
    return null;
  }

  async function roundTrip(socket, lines, deadline) {
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    return readResponseHead(socket, deadline - now());
  }

  /** The round trip that carries credentials: every outcome is judged before the gate is released. */
  async function sendCredentials(ctx, socket, lines, deadline, scheme) {
    let h;
    try { h = await roundTrip(socket, lines, deadline); } catch (err) { throw strike(ctx, scheme, err); }
    const refusal = judge(ctx, h.status, scheme, h.headers.has('proxy-authenticate'));
    if (refusal) throw refusal;
    return h;
  }

  async function basicStep(ctx, socket, buildHead, deadline, finalByCaller) {
    const authz = `Basic ${ctx.creds.basicToken}`;
    if (finalByCaller) return { socket, proxyAuthorization: authz, scheme: 'Basic' };
    return { socket, head: await sendCredentials(ctx, socket, buildHead(authz), deadline, 'Basic') };
  }

  /**
   * Log in on ONE socket. `buildHead(authz|null)` returns the request head lines. With
   * finalByCaller (plain HTTP, whose probe is a HEAD) it stops before the last step and returns
   * the Proxy-Authorization the caller sends with the real request; otherwise it returns the
   * final response head. auto and ntlm both mean NTLMv2 only: never a Basic fallback (D8).
   */
  async function authenticate(ctx, socket, buildHead, deadline, { finalByCaller }) {
    if (ctx.auth === 'none') return { socket, head: await roundTrip(socket, buildHead(null), deadline) };
    if (ctx.auth === 'basic') return basicStep(ctx, socket, buildHead, deadline, finalByCaller);
    const h1 = await roundTrip(socket, buildHead(`NTLM ${type1Message().toString('base64')}`), deadline);
    if (h1.status !== 407) return { socket, head: h1, unchallenged: true };
    const offered = authChallenges(h1);
    const ntlm = offered.find((c) => c.scheme === 'ntlm' && c.token);
    if (!ntlm) {
      if (offered.some((c) => c.scheme === 'basic')) {
        throw new ProxyError(502, `the corporate proxy ${label} offers only Basic. Worca sends Basic only when networkProxy.auth is "basic", because the password then crosses the network in cleartext`);
      }
      throw new ProxyError(502, `the corporate proxy ${label} does not offer NTLM (it offers ${offered.map((c) => c.scheme).join(', ') || 'no scheme'})`);
    }
    if (!h1.persistent) throw new ProxyError(502, `the corporate proxy ${label} closed the connection during NTLM authentication`);
    const left = await drainBody(socket, h1, deadline - now(), { noBody: finalByCaller });
    if (left.length) socket.unshift(left);
    let t3;
    try {
      t3 = type3Message({ ntHash: ctx.creds.ntHash, user: ctx.creds.user, domain: ctx.creds.domain, type2: parseType2(ntlm.token), now: now() });
    } catch (err) {
      if (err instanceof NtlmError) throw new ProxyError(502, `the corporate proxy ${label} sent a malformed NTLM challenge`);
      throw err;
    }
    const authz = `NTLM ${t3.toString('base64')}`;
    if (finalByCaller) return { socket, proxyAuthorization: authz, scheme: 'NTLM' };
    return { socket, head: await sendCredentials(ctx, socket, buildHead(authz), deadline, 'NTLM') };
  }

  /** Capture the login for one request (D7); the gate is skipped for auth none. */
  async function acquire() {
    const ctx = cur;
    const release = ctx.auth === 'none' ? () => {} : await gate.acquire();
    return { ctx, release };
  }

  /** CONNECT host:port through the upstream; resolves { socket, rest } once the upstream said 2xx. */
  async function tunnel({ host, port }) {
    const { ctx, release } = await acquire();
    let socket = null;
    try {
      socket = await connectTcp(upstream.host, upstream.port, T.connectMs);
      const target = hostPort(host, port);
      const buildHead = (authz) => [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`, 'Proxy-Connection: Keep-Alive',
        ...(authz ? [`Proxy-Authorization: ${authz}`] : [])];
      const r = await authenticate(ctx, socket, buildHead, now() + T.authMs, { finalByCaller: false });
      socket = r.socket;
      const { status } = r.head;
      if (status === 407) throw new ProxyError(407, `proxy needs login: the corporate proxy ${label} asks for a login and none is configured.`, { needsLogin: true });
      if (status < 200 || status > 299) throw new ProxyError(status >= 400 && status <= 599 ? status : 502, `the corporate proxy ${label} answered ${status} for ${target}`);
      return { socket, rest: r.head.rest };
    } catch (err) {
      socket?.destroy();
      throw asProxyError(err);
    } finally {
      release();   // after every judge()/strike(): a waiter never runs on a stale gate state
    }
  }

  function replyError(res, err) {
    const e = asProxyError(err);
    const body = `Worca: ${e.message}\n`;
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(e.status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body),
      ...(e.needsLogin ? { 'x-worca-proxy': 'needs-login' } : {}) }).end(body);
  }

  /**
   * Send `up` (a request that may carry credentials as `scheme`) and relay its answer to `res`.
   * Once the head with the credentials went out, the outcome is judged even when the client
   * leaves: a 407 nobody waits for still trips the gate, or the next waiter would send the same
   * credentials again (D11). Every way `up` can end (response, upgrade, error, close) settles.
   */
  function relay(req, res, up, { ctx, scheme, release }) {
    let settled = false;
    let clientGone = false;
    let credentialsOut = false;   // the head carrying `scheme` was written before the client left
    // The outcome is judged BEFORE release, so no waiter slips through on a stale gate.
    const settle = (fn) => { if (settled) return; settled = true; fn?.(); release(); };
    const reply = (err) => { if (!clientGone) replyError(res, err); };
    up.on('timeout', () => up.destroy(new ProxyError(504, `the corporate proxy ${label} did not answer in time`)));
    up.on('error', (err) => {
      let e = err;
      settle(() => { if (scheme && (!clientGone || credentialsOut)) e = strike(ctx, scheme, err); });
      reply(e);
    });
    up.on('response', (ur) => {
      let refusal = null;
      settle(() => { if (scheme) refusal = judge(ctx, ur.statusCode, scheme, ur.headers['proxy-authenticate'] !== undefined); });
      if (clientGone) { ur.resume(); up.destroy(); return; }
      if (refusal) { ur.resume(); replyError(res, refusal); return; }
      up.setTimeout(T.idleMs);
      ur.on('error', () => res.destroy());
      try { res.writeHead(ur.statusCode, ur.headers); } catch { res.destroy(); up.destroy(); return; }
      ur.pipe(res);
    });
    // The upgrade headers are never forwarded, so a 101 is a proxy fault. It still answered the
    // credentials with something other than a 407, which proves them.
    up.on('upgrade', (ur, socket) => {
      socket.destroy();
      settle(() => { if (scheme) judge(ctx, ur.statusCode, scheme, false); });
      reply(new ProxyError(502, `the corporate proxy ${label} answered ${ur.statusCode} Switching Protocols, which Worca does not relay`));
    });
    up.on('close', () => {
      if (settled) return;
      let e = new ProxyError(502, `the corporate proxy ${label} closed the connection without an answer`);
      settle(() => { if (scheme && (!clientGone || credentialsOut)) e = strike(ctx, scheme, e); });
      reply(e);
    });
    res.on('close', () => {
      if (res.writableFinished) return;
      clientGone = true;
      if (settled || !scheme || !up.headersSent) { up.destroy(); return; }
      // Credentials are out: stop the body, wait (bounded) for the verdict, then drop `up`.
      credentialsOut = true;
      req.unpipe(up);
      up.setTimeout(T.authMs);
    });
    req.pipe(up);
  }

  /** Request headers that belong to this hop only (RFC 9110 §7.6.1), plus any named in Connection. */
  function endToEndHeaders(reqHeaders) {
    const headers = { ...reqHeaders };
    const named = String(headers.connection || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    for (const h of ['proxy-authorization', 'proxy-connection', 'connection', 'upgrade', 'keep-alive', 'te', 'trailer', ...named]) {
      delete headers[h];
    }
    return headers;
  }

  /** A plain (absolute-form) HTTP request through the upstream. */
  function forward(req, res, { url }) {
    const headers = endToEndHeaders(req.headers);
    const path = url.href;
    const base = { host: upstream.host, port: upstream.port, method: req.method, path, timeout: T.connectMs };
    (async () => {
      let release = () => {};
      let socket = null;
      try {
        const got = await acquire();
        const { ctx } = got;
        release = got.release;
        if (ctx.auth === 'none') {
          relay(req, res, http.request({ ...base, agent: directAgent, headers }), { ctx, scheme: null, release });
          return;
        }
        // Connect before any credentials exist on the wire: an unreachable proxy is a 502/504,
        // never a strike against the login.
        socket = await connectTcp(upstream.host, upstream.port, T.connectMs);
        let r;
        if (ctx.auth === 'basic') {
          r = await basicStep(ctx, socket, null, 0, true);
        } else {
          const buildHead = (authz) => [`HEAD ${path} HTTP/1.1`, `Host: ${url.host}`, 'Proxy-Connection: Keep-Alive', 'Content-Length: 0',
            ...(authz ? [`Proxy-Authorization: ${authz}`] : [])];
          r = await authenticate(ctx, socket, buildHead, now() + T.authMs, { finalByCaller: true });
          socket = r.socket;
          if (r.unchallenged) { socket.destroy(); socket = null; }
        }
        if (res.destroyed) { socket?.destroy(); release(); return; }   // the client left during the handshake
        const own = socket;
        // Never add `agent` (or agent: false) next to createConnection: Node then ignores
        // createConnection and the request leaves on a new, unauthenticated socket. Without an
        // agent Node sends Connection: close, so the authenticated socket ends with the response.
        const opts = own ? { createConnection: () => own } : { agent: directAgent };
        const authz = r.proxyAuthorization ? { 'proxy-authorization': r.proxyAuthorization } : {};
        const up = http.request({ ...base, ...opts, headers: { ...headers, ...authz } });
        // readResponseHead/drainBody left `own` paused; a paused socket handed to http.request
        // never delivers the response. 'socket' fires after Node's parser is attached.
        if (own) up.once('socket', (s) => s.resume());
        relay(req, res, up, { ctx, scheme: r.scheme || null, release });
      } catch (err) {
        socket?.destroy();
        release();
        replyError(res, err);
      }
    })();
  }

  return {
    directAgent,
    route: (host) => (goesDirect(host, upstream.noProxy) ? 'direct' : 'upstream'),
    tunnel,
    forward,
    status: () => ({ upstream: label, auth: cur.auth, source: upstream.source, login: cur.creds ? cur.creds.label : null,
      loginId: cur.loginId, state: cur.auth === 'none' ? 'none' : gate.state() }),
    reset: () => gate.reset(),
    /**
     * Swap in a saved login (D8). `next` null = logged out: fall back to the URL login, else send
     * nothing. `rejected`: that login is already marked rejected, so the gate stays shut. Basic
     * keeps the URL's password and never swaps. @returns {boolean} true when the login changed
     */
    useLogin(next, { id = null, rejected = false } = {}) {
      // Basic keeps the URL's password; an explicit `auth: none` sends nothing, ever (D23).
      if (upstream.auth === 'basic' || upstream.requestedAuth === 'basic' || upstream.requestedAuth === 'none') return false;
      const creds = next || urlCreds;
      // The mode to restore: what the user set (ntlm stays ntlm), else auto. Never the boot's
      // derived 'none' (that only meant "no login yet").
      const auth = creds ? (upstream.requestedAuth || 'auto') : 'none';
      cur = { gen: cur.gen + 1, creds, auth, loginId: next ? id : null };
      gate.reset();
      if (creds && rejected) gate.rejected(needsLogin);
      return true;
    },
    close: () => directAgent.destroy(),
  };
}

/** The hosts the Test button and `worca proxy test` CONNECT to. */
export const TEST_HOSTS = Object.freeze(['github.com', 'api.anthropic.com']);

/**
 * CONNECT host:443 through the upstream for each host, one after another on ONE connector, so a
 * wrong login costs one Type 3 (the next host gets the local 407). A noProxy host is reported
 * as direct and not contacted.
 * @returns {Promise<{ok: boolean, upstream: object, results: Array<{host: string, ok: boolean, via: 'upstream'|'direct', ms: number, status?: number, needsLogin?: boolean, error?: string}>}>}
 */
export async function checkUpstream(upstream, { hosts = TEST_HOSTS, port = 443, log = () => {}, now = Date.now,
  startTripped = false, onTrip = () => {} } = {}) {
  const connector = createUpstreamConnector(upstream, { log, now, startTripped, onTrip });
  const results = [];
  try {
    for (const host of hosts) {
      const t0 = Date.now();
      if (connector.route(host) === 'direct') {
        results.push({ host, ok: true, via: 'direct', ms: 0, error: 'goes direct (NO_PROXY), not tested' });
        continue;
      }
      try {
        const { socket } = await connector.tunnel({ host, port });
        socket.destroy();
        results.push({ host, ok: true, via: 'upstream', ms: Date.now() - t0 });
      } catch (err) {
        results.push({ host, ok: false, via: 'upstream', ms: Date.now() - t0, status: err.status || 502,
          needsLogin: !!err.needsLogin, error: err.message });
      }
    }
    return { ok: results.every((r) => r.ok), upstream: connector.status(), results };
  } finally {
    connector.close();
  }
}
