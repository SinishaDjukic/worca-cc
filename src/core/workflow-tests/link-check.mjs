// src/core/workflow-tests/link-check.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9). Each link is opened through
// Ask's guarded transport, with Ask's URL rule on every hop (web-fetch.mjs checkWebUrl, without its allowlist and data rules):
// https only (http is tried as https), no credentials, no IP-address host, no port but 443, and a host name that resolves to
// public addresses only (guardedLookup). The URL rule is what keeps private addresses out: on the direct path Node never calls
// `lookup` for an IP-address host. The proxy env is honoured, no cookies, no body read. Worca itself makes these calls, at check time.
import { isIP } from 'node:net';
import { httpsTransport, looksLikeData, WEB_LIMITS } from '../ask/web-fetch.mjs';
import { linksIn } from '../../shared/workflow-tests/exact-checks.mjs';

/** The transport used when none is given: Ask's httpsTransport, whose default lookup is guardedLookup (no `lookup` is ever passed
 *  here). An object only so a test can prove it is the default without opening a real connection. */
export const linkDefaults = { transport: httpsTransport };
export const LINKS_MAX = 20;
export const LINK_TIMEOUT_MS = 15_000;
/** M19: one check starts no new link after two minutes (20 links × 4 hops × 15 s would be 20 minutes). */
export const LINKS_DEADLINE_MS = 120_000;
const LINK_REDIRECTS = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** P4-Q9: the site answered but refuses automated visitors; Worca cannot tell more, so the link counts as working. */
const REFUSES_BOTS = new Set([401, 403, 429]);
const HEADERS = Object.freeze({ 'user-agent': 'worca-link-check/1', accept: '*/*' });
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** N9 for the host name: the name itself is sent (in the DNS query, to the domain's own name server) before any connection, so a
 *  host can carry data as well as a path. Ask needs no such rule (its allowlist fixes the hosts); here any public host can be named.
 *  The labels checked are those left of the last two (roughly the registrable part: "docs" in docs.github.com, "s3" and
 *  "eu-central-1" in s3.eu-central-1.amazonaws.com): a domain's owner makes those up freely, not the ones right of them.
 *  A host may carry data when:
 *  - it is longer than 100 characters, or
 *  - a checked label is longer than 24 characters and not word-like (Ask's own test, looksLikeData with a 25-character run:
 *    every -/_ part letters only and at most 20 long, digits only, or at most 4 long), or
 *  - a checked label, without its hyphens, has 16 or more letters and digits and looks encoded: hex with a digit in it, or 3 or
 *    more changes between letters and digits, or fewer than a quarter of its letters vowels (a e i o u y). Base32, base64 and
 *    hex read like that; words, product names and region codes do not.
 *  A host wrongly taken for data only means the link is not opened (and does not count against the result). */
const HOST_MAX_CHARS = 100;
const LABEL_WORDY_CHARS = 25;
const LABEL_ENCODED_CHARS = 16;
function labelLooksEncoded(label) {
  const s = label.replace(/-/g, '');
  if (s.length < LABEL_ENCODED_CHARS || !/^[a-z0-9]+$/.test(s)) return false;
  if (/^[0-9a-f]+$/.test(s) && /\d/.test(s)) return true;
  if ((s.match(/[a-z](?=\d)|\d(?=[a-z])/g) || []).length >= 3) return true;
  const letters = s.replace(/\d/g, '');
  return (letters.match(/[aeiouy]/g) || []).length * 4 < letters.length;
}
function hostCarriesData(hostname) {
  if (hostname.length > HOST_MAX_CHARS) return true;
  return hostname.toLowerCase().split('.').slice(0, -2).some((l) => looksLikeData(l, LABEL_WORDY_CHARS) || labelLooksEncoded(l));
}

/** N9: Ask's data rule (checkWebUrl, web-fetch.mjs:42, :53-55): a link whose URL is too long or looks like it carries encoded data is
 *  never opened, and here the host name too (above). Worca would otherwise send whatever a result wrote into a link (an example's
 *  data, say) to any public host. */
export function linkCarriesData(url) {
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const q = url.search.replace(/^\?/, '');
  return url.href.length > WEB_LIMITS.urlMaxChars || q.length > WEB_LIMITS.queryMaxChars || url.pathname.length > WEB_LIMITS.pathMaxChars
    || hostCarriesData(url.hostname) || looksLikeData(dec(url.pathname)) || looksLikeData(dec(q));
}

/** C1: Ask's URL rule for one hop. A URL with credentials, an IP-address host or a port other than 443 is never dialled. */
export function linkUrlOk(url) {
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port) return false;                                     // the URL parser drops an explicit :443
  return !isIP(url.hostname.replace(/^\[|\]$/g, ''));             // also catches 2130706433 and 0x7f.1 (the parser makes them 127.0.0.1)
}

/** A hop's promise, or a rejection as soon as `signal` aborts, even when the transport ignores the signal (the cap stays hard). */
function untilAborted(p, signal) {
  const close = () => p.then((r) => { try { r.destroy(); } catch { /* gone */ } }, () => {});   // a late answer is closed, never read
  if (signal.aborted) { close(); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const onAbort = () => { close(); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then((r) => { signal.removeEventListener('abort', onAbort); resolve(r); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

/** One link: 'works' (2xx, or 401/403/429), 'broken' (an HTTP error answer, a refused URL or address, a 4th redirect, or a redirect
 *  target that fails), 'unreached' (I12: the first hop got no answer, for any reason but a private address: no such host, refused,
 *  reset, a TLS failure such as an intercepting network's, timed out; or `signal`, the check's deadline, cut the link off on any hop)
 *  or 'skipped' (N9: it may carry data). */
export async function linkState(raw, { transport = linkDefaults.transport, timeoutMs = LINK_TIMEOUT_MS, signal = null } = {}) {
  let url;
  try { url = new URL(raw); } catch { return 'broken'; }
  for (let hop = 0; hop <= LINK_REDIRECTS; hop += 1) {
    if (url.protocol === 'http:') { try { url = new URL(`https:${url.href.slice('http:'.length)}`); } catch { return 'broken'; } }
    if (!linkUrlOk(url)) return 'broken';                          // before the transport, on every hop
    if (linkCarriesData(url)) return 'skipped';                    // N9: never opened, and not the link's fault either
    if (signal?.aborted) return 'unreached';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const hopSignal = signal ? AbortSignal.any([ctrl.signal, signal]) : ctrl.signal;
    let res;
    try { res = await untilAborted(transport({ url, signal: hopSignal, headers: HEADERS }), hopSignal); } catch (e) {
      if (signal?.aborted) return 'unreached';                     // the check's deadline: never the link's fault
      // EWORCA_BLOCKED (a host name with a private address) is the link's. Any other failure of the first hop may be Worca's or the
      // network's (I12), so checkLinks decides by whether another link answered. A redirect target that fails is the link's (the
      // first hop answered, so Worca can reach the web).
      return hop === 0 && !(e && e.code === 'EWORCA_BLOCKED') ? 'unreached' : 'broken';
    } finally { clearTimeout(timer); }
    try { res.destroy(); } catch { /* the body is never read */ }
    if ((res.status >= 200 && res.status < 300) || REFUSES_BOTS.has(res.status)) return 'works';
    const to = res.headers && res.headers.location;
    if (!REDIRECT.has(res.status) || typeof to !== 'string') return 'broken';
    try { url = new URL(to, url); } catch { return 'broken'; }
  }
  return 'broken';
}

/** D93 links: every link of the text works (at most `max` checked, one at a time; P4-Q9: at most `deadlineMs` a check, a hard cap:
 *  no link starts after it, and a link it cuts off is not checked, like one never started).
 *  I12: a link no host answered for is broken only when another link of this check got an answer (Worca can reach the web).
 *  When none did, Worca may have no internet: the check is not checked and does not decide (never the workflow's fault). */
export async function checkLinks(text, { transport = linkDefaults.transport, timeoutMs = LINK_TIMEOUT_MS, max = LINKS_MAX,
  deadlineMs = LINKS_DEADLINE_MS, now = Date.now } = {}) {
  const links = linksIn(text);
  if (!links.length) return { met: true, value: 'No links' };
  let answered = false;
  const counted = async (o) => { const r = await transport(o); answered = true; return r; };
  const until = now() + deadlineMs;
  const deadline = new AbortController();
  const cap = setTimeout(() => deadline.abort(), Math.max(0, deadlineMs));
  const states = [];
  try {
    for (const u of links.slice(0, max)) {
      if (deadline.signal.aborted || now() >= until) break;
      const state = await linkState(u, { transport: counted, timeoutMs, signal: deadline.signal });
      if (state === 'unreached' && deadline.signal.aborted) break;      // cut off: not checked, never broken
      states.push([u, state]);
    }
  } finally { clearTimeout(cap); }
  if (!states.length) return { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' };
  const broken = states.filter(([, s]) => s === 'broken' || (answered && s === 'unreached')).map(([u]) => u);
  if (!broken.length && states.some(([, s]) => s === 'unreached')) {
    return { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' };
  }
  if (broken.length) return { met: false, value: `Not working: ${clip(broken[0])}${broken.length > 1 ? ` and ${broken.length - 1} more` : ''}` };
  const checked = states.filter(([, s]) => s !== 'skipped').length;
  if (!checked) return { met: false, notChecked: true, value: 'Not checked: Worca does not open links that may carry data' };   // N9
  return { met: true, value: checked < links.length ? `Met · ${checked} of ${links.length} checked` : 'Met' };
}
