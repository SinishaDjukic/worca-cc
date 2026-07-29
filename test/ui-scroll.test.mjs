// test/ui-scroll.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
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
  return { window, np, recv, selectProject, tick };
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

const STEP2 = { steps: [ { label: 'A', nodes: [{ id: 'a' }] }, { label: 'B', nodes: [{ id: 'b' }] } ] };
const STEP3 = { steps: [ { label: 'A', nodes: [{ id: 'a' }] }, { label: 'B', nodes: [{ id: 'b' }] }, { label: 'C', nodes: [{ id: 'c' }] } ] };

// ── 1. ON pins every new line to the bottom (Q1) ──────────────────────────────
test('log pins to bottom on a new line while Auto-scroll is ON', async () => {
  const { np, tick } = await boot();
  const r = np.upsertRun({ runId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  r.el = np.buildRunCard(r);
  const logEl = r.el.querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  assert.equal(r.autoscroll, true, 'default ON on the model (seeded by makeRun via upsertRun)');
  np.onLog(r, { source: 'planner', level: 'info', text: 'line 1', ts: 1 });
  await tick();
  assert.equal(logEl.scrollTop, 5000, 'pinned to bottom while ON');
});

// ── 2. OFF holds position, AND survives a card rebuild (bugs #1 + #3) ─────────
test('OFF freezes the log and persists across a card rebuild', async () => {
  const { np, tick } = await boot();
  const r = np.upsertRun({ runId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  r.el = np.buildRunCard(r);

  np.setAutoscroll(r, false);                     // user disables auto-scroll
  assert.equal(r.autoscroll, false);
  let sw = r.el.querySelector('.switch.autoscroll');
  assert.equal(sw.classList.contains('on'), false, 'DOM mirrors OFF');

  // Rebuild the card (what finish/resume/reconcile does) → must NOT re-enable.
  r.el = np.buildRunCard(r);
  sw = r.el.querySelector('.switch.autoscroll');
  assert.equal(sw.classList.contains('on'), false, 'OFF survives the template re-clone');

  const logEl = r.el.querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  logEl.scrollTop = 42;                            // user parked here
  np.onLog(r, { source: 'planner', level: 'info', text: 'new', ts: 2 });
  await tick();
  assert.equal(logEl.scrollTop, 42, 'not re-pinned while OFF');
});

// ── 3. Re-enabling does not jump; the NEXT line follows (Q2) ──────────────────
test('re-enabling holds position; only subsequent lines follow', async () => {
  const { np, tick } = await boot();
  const r = np.upsertRun({ runId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  r.el = np.buildRunCard(r);
  const logEl = r.el.querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });

  np.setAutoscroll(r, false);
  logEl.scrollTop = 100;
  np.setAutoscroll(r, true);                       // re-enable
  assert.equal(logEl.scrollTop, 100, 'enabling did NOT jump to bottom');

  np.onLog(r, { source: 'planner', level: 'info', text: 'after', ts: 3 });
  await tick();
  assert.equal(logEl.scrollTop, 5000, 'the next line follows to bottom');
});

// ── 4. Toggle handler wiring: a real click flips r.autoscroll + mirrors DOM ───
test('clicking the switch toggles the model and the DOM', async () => {
  const { window, np } = await boot();
  const r = np.upsertRun({ runId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  r.el = np.buildRunCard(r);
  window.document.querySelector('#run-list').appendChild(r.el);   // so #run-list delegation catches it
  const sw = r.el.querySelector('.switch.autoscroll');
  assert.equal(r.autoscroll, true);
  sw.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(r.autoscroll, false, 'click disabled it on the model');
  assert.equal(sw.classList.contains('on'), false, 'DOM mirrors OFF');
  assert.equal(sw.getAttribute('aria-checked'), 'false');
});

// ── 5. Pipeline keeps horizontal scroll when a new stage arrives (bug #2, Q3) ─
// jsdom has no layout engine, so emptying .run-flow never collapses its width and
// the .run-flow-wrap scroller never clamps scrollLeft back to 0 the way a real
// browser does. A plain `assert.equal(wrap.scrollLeft, 800)` therefore passes even
// with the fix deleted (false-green). Instead, RECORD writes to scrollLeft and
// assert the rebuild itself wrote the saved value back — that is the restore the fix
// performs. Pre-fix: no restore → writes stay [] → RED. Post-fix: [800] → GREEN.
test('stepper preserves horizontal scroll across a structural rebuild', async () => {
  const { np, tick } = await boot();
  const r = np.upsertRun({ runId: 'p2', title: 't', projectDir: PROJECT, status: 'running' });
  r.stepper = STEP2;
  r.el = np.buildRunCard(r);                       // builds the 2-column graph (sig 'a|b')

  const wrap = r.el.querySelector('.run-flow-wrap');
  let left = 0; const writes = [];
  Object.defineProperty(wrap, 'scrollWidth', { configurable: true, get: () => 3000 });
  Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(wrap, 'scrollLeft', {
    configurable: true, get: () => left, set: (v) => { left = v; writes.push(v); },
  });
  wrap.scrollLeft = 800;                           // user scrolled right
  writes.length = 0;                               // ignore the manual set; watch only the rebuild

  // A new stage → node-id signature changes ('a|b' → 'a|b|c') → buildRunGraph wipes + rebuilds.
  r.stepper = STEP3;
  np.buildRunGraph(r.el.querySelector('.run-flow'), r.stepper);
  await tick();
  assert.deepEqual(writes, [800], 'buildRunGraph restored the saved scrollLeft after the wipe');
  assert.equal(wrap.scrollLeft, 800, 'horizontal scroll preserved across rebuild');
});

// ── 6. End-to-end: a real WS log frame while OFF does NOT scroll, even through
//       the full dispatch + Running-view render path (bugs #1/#3, routing). ────
test('WS log frame while OFF does not scroll, through the real dispatch', async () => {
  const { window, np, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p3', phase: 'plan', cycle: 0 });   // mounts the card via renderRunningView
  await tick();
  const r = np.getRun('p3');
  assert.ok(r && r.el, 'card mounted by the running view');

  np.setAutoscroll(r, false);
  const logEl = r.el.querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  logEl.scrollTop = 30;
  recv({ type: 'log', runId: 'p3', source: 'planner', level: 'info', text: 'x', ts: 4 });
  await tick();
  assert.equal(logEl.scrollTop, 30, 'no scroll while OFF — through onLog AND the paintRunList re-pin');
});
