// The corporate proxy's server-side logic (docs/network-proxy.md), shared by the /api/proxy routes,
// the chat's proxy bridge (POST /api/ask/proxy) and the proxy card's Apply. It owns the two pieces of
// process state those must agree on: the one-test-at-a-time lock and the passed tests that let a
// save swap the upstream (D9).
import { networkProxySettings, setNetworkProxy, previewNetworkProxy, networkProxyEnabled, readSettings } from './settings.mjs';
import { proxyState, readProxyLogin, markLoginRejected, upstreamEnv, assertProxyLoginInput, savedLoginRefusal, ProxyLoginError } from './proxy-credentials.mjs';
import { ntHash } from './ntlm.mjs';
import { viaEnvUrl } from './egress-policy.mjs';
import { checkUpstream, resolveUpstream, upstreamKey, upstreamLabel, fixedPortOf, localProxyUrl } from './upstream-proxy.mjs';

export const PROXY_AGENT_TEXT = 'The corporate proxy login cannot be changed or tested from inside the container while agent isolation is on. Open Worca through its published address.';
/** How long a passing test lets a save swap to those values (D9). */
export const TESTED_TTL_MS = 10 * 60_000;
export { FIXED_PORT_NOTE } from '../shared/network-proxy-text.mjs';
import { FIXED_PORT_NOTE } from '../shared/network-proxy-text.mjs';
export const UNTESTED_TEXT = 'Test these proxy settings first: Worca switches to a new proxy only after it passed a test';

/**
 * @param {{ egress: () => object|null, apply?: (np: object) => Promise<object>|null, io?: object }} o
 *   egress: the running startEgressPolicy() result (null before boot / in tests). apply: startLiveEgress().apply.
 */
export function createProxyHost({ egress, apply = () => null, io = {} } = {}) {
  const settings = io.settings ?? networkProxySettings;
  const preview = io.preview ?? previewNetworkProxy;
  const enabledNow = io.enabled ?? (() => networkProxyEnabled(readSettings()));
  const now = io.now ?? Date.now;
  const saveNetworkProxy = io.saveNetworkProxy ?? setNetworkProxy;
  const readLogin = io.readLogin ?? readProxyLogin;
  const markRejected = io.markLoginRejected ?? markLoginRejected;
  const check = io.checkUpstream ?? checkUpstream;
  const envOf = io.env ?? (() => process.env);
  let testRunning = false;
  /** passKey (upstream + account) -> time of the passing test. */
  const passed = new Map();

  const E = () => egress() || null;
  /** D13: the proxy variables as they were before the local proxy took HTTP(S)_PROXY, never the local URL. */
  const sourceEnv = () => upstreamEnv(E() && E().sourceEnv ? E().sourceEnv : envOf());
  const live = () => (E() && E().connector ? E().connector.status() : null);

  /** The upstream `np` would use, resolved like the running proxy does (D13). `typed`: a login typed in the
   *  setup dialog (typedRecord), used instead of the saved one; it lives only in this call's memory. */
  const resolveFor = (np, typed = null) => {
    const login = typed || readLogin();
    return resolveUpstream({ env: sourceEnv(), settings: np, login: login && !login.error ? login : null });
  };
  /** A pass is keyed on the upstream AND the account it logged in as, so one account's pass never clears
   *  the gate for another. */
  const passKey = (up) => (up && !up.error ? `${upstreamKey(up)}|${up.login ? up.login.label : ''}` : '');
  /** The running upstream's key, resolved through the same resolveFor() as the candidate, so both sides
   *  share one format. The connector's status().auth can drift from the resolved auth after a login
   *  change (useLogin sets 'auto'/'none'), so it is never compared directly (architect-2-1). '' = nothing runs. */
  const runningKey = () => {
    const l = live();
    if (!l) return '';
    const up = resolveFor(settings());
    return up && !up.error && upstreamLabel(up.host, up.port) === l.upstream ? passKey(up) : '';
  };
  /** True when saving `np` would send traffic (and the login) to an upstream nobody tested (D9). */
  function untested(np, typed = null) {
    if (!(np && np.enabled === true)) return false;
    const up = resolveFor(np, typed);
    if (!up || up.error) return false;               // nothing to send to; the status line says why
    const key = passKey(up);
    if (key === runningKey()) return false;
    for (const [k, at] of passed) if (now() - at > TESTED_TTL_MS) passed.delete(k);   // prune expired passes
    return !passed.has(key);
  }

  /** GET /api/proxy/status. */
  function status() {
    const eg = E();
    const fixed = fixedPortOf(settings());
    // A running proxy states its real URL; a proxy that failed to listen states no URL, only the error (D13).
    const localUrl = eg ? (eg.status === 'on' ? eg.url : null) : (fixed ? localProxyUrl(fixed) : null);
    const localError = eg && eg.status === 'off' && eg.upstreamError ? eg.upstreamError : null;
    // A proxy started for the login in HTTPS_PROXY runs with networkProxy.enabled unset: its state, not "off".
    const auto = !enabledNow() && !!(eg && eg.autoStarted && eg.connector);
    return { ...proxyState({ env: sourceEnv(), networkProxy: auto ? viaEnvUrl(settings()) : settings(), login: readLogin(), live: live(),
      enabled: auto || enabledNow(), expectRunning: false, localUrl }),
      localError, settings: settings() };
  }

  /** get_network_proxy: the same facts, shaped for the chat. Built from loginView (proxyState) — never the hash. */
  function chatStatus() {
    const p = status();
    const l = live();
    const login = p.login;
    return {
      enabled: enabledNow(),
      state: p.state, line: p.line, error: p.error || null,
      upstream: p.upstream ? { hostPort: p.upstream, source: p.source, auth: p.auth, authLabel: p.authLabel } : null,
      settings: p.settings,
      local: { url: p.localUrl, running: p.running, error: p.localError },
      login: {
        present: !!login, account: login ? login.label : null, savedAt: login ? login.savedAt : null,
        rejected: !!(login && login.rejected), tripped: l ? l.state === 'tripped' : !!(login && login.rejected),
        error: p.loginError || null,
      },
      connector: l ? { upstream: l.upstream, auth: l.auth, source: l.source, account: l.login || null, state: l.state } : null,
      warnings: p.warnings || [],
    };
  }

  const refuse = (code, error) => ({ status: 409, body: { error, code } });

  /** A typed login as a readProxyLogin()-shaped record: the NT hash in memory, no id (a trip marks no file).
   *  @throws {ProxyLoginError} like apply's check */
  function typedRecord(login) {
    const account = assertProxyLoginInput(login && typeof login === 'object' ? login : {});
    return { id: '', ...account, ntHash: ntHash(login.password), savedAt: '', rejected: null };
  }

  /**
   * POST /api/proxy/test and the chat card's Apply. `candidate`: a networkProxy patch merged over the saved
   * values; none = the saved values. `record`: only a person's click (the UI route, the card's Apply) may
   * record a pass that later satisfies the UNTESTED gate; the chat tool test never records (D9).
   * `login`: the setup dialog's typed { domain, user, password }, used for this test only and never written
   * or logged; its NT hash goes only to the candidate upstream. Only a recorded test may take one.
   * {status, body}; body {ok, upstream, results} on 200.
   */
  async function test(candidate, { record = false, login } = {}) {
    if (testRunning) return refuse('TEST_RUNNING', 'a proxy test is already running');
    let np;
    try { np = candidate === undefined ? settings() : preview(candidate); } catch (err) { return { status: 400, body: { error: err.message, field: 'networkProxy' } }; }
    let typed = null;
    if (login !== undefined) {
      if (!record) return { status: 400, body: { error: 'this test uses the saved login only', field: 'login' } };
      const refusal = savedLoginRefusal(np && np.auth);
      if (refusal) return { status: 400, body: { error: refusal, field: 'login', code: 'BASIC_NO_SAVED_LOGIN' } };
      try { typed = typedRecord(login); } catch (err) {
        if (!(err instanceof ProxyLoginError)) throw err;
        return { status: 400, body: { error: err.message, field: `login.${err.field}` } };
      }
    }
    const up = resolveFor(np, typed);
    if (!up) return refuse('NOT_CONFIGURED', 'no corporate proxy is set up: enter its host and port, then Test');
    if (up.error) return refuse('UPSTREAM_INVALID', up.error);
    testRunning = true;
    try {
      const r = await check(up, {
        startTripped: !!(up.login && up.login.rejected),
        onTrip: ({ upstream, loginId }) => { if (loginId) markRejected(loginId, { upstream }); },
      });
      if (!r.ok) passed.delete(passKey(up));
      else if (record) passed.set(passKey(up), now());
      E()?.reloadLogin?.();   // a trip here marked the file: the running connector stops at once
      return { status: 200, body: { ok: r.ok, upstream: r.upstream.upstream, results: r.results } };
    } finally {
      testRunning = false;
    }
  }

  /** The UNTESTED gate alone, so setup apply can refuse before its one write (D9, D20). `login`: the login the
   *  same apply saves, so the gate asks for a pass with THAT account; an invalid one falls back to the saved
   *  login here (apply then names the bad field). Throws the networkProxy validation error. */
  function checkSave(patch, { login } = {}) {
    const next = preview(patch ?? null);
    let typed = null;
    if (login !== undefined) { try { typed = typedRecord(login); } catch (err) { if (!(err instanceof ProxyLoginError)) throw err; } }
    return { next, refused: untested(next, typed) ? refuse('UNTESTED', UNTESTED_TEXT) : null };
  }

  /** Swap in values that are already written: PUT /api/proxy/settings' tail, and setup apply's proxy-swap step. */
  async function applyWritten(networkProxy, beforeFixed) {
    const fallback = { changed: false, pending: fixedPortOf(networkProxy) !== beforeFixed ? ['fixedPort'] : [] };
    // The write already happened: a failed live apply is reported with the saved result, never turned into a 400.
    let out;
    try { out = (await apply(networkProxy)) || fallback; }
    catch (err) { out = { ...fallback, upstreamError: `saved, but not applied yet: ${err && err.message ? err.message : err}` }; }
    const pending = out.pending || [];
    return { networkProxy, applied: !!out.changed, restartNeeded: pending.length > 0, pending,
      notes: pending.includes('fixedPort') ? { fixedPort: FIXED_PORT_NOTE } : {},
      ...(out.upstreamError ? { upstreamError: out.upstreamError } : {}) };
  }

  /** PUT /api/proxy/settings and the chat card's Apply. Throws the settings.mjs validation
   *  error; refuses an untested upstream (409 UNTESTED) before writing anything. */
  async function saveSettings(patch) {
    const { refused } = checkSave(patch);
    if (refused) return { refused };
    const beforeFixed = fixedPortOf(settings());
    return applyWritten(await saveNetworkProxy(patch ?? null), beforeFixed);
  }

  return { status, chatStatus, test, saveSettings, checkSave, applyWritten, fixedPortNow: () => fixedPortOf(settings()) };
}
