// src/core/preview-proxy.mjs — the tool panel's Browser preview proxy (issue 1064). `/preview/<port>/<token>/<path>`
// forwards to a dev server on THIS machine's loopback (127.0.0.1, then ::1), so a hosted Worca previews the server's
// localhost, not the person's. The host is never read from a request; the port must be allowed (ui/server.mjs: any
// loopback port, or only the Actions port range and running instances' ports when Settings › Runs › Actions › Preview
// ports says so, and always so on a hosted Worca; never Worca's own port), and the token, minted per browser tab by
// POST /api/preview/sessions, must name that port. Every page it serves is sandboxed (CSP `sandbox` without
// allow-same-origin): the previewed app runs in an opaque origin, so its scripts cannot call Worca's API with the
// person's session even when the page is opened in a tab of its own.
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { snippetSource } from '../shared/element-snippet.mjs';

export const PREVIEW_LIMITS = Object.freeze({
  tokenTtlMs: 12 * 60 * 60 * 1000,   // a tab mints a fresh one on every mount and reload
  maxTokens: 256,
  maxHtmlBytes: 8 * 1024 * 1024,     // larger pages pass through unrewritten
  hostCacheMs: 5000,
  connectTimeoutMs: 1500,
});

/** What every page the proxy serves runs under: scripts and forms work, the origin is opaque (no allow-same-origin). */
export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', '::1']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const PATH_RE = /^\/preview\/(\d{1,5})\/([A-Za-z0-9_-]{22,64})(\/.*)?$/;
const NAV_DEST = new Set(['document', 'iframe', 'frame']);
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer',
  'transfer-encoding', 'upgrade']);
// Worca's own credentials and the identity proxy's never reach a dev server.
const DROP_REQUEST = new Set(['cookie', 'authorization', 'forwarded', 'x-real-ip']);
// Identity proxies' token and identity headers (oauth2-proxy, Google IAP, AWS ALB OIDC, Pomerium, Azure App Service).
const IDENTITY_PREFIX_RE = /^(?:x-auth-request-|x-amzn-oidc-|x-goog-iap-|x-goog-authenticated-|x-pomerium-|x-ms-token-|x-ms-client-principal)/;
// A previewed app must not set or clear anything on Worca's origin, pin it, or register reporting for it.
const DROP_RESPONSE = new Set(['set-cookie', 'clear-site-data', 'strict-transport-security', 'alt-svc', 'public-key-pins',
  'service-worker-allowed', 'x-frame-options', 'cross-origin-resource-policy', 'access-control-allow-origin',
  'access-control-allow-credentials', 'referrer-policy', 'nel', 'report-to', 'reporting-endpoints', 'accept-ch',
  'critical-ch', 'set-login']);

export const previewPrefix = (port, token) => `/preview/${port}/${token}/`;

/** { port, token, rest, bare } of a /preview request URL (`rest` starts with '/' and keeps the query; `bare`: no path
 *  after the token, which redirects to the prefix so relative URLs resolve). null for anything else. */
export function parsePreviewPath(url) {
  const s = String(url || '');
  const q = s.indexOf('?');
  const m = PATH_RE.exec(q < 0 ? s : s.slice(0, q));
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  const query = q < 0 ? '' : s.slice(q);
  return { port, token: m[2], rest: (m[3] || '') + query, bare: !m[3] };
}

/**
 * Why `port` may not be previewed (a code), or null. `all`: every loopback port (Settings › Runs › Actions › Preview
 * ports, never on a hosted Worca); else `range` {low, high} (the Actions port range) and `held` (ports of running
 * Actions instances, which typed ports can put outside the range). `self`: the port Worca itself listens on — refused
 * in BOTH modes, or a previewed page could call Worca's API from loopback.
 */
export function portRefusal(port, { all = false, range = null, held = [], self = null } = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return 'BAD_PORT';
  if (self != null && port === self) return 'SELF';
  if (all) return null;
  if (range && port >= range.low && port <= range.high) return null;
  for (const h of held) if (h === port) return null;
  return 'PORT_NOT_ALLOWED';
}

/** The per-tab tokens: in memory only (a restart makes every tab mint again), each bound to one port. */
export function createPreviewTokens({ now = () => Date.now(), ttlMs = PREVIEW_LIMITS.tokenTtlMs, max = PREVIEW_LIMITS.maxTokens,
  mint = () => randomBytes(18).toString('base64url') } = {}) {
  const map = new Map();
  const sweep = () => { const t = now(); for (const [k, v] of map) if (v.expires <= t) map.delete(k); };
  return {
    issue(port) {
      sweep();
      while (map.size >= max) map.delete(map.keys().next().value);   // the oldest goes; its tab mints again on reload
      let token = mint();
      while (map.has(token)) token = mint();
      map.set(token, { port, expires: now() + ttlMs });
      return token;
    },
    /** null when `token` is live and names `port`; else TOKEN_UNKNOWN, TOKEN_EXPIRED or TOKEN_PORT. */
    check(token, port) {
      const v = map.get(token);
      if (!v) return 'TOKEN_UNKNOWN';
      if (v.expires <= now()) { map.delete(token); return 'TOKEN_EXPIRED'; }
      return v.port === port ? null : 'TOKEN_PORT';
    },
    /** Drops `token`: a headless capture's token once the capture is done (src/core/tab-tools.mjs), so captures never
     *  push a live Browser tab's token out of the `max` the map keeps. */
    revoke(token) { map.delete(token); },
    size: () => map.size,
  };
}

const headerList = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

/**
 * Why a page refuses to be framed by Worca, or null: X-Frame-Options DENY or SAMEORIGIN (Worca's page is never the
 * app's origin), or a CSP frame-ancestors that allows neither `*` nor one of `pageOrigins` (Worca's own origin).
 */
export function framingRefused(headers, pageOrigins = []) {
  for (const v of headerList(headers['x-frame-options'])) {
    if (v.split(',').some((x) => /^(deny|sameorigin)$/i.test(x.trim()))) return 'X-Frame-Options';
  }
  for (const policy of headerList(headers['content-security-policy'])) {
    for (const dir of policy.split(';')) {
      const parts = dir.trim().split(/\s+/);
      if (parts[0].toLowerCase() !== 'frame-ancestors') continue;
      const ok = parts.slice(1).some((s) => s === '*' || pageOrigins.includes(s.replace(/\/$/, '')));
      if (!ok) return 'frame-ancestors';
    }
  }
  return null;
}

/** The app's own address for a proxied URL (`http://localhost:<port>/…`), null for any other URL. */
export function logicalUrl(href, port, prefix) {
  try {
    const u = new URL(href);
    if (!u.pathname.startsWith(prefix)) return null;
    return `http://localhost:${port}/${u.pathname.slice(prefix.length)}${u.search}${u.hash}`;
  } catch { return null; }
}

/** A redirect's target, moved under the prefix when it points at the app itself (root-relative or its own address). */
export function rewriteLocation(loc, port, prefix) {
  if (typeof loc !== 'string' || !loc) return loc;
  if (loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith('/\\')) return loc.startsWith(prefix) ? loc : prefix + loc.slice(1);
  try {
    const u = new URL(loc);
    if (u.protocol === 'http:' && LOOPBACK_NAMES.has(u.hostname) && Number(u.port || 80) === port) {
      return prefix + `${u.pathname}${u.search}${u.hash}`.slice(1);
    }
  } catch { /* not a URL: as sent */ }
  return loc;
}

/** The headers sent to the dev server: no hop-by-hop, no Worca or identity-proxy credential, Host of the app itself
 *  (a dev server's host check accepts localhost), and no compression so HTML and CSS can be rewritten. Origin becomes
 *  the app's own only when it is the preview page's (`null`, the opaque frame) or Worca's (`origins`): any other site's
 *  Origin goes up as sent, so the dev server's own CSRF check still sees a foreign site that holds a leaked token. */
export function upstreamRequestHeaders(h, { port, prefix, drop = [], upgrade = false, origins = [] }) {
  const out = {};
  const extra = new Set(drop.filter(Boolean).map((x) => String(x).toLowerCase()));
  const listed = new Set(String(h.connection || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  for (const [k, v] of Object.entries(h)) {
    const n = k.toLowerCase();
    if (HOP.has(n) || listed.has(n) || DROP_REQUEST.has(n) || extra.has(n)
      || n.startsWith('x-forwarded-') || n.startsWith('cf-') || n.startsWith('x-worca') || IDENTITY_PREFIX_RE.test(n)) continue;
    out[n] = v;
  }
  out.host = `localhost:${port}`;
  if (out.origin === 'null' || origins.includes(out.origin)) out.origin = `http://localhost:${port}`;
  if (out.referer) { const r = logicalUrl(out.referer, port, prefix); if (r) out.referer = r; else delete out.referer; }
  if (upgrade) { out.connection = 'Upgrade'; out.upgrade = h.upgrade; } else out['accept-encoding'] = 'identity';
  return out;
}

/** The headers a proxied answer goes out with: unsafe ones dropped, redirects kept under the prefix, the sandbox CSP
 *  added beside the app's own, and CORS for the opaque-origin page's module scripts, fetches and fonts. */
export function responseHeaders(h, { port, prefix, opaque = false }) {
  const out = {};
  const listed = new Set(String(h.connection || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  for (const [k, v] of Object.entries(h)) {
    const n = k.toLowerCase();
    if (HOP.has(n) || listed.has(n) || DROP_RESPONSE.has(n)) continue;
    out[n] = v;
  }
  if (out.location) out.location = rewriteLocation(String(out.location), port, prefix);
  out['content-security-policy'] = [...headerList(out['content-security-policy']), SANDBOX_CSP];
  out['referrer-policy'] = 'no-referrer';
  if (opaque) { out['access-control-allow-origin'] = 'null'; out.vary = out.vary ? `${out.vary}, Origin` : 'Origin'; }
  return out;
}

/** The script injected first into every proxied HTML page: moves root-relative URLs the page builds in JS (WebSocket,
 *  fetch, XHR, EventSource, script/link/img src, setAttribute of a URL attribute, innerHTML, a <style>'s text,
 *  history.pushState) under the prefix, and tells the panel where the page is. Without the setAttribute, innerHTML and
 *  style hooks the default Vite and Next templates lose their images, CSS backgrounds and fonts (React and Vue set
 *  `src` through setAttribute; Vite and style-loader put CSS in a <style> as text). */
export function previewShim(prefix, port) {
  return `(function(){var P=${JSON.stringify(prefix)},T=${Number(port)};`
    + 'function fix(u,ws){try{var x=new URL(String(u),location.href),s=location.protocol==="https:";'
    + 'var loop=/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(x.hostname)&&(+x.port||80)===T;'
    + 'if(x.host!==location.host&&!loop)return u;'
    + 'if(loop){x.protocol=ws?(s?"wss:":"ws:"):location.protocol;x.host=location.host;}'
    + 'if(x.pathname.indexOf(P)!==0)x.pathname=P+x.pathname.slice(1);return x.href}catch(e){return u}}'
    + 'function wrap(n,ws){var C=window[n];if(!C)return;var W=function(u,a){return arguments.length>1?new C(fix(u,ws),a):new C(fix(u,ws))};'
    + 'W.prototype=C.prototype;for(var k in C)try{W[k]=C[k]}catch(e){}window[n]=W}'
    + 'wrap("WebSocket",1);wrap("EventSource",0);'
    + 'var F=window.fetch;if(F)window.fetch=function(i,o){if(typeof i==="string"||i instanceof URL)i=fix(i);'
    + 'else if(i&&i.url)i=new Request(fix(i.url),i);return F.call(this,i,o)};'
    + 'var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return O.apply(this,arguments)};'
    + '[[window.HTMLScriptElement,"src"],[window.HTMLLinkElement,"href"],[window.HTMLImageElement,"src"]].forEach(function(p){'
    + 'if(!p[0])return;var d=Object.getOwnPropertyDescriptor(p[0].prototype,p[1]);if(!d||!d.set)return;'
    + 'Object.defineProperty(p[0].prototype,p[1],{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,fix(v))}})});'
    + 'var AT={src:1,href:1,action:1,formaction:1,poster:1,data:1};function rr(v){return typeof v==="string"&&/^\\/(?![\\/\\\\])/.test(v)&&v.indexOf(P)!==0}'
    + 'var SA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(AT[String(n).toLowerCase()]&&rr(v))v=fix(v);return SA.call(this,n,v)};'
    + 'function css(t){return String(t).replace(/(url\\(\\s*["\']?)\\/(?![\\/\\\\]|preview\\/)/gi,function(m,a){return a+P})}'
    + 'var TC=Object.getOwnPropertyDescriptor(Node.prototype,"textContent");Object.defineProperty(Node.prototype,"textContent",{configurable:true,enumerable:TC.enumerable,get:TC.get,set:function(v){TC.set.call(this,this instanceof HTMLStyleElement&&v!=null?css(v):v)}});'
    + 'var AC=Node.prototype.appendChild;Node.prototype.appendChild=function(c){if(this instanceof HTMLStyleElement&&c&&c.nodeType===3)c.data=css(c.data);return AC.call(this,c)};'
    + 'function ht(t){return css(String(t).replace(/(\\s(?:src|href|action|formaction|poster|data)\\s*=\\s*["\']?)\\/(?![\\/\\\\]|preview\\/)/gi,function(m,a){return a+P}))}'
    + 'var IH=Object.getOwnPropertyDescriptor(Element.prototype,"innerHTML");if(IH&&IH.set)Object.defineProperty(Element.prototype,"innerHTML",{configurable:true,enumerable:IH.enumerable,get:IH.get,set:function(v){IH.set.call(this,v==null?v:ht(v))}});'
    + 'function tell(rep){try{parent.postMessage({type:"worca-preview:location",href:location.href,title:document.title,replace:!!rep},"*")}catch(e){}}'
    + '["pushState","replaceState"].forEach(function(n){var f=history[n];history[n]=function(s,t,u){var r=f.call(this,s,t,u==null?u:fix(u));tell(n==="replaceState");return r}});'
    + 'addEventListener("popstate",function(){tell()});addEventListener("hashchange",function(){tell()});addEventListener("load",function(){tell()})})();';
}

/** Pick element (issue 1064 slice 3), injected after previewShim: the panel posts {type:'worca-preview:pick', on}.
 *  While on, the element under the pointer gets an outline box. A click picks it (the page never sees that click or
 *  its presses), and Escape cancels. The pick answers {type:'worca-preview:picked', selector, snippet, rect, viewport}
 *  from the extension's own selector and snippet code (src/shared/element-snippet.mjs), so it reads exactly like an
 *  area capture's page-capture.md. Messages come only from the parent (the panel); the page's own posts are ignored. */
export const PICK_SHIM = `(function(){${snippetSource()}\n`
  + 'var on=false,box=null,cur=null;'
  + 'function post(m){try{parent.postMessage(m,"*")}catch(e){}}'
  + 'function mark(el){if(!box){box=document.createElement("div");box.setAttribute("data-worca-pick","");'
  + 'box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #2f6feb;background:rgba(47,111,235,.12);border-radius:2px"}'
  + 'if(!box.isConnected)(document.body||document.documentElement).appendChild(box);var r=el.getBoundingClientRect();'
  + 'box.style.left=r.left+"px";box.style.top=r.top+"px";box.style.width=r.width+"px";box.style.height=r.height+"px"}'
  + 'function stop(){on=false;cur=null;if(box&&box.isConnected)box.remove()}'
  + 'function at(e){var el=document.elementFromPoint(e.clientX,e.clientY);return el&&el!==box&&el!==document.documentElement?el:null}'
  + 'addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.type!=="worca-preview:pick")return;if(e.data.on)on=true;else stop()});'
  + 'addEventListener("mousemove",function(e){if(!on)return;var el=at(e);if(el){cur=el;mark(el)}},true);'
  + '["mousedown","mouseup","pointerdown","pointerup","auxclick","dblclick"].forEach(function(n){addEventListener(n,function(e){if(on){e.preventDefault();e.stopImmediatePropagation()}},true)});'
  + 'addEventListener("click",function(e){if(!on)return;e.preventDefault();e.stopImmediatePropagation();var el=at(e)||cur;stop();if(!el)return;var r=el.getBoundingClientRect();'
  + 'post({type:"worca-preview:picked",selector:cssSelector(el),snippet:htmlSnippet(el),'
  + 'rect:{x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)},viewport:{width:innerWidth,height:innerHeight}})},true);'
  + 'addEventListener("keydown",function(e){if(on&&e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();stop();post({type:"worca-preview:pick-cancel"})}},true)})();';

const ATTR_RE = /(\s(?:src|href|action|formaction|poster|data)\s*=\s*)(["']?)\/(?![/\\])/gi;
const SRCSET_RE = /(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi;
const CSS_URL_RE = /(url\(\s*)(["']?)\/(?![/\\])/gi;
const CSS_IMPORT_RE = /(@import\s+)(["'])\/(?![/\\])/gi;
const DOCTYPE_RE = /^\s*<!doctype[^>]*>/i;

/** A stylesheet with its root-relative url() and @import moved under the prefix: they resolve against the origin, not
 *  the sheet (next/font's @font-face, a CSS background). Never prefixed twice. */
export function rewriteCss(css, prefix) {
  const keep = (s, at) => s.startsWith(prefix, at);
  return css.replace(CSS_URL_RE, (m, a, q, off, s) => (keep(s, off + m.length - 1) ? m : `${a}${q}${prefix}`))
    .replace(CSS_IMPORT_RE, (m, a, q, off, s) => (keep(s, off + m.length - 1) ? m : `${a}${q}${prefix}`));
}
/** Where the first `<name …>` tag ends, or -1. Linear: a regex like `<head(\s[^>]*)?>` rescans to the end of the page at
 *  every `<head ` with no `>` after it, and a dev server's page is not trusted to be well-formed. */
function afterOpenTag(s, name) {
  const m = new RegExp(`<${name}(?=[\\s>])`, 'i').exec(s);
  if (!m) return -1;
  const end = s.indexOf('>', m.index);
  return end < 0 ? -1 : end + 1;   // no '>' after the first one: none after a later one either
}

/**
 * A proxied HTML page with its root-relative URLs (src, href, action, formaction, poster, data, srcset, CSS url())
 * moved under the prefix, and the shim plus an import map (module imports of `/…` resolve under the prefix) injected
 * before anything else in <head>. Works on a latin1 string, so every ASCII-compatible charset survives byte for byte.
 * URLs a script builds itself are only caught by the shim (docs/terminal.md "Browser tabs"). `inject: false` (an HTML
 * fragment a script fetched, htmx-style) moves the URLs but adds no shim or import map: the page already has them.
 */
export function rewriteHtml(html, { prefix, port, inject: withShim = true }) {
  const keep = (s, at) => s.startsWith(prefix, at);
  let out = html.replace(ATTR_RE, (m, a, q, off, s) => (keep(s, off + m.length - 1) ? m : `${a}${q}${prefix}`));
  out = out.replace(SRCSET_RE, (m, a, q, list) => `${a}${q}${list.split(',').map((c) => {
    const t = c.trimStart();
    const lead = c.slice(0, c.length - t.length);
    return t.startsWith('/') && !t.startsWith('//') && !t.startsWith(prefix) ? `${lead}${prefix}${t.slice(1)}` : c;
  }).join(',')}${q}`);
  out = out.replace(CSS_URL_RE, (m, a, q, off, s) => (keep(s, off + m.length - 1) ? m : `${a}${q}${prefix}`));
  if (!withShim) return out;
  const inject = `<script>${previewShim(prefix, port)}</script><script>${PICK_SHIM}</script>`
    + `<script type="importmap">${JSON.stringify({ imports: { '/': prefix, [prefix]: prefix } })}</script>`;
  for (const name of ['head', 'html']) {
    const at = afterOpenTag(out, name);
    if (at >= 0) return out.slice(0, at) + inject + out.slice(at);
  }
  const m = DOCTYPE_RE.exec(out);
  if (m) return out.slice(0, m.index + m[0].length) + inject + out.slice(m.index + m[0].length);
  return inject + out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A page the proxy answers itself (refusals, nothing listening, a frame-refusing site). It posts its code to the
 *  panel (tool-browser.mjs shows its own message and Open externally); opened on its own it still reads. */
export function sendPreviewNote(res, status, code, text) {
  const body = `<!doctype html><meta charset="utf-8"><title>${esc(text)}</title>`
    + `<body style="font:14px system-ui,sans-serif;margin:2em;color:#666">${esc(text)}`
    + `<script>try{parent.postMessage({type:"worca-preview:note",code:${JSON.stringify(code)}},"*")}catch(e){}</script>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SANDBOX_CSP,
    'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'x-worca-preview-note': code, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export const NOTE_TEXT = Object.freeze({
  TOKEN_UNKNOWN: 'This preview link has expired. Reload the tab.',
  TOKEN_EXPIRED: 'This preview link has expired. Reload the tab.',
  TOKEN_PORT: 'This preview link is for another port.',
  PORT_NOT_ALLOWED: 'Worca previews only the Actions port range and running Actions here.',
  SELF: 'Worca does not preview itself.',
  BAD_PORT: 'That is not a port.',
  NOT_LISTENING: 'Nothing answers on this port yet.',
  UPSTREAM: 'The dev server closed the connection.',
  TOO_LARGE: 'This page is too large to show here.',
  FRAME_REFUSED: 'This site cannot be shown here.',
  WORCA_INSTANCE: 'This port runs a Worca. Open it in a browser tab of its own.',
});

function canConnect(host, port, ms) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(ms, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * The proxy. `tokens`: createPreviewTokens(); `refuse(port)`: portRefusal with the live preview-port mode, range and instances;
 * `pageOrigins(req)`: Worca's own origins for the frame-ancestors check; `drop`: more request headers to strip
 * (the UI token header, the identity header). `isWorca(host, port)`: whether a Worca answers there (ui/server.mjs
 * passes probeUi); the proxy gives every opaque-origin request the app's own Origin, so that Worca's sandboxed pages
 * would pass its exact-origin guard. The caller has already run the HTTP gates (peer, host, identity, actions on);
 * `handle` and `upgrade` check the path, the token and the port on every request, and refuse a port where a Worca
 * answered when its host was last resolved (every `hostCacheMs`): a token minted for a dev server never reaches a
 * Worca started later on that port.
 */
export function createPreviewProxy({ tokens, refuse, pageOrigins = () => [], drop = () => [], isWorca = async () => false,
  connectTimeoutMs = PREVIEW_LIMITS.connectTimeoutMs, maxHtmlBytes = PREVIEW_LIMITS.maxHtmlBytes,
  hostCacheMs = PREVIEW_LIMITS.hostCacheMs } = {}) {
  const hosts = new Map();
  const resolving = new Map();
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.once('close', () => sockets.delete(s)); };

  /** { host, worca } of the loopback address answering on `port`, or null: cached `hostCacheMs`, one probe at a time
   *  per port (a page's burst of asset requests shares it). `fresh` skips the cache. */
  function hostFor(port, { fresh = false } = {}) {
    const c = hosts.get(port);
    if (!fresh && c && c.until > Date.now()) return Promise.resolve(c);
    if (!fresh && resolving.has(port)) return resolving.get(port);
    const run = (async () => {
      for (const h of LOOPBACK_HOSTS) {
        if (!(await canConnect(h, port, connectTimeoutMs))) continue;
        let worca = true;   // a probe that throws refuses: the guard fails closed
        try { worca = (await isWorca(h, port)) === true; } catch { /* stays refused */ }
        const entry = { host: h, worca, until: Date.now() + hostCacheMs };
        hosts.set(port, entry);
        return entry;
      }
      hosts.delete(port);
      return null;
    })();
    if (!fresh) {
      resolving.set(port, run);
      run.finally(() => { if (resolving.get(port) === run) resolving.delete(port); }).catch(() => {});
    }
    return run;
  }
  /** The parsed path, or a refusal code: a request's token and port are checked on every request, not once. */
  function admit(url) {
    const p = parsePreviewPath(url);
    if (!p) return { code: 'NOT_FOUND' };
    const why = tokens.check(p.token, p.port) || refuse(p.port);
    return why ? { code: why, p } : { p };
  }

  async function handle(req, res) {
    const { code, p } = admit(req.originalUrl || req.url);
    if (code === 'NOT_FOUND') return sendPreviewNote(res, 404, code, 'Not a preview address.');
    if (code) return sendPreviewNote(res, 403, code, NOTE_TEXT[code] || 'Refused.');
    const prefix = previewPrefix(p.port, p.token);
    if (p.bare) { res.writeHead(308, { location: prefix + p.rest, 'cache-control': 'no-store' }); return res.end(); }
    const opaque = req.headers.origin === 'null';
    if (opaque && req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.writeHead(204, { 'access-control-allow-origin': 'null', 'access-control-allow-methods': String(req.headers['access-control-request-method']),
        'access-control-allow-headers': String(req.headers['access-control-request-headers'] || ''), 'access-control-max-age': '600', vary: 'Origin' });
      return res.end();
    }
    const at = await hostFor(p.port);
    if (!at) return sendPreviewNote(res, 502, 'NOT_LISTENING', NOTE_TEXT.NOT_LISTENING);
    if (at.worca) return sendPreviewNote(res, 409, 'WORCA_INSTANCE', NOTE_TEXT.WORCA_INSTANCE);
    const up = http.request({ host: at.host, port: p.port, method: req.method, path: p.rest, agent: false,
      headers: upstreamRequestHeaders(req.headers, { port: p.port, prefix, drop: drop(), origins: pageOrigins(req) }) });
    up.on('response', (ur) => respond(req, res, ur, p, prefix, opaque));
    up.on('error', () => { hosts.delete(p.port); if (!res.headersSent) sendPreviewNote(res, 502, 'UPSTREAM', NOTE_TEXT.UPSTREAM); else res.destroy(); });
    // A 101 to a plain request: Node emits neither 'response' nor 'error', so the page would wait for good.
    up.on('upgrade', (_ur, s) => { s.destroy(); if (!res.headersSent) sendPreviewNote(res, 502, 'UPSTREAM', NOTE_TEXT.UPSTREAM); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.pipe(up);
  }

  function respond(req, res, ur, p, prefix, opaque) {
    // llhttp parses any three digits; writeHead throws below 100, and a throw in this listener would take Worca down.
    const status = Number.isInteger(ur.statusCode) && ur.statusCode >= 100 && ur.statusCode <= 999 ? ur.statusCode : 502;
    const dest = req.headers['sec-fetch-dest'];
    if (NAV_DEST.has(String(dest || '')) && framingRefused(ur.headers, pageOrigins(req))) {
      ur.resume();
      return sendPreviewNote(res, 200, 'FRAME_REFUSED', NOTE_TEXT.FRAME_REFUSED);
    }
    const headers = responseHeaders(ur.headers, { port: p.port, prefix, opaque });
    const ctype = String(ur.headers['content-type'] || '');
    const textual = !ur.headers['content-encoding'] && req.method !== 'HEAD' && status !== 204 && status !== 304;
    const css = textual && /^\s*text\/css\b/i.test(ctype);
    const html = textual && /^\s*text\/html\b/i.test(ctype);
    const declared = Number(ur.headers['content-length']);
    if (!(html || css) || declared > maxHtmlBytes) {
      // A dev server that goes mid-body (a restart under an SSE stream) never ends `ur`: the browser must see the cut,
      // or its EventSource HMR never reconnects and Worca holds the socket for good.
      ur.once('close', () => { if (!ur.complete) res.destroy(); });
      res.writeHead(status, headers); ur.pipe(res); return;
    }
    const chunks = [];
    let size = 0;
    ur.on('data', (c) => {
      size += c.length;
      if (size > maxHtmlBytes) { ur.destroy(); if (!res.headersSent) sendPreviewNote(res, 502, 'TOO_LARGE', NOTE_TEXT.TOO_LARGE); return; }
      chunks.push(c);
    });
    ur.on('end', () => {
      if (res.headersSent) return;
      // A page gets the shim and import map; HTML a script fetched (no Sec-Fetch-Dest of a navigation) only its URLs.
      const inject = dest == null || NAV_DEST.has(String(dest));
      const text = Buffer.concat(chunks).toString('latin1');
      const body = Buffer.from(css ? rewriteCss(text, prefix) : rewriteHtml(text, { prefix, port: p.port, inject }), 'latin1');
      delete headers['content-length'];
      res.writeHead(status, { ...headers, 'content-length': body.length });
      res.end(body);
    });
    ur.on('error', () => { if (!res.headersSent) sendPreviewNote(res, 502, 'UPSTREAM', NOTE_TEXT.UPSTREAM); else res.destroy(); });
  }

  /** A WebSocket upgrade (dev-server HMR): the same checks, then the two sockets are piped. */
  async function upgrade(req, socket, head) {
    // A refused upgrade gets its status line, then the socket goes: an upgraded socket is outside server.close().
    const fail = (status, text) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy()); };
    socket.on('error', () => socket.destroy());
    track(socket);
    const { code, p } = admit(req.url);
    if (code === 'NOT_FOUND' || (p && p.bare)) return fail(404, 'Not Found');
    if (code) return fail(403, 'Forbidden');
    const at = await hostFor(p.port);
    if (socket.destroyed) return undefined;   // the tab went while the port was probed
    if (!at) return fail(502, 'Bad Gateway');
    if (at.worca) return fail(409, 'Conflict');
    const prefix = previewPrefix(p.port, p.token);
    const up = http.request({ host: at.host, port: p.port, method: 'GET', path: p.rest, agent: false,
      headers: upstreamRequestHeaders(req.headers, { port: p.port, prefix, drop: drop(), upgrade: true, origins: pageOrigins(req) }) });
    // The tab went mid-handshake (an http server's socket is half-open: 'end', not 'close'): both sides go.
    const abandon = () => { up.destroy(); socket.destroy(); };
    socket.once('end', abandon);
    socket.once('close', abandon);
    up.on('upgrade', (ur, upSocket, upHead) => {
      if (socket.destroyed) { upSocket.destroy(); return; }
      const lines = [`HTTP/1.1 101 ${ur.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < ur.rawHeaders.length; i += 2) {
        if (ur.rawHeaders[i].toLowerCase() !== 'set-cookie') lines.push(`${ur.rawHeaders[i]}: ${ur.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upHead && upHead.length) socket.write(upHead);
      if (head && head.length) upSocket.write(head);
      track(upSocket);
      const end = () => { socket.destroy(); upSocket.destroy(); };
      // Either side ending ends both: a WebSocket has no use for a half-open pipe, and the http servers allow one.
      for (const s of [socket, upSocket]) { s.on('error', end); s.on('end', end); s.on('close', end); }
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    up.on('response', (ur) => { ur.resume(); fail(ur.statusCode || 502, ur.statusMessage || 'Refused'); });
    up.on('error', () => { hosts.delete(p.port); fail(502, 'Bad Gateway'); });
    up.end();
  }

  /** Server shutdown: proxied WebSockets are upgraded sockets that server.close() does not wait for or end. */
  function closeAll() { for (const s of sockets) s.destroy(); sockets.clear(); }

  /** Whether a Worca answers on `port` now (POST /api/preview/sessions: the early, friendly refusal), on the same
   *  host the proxy would dial. */
  async function worcaAt(port) { return (await hostFor(port, { fresh: true }))?.worca === true; }

  /** Drop `port`'s cached host now: its next request resolves it again (as it would after hostCacheMs). */
  function forget(port) { hosts.delete(port); }
  return { handle, upgrade, closeAll, worcaAt, forget };
}
