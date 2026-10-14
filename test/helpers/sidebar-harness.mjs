// test/helpers/sidebar-harness.mjs — boots the REAL extension/src/sidebar/sidebar.mjs in jsdom: a fake WebExtension
// API, a routed fetch, a fake WebSocket and node:test mock timers (the offline retry, the pairing poll). Each
// bootSidebar() evaluates a fresh copy of the module (a query string) against a fresh document.
import { mock } from 'node:test';
import { JSDOM } from 'jsdom';

let seq = 0;
const live = { h: null };
// ext-api.mjs binds `api` ONCE per process, so this one object stays; each harness swaps what it delegates to.
globalThis.chrome = {
  runtime: { id: 'wx-test', connect: () => live.h.connect() },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: { create: (o) => { live.h.tabsCreated.push(o); return Promise.resolve({ id: 99 }); } },
  commands: { getAll: async () => live.h.commands },
  storage: {
    local: {
      get: async (keys) => live.h.localGet(keys),
      set: async (o) => { Object.assign(live.h.store, o); },
      remove: async (k) => { for (const x of [].concat(k)) delete live.h.store[x]; },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
};

export const ok = (body, status = 200) => ({ status, body });
export const OFFLINE = 'offline';

/**
 * @param {{storage?:object, route?:(path:string, opts:object, method:string)=>({status?:number, body:any}|'offline'|null), commands?:object[]}} o
 *   commands: what chrome.commands.getAll() answers (the bound shortcuts).
 *   route: null or 'offline' → the fetch throws (nothing answers).
 */
export async function bootSidebar({ storage = {}, route = () => null, commands = [] } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const dom = new JSDOM('<!doctype html><html lang="en" data-theme="system"><body><div id="app" class="wx-app"></div></body></html>', { url: 'chrome-extension://wx-test/sidebar.html' });
  const w = dom.window;
  const h = {
    dom, win: w, doc: w.document, store: { ...storage }, posted: [], calls: [], tabsCreated: [], sockets: [], route, commands, bgListeners: [],
    localGet(keys) {
      const out = {};
      for (const k of keys == null ? Object.keys(h.store) : [].concat(keys)) if (k in h.store) out[k] = h.store[k];
      return out;
    },
    connect() {
      const listeners = [];
      h.bgListeners = listeners;
      return { postMessage: (m) => h.posted.push(m), onMessage: { addListener(fn) { listeners.push(fn); } }, onDisconnect: { addListener() {} } };
    },
    /** Deliver a service-worker message to the sidebar (tab / quote / capture / capture-failed / notice). */
    async fromBackground(m) { for (const fn of h.bgListeners) fn(m); await h.flush(); },
    async flush() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); },
    async tick(ms) { mock.timers.tick(ms); await h.flush(); },
    $: (s) => w.document.querySelector(s),
    $$: (s) => [...w.document.querySelectorAll(s)],
    click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return h.flush(); },
    change(el, value) { el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); return h.flush(); },
    paths: () => h.calls.map((c) => c.split(' ')[1].replace(/^https?:\/\/[^/]+/, '')),
  };
  live.h = h;
  class FakeSocket {
    constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 1; this.sent = []; h.sockets.push(this); }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; }
  }
  Object.assign(globalThis, {
    window: w, document: w.document, location: w.location, Option: w.Option, File: w.File, WebSocket: FakeSocket,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (...a) => w.addEventListener(...a),
  });
  globalThis.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const u = new URL(url);
    h.calls.push(`${method} ${u.origin}${u.pathname}${u.search}${opts.body ? ` ${opts.body}` : ''}`);
    const r = h.route(`${u.pathname}${u.search}`, opts, method, u);
    if (r == null || r === OFFLINE) throw new TypeError('fetch failed');
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.body };
  };
  await import(`../../extension/src/sidebar/sidebar.mjs?harness=${++seq}`);
  await h.flush();
  return h;
}

export function stopSidebar() { mock.timers.reset(); }

export const SNAP = (id, context = null) => ({
  thread: { id, title: 'Rate limits', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context, totals: {} },
  messages: [{ id: 'askm_00000001', threadId: id, seq: 1, role: 'user', text: 'Why?', blocks: [], status: null, createdAt: 't' }],
  attachments: [], runLinks: [], inFlight: null, worktrees: [],
});

/** Routes for a paired sidebar: hello, status, models, threads, plus `extra` (checked first). */
export function pairedRoutes(extra = null, { projects = [], workspaces = [], threads = [] } = {}) {
  return (path, opts, method) => {
    const r = extra ? extra(path, opts, method) : null;
    if (r !== null && r !== undefined) return r;
    if (path === '/api/extension/hello') return ok({ ok: true });
    if (path === '/api/extension/status') return ok({ ok: true });
    if (path === '/api/ask/models') return ok({ models: [] });
    if (path.startsWith('/api/ask/threads?')) return ok({ threads });
    if (path === '/api/projects') return ok({ projects });
    if (path === '/api/workspaces') return ok({ workspaces });
    return ok({});
  };
}
