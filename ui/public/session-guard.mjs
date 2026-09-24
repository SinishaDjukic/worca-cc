// Session expiry behind an identity proxy (docs/remote-access.md). When the
// Cloudflare Access session runs out, every same-origin request is redirected
// to the proxy's sign-in page on another origin: fetch() fails with a bare
// TypeError (CORS) and the WebSocket cannot reconnect, so the UI would just look
// broken. This module tells that case apart from "server down" and shows one
// banner with a reload button. Locally (no proxy) it never fires: a down
// server fails the probe too, and worca itself never redirects /api/health.

const PROBE_MIN_MS = 10_000;

/**
 * Wraps `win.fetch` once. Returns `{ check }`: call it when something failed in
 * a way that could be an expired session (e.g. the WebSocket closed).
 */
export function installSessionGuard({ win = window, doc = document, reload = () => win.location.reload() } = {}) {
  if (win.__worcaSessionGuard) return win.__worcaSessionGuard;
  const origFetch = win.fetch.bind(win);
  let lastProbe = 0;
  let probing = null;
  let shown = false;

  const sameOrigin = (input) => {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input), win.location.href);
      return url.origin === win.location.origin;
    } catch { return false; }
  };

  function showBanner(reason) {
    if (shown) return;
    shown = true;
    const bar = doc.createElement('div');
    bar.className = 'session-expired';
    bar.setAttribute('role', 'alert');
    bar.dataset.reason = reason;
    const text = doc.createElement('span');
    text.className = 'se-text';
    text.textContent = reason === 'unauthorized'
      ? 'Worca could not confirm your sign-in.'
      : 'Your sign-in has expired.';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'se-reload';
    btn.textContent = 'Sign in again';
    btn.addEventListener('click', () => reload());
    bar.append(text, btn);
    doc.body.prepend(bar);
  }

  // A manual-redirect probe of an unauthenticated route: an opaque redirect
  // can only come from a proxy in front of worca asking for a new sign-in.
  function check() {
    if (shown || probing) return probing || Promise.resolve();
    const now = Date.now();
    if (now - lastProbe < PROBE_MIN_MS) return Promise.resolve();
    lastProbe = now;
    probing = origFetch('/api/health', { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' })
      .then((r) => { if (r.type === 'opaqueredirect' || r.status === 401) showBanner('expired'); })
      .catch(() => { /* server unreachable: not a session problem */ })
      .finally(() => { probing = null; });
    return probing;
  }

  win.fetch = async (input, init) => {
    try {
      const res = await origFetch(input, init);
      if (res.status === 401 && sameOrigin(input)) showBanner('unauthorized');
      return res;
    } catch (err) {
      if (sameOrigin(input) && err?.name !== 'AbortError') check();
      throw err;
    }
  };

  win.__worcaSessionGuard = { check };
  return win.__worcaSessionGuard;
}
