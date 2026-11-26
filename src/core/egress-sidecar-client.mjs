// src/core/egress-sidecar-client.mjs — Worca's side of the egress sidecar's internal API (docs/network-proxy.md,
// "Worca in a container"). In a container setup the corporate proxy login lives in the sidecar (`worca egress`,
// src/egress/main.mjs), never in Worca's box: the box only knows where the API is and the shared secret.
//
//   WORCA_EGRESS_API_URL        the sidecar's internal API, e.g. http://egress:3129. Unset = no sidecar.
//   WORCA_EGRESS_SECRET(_FILE)  the shared secret for that API (32+ characters)
//
// The secret is handled like the broker's (src/core/broker-client.mjs sealBrokerSecret): read once, then both
// variables are removed from process.env before anything is spawned, so no agent, script, terminal or MCP server
// inherits the secret or the file's path. Calls go straight to the API on the compose network (node:http, no
// proxy), so they never pass through the proxy they configure.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { recordSecretFile } from './secret-files.mjs';

export const EGRESS_API_VAR = 'WORCA_EGRESS_API_URL';
export const EGRESS_SECRET_VAR = 'WORCA_EGRESS_SECRET';
export const MIN_SECRET = 32;
const CALL_TIMEOUT_MS = 20_000;   // a test runs two CONNECTs through the corporate proxy
const MAX_REPLY = 256 * 1024;

/** True when this process runs next to an egress sidecar that holds the proxy login (pure). */
export function sidecarConfigured(env = process.env) {
  return typeof env[EGRESS_API_VAR] === 'string' && env[EGRESS_API_VAR].trim() !== '';
}

/** A secret from NAME_FILE (preferred) or NAME. @returns {{value: string|null, error: string|null}} */
export function readSecretVar(env, name, readFile = readFileSync) {
  const file = String(env[`${name}_FILE`] || '').trim();
  if (file) {
    try {
      const v = String(readFile(file, 'utf8')).trim();
      return v ? { value: v, error: null } : { value: null, error: `${name}_FILE (${file}) is empty` };
    } catch (err) { return { value: null, error: `${name}_FILE (${file}) cannot be read: ${err.code || err.message}` }; }
  }
  const v = typeof env[name] === 'string' ? env[name].trim() : '';
  return { value: v || null, error: null };
}

let sealed = null;   // { value, error, file } once sealEgressSecret moved it out of process.env

/** Move the sidecar secret out of process.env (WORCA_EGRESS_SECRET, or the file WORCA_EGRESS_SECRET_FILE names, read
 *  once here) and delete both variables. ui/server.mjs and the CLI call this before anything can spawn. */
export function sealEgressSecret({ env = process.env, readFile = readFileSync } = {}) {
  const has = typeof env[EGRESS_SECRET_VAR] === 'string' || String(env[`${EGRESS_SECRET_VAR}_FILE`] || '').trim();
  if (!has) return;
  const file = String(env[`${EGRESS_SECRET_VAR}_FILE`] || '').trim();
  sealed = { ...readSecretVar(env, EGRESS_SECRET_VAR, readFile), file: file || null };
  if (file && env === process.env) recordSecretFile(`${EGRESS_SECRET_VAR}_FILE`, file);
  delete env[EGRESS_SECRET_VAR];
  delete env[`${EGRESS_SECRET_VAR}_FILE`];
}

/**
 * The variables that hand this process's sealed secret to the one child that needs it: `worca ui` seals it before it
 * starts ui/server.mjs, which talks to the sidecar (the Settings card, the move of an old login) and seals it again
 * itself. The file's name when it came from a file (the server reads and checks that file), else the value; {} when
 * nothing was sealed. Never pass this to any other child.
 */
export function egressSecretChildEnv() {
  if (!sealed) return {};
  if (sealed.file) return { [`${EGRESS_SECRET_VAR}_FILE`]: sealed.file };
  return sealed.value ? { [EGRESS_SECRET_VAR]: sealed.value } : {};
}

/** Tests: forget the sealed secret. */
export function _resetSealedEgressSecret() { sealed = null; }

/**
 * {url, secret, error} for the sidecar API, or null when there is no sidecar. The sealed secret wins; `env`'s own
 * variables are read when nothing was sealed (a test, or a caller that passes its own env).
 */
export function sidecarApiConfig(env = process.env, readFile = readFileSync) {
  if (!sidecarConfigured(env)) return null;
  let url = String(env[EGRESS_API_VAR]).trim().replace(/\/+$/, '');
  let error = null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') error = `${EGRESS_API_VAR} must be an http:// URL on the compose network`;
    else if (u.pathname !== '/' || u.search || u.username || u.password) error = `${EGRESS_API_VAR} must be an origin, e.g. http://egress:3129`;
    url = u.origin;
  } catch { error = `${EGRESS_API_VAR} is not a URL`; }
  const s = sealed && env === process.env ? sealed : readSecretVar(env, EGRESS_SECRET_VAR, readFile);
  if (s.error) error ||= s.error;
  else if (!s.value) error ||= `${EGRESS_SECRET_VAR} (or ${EGRESS_SECRET_VAR}_FILE) is required with ${EGRESS_API_VAR}`;
  else if (s.value.length < MIN_SECRET) error ||= `${EGRESS_SECRET_VAR} is too short: use at least ${MIN_SECRET} characters`;
  return { url, secret: s.value, error };
}

export class SidecarError extends Error {
  constructor(message, { status = 502, code = 'SIDECAR_UNREACHABLE' } = {}) { super(message); this.status = status; this.code = code; }
}

/**
 * One call to the sidecar API. Resolves {status, body}; rejects with SidecarError when the sidecar cannot be reached
 * or the config is broken. `body` (an object) is sent as JSON and never logged.
 * @param {{url: string, secret: string}} cfg
 */
export function callSidecar(cfg, method, path, body, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!cfg || cfg.error) { reject(new SidecarError(cfg ? cfg.error : 'no egress sidecar is configured', { code: 'SIDECAR_CONFIG' })); return; }
    const u = new URL(path, `${cfg.url}/`);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({ host: u.hostname, port: u.port || 80, method, path: u.pathname, agent: false, timeout: timeoutMs,
      headers: { authorization: `Bearer ${cfg.secret}`, accept: 'application/json',
        ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX_REPLY) { req.destroy(new Error('reply too large')); return; } parts.push(c); });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8') || 'null'); } catch { parsed = null; }
        if (res.statusCode === 401) { reject(new SidecarError('the egress sidecar refused the shared secret: WORCA_EGRESS_SECRET differs between Worca and the sidecar', { status: 502, code: 'SIDECAR_SECRET' })); return; }
        resolve({ status: res.statusCode, body: parsed });
      });
      res.on('error', (err) => reject(new SidecarError(`the egress sidecar failed (${err.code || err.message})`)));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => reject(new SidecarError(`the egress sidecar at ${cfg.url} cannot be reached (${err.code || err.message})`)));
    req.end(data || undefined);
  });
}

/** The client for this process's sidecar (sealed secret). Every method resolves {status, body}. */
export function sidecarClient(env = process.env) {
  const cfg = () => sidecarApiConfig(env);
  return {
    configured: () => sidecarConfigured(env),
    status: () => callSidecar(cfg(), 'GET', '/v1/status'),
    test: (body = {}) => callSidecar(cfg(), 'POST', '/v1/test', body),
    login: (body) => callSidecar(cfg(), 'POST', '/v1/login', body),
    logout: () => callSidecar(cfg(), 'POST', '/v1/logout', {}),
    settings: () => callSidecar(cfg(), 'GET', '/v1/settings'),
    saveSettings: (body) => callSidecar(cfg(), 'PUT', '/v1/settings', body),
  };
}
