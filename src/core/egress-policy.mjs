// src/core/egress-policy.mjs
// The outbound network policy a hosting platform sets on an instance (WORCA_EGRESS_MODE,
// WORCA_EGRESS_ALLOW, WORCA_EGRESS_DENY; contract in src/core/egress-proxy.mjs). A platform such
// as Railway has no internal-only network to confine the container to, so worca enforces the
// policy itself: it starts the egress proxy on a loopback port inside its own process and points
// every child it starts (agents, tools, terminals, actions, MCP servers) at it through the proxy
// variables, the way docker/compose.egress.yml does with its sidecar. worca's own fetch() follows
// the same variables (src/core/env-proxy.mjs), so it is held to the policy too.
//
// Mode missing or `open`: nothing starts and the environment is left exactly as it was.
//
// What this does NOT cover (docs/remote-access.md, "Outbound network policy"): a program that
// ignores the proxy variables or opens a raw socket goes direct. Only a network that has no
// route out (the Docker overlay) stops that.

import { createProxy, readEgressPolicy } from './egress-proxy.mjs';

/** Set by the worca that runs the proxy, so a worca CLI started under it reuses it. */
export const EGRESS_PROXY_VAR = 'WORCA_EGRESS_PROXY_URL';

const PROXY_NAMES = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];
const LOOPBACK = '127.0.0.1,localhost,::1';

/** The variables a child needs to go through the proxy at `url`; loopback only goes direct. */
export function egressChildEnv(url) {
  const env = { [EGRESS_PROXY_VAR]: url, NO_PROXY: LOOPBACK, no_proxy: LOOPBACK };
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
 * Enforce the policy in `env` for this process and its children.
 *   off        not enforced: env untouched.
 *   inherited  a parent worca's proxy is already in env: reused, nothing started.
 *   on         proxy listening on 127.0.0.1:<port>; the proxy variables are now in env.
 * A proxy that cannot start rejects: the caller must not go on without it.
 * @param {{env?: Record<string, string|undefined>, log?: (line: string) => void, unref?: boolean}} [opts]
 * @returns {Promise<{status: 'off'|'inherited'|'on', policy: object, url?: string, replacedProxy?: boolean, close: () => Promise<void>}>}
 */
export async function startEgressPolicy({ env = process.env, log = () => {}, unref = false } = {}) {
  const policy = readEgressPolicy(env);
  const none = async () => {};
  if (!policy.enforced) return { status: 'off', policy, close: none };
  if (inheritsEgressProxy(env)) return { status: 'inherited', policy, url: env[EGRESS_PROXY_VAR], close: none };
  // Only refusals are logged: an agent's every package download would otherwise be a line.
  const server = createProxy({ policy, log: (line) => { if (/ DENY /.test(line)) log(line); } });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  if (unref) server.unref();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const replacedProxy = PROXY_NAMES.some((k) => env[k] && env[k] !== url);
  Object.assign(env, egressChildEnv(url));
  const sup = superviseProxy(server, port, { log });
  return {
    status: 'on', policy, url, replacedProxy,
    close: () => sup.stop(),
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

/** The boot line for startEgressPolicy()'s result, or null for 'off'. */
export function egressNotice(result) {
  if (!result || result.status === 'off') return null;
  const p = result.policy;
  const n = (k, list) => `${k} ${list.length} host${list.length === 1 ? '' : 's'}`;
  const deny = p.deny.filter((h) => h !== '.invalid');
  const lists = p.mode === 'allow' ? `${n('allow', p.allow)}, ${n('deny', deny)}` : n('deny', deny);
  const parts = [`outbound network policy: ${p.mode} (${lists})`];
  if (p.invalidMode) parts.push(`WORCA_EGRESS_MODE=${JSON.stringify(p.invalidMode)} is not open, block or allow, so allow applies`);
  if (result.status === 'inherited') parts.push('enforced by the parent worca\'s proxy');
  else parts.push(`enforced through the proxy at ${result.url} for every child process`);
  if (result.replacedProxy) parts.push('the HTTP(S)_PROXY that was set is replaced');
  return { level: p.invalidMode || result.replacedProxy ? 'warn' : 'info', text: parts.join('; ') };
}
