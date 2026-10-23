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
import { parseChallenges, pickDigest, digestHa1, digestAuthorization, isStaleDigest, DigestError } from './http-digest.mjs';

export const UPSTREAM_TIMEOUTS = Object.freeze({ connectMs: 30_000, authMs: 15_000, idleMs: 10 * 60_000 });
export const AUTH_MODES = Object.freeze(['auto', 'none', 'basic', 'ntlm', 'digest']);
export const AUTH_LABELS = Object.freeze({ auto: 'NTLMv2', none: 'no login', basic: 'Basic, cleartext', ntlm: 'NTLMv2', digest: 'Digest' });
/** Modes that need the password itself; a saved login keeps only the NT hash, so they never use one (D8). */
export const PASSWORD_MODES = Object.freeze(['basic', 'digest']);
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
 *  password, so never built otherwise), the password only for an explicit auth 'digest' (never
 *  handed out). Otherwise the password string goes out of scope after construction. Never printable. */
export class ProxyCredentials {
  #ntHash; #basic; #digest;
  /** `ntHash` (a 16-byte Buffer) is a saved login (src/core/proxy-credentials.mjs): NTLMv2 only. */
  constructor({ domain = '', user, password, raw, ntHash: hash = null }, auth) {
    this.domain = String(domain);
    this.user = String(user);
    this.saved = hash !== null;
    this.#ntHash = PASSWORD_MODES.includes(auth) ? null : (hash ? Buffer.from(hash) : ntHash(password));
    this.#basic = auth === 'basic' && !hash ? Buffer.from(`${raw ?? user}:${password}`, 'utf8').toString('base64') : null;
    // Digest needs the password per challenge (HA1 = H(user:realm:password)); kept only in this explicit mode,
    // and never handed out: callers get the user name and HA1 only (D8a).
    this.#digest = auth === 'digest' && !hash ? Object.freeze({ user: String(raw ?? user), password: String(password) }) : null;
  }
  /** The Digest user name as the URL gave it (DOMAIN\user), or null outside auth digest. */
  get digestUser() { return this.#digest ? this.#digest.user : null; }
  /** The base HA1 for `realm` (D8a); throws outside auth digest. */
  digestHa1(realm, algorithm) {
    if (!this.#digest) throw new Error('no Digest login');
    return digestHa1({ username: this.#digest.user, realm, password: this.#digest.password, algorithm });
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
  } else if (saved && !PASSWORD_MODES.includes(s.auth)) {
    if (creds) warnings.push('a login is saved (worca proxy login), so the user name and password in the proxy URL are not used');
    creds = { domain: saved.domain, user: saved.user, ntHash: saved.ntHash };
    usedLogin = { id: saved.id, label: saved.domain ? `${saved.domain}\\${saved.user}` : saved.user, savedAt: saved.savedAt, rejected: saved.rejected || null };
  } else if (saved && !creds) {
    warnings.push(`networkProxy.auth is ${s.auth}, but the saved login keeps only an NT hash, which ${s.auth === 'digest' ? 'Digest' : 'Basic'} cannot use; put the login in the HTTP(S)_PROXY URL or set auth to auto`);
  }
  if (login && login.error) warnings.push(`the saved login cannot be used (${login.error})`);
  // The URL login stays the fallback a logout returns to (D6); Basic and Digest never swap logins.
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
    urlCredentials: urlCreds && !PASSWORD_MODES.includes(auth) ? new ProxyCredentials(urlCreds, 'auto') : null,
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

/** The schemes a 407 offers: [{ scheme, token, params }] (http-digest.mjs parser). */
export function authChallenges(head) {
  return parseChallenges(head.headers.get('proxy-authenticate') || []);
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

const NO_REUSE = Symbol('worca.noReuse');

/**
 * The keep-alive pool of ONE login generation (D1-D3). Node reuses free sockets; a new one is logged in
 * here, with a HEAD probe whose Type 3 answer is judged by sendCredentials before the socket is handed over.
 */
class AuthPool extends http.Agent {
  #handshake; #retired = false;
  constructor(handshake, idleMs) {
    super({ keepAlive: true, maxFreeSockets: 8, timeout: idleMs, scheduling: 'lifo' });
    this.#handshake = handshake;
  }
  createConnection(options, cb) {
    this.#handshake(options).then((s) => cb(null, s), (err) => cb(err));
  }
  keepSocketAlive(socket) {
    if (this.#retired || socket[NO_REUSE]) return false;
    return super.keepSocketAlive(socket);
  }
  /** No new reuse; free sockets closed now, busy ones when their response ends. */
  retire() {
    this.#retired = true;
    for (const list of Object.values(this.freeSockets)) for (const s of [...list]) s.destroy();
  }
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
  /** D3: the login was swapped while a request was on its way; never answer for the old one. */
  const loginChanged = () => new ProxyError(502, `the corporate proxy login changed while this request was on its way; send the request again`);
  /** The scheme that carries NTLM tokens on this upstream: 'NTLM' until a proxy offers only Negotiate (D7). */
  let ntlmScheme = 'NTLM';
  /** False once an authenticated answer came with Connection: close (D5): plain HTTP then logs in per request. */
  let pooling = true;
  /** The pool of a LIVE generation (D3): a retired ctx never gets a new pool, so it never logs in again. */
  function poolOf(ctx) {
    if (!live(ctx)) throw loginChanged();
    return (ctx.pool ||= new AuthPool((options) => handshakeSocket(ctx, options), T.idleMs));
  }
  const retirePool = (ctx) => { ctx.pool?.retire(); ctx.pool = null; };
  /** D4/D5: the upstream does not keep connection logins; plain HTTP goes back to the slice-1 path. */
  function stopPooling(why) {
    if (!pooling) return;
    pooling = false;
    retirePool(cur);
    say(`${label} ${why}, so plain HTTP logs in per request from now on.`);
  }

  /** The one log line that names the user, written once, when this call tripped the gate. */
  function tripped(ctx, scheme) {
    const kerberos = scheme === 'Negotiate' ? ' If the corporate proxy accepts only Kerberos, Worca cannot log in to it (Kerberos is not supported).' : '';
    say(`${label} did not accept the ${scheme} login for ${ctx.creds.label}; no credentials are sent until a new login is saved (proxy needs login).${kerberos}`);
    try { onTrip({ upstream: label, loginId: ctx.loginId }); } catch { /* marking the file must not take the proxy down */ }
    retirePool(ctx);
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
   * Proxy-Authenticate challenge is ambiguous, a weight-1 strike (D11). `challenges`: the
   * Proxy-Authenticate values of the answer. A Digest 407 that says stale=true says nothing about the
   * password (RFC 7616 §3.3): a weight-1 strike, never a trip from a fresh or verified gate (D10).
   */
  function judge(ctx, status, scheme, challenges) {
    const challenged = challenges !== undefined && [].concat(challenges).length > 0;
    if (status === 407 && scheme === 'Digest' && isStaleDigest(challenges)) {
      return live(ctx) && gate.unconfirmed(needsLogin, 1) ? tripped(ctx, scheme)
        : new ProxyError(502, `the corporate proxy ${label} says the Digest nonce went stale; send the request again`);
    }
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
    const refusal = judge(ctx, h.status, scheme, h.headers.get('proxy-authenticate'));
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
   * final response head. auto and ntlm both mean NTLMv2 only: never a Basic or Digest fallback
   * (D8). NTLM tokens go inside Negotiate when the proxy offers only that (D7). `headProbe`: the
   * probe is a HEAD, so a 407 to it has no body. `final`: { method, uri } of the request the
   * credentials are for (Digest hashes them).
   */
  async function authenticate(ctx, socket, buildHead, deadline, { finalByCaller, headProbe = finalByCaller, final }) {
    if (ctx.auth === 'none') return { socket, head: await roundTrip(socket, buildHead(null), deadline) };
    if (ctx.auth === 'basic') return basicStep(ctx, socket, buildHead, deadline, finalByCaller);
    if (ctx.auth === 'digest') return digestStep(ctx, socket, buildHead, deadline, { finalByCaller, headProbe, final });
    const t1 = type1Message().toString('base64');
    let scheme = ntlmScheme;
    let h1 = await roundTrip(socket, buildHead(`${scheme} ${t1}`), deadline);
    if (h1.status !== 407) return { socket, head: h1, unchallenged: true };
    let offered = authChallenges(h1);
    let tok = offered.find((c) => c.scheme === scheme.toLowerCase() && c.token);
    const alt = scheme === 'NTLM' ? 'Negotiate' : 'NTLM';
    if (!tok && offered.some((c) => c.scheme === alt.toLowerCase())) {
      // Only the other wrapper is offered: the same Type 1 again under it, on the same socket.
      if (!h1.persistent) throw new ProxyError(502, `the corporate proxy ${label} closed the connection during NTLM authentication`);
      const left0 = await drainBody(socket, h1, deadline - now(), { noBody: headProbe });
      if (left0.length) socket.unshift(left0);
      scheme = alt;
      h1 = await roundTrip(socket, buildHead(`${scheme} ${t1}`), deadline);
      if (h1.status !== 407) return { socket, head: h1, unchallenged: true };
      offered = authChallenges(h1);
      tok = offered.find((c) => c.scheme === scheme.toLowerCase() && c.token);
    }
    if (!tok) {
      if (offered.some((c) => c.scheme === 'basic')) {
        throw new ProxyError(502, `the corporate proxy ${label} offers only Basic. Worca sends Basic only when networkProxy.auth is "basic", because the password then crosses the network in cleartext`);
      }
      if (offered.some((c) => c.scheme === 'digest')) {
        throw new ProxyError(502, `the corporate proxy ${label} offers only Digest. Worca sends Digest only when networkProxy.auth is "digest" (the password from HTTPS_PROXY is then kept in memory; a saved login cannot be used)`);
      }
      throw new ProxyError(502, `the corporate proxy ${label} does not offer NTLM or Negotiate (it offers ${offered.map((c) => c.scheme).join(', ') || 'no scheme'})`);
    }
    ntlmScheme = scheme;
    if (!h1.persistent) throw new ProxyError(502, `the corporate proxy ${label} closed the connection during NTLM authentication`);
    const left = await drainBody(socket, h1, deadline - now(), { noBody: headProbe });
    if (left.length) socket.unshift(left);
    if (!live(ctx)) throw loginChanged();   // D3: swapped during the Type 1 round trip; never send the old login's Type 3
    let t3;
    try {
      t3 = type3Message({ ntHash: ctx.creds.ntHash, user: ctx.creds.user, domain: ctx.creds.domain, type2: parseType2(tok.token), now: now() });
    } catch (err) {
      if (err instanceof NtlmError) throw new ProxyError(502, `the corporate proxy ${label} sent a malformed NTLM challenge`);
      throw err;
    }
    const authz = `${scheme} ${t3.toString('base64')}`;
    if (finalByCaller) return { socket, proxyAuthorization: authz, scheme };
    return { socket, head: await sendCredentials(ctx, socket, buildHead(authz), deadline, scheme) };
  }

  /** Digest (D8/D9): challenge on the probe, answer computed for the request the credentials go with. */
  async function digestStep(ctx, socket, buildHead, deadline, { finalByCaller, headProbe, final }) {
    let s = socket;
    const h1 = await roundTrip(s, buildHead(null), deadline);
    if (h1.status !== 407) return { socket: s, head: h1, unchallenged: true };
    const offered = authChallenges(h1);
    const ch = pickDigest(offered);
    if (!ch) throw new ProxyError(502, `the corporate proxy ${label} offers no Digest login Worca supports (SHA-256 or MD5 with qop auth); it offers ${offered.map((c) => c.scheme).join(', ') || 'no scheme'}`);
    if (h1.persistent) {
      const left = await drainBody(s, h1, deadline - now(), { noBody: headProbe });
      if (left.length) s.unshift(left);
    } else {
      // Digest logs in a request, not a connection: a closed 407 just means a new socket.
      s.destroy();
      s = await connectTcp(upstream.host, upstream.port, T.connectMs);
    }
    if (!live(ctx)) throw loginChanged();   // D3, as in authenticate()
    const creds = ctx.creds;
    let authz;
    try {
      authz = digestAuthorization({ challenge: ch, username: creds.digestUser, ha1: (realm, alg) => creds.digestHa1(realm, alg),
        method: final.method, uri: final.uri });
    } catch (err) {
      if (err instanceof DigestError) throw new ProxyError(502, `the corporate proxy ${label} sent a Digest challenge Worca cannot answer (${err.message})`);
      throw err;
    }
    if (finalByCaller) return { socket: s, proxyAuthorization: authz, scheme: 'Digest' };
    return { socket: s, head: await sendCredentials(ctx, s, buildHead(authz), deadline, 'Digest') };
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
      const r = await authenticate(ctx, socket, buildHead, now() + T.authMs, { finalByCaller: false, final: { method: 'CONNECT', uri: target } });
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

  /**
   * A socket logged in as `ctx` for the pool: HEAD probe, Type 3 on the second HEAD, judged here (D1).
   * Node passes the request options through to createConnection (but sets `path` to null, it means a
   * socket path there), so `probeUrl` is the URL of the request that made the pool open a socket. The
   * probe is a real HEAD to that URL (as in slice 1), and the socket may then carry a different queued
   * request of the same pool.
   */
  async function handshakeSocket(ctx, { probeUrl }) {
    const release = await gate.acquire();   // rejects 407 "proxy needs login" once tripped
    let socket = null;
    try {
      if (!live(ctx)) throw loginChanged();   // D3: the login was swapped while this waited for the gate
      socket = await connectTcp(upstream.host, upstream.port, T.connectMs);
      const target = new URL(probeUrl);
      const buildHead = (authz) => [`HEAD ${target.href} HTTP/1.1`, `Host: ${target.host}`, 'Proxy-Connection: Keep-Alive',
        ...(authz ? [`Proxy-Authorization: ${authz}`] : [])];
      const r = await authenticate(ctx, socket, buildHead, now() + T.authMs, { finalByCaller: false, headProbe: true });
      socket = r.socket;
      const h = r.head;
      if (h.status === 407) throw new ProxyError(407, `proxy needs login: the corporate proxy ${label} asks for a login and none is configured.`, { needsLogin: true });
      if (!h.persistent) {
        stopPooling('closes the connection after a login');
        throw new ProxyError(502, `the corporate proxy ${label} does not keep logged-in connections open; Worca logs in per request from now on. Send the request again.`);
      }
      if (!live(ctx)) throw loginChanged();   // D3: swapped during the handshake; never hand this socket over
      // An ambiguous verdict (5xx with a challenge) or stray HEAD body bytes: use the socket once, never pool it.
      if (h.rest.length || (h.status >= 500 && h.headers.has('proxy-authenticate'))) socket[NO_REUSE] = true;
      return socket;
    } catch (err) {
      socket?.destroy();
      throw asProxyError(err);
    } finally {
      release();
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
   * `onReauth` (pooled requests): a 407 is a forgotten connection login, handed to it instead of
   * judged; it returns true when it answered the client itself. `body`: pipe the client body.
   */
  function relay(req, res, up, { ctx, scheme, release, onReauth = null, body = true }) {
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
      if (onReauth && ur.statusCode === 407) {
        ur.resume();
        up.destroy();   // the forgotten socket never goes back to the pool
        settle();
        if (clientGone) return;
        if (!onReauth()) replyError(res, reauthAgain());
        return;
      }
      let refusal = null;
      settle(() => { if (scheme) refusal = judge(ctx, ur.statusCode, scheme, ur.headers['proxy-authenticate']); });
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
      settle(() => { if (scheme) judge(ctx, ur.statusCode, scheme); });
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
    if (body) req.pipe(up); else up.end();
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

  const bodiless = (req) => !req.headers['transfer-encoding'] && Number(req.headers['content-length'] || 0) === 0;

  const reauthAgain = () => new ProxyError(502, `the corporate proxy ${label} asked for a login again on a kept-alive connection; send the request again`);

  /**
   * A plain request on the pool (NTLM/Negotiate). No credentials ride it, so its answer is never judged.
   * `retry`: a bodiless request may be sent once more after a forgotten login. `retried`: this IS that retry.
   */
  function sendPooled(req, res, { url, headers, ctx, retry, retried = false }) {
    let pool;
    try { pool = poolOf(ctx); } catch (err) { replyError(res, err); return; }
    const up = http.request({ host: upstream.host, port: upstream.port, method: req.method, path: url.href,
      probeUrl: url.href, timeout: T.connectMs, agent: pool, headers: { ...headers, 'proxy-connection': 'keep-alive' } });
    up.once('socket', (s) => s.resume());   // a logged-in socket comes back paused (readResponseHead)
    relay(req, res, up, { ctx, scheme: null, release: () => {}, body: !bodiless(req),
      onReauth: () => {
        // D4: the upstream forgot this connection's login. Nothing was refused, so no strike.
        if (ctx.pool === pool) retirePool(ctx);
        if (!live(ctx)) { replyError(res, loginChanged()); return true; }   // D3: never retry as the old login
        // D4 cap: the retry's socket was logged in a moment ago and was forgotten at once.
        if (retried) { stopPooling('asks for a login again on every kept-alive connection'); return false; }
        if (!retry) return false;
        sendPooled(req, res, { url, headers, ctx, retry: false, retried: true });
        return true;
      } });
  }

  /** A plain (absolute-form) HTTP request through the upstream (D1, D6). */
  function forward(req, res, { url }) {
    const headers = endToEndHeaders(req.headers);
    const ctx = cur;
    if (!pooling || ctx.auth === 'none' || PASSWORD_MODES.includes(ctx.auth)) { forwardOnce(req, res, { url, headers }); return; }
    if (gate.state() === 'tripped') { replyError(res, loginError()); return; }
    sendPooled(req, res, { url, headers, ctx, retry: bodiless(req) });
  }

  /** A plain request with its own login (the slice-1 path): Basic, Digest, auth none, or pooling off. */
  function forwardOnce(req, res, { url, headers }) {
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
          r = await authenticate(ctx, socket, buildHead, now() + T.authMs, { finalByCaller: true, final: { method: req.method, uri: path } });
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
      // Basic and Digest keep the URL's password; an explicit `auth: none` sends nothing, ever (D23).
      if (PASSWORD_MODES.includes(upstream.auth) || PASSWORD_MODES.includes(upstream.requestedAuth) || upstream.requestedAuth === 'none') return false;
      const creds = next || urlCreds;
      // The mode to restore: what the user set (ntlm stays ntlm), else auto. Never the boot's
      // derived 'none' (that only meant "no login yet").
      const auth = creds ? (upstream.requestedAuth || 'auto') : 'none';
      retirePool(cur);   // D3: no request rides a socket logged in as the previous login
      cur = { gen: cur.gen + 1, creds, auth, loginId: next ? id : null };
      gate.reset();
      if (creds && rejected) gate.rejected(needsLogin);
      return true;
    },
    close: () => { cur.pool?.destroy(); directAgent.destroy(); },
  };
}

/** networkProxy.fixedPort when valid (1024-65535), else 0 (a free port). */
export function fixedPortOf(networkProxy) {
  const p = networkProxy && typeof networkProxy === 'object' ? networkProxy.fixedPort : undefined;
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 0;
}
export const localProxyUrl = (port) => `http://127.0.0.1:${port}`;

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
