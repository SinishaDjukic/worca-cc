// extension/src/worca-client.mjs — the extension's only door to worca (sidebar + service worker; never a content
// script). Local-only (docs/browser-extension.md): http on a loopback host.
import { BUILD_BASE_URL } from './build-flags.mjs';

// The address a fresh install tries: the build's (tools/build-extension.mjs, WORCA_EXT_PORT / WORCA_EXT_BASE_URL, for
// testing), else worca's default port. An address saved in Connection settings always wins over it.
export const DEFAULT_BASE_URL = BUILD_BASE_URL || 'http://127.0.0.1:4317';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class WorcaError extends Error {
  constructor(kind, message, { status = 0, code = null } = {}) { super(message); this.kind = kind; this.status = status; this.code = code; }
}

export function normalizeBaseUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return null;
  return `${u.protocol}//${u.host}`;
}

/** The extension's own origin ("chrome-extension://<id>", "moz-extension://<uuid>"): runtime.getURL('') minus its slash. */
export function selfOriginOf(runtime) {
  try { const u = runtime && typeof runtime.getURL === 'function' ? String(runtime.getURL('')) : ''; return u ? u.replace(/\/$/, '') : null; } catch { return null; }
}

/** @param {{fetch:Function, getConfig:() => Promise<{baseUrl:string, token:string|null}>, selfOrigin?:string|null}} o
 *  selfOrigin: sent as X-Worca-Extension on every call. Chrome sends no Origin on an extension's GET to a host the
 *  extension holds a grant for (activeTab on the tab showing Worca); the server then reads this header instead. */
export function createWorcaClient({ fetch: f, getConfig, selfOrigin = null }) {
  async function call(path, { method = 'GET', body, auth = true, signal, raw = false, headers: extra = {} } = {}) {
    const { baseUrl: rawBase, token } = await getConfig();
    // Enforce the loopback rule here, so the token can never be sent anywhere but loopback, whatever storage holds.
    const baseUrl = normalizeBaseUrl(rawBase);
    if (!baseUrl) throw new WorcaError('offline', 'The Worca address must be http on 127.0.0.1, localhost or [::1]');
    const headers = { ...extra };
    if (selfOrigin) headers['X-Worca-Extension'] = selfOrigin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await f(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: 'omit', cache: 'no-store' });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new WorcaError('offline', `Worca is not running at ${baseUrl}`);
    }
    if (raw) return res;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const code = (data && data.code) || null;
      const kind = code === 'extension-unpaired' ? 'unpaired' : code === 'extension-remote-mode' ? 'remote' : 'http';
      throw new WorcaError(kind, (data && data.error) || `request failed (${res.status})`, { status: res.status, code });
    }
    return data;
  }
  async function wsUrl() {
    const baseUrl = normalizeBaseUrl((await getConfig()).baseUrl);
    if (!baseUrl) throw new WorcaError('offline', 'The Worca address must be http on 127.0.0.1, localhost or [::1]');
    return `${baseUrl.replace(/^http/, 'ws')}/ws`;
  }
  return { call, wsUrl };
}
