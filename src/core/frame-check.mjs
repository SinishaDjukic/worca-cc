// src/core/frame-check.mjs — does a public site refuse being shown inside Worca's page (issue 1064 §3)? The browser
// cannot tell (a refused cross-origin frame looks like any page), so the server asks the site once per origin and the
// answer is cached. SSRF-safe: only http(s) on the default port, no login, a public host name or public IP literal;
// every DNS answer is checked at connect time (guardedLookup) and every redirect hop is checked again; a short
// deadline; HEAD, then GET only when HEAD is refused (its body is never read); no cookies, no shared agent.
// The verdict: { framable: true | false | null, reason } — null means unknown (never fetched, or failed): the tab frames
// the page and its own "If the page does not show…" hint stays.
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { isLoopbackName } from '../shared/preview-url.mjs';
import { framingRefused } from './preview-proxy.mjs';
import { checkWebUrl, guardedLookup, httpsTransport, isBlockedAddress } from './ask/web-fetch.mjs';
import { PRIVATE_SUFFIX_RE } from './tab-tools.mjs';

export const FRAME_CHECK_LIMITS = Object.freeze({ timeoutMs: 4000, maxRedirects: 3, okTtlMs: 60 * 60_000, unknownTtlMs: 60_000,
  cacheMax: 500, inflightMax: 16 });
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// An IPv6 literal reaches isBlockedAddress (unbracketed `::1` is not a loopback NAME): `[::1]` reads private-address.
const HEADERS = Object.freeze({ 'user-agent': 'Mozilla/5.0 (compatible; worca frame check)', accept: 'text/html,*/*;q=0.5' });

/** Why the check never fetches `u`, or null. */
export function checkTarget(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme';
  if (u.username || u.password) return 'login';
  if (u.port) return 'port';                          // WHATWG drops a default port: any port left is not the default
  const h = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!h || isLoopbackName(h)) return 'loopback';
  if (isIP(h)) return isBlockedAddress(h) ? 'private-address' : null;
  if (!h.includes('.') || PRIVATE_SUFFIX_RE.test(h)) return 'private-name';
  return null;
}

function httpTransport({ url, method, signal, lookup, headers }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers, lookup, signal, agent: false }, (res) => {
      resolve({ status: res.statusCode || 0, headers: res.headers, destroy: () => res.destroy() });
    });
    req.on('error', reject);
    req.end();
  });
}
/** One request, headers only, always direct. Never through an env proxy: the proxy resolves the name itself, so the
 *  guarded lookup would vet the wrong address (a split-horizon or rebinding name reaches the proxy's network). A
 *  proxy-only network gets `null` (network) and the tab's own hint stays. */
export function defaultTransport(o) {
  return o.url.protocol === 'https:' ? httpsTransport({ ...o, env: {} }) : httpTransport(o);
}

/** `proxied()`: true while Worca's egress proxy is in force (on, or inherited from a parent Worca). The check always
 *  dials direct (above), so it asks nothing then: a locked-down install's policy and proxy cover every request it makes. */
export function createFrameCheck({ transport = defaultTransport, lookup = guardedLookup, now = () => Date.now(), limits = FRAME_CHECK_LIMITS,
  proxied = () => false } = {}) {
  const cache = new Map();     // origin → { at, verdict }
  const inflight = new Map();  // origin → promise

  async function probe(start, pageOrigins, signal, policy) {
    let u = start;
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      const why = checkTarget(u);
      if (why) return { framable: null, reason: why };
      // A remote Worca: every hop is on the chat's allowlist too (an open redirector on an allowed host is no way out).
      if (policy && hop > 0) {
        try { checkWebUrl(u.href, policy.allowedDomains, { redirect: true }); } catch { return { framable: null, reason: 'not-allowlisted' }; }
      }
      let res = await transport({ url: u, method: 'HEAD', signal, lookup, headers: { ...HEADERS } });
      try {
        if (res.status === 405 || res.status === 501) {
          res.destroy();
          res = await transport({ url: u, method: 'GET', signal, lookup, headers: { ...HEADERS } });
        }
        if (REDIRECTS.has(res.status) && res.headers.location) {
          let next;
          try { next = new URL(String(res.headers.location), u); } catch { return { framable: null, reason: 'bad-redirect' }; }
          u = next;
          continue;
        }
        const refused = framingRefused(res.headers || {}, pageOrigins);
        return refused ? { framable: false, reason: refused } : { framable: true, reason: null };
      } finally { res.destroy(); }
    }
    return { framable: null, reason: 'redirects' };
  }

  return {
    /** `policy` (a remote Worca): the chat's { enabled, allowedDomains } — off or not allowlisted asks nothing. */
    async check(raw, { pageOrigins = [], policy = null } = {}) {
      let u;
      try { u = new URL(String(raw)); } catch { return { framable: null, reason: 'bad-url' }; }
      if (policy) {
        if (policy.enabled !== true) return { framable: null, reason: 'web-off' };
        try { checkWebUrl(u.href, policy.allowedDomains); } catch { return { framable: null, reason: 'not-allowlisted' }; }
      }
      const pre = checkTarget(u);
      if (pre) return { framable: null, reason: pre };
      if (proxied()) return { framable: null, reason: 'proxy' };
      // The verdict depends on the asking page (frame-ancestors) and the policy (redirect hops), not only the origin.
      const key = `${u.origin} ${[...pageOrigins].sort().join(' ')} ${policy ? (policy.allowedDomains || []).join(',') : '-'}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < (hit.verdict.framable === null ? limits.unknownTtlMs : limits.okTtlMs)) return { ...hit.verdict, cached: true };
      if (inflight.has(key)) return inflight.get(key);
      if (inflight.size >= limits.inflightMax) return { framable: null, reason: 'busy' };
      const p = (async () => {
        let verdict;
        // A held timer, not AbortSignal.timeout (unref'd): the deadline must fire even when nothing else keeps the
        // event loop alive, and it holds for a transport that never settles (it would hold an in-flight slot forever).
        const ctl = new AbortController();
        const signal = ctl.signal;
        const timer = setTimeout(() => ctl.abort(new DOMException('The frame check timed out', 'TimeoutError')), limits.timeoutMs);
        const deadline = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        deadline.catch(() => {});
        try { verdict = await Promise.race([probe(u, pageOrigins, signal, policy), deadline]); }
        catch (e) {
          verdict = { framable: null, reason: e?.code === 'EWORCA_BLOCKED' ? 'private-address'
            : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network' };
        } finally { clearTimeout(timer); }
        cache.delete(key);
        cache.set(key, { at: now(), verdict });
        while (cache.size > limits.cacheMax) cache.delete(cache.keys().next().value);
        return verdict;
      })();
      inflight.set(key, p);
      try { return await p; } finally { inflight.delete(key); }
    },
  };
}
