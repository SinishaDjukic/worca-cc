// test/ui-mobile-nav.test.mjs — the three navigation tiers. Desktop (>1080px): the
// sidebar, or the 60px rail by preference. Tablet (761-1080px): the rail, always,
// preference untouched. Phone (<=760px): the #mbar top bar whose hamburger opens the
// FULL sidebar as a slide-in drawer (counts, live runs, spend, signed-in: parity).
// jsdom has no matchMedia, so boot() installs a width-driven stub BEFORE app.js loads.
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
const html = readFileSync(join(root, 'index.html'), 'utf8');
const appPath = join(root, 'app.js');
const PROJECT = '/tmp/proj';
const SIDEBAR_KEY = 'worca-cc.sidebar.collapsed';
const DAY = 24 * 60 * 60 * 1000;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Only max-width / min-width queries can match; colour-scheme and reduced-motion stay false. */
function mediaStub(width) {
  let w = width;
  const lists = [];
  const evalQ = (q) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const min = /min-width:\s*(\d+)px/.exec(q);
    if (!max && !min) return false;
    return (!max || w <= Number(max[1])) && (!min || w >= Number(min[1]));
  };
  const matchMedia = (q) => {
    const l = {
      media: q, matches: evalQ(q), fns: [],
      addEventListener(t, fn) { if (t === 'change') this.fns.push(fn); },
      removeEventListener() {}, addListener(fn) { this.fns.push(fn); }, removeListener() {},
    };
    lists.push(l);
    return l;
  };
  const resize = (next) => {
    w = next;
    for (const l of lists) {
      const m = evalQ(l.media);
      if (m !== l.matches) { l.matches = m; for (const fn of l.fns) fn({ matches: m, media: l.media }); }
    }
  };
  return { matchMedia, resize };
}

async function boot({ width = 1280, seed = {} } = {}) {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.__budgetTickMs = DAY;   // the budget ticker must not repaint a later test's DOM (ui-sidebar-collapse:142-151)
  const media = mediaStub(width);
  window.matchMedia = media.matchMedia;
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (u) => {
    const url = String(u);
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (url.includes('/api/stats')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        range: 'month', bucket: 'day', windowStartMs: Date.now() - 30 * DAY, windowEndMs: Date.now(),
        totals: { spentUsd: 0, pipelineSpendUsd: 0, ask: { spendUsd: 0, sessions: 0, turns: 0 },
          workedMs: 0, runs: 0, finished: 0, stopped: 0, failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
        prev: null, budget: null, series: [],
      }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const $ = (s) => window.document.querySelector(s);
  const click = (s) => (typeof s === 'string' ? $(s) : s)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  // cancelable, as a real keydown is: an open popup consumes Escape with preventDefault.
  const key = (k) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { window, $, click, key, recv, resize: media.resize };
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

// ---- the rail per tier ----

// A viewport table: each row boots at its own width.
test('rail derivation per tier: desktop follows the stored preference (hamburger inert), tablet forces the icon rail without touching it, phone drawer is the full sidebar', async () => {
  await checkRows([
    { name: 'desktop: the preference still drives the rail and the hamburger never opens a drawer', run: async () => {
      const { $, click, window } = await boot({ width: 1280, seed: { [SIDEBAR_KEY]: '1' } });
      assert.ok($('.sidebar').classList.contains('collapsed'));
      click('#side-toggle');
      assert.equal($('.sidebar').classList.contains('collapsed'), false);
      assert.equal(window.localStorage.getItem(SIDEBAR_KEY), '0');
      click('#mbar-menu');
      assert.equal(window.document.body.classList.contains('nav-open'), false);
    } },
    { name: 'tablet: the icon rail is forced without touching the stored preference', run: async () => {
      const { $, window, recv } = await boot({ width: 900 });
      assert.ok($('.sidebar').classList.contains('collapsed'), 'rail on tablets');
      assert.ok(window.document.body.classList.contains('rail-collapsed'), 'the Ask dock follows (left:60px)');
      assert.equal(window.localStorage.getItem(SIDEBAR_KEY), null, 'nothing persisted');
      assert.equal($('.nav button[data-nav="composer"]').title, 'Workflow Composer', 'rail tooltips');
      recv({ type: 'hello', runs: [live('auth-fix')] });
      assert.equal($('#nav-running-count').textContent, '1', 'the Runs badge counts the live run (no per-run rows)');
    } },
    { name: 'phone: the drawer is the FULL sidebar even when the rail preference is on', run: async () => {
      const { $, window, recv } = await boot({ width: 390, seed: { [SIDEBAR_KEY]: '1' } });
      assert.equal($('.sidebar').classList.contains('collapsed'), false);
      assert.equal(window.document.body.classList.contains('rail-collapsed'), false);
      assert.equal(window.localStorage.getItem(SIDEBAR_KEY), '1', 'the desktop preference survives');
      recv({ type: 'hello', runs: [live('auth-fix'), live('seo', { pendingQuestion: { id: 'q1', kind: 'clarify', questions: [{ question: 'x?', options: ['a'] }] } })] });
      assert.equal($('#nav-running-count').textContent, '2', 'counts');
      assert.equal($('#mbar-rollup').hidden, false, 'the menu button carries the needs-input dot');
      assert.equal($('#mbar-menu').getAttribute('aria-label'), 'Menu — a pipeline needs your input');
    } },
  ]);
});

// ---- the phone drawer ----

// One phone boot, the steps in order: each row starts where the previous one left the page
// (drawer closed, on New pipeline → Statistics → Runs), and a failing row names its step.
test('phone drawer: opens; closes by scrim/close/Escape/route/back/resize with focus + inert managed; the Nodes flyout and the account menu do not close it', async () => {
  const { $, click, key, resize, window } = await boot({ width: 390 });
  await checkRows([
    { name: 'phone: open, close by scrim / close button / Escape; focus and inert are managed', run: async () => {
      const body = window.document.body;
      click('#mbar-menu');
      assert.ok(body.classList.contains('nav-open'));
      assert.equal($('#mbar-menu').getAttribute('aria-expanded'), 'true');
      assert.equal($('#nav-scrim').hidden, false);
      assert.ok($('.main').hasAttribute('inert'), 'the page behind is inert');
      assert.ok($('#mbar').hasAttribute('inert'));
      assert.equal(window.document.activeElement, $('#side-close'), 'focus moves into the drawer');

      click('#nav-scrim');
      assert.equal(body.classList.contains('nav-open'), false);
      assert.equal($('#nav-scrim').hidden, true);
      assert.equal($('.main').hasAttribute('inert'), false);
      assert.equal(window.document.activeElement, $('#mbar-menu'), 'focus returns to the hamburger');

      click('#mbar-menu'); click('#side-close');
      assert.equal(body.classList.contains('nav-open'), false);
      click('#mbar-menu'); key('Escape');
      assert.equal(body.classList.contains('nav-open'), false);
    } },
    { name: 'phone: a route closes the drawer and names the page in the bar; the Nodes flyout and the account menu do not', run: async () => {
      const body = window.document.body;
      assert.equal($('#mbar-title').textContent, 'New pipeline');
      click('#mbar-menu');
      click('.nav .nav-group[data-nav-group="nodes"]');
      assert.ok(body.classList.contains('nav-open'), 'opening Nodes keeps the drawer open');
      assert.equal($('#nav-nodes-fly').hidden, false, 'its flyout opens over the drawer');
      key('Escape');
      assert.equal($('#nav-nodes-fly').hidden, true, 'Escape closes the flyout…');
      assert.ok(body.classList.contains('nav-open'), '…and only the flyout');
      click('#side-acct');
      assert.equal($('#acct-menu').hidden, false, 'the account menu opens inside the drawer');
      click('#acct-lvl');
      assert.equal($('#lvl-menu').hidden, false, 'Interface mode opens its side menu');
      click('#lvl-menu [data-level-choice="advanced"]');
      await tick();
      assert.equal(window.document.documentElement.dataset.level, 'advanced');
      click('#lvl-menu [data-level-choice="expert"]');
      await tick();
      assert.ok(body.classList.contains('nav-open'), 'choosing a mode keeps the drawer…');
      assert.equal($('#acct-menu').hidden, false, '…and the menu');
      key('Escape');
      assert.equal($('#lvl-menu').hidden, true, 'Esc closes the side menu first…');
      assert.equal($('#acct-menu').hidden, false);
      key('Escape');
      assert.equal($('#acct-menu').hidden, true, '…then the menu…');
      assert.ok(body.classList.contains('nav-open'), '…and never the drawer');
      click('.nav button[data-nav="stats"]');
      await tick();
      assert.equal(window.location.hash, '#stats');
      assert.equal(body.classList.contains('nav-open'), false);
      assert.equal($('#mbar-title').textContent, 'Statistics');
      click('#mbar-menu');
      click('#side-acct');
      click($('#acct-spend .mc-btn'));
      await tick();
      assert.equal(window.location.hash, '#stats', 'Details, from the spend card');
      assert.equal(body.classList.contains('nav-open'), false, 'a page inside the menu closes the drawer');
      click('#mbar-menu');
      click('#side-acct');
      click('#acct-settings');
      await tick();
      assert.equal(window.location.hash, '#settings', 'Settings, from the account menu');
      assert.equal(body.classList.contains('nav-open'), false, 'a route from the menu closes the drawer');
      assert.equal($('#acct-menu').hidden, true, 'and the menu');
      assert.equal($('#mbar-title').textContent, 'Settings');
    } },
    { name: 'phone: a hash change (back button) closes an open drawer', run: async () => {
      click('#mbar-menu');
      window.location.hash = 'history';   // a legacy bare route: it lands on the one Runs page
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      await tick();
      assert.equal(window.document.body.classList.contains('nav-open'), false);
      assert.equal($('#mbar-title').textContent, 'Runs');
    } },
    { name: 'phone: Agents in the Nodes flyout routes, and puts the flyout and the drawer away', run: async () => {
      click('#mbar-menu');
      click('.nav .nav-group[data-nav-group="nodes"]');
      assert.equal($('#nav-nodes-fly').hidden, false);
      click('#nav-nodes-fly button[data-nav="agents"]');
      await tick();
      assert.equal(window.location.hash, '#agents');
      assert.equal($('#nav-nodes-fly').hidden, true);
      assert.equal(window.document.body.classList.contains('nav-open'), false);
      assert.equal($('#mbar-title').textContent, 'Agents');
    } },
    { name: 'resizing across tiers closes the drawer and re-derives the rail', run: async () => {
      click('#mbar-menu');
      resize(900);
      assert.equal(window.document.body.classList.contains('nav-open'), false);
      assert.equal($('.main').hasAttribute('inert'), false);
      assert.ok($('.sidebar').classList.contains('collapsed'), 'tablet → rail');
      resize(1280);
      assert.equal($('.sidebar').classList.contains('collapsed'), false, 'desktop → the (unset) preference');
      click('#mbar-menu');
      assert.equal(window.document.body.classList.contains('nav-open'), false, 'no drawer off-phone');
    } },
  ]);
});

test('phone drawer: only a route closes it; a popup trigger and an option inside a popup keep it open, a page inside a popup closes it', async () => {
  const { $, click, window } = await boot({ width: 390 });
  const doc = window.document;
  click('#mbar-menu');
  click('#side-acct');
  assert.ok(doc.body.classList.contains('nav-open'), 'the account corner opens its menu inside the drawer');
  assert.equal($('#acct-menu').hidden, false);
  // Any popup the sidebar grows follows the same rule: no route, no close.
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<button type="button" role="menuitemradio" id="opt">Option</button>'
    + '<button type="button" role="menuitem" data-nav="stats" id="go">Statistics</button>';
  $('#side-foot').append(trigger, menu);
  click(trigger);
  assert.ok(doc.body.classList.contains('nav-open'), 'a popup trigger is not a route');
  click('#opt');
  assert.ok(doc.body.classList.contains('nav-open'), 'an option inside a popup is not a route');
  click('#go');
  assert.equal(doc.body.classList.contains('nav-open'), false, 'a page inside a popup is');
});
