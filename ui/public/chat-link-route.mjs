// ui/public/chat-link-route.mjs — where a click on a web link in a chat answer goes (issue 1064 §3). One pure decision,
// so every rule is testable without a page; app.js acts on it. 'native' = leave the click alone (the answer link's own
// target=_blank opens it inside the click, so no popup blocker); 'inert' = swallow it; 'inapp' = worca's own page,
// routed in place; 'panel' = a Browser tab of the chat.
import { classifyUrl, isLoopbackName } from '../../src/shared/preview-url.mjs';
import { isKnownFrameRefuser } from '../../src/shared/frame-refusers.mjs';

/** A URL's port, the scheme's default when it has none (WHATWG drops a default port: https → 443, not 80). */
const portOf = (u) => Number(u.port || (u.protocol === 'https:' ? 443 : 80));

/**
 * @param {{href:string, button:number, meta:boolean, ctrl:boolean, shift:boolean, alt:boolean, origin:string,
 *   enabled:boolean, refused?:(origin:string)=>boolean, portAllowed?:(port:number)=>boolean}} o
 *   `origin` = the page's own origin (location.origin); `portAllowed` = the page's copy of the preview port rule
 *   (absent = every port).
 * @returns {{action:'native'|'inert'|'inapp'|'panel', url?:string, hash?:string, notice?:'port', port?:number}}
 */
export function linkDecision(o) {
  const href = String(o.href ?? '').trim();
  if (!href || href.startsWith('#')) return { action: 'native' };          // in-app links route as they always did
  let u;
  try { u = new URL(href, o.origin); } catch { return { action: 'inert' }; }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return { action: 'native' };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { action: 'inert' };   // javascript:, data:, file:, blob:
  if (!o.enabled) return { action: 'native' };                              // the setting is off: today's behaviour
  if (o.button !== 0 || o.meta || o.ctrl || o.shift || o.alt) return { action: 'native' };
  let page = null;
  try { page = new URL(o.origin); } catch { /* no page origin: nothing is worca's own */ }
  const own = !!page && (u.origin === page.origin || (u.protocol === page.protocol && isLoopbackName(u.hostname)
    && isLoopbackName(page.hostname) && portOf(u) === portOf(page)));
  // worca's own page routes in place (never framed); any other own path (an artifact, an API file, a preview) opens
  // as it always did, in a new tab.
  if (own) return u.pathname === '/' ? { action: 'inapp', hash: u.hash && u.hash !== '#' ? u.hash : '#' } : { action: 'native' };
  const c = classifyUrl(u.href);
  if (c.error) return { action: 'native' };                                 // a login, https on loopback: the browser asks
  if (c.kind === 'local') {
    if (typeof o.portAllowed === 'function' && o.portAllowed(c.port) === false) return { action: 'native', notice: 'port', port: c.port };
    return { action: 'panel', url: c.url };
  }
  if (isKnownFrameRefuser(u.hostname) || (typeof o.refused === 'function' && o.refused(u.origin))) return { action: 'native' };
  return { action: 'panel', url: c.url };
}

/** What a plain click on this link does, for its accessible name (D11b): 'panel' (a Browser tab), 'tab' (a new browser
 *  tab) or null (no label: worca's own page, not http(s), or the setting off). Modifiers never count here. */
export function linkHint(o) {
  if (!o.enabled) return null;
  const d = linkDecision({ ...o, button: 0, meta: false, ctrl: false, shift: false, alt: false });
  if (d.action === 'panel') return 'panel';
  // native: only an absolute http(s) address opens a new tab (`#…` routes in place; mailto/tel are not pages)
  return d.action === 'native' && /^https?:\/\//i.test(String(o.href ?? '').trim()) ? 'tab' : null;
}

/** The same address for "already open" (normalized href; an unparsable one matches nothing). */
export function sameAddress(a, b) {
  try { return new URL(a).href === new URL(b).href; } catch { return false; }
}

/**
 * Where a click on a chat file card goes (issue 1064): with "Open chat links in the panel" on (`enabled === true`), a
 * file that is not an image opens its stored copy in a Files tab ('panel'); an image, and everything with the setting
 * off, opens the pop-up ('popup'). `preview` is filePreviewOf(item) (an svg is 'image' too).
 */
export function fileCardAction({ preview, enabled } = {}) {
  return enabled === true && preview !== 'image' ? 'panel' : 'popup';
}
