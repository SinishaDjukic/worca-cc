// test/ui-scroll.test.mjs — log-pane scroll behaviour. The live log lives on the run page's
// Details > Live log tab now (the list row has no log pane), so the pin/freeze cases drive that pane.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
  await new Promise((r) => setTimeout(r, 0));                    // let loadProjects/loadConfig settle
  const np = window.__np;
  // WS is created at import time (connectWS() at app.js:8054) → lastWs is set now.
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const selectProject = () => {
    const s = window.document.querySelector('#projectSelect');
    s.value = PROJECT;
    s.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // The bottom-pin is coalesced to one flush per pane per frame (app.js
  // schedulePinToBottom); with no rAF under this jsdom boot the 16ms timer
  // fallback runs it, so a pin assertion must outwait that timer.
  const tickPin = () => new Promise((r) => setTimeout(r, 30));
  return { window, np, recv, selectProject, tick, tickPin };
}

// jsdom has no layout: make scroll geometry observable. scrollTop/scrollLeft become
// plain stored values; the *Height/*Width readbacks are fixed to the passed values.
function instrumentScroll(el, { scrollHeight = 1000, clientHeight = 200, scrollWidth = 1000, clientWidth = 200 } = {}) {
  let top = 0, left = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollWidth',  { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, 'clientWidth',  { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, 'scrollTop',  { configurable: true, get: () => top,  set: (v) => { top  = v; } });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => left, set: (v) => { left = v; } });
}

const RD = (window) => window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .log');

// Seed a running pipeline and open its run page on the Live log tab.
async function openLogs(ctx, runId = 'p1') {
  const { window, recv, selectProject, tick } = ctx;
  selectProject();
  recv({ type: 'run-created', runId, title: 't', projectDir: PROJECT, status: 'running', startedAt: '10:00:00', kind: 'run' });
  window.location.hash = `running/${runId}/details/logs`;
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 6; i += 1) await tick();
  const box = RD(window);
  assert.ok(box, 'the run page renders the Live log pane');
  return box;
}
const logFrame = (ctx, runId, text, extra = {}) => ctx.recv({ type: 'log', runId, source: 'planner', level: 'info', text, ts: Date.now(), ...extra });

// ── 1. ON pins every new line to the bottom (Q1); re-enabling does not jump, the NEXT line follows (Q2).
//       One boot: the pane opened once, then both cases in order. ─────────────────
test('Auto-scroll ON pins each new line to the bottom; re-enabling holds the position and only the next line follows', async () => {
  const ctx = await boot();
  const box = await openLogs(ctx);
  await checkRows([
    { name: 'log pins to bottom on a new line while Auto-scroll is ON', run: async () => {
      instrumentScroll(box, { scrollHeight: 5000, clientHeight: 300 });
      assert.equal(ctx.np.getRun('p1').autoscroll, true, 'default ON on the model');
      logFrame(ctx, 'p1', 'line 1');
      await ctx.tickPin();
      assert.equal(box.scrollTop, 5000, 'pinned to bottom while ON');
    } },
    { name: 're-enabling holds position; only subsequent lines follow', run: async () => {
      const r = ctx.np.getRun('p1');
      instrumentScroll(box, { scrollHeight: 5000, clientHeight: 300 });
      ctx.np.setAutoscroll(r, false);
      box.scrollTop = 100;
      ctx.np.setAutoscroll(r, true);                   // re-enable
      assert.equal(box.scrollTop, 100, 'enabling did NOT jump to bottom');
      logFrame(ctx, 'p1', 'after');
      await ctx.tickPin();
      assert.equal(box.scrollTop, 5000, 'the next line follows to bottom');
    } },
  ]);
});

// ── 2. OFF holds position through the real dispatch, and survives reopening the run page ─
test('OFF freezes the log through a WS frame and persists across a run page reopen', async () => {
  const ctx = await boot();
  let box = await openLogs(ctx);
  const r = ctx.np.getRun('p1');
  // user disables auto-scroll with the pane's own switch (the run page mirrors the model onto it)
  ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .switch.autoscroll')
    .dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  assert.equal(r.autoscroll, false);
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .switch.autoscroll').classList.contains('on'), false, 'DOM mirrors OFF');

  instrumentScroll(box, { scrollHeight: 5000, clientHeight: 300 });
  box.scrollTop = 30;                             // user parked here
  logFrame(ctx, 'p1', 'x');
  await ctx.tickPin();
  assert.equal(box.scrollTop, 30, 'no scroll while OFF');

  // Leave the run page and come back: the pane is rebuilt and must NOT re-enable.
  // (Leave through another view: side by side a bare #runs reopens this same run.)
  ctx.window.location.hash = 'new';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.tick();
  ctx.window.location.hash = 'running/p1/details/logs';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  for (let i = 0; i < 6; i += 1) await ctx.tick();
  box = RD(ctx.window);
  assert.equal(r.autoscroll, false, 'OFF survives the reopen');
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .switch.autoscroll').classList.contains('on'), false, 'the rebuilt switch reads OFF');
  instrumentScroll(box, { scrollHeight: 5000, clientHeight: 300 });
  box.scrollTop = 42;
  logFrame(ctx, 'p1', 'y');
  await ctx.tickPin();
  assert.equal(box.scrollTop, 42, 'not re-pinned while OFF after the reopen');
});

// ── 3. A filter change repaints the pane (rdRepaintLog); with Auto-scroll OFF the
//       position must survive the repaint. Record writes: the repaint must write the
//       saved scrollTop back. ──────────────────────────────────────────────────
test('filter-change repaint keeps the OFF scroll position', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const box = await openLogs(ctx, 'p9');
  logFrame(ctx, 'p9', 'a', { source: 'planner' });
  logFrame(ctx, 'p9', 'b', { source: 'implementer' });
  await ctx.tick();

  ctx.np.setAutoscroll(ctx.np.getRun('p9'), false);
  let top = 0; const writes = [];
  Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; writes.push(v); } });
  box.scrollTop = 42;
  writes.length = 0;                                   // watch only the repaint

  const sel = window.document.querySelector('#run-detail .rd-sec[data-sec="logs"] .log-f-source');
  sel.value = 'planner';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await ctx.tick();
  assert.deepEqual(writes, [42], 'repaint restored the saved position (and did not pin to bottom)');
});

// ── 4. A pin queued before the switch flips OFF never lands (flush re-checks the flag) ──
test('a pin queued before the switch flips OFF never lands', async () => {
  const ctx = await boot();
  const box = await openLogs(ctx);
  instrumentScroll(box, { scrollHeight: 1000, clientHeight: 200 });
  box.scrollTop = 42;                                       // user parked mid-log
  logFrame(ctx, 'p1', 'x');
  ctx.np.setAutoscroll(ctx.np.getRun('p1'), false);         // the freeze gesture, same frame
  await ctx.tickPin();
  assert.equal(box.scrollTop, 42, 'the stale pin was dropped at flush');
});
