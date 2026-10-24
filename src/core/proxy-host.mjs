// The corporate proxy's server-side logic (docs/network-proxy.md), shared by the /api/proxy routes,
// the chat's proxy bridge (POST /api/ask/proxy) and the proxy card's Apply. It owns the two pieces of
// process state those must agree on: the one-test-at-a-time lock and D14's since-boot marker.
import { networkProxySettings, setNetworkProxy } from './settings.mjs';
import { proxyState, readProxyLogin, markLoginRejected, upstreamEnv } from './proxy-credentials.mjs';
import { checkUpstream, resolveUpstream, upstreamLabel, fixedPortOf, localProxyUrl } from './upstream-proxy.mjs';

export const PROXY_AGENT_TEXT = 'The corporate proxy login cannot be changed or tested from inside the container while agent isolation is on. Open Worca through its published address.';

/**
 * @param {{ egress: () => object|null, io?: object }} o  egress: startEgressPolicy()'s result (null before boot / in tests)
 */
export function createProxyHost({ egress, io = {} } = {}) {
  const settings = io.settings ?? networkProxySettings;
  const saveNetworkProxy = io.saveNetworkProxy ?? setNetworkProxy;
  const readLogin = io.readLogin ?? readProxyLogin;
  const markRejected = io.markLoginRejected ?? markLoginRejected;
  const check = io.checkUpstream ?? checkUpstream;
  const envOf = io.env ?? (() => process.env);
  let testRunning = false;
  /** D14: true once a settings save changed the upstream in this process (a restart clears it). */
  let changedSinceBoot = false;

  const E = () => egress() || null;
  /** D13: the proxy variables as they were before the local proxy took HTTP(S)_PROXY, never the local URL. */
  const sourceEnv = () => upstreamEnv(E() && E().sourceEnv ? E().sourceEnv : envOf());
  const live = () => (E() && E().connector ? E().connector.status() : null);

  /** GET /api/proxy/status. */
  function status() {
    const eg = E();
    const fixed = fixedPortOf(settings());
    // A running proxy states its real URL; a proxy that failed to listen states no URL, only the error (D13).
    const localUrl = eg ? (eg.status === 'on' ? eg.url : null) : (fixed ? localProxyUrl(fixed) : null);
    const localError = eg && eg.status === 'off' && eg.upstreamError ? eg.upstreamError : null;
    return { ...proxyState({ env: sourceEnv(), networkProxy: settings(), login: readLogin(), live: live(), expectRunning: true, localUrl }),
      localError, settings: settings() };
  }

  /** get_network_proxy: the same facts, shaped for the chat. Built from loginView (proxyState) — never the hash. */
  function chatStatus() {
    const p = status();
    const l = live();
    const reasons = [];
    if (!l) reasons.push('no local proxy is running in this Worca: the flag was turned on after Worca started, or the upstream could not be used at start');
    if (changedSinceBoot) reasons.push('the upstream was changed since Worca started');
    const login = p.login;
    return {
      flag: true,
      state: p.state, line: p.line, error: p.error || null,
      upstream: p.upstream ? { hostPort: p.upstream, source: p.source, auth: p.auth, authLabel: p.authLabel } : null,
      settings: p.settings,
      local: { url: p.localUrl, running: p.running, error: p.localError },
      login: {
        present: !!login, account: login ? login.label : null, savedAt: login ? login.savedAt : null,
        rejected: !!(login && login.rejected), tripped: l ? l.state === 'tripped' : !!(login && login.rejected),
        error: p.loginError || null,
      },
      restart: { needed: reasons.length > 0, reasons },
      connector: l ? { upstream: l.upstream, auth: l.auth, source: l.source, account: l.login || null, state: l.state } : null,
      warnings: p.warnings || [],
    };
  }

  const refuse = (code, error) => ({ status: 409, body: { error, code } });

  /** POST /api/proxy/test. {status, body}; body {ok, upstream, results} on 200. */
  async function test() {
    if (testRunning) return refuse('TEST_RUNNING', 'a proxy test is already running');
    const login = readLogin();
    const up = resolveUpstream({ env: sourceEnv(), settings: settings(), login: login && !login.error ? login : null });
    if (!up) return refuse('NOT_CONFIGURED', 'no corporate proxy is set up: enter its host and port and Save');
    if (up.error) return refuse('UPSTREAM_INVALID', up.error);
    // D14: never send the saved hash to a host the running proxy does not use yet (a settings change waits for a restart).
    const l = live();
    // With no proxy running (flag turned on after boot), a host saved since boot is just as unproven.
    const unproven = l ? l.upstream !== upstreamLabel(up.host, up.port) : changedSinceBoot;
    if (unproven) return refuse('RESTART_NEEDED', `the saved proxy ${upstreamLabel(up.host, up.port)} is not in use yet: restart Worca, then Test`);
    testRunning = true;
    try {
      const r = await check(up, {
        startTripped: !!(up.login && up.login.rejected),
        onTrip: ({ upstream, loginId }) => { if (loginId) markRejected(loginId, { upstream }); },
      });
      E()?.reloadLogin?.();   // a trip here marked the file: the running connector stops at once
      return { status: 200, body: { ok: r.ok, upstream: r.upstream.upstream, results: r.results } };
    } finally {
      testRunning = false;
    }
  }

  /** PUT /api/proxy/settings and the proxy card's Apply. Throws the settings.mjs validation error. */
  async function saveSettings(patch) {
    const before = settings().upstream || '';
    const networkProxy = await saveNetworkProxy(patch ?? null);
    if ((networkProxy.upstream || '') !== before) changedSinceBoot = true;
    return { networkProxy, restartNeeded: true };
  }

  return { status, chatStatus, test, saveSettings, restarted: () => { changedSinceBoot = false; }, changedSinceBoot: () => changedSinceBoot };
}
