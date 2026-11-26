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
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECT = '/tmp/proj';

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url }));
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

test('one pill + lazy section per visible tab; default built eagerly, others built once on first activation and reused', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'one pill + one lazy section per VISIBLE tab; the default tab is built eagerly', run: () => {
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
    } },
    { name: 'a body is built once, on first activation, and the node is reused', run: () => {
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
    } },
  ]);
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

// --- the overflow option (opts.overflow): the listed keys stay in the row, the others go under "More" ------------

// The CSS level gate, read the way interface-mode.css reads it.
const RANK = { simple: 0, advanced: 1, expert: 2 };
// Table order a · c · b · d · e: rows a and b, so c sits between them while it is not under More.
const overflowTable = () => [
  { key: 'a', label: 'Alpha', badge: () => null },
  { key: 'c', label: 'Gamma', menuIcon: 'cube', level: 'advanced', badge: (x) => (x.n == null ? null : String(x.n)) },
  { key: 'b', label: 'Beta', badge: () => null },
  { key: 'd', label: 'Delta', menuIcon: 'play', badge: () => null },
  { key: 'e', label: 'Epsilon', menuIcon: 'agent', level: 'expert', badge: () => null },
].map((t) => ({ ...t, visible: () => true, build: (sec) => { sec.textContent = t.key; } }));

async function overflowScreen({ level = 'expert', ctx = { n: 13 }, row = ['a', 'b'], initial = null } = {}) {
  const app = await boot();
  const { window } = app;
  const doc = window.document;
  doc.documentElement.dataset.level = level;
  const screen = makeScreen(window, 'rd');
  const opts = { ...optsFor('rd'), overflow: { row }, ...(initial ? { initial: () => initial } : {}) };
  const init = () => window.__np.initDetailTabs(screen, overflowTable(), ctx, opts);
  init();
  const bar = screen.querySelector('.rd-tabs');
  const tabs = () => window.__np.detailTabsOf(screen);
  const btn = (k) => bar.querySelector(`.rd-tab[data-sec="${k}"]`);
  const more = () => bar.querySelector('.tab-more');
  const keys = () => [...bar.children].map((n) => n.dataset.sec || 'more');
  // What the CSS draws: every tab but a non-active overflow one (and a hidden or gated one), then More.
  const drawn = () => [...bar.children].filter((n) => !n.hidden && !(n.hasAttribute('data-overflow') && !n.classList.contains('active'))
    && RANK[n.dataset.minLevel || 'simple'] <= RANK[doc.documentElement.dataset.level]).map((n) => n.dataset.sec || 'more');
  const menu = () => doc.querySelector('body > .wfv-menu');
  const items = () => [...(menu() ? menu().querySelectorAll('.menu-item') : [])].map((i) => ({
    label: i.querySelector('.wfv-menu-l').textContent, hint: i.querySelector('.wfv-menu-hint')?.textContent ?? null,
    checked: i.getAttribute('aria-checked'), icon: !!i.querySelector('svg') }));
  const item = (label) => [...menu().querySelectorAll('.menu-item')].find((i) => i.querySelector('.wfv-menu-l').textContent === label);
  const oneSelected = () => {
    const on = [...bar.querySelectorAll('[role="tab"][aria-selected="true"]')];
    assert.equal(on.length, 1, 'exactly one selected tab');
    assert.ok(!on[0].hasAttribute('data-overflow') || on[0].classList.contains('active'), 'and it is rendered');
    return on[0].dataset.sec;
  };
  return { window, doc, screen, bar, tabs, btn, more, keys, drawn, menu, items, item, oneSelected, init };
}


test('no overflow option: the bar is as before (table order, no More, no data-overflow), and relayout does nothing', async () => {
  const { window } = await boot();
  const screen = makeScreen(window, 'rd');
  window.__np.initDetailTabs(screen, overflowTable(), { n: 13 }, optsFor('rd'));
  const bar = screen.querySelector('.rd-tabs');
  const shape = () => [...bar.children].map((n) => [n.tagName, n.className, n.dataset.sec, n.hasAttribute('data-overflow'), n.getAttribute('role')]);
  assert.deepEqual(shape(), ['a', 'c', 'b', 'd', 'e'].map((k) => ['BUTTON', k === 'a' ? 'rd-tab tab active' : 'rd-tab tab', k, false, 'tab']));
  const before = bar.innerHTML;
  window.__np.detailTabsOf(screen).relayout();
  assert.equal(bar.innerHTML, before);
});

test('overflow: row cells, then overflow cells, then the More button; the menu lists them with icon, name, count and the check', async () => {
  const s = await overflowScreen();
  assert.deepEqual(s.keys(), ['a', 'b', 'c', 'd', 'e', 'more']);
  assert.deepEqual(s.drawn(), ['a', 'b', 'more']);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => s.btn(k).hasAttribute('data-overflow')), [false, false, true, true, true]);
  const more = s.more();
  assert.equal(more, s.bar.lastElementChild);
  assert.equal(more.tagName, 'BUTTON');
  assert.equal(more.type, 'button');
  assert.equal(more.className, 'tab tab-more');
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('role'), null, 'not a tab');
  assert.equal(more.dataset.sec, undefined);
  assert.equal(more.textContent.trim(), 'More');
  assert.equal(more.querySelector('svg').getAttribute('width'), '12');
  assert.equal(s.menu(), null);
  click(s.window, more);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(s.menu().getAttribute('aria-label'), 'More tabs');
  assert.equal(s.menu().parentElement, s.doc.body, 'body-level: the scrolling row cannot clip it');
  assert.deepEqual(s.items(), [
    { label: 'Gamma', hint: '13', checked: 'false', icon: true },
    { label: 'Delta', hint: null, checked: 'false', icon: true },
    { label: 'Epsilon', hint: null, checked: 'false', icon: true },
  ]);
  click(s.window, more);
  assert.equal(s.menu(), null, 'a second click closes it');
});

test('overflow: a pick opens the tab, which sits lit just before More with the focus; Esc returns the focus to More', async () => {
  const s = await overflowScreen();
  click(s.window, s.more());
  click(s.window, s.item('Delta'));
  await settle(s.window);
  assert.equal(s.menu(), null);
  assert.equal(s.oneSelected(), 'd');
  assert.deepEqual(s.drawn(), ['a', 'b', 'd', 'more']);
  assert.equal(s.doc.activeElement, s.btn('d'));
  assert.equal(s.screen.querySelector('.rd-sec[data-sec="d"]').hidden, false);
  // The count is read when the menu opens.
  s.btn('c').querySelector('.rd-tab-badge').textContent = '14';
  click(s.window, s.more());
  assert.deepEqual(s.items().map((i) => [i.label, i.hint, i.checked]), [['Gamma', '14', 'false'], ['Delta', null, 'true'], ['Epsilon', null, 'false']]);
  s.doc.activeElement.dispatchEvent(new s.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(s.menu(), null);
  assert.equal(s.doc.activeElement, s.more());
  click(s.window, s.btn('a'));
  assert.deepEqual(s.drawn(), ['a', 'b', 'more'], 'the overflow tab leaves the row');
  assert.equal(s.oneSelected(), 'a');
});

test('overflow: the selected tab is always rendered, also when the screen opens on an overflow tab', async () => {
  const s = await overflowScreen({ initial: 'e' });
  assert.equal(s.oneSelected(), 'e');
  assert.deepEqual(s.drawn(), ['a', 'b', 'e', 'more']);
  for (const k of ['a', 'c', 'b', 'd', 'e']) { s.tabs().activate(k); assert.equal(s.oneSelected(), k); }
});

test('overflow: fewer than two shown candidates means no More, and the leftover sits in its usual place', async () => {
  await checkRows([
    { name: 'one candidate in the table', run: async () => {
      const s = await overflowScreen({ row: ['a', 'b', 'd', 'e'] });
      assert.deepEqual(s.keys(), ['a', 'c', 'b', 'd', 'e']);
      assert.equal(s.more(), null);
      assert.equal(s.bar.querySelector('[data-overflow]'), null);
    } },
    { name: 'the level leaves one', run: async () => {
      const s = await overflowScreen({ level: 'simple' });            // c is advanced, e expert: only d
      assert.deepEqual(s.keys(), ['a', 'c', 'b', 'd', 'e']);
      assert.equal(s.more(), null);
      assert.equal(s.bar.querySelector('[data-overflow]'), null);
    } },
    { name: 'a level-hidden candidate is not in the menu', run: async () => {
      const s = await overflowScreen({ level: 'advanced' });
      click(s.window, s.more());
      assert.deepEqual(s.items().map((i) => i.label), ['Gamma', 'Delta']);
      s.more().click();
    } },
  ]);
});

test('overflow: relayout follows a level change and a hidden tab, closes a menu that lost its button, and keeps the focus', async () => {
  const s = await overflowScreen();
  const root = s.doc.documentElement;
  click(s.window, s.more());
  assert.ok(s.menu());
  s.btn('b').focus();                                                   // (the menu closes as focus leaves)
  click(s.window, s.more());
  root.dataset.level = 'simple';
  s.tabs().relayout();
  assert.equal(s.more(), null);
  assert.equal(s.menu(), null, 'no menu anchored to a removed button');
  assert.deepEqual(s.keys(), ['a', 'c', 'b', 'd', 'e']);
  s.btn('b').focus();
  root.dataset.level = 'expert';
  s.tabs().relayout();                                                  // b moves before c
  assert.deepEqual(s.keys(), ['a', 'b', 'c', 'd', 'e', 'more']);
  assert.equal(s.doc.activeElement, s.btn('b'), 'a moved button keeps the focus');
  // A tab hidden while the page is open (the merged Agents place).
  root.dataset.level = 'advanced';                                      // c and d under More
  s.tabs().relayout();
  assert.ok(s.more());
  s.btn('c').hidden = true;
  s.btn('b').focus();
  s.tabs().relayout();
  assert.equal(s.more(), null);
  assert.deepEqual(s.keys(), ['a', 'c', 'b', 'd', 'e']);
  assert.equal(s.doc.activeElement, s.btn('b'));
  // An unchanged order moves nothing.
  s.btn('c').hidden = false;
  s.tabs().relayout();
  const moves = [];
  const append = s.bar.append.bind(s.bar);
  s.bar.append = (...a) => { moves.push(a); append(...a); };
  s.tabs().relayout();
  assert.equal(moves.length, 0);
  // More holding the focus when it goes: the selected tab takes it.
  s.more().focus();
  s.btn('c').hidden = true;
  s.tabs().relayout();
  assert.equal(s.doc.activeElement, s.btn('a'));
  // The same when the focus was inside its open menu (a git frame, say, lands while it is open).
  s.btn('c').hidden = false;
  s.tabs().relayout();
  click(s.window, s.more());
  assert.ok(s.menu().contains(s.doc.activeElement));
  s.btn('c').hidden = true;
  s.tabs().relayout();
  assert.equal(s.menu(), null);
  assert.equal(s.doc.activeElement, s.btn('a'));
});

test('overflow: a rebuild closes the menu it opened and builds one More', async () => {
  const s = await overflowScreen();
  const old = s.more();
  click(s.window, old);
  assert.ok(s.menu());
  s.init();
  assert.equal(s.menu(), null);
  assert.equal(old.getAttribute('aria-expanded'), 'false');
  assert.equal(s.bar.querySelectorAll('.tab-more').length, 1);
});
