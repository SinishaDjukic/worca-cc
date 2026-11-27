// test/helpers/shared-app-boot.mjs
// One boot of the real web app (ui/public/app.js) per test FILE, reset before each test.
//
// A UI suite that imports app.js under a fresh `?b=` URL in every test pays a JSDOM window, ~270 module imports and
// the app's start-up per test. useSharedApp() boots once in before(), resets the one window in beforeEach(), and
// releases it in after(). Nothing in ui/public changes: app.js exports nothing, so its private state (the `runs` Map,
// the first-hello latch, History's boot latch) outlives a reset. A converted test therefore uses its own ids
// (`app.uid()`), and a test that needs different load-time state (a deep-link url, storage or a hook app.js reads at
// import, the answer to a request it sends only at import) lives in a sibling file booted with those options.
//
// The reset (fresh()), in this order:
//   1. drain the previous test's queued work;
//   2. reinstall the recording fetch and the boot globals, and clear the intervals started after the boot (the app's
//      import-time intervals, its 1 s tick, are kept);
//   3. a hello from a "restarted server" (a new bootId) that lists every run id the file's frames named as paused,
//      then the archive frame that evicts parked copies: the earlier tests' runs leave the app's run list;
//   4. close open dialogs and remove menus, toasts and card alerts (never the app's host elements);
//   5. storage cleared, then the file seed, then the test's;
//   6. the boot flags and level back, through the app's own channels (applyFlags, applyLevel), then the test's;
//   7. window.__worcaTestHooks = { ...file hooks, ...test hooks };
//   8. the route: the test's hash, else `resetHash`;
//   9. fetch answers through the test's handler, then the file's, then the default; `calls` is emptied.
//
// importCount() counts real loads of ui/public/app.js in this process, through any helper, by a module resolve hook;
// after() fails the file unless it is exactly 1.
//
// Limits a converted file works within:
//   - app.js is loaded with require() (require(esm)), so nothing in its import graph may use top-level await
//     (ERR_REQUIRE_ASYNC_MODULE), and a converted file runs no top-level await before its first test(.
//   - step 3 evicts only the runs a socket frame named; a run seen only in a fetch reply (a History row) stays, so
//     each test gives its runs their own ids (app.uid()).
//   - step 2 clears every interval started after the boot, including one the app keeps in a guard variable
//     (`if (!timer) timer = setInterval(…)`); such an interval does not restart in a later test.
//   - the WS stub and the default body mirror test/helpers/run-page-boot.mjs (slice 16 keeps one of the two).
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './jsdom-release.mjs';
import { readIndexHtml } from '../../src/core/read-index-html.mjs';
import { applyFlags, currentFlags } from '../../ui/public/flags.mjs';
import { applyLevel } from '../../ui/public/ui-level.mjs';

const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));
const require = createRequire(import.meta.url);

// Every distinct resolved URL of app.js (each cache-busting query is a new module instance).
const appLoads = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    try { if (new URL(r.url).pathname.endsWith('/ui/public/app.js')) appLoads.add(r.url); } catch { /* not a URL */ }
    return r;
  },
});

// Intervals started after the boot, cleared by each reset. Wrapped at load, so a test file's own wrapper sits on top.
const lateIntervals = new Set();
let recordIntervals = false;
const startInterval = globalThis.setInterval;
globalThis.setInterval = function (...args) {
  const handle = startInterval.apply(this, args);
  if (recordIntervals) lateIntervals.add(handle);
  return handle;
};

const DEFAULT_BODY = () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] });
const FRESH_KEYS = new Set(['fetchHandler', 'local', 'session', 'hooks', 'flags', 'level', 'hash']);
const LOAD_KEYS = new Set(['url', 'html', 'setup', 'matchMedia', 'innerWidth', 'resetHash']);
const GLOBALS = ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator'];
const OVERLAYS = 'body > .wfv-menu, #toasts > .toast, .card-alert';

let claimed = false;

/**
 * Put `obj[key]` back as it was (its own property, or none) when test `t` ends. A test that patches the one shared
 * window (a prototype method, navigator.clipboard, a window seam such as __prMergeRecheckMs) calls this first, so the
 * patch never reaches a later test of the file.
 */
export function restoreAfter(t, obj, key) {
  const had = Object.getOwnPropertyDescriptor(obj, key);
  t.after(() => { if (had) Object.defineProperty(obj, key, had); else delete obj[key]; });
}

/**
 * Boot app.js once for this test file and reset it before each test.
 * @param {{ before: Function, beforeEach: Function, after: Function }} hooks  the node:test hooks
 * @param {object} [options]  load-time inputs (see the contract in the header)
 */
export function useSharedApp(hooks, options = {}) {
  if (claimed) throw new Error('useSharedApp: one shared app per test file');
  claimed = true;
  const {
    url = 'http://localhost:4317/', html = null, hooks: fileHooks = null, local = null, session = null, flags = null,
    level = null, matchMedia = null, innerWidth = null, setup = null, fetchHandler = null, resetHash = '',
  } = options;

  const calls = [];
  const wsBox = { ws: null };
  const runIds = new Set();   // every run id a server frame of this file named (reset step 3 drops their parked copies)
  const noteRunIds = (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.runId) runIds.add(msg.runId);
    for (const r of Array.isArray(msg?.runs) ? msg.runs : []) if (r?.runId) runIds.add(r.runId);
  };
  let booted = false;
  let bootFlags = null;
  let bootLevel;
  let handler = fetchHandler;
  let resets = 0;
  let ids = 0;

  const recordingFetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    for (const h of handler === fetchHandler ? [handler] : [handler, fetchHandler]) {
      if (!h) continue;
      const r = h(String(u), opts || {});
      if (r) return r;
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => DEFAULT_BODY() });
  };

  const app = {
    window: null,
    document: null,
    calls,
    wsBox,
    recv(msg) { wsBox.ws.dispatch('message', { data: JSON.stringify(msg) }); },
    dispatch(msg) { app.recv(msg); },
    go(hash) {
      app.window.location.hash = hash;
      app.window.dispatchEvent(new app.window.Event('hashchange'));
    },
    async settle(n = 3) {
      for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
    },
    uid(prefix = 'r') { return `${prefix}${++ids}`; },
    importCount() { return appLoads.size; },
    fresh: (perTest) => fresh(perTest),
  };

  const copyGlobals = () => {
    const { window } = app;
    window.fetch = recordingFetch;
    for (const k of GLOBALS) {
      try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
    }
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.fetch = recordingFetch;
  };
  const seed = (storage, items) => { for (const [k, v] of Object.entries(items || {})) storage.setItem(k, v); };
  const setHooks = (extra) => {
    if (!fileHooks && !extra) delete app.window.__worcaTestHooks;
    else app.window.__worcaTestHooks = { ...fileHooks, ...extra };
  };

  async function fresh(perTest = {}) {
    for (const key of Object.keys(perTest || {})) {
      if (LOAD_KEYS.has(key)) throw new Error(`useSharedApp: ${key} is read when app.js loads; pass it to useSharedApp(…) instead`);
      if (!FRESH_KEYS.has(key)) throw new Error(`useSharedApp: unknown fresh() option ${key}`);
    }
    if (!booted) throw new Error('useSharedApp: the app is not booted yet');
    const { window, document } = app;
    // 1. the previous test's queued work runs now, before its leftovers are cleared
    await app.settle(3);
    // 2. the recording fetch and the boot globals back; intervals started since the boot cleared
    handler = fetchHandler;
    copyGlobals();
    for (const h of lateIntervals) clearInterval(h);
    lateIntervals.clear();
    // 3. a restarted server's hello parks every run the earlier tests named (paused: not a finish, so no missed-finish
    // handling), then the archive frame that evicts parked copies takes them out of the app's run list
    const seen = [...runIds];
    app.recv({ type: 'hello', runs: seen.map((runId) => ({ runId, status: 'paused', kind: 'run' })), bootId: `shared-app-boot-${++resets}` });
    if (seen.length) app.recv({ type: 'pipelines-changed', removedRunIds: seen });
    await app.settle(3);
    // 4. overlays
    for (const d of document.querySelectorAll('dialog[open]')) {
      try { d.close(); } catch { /* not a dialog jsdom can close */ }
      d.removeAttribute('open');
    }
    for (const el of document.querySelectorAll(OVERLAYS)) el.remove();
    // 5. storage
    window.localStorage.clear();
    window.sessionStorage.clear();
    seed(window.localStorage, local);
    seed(window.sessionStorage, session);
    seed(window.localStorage, perTest.local);
    seed(window.sessionStorage, perTest.session);
    // 6. flags and level, through the app's own channels so listeners repaint
    applyFlags(bootFlags, document);
    if (perTest.flags) applyFlags(perTest.flags, document);
    const nextLevel = perTest.level ?? level ?? bootLevel;
    if (nextLevel != null) applyLevel(nextLevel, document);
    else delete document.documentElement.dataset.level;
    // 7. hooks
    setHooks(perTest.hooks);
    // 8. the route
    app.go(perTest.hash ?? resetHash);
    await app.settle(3);
    // 9. the test's fetch handler, and a clean record
    handler = perTest.fetchHandler ?? fetchHandler;
    calls.length = 0;
    return app;
  }

  const trackDom = useDomRelease(hooks.after);

  hooks.before(async () => {
    const dom = trackDom(new JSDOM(html ?? readIndexHtml(), { url }));
    const { window } = dom;
    app.window = window;
    app.document = window.document;
    window.Element.prototype.scrollIntoView = function () {};
    window.WebSocket = class {
      constructor() {
        this.readyState = 1; // OPEN: app.js gates backfill subscribes on wsReady
        this._listeners = {};
        wsBox.ws = this;
      }
      send() {}
      close() {}
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
      dispatch(type, evt) {
        if (type === 'message') noteRunIds(evt?.data);
        (this._listeners[type] || []).forEach((fn) => fn(evt));
      }
    };
    if (matchMedia) window.matchMedia = matchMedia;
    if (innerWidth != null) Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true, writable: true });
    if (level != null) window.document.documentElement.dataset.level = level;
    if (flags) applyFlags(flags, window.document);
    copyGlobals();
    setHooks(null);
    seed(window.localStorage, local);
    seed(window.sessionStorage, session);
    if (setup) setup(window);

    // Loaded synchronously (require of an ES module with no top-level await): node:test starts a file's root before()
    // hooks together, without awaiting one before the next, so a test file's own before() sees the app as the import
    // left it only if the import is done before this hook's first await. One load per process, so no cache-busting.
    require(appPath);
    await new Promise((r) => setTimeout(r, 0));
    wsBox.ws?.dispatch('open', {});

    bootFlags = currentFlags(window.document);
    bootLevel = window.document.documentElement.dataset.level;
    recordIntervals = true;
    booted = true;
  });

  hooks.beforeEach(() => fresh());

  // The file's verdict on its boots: any other app.js load (bootApp, a local boot) fails the file.
  hooks.after(() => {
    recordIntervals = false;
    for (const h of lateIntervals) clearInterval(h);
    lateIntervals.clear();
    if (!booted) return;   // before() failed and said why; a count would only add noise
    const n = appLoads.size;
    if (n !== 1) throw new Error(`useSharedApp: app.js was imported ${n} times in this file; expected 1`);
  });

  return app;
}
