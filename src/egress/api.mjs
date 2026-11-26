// src/egress/api.mjs — the egress sidecar's internal API (docs/network-proxy.md, "Worca in a container"). Its own
// port, never published: Worca's box reaches it on the compose network with the shared secret
// (Authorization: Bearer <WORCA_EGRESS_SECRET>, compared in constant time, as the broker's /internal API is).
//
//   GET  /healthz       no secret; "ok"
//   GET  /v1/status     the proxy, the login (domain and user, never the hash) and its state
//   POST /v1/test       {networkProxy?, login?}: CONNECT to the test hosts. `login` {domain, user, password} is a typed
//                       login held in memory for this one test. The saved login goes only to the proxy it was saved for.
//   POST /v1/login      {domain?, user, password} or {domain?, user, ntHash}: save the login, bound to the current proxy
//   POST /v1/logout     delete the saved login
//   GET  /v1/settings   {networkProxy}
//   PUT  /v1/settings   {networkProxy: patch}: the settings.json networkProxy rules; a new host or port deletes the login
// Managed mode (WORCA_EGRESS_LOGIN_FILE): login, logout, settings and a test with anything but the operator's login
// answer 409 MANAGED. No call ever returns the NT hash or a password.
import http from 'node:http';
import { safeEqual } from '../broker/tokens.mjs';
import { proxyState, saveProxyLoginPlain, saveProxyLoginHash, clearProxyLoginPlain, parseAccount, savedLoginRefusal,
  assertProxyLoginInput, markLoginRejected, ProxyLoginError } from '../core/proxy-credentials.mjs';
import { ntHash } from '../core/ntlm.mjs';
import { resolveUpstream, checkUpstream } from '../core/upstream-proxy.mjs';
import { previewSidecarSettings, writeSidecarSettings, upstreamLabelOf } from './store.mjs';

const MAX_BODY = 16 * 1024;
export const MANAGED_TEXT = 'The corporate proxy login on this instance is managed by the operator (WORCA_EGRESS_LOGIN_FILE): it cannot be changed here.';
const LOGIN_KEYS = new Set(['domain', 'user', 'password', 'ntHash']);
const TEST_KEYS = new Set(['networkProxy', 'login']);

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { reject(Object.assign(new Error('send the body as application/json'), { status: 415 })); return; }
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('the body is too large'), { status: 413 })); req.destroy(); return; } parts.push(c); });
    req.on('end', () => {
      let v;
      try { v = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { reject(Object.assign(new Error('the body is not valid JSON'), { status: 400 })); return; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) { reject(Object.assign(new Error('the body must be a JSON object'), { status: 400 })); return; }
      resolve(v);
    });
    req.on('error', reject);
  });
}

const unknownKey = (body, allowed) => Object.keys(body).find((k) => !allowed.has(k));

/**
 * @param {{secret: string, dataDir: string|null, env: object, managed: boolean, settings: () => object,
 *   logins: ReturnType<import('./store.mjs').createLoginSource>, rebuild: (o?: object) => boolean, live: () => object|null,
 *   upstreamError: () => string|null, warnings: () => string[], policy: () => object, now?: () => number, check?: Function}} o
 */
export function createSidecarApi({ secret, dataDir, env, managed, settings, logins, rebuild, live, upstreamError, warnings, policy,
  now = Date.now, check = checkUpstream }) {
  let testRunning = false;
  // The login is written through proxy-credentials with this env: never the box's refusal (the sidecar is no box).
  const writeEnv = { ...process.env, WORCA_EGRESS_API_URL: '' };
  const home = dataDir;

  function status() {
    const np = settings();
    const login = logins.current(np);
    const c = live();
    const st = proxyState({ env, networkProxy: np, login, live: c ? c.status() : null, enabled: np.enabled !== false, localUrl: null });
    return { ...st, warnings: [...(st.warnings || []), ...warnings().filter((w) => !(st.warnings || []).includes(w))],
      managed, managedBy: managed ? 'operator' : null, settings: np, policy: policy(), upstreamError: upstreamError(),
      loginBoundTo: login && !login.error && login.upstream ? login.upstream : null, apiVersion: 1 };
  }

  async function test(body) {
    const bad = unknownKey(body, TEST_KEYS);
    if (bad) return [400, { error: `unknown field: ${bad}`, field: bad }];
    if (managed && (body.login !== undefined || body.networkProxy !== undefined)) return [409, { error: MANAGED_TEXT, code: 'MANAGED' }];
    if (testRunning) return [409, { error: 'a proxy test is already running', code: 'TEST_RUNNING' }];
    const current = settings();
    let np = current;
    if (body.networkProxy !== undefined) {
      try { np = previewSidecarSettings(current, body.networkProxy); } catch (err) { return [400, { error: err.message, field: 'networkProxy' }]; }
    }
    let typed = null;
    if (body.login !== undefined) {
      const refusal = savedLoginRefusal(np && np.auth);
      if (refusal) return [400, { error: refusal, field: 'login', code: 'BASIC_NO_SAVED_LOGIN' }];
      try {
        const l = body.login && typeof body.login === 'object' ? body.login : {};
        const account = assertProxyLoginInput({ ...(l.domain ? { domain: l.domain, user: l.user } : parseAccount(l.user)), password: l.password });
        typed = { id: '', ...account, ntHash: ntHash(l.password), savedAt: '', rejected: null };
      } catch (err) {
        if (!(err instanceof ProxyLoginError)) throw err;
        return [400, { error: err.message, field: `login.${err.field}` }];
      }
    }
    // Bound to its proxy: the saved login goes to the host:port it was saved for, never to a candidate.
    const saved = logins.current(current);
    const sameProxy = upstreamLabelOf(env, np) === upstreamLabelOf(env, current);
    const login = typed || (sameProxy && saved && !saved.error ? saved : null);
    const up = np.enabled === false ? null : resolveUpstream({ env, settings: np, login, anyScheme: !np.upstream });
    if (!up) return [409, { error: 'no corporate proxy is set up: set HTTPS_PROXY for the egress sidecar, or save a proxy host and port', code: 'NOT_CONFIGURED' }];
    if (up.error) return [409, { error: up.error, code: 'UPSTREAM_INVALID' }];
    testRunning = true;
    try {
      const usedSaved = !typed && !!login;
      const r = await check(up, {
        startTripped: !!(up.login && up.login.rejected),
        onTrip: ({ upstream, loginId }) => {
          if (!usedSaved) return;
          if (managed) logins.markManagedRejected(upstream, now);
          else if (loginId) markLoginRejected(loginId, { home, upstream });
        },
      });
      rebuild();   // a trip marked the saved login: the running connector stops sending it at once
      return [200, { ok: r.ok, upstream: r.upstream.upstream, results: r.results, usedSavedLogin: usedSaved }];
    } finally { testRunning = false; }
  }

  function login(body) {
    if (managed) return [409, { error: MANAGED_TEXT, code: 'MANAGED' }];
    const bad = unknownKey(body, LOGIN_KEYS);
    if (bad) return [400, { error: `unknown field: ${bad}`, field: bad }];
    const hasPw = typeof body.password === 'string' && body.password !== '';
    const hasHash = typeof body.ntHash === 'string' && body.ntHash !== '';
    if (hasPw === hasHash) return [400, { error: 'send either the password or the NT hash', field: 'password' }];
    const np = settings();
    const refusal = savedLoginRefusal(np.auth);
    if (refusal) return [409, { error: refusal, field: 'auth', code: 'BASIC_NO_SAVED_LOGIN' }];
    const label = upstreamLabelOf(env, np);
    if (!label) return [409, { error: 'no corporate proxy is set up, so a login has nothing to be bound to: set HTTPS_PROXY for the egress sidecar, or save a proxy host and port first', code: 'NOT_CONFIGURED' }];
    if (typeof body.user !== 'string') return [400, { error: 'enter the user name', field: 'user' }];
    const account = typeof body.domain === 'string' && body.domain ? { domain: body.domain, user: body.user } : parseAccount(body.user);
    try {
      const opts = { home, env: writeEnv, upstream: label };
      if (hasPw) saveProxyLoginPlain({ ...account, password: body.password }, opts);
      else saveProxyLoginHash({ ...account, ntHash: body.ntHash }, opts);
    } catch (err) {
      if (err instanceof ProxyLoginError) return [400, { error: err.message, field: err.field }];
      return [500, { error: `the login could not be saved (${err && err.code ? err.code : 'error'})` }];
    } finally { body.password = undefined; body.ntHash = undefined; }
    rebuild();
    return [200, status()];
  }

  function logout() {
    if (managed) return [409, { error: MANAGED_TEXT, code: 'MANAGED' }];
    const had = clearProxyLoginPlain({ home });
    rebuild();
    return [200, { ...status(), deleted: had }];
  }

  function putSettings(body) {
    if (managed) return [409, { error: MANAGED_TEXT, code: 'MANAGED' }];
    const bad = unknownKey(body, new Set(['networkProxy']));
    if (bad || !Object.prototype.hasOwnProperty.call(body, 'networkProxy')) return [400, { error: bad ? `unknown field: ${bad}` : 'networkProxy is required (null clears it)', field: bad || 'networkProxy' }];
    const current = settings();
    let next;
    try { next = previewSidecarSettings(current, body.networkProxy); } catch (err) { return [400, { error: err.message, field: 'networkProxy' }]; }
    const before = upstreamLabelOf(env, current);
    const after = upstreamLabelOf(env, next);
    // Bound to its proxy: a login never follows a change of host or port. Deleted before the new proxy is in use.
    const dropped = before !== after ? clearProxyLoginPlain({ home }) : false;
    try { writeSidecarSettings(home, next); } catch (err) { return [500, { error: `the settings could not be saved (${err && err.code ? err.code : 'error'})` }]; }
    rebuild();
    return [200, { networkProxy: next, loginDropped: dropped, status: status() }];
  }

  async function route(req, res) {
    const path = String(req.url || '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n'); return; }
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !safeEqual(m[1], secret)) { send(res, 401, { error: 'unauthorized' }); return; }
    const call = `${req.method} ${path}`;
    const known = ['GET /v1/status', 'POST /v1/test', 'POST /v1/login', 'POST /v1/logout', 'GET /v1/settings', 'PUT /v1/settings'];
    if (!known.includes(call)) { send(res, 404, { error: 'not found' }); return; }
    if (req.method === 'GET') {
      send(res, 200, path === '/v1/status' ? status() : { networkProxy: settings(), managed });
      return;
    }
    let body;
    try { body = await readJson(req); } catch (err) { send(res, err.status || 400, { error: err.message }); return; }
    const [code, out] = call === 'POST /v1/test' ? await test(body)
      : call === 'POST /v1/login' ? login(body)
        : call === 'POST /v1/logout' ? logout()
          : putSettings(body);
    send(res, code, out);
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024, headersTimeout: 30_000, requestTimeout: 60_000 }, (req, res) => {
    route(req, res).catch(() => { try { send(res, 500, { error: 'internal error' }); } catch { res.destroy(); } });
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('connect', (_req, socket) => { socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); });
  return server;
}
