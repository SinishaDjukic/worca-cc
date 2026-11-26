// src/core/proxy-host-sidecar.mjs — the corporate proxy's server-side logic in a container setup with the egress
// sidecar (docs/network-proxy.md, "Worca in a container"). Same interface as createProxyHost (proxy-host.mjs), so the
// /api/proxy routes, the setup assistant and the Chat proxy tools keep one seam: every call goes to the sidecar's
// internal API (src/egress/api.mjs). A typed password passes through this process in memory for that one call and is
// dropped; nothing is written in the box. The sidecar owns the login, its binding to the proxy and the lockout breaker;
// this side keeps only the UNTESTED gate (D9): a new proxy host, port or login mode must pass a Test first.
import { assertNetworkProxyInput, mergeNetworkProxy } from './settings.mjs';
import { parseUpstreamUrl, upstreamLabel } from './upstream-proxy.mjs';
import { stateLine, STATE_TEXT } from './proxy-credentials.mjs';
import { SidecarError } from './egress-sidecar-client.mjs';

/** The proxy the box's children use: compose.proxy.yml's sidecar. */
export const SIDECAR_LOCAL_URL = 'http://egress:3128';
export const MANAGED_NOTE = 'The corporate proxy login on this instance is managed by the operator. Worca shows its status only.';
const TTL_MS = 10 * 60_000;   // TESTED_TTL_MS in proxy-host.mjs
const SIDECAR_KEYS = ['enabled', 'upstream', 'auth', 'noProxy', 'timeouts'];
const UNTESTED = 'Test these proxy settings first: Worca switches to a new proxy only after it passed a test';

/** The networkProxy patch the sidecar takes: never fixedPort (the sidecar listens on its own port). */
export function sidecarPatch(patch) {
  if (patch === null || patch === '') return null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const { fixedPort: _f, ...rest } = patch;
  return rest;
}

/** The sidecar's status in the shape the card, the setup assistant and the CLI read (proxyHost.status()). */
export function sidecarView(b) {
  const s = { ...(b && b.settings && typeof b.settings === 'object' ? b.settings : {}) };
  // The proxy from the sidecar's HTTPS_PROXY (.env) fills the form too; saving it again keeps the login (same host:port).
  if (!s.upstream && b.upstream) s.upstream = `http://${b.upstream}`;
  s.enabled = s.enabled !== false && !!b.upstream;
  return { ...b, settings: s, localUrl: SIDECAR_LOCAL_URL, localError: b.upstreamError || null, sidecar: true, managed: !!b.managed,
    ...(b.managed ? { managedNote: MANAGED_NOTE } : {}) };
}

/** The status when the sidecar cannot be reached: state error, the reason as the line. */
function unreachable(err) {
  const st = { state: 'error', text: STATE_TEXT.error, error: err.message, login: null, loginError: null, running: false,
    restartNeeded: false, warnings: [], settings: {}, localUrl: SIDECAR_LOCAL_URL, localError: err.message, sidecar: true, managed: false };
  return { ...st, line: stateLine(st) };
}

const hostPortOf = (up) => { if (!up) return null; const p = parseUpstreamUrl(up); return p.error ? null : upstreamLabel(p.host, p.port); };

/**
 * @param {{client: ReturnType<import('./egress-sidecar-client.mjs').sidecarClient>, now?: () => number}} o
 */
export function createSidecarProxyHost({ client, now = Date.now }) {
  /** "host:port|auth" -> time of a passing Test the person ran. */
  const passed = new Map();
  const call = async (fn) => {
    try { return await fn(); } catch (err) {
      if (err instanceof SidecarError) return { status: 502, body: { error: err.message, code: err.code } };
      throw err;
    }
  };
  async function raw() {
    const r = await call(() => client.status());
    if (r.status !== 200 || !r.body) throw new SidecarError(r.body && r.body.error ? r.body.error : `the egress sidecar answered ${r.status}`);
    return r.body;
  }
  async function status() {
    try { return sidecarView(await raw()); } catch (err) { if (err instanceof SidecarError) return unreachable(err); throw err; }
  }
  /** host:port and auth the settings `np` point at; `fallback` is the sidecar's own proxy (its HTTPS_PROXY). */
  const keyOf = (np, fallback) => `${hostPortOf(np.upstream) || fallback || ''}|${np.auth || 'auto'}`;
  /** True when saving `patch` would send traffic to a proxy (or a login mode) nobody tested. */
  function untested(cur, next) {
    if (!next || next.enabled === false) return false;
    if (keyOf(next, cur.upstream) === keyOf(cur.settings || {}, cur.upstream)) return false;
    for (const [k, at] of passed) if (now() - at > TTL_MS) passed.delete(k);
    return !passed.has(keyOf(next, cur.upstream));
  }
  const refuse = (status, body) => ({ status, body });

  return {
    sidecar: true,
    status,
    async chatStatus() {
      const p = await status();
      const login = p.login;
      const l = p.running ? { state: p.state === 'needs-login' ? 'tripped' : p.state } : null;
      return {
        enabled: !!p.settings.enabled, state: p.state, line: p.line, error: p.error || null,
        upstream: p.upstream ? { hostPort: p.upstream, source: 'sidecar', auth: p.auth, authLabel: p.authLabel } : null,
        settings: p.settings, local: { url: p.localUrl, running: !!p.running, error: p.localError },
        login: { present: !!login, account: login ? login.label : null, savedAt: login ? login.savedAt : null,
          rejected: !!(login && login.rejected), tripped: p.state === 'needs-login', error: p.loginError || null },
        connector: l && p.upstream ? { upstream: p.upstream, auth: p.auth, source: 'sidecar', account: login ? login.label : null, state: l.state } : null,
        warnings: p.warnings || [], sidecar: true, managed: !!p.managed,
      };
    },
    /** POST /api/proxy/test: `candidate` a networkProxy patch, `login` a typed login for this one test. */
    async test(candidate, { record = false, login } = {}) {
      if (login !== undefined && !record) return refuse(400, { error: 'this test uses the saved login only', field: 'login' });
      const body = {};
      if (candidate !== undefined) {
        try { assertNetworkProxyInput(candidate); } catch (err) { return refuse(400, { error: err.message, field: 'networkProxy' }); }
        body.networkProxy = sidecarPatch(candidate);
      }
      if (login !== undefined) body.login = login;
      const r = await call(() => client.test(body));
      if (r.status === 200 && r.body && r.body.ok && record) {
        try {
          const cur = await raw();
          const next = candidate === undefined ? (cur.settings || {}) : mergeNetworkProxy(cur.settings || {}, sidecarPatch(candidate) || {});
          passed.set(keyOf(next, cur.upstream), now());
        } catch { /* no pass recorded; Save asks for a Test again */ }
      }
      return { status: r.status, body: r.body || {} };
    },
    /** Setup apply's gate before its one write. `next` is the merged value (the box keeps a copy in settings.json). */
    async checkSave(patch) {
      assertNetworkProxyInput(patch ?? null);
      const cur = await raw();
      const next = mergeNetworkProxy(cur.settings || {}, sidecarPatch(patch ?? null) || {});
      if (cur.managed) return { next, refused: refuse(409, { error: MANAGED_NOTE, code: 'MANAGED' }) };
      return { next, refused: untested(cur, next) ? refuse(409, { error: UNTESTED, code: 'UNTESTED' }) : null };
    },
    /** The proxy-swap step of setup apply: the written networkProxy goes to the sidecar as a whole. */
    async applyWritten(networkProxy) {
      const patch = Object.fromEntries(SIDECAR_KEYS.map((k) => [k, networkProxy && networkProxy[k] !== undefined ? networkProxy[k] : null]));
      const r = await call(() => client.saveSettings({ networkProxy: patch }));
      const base = { networkProxy, restartNeeded: false, pending: [], notes: {} };
      if (r.status !== 200) return { ...base, applied: false, upstreamError: `the egress sidecar did not take the proxy settings: ${r.body && r.body.error ? r.body.error : r.status}` };
      return { ...base, applied: true, ...(r.body.loginDropped ? { loginDropped: true } : {}) };
    },
    /** PUT /api/proxy/settings and the chat card's Apply. Throws the validation error; refuses an untested proxy. */
    async saveSettings(patch) {
      assertNetworkProxyInput(patch ?? null);
      let cur;
      try { cur = await raw(); } catch (err) { if (err instanceof SidecarError) return { refused: refuse(502, { error: err.message, code: 'SIDECAR_UNREACHABLE' }) }; throw err; }
      if (cur.managed) return { refused: refuse(409, { error: MANAGED_NOTE, code: 'MANAGED' }) };
      const next = mergeNetworkProxy(cur.settings || {}, sidecarPatch(patch ?? null) || {});
      if (patch !== null && patch !== '' && untested(cur, next)) return { refused: refuse(409, { error: UNTESTED, code: 'UNTESTED' }) };
      const r = await call(() => client.saveSettings({ networkProxy: sidecarPatch(patch ?? null) }));
      if (r.status !== 200) return { refused: refuse(r.status === 400 ? 400 : r.status, r.body || { error: `the egress sidecar answered ${r.status}` }) };
      return { networkProxy: r.body.networkProxy, applied: true, restartNeeded: false, pending: [], notes: {},
        ...(r.body.loginDropped ? { loginDropped: true } : {}) };
    },
    /** POST /api/proxy/login. The password is sent once and not kept. @returns {{status, body}} body = the status view on 200 */
    async login({ domain = '', user, password } = {}) {
      const r = await call(() => client.login({ ...(domain ? { domain } : {}), user, password }));
      return r.status === 200 ? { status: 200, body: sidecarView(r.body) } : { status: r.status, body: r.body || {} };
    },
    async logout() {
      const r = await call(() => client.logout());
      return r.status === 200 ? { status: 200, body: sidecarView(r.body) } : { status: r.status, body: r.body || {} };
    },
    /** GET /api/proxy/detect: the box's own environment points at the sidecar, so the sidecar's proxy is the answer. */
    async detect() {
      const p = await status();
      if (!p.upstream) return { found: false, source: 'sidecar', line: p.state === 'error' ? p.line : 'The egress sidecar has no corporate proxy yet: enter its host and port.' };
      const i = p.upstream.lastIndexOf(':');
      const noProxy = Array.isArray(p.settings.noProxy) ? p.settings.noProxy : String(p.settings.noProxy || '').split(',').map((x) => x.trim()).filter(Boolean);
      return { found: true, source: 'sidecar', host: p.upstream.slice(0, i).replace(/^\[|\]$/g, ''), port: Number(p.upstream.slice(i + 1)), noProxy, also: [],
        line: `From the egress sidecar, which logs in to ${p.upstream}.` };
    },
    fixedPortNow: () => 0,
  };
}
