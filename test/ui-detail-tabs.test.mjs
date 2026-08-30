// test/ui-detail-tabs.test.mjs — the generic detail-screen tab engine.
//
// initDetailTabs is the table-driven tab bar History's initHdTabs was built from
// and now delegates to; the Running detail screen (#running/<runId>) is its second
// consumer. These tests drive it DIRECTLY through window.__np against two
// throwaway screens — which is the one property History's own suites cannot
// cover: two detail screens initialised at once must not alias each other's
// state, the way the old hdTabCells/hdActivateTab module globals did.
//
// boot()/settle()/go() are a deliberate local copy of
// test/ui-history-detail.test.mjs:25-93 (itself a copy of
// test/ui-history-routing.test.mjs:25-96) — the suites do not import each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;

  // jsdom doesn't implement scrollIntoView; the viewer modal calls it on open.
  window.Element.prototype.scrollIntoView = function () {};

  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() {
      this.readyState = 1;
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

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (fetchHandler) {
      const r = fetchHandler(String(u), opts || {});
      if (r) return r;
    }
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }),
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

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0)); // let loadProjects/loadConfig settle

  return { window, calls, wsBox };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// A throwaway detail screen: the two hosts initDetailTabs writes into, nothing else.
function makeScreen(window, ns) {
  const screen = window.document.createElement('div');
  screen.innerHTML = `<div class="${ns}-tabs" role="tablist"></div><div class="${ns}-sections"></div>`;
  window.document.body.appendChild(screen);
  return screen;
}

const optsFor = (ns) => ({
  tabsSel: `.${ns}-tabs`, secsSel: `.${ns}-sections`,
  tabClass: `${ns}-tab`, secClass: `${ns}-sec`, badgeClass: `${ns}-tab-badge`,
  idPrefix: ns,
});

// Three tabs: one always on, one always on with no badge, one gated on ctx.
function tableWith(log) {
  return [
    { key: 'a', label: 'Alpha', badge: (c) => (c.n == null ? null : String(c.n)), visible: () => true,
      build: (sec, ...args) => { log.push(['a', ...args]); sec.textContent = 'A'; } },
    { key: 'b', label: 'Beta', badge: () => null, visible: () => true,
      build: (sec, ...args) => { log.push(['b', ...args]); sec.textContent = 'B'; } },
    { key: 'c', label: 'Gamma', badge: () => null, visible: (c) => !!c.showC,
      build: (sec) => { sec.textContent = 'C'; } },
  ];
}

test('one pill + one lazy section per VISIBLE tab; the default tab is built eagerly', async () => {
  const { window } = await boot();
  const { initDetailTabs } = window.__np;
  const screen = makeScreen(window, 'rd');
  const log = [];

  initDetailTabs(screen, tableWith(log), { n: 7, showC: false }, optsFor('rd'));

  assert.deepEqual([...screen.querySelectorAll('.rd-tab')].map((b) => b.dataset.sec), ['a', 'b'],
    'the ctx-gated tab renders no pill');
  assert.equal(screen.querySelector('.rd-sec[data-sec="c"]'), null, 'and no section either');

  const a = screen.querySelector('.rd-sec[data-sec="a"]');
  const b = screen.querySelector('.rd-sec[data-sec="b"]');
  assert.equal(a.hidden, false);
  assert.equal(b.hidden, true);
  assert.equal(a.dataset.loaded, '1', 'the default tab body is built at init');
  assert.equal(b.dataset.loaded, undefined, 'an unvisited tab is never built');
  assert.deepEqual(log.map((e) => e[0]), ['a']);
  assert.ok(screen.querySelector('.rd-tab[data-sec="a"]').classList.contains('active'));
});

test('badges render only when badge(ctx) returns a value', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  window.__np.initDetailTabs(screen, tableWith([]), { n: 7, showC: false }, optsFor('rd'));

  const badge = screen.querySelector('.rd-tab[data-sec="a"] .rd-tab-badge');
  assert.ok(badge, 'a non-null badge paints a span');
  assert.equal(badge.textContent, '7');
  assert.equal(screen.querySelector('.rd-tab[data-sec="b"] .rd-tab-badge'), null,
    'a null badge paints nothing');
  assert.match(screen.querySelector('.rd-tab[data-sec="a"]').textContent, /Alpha/);
});

test('tabs are wired for a11y and aria-selected TRACKS the active tab', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  window.__np.initDetailTabs(screen, tableWith([]), { n: null, showC: true }, optsFor('rd'));

  for (const btn of screen.querySelectorAll('.rd-tab')) {
    const key = btn.dataset.sec;
    const sec = screen.querySelector(`.rd-sec[data-sec="${key}"]`);
    assert.equal(btn.id, `rd-tab-${key}`);
    assert.equal(sec.id, `rd-sec-${key}`);
    assert.equal(btn.getAttribute('role'), 'tab');
    assert.equal(btn.getAttribute('aria-controls'), sec.id);
    assert.equal(sec.getAttribute('role'), 'tabpanel');
    assert.equal(sec.getAttribute('aria-labelledby'), btn.id);
    assert.equal(sec.tabIndex, 0, 'panels that scroll internally must be reachable by keyboard');
    assert.equal(btn.getAttribute('aria-selected'), key === 'a' ? 'true' : 'false');
  }

  click(window, screen.querySelector('.rd-tab[data-sec="c"]'));
  assert.equal(screen.querySelector('.rd-tab[data-sec="c"]').getAttribute('aria-selected'), 'true');
  assert.equal(screen.querySelector('.rd-tab[data-sec="a"]').getAttribute('aria-selected'), 'false');
  assert.equal(screen.querySelector('.rd-sec[data-sec="a"]').hidden, true);
});

test('a body is built once, on first activation, and the node is reused', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  const log = [];
  window.__np.initDetailTabs(screen, tableWith(log), { n: null, showC: false }, optsFor('rd'));

  const b = screen.querySelector('.rd-sec[data-sec="b"]');
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.equal(b.dataset.loaded, '1');
  assert.deepEqual(log.map((e) => e[0]), ['a', 'b']);

  click(window, screen.querySelector('.rd-tab[data-sec="a"]'));
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.equal(screen.querySelector('.rd-sec[data-sec="b"]'), b, 'the section node is never re-created');
  assert.deepEqual(log.map((e) => e[0]), ['a', 'b'], 'a second visit builds nothing new');
});

test('a builder that THROWS leaves the section un-stamped and re-arms the tab', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  let calls = 0;
  const tabs = [
    { key: 'a', label: 'Alpha', badge: () => null, visible: () => true, build: () => {} },
    { key: 'b', label: 'Beta', badge: () => null, visible: () => true,
      build: (sec) => { calls += 1; if (calls === 1) throw new Error('boom'); sec.textContent = 'ok'; } },
  ];
  window.__np.initDetailTabs(screen, tabs, {}, optsFor('rd'));
  const st = window.__np.detailTabsOf(screen);
  const b = screen.querySelector('.rd-sec[data-sec="b"]');

  assert.throws(() => st.activate('b'), /boom/);
  assert.equal(b.dataset.loaded, undefined, 'the stamp lands only AFTER the builder returns');
  // The toggle phase ran to completion despite the throw: exactly one lit pill.
  assert.equal(screen.querySelectorAll('.rd-tab.active').length, 1);
  assert.equal(screen.querySelectorAll('.rd-sec:not([hidden])').length, 1);

  st.activate('a');
  st.activate('b');
  assert.equal(calls, 2, 'the next activation retried the build');
  assert.equal(b.dataset.loaded, '1');
  assert.equal(b.textContent, 'ok');
});

test('initial() picks the tab it names, and an unknown key falls back to the first visible one', async () => {
  const { window } = await boot();
  const s1 = makeScreen(window, 'rd');
  window.__np.initDetailTabs(s1, tableWith([]), { n: null, showC: false },
    { ...optsFor('rd'), initial: () => 'b' });
  assert.ok(s1.querySelector('.rd-tab[data-sec="b"]').classList.contains('active'));
  assert.equal(s1.querySelector('.rd-sec[data-sec="b"]').dataset.loaded, '1');

  const s2 = makeScreen(window, 'hd2');
  window.__np.initDetailTabs(s2, tableWith([]), { n: null, showC: false },
    { ...optsFor('hd2'), initial: () => 'nope' });
  assert.ok(s2.querySelector('.hd2-tab[data-sec="a"]').classList.contains('active'),
    'an unresolvable default falls back to the first visible tab');
});

// C1: the icon is a per-TAB field, injected as innerHTML BEFORE the label text
// node — History's pills are `<svg…> Label` and the extraction must not reorder
// them. A tab with no `icon` renders label-only, which is what Running passes for
// nothing and what a table entry omitting the key must degrade to (never the
// string "undefined", which is what `btn.innerHTML = map[key]` would inject).
test('a per-tab icon renders before the label; a tab without one renders no markup', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  const tabs = tableWith([]);
  tabs[0].icon = '<svg class="ico-a"></svg>';
  window.__np.initDetailTabs(screen, tabs, { n: null, showC: false }, optsFor('rd'));

  const a = screen.querySelector('.rd-tab[data-sec="a"]');
  assert.ok(a.querySelector('svg.ico-a'), 'the trusted SVG string is injected');
  assert.equal(a.firstElementChild.tagName.toLowerCase(), 'svg', 'icon comes first');
  assert.match(a.textContent, /^\s*Alpha/, 'then the label text node');
  const b = screen.querySelector('.rd-tab[data-sec="b"]');
  assert.equal(b.querySelector('svg'), null, 'a tab with no icon paints none');
  assert.doesNotMatch(b.innerHTML, /undefined/, 'and never the string "undefined"');
});

test('buildArgs() is evaluated at ACTIVATION time, not captured at init', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  const log = [];
  const box = { rec: 'stub' };
  window.__np.initDetailTabs(screen, tableWith(log), { n: null, showC: false },
    { ...optsFor('rd'), buildArgs: () => [box.rec, 'data'] });

  assert.deepEqual(log[0], ['a', 'stub', 'data']);
  box.rec = 'real';                                  // the row the deep link corrected
  click(window, screen.querySelector('.rd-tab[data-sec="b"]'));
  assert.deepEqual(log[1], ['b', 'real', 'data'],
    'a tab opened after the authoritative record landed sees the NEW record');
});

test('two screens keep independent tab state', async () => {
  const { window } = await boot();
  const hist = makeScreen(window, 'hd2');
  const run = makeScreen(window, 'rd');
  window.__np.initDetailTabs(hist, tableWith([]), { n: null, showC: false }, optsFor('hd2'));
  window.__np.initDetailTabs(run, tableWith([]), { n: null, showC: false }, optsFor('rd'));

  const a = window.__np.detailTabsOf(hist);
  const b = window.__np.detailTabsOf(run);
  assert.ok(a && b);
  assert.notEqual(a, b, 'each screen owns its own cells + activate');
  assert.ok(hist.contains(a.cells.get('a').sec), 'cells belong to their own screen');
  assert.ok(run.contains(b.cells.get('a').sec));

  b.activate('b');
  assert.ok(run.querySelector('.rd-tab[data-sec="b"]').classList.contains('active'));
  assert.ok(hist.querySelector('.hd2-tab[data-sec="a"]').classList.contains('active'),
    'the other screen is untouched');
  assert.equal(hist.querySelector('.hd2-sec[data-sec="b"]').dataset.loaded, undefined);
});

test('detailTabsOf returns null for a screen that was never initialised', async () => {
  const { window } = await boot();
  assert.equal(window.__np.detailTabsOf(makeScreen(window, 'rd')), null);
  assert.equal(window.__np.detailTabsOf(null), null);
});
