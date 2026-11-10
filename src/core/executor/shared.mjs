// src/core/executor/shared.mjs
// What the worker backends, the registry and the worker itself must agree on, in ONE place: the
// labels a worker container carries, the "could not start a worker" error, what counts as a
// loopback URL, the engine a worker gets when nothing names one, and which of the controller's
// settings a worker container inherits, and this package's version. No worca imports: the worker process loads this too.
import { createRequire } from 'node:module';

/** This package's version: the controller's, and in a worker image the worker's. null when it cannot be read. */
export function worcaVersion() {
  try { return String(createRequire(import.meta.url)('../../../package.json').version); } catch { return null; }
}

/** Docker labels on a worker container (the CLI removes leftovers by the first). */
export const CONTROLLER_LABEL = 'worca.controller';
export const SCOPE_LABEL = 'worca.scope';
export const WORKER_LABEL = 'worca.worker';
/** Which worca installation a worker container belongs to (the Compose project, or WORCA_INSTANCE_ID): two stacks
 *  on one Docker host never list, reap or remove each other's workers. */
export const INSTANCE_LABEL = 'worca.instance';
/** On a Docker NETWORK: a role marks a link to one sidecar — `docker-api` (the socket proxy's), `broker-link` (the
 *  broker's). No worker is ever put on a role network, and one never counts as the controller's own uplink. */
export const NETWORK_ROLE_LABEL = 'worca.role';

/** Engines whose worker image has a `-full` build (the release workflow's plan); the others exist slim only. */
export const FULL_VARIANT_ENGINES = Object.freeze(['claude', 'all']);
export function fullVariantEngines(env = process.env) {
  const v = String(env.WORCA_WORKER_FULL_ENGINES || '').trim();
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [...FULL_VARIANT_ENGINES];
}

/** The error an aborted wait or spawn ends with. */
export function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}
/** Resolve after `ms`, or at once when `signal` aborts (it never rejects: the caller re-checks the signal). */
export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();   // already aborted: 'abort' will not fire again
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}
/** A positive whole number from `env[name]` (a fraction is rounded down: the protocol carries integers), else `def`. */
export function envInt(env, name, def) {
  const n = Math.floor(Number(env?.[name]));
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** A worker that could not be started: the harness's failure policy treats it like a lost network. */
export function startFailure(message, extra = {}) {
  return Object.assign(new Error(message), { code: 'EWORKERSTART', errorClass: 'network', ...extra });
}

/** The host a URL-ish value points at, or null when it cannot be read. A proxy is often written
 *  without a scheme (`proxy.corp:3128`), which `new URL` reads as a scheme and no host. */
export function hostOfUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  for (const candidate of [v, `http://${v}`]) {
    try {
      const h = new URL(candidate).hostname.replace(/^\[|\]$/g, '');
      if (h) return h;
    } catch { /* try the next reading */ }
  }
  return null;
}

/** True when the value names this machine's own loopback: unreachable from another container. */
export function isLoopbackUrl(value) {
  const h = hostOfUrl(value);
  return !!h && (h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h));
}

/** Proxy variables, either case. */
export const PROXY_NAMES = Object.freeze(['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']);

/**
 * The controller's settings a worker CONTAINER inherits (its own process and entrypoint): where the
 * broker is, the corporate CA to trust (the worker entrypoint builds its bundle from it), time zone,
 * mock mode, the kill grace, and the per-engine binary overrides. Never a credential: those reach an
 * agent through the environment the controller composes per spawn, or through the broker.
 */
export const WORKER_PASS_THROUGH = Object.freeze([
  'TZ', 'WORCA_BROKER_URL', 'WORCA_MOCK', 'WORCA_CA_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'WORCA_SIGTERM_GRACE_MS',
  'WORCA_WORKER_RELAY_PORT',   // the controller tells a chat's MCP child this port: the worker's shim must listen on the same one
  'WORCA_WORKER_RELAY_TIMEOUT_MS',
  'WORCA_CLAUDE_BIN', 'WORCA_CODEX_BIN', 'WORCA_GEMINI_BIN', 'WORCA_QWEN_BIN', 'WORCA_COPILOT_BIN', 'WORCA_CURSOR_BIN', 'WORCA_GOOSE_BIN', 'WORCA_OPENCODE_BIN',
]);

/**
 * The inherited part of a worker container's environment, the same under every backend:
 * the pass-through names (plus `also`), the git identity, a proxy that another container can reach
 * (a loopback one — the controller's in-process proxy — is dropped, as is one that cannot be read),
 * and NO_PROXY extended with the controller's and the broker's hosts so the worker never reaches
 * them through the proxy.
 */
export function passThroughEnv(controllerEnv = {}, { controllerUrl = null, also = [] } = {}) {
  const out = {};
  const set = (name) => { const v = controllerEnv[name]; if (v !== undefined && v !== null && String(v).trim() !== '') out[name] = String(v); };
  for (const name of [...WORKER_PASS_THROUGH, ...also]) set(name);
  for (const name of Object.keys(controllerEnv)) if (/^GIT_(AUTHOR|COMMITTER)_[A-Z_]+$/.test(name)) set(name);
  let proxied = false;
  for (const name of PROXY_NAMES) {
    const v = controllerEnv[name];
    if (v && String(v).trim() && hostOfUrl(v) && !isLoopbackUrl(v)) { out[name] = String(v); proxied = true; }
  }
  const noProxy = controllerEnv.NO_PROXY ?? controllerEnv.no_proxy;
  if (proxied || (noProxy !== undefined && String(noProxy).trim() !== '')) {
    const entries = String(noProxy || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const h of [hostOfUrl(controllerUrl), hostOfUrl(controllerEnv.WORCA_BROKER_URL)]) if (h && !entries.includes(h)) entries.push(h);
    out.NO_PROXY = entries.join(',');
  }
  return out;
}

/**
 * The engine a worker gets when the spawn names none: the first of `names` set in `env`
 * (WORCA_WORKER_ENGINE everywhere), else the install's `run.engine` setting, else claude.
 */
export async function defaultWorkerEngine(env = process.env, names = ['WORCA_WORKER_ENGINE']) {
  for (const n of names) { const v = String(env[n] || '').trim(); if (v) return v; }
  try {
    const { resolveRunEngine } = await import('../settings-cascade.mjs');
    const engine = resolveRunEngine({}).engine;
    return typeof engine === 'string' && engine.trim() ? engine.trim() : 'claude';
  } catch { return 'claude'; }
}
