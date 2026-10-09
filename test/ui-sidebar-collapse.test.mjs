// test/ui-sidebar-collapse.test.mjs — the sidebar's two states: the 254px
// labelled column and the 60px icon rail: jsdom behaviour driven through the
// REAL app.js against the REAL index.html (harness lifted from
// test/ui-pipeline-tabs.test.mjs:15-36).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const html = readFileSync(htmlPath, 'utf8');
const PROJECT = '/tmp/proj';
const KEY = 'worca-cc.sidebar.collapsed';
const DAY = 86400000;

const budgetFixture = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 20, allTimeSpendUsd: 20,
  remainingUsd: 30, blocked: false,
});

async function boot({ seed = null, breakStorage = false,
                      poisonToggle = false, noBudget = false,
                      budgetOver = null, resizeObserver = null } = {}) {
  // index.html SHIPS aria-expanded="true" / title="Collapse menu" /
  // aria-label="Collapse menu" on #side-toggle, so asserting those after an
  // EXPANDED boot passes even when applySidebarCollapsed() never ran — proven by
  // deleting its whole `if (btn)` branch and watching the suite stay green.
  // poisonToggle strips them, so only a real write can satisfy the assertion.
  // Verified safe: index.html's only other two aria-expanded are ="false"
  // (:700, :812), and neither menu label occurs anywhere in ui/, test/ or src/.
  let markup = html;
  if (poisonToggle) {
    markup = markup.replace(
      / aria-expanded="true"| title="Collapse menu"| aria-label="Collapse menu"/g, '');
  }
  const dom = trackDom(new JSDOM(markup, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/budget')) {
      // noBudget: a promise that never settles, so paintBudget runs with
      // budgetState.budget === null (paintBudget early-returns before the account corner).
      if (noBudget) return new Promise(() => {});
      // budgetOver: patch the fixture (e.g. clear the total limit) for one boot.
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...budgetFixture(), ...budgetOver }) });
    }
    // A route to #stats (the spend card's Details) paints the stats view. Without a
    // body the paint throws AFTER the test ends ("Cannot read properties of
    // undefined (reading 'spentUsd')") and node:test fails the whole FILE on the
    // stray async activity, while the test itself reports as passing.
    if (u.includes('/api/stats')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        range: 'month', bucket: 'day',
        windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
        totals: { spentUsd: 20, workedMs: 0, runs: 0, finished: 0, stopped: 0,
          failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
        prev: null, budget: budgetFixture(), series: [] }) });
    }
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      config: { steps: {}, customModels: [] }, models: [], efforts: [],
      pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  if (seed) for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  // jsdom's localStorage is a Proxy — a per-instance defineProperty is silently
  // ignored, so private mode has to be simulated on the prototype. Narrowed to
  // OUR key: app.js reads LAST_PROJECT_KEY (:5342), LAST_WORKSPACE_KEY (:5760)
  // and LAST_TARGET_KEY (:14028) outside any try/catch, and a blanket throw
  // would fail the boot for unrelated reasons. Patched AFTER the seeding above.
  // Each JSDOM owns its own Storage constructor, so this cannot leak.
  if (breakStorage) {
    const g = window.Storage.prototype.getItem;
    const s = window.Storage.prototype.setItem;
    window.Storage.prototype.getItem = function (k) {
      if (k === KEY) throw new Error('denied'); return g.call(this, k);
    };
    window.Storage.prototype.setItem = function (k, v) {
      if (k === KEY) throw new Error('denied'); return s.call(this, k, v);
    };
  }
  // startBudgetTick (app.js:495) reads this on line :497 — `typeof
  // window.__budgetTickMs === 'number' ? window.__budgetTickMs : 60000` — and
  // installs a setInterval that OUTLIVES the test (`.unref?.()` is a no-op in
  // jsdom, where setInterval returns a number). It runs once per module
  // evaluation, from the boot line at :14036, and this file boots the app 19
  // times. node --test runs FILES in parallel, so one file can outlive 60s under
  // load, and a leaked tick from an EXPANDED boot would call paintBudget()
  // against whatever globalThis.document is current and repaint the account
  // corner of a later COLLAPSED test. Park it a day out, and
  // do it BEFORE the import. Seam: test/ui-budget-indicator.test.mjs:89-91.
  window.__budgetTickMs = DAY;
  if (resizeObserver) window.ResizeObserver = resizeObserver;   // jsdom has none
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  lastWs._l.open?.forEach((fn) => fn());
  const click = (sel) => window.document.querySelector(sel)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, recv, click, tick };
}

// ---- Behaviour: state, toggle, persistence ----

test('the rail toggle: boots expanded with nothing stored, collapses/expands with relabel and persists, a stored "1" restores the rail, a garbage value falls back to expanded', async () => {
  // Each row boots with its own seed; the row name says which (cuts the count, not the time).
  await checkRows([
    { name: 'boots expanded when nothing is stored', run: async () => {
      const { window } = await boot({ poisonToggle: true });
      assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
      const btn = window.document.querySelector('#side-toggle');
      assert.equal(btn.getAttribute('aria-expanded'), 'true');
      assert.equal(btn.getAttribute('aria-label'), 'Collapse menu');
      assert.equal(btn.title, 'Collapse menu');
    } },
    { name: 'clicking the toggle collapses, relabels and persists', run: async () => {
      const { window, click } = await boot();
      click('#side-toggle');
      const btn = window.document.querySelector('#side-toggle');
      assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.equal(btn.getAttribute('aria-label'), 'Expand menu');
      assert.equal(btn.title, 'Expand menu');
      assert.equal(window.localStorage.getItem(KEY), '1');
    } },
    { name: 'clicking again expands and persists the expanded state', run: async () => {
      const { window, click } = await boot({ poisonToggle: true });
      click('#side-toggle');
      click('#side-toggle');
      assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
      assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(window.localStorage.getItem(KEY), '0');
    } },
    { name: 'a stored "1" restores the rail at boot', run: async () => {
      const { window } = await boot({ seed: { [KEY]: '1' } });
      assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true);
      assert.equal(window.document.querySelector('#side-toggle').getAttribute('aria-expanded'), 'false');
    } },
    { name: 'a garbage stored value falls back to expanded', run: async () => {
      const { window } = await boot({ seed: { [KEY]: 'yes' } });
      assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
    } },
  ]);
});

test('storage that throws (private mode) boots expanded and still toggles', async () => {
  const { window, click } = await boot({ breakStorage: true });
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), false);
  click('#side-toggle');
  assert.equal(window.document.querySelector('.sidebar').classList.contains('collapsed'), true,
    'a write that throws must not stop the in-memory state from flipping');
});

// ---- Behaviour: tooltips, counts, routing ----

test('every collapsed nav button gains a tooltip, and loses it on expand', async () => {
  const { window, click } = await boot();
  const doc = window.document;
  // The rail's own squares (children of .nav): Agents and Scripts sit in the Nodes flyout, labels showing.
  const rows = () => [...doc.querySelectorAll('.nav > button[data-nav]')]
    .map((b) => [b.dataset.nav, b.title]);
  assert.deepEqual(rows().filter(([n, t]) => n !== 'runs' && t), [],
    'expanded rows must not grow redundant tooltips — the label is right there');
  click('#side-toggle');
  for (const [nav, title] of rows()) assert.ok(title, `collapsed ${nav} must carry a tooltip`);
  assert.match(doc.getElementById('side-acct').title, /^Profile: spend, away mode, interface mode and settings · \$20\.00 of \$50\.00 spent /,
    'the rail shows the avatar alone: its tooltip says who, what it opens and the spend against the limit');
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').title, 'Workflow Composer',
    'the tooltip is the label span verbatim — index.html:55');
  assert.equal(doc.querySelector('.nav button[data-nav="new"]').title, 'New pipeline');
  assert.equal(doc.querySelector('.nav button[data-nav="stats"]').title, 'Statistics',
    'the tooltip is the SIDEBAR label, Statistics (index.html)');
  assert.match(doc.querySelector('.nav button[data-nav="runs"]').title, /^Runs/,
    'Runs keeps the count tooltip updateNavCounts owns (set at boot by '
    + 'refreshAllCounts, app.js:14034)');
  click('#side-toggle');
  assert.equal(doc.querySelector('.nav button[data-nav="composer"]').hasAttribute('title'), false);
});

// ---- The band hairlines (style.css .under-top / .under-bottom, app.js#paintSideEdges) ----

/** jsdom has no layout: give #side-scroll the scroll position and metrics a test chooses. */
function stubScroll(el, m) {
  for (const k of ['scrollTop', 'clientHeight', 'scrollHeight']) {
    Object.defineProperty(el, k, { configurable: true, get: () => m[k], set: (v) => { m[k] = v; } });
  }
  return m;
}

test('the band hairlines follow #side-scroll: under-top once scrolled, under-bottom while more is below; repainted on scroll, resize, the rail toggle and a level change', async () => {
  const { window, click } = await boot();
  const doc = window.document;
  const aside = doc.querySelector('.sidebar');
  const band = doc.getElementById('side-scroll');
  const m = stubScroll(band, { scrollTop: 0, clientHeight: 400, scrollHeight: 900 });
  const edges = () => [aside.classList.contains('under-top'), aside.classList.contains('under-bottom')];
  band.dispatchEvent(new window.Event('scroll'));
  assert.deepEqual(edges(), [false, true], 'at the top: only the foot hairline (more below)');
  m.scrollTop = 250; band.dispatchEvent(new window.Event('scroll'));
  assert.deepEqual(edges(), [true, true], 'mid-way: both');
  m.scrollTop = 500; band.dispatchEvent(new window.Event('scroll'));
  assert.deepEqual(edges(), [true, false], 'at the end: only the logo-row hairline');
  m.scrollTop = 499.5; band.dispatchEvent(new window.Event('scroll'));
  assert.deepEqual(edges(), [true, false], 'a subpixel short of the end (zoom) still counts as the end');
  m.scrollTop = 0; m.scrollHeight = 400; window.dispatchEvent(new window.Event('resize'));
  assert.deepEqual(edges(), [false, false], 'a resize that fits every row clears both');
  m.scrollHeight = 900; click('#side-toggle');
  assert.deepEqual(edges(), [false, true], 'the rail toggle repaints');
  m.scrollHeight = 400; doc.dispatchEvent(new window.CustomEvent('worca:level', { detail: { level: 'expert' } }));
  assert.deepEqual(edges(), [false, false], 'a level change repaints');
});

test('a row or the foot changing height repaints the hairlines (a ResizeObserver on the band and the nav)', async () => {
  const made = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; made.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve() {} disconnect() {}
  }
  const { window } = await boot({ resizeObserver: FakeResizeObserver });
  const doc = window.document;
  const band = doc.getElementById('side-scroll');
  const ro = made.find((o) => o.targets.includes(band));
  assert.ok(ro, 'the scroll band is observed');
  assert.ok(ro.targets.includes(doc.querySelector('#side-scroll > .nav')), 'and the nav inside it (rows added or kept)');
  stubScroll(band, { scrollTop: 0, clientHeight: 300, scrollHeight: 640 });
  ro.cb([]);
  assert.equal(doc.querySelector('.sidebar').classList.contains('under-bottom'), true);
});
