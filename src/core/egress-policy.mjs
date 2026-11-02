// src/core/egress-policy.mjs
// The outbound network policy a hosting platform sets on an instance (WORCA_EGRESS_MODE,
// WORCA_EGRESS_ALLOW, WORCA_EGRESS_DENY; contract in src/core/egress-proxy.mjs). A platform such
// as Railway has no internal-only network to confine the container to, so worca enforces the
// policy itself: it starts the egress proxy on a loopback port inside its own process and points
// every child it starts (agents, tools, terminals, actions, MCP servers, plugin task sources and
// chat channels) at it through the proxy variables, the way docker/compose.egress.yml does with
// its sidecar. worca's own fetch() follows the same variables (src/core/env-proxy.mjs), so it is
// held to the policy too.
//
// Mode missing or `open`: nothing starts and the environment is left exactly as it was.
//
// What this does NOT cover (docs/remote-access.md, "Outbound network policy"): a program that
// ignores the proxy variables or opens a raw socket goes direct. Only a network that has no
// route out (the Docker overlay) stops that.
//
// With networkProxy.enabled on, the same proxy also chains to one corporate (upstream) proxy
// (src/core/upstream-proxy.mjs): from settings.json networkProxy, else the HTTP(S)_PROXY that was
// set. Children then get a credential-free http://127.0.0.1:<port>. Under a policy, the policy
// decides first and allowed hosts are forwarded to the upstream instead of replacing it.
// The login saved by `worca proxy login` (src/core/proxy-credentials.mjs) is read at boot and
// watched, so a new login (or a rejection another process recorded) applies without a restart.
// startLiveEgress() wraps it: a saved change of networkProxy swaps the upstream in place (D7-D10).
// An HTTP(S)_PROXY that carries a login starts the same proxy even with networkProxy.enabled unset
// (autoStart), so no child gets the password; only networkProxy.enabled: false keeps it off, and then
// engine, script and plugin children get no proxy URL at all (env-proxy.mjs withoutProxyLogin).

import http from 'node:http';
import net from 'node:net';
import { createProxy, readEgressPolicy, normalizeHost } from './egress-proxy.mjs';
import { createUpstreamConnector, resolveUpstream, ProxyCredentials, AUTH_LABELS, PASSWORD_MODES, fixedPortOf, localProxyUrl } from './upstream-proxy.mjs';
import { readProxyLogin, watchProxyLogin, markLoginRejected, redactProxyLine, upstreamEnv, CORPORATE_PROXY_VAR } from './proxy-credentials.mjs';
import { readSettings, readSettingsStrict, networkProxyEnabled, watchSettingsFile } from './settings.mjs';
import { proxyUrlHasLogin } from './env-proxy.mjs';

/** Set by the worca that runs the proxy, so a worca CLI started under it reuses it. */
export const EGRESS_PROXY_VAR = 'WORCA_EGRESS_PROXY_URL';

const PROXY_NAMES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];
const LOOPBACK = '127.0.0.1,localhost,::1';
const OPEN_POLICY = Object.freeze({ mode: 'open', enforced: false, allow: [], deny: [] });

/** True when `value` is an http URL with a user name whose host:port is the upstream's (D21). */
function loginFor(value, upstream) {
  if (typeof value !== 'string' || !value.includes('@')) return false;
  let u;
  try { u = new URL(value.trim()); } catch { return false; }
  return u.protocol === 'http:' && !!u.username
    && normalizeHost(u.hostname) === upstream.host && Number(u.port || 80) === upstream.port;
}

/** The variables a child needs to go through the proxy at `url`; loopback and `direct` go direct
 *  (`direct` = ['*'] means everything does, written as NO_PROXY='*' alone). `corporate`: a corporate
 *  proxy connector runs (flag on), so the browser-launch marker is set too (D14). */
export function egressChildEnv(url, direct = [], { corporate = false } = {}) {
  const noProxy = direct.includes('*') ? '*' : [LOOPBACK, ...direct].join(',');
  const env = { [EGRESS_PROXY_VAR]: url, NO_PROXY: noProxy, no_proxy: noProxy, ...(corporate ? { [CORPORATE_PROXY_VAR]: url } : {}) };
  for (const k of PROXY_NAMES) env[k] = url;
  return env;
}

/** The clear message for a fixed port that cannot be bound (D12). */
export function fixedPortError(port, err) {
  const code = err && err.code ? err.code : 'error';
  const why = code === 'EADDRINUSE' ? 'another program already uses that port'
    : code === 'EACCES' ? 'the system does not let Worca use that port (on Windows, check `netsh interface ipv4 show excludedportrange protocol=tcp`)'
      : 'the port cannot be used';
  return Object.assign(new Error(`the local proxy cannot listen on 127.0.0.1:${port}: ${why} (${code}). Free the port or change networkProxy.fixedPort`),
    { code, fixedPort: port });
}

/** True when 127.0.0.1:port is a Worca local proxy (its self-request answer carries x-worca-proxy: local). */
export function isWorcaProxy(port, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: localProxyUrl(port) + '/', agent: false, timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.headers['x-worca-proxy'] === 'local'); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}

/** True when `env` already points at a policy proxy an ancestor worca started. */
export function inheritsEgressProxy(env = process.env) {
  const url = String(env[EGRESS_PROXY_VAR] || '');
  return !!url && PROXY_NAMES.every((k) => env[k] === url);
}

/** The policy for display: mode and lists, with the platform's empty-list placeholder left out. */
export function egressSummary(env = process.env) {
  const p = readEgressPolicy(env);
  const deny = p.deny.filter((h) => h !== '.invalid');
  return {
    mode: p.mode,
    enforced: p.enforced,
    ...(p.invalidMode ? { invalidMode: p.invalidMode } : {}),
    allow: p.mode === 'allow' ? p.allow : [],
    deny: p.enforced ? deny : [],
  };
}

/**
 * Enforce the policy in `env` for this process and its children, and (networkProxy.enabled, or
 * autoStart: unset with a login in HTTP(S)_PROXY) chain to the corporate proxy.
 *   off        nothing to do (no policy, proxy off or no upstream): env untouched.
 *   inherited  a parent worca's proxy is already in env: reused, nothing started.
 *   on         proxy listening on 127.0.0.1:<port>; the proxy variables are now in env.
 * A policy proxy that cannot start rejects; a corporate-proxy-only one returns off + upstreamError.
 * Every return carries `sourceEnv`: the proxy variables as they were before the swap (through
 * upstreamEnv(), so never a parent's local proxy), for proxyState()/checkUpstream (D13). `on` carries
 * `autoStarted` (started for the login in HTTP(S)_PROXY alone); `off` carries `loginWithheld` when
 * HTTP(S)_PROXY carries a login that engine, script and plugin children therefore never get.
 * @param {{env?: Record<string, string|undefined>, log?: (line: string) => void, unref?: boolean,
 *   proxyOn?: () => boolean, settings?: () => object, login?: () => object|null, loginPollMs?: number,
 *   watchLogin?: (fn: () => void) => () => void, markRejected?: (id: string, o: object) => boolean}} [opts]
 * @returns {Promise<{status: 'off'|'inherited'|'on', policy: object, url?: string, replacedProxy?: boolean, autoStarted?: boolean, loginWithheld?: boolean,
 *   upstreamError?: string, connector?: object, reloadLogin?: () => boolean, boundAddress?: string,
 *   scrubbedKeys?: string[], upstream?: object, sourceEnv: object, swapUpstream?: (np: object) => {changed: boolean, upstreamError?: string},
 *   close: () => Promise<void>}>}
 *   On `on`, connector / upstream / reloadLogin / upstreamError are getters: swapUpstream() replaces them.
 */
export async function startEgressPolicy({ env = process.env, log = () => {}, unref = false,
  settings = readSettings, proxyOn = () => networkProxyEnabled(settings()),
  login = () => readProxyLogin(), loginPollMs = 1000, watchLogin = (fn) => watchProxyLogin(fn, { intervalMs: loginPollMs }),
  markRejected = (id, o) => markLoginRejected(id, o) } = {}) {
  const policy = readEgressPolicy(env);
  const none = async () => {};
  // A login in HTTP(S)_PROXY would reach every child, so it starts the proxy unless it was turned off by hand.
  const asked = !!proxyOn();
  const autoStart = !asked && proxyUrlHasLogin(env) && networkProxyOf(settings()).enabled !== false;
  const corp = asked || autoStart;
  const off = (extra = {}) => ({ status: 'off', policy, ...extra, ...(proxyUrlHasLogin(env) ? { loginWithheld: true } : {}),
    sourceEnv: upstreamEnv(env), close: none });
  // D13: for 'inherited', env.HTTPS_PROXY is already the parent's local proxy, and upstreamEnv drops it.
  if (!policy.enforced && !corp) return off();
  if (inheritsEgressProxy(env)) return { status: 'inherited', policy, url: env[EGRESS_PROXY_VAR], sourceEnv: upstreamEnv(env), close: none };
  const s = corp ? settings() : null;
  const saved = corp ? login() : null;                  // never read with the proxy off
  const np0 = s && typeof s === 'object' ? s.networkProxy : undefined;
  const upstream = corp ? resolveUpstream({ env, settings: autoStart ? viaEnvUrl(np0) : np0, login: saved, anyScheme: autoStart }) : null;
  let upstreamError = upstream && upstream.error ? upstream.error : undefined;
  let usable = upstream && !upstream.error ? upstream : null;
  if (!policy.enforced && !usable) return off(upstreamError ? { upstreamError } : {});
  const makeConnector = (up) => createUpstreamConnector(up, {
    log: (l) => log(`Corporate proxy: ${redactProxyLine(l)}`),
    startTripped: !!(up.login && up.login.rejected),
    // D7: the id of the login that was refused, captured by the handshake; never the current one.
    onTrip: ({ upstream: label, loginId }) => { if (loginId) markRejected(loginId, { upstream: label }); },
  });
  const limitsOf = (up) => (up ? { connectTimeoutMs: up.timeouts.connectMs, idleTimeoutMs: up.timeouts.idleMs } : {});
  const directOf = (up) => (!policy.enforced && up ? (up.noProxy.all ? ['*'] : up.noProxy.list) : []);
  // No login swap where a login can never be swapped in (Basic, Digest, or an explicit auth none: D23).
  const isSwappable = (up) => !!up && !PASSWORD_MODES.includes(up.auth) && !['none', ...PASSWORD_MODES].includes(up.requestedAuth);
  let connector = usable ? makeConnector(usable) : null;
  const server = createProxy({
    policy: policy.enforced ? policy : OPEN_POLICY,
    connector,
    limits: limitsOf(usable),
    // Only refusals are logged: an agent's every package download would otherwise be a line.
    log: (line) => { if (/ DENY /.test(line)) log(line); },
  });
  // D11: read only with the proxy on (s is null otherwise), so a proxy-off Worca never binds it.
  const fixedPort = corp ? fixedPortOf(s && typeof s === 'object' ? s.networkProxy : undefined) : 0;
  let fixedPortShared = false;
  try {
    try {
      await listenOn(server, fixedPort);
    } catch (err) {
      if (!fixedPort) throw err;
      if (err && err.code === 'EADDRINUSE' && await isWorcaProxy(fixedPort)) {
        fixedPortShared = true;   // D12: another Worca serves the fixed port; this one keeps its children on its own
        await listenOn(server, 0);
      } else throw fixedPortError(fixedPort, err);
    }
  } catch (err) {
    connector?.close();
    if (policy.enforced) throw err;
    return off({ upstreamError: err && err.fixedPort ? err.message : `the local proxy could not start (${err && err.code ? err.code : 'error'})` });
  }
  if (unref) server.unref();
  const port = server.address().port;
  let url = `http://127.0.0.1:${port}`;   // listenAlso() moves it to a new fixed port
  const replacedProxy = !connector && PROXY_NAMES.some((k) => env[k] && env[k] !== url);
  const direct = directOf(usable);
  // D21: read before the swap. Any variable whose value is an http URL with userinfo pointing at
  // the upstream host:port (ALL_PROXY, npm_config_https_proxy, a differently encoded copy, ...)
  // would let a child bypass the local proxy with the password.
  const credentialed = connector ? Object.keys(env).filter((k) => !PROXY_NAMES.includes(k) && loginFor(env[k], usable)) : [];
  const sourceEnv = upstreamEnv(Object.fromEntries([...PROXY_NAMES, 'NO_PROXY', 'no_proxy', EGRESS_PROXY_VAR]
    .filter((k) => env[k] !== undefined).map((k) => [k, env[k]])));   // before the swap below
  Object.assign(env, egressChildEnv(url, direct, { corporate: !!connector }));
  const scrubbedKeys = [];
  for (const k of credentialed) { env[k] = url; scrubbedKeys.push(k); }
  /** What the connector holds: login id + marker time, so a marker on the same id counts (D8). */
  const keyOf = (r) => (r ? `${r.id}|${r.rejected ? r.rejected.at : ''}` : '');
  let currentKey = keyOf(usable && usable.login ? { id: usable.login.id, rejected: usable.login.rejected } : null);
  let lastLoginError = '';
  /** Re-read the saved login; swap it into the connector when it changed. @returns {boolean} changed */
  const reloadLogin = () => {
    if (!connector || !isSwappable(usable)) return false;
    const next = login();
    // D8: a file that cannot be used now (bad mode, bad JSON, EACCES) changes nothing. Treating it
    // as "logged out" would reset the gate and reopen a tripped breaker. Logged once per message.
    if (next && next.error) {
      if (next.error !== lastLoginError) log(`Corporate proxy: the saved login cannot be used (${next.error}); keeping the current login`);
      lastLoginError = next.error;
      return false;
    }
    lastLoginError = '';
    const ok = next || null;
    const key = keyOf(ok);
    if (key === currentKey) return false;
    currentKey = key;
    // Same login, newly marked, and this connector already tripped (it wrote the marker): nothing to do.
    if (ok && ok.rejected && connector.status().loginId === ok.id && connector.status().state === 'tripped') return false;
    const creds = ok ? new ProxyCredentials({ domain: ok.domain, user: ok.user, ntHash: ok.ntHash }, 'auto') : null;
    return connector.useLogin(creds, { id: ok ? ok.id : null, rejected: !!(ok && ok.rejected) });
  };
  // The watcher runs whenever the proxy is on: a swap can bring in an upstream that takes a login.
  const stopWatch = watchLogin(() => { if (isSwappable(usable)) reloadLogin(); });
  const sup = superviseProxy(server, port, { log });
  // listenAlso(): extra listeners on later fixed ports. Each hands its sockets to the same proxy server, so every port
  // shares the connector, the login and the policy. The old port keeps answering for the children already holding it.
  const extras = [];
  let boundFixed = fixedPort;
  /** Listen on `nextPort` too and hand it to new children (D10 live): the env's proxy URL moves there. Rejects
   *  with fixedPortError when the port cannot be bound; nothing changes then. */
  async function listenAlso(nextPort) {
    const side = net.createServer((socket) => server.emit('connection', socket));
    side.maxConnections = server.maxConnections;
    try { await listenOn(side, nextPort); } catch (err) { throw fixedPortError(nextPort, err); }
    if (unref) side.unref();
    server.addSelfPort(nextPort);
    extras.push({ side, sup: superviseProxy(side, nextPort, { log }) });
    url = `http://127.0.0.1:${nextPort}`;
    boundFixed = nextPort; fixedPortShared = false;
    Object.assign(env, egressChildEnv(url, directOf(usable), { corporate: !!connector }));
    for (const k of scrubbedKeys) env[k] = url;
    return url;
  }

  /** D7/D13: re-resolve the upstream from the pre-swap env and swap it into the running server. */
  function swapUpstream(np) {
    const saved = login();
    // An auto-started proxy stays chained until networkProxy.enabled is false.
    const viaLogin = !!autoStart && !!np && np.enabled !== true && np.enabled !== false;
    const next = np && (np.enabled === true || viaLogin)
      ? resolveUpstream({ env: sourceEnv, settings: viaLogin ? viaEnvUrl(np) : np, login: saved && !saved.error ? saved : null, anyScheme: viaLogin }) : null;
    // Decision 6a: on, but the new upstream does not resolve: keep the running connector, never go direct.
    if (next && next.error) { upstreamError = next.error; return { changed: false, upstreamError }; }
    const nextConn = next ? makeConnector(next) : null;
    server.useConnector(nextConn, limitsOf(next));
    connector = nextConn;
    usable = next;
    currentKey = keyOf(usable && usable.login ? { id: usable.login.id, rejected: usable.login.rejected } : null);
    // Children keep HTTPS_PROXY = url; only NO_PROXY and the browser-launch marker follow the new upstream.
    Object.assign(env, egressChildEnv(url, directOf(usable), { corporate: !!connector }));
    if (!connector) delete env[CORPORATE_PROXY_VAR];
    for (const k of Object.keys(env)) {
      if (connector && !PROXY_NAMES.includes(k) && loginFor(env[k], usable)) { env[k] = url; if (!scrubbedKeys.includes(k)) scrubbedKeys.push(k); }
    }
    upstreamError = undefined;
    return { changed: true };
  }

  return {
    status: 'on', policy, replacedProxy, sourceEnv, scrubbedKeys, boundAddress: server.address().address, autoStarted: autoStart && !!connector,
    get url() { return url; },
    get fixedPort() { return boundFixed || undefined; },
    get fixedPortShared() { return boundFixed ? fixedPortShared : undefined; },
    listenAlso,
    get upstreamError() { return upstreamError; },
    get connector() { return connector; },
    get reloadLogin() { return connector ? reloadLogin : undefined; },
    get upstream() { return connector ? { ...connector.status(), warnings: usable.warnings } : undefined; },
    swapUpstream,
    close: async () => {
      stopWatch(); await sup.stop();
      for (const x of extras) { await x.sup.stop(); x.side.close(); }
      connector?.close();
    },
  };
}

/** JSON with sorted object keys, so a boot read and a merged save of the same values compare equal. */
const stableJson = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  : Array.isArray(v) ? `[${v.map(stableJson).join(',')}]` : JSON.stringify(v));
/** networkProxy minus fixedPort, the part that applies live (D10). Exported for its test. */
export const liveKeyOf = (np) => { const { fixedPort: _p, ...rest } = np && typeof np === 'object' ? np : {}; return stableJson(rest); };
/** Auto-start chains to the HTTP(S)_PROXY that carries the login, never to an upstream left in settings.json. */
export const viaEnvUrl = (np) => { const { upstream: _u, ...rest } = np && typeof np === 'object' ? np : {}; return rest; };
const networkProxyOf = (s) => (s && typeof s === 'object' && s.networkProxy && typeof s.networkProxy === 'object' ? s.networkProxy : {});
/** The networkProxy a settings object asks for, with `enabled` resolved (a leftover flag still counts, Decision 3).
 *  Unset stays unset: it is not `false`, which alone stops an auto-started proxy (startEgressPolicy autoStart). */
const wantedOf = (s) => {
  const np = networkProxyOf(s);
  return { ...np, enabled: typeof np.enabled === 'boolean' || networkProxyEnabled(s) ? networkProxyEnabled(s) : undefined };
};

/**
 * startEgressPolicy() plus live changes (D7–D10). apply(networkProxy) swaps the upstream in place,
 * starts the local proxy when it was off and is now on (D8), or does nothing for `inherited`
 * (the parent swaps). A watcher on settings.json calls apply() for other processes' saves.
 * @returns {Promise<{current: () => object, apply: (np: object) => Promise<{changed: boolean, pending: string[], upstreamError?: string}>, close: () => Promise<void>}>}
 */
export async function startLiveEgress({ settings = readSettings, readStrict = readSettingsStrict,
  watch = (fn, o) => watchSettingsFile(fn, o), pollMs = 1000, onEnvChange = () => {}, ...startOpts } = {}) {
  let result = await startEgressPolicy({ ...startOpts, settings });
  let appliedKey = liveKeyOf(wantedOf(settings()));
  let boundFixed = result.status === 'on' ? (result.fixedPort || 0) : null;   // null: nothing bound yet
  let tail = Promise.resolve();

  async function applyNow(np) {
    const fixed = fixedPortOf(np);
    // A new fixed port switches at once: the running proxy listens there too and new children get it, while the old
    // port keeps answering for the ones holding it until the next start. A port that cannot be bound is said now
    // (it would fail the next start too). No fixed port any more: the current one simply stays until the next start.
    const pending = []; let portError; let switched = false;
    if (boundFixed !== null && fixed !== boundFixed && result.status === 'on') {
      if (!fixed) boundFixed = 0;
      else {
        try { await result.listenAlso(fixed); boundFixed = fixed; switched = true; }
        catch (err) { portError = `saved, but ${err && err.message ? err.message : err}`; }
      }
    }
    if (switched) { try { onEnvChange(); } catch { /* the new port runs */ } }
    const extra = { ...(portError ? { upstreamError: portError } : {}), ...(switched ? { portSwitched: fixed } : {}) };
    const key = liveKeyOf(np);
    if (key === appliedKey) return { changed: switched, pending, ...extra };
    if (result.status === 'inherited') { appliedKey = key; return { changed: false, pending }; }
    if (result.status === 'on') {
      const r = result.swapUpstream(np);
      if (!r.changed) return { ...r, pending, ...extra };   // Decision 6a: the running connector stays
      appliedKey = key;
      try { onEnvChange(); } catch { /* the swap stands */ }
      return { ...r, pending, ...extra };
    }
    // Off: start when turned on, or when `enabled` is cleared and HTTP(S)_PROXY carries a login (autoStart).
    const autoNow = !!np && np.enabled !== true && np.enabled !== false && proxyUrlHasLogin(startOpts.env || process.env);
    if (!(np && (np.enabled === true || autoNow))) { appliedKey = key; return { changed: false, pending: [] }; }
    const next = await startEgressPolicy({ ...startOpts, settings: () => ({ networkProxy: np }), proxyOn: () => !autoNow });
    appliedKey = key;
    if (next.status !== 'on') { result = next; return { changed: false, pending: [], upstreamError: next.upstreamError }; }
    result = next;
    boundFixed = next.fixedPort || 0;
    try { onEnvChange(); } catch { /* the proxy runs */ }
    return { changed: true, pending: [] };
  }
  /** Serialised; the stored tail swallows a rejection so a refused apply never goes unhandled. */
  function apply(np) {
    const run = tail.then(() => applyNow(np));
    tail = run.catch(() => {});
    return run;
  }
  const logApplyError = (err) => startOpts.log?.(`network proxy: the new settings could not be applied (${err && err.message ? err.message : err})`);
  // R-sec-5: a tick where settings.json is missing or not a JSON object is skipped; the running connector stays.
  const stopWatch = watch(() => { const s = readStrict(); if (s) apply(wantedOf(s)).catch(logApplyError); }, { intervalMs: pollMs });
  return {
    current: () => result,
    apply,
    close: async () => { stopWatch(); await tail; await result.close(); },
  };
}

/**
 * Keep the proxy listening on `port` for the life of the process. The children were handed that
 * address at spawn, so the proxy comes back on the same port: an error after listen (EMFILE at
 * accept, say) is logged, and a server that stopped listening is started again with backoff
 * (1 s, doubling to 30 s). While it is down a connection to it is refused, so traffic fails
 * closed; worca itself keeps running.
 * @returns {{stop: () => Promise<void>, restarts: () => number}}
 */
export function superviseProxy(server, port, { log = () => {}, host = '127.0.0.1', baseDelayMs = 1000, maxDelayMs = 30_000 } = {}) {
  let stopping = false;
  let delay = baseDelayMs;
  let timer = null;
  let restarts = 0;
  const say = (l) => { try { log(l); } catch { /* ignore */ } };
  const schedule = () => {
    if (stopping || timer || server.listening) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopping || server.listening) return;
      server.listen(port, host, () => { restarts += 1; delay = baseDelayMs; say(`policy proxy listening again on ${host}:${port}`); });
    }, delay);
    timer.unref?.();
    delay = Math.min(delay * 2, maxDelayMs);
  };
  server.on('error', (err) => {
    say(`policy proxy error: ${err && err.message ? err.message : err}${server.listening ? '' : '; restarting'}`);
    schedule();
  });
  server.on('close', () => { if (!stopping) { say('policy proxy stopped; restarting'); schedule(); } });
  return {
    restarts: () => restarts,
    stop: () => {
      stopping = true;
      if (timer) { clearTimeout(timer); timer = null; }
      return new Promise((r) => { if (!server.listening) { r(); return; } server.close(() => r()); });
    },
  };
}

const STARTED_FOR_LOGIN = 'started because HTTP(S)_PROXY carries a login, so no child gets the password (networkProxy.enabled: false turns it off)';

/** The corporate half of the boot line (D18): "Corporate proxy: via host:port (auth)…". */
function corporateLine(up, url, result = {}) {
  const via = `Corporate proxy: via ${up.upstream} (${AUTH_LABELS[up.auth]})`;
  if (up.state === 'tripped') {
    return `${via}: proxy needs login. The corporate proxy rejected the saved login${up.login ? ` for ${up.login}` : ''}, so Worca sends no credentials; run \`worca proxy login\` or use Settings › Network proxy`;
  }
  const shared = result.fixedPortShared ? `; 127.0.0.1:${result.fixedPort} is served by another Worca, so this one uses ${url}` : '';
  return `${via}${up.login ? `, logged in as ${up.login}` : ''}, local proxy ${url}; NO_PROXY hosts and loopback go direct${shared}`;
}

/** The boot line for startEgressPolicy()'s result, or null when there is nothing to say. */
export function egressNotice(result) {
  if (!result) return null;
  if (result.status === 'off') {
    const withheld = result.loginWithheld ? 'HTTP(S)_PROXY carries a login, so agents, scripts and plugin connectors get no proxy and go direct' : '';
    if (result.upstreamError) return { level: 'warn', text: `Corporate proxy: ${result.upstreamError}; it is not used${withheld ? `, and ${withheld}` : ''}` };
    return withheld ? { level: 'warn', text: `Corporate proxy: turned off (networkProxy.enabled is false), and ${withheld}; turn on Use a corporate proxy (Settings › Network proxy) to keep the login in Worca` } : null;
  }
  const p = result.policy;
  const up = result.upstream;
  const warnings = up ? up.warnings : [];
  if (!p.enforced) {
    const text = result.status === 'inherited'
      ? `Corporate proxy: outbound connections go through the parent Worca's proxy at ${result.url}`
      : [corporateLine(up, result.url, result), ...(result.autoStarted ? [STARTED_FOR_LOGIN] : []), ...warnings].join('; ');
    return { level: warnings.length || up?.state === 'tripped' || result.fixedPortShared ? 'warn' : 'info', text };
  }
  const n = (k, list) => `${k} ${list.length} host${list.length === 1 ? '' : 's'}`;
  const deny = p.deny.filter((h) => h !== '.invalid');
  const lists = p.mode === 'allow' ? `${n('allow', p.allow)}, ${n('deny', deny)}` : n('deny', deny);
  const parts = [`outbound network policy: ${p.mode} (${lists})`];
  if (p.invalidMode) parts.push(`WORCA_EGRESS_MODE=${JSON.stringify(p.invalidMode)} is not open, block or allow, so allow applies`);
  if (result.status === 'inherited') parts.push('enforced by the parent worca\'s proxy');
  else parts.push(`enforced through the proxy at ${result.url} for every child process`);
  if (up) parts.push(`then forwarded to the corporate proxy ${up.upstream} (${AUTH_LABELS[up.auth]})`, ...(up.state === 'tripped' ? ['proxy needs login: run `worca proxy login`'] : []), ...warnings);
  if (result.upstreamError) parts.push(`Corporate proxy: ${result.upstreamError}; it is not used`);
  if (result.replacedProxy) parts.push('the HTTP(S)_PROXY that was set is replaced');
  const warn = p.invalidMode || result.replacedProxy || warnings.length || result.upstreamError || up?.state === 'tripped';
  return { level: warn ? 'warn' : 'info', text: parts.join('; ') };
}
