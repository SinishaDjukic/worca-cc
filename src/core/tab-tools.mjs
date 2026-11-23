// src/core/tab-tools.mjs — the chat's tab tools and the Browser tab's Pick element (issue 1064 slice 3). Everything is
// decided here, in the worca server; the MCP child only forwards (ask/tab-deps.mjs over POST /api/ask/tabs):
// - scope: a chat reaches its own tabs and its project's (tool-tabs-mirror.mjs), nothing else;
// - addresses: a loopback address previews through the proxy's own rules; any other host only over https and on the
//   chat's web allowlist (web_fetch's checkWebUrl), for open_tab as much as for screenshot_tab and read_tab;
// - what a capture may load: the preview's own prefix, or a public host (every DNS answer checked, the way web_fetch's
//   connect-time lookup does; headless Chrome would otherwise reach an intranet name or a name that resolves to loopback);
// - capture: page-capture.mjs (one headless Chrome path). A capture that would be blank is an error, never an image.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { classifyUrl, isLoopbackName, tabAddress } from '../shared/preview-url.mjs';
import { checkWebUrl, isBlockedAddress } from './ask/web-fetch.mjs';
import { NOTE_TEXT } from './preview-proxy.mjs';
import { ASK_LIMITS } from './ask/limits.mjs';
import { tabScope, TabMirrorError } from './tool-tabs-mirror.mjs';

// Changes is turned off (ui/public/app.js, the createChangesKind import): the agent cannot open one. To bring it back, add
// 'changes' here and in open_tab's enum and text (src/core/ask/tools.mjs).
export const TAB_TOOL_KINDS = Object.freeze(['browser', 'terminal', 'files']);
export const TAB_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const TAB_ID_RE = /^tab_[A-Za-z0-9]{1,32}$/;
const SELECTOR_MAX = 300;   // = src/shared/element-snippet.mjs SELECTOR_MAX
export const PRIVATE_SUFFIX_RE = /\.(local|localhost|localdomain|internal|intranet|intra|corp|lan|home|home\.arpa)$/i;

export class TabToolError extends Error {
  constructor(message, code = 'REFUSED') { super(message); this.name = 'TabToolError'; this.code = code; }
}
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Every address `host` resolves to, as dns.lookup answers them ([{ address, family }]): the system resolver, as Chrome's. */
export const lookupAll = (host) => lookup(host, { all: true });

/**
 * Whether a capture may load `u` from a public host (a CDN, a font, a child frame): never loopback, a dotless intranet
 * name, a .local-style name, a private / reserved IP literal, or a name with ANY private / reserved DNS answer (or none).
 * One lookup per host per capture (`cache`). Chrome resolves the name again itself: a DNS rebinding between the two
 * answers is a known limit (plan section 15).
 */
async function publicHost(u, resolve, cache) {
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!h) return false;
  if (isIP(h)) return !isBlockedAddress(h);
  if (!h.includes('.') || isLoopbackName(h) || PRIVATE_SUFFIX_RE.test(h)) return false;
  if (!cache.has(h)) {
    cache.set(h, Promise.resolve().then(() => resolve(h)).then(
      (all) => Array.isArray(all) && all.length > 0 && all.every((a) => a && typeof a.address === 'string' && !isBlockedAddress(a.address)),
      () => false));
  }
  return cache.get(h);
}
/** A URL's origin as http(s): the preview's own HMR socket (ws://<worca>/preview/…) is the preview's origin. */
const httpOrigin = (u) => `${u.protocol === 'ws:' ? 'http:' : u.protocol === 'wss:' ? 'https:' : u.protocol}//${u.host}`;

/** The refusal an assistant-chosen local port outside the Actions range gets (deps.previewRefusal with model). */
export const modelPortRefusal = (port, r) => `Port ${port} is outside the ports the chat may open or read by itself: ${r.low}–${r.high} and running Actions. Ask the user to open it in a Browser tab; you can then read that tab.`;

/** A local preview's request rule: Worca's origin only under the tab's own /preview/<port>/<token>/ prefix, the top
 *  frame never anywhere else, and public hosts for the page's assets. Worca's API and other loopback servers stay out. */
export function localAllow(origin, prefix, resolve = lookupAll) {
  const cache = new Map();
  return async (raw, top) => {
    let u;
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return !top;
    if (httpOrigin(u) === origin) return u.pathname.startsWith(prefix);
    return !top && publicHost(u, resolve, cache);
  };
}
/** Another site's request rule: every top-frame navigation passes the chat's web allowlist again, and every host it
 *  loads (the top page's included) must be public. */
export function externalAllow(allowedDomains, resolve = lookupAll) {
  const cache = new Map();
  return async (raw, top) => {
    let u;
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return !top;
    if (top) { try { checkWebUrl(u.href, allowedDomains, { redirect: true }); } catch { return false; } }
    return publicHost(u, resolve, cache);
  };
}

const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return false; } };
const sameTarget = (a, b) => !!a && !!b && a.path === b.path && !!a.dir === !!b.dir
  && (a.root || null) === (b.root || null) && (a.member || null) === (b.member || null);
const lineText = (t) => (t.line ? `:${t.line}${t.endLine ? `-${t.endLine}` : ''}` : '');

/**
 * deps:
 * - `mirror`: createToolTabsMirror()
 * - `thread(threadId)` → `{ owner, projectKey|null }`, or null (gone or archived)
 * - `web(threadId)` → `{ enabled, allowedDomains }` (askWebAccessFor)
 * - `previewRefusal(port, { model })` → refusal text, or null (async: ports, Actions on, another Worca). `model`: the
 *   assistant chose the address (open_tab, or a capture of a tab it opened): held to the Actions range and running
 *   Actions whatever "Preview ports" says — "All local ports" is the person's own choice for the tabs they open.
 * - `previewBase(port)` → `{ origin, prefix, done() }` (a fresh preview token on Worca's own loopback address; `done`
 *   revokes it once the capture is over)
 * - `capture(opts)`: page-capture.mjs
 * - `saveImage(threadId, { name, png })` → `{ id, name, bytes }` (the chat's attachment, within its budget)
 * - `fileTarget(threadId, {path, line, endLine})` → `{ path, type, line?, endLine?, root, member? }` (throws
 *   TabToolError: open_tab files)
 * - `notify(threadId, extra?)`: a page showing this chat takes the new tab in; `extra` = `{ focus,
 *   target? }` on a bring-forward
 * - `resolve(host)` → `[{ address }]` (default: dns.lookup, every answer)
 * - `now()`
 */
export function createTabTools(d) {
  const now = d.now || (() => Date.now());
  const resolve = d.resolve || lookupAll;
  const opens = new Map();   // bridge token → open_tab calls that opened or brought forward a tab this turn
  const threadOf = (tool, threadId) => {
    const t = d.thread(threadId);
    if (!t) throw new TabToolError(`${tool}: this chat is gone`, 'NOT_FOUND');
    return t;
  };
  /** The tabs this chat reaches: its project's (when it has one), then its own — the panel's order. */
  function reachable(threadId, tool = 'tabs') {
    const t = threadOf(tool, threadId);
    const project = t.projectKey ? d.mirror.list(t.owner, tabScope('project', t.projectKey)).map((x) => ({ ...x, scope: 'project' })) : [];
    const chat = d.mirror.list(t.owner, tabScope('chat', threadId)).map((x) => ({ ...x, scope: 'chat' }));
    return { t, tabs: [...project, ...chat] };
  }
  function browserTab(tool, threadId, tabId) {
    if (typeof tabId !== 'string' || !TAB_ID_RE.test(tabId)) throw new TabToolError(`${tool}: tabId must be a tab id like tab_1a2b3c from the tool tabs line of the context block`, 'BAD_INPUT');
    const hit = reachable(threadId, tool).tabs.find((x) => x.id === tabId);
    if (!hit) throw new TabToolError(`${tool}: no tab ${tabId} in this chat or its project — only those tabs are reachable (the tool tabs line of the context block lists them)`, 'OUT_OF_SCOPE');
    if (hit.kind !== 'browser') throw new TabToolError(`${tool}: tab ${tabId} is a ${hit.kind} tab; only Browser tabs can be captured or read`, 'NOT_BROWSER');
    if (!hit.url) throw new TabToolError(`${tool}: tab ${tabId} has no address yet`, 'NO_URL');
    return hit;
  }
  /** The address rules, without minting anything: { kind:'local', port, path, url } or { kind:'external', url, allowedDomains }. */
  async function checkAddress(tool, threadId, url, { model = true } = {}) {
    const c = classifyUrl(url);
    if (c.error) throw new TabToolError(`${tool}: ${c.error}`, 'BAD_URL');
    if (c.kind === 'local') {
      const why = await d.previewRefusal(c.port, { model });
      if (why) throw new TabToolError(`${tool}: ${why}`, 'PREVIEW_REFUSED');
      return c;
    }
    const web = d.web(threadId);
    if (!web || web.enabled !== true) {
      throw new TabToolError(`${tool}: ${new URL(c.url).host} is not a local preview, and web access is switched off for this chat — the user turns it on in Settings → Chat → Web access`, 'WEB_OFF');
    }
    try { checkWebUrl(c.url, web.allowedDomains); }
    catch (e) { throw new TabToolError(`${tool}: ${e.message}`, e.code === 'not-allowlisted' ? 'NOT_ALLOWLISTED' : 'BAD_URL'); }
    return { ...c, allowedDomains: web.allowedDomains };
  }
  /** One capture of `url` under the address rules. A local preview's token is revoked when the capture ends: a minted
   *  token would otherwise live 12 h and push a live Browser tab's token out of the 256 the proxy keeps. */
  async function captureAt(tool, threadId, url, opts, { model = true } = {}) {
    const c = await checkAddress(tool, threadId, url, { model });
    if (c.kind === 'external') return d.capture({ url: c.url, allow: externalAllow(c.allowedDomains, resolve), viewport: TAB_VIEWPORT, ...opts });
    const { origin, prefix, done } = await d.previewBase(c.port);
    try { return await d.capture({ url: `${origin}${prefix}${c.path.slice(1)}`, allow: localAllow(origin, prefix, resolve), viewport: TAB_VIEWPORT, ...opts }); }
    finally { try { done?.(); } catch { /* already gone */ } }
  }
  const noteError = (tool, code) => new TabToolError(`${tool}: ${code === 'FRAME_REFUSED'
    ? 'the page refuses to be shown inside another page, so the preview cannot show it'
    : (NOTE_TEXT[code] || `the preview refused the page (${code})`)}`, 'PREVIEW_NOTE');

  return {
    TAB_VIEWPORT,
    /** The [worca context] block's tool tabs line: the first ASK_LIMITS.tabs.headerTabs reachable tabs. Never throws. */
    headerTabs(threadId) {
      try {
        return reachable(threadId).tabs.slice(0, ASK_LIMITS.tabs.headerTabs)
          .map((x) => ({ id: x.id, kind: x.kind, url: x.url || null, path: x.target?.path || null, line: x.target?.line || null,
            openedBy: x.openedBy, scope: x.scope }));
      } catch { return []; }
    },
    async open(threadId, input = {}, { turn = null } = {}) {
      const t = threadOf('open_tab', threadId);
      const kind = input.kind;
      if (!TAB_TOOL_KINDS.includes(kind)) throw new TabToolError(`open_tab: kind must be one of ${TAB_TOOL_KINDS.join(', ')}`, 'BAD_INPUT');
      if (!t.projectKey) throw new TabToolError('open_tab: this chat has no project, so its tool panel opens no tabs — ask the user to pick a project for the chat', 'NO_PROJECT');
      const hasPath = typeof input.path === 'string' && input.path.trim() !== '';
      if (hasPath && kind !== 'files') throw new TabToolError('open_tab: path is for kind "files" only', 'BAD_INPUT');
      if (!hasPath && (input.line != null || input.endLine != null)) throw new TabToolError('open_tab: line and endLine need a path', 'BAD_INPUT');
      const used = turn ? (opens.get(turn) || 0) : 0;
      if (turn && used >= ASK_LIMITS.tabs.opensPerTurn) {
        throw new TabToolError(`open_tab: at most ${ASK_LIMITS.tabs.opensPerTurn} open_tab calls per turn — say in your answer what else the user should open`, 'TOO_MANY');
      }
      let url = null;
      if (typeof input.url === 'string' && input.url.trim()) {
        if (kind !== 'browser') throw new TabToolError('open_tab: url is for kind "browser" only', 'BAD_INPUT');
        url = (await checkAddress('open_tab', threadId, input.url.trim())).url;
      }
      const target = hasPath ? await d.fileTarget(threadId, { path: input.path.trim(), line: input.line ?? null, endLine: input.endLine ?? null }) : null;
      const mirrorTarget = target ? { path: target.path, ...(target.type === 'dir' ? { dir: true } : {}), ...(target.line ? { line: target.line } : {}),
        ...(target.endLine ? { endLine: target.endLine } : {}), ...(target.root ? { root: target.root } : {}), ...(target.member ? { member: target.member } : {}) } : null;
      // An address is the same page in any scope; a file only in the chat's own tabs (a project tab shows the project's
      // checkout, which can differ from the chat's root — the client's openIn matches the chat scope only too).
      const same = (url || mirrorTarget) ? reachable(threadId, 'open_tab').tabs.find((x) => x.kind === kind
        && (url ? sameUrl(x.url, url) : x.scope === 'chat' && sameTarget(x.target, mirrorTarget))) : null;
      if (turn) {   // re-read after the awaits above: another call of this turn may have counted meanwhile
        const n = opens.get(turn) || 0;
        if (n >= ASK_LIMITS.tabs.opensPerTurn) {
          throw new TabToolError(`open_tab: at most ${ASK_LIMITS.tabs.opensPerTurn} open_tab calls per turn — say in your answer what else the user should open`, 'TOO_MANY');
        }
        opens.set(turn, n + 1);
      }
      if (same) {
        const scope = same.scope === 'project' ? tabScope('project', t.projectKey) : tabScope('chat', threadId);
        if (mirrorTarget) d.mirror.setTarget(t.owner, scope, same.id, mirrorTarget);
        d.notify(threadId, { focus: same.id, ...(mirrorTarget ? { target: mirrorTarget } : {}) });
        return { ok: true, tabId: same.id, kind, focused: true, ...(url ? { url } : {}), ...(target ? { path: target.path, ...(target.line ? { line: target.line } : {}) } : {}),
          note: `That ${url ? 'address' : target.type === 'dir' ? 'folder' : 'file'} is already open in tab ${same.id}: it was brought forward${target?.line ? ` at line ${target.line}` : ''} instead of opened twice.` };
      }
      let tab;
      try { tab = d.mirror.add(t.owner, tabScope('chat', threadId), { kind, url, target: mirrorTarget }); }
      catch (e) { if (turn) opens.set(turn, Math.max(0, (opens.get(turn) || 1) - 1)); if (e instanceof TabMirrorError) throw new TabToolError(`open_tab: ${e.message}`, e.code); throw e; }
      d.notify(threadId);
      return { ok: true, tabId: tab.id, kind, ...(url ? { url } : {}),
        ...(target ? { path: target.path, ...(target.line ? { line: target.line } : {}), ...(target.endLine ? { endLine: target.endLine } : {}) } : {}),
        note: `The tab is in this chat's tool panel, marked as opened by you${target ? `, showing ${target.path}${lineText(target)}` : ''}; the user sees it when the panel shows this chat. screenshot_tab and read_tab work on Browser tabs at once.` };
    },
    /** The turn ended (its bridge token was disposed): its open_tab count goes. */
    endTurn(turn) { opens.delete(turn); },
    /** Turns with an open_tab count (tests: dispose leaves none). */
    openCounts: () => opens.size,
    async screenshot(threadId, input = {}) {
      const tab = browserTab('screenshot_tab', threadId, input.tabId);
      const shot = await captureAt('screenshot_tab', threadId, tab.url, { shot: true }, { model: tab.openedBy !== 'user' });
      if (shot.note) throw noteError('screenshot_tab', shot.note);
      if (!shot.painted || !shot.png) throw new TabToolError('screenshot_tab: the page shows nothing (blank) — no image was taken', 'BLANK');
      const att = d.saveImage(threadId, { name: `tab-${tab.id.slice(4)}-${stamp(now())}.png`, png: shot.png });
      return { ok: true, tabId: tab.id, url: tabAddress(tab.url), caption: `Screenshot of ${clip(tabAddress(tab.url), 120)}`,
        items: [{ attId: att.id, name: att.name, kind: 'image', mime: 'image/png', bytes: att.bytes, width: shot.width, height: shot.height }], refused: [] };
    },
    async read(threadId, input = {}) {
      const tab = browserTab('read_tab', threadId, input.tabId);
      const page = await captureAt('read_tab', threadId, tab.url, { text: true }, { model: tab.openedBy !== 'user' });
      if (page.note) throw noteError('read_tab', page.note);
      return { tabId: tab.id, url: tabAddress(tab.url), title: clip(page.title, 200), text: String(page.text || ''),
        truncated: page.truncated === true, consoleErrors: Array.isArray(page.console) ? page.console : [] };
    },
    /** Pick element: the picked element of a local preview on a fresh load, clipped to it (base64 PNG for the composer). */
    async pick({ url, selector, viewport } = {}) {
      const c = classifyUrl(url);
      if (c.error || c.kind !== 'local') throw new TabToolError('Pick element works on local previews only.', 'NOT_LOCAL');
      if (typeof selector !== 'string' || !selector || selector.length > SELECTOR_MAX || /[\u0000-\u001f\u007f]/.test(selector)) {
        throw new TabToolError('That is not a selector Worca made.', 'BAD_INPUT');
      }
      const vp = { width: Math.min(2560, Math.max(320, Math.round(Number(viewport?.width) || 0) || TAB_VIEWPORT.width)),
        height: Math.min(2560, Math.max(240, Math.round(Number(viewport?.height) || 0) || TAB_VIEWPORT.height)) };
      const why = await d.previewRefusal(c.port);
      if (why) throw new TabToolError(why, 'PREVIEW_REFUSED');
      const { origin, prefix, done } = await d.previewBase(c.port);
      let shot;
      try { shot = await d.capture({ url: `${origin}${prefix}${c.path.slice(1)}`, allow: localAllow(origin, prefix, resolve), viewport: vp, selector, scale: 2 }); }
      finally { try { done?.(); } catch { /* already gone */ } }
      if (shot.note) throw noteError('Pick element', shot.note);
      if (shot.missing || !shot.png) {
        throw new TabToolError('The element is not on a fresh load of this page (Worca does not replay clicks or a sign-in), so only its selector was attached.', 'NOT_FOUND');
      }
      return { png: Buffer.from(shot.png).toString('base64'), width: shot.width, height: shot.height };
    },
  };
}
