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
// With the corporateProxy flag on, the same proxy also chains to one corporate (upstream) proxy
// (src/core/upstream-proxy.mjs): from settings.json networkProxy, else the HTTP(S)_PROXY that was
// set. Children then get a credential-free http://127.0.0.1:<port>. Under a policy, the policy
// decides first and allowed hosts are forwarded to the upstream instead of replacing it.

import { createProxy, readEgressPolicy, normalizeHost } from './egress-proxy.mjs';
import { createUpstreamConnector, resolveUpstream, AUTH_LABELS } from './upstream-proxy.mjs';
import { flagEnabled } from './flags.mjs';
import { readSettings } from './settings.mjs';

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
 *  (`direct` = ['*'] means everything does, written as NO_PROXY='*' alone). */
export function egressChildEnv(url, direct = []) {
  const noProxy = direct.includes('*') ? '*' : [LOOPBACK, ...direct].join(',');
  const env = { [EGRESS_PROXY_VAR]: url, NO_PROXY: noProxy, no_proxy: noProxy };
  for (const k of PROXY_NAMES) env[k] = url;
  return env;
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
 * Enforce the policy in `env` for this process and its children, and (corporateProxy flag)
 * chain to the corporate proxy.
 *   off        nothing to do (no policy, flag off or no upstream): env untouched.
 *   inherited  a parent worca's proxy is already in env: reused, nothing started.
 *   on         proxy listening on 127.0.0.1:<port>; the proxy variables are now in env.
 * A policy proxy that cannot start rejects; a corporate-proxy-only one returns off + upstreamError.
 * @param {{env?: Record<string, string|undefined>, log?: (line: string) => void, unref?: boolean,
 *   corporateProxy?: () => boolean, settings?: () => object}} [opts]
 * @returns {Promise<{status: 'off'|'inherited'|'on', policy: object, url?: string, replacedProxy?: boolean,
 *   upstreamError?: string, connector?: object, boundAddress?: string, scrubbedKeys?: string[], upstream?: object,
 *   close: () => Promise<void>}>}
 */
export async function startEgressPolicy({ env = process.env, log = () => {}, unref = false,
  corporateProxy = () => flagEnabled('corporateProxy'), settings = readSettings } = {}) {
  const policy = readEgressPolicy(env);
  const none = async () => {};
  const corp = !!corporateProxy();
  if (!policy.enforced && !corp) return { status: 'off', policy, close: none };
  if (inheritsEgressProxy(env)) return { status: 'inherited', policy, url: env[EGRESS_PROXY_VAR], close: none };
  const s = corp ? settings() : null;
  const upstream = corp ? resolveUpstream({ env, settings: s && typeof s === 'object' ? s.networkProxy : undefined }) : null;
  const upstreamError = upstream && upstream.error ? upstream.error : undefined;
  const usable = upstream && !upstream.error ? upstream : null;
  const extra = upstreamError ? { upstreamError } : {};
  if (!policy.enforced && !usable) return { status: 'off', policy, ...extra, close: none };
  const connector = usable ? createUpstreamConnector(usable, { log: (l) => log(`corporate proxy: ${l}`) }) : null;
  const server = createProxy({
    policy: policy.enforced ? policy : OPEN_POLICY,
    connector,
    limits: usable ? { connectTimeoutMs: usable.timeouts.connectMs, idleTimeoutMs: usable.timeouts.idleMs } : {},
    // Only refusals are logged: an agent's every package download would otherwise be a line.
    log: (line) => { if (/ DENY /.test(line)) log(line); },
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (err) {
    connector?.close();
    if (policy.enforced) throw err;
    return { status: 'off', policy, upstreamError: `the local proxy could not start (${err && err.code ? err.code : 'error'})`, close: none };
  }
  if (unref) server.unref();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const replacedProxy = !connector && PROXY_NAMES.some((k) => env[k] && env[k] !== url);
  const direct = !policy.enforced && usable ? (usable.noProxy.all ? ['*'] : usable.noProxy.list) : [];
  // D21: read before the swap. Any variable whose value is an http URL with userinfo pointing at
  // the upstream host:port (ALL_PROXY, npm_config_https_proxy, a differently encoded copy, ...)
  // would let a child bypass the local proxy with the password.
  const credentialed = connector ? Object.keys(env).filter((k) => !PROXY_NAMES.includes(k) && loginFor(env[k], usable)) : [];
  Object.assign(env, egressChildEnv(url, direct));
  const scrubbedKeys = [];
  for (const k of credentialed) { env[k] = url; scrubbedKeys.push(k); }
  const sup = superviseProxy(server, port, { log });
  return {
    status: 'on', policy, url, replacedProxy, ...extra,
    ...(connector ? { connector, boundAddress: server.address().address, scrubbedKeys,
      upstream: { ...connector.status(), warnings: usable.warnings } } : {}),
    close: async () => { await sup.stop(); connector?.close(); },
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

/** The boot line for startEgressPolicy()'s result, or null when there is nothing to say. */
export function egressNotice(result) {
  if (!result) return null;
  if (result.status === 'off') {
    return result.upstreamError ? { level: 'warn', text: `corporate proxy: ${result.upstreamError}; it is not used` } : null;
  }
  const p = result.policy;
  const up = result.upstream;
  const warnings = up ? up.warnings : [];
  if (!p.enforced) {
    const text = result.status === 'inherited'
      ? `corporate proxy: outbound connections go through the parent Worca's proxy at ${result.url}`
      : [`corporate proxy: outbound connections go through ${up.upstream} (${AUTH_LABELS[up.auth]}) via ${result.url}; NO_PROXY hosts and loopback go direct`, ...warnings].join('; ');
    return { level: warnings.length ? 'warn' : 'info', text };
  }
  const n = (k, list) => `${k} ${list.length} host${list.length === 1 ? '' : 's'}`;
  const deny = p.deny.filter((h) => h !== '.invalid');
  const lists = p.mode === 'allow' ? `${n('allow', p.allow)}, ${n('deny', deny)}` : n('deny', deny);
  const parts = [`outbound network policy: ${p.mode} (${lists})`];
  if (p.invalidMode) parts.push(`WORCA_EGRESS_MODE=${JSON.stringify(p.invalidMode)} is not open, block or allow, so allow applies`);
  if (result.status === 'inherited') parts.push('enforced by the parent worca\'s proxy');
  else parts.push(`enforced through the proxy at ${result.url} for every child process`);
  if (up) parts.push(`then forwarded to the corporate proxy ${up.upstream} (${AUTH_LABELS[up.auth]})`, ...warnings);
  if (result.upstreamError) parts.push(`corporate proxy: ${result.upstreamError}; it is not used`);
  if (result.replacedProxy) parts.push('the HTTP(S)_PROXY that was set is replaced');
  const warn = p.invalidMode || result.replacedProxy || warnings.length || result.upstreamError;
  return { level: warn ? 'warn' : 'info', text: parts.join('; ') };
}
