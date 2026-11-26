// src/egress/store.mjs — what the egress sidecar keeps on its own volume (docs/network-proxy.md, "Worca in a
// container"): the corporate proxy settings and the saved login. Nothing here is ever in Worca's box.
//
//   <dataDir>/proxy-settings.json   { upstream, auth, noProxy, timeouts, enabled }: the networkProxy shape of
//                                   settings.json, without fixedPort (the sidecar listens on its own port).
//   <dataDir>/proxy-login.json      the saved login, the record and file guards of src/core/proxy-credentials.mjs,
//                                   plus `upstream`: the host:port it was saved for. A login whose `upstream`
//                                   is not the proxy in use is deleted, never sent (bound to its proxy).
//   WORCA_EGRESS_LOGIN_FILE         managed mode: the operator's login, {domain, user, ntHash} (from `worca proxy
//                                   hash`), read-only. Every write call is then refused.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../core/json-atomic.mjs';
import { assertNetworkProxyInput, mergeNetworkProxy } from '../core/settings.mjs';
import { readProxyLogin, clearProxyLoginPlain, parseLoginRecord } from '../core/proxy-credentials.mjs';
import { resolveUpstream, upstreamLabel } from '../core/upstream-proxy.mjs';

export const SETTINGS_FILE = 'proxy-settings.json';

/** The sidecar's settings (never throws): {} when there are none, {error} kept out (a broken file reads as {}). */
export function readSidecarSettings(dataDir) {
  try {
    const v = JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Validate a settings patch strictly (settings.mjs rules, and no fixedPort). @throws {Error} */
export function assertSidecarSettings(patch) {
  if (patch && typeof patch === 'object' && !Array.isArray(patch) && Object.prototype.hasOwnProperty.call(patch, 'fixedPort')) {
    throw new Error('networkProxy.fixedPort does not apply to the egress sidecar: it listens on its own port');
  }
  assertNetworkProxyInput(patch);
}

/** The merged settings `patch` would give, validated. Pure. @throws {Error} */
export function previewSidecarSettings(current, patch) {
  assertSidecarSettings(patch);
  return mergeNetworkProxy(current, patch);
}

export function writeSidecarSettings(dataDir, next) {
  writeJsonAtomic(join(dataDir, SETTINGS_FILE), next || {}, { mode: 0o600 });
}

/** The env the upstream resolves from: the sidecar's own HTTP(S)_PROXY / NO_PROXY. */
const upstreamFrom = (env, np) => (np && np.enabled === false ? null : resolveUpstream({ env, settings: np, login: null }));

/** "host:port" of the corporate proxy `np` (over `env`) points at, or null. */
export function upstreamLabelOf(env, np) {
  const up = upstreamFrom(env, np);
  return up && !up.error ? upstreamLabel(up.host, up.port) : null;
}

/**
 * The login source of a sidecar. `current(np)` returns what readProxyLogin returns (null | {error} | record), with
 * the bound-to-its-proxy rule applied: a saved login for another host:port is deleted and `onDrop` told.
 * Managed: the operator's file, read whenever it changed; a rejection lives in memory only (the file is read-only).
 * @param {{dataDir: string, env: object, loginFile?: string|null, onDrop?: (why: string) => void}} o
 */
export function createLoginSource({ dataDir, env, loginFile = null, onDrop = () => {} }) {
  let managedCache = { sig: '', rec: null };
  let managedRejected = null;
  const managedSig = () => { try { const st = statSync(loginFile); return `${st.ino}|${st.mtimeMs}|${st.size}`; } catch (err) { return err.code || 'error'; } };
  function readManaged() {
    const sig = managedSig();
    if (sig !== managedCache.sig) {
      let rec;
      try { rec = parseLoginRecord(readFileSync(loginFile, 'utf8')); } catch (err) { rec = { error: `WORCA_EGRESS_LOGIN_FILE cannot be read (${err.code || 'error'})` }; }
      if (rec && rec.error && !rec.error.startsWith('WORCA_EGRESS_LOGIN_FILE')) rec = { error: `WORCA_EGRESS_LOGIN_FILE: ${rec.error}` };
      managedCache = { sig, rec };
      managedRejected = null;   // a new file is a new login
    }
    const r = managedCache.rec;
    return r && !r.error ? { ...r, rejected: managedRejected } : r;
  }
  return {
    managed: !!loginFile,
    /** The sig the watcher compares, so a rotated operator file is picked up. */
    managedSig: () => (loginFile ? managedSig() : ''),
    current(np) {
      if (loginFile) return readManaged();
      const rec = readProxyLogin({ home: dataDir });
      if (!rec || rec.error) return rec;
      const label = upstreamLabelOf(env, np);
      if (!rec.upstream || rec.upstream !== label) {
        clearProxyLoginPlain({ home: dataDir });
        onDrop(rec.upstream
          ? `the saved login for ${rec.user} was for ${rec.upstream}, and the corporate proxy is now ${label || 'not set'}, so it was deleted; log in again`
          : `the saved login for ${rec.user} names no corporate proxy, so it was deleted; log in again`);
        return null;
      }
      return rec;
    },
    /** Managed only: remember that the corporate proxy refused the operator's login. */
    markManagedRejected(upstream, now = Date.now) { managedRejected = { at: new Date(now()).toISOString(), upstream }; },
  };
}
