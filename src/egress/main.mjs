// src/egress/main.mjs — `worca egress`: the egress sidecar that holds the corporate proxy login (docs/network-proxy.md,
// "Worca in a container"; #1619). One process, two listeners, both on the compose network only (never published):
//
//   WORCA_EGRESS_PORT (3128)      the forward proxy every container points HTTPS_PROXY at. It relays (the same
//                                 createProxy as the old single-file sidecar) and chains to the corporate proxy
//                                 with the saved login: NTLMv2 / Negotiate / Digest / Basic (src/core/upstream-proxy.mjs).
//   WORCA_EGRESS_API_PORT (3129)  the internal API (src/egress/api.mjs), behind WORCA_EGRESS_SECRET(_FILE).
//
// Policy: WORCA_EGRESS_MODE (open | block | allow, the platform contract) wins; else WORCA_EGRESS_ALLOWLIST=1
// (set by compose.egress.yml) keeps the allow-list overlay's meaning (WORCA_EGRESS_ALLOW, empty = the defaults);
// else open: every host, and the sidecar only does the login (compose.proxy.yml).
//
// The corporate proxy: <dataDir>/proxy-settings.json (written through the API), else the sidecar's own
// HTTPS_PROXY / HTTP_PROXY / NO_PROXY (from the container .env, so a Basic or Digest login in that URL lives here,
// never in the box). The old entry, /usr/local/lib/worca-egress-proxy.mjs, stays a plain relay for old compose files.
import { mkdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { createProxy, readEgressPolicy, parseAllow } from '../core/egress-proxy.mjs';
import { createUpstreamConnector, resolveUpstream } from '../core/upstream-proxy.mjs';
import { watchProxyLogin, markLoginRejected, redactProxyLine } from '../core/proxy-credentials.mjs';
import { readSecretVar, MIN_SECRET, EGRESS_SECRET_VAR } from '../core/egress-sidecar-client.mjs';
import { readSidecarSettings, createLoginSource } from './store.mjs';
import { createSidecarApi } from './api.mjs';

const EX_CONFIG = 78;
/** The image label `worca container` checks before it starts this entry (docker/Dockerfile). */
export const SIDECAR_API_VERSION = 1;

const parsePort = (v, d) => {
  if (v === undefined || String(v).trim() === '') return d;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 65536 ? n : NaN;
};

/** The sidecar's configuration from `env` (pure apart from the secret file). @returns {{config: object, errors: string[]}} */
export function readSidecarConfig(env = process.env, readFile = readFileSync) {
  const errors = [];
  const port = parsePort(env.WORCA_EGRESS_PORT, 3128);
  const apiPort = parsePort(env.WORCA_EGRESS_API_PORT, 3129);
  if (Number.isNaN(port)) errors.push('WORCA_EGRESS_PORT must be a port number');
  if (Number.isNaN(apiPort)) errors.push('WORCA_EGRESS_API_PORT must be a port number');
  if (port === apiPort && port !== 0) errors.push('WORCA_EGRESS_PORT and WORCA_EGRESS_API_PORT must differ');
  const secret = readSecretVar(env, EGRESS_SECRET_VAR, readFile);
  if (secret.error) errors.push(secret.error);
  else if (secret.value && secret.value.length < MIN_SECRET) errors.push(`${EGRESS_SECRET_VAR} is too short: use at least ${MIN_SECRET} characters (\`worca broker secrets\` prints one)`);
  const dataDir = String(env.WORCA_EGRESS_DATA_DIR || '').trim() || null;
  const loginFile = String(env.WORCA_EGRESS_LOGIN_FILE || '').trim() || null;
  if (!dataDir && !loginFile) errors.push('WORCA_EGRESS_DATA_DIR is required: the folder on the sidecar\'s own volume that holds the login');
  const modeSet = String(env.WORCA_EGRESS_MODE ?? '').trim() !== '';
  const policy = modeSet ? { policy: readEgressPolicy(env) }
    : String(env.WORCA_EGRESS_ALLOWLIST || '').trim() === '1' ? { allow: parseAllow(env.WORCA_EGRESS_ALLOW) }
      : { policy: { mode: 'open', enforced: false, allow: [], deny: [] } };
  return { config: { port, apiPort, host: String(env.WORCA_EGRESS_HOST || '0.0.0.0').trim(), secret: secret.value, dataDir, loginFile, ...policy }, errors };
}

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
});

/**
 * Start the sidecar. Resolves {ports: {proxy, api}, close, status, rebuild}.
 * @param {{config: object, env?: object, log?: (l: string) => void, pollMs?: number, now?: () => number}} o
 *   `env`: where the corporate proxy URL comes from when the settings file names none (HTTPS_PROXY ...).
 */
export async function startEgressSidecar({ config, env = process.env, log = (l) => process.stdout.write(`${l}\n`), pollMs = 1000, now = Date.now }) {
  const dataDir = config.dataDir;
  if (dataDir) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const managed = !!config.loginFile;
  const say = (l) => { try { log(l); } catch { /* a logger must not take the sidecar down */ } };
  const logins = createLoginSource({ dataDir, env, loginFile: config.loginFile, onDrop: (why) => say(`Corporate proxy: ${why}`) });
  // Managed mode: the operator owns the proxy too (its env), so the settings file is never read.
  const settings = () => (managed || !dataDir ? {} : readSidecarSettings(dataDir));

  let connector = null;
  let currentKey = null;
  let upstreamError = null;
  let warnings = [];
  const keyOf = (np, login) => JSON.stringify([np, login && !login.error ? [login.id, login.savedAt, login.rejected && login.rejected.at] : login && login.error]);
  const server = createProxy({ ...(config.policy ? { policy: config.policy } : { allow: config.allow }),
    log: (line) => { if (/ DENY /.test(line)) say(line); } });

  /** Build the connector for the current settings and login; swap it in when either changed (D7: open tunnels finish on the old one). */
  function rebuild({ force = false } = {}) {
    const np = settings();
    const login = logins.current(np);
    const key = keyOf(np, login);
    if (!force && key === currentKey) return false;
    currentKey = key;
    const up = np.enabled === false ? null : resolveUpstream({ env, settings: np, login: login && !login.error ? login : null, anyScheme: !np.upstream });
    upstreamError = up && up.error ? up.error : null;
    warnings = up && !up.error ? up.warnings : [];
    if (login && login.error) say(`Corporate proxy: the saved login cannot be used (${login.error})`);
    const next = up && !up.error ? createUpstreamConnector(up, {
      log: (l) => say(`Corporate proxy: ${redactProxyLine(l)}`),
      startTripped: !!(up.login && up.login.rejected),
      onTrip: ({ upstream, loginId }) => {
        if (managed) logins.markManagedRejected(upstream, now);
        else if (loginId) markLoginRejected(loginId, { home: dataDir, upstream });
      },
    }) : null;
    server.useConnector(next, up && !up.error ? { connectTimeoutMs: up.timeouts.connectMs, idleTimeoutMs: up.timeouts.idleMs } : {});
    connector = next;
    const via = connector ? connector.status() : null;
    say(via ? `Corporate proxy: via ${via.upstream}${via.login ? `, logged in as ${via.login}` : ', no login'}${via.state === 'tripped' ? ' (proxy needs login)' : ''}`
      : `Corporate proxy: none${upstreamError ? ` (${upstreamError})` : ''}; connections go direct`);
    return true;
  }
  rebuild({ force: true });
  const stopWatch = dataDir && !managed ? watchProxyLogin(() => rebuild(), { home: dataDir, intervalMs: pollMs }) : () => {};
  let lastManaged = logins.managedSig();
  const managedTimer = managed ? setInterval(() => { const s = logins.managedSig(); if (s !== lastManaged) { lastManaged = s; rebuild(); } }, pollMs) : null;
  managedTimer?.unref();

  const ports = { proxy: await listen(server, config.port, config.host) };
  let api = null;
  if (config.secret) {
    api = createSidecarApi({ secret: config.secret, dataDir, env, managed, settings, logins, rebuild, now,
      live: () => connector, upstreamError: () => upstreamError, warnings: () => warnings,
      policy: () => (config.policy ? { mode: config.policy.mode, allow: config.policy.allow, deny: config.policy.deny } : { mode: 'allowlist', allow: config.allow, deny: [] }) });
    ports.api = await listen(api, config.apiPort, config.host);
  } else {
    say(`${EGRESS_SECRET_VAR} is not set: the internal API is off, so the login can only come from WORCA_EGRESS_LOGIN_FILE or the proxy URL`);
  }
  return {
    ports,
    connector: () => connector,
    rebuild,
    close: async () => {
      stopWatch(); if (managedTimer) clearInterval(managedTimer);
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      if (api) await new Promise((r) => { api.close(() => r()); api.closeAllConnections?.(); });
      connector?.close();
    },
  };
}

const CLIENT_VERBS = new Set(['status', 'login', 'logout', 'test']);

/** `worca egress [serve]` (the sidecar), or `worca egress status|login|logout|test` run INSIDE the sidecar
 *  (`worca container proxy …` execs these): they call this sidecar's own API on loopback. */
export async function runEgressCli(args = [], { env = process.env, out = (s) => process.stdout.write(`${s}\n`), fail = (s) => process.stderr.write(`worca egress: ${s}\n`) } = {}) {
  const sub = args[0] || 'serve';
  if (CLIENT_VERBS.has(sub)) {
    const { cmdProxy } = await import('../cli/proxy.mjs');
    const port = parsePort(env.WORCA_EGRESS_API_PORT, 3129);
    return cmdProxy([sub, ...args.slice(1)], { out, fail, env: { ...env, WORCA_EGRESS_API_URL: `http://127.0.0.1:${port}` } });
  }
  if (sub !== 'serve') { process.stderr.write('usage: worca egress [serve | status | login | logout | test]\n'); return 2; }
  const { config, errors } = readSidecarConfig(env);
  // Read once: no later code (and no child, though the sidecar starts none) sees the secret in the environment.
  delete env[EGRESS_SECRET_VAR]; delete env[`${EGRESS_SECRET_VAR}_FILE`];
  if (errors.length) { for (const e of errors) fail(e); return EX_CONFIG; }
  const s = await startEgressSidecar({ config, env });
  const what = config.policy ? `mode = ${config.policy.mode}` : `allow = ${config.allow.join(', ')}`;
  out(`worca egress sidecar (API v${SIDECAR_API_VERSION}) listening: proxy :${s.ports.proxy}${s.ports.api ? `, API :${s.ports.api}` : ''}; ${what}${config.loginFile ? '; login managed by the operator' : ''}`);
  await new Promise((resolve) => { for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { s.close().then(resolve); }); });
  return 0;
}
