// test/helpers/chat-panel-boot.mjs — boot the REAL app.js against the REAL index.html under jsdom with
// the Chat page (worca Chat P1) and reach its run panel (worca Chat P4). One fetch stub serves History
// (rows + one saved detail), Ask, answers, resume, stop and archive, and records what was posted; `url`
// deep-links the boot. Same shape as test/helpers/run-page-boot.mjs (the house boot).
import { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './jsdom-release.mjs';
import { KEY, ROW, DETAIL, TABS_DETAIL, PAUSED_DETAIL } from './history-detail-boot.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../../ui/public/app.js', import.meta.url));

export { KEY, ROW, DETAIL, TABS_DETAIL, PAUSED_DETAIL };
export const PROJECT_DIR = '/tmp/p';
export const DETAIL_URL = `/api/history/${KEY}/${ROW.id}`;
export const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
export const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

// `matchMedia`: a stub installed BEFORE app.js loads (jsdom has none), e.g. a phone-width nav for the drawer test.
// `local`: localStorage items set before app.js loads (a remembered choice, e.g. the side column left open).
// `innerWidth`: the window's width before app.js loads (jsdom's is 1024).
export async function bootChat({ rows = [], detail = DETAIL, url = 'http://localhost:4317/', arms = null, matchMedia = null, local = null, innerWidth = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  if (matchMedia) window.matchMedia = matchMedia;
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  if (innerWidth) Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true, writable: true });

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };

  // Most specific first; history arms match with endsWith (the detail URL prefixes /diff and /log).
  const box = { rows, detail, answers: [], resumed: [], stops: [], deleted: [] };
  const calls = [];
  window.fetch = (u, opts = {}) => {
    const href = String(u);
    calls.push({ url: href, opts: opts || {} });
    const own = arms && arms(href, opts || {}, box);
    if (own) return own;
    const path = href.split('?')[0];
    const body = () => JSON.parse((opts && opts.body) || '{}');
    if (path.endsWith('/api/answer')) { box.answers.push(body()); return ok({ ok: true }); }
    if (path.endsWith('/api/resume')) { box.resumed.push(body()); return ok({ runId: 'r2' }); }
    if (path.endsWith('/api/stop')) { box.stops.push(body()); return ok({ ok: true }); }
    if (opts && opts.method === 'DELETE' && path.includes('/api/runs/')) { box.deleted.push(path); return ok({ ok: true }); }
    if (path.endsWith('/api/history/pr')) return ok({ ok: true });
    if (path.endsWith('/diff') || path.endsWith('/log')) return fail(404, { error: 'none' });
    if (path.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: false });
    if (path.endsWith(DETAIL_URL)) return ok(box.detail);
    if (path.endsWith('/live-diff')) return fail(404, { error: 'not live' });
    if (path.includes('/api/ask/')) return ok({ threads: [] });
    return ok({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch { /* read-only global already present — leave it */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));   // app.js's microtasks (the run panel wiring) have run
  wsBox.ws.dispatch('open', {});
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const dispatch = (msg) => wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  await settle();
  return { window, box, calls, wsBox, settle, dispatch, go };
}

export const liveRun = (extra = {}) => ({
  runId: 'r1', title: 'Add dark mode', projectDir: PROJECT_DIR, status: 'running', kind: 'run',
  startedAt: '2026-01-01T00:00:00Z', pipelineId: 'p1', ...extra,
});
export const hello = (ctx, runs) => ctx.dispatch({ type: 'hello', runs });
export const panelOf = (ctx) => ctx.window.document.querySelector('[data-chat-panel]');
export const pageOf = (ctx) => ctx.window.document.querySelector('[data-chat-page]');
export const screenOf = (ctx) => {
  const panel = panelOf(ctx);
  return panel ? panel.querySelector('.crp-host > .rd, .crp-host > .hd') : null;
};
export const noticeOf = (ctx) => {
  const panel = panelOf(ctx);
  return panel ? panel.querySelector('.crp-msg') : null;
};
export const click = (ctx, node) => node.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
// Cancelable, so a test can read `defaultPrevented` off the returned event.
export const esc = (ctx, target) => {
  const ev = new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
};
export const detailLoads = (ctx) => ctx.calls.filter((c) => c.url.split('?')[0].endsWith(DETAIL_URL)).length;
export async function openPanel(ctx, tail, n = 6) {
  ctx.go(`chat/new/run/${tail}`);
  await ctx.settle(n);
  return screenOf(ctx);
}
