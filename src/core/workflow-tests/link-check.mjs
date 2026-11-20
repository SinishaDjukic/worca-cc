// src/core/workflow-tests/link-check.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9). Each link is opened through
// Ask's guarded transport, with Ask's URL rule on every hop (web-fetch.mjs checkWebUrl, without its allowlist and data rules):
// https only (http is tried as https), no credentials, no IP-address host, no port but 443, and a host name that resolves to
// public addresses only (guardedLookup). The URL rule is what keeps private addresses out: on the direct path Node never calls
// `lookup` for an IP-address host. The proxy env is honoured, no cookies, no body read. Worca itself makes these calls, at check time.
import { isIP } from 'node:net';
import { httpsTransport, looksLikeData, WEB_LIMITS } from '../ask/web-fetch.mjs';
import { linksIn } from '../../shared/workflow-tests/exact-checks.mjs';

export const LINKS_MAX = 20;
export const LINK_TIMEOUT_MS = 15_000;
/** M19: one check starts no new link after two minutes (20 links × 4 hops × 15 s would be 20 minutes). */
export const LINKS_DEADLINE_MS = 120_000;
const LINK_REDIRECTS = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** P4-Q9: the site answered but refuses automated visitors; Worca cannot tell more, so the link counts as working. */
const REFUSES_BOTS = new Set([401, 403, 429]);
/** No answer at all: the host could not be reached (web-fetch.mjs's UNREACHABLE). A hop that timed out counts too. */
const UNREACHED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
const HEADERS = Object.freeze({ 'user-agent': 'worca-link-check/1', accept: '*/*' });
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** N9: Ask's data rule (checkWebUrl, web-fetch.mjs:42, :53-55): a link whose URL is too long or looks like it carries encoded data is
 *  never opened. Worca would otherwise send whatever a result wrote into a link (an example's data, say) to any public host. */
export function linkCarriesData(url) {
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const q = url.search.replace(/^\?/, '');
  return url.href.length > WEB_LIMITS.urlMaxChars || q.length > WEB_LIMITS.queryMaxChars || url.pathname.length > WEB_LIMITS.pathMaxChars
    || looksLikeData(dec(url.pathname)) || looksLikeData(dec(q));
}

/** C1: Ask's URL rule for one hop. A URL with credentials, an IP-address host or a port other than 443 is never dialled. */
export function linkUrlOk(url) {
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port) return false;                                     // the URL parser drops an explicit :443
  return !isIP(url.hostname.replace(/^\[|\]$/g, ''));             // also catches 2130706433 and 0x7f.1 (the parser makes them 127.0.0.1)
}

/** One link: 'works' (2xx, or 401/403/429), 'broken' (any other answer, a refused URL or address, a 4th redirect),
 *  'unreached' (the first hop got no answer at all: the host could not be reached, or it timed out) or 'skipped' (N9: it may carry data). */
export async function linkState(raw, { transport = httpsTransport, timeoutMs = LINK_TIMEOUT_MS } = {}) {
  let url;
  try { url = new URL(raw); } catch { return 'broken'; }
  for (let hop = 0; hop <= LINK_REDIRECTS; hop += 1) {
    if (url.protocol === 'http:') { try { url = new URL(`https:${url.href.slice('http:'.length)}`); } catch { return 'broken'; } }
    if (!linkUrlOk(url)) return 'broken';                          // before the transport, on every hop
    if (linkCarriesData(url)) return 'skipped';                    // N9: never opened, and not the link's fault either
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await transport({ url, signal: ctrl.signal, headers: HEADERS }); } catch (e) {
      // EWORCA_BLOCKED (a host name with a private address) and TLS errors are the link's; a redirect target that no host
      // answers for is too (the first hop answered, so Worca can reach the web).
      return hop === 0 && (ctrl.signal.aborted || UNREACHED.has(e && e.code)) ? 'unreached' : 'broken';
    } finally { clearTimeout(timer); }
    try { res.destroy(); } catch { /* the body is never read */ }
    if ((res.status >= 200 && res.status < 300) || REFUSES_BOTS.has(res.status)) return 'works';
    const to = res.headers && res.headers.location;
    if (!REDIRECT.has(res.status) || typeof to !== 'string') return 'broken';
    try { url = new URL(to, url); } catch { return 'broken'; }
  }
  return 'broken';
}

/** D93 links: every link of the text works (at most `max` checked, one at a time, none started after `deadlineMs`).
 *  I12: a link no host answered for is broken only when another link of this check got an answer (Worca can reach the web).
 *  When none did, Worca may have no internet: the check is not checked and does not decide (never the workflow's fault). */
export async function checkLinks(text, { transport = httpsTransport, timeoutMs = LINK_TIMEOUT_MS, max = LINKS_MAX,
  deadlineMs = LINKS_DEADLINE_MS, now = Date.now } = {}) {
  const links = linksIn(text);
  if (!links.length) return { met: true, value: 'No links' };
  let answered = false;
  const counted = async (o) => { const r = await transport(o); answered = true; return r; };
  const until = now() + deadlineMs;
  const states = [];
  for (const u of links.slice(0, max)) {
    if (now() >= until) break;
    states.push([u, await linkState(u, { transport: counted, timeoutMs })]);
  }
  const broken = states.filter(([, s]) => s === 'broken' || (answered && s === 'unreached')).map(([u]) => u);
  if (!broken.length && states.some(([, s]) => s === 'unreached')) {
    return { met: false, notChecked: true, value: 'Not checked: Worca could not reach these links' };
  }
  if (broken.length) return { met: false, value: `Not working: ${clip(broken[0])}${broken.length > 1 ? ` and ${broken.length - 1} more` : ''}` };
  const checked = states.filter(([, s]) => s !== 'skipped').length;
  if (!checked) return { met: false, notChecked: true, value: 'Not checked: Worca does not open links that may carry data' };   // N9
  return { met: true, value: checked < links.length ? `Met · ${checked} of ${links.length} checked` : 'Met' };
}
