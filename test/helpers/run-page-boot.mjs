// test/helpers/run-page-boot.mjs — boot the REAL app.js under jsdom and open the
// run page (#running/<id>) for a run, where the question / gate / recovery /
// workflow panel is mounted (`#run-detail .rd-questions .qpanel`). The Runs list
// row never hosts a panel: it is a link (icon, title, subline) to the run page, and
// a waiting question puts it in the Needs-you group.
//
// bootApp() captures the single WebSocket app.js creates, so a test can push
// server frames through `dispatch(msg)` and record every fetch in `calls`.
import { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './jsdom-release.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));

// `local`: localStorage items set before app.js loads (it reads some once at import, e.g. the Runs View menu).
export async function bootApp({ fetchHandler, hooks = null, local = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1; // OPEN — app.js gates backfill subscribes on wsReady
      this._listeners = {};
      wsBox.ws = this;
    }
    send() {}
    close() {}
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    }
    dispatch(type, evt) {
      (this._listeners[type] || []).forEach((fn) => fn(evt));
    }
  };

  // Record fetch calls; default to a benign JSON 200 for the boot fetches.
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(url), opts || {});
      if (r) return r;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  if (hooks) window.__worcaTestHooks = { ...hooks };
  for (const [k, v] of Object.entries(local || {})) window.localStorage.setItem(k, v);

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  function dispatch(msg) {
    wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  }
  function go(hash) {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
  }
  // The bare Runs list with nothing selected, as #running was: a bare route would
  // otherwise reopen the remembered run (D6), so forget it first.
  const showRunning = () => {
    window.localStorage.removeItem('worca-cc.runs.last');
    go('runs');
  };
  const settle = async (n = 3) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };

  return { window, dispatch, go, showRunning, settle, calls, wsBox };
}

// Open the socket and hello one running run (optionally pre-seeded with a
// pendingQuestion). Does not navigate.
export function helloRun(ctx, { runId, title = 'Demo run', ...extra } = {}) {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    runs: [{ runId, title, projectDir: '/tmp/p', status: 'running', kind: 'run',
      startedAt: '2026-01-01T00:00:00Z', ...extra }],
  });
}

// The run's row in its project group (a Needs-you run is repeated above it).
export const runCard = (ctx, runId) =>
  ctx.window.document.querySelector(`#runs-list .runs-row[data-run-id="${runId}"]`);

// The run page's panel host, and its .qpanel (null until the page is open).
export const runPanel = (ctx) => ctx.window.document.querySelector('#run-detail .rd-questions .qpanel');

// hello a run, push its `question` frame (if any), open #running/<runId> and
// return the run page's .qpanel. `run` seeds extra run fields (e.g. a
// hello-seeded pendingQuestion) instead of a separate question frame.
export async function openRunPanel(ctx, { runId, question = null, run = {} }) {
  helloRun(ctx, { runId, ...run });
  if (question) ctx.dispatch({ type: 'question', runId, ...question });
  ctx.go(`running/${runId}`);
  await ctx.settle();
  return runPanel(ctx);
}
