// test/ui-running-density.test.mjs — the Compact/Detailed density toggle, the two
// card bodies, and the removal of the card's Agents disclosure.
//
// boot() is copied VERBATIM from test/ui-pipeline-tabs.test.mjs (lines 15-35) —
// the nearest suite that captures the WebSocket and clears localStorage — with the
// two-line `local` pre-seed from test/ui-history-pills.test.mjs added, since the
// persistence cases must write localStorage BEFORE app.js boots.
// instrumentScroll() is copied VERBATIM from test/ui-scroll.test.mjs:45-53.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const cssPath = join(root, 'style.css');
const PROJECT = '/tmp/proj';
const KEY = 'worca-cc.running.density';

async function boot({ local } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  // Pre-seed localStorage BEFORE app.js boots so restore-on-load is exercised.
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, recv, showRunning };
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

const RUN_ID = 'run-den';
const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});
const seg = (doc, v) => doc.querySelector(`.run-density .rc-dseg[data-density="${v}"]`);
const card = (doc) => doc.querySelector(`#run-list .run-card[data-run-id="${RUN_ID}"]`);

const STEPPER = { version: 1, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
  { kind: 'agents', nodes: [{ id: 's1_0', key: 'planner', uiPhase: 'plan', label: 'Plan', model: 'sonnet', effort: 'high' }] },
  { kind: 'agents', nodes: [{ id: 's2_0', key: 'reviewer', uiPhase: 'review', label: 'Review' }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
], feedbacks: [] };

test('the running topbar carries a two-segment density toggle, Detailed pressed by default', async () => {
  const { window, showRunning } = await boot();
  showRunning();
  const doc = window.document;
  const group = doc.querySelector('[data-view="running"] .run-density');
  assert.ok(group, '.run-density group present in the running topbar');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'List density');
  const segs = [...group.querySelectorAll('button.rc-dseg')];
  assert.deepEqual(segs.map((b) => b.dataset.density), ['compact', 'detailed']);
  assert.deepEqual(segs.map((b) => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.match(segs[0].title, /Compact/);
  assert.match(segs[1].title, /Detailed/);
  assert.ok(segs[0].querySelector('svg') && segs[1].querySelector('svg'), 'both segments carry an icon');
  assert.equal(window.__np.readRunDensity(), 'detailed', 'default density is detailed');
});

test('an absent or invalid stored value falls back to detailed', async () => {
  const bad = await boot({ local: { [KEY]: 'ginormous' } });
  bad.showRunning();
  assert.equal(bad.window.__np.readRunDensity(), 'detailed');
  assert.equal(seg(bad.window.document, 'detailed').getAttribute('aria-pressed'), 'true');
});

test('a stored compact value is honoured at boot and stamped on the cards', async () => {
  const ctx = await boot({ local: { [KEY]: 'compact' } });
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  assert.equal(ctx.window.__np.readRunDensity(), 'compact');
  assert.equal(seg(doc, 'compact').getAttribute('aria-pressed'), 'true');
  assert.equal(seg(doc, 'detailed').getAttribute('aria-pressed'), 'false');
  assert.equal(card(doc).dataset.density, 'compact');
});

test('clicking a segment repaints the cards, flips aria-pressed and persists the choice', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  assert.equal(card(doc).dataset.density, 'detailed');

  seg(doc, 'compact').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'compact');
  assert.equal(seg(doc, 'compact').getAttribute('aria-pressed'), 'true');
  assert.equal(seg(doc, 'detailed').getAttribute('aria-pressed'), 'false');
  assert.equal(ctx.window.localStorage.getItem(KEY), 'compact', 'choice persisted');

  seg(doc, 'detailed').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'detailed');
  assert.equal(ctx.window.localStorage.getItem(KEY), 'detailed');
});

test('both bodies ship on every card; CSS is what selects one per density', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const c = card(ctx.window.document);
  assert.ok(c.querySelector('.rc-compact'), '.rc-compact body present');
  assert.ok(c.querySelector('.rc-detailed'), '.rc-detailed body present');
  assert.ok(c.querySelector('.rc-detailed .run-flow-wrap .run-flow'), 'the graph lives in the detailed body');
  assert.ok(c.querySelector('.rc-detailed .run-log .log'), 'the live log lives in the detailed body');
  // .cost-banner and .qpanel are siblings of both bodies — they render at either density.
  assert.equal(c.querySelector('.rc-compact .cost-banner, .rc-detailed .cost-banner'), null);
  assert.equal(c.querySelector('.rc-compact .qpanel, .rc-detailed .qpanel'), null);

  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.run-card\[data-density="compact"\] \.rc-detailed\{[^}]*display:\s*none/);
  assert.match(css, /\.run-card\[data-density="detailed"\] \.rc-compact\{[^}]*display:\s*none/);
});



test('switching density preserves the log scroll position and the graph scroll offset', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  const c = card(doc);
  const logEl = c.querySelector('.log');
  const flow = c.querySelector('.run-flow-wrap');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  instrumentScroll(flow, { scrollWidth: 4000, clientWidth: 600 });
  // Auto-scroll ON would re-pin the log to the bottom on every repaint.
  ctx.window.__np.setAutoscroll(ctx.window.__np.getRun(RUN_ID), false);
  logEl.scrollTop = 1234;
  flow.scrollLeft = 567;

  seg(doc, 'compact').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc).dataset.density, 'compact');
  // The stash must SURVIVE the leg that hides the scroller. A real browser gives
  // a `display:none` pane no scrolling box, so writing scrollTop back on the
  // compact leg is a no-op — and deleting the stash there throws the position
  // away for good. jsdom computes no layout and instrumentScroll() replaces
  // scrollTop with a plain property, so only the dataset can witness this.
  assert.equal(card(doc).dataset.logTop, '1234', 'the log offset is still stashed while compact');
  assert.equal(card(doc).dataset.flowLeft, '567', 'the graph offset is still stashed while compact');

  seg(doc, 'detailed').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(card(doc), c, 'the card node is reused, not rebuilt');
  assert.equal(logEl.scrollTop, 1234, 'log position survives the round trip');
  assert.equal(flow.scrollLeft, 567, 'graph offset survives the round trip');
  assert.equal(card(doc).dataset.logTop, undefined, 'the stash is consumed once the body is visible again');
  assert.equal(card(doc).dataset.flowLeft, undefined);
});

// The browser half of the same bug, modelled explicitly: hiding a scroller zeroes
// it, so the compact leg must neither consume nor be fed by the live scrollTop.
test('a density round trip restores the offsets a real browser would have zeroed', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  const c = card(doc);
  const logEl = c.querySelector('.log');
  const flow = c.querySelector('.run-flow-wrap');
  instrumentScroll(logEl, { scrollHeight: 5000, clientHeight: 300 });
  instrumentScroll(flow, { scrollWidth: 4000, clientWidth: 600 });
  ctx.window.__np.setAutoscroll(ctx.window.__np.getRun(RUN_ID), false);
  logEl.scrollTop = 1234;
  flow.scrollLeft = 567;

  seg(doc, 'compact').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  // What `display:none` does to a scrolling box, which jsdom never will.
  logEl.scrollTop = 0;
  flow.scrollLeft = 0;

  seg(doc, 'detailed').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  assert.equal(logEl.scrollTop, 1234, 'the parked log position comes back');
  assert.equal(flow.scrollLeft, 567, 'the graph offset comes back');
});

test('the card no longer carries the Agents disclosure, and its painters are gone', async () => {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(RUN_ID)] });
  ctx.showRunning();
  const doc = ctx.window.document;
  const tpl = doc.getElementById('run-card-tpl').content.firstElementChild;
  assert.equal(tpl.querySelector('.subs-bar'), null, 'template carries no .subs-bar');
  assert.equal(tpl.querySelector('.subs-panel'), null, 'template carries no .subs-panel');
  assert.equal(card(doc).querySelector('.subs-bar'), null, 'a painted card carries no .subs-bar');

  // Against the SOURCE, not the hook: `__np.anythingMisspelled` is undefined too,
  // so the hook form proves nothing about removal. Idiom from
  // ui-running-routing.test.mjs:128.
  const appSrc = readFileSync(appPath, 'utf8');
  for (const dead of ['paintSubsBar', 'renderSubsTree', 'subsPillText']) {
    assert.doesNotMatch(appSrc, new RegExp(`function ${dead}\\b`), `${dead} removed from app.js`);
    assert.equal(ctx.window.__np[dead], undefined, `${dead} removed from the test hook`);
  }
  // The pure projections History and the future Agents tab need are KEPT.
  assert.equal(typeof ctx.window.__np.subsGroupsForRender, 'function');
  assert.equal(typeof ctx.window.__np.cycleAwareLabel, 'function');
  assert.equal(typeof ctx.window.__np.stepSkillsFromSteps, 'function');
  assert.equal(typeof ctx.window.__np.stepGraphifyFromSteps, 'function');
  assert.equal(typeof ctx.window.__np.subGroupStatus, 'function', 'buildHdAgents still calls it');

  // Comment-blind: the History Agents block KEEPS two comments that name
  // `.subs-step:first-of-type` and `.subs-tree li .st` while explaining rules that
  // survive (style.css:1841, :1846-1848). `.subs-tree ` matches the raw regex, so
  // without this strip the sweep can never pass — Step 7 additionally rewords them.
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const dead of ['.subs-bar', '.btn-subs', '.subs-panel', '.subs-legend', '.subs-step', '.subs-tree']) {
    assert.doesNotMatch(css, new RegExp(dead.replace('.', '\\.') + '[\\s,{]'), `${dead} CSS removed`);
  }
  // The shared lists keep their History halves.
  assert.match(css, /\.hd-ag-head \.subs-stat\{/);
  assert.match(css, /\.hd-ag-row \.st\{/);
  assert.match(css, /\.subs-skills\{/, 'the unscoped .subs-skills base rule History renders through is kept');
});

test('log autoscroll pins once per burst, never per line (coalesced into one flush)', async () => {
  const { window, recv, showRunning } = await boot();
  recv({ type: 'run-created', runId: RUN_ID, title: RUN_ID, projectDir: PROJECT, status: 'running', startedAt: '10:00:00' });
  showRunning();
  const doc = window.document;
  const logEl = card(doc).querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 1000, clientHeight: 200 });
  // Count WRITES to scrollTop on top of the instrumented property.
  let pins = 0;
  const desc = Object.getOwnPropertyDescriptor(logEl, 'scrollTop');
  Object.defineProperty(logEl, 'scrollTop', { configurable: true, get: desc.get, set: (v) => { pins += 1; desc.set(v); } });
  for (let i = 0; i < 50; i += 1) {
    recv({ type: 'log', runId: RUN_ID, source: 'orchestrator', level: 'info', text: `line ${i}`, ts: Date.now() });
  }
  assert.equal(logEl.querySelectorAll('.log-line').length, 50, 'appends stay synchronous');
  assert.equal(pins, 0, 'no synchronous pin per line');
  // No rAF under this jsdom boot (app.js resolves the bare identifier against
  // globalThis, where the test copies no rAF and node has none), so the
  // scheduler's 16ms setTimeout fallback fires. The 50-line burst is >16ms of
  // synchronous work, so the timer is already due when the loop yields —
  // rehearsal measured the pin landing by ~6ms after; 30ms is comfortably safe
  // (20/20 clean runs).
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pins, 1, 'ONE pin for the whole 50-line burst');
  assert.equal(logEl.scrollTop, 1000, 'pinned to the bottom');
});

test('the coalesced pin re-arms, and auto-scroll OFF never lands one', async () => {
  const { window, recv, showRunning } = await boot();
  recv({ type: 'run-created', runId: RUN_ID, title: RUN_ID, projectDir: PROJECT, status: 'running', startedAt: '10:00:00' });
  showRunning();
  const doc = window.document;
  const logEl = card(doc).querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 1000, clientHeight: 200 });
  let pins = 0;
  const desc = Object.getOwnPropertyDescriptor(logEl, 'scrollTop');
  Object.defineProperty(logEl, 'scrollTop', { configurable: true, get: desc.get, set: (v) => { pins += 1; desc.set(v); } });
  const burst = (n) => { for (let i = 0; i < n; i += 1) recv({ type: 'log', runId: RUN_ID, source: 'orchestrator', level: 'info', text: `l${i}`, ts: Date.now() }); };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  burst(20); await settle();
  assert.equal(pins, 1, 'first burst: one pin');
  pins = 0; burst(20); await settle();
  assert.equal(pins, 1, 'a later burst pins again (the scheduler re-arms)');
  // Auto-scroll OFF must never land a pin. The pin is deferred now, so nothing
  // synchronous witnesses it any more — this replaces the five sync assertions
  // the deferral blinded (four in ui-scroll, one in this file).
  window.__np.setAutoscroll(window.__np.getRun(RUN_ID), false);
  await settle();
  pins = 0; burst(20); await settle();
  assert.equal(pins, 0, 'auto-scroll OFF never lands a pin');
});

test('a pin queued before the switch flips OFF never lands (flush re-checks the flag)', async () => {
  const { window, recv, showRunning } = await boot();
  recv({ type: 'run-created', runId: RUN_ID, title: RUN_ID, projectDir: PROJECT, status: 'running', startedAt: '10:00:00' });
  showRunning();
  const logEl = card(window.document).querySelector('.log');
  instrumentScroll(logEl, { scrollHeight: 1000, clientHeight: 200 });
  logEl.scrollTop = 42;                                    // user parked mid-log
  recv({ type: 'log', runId: RUN_ID, source: 'orchestrator', level: 'info', text: 'x', ts: Date.now() });
  window.__np.setAutoscroll(window.__np.getRun(RUN_ID), false);  // the freeze gesture, same frame
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(logEl.scrollTop, 42, 'the stale pin was dropped at flush');
});
