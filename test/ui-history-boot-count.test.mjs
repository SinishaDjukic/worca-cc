// test/ui-history-boot-count.test.mjs
// On the first WS `hello`, history is background-loaded (PR states ready) even when
// boot lands on the default New-pipeline view (Runs never opened). The finished runs
// never number the Runs menu item: it counts live runs and Needs you only (D11).
// Boots the REAL app.js under jsdom.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const hello = () => wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  return { window, calls, wsBox, tick, hello };
}

const skeleton = (pipelines, ghAvailable = false) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

const ROW = (over = {}) => ({
  id: 'p1', title: 'Feat', status: 'stopped', startedAt: '2026-06-02T00:00:00Z',
  projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj', ...over,
});

test('first connect background-loads history (Runs stays hidden, no Needs-you count for finished runs) and requests PR enrichment', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history')
      ? skeleton([ROW(), ROW({ id: 'p2' }), ROW({ id: 'p3' })], true) : null),
  });
  const historyFetches = () => ctx.calls.filter((c) => c.url.endsWith('/api/history')).length;
  const before = historyFetches();

  ctx.hello();                 // server greets the socket -> background history load
  await ctx.tick();            // let /api/history resolve + paint

  await checkRows([
    { name: 'first connect background-loads history without opening Runs or numbering its menu item', run: () => {
      assert.ok(historyFetches() > before, 'history was loaded even though Runs was never opened');
      const doc = ctx.window.document;
      assert.ok(doc.querySelector('[data-view="runs"]').classList.contains('hidden'),
        'the Runs view stays hidden');
      // The Runs button's textContent holds both badges (the hidden Needs-you one reads "0"),
      // so read each: three stopped rows need nobody and are not live.
      assert.equal(doc.querySelector('#nav-needs-count').hidden, true, 'no Needs-you count for finished runs');
      assert.equal(doc.querySelector('#nav-running-count').textContent, '0', 'the live count, not the 3 finished runs');
      assert.equal(doc.querySelector('#nav-running-count').hidden, true, 'and a zero is hidden');
    } },
    { name: 'the background load also triggers Phase-2 PR enrichment so PR states are ready', run: async () => {
      const post = ctx.calls.find((c) => c.url.endsWith('/api/history/pr') && c.opts.body);
      assert.ok(post, 'enrichment was requested on boot');
      // settle the watchdog so the test process exits clean
      const token = JSON.parse(post.opts.body).token;
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, done: true, items: [] }) });
      await ctx.tick();
    } },
  ]);
});

test('reconnect (second hello) does not re-load when already booted', async () => {
  let historyFetches = 0;
  const ctx = await boot({
    fetchHandler: (url) => {
      if (url.endsWith('/api/history')) { historyFetches += 1; return skeleton([ROW()]); }
      return null;
    },
  });
  ctx.hello(); await ctx.tick();
  ctx.hello(); await ctx.tick();               // a reconnect greeting
  assert.equal(historyFetches, 1, 'history is background-loaded once, not on every reconnect');
});
