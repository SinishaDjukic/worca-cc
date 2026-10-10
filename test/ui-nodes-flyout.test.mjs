// test/ui-nodes-flyout.test.mjs — Nodes (Agents, Scripts) in a side flyout, driven through the REAL
// app.js against the REAL index.html: the row opens #nav-nodes-fly (side-flyout.mjs), a route inside
// closes it and tints the row, Escape hands focus back, the interface mode keeps the row and the flyout
// with an open child (Simple keeps neither), the rail shows Nodes as one titled square, and the stale
// fold key of the old inline disclosure is cleared at boot.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);
const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const appPath = join(root, 'app.js');
const DAY = 86400000;
const OLD_FOLD_KEY = 'worca-cc.nav.nodes.collapsed';
const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot({ seed = {}, level = null, hash = '' } = {}) {
  const markup = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  const dom = trackDom(new JSDOM(markup, { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.__budgetTickMs = DAY;   // the budget ticker must not outlive the test (ui-sidebar-collapse)
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [],
      agents: [], scripts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const $ = (s) => window.document.querySelector(s);
  // detail 1 = a pointer click; detail 0 = Enter/Space on the button (a keyboard click).
  const click = (s, detail = 1) => (typeof s === 'string' ? $(s) : s)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail }));
  const key = (k) => window.document.activeElement
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { window, $, click, key };
}

const NODES = '.nav .nav-group[data-nav-group="nodes"]';

test('Nodes opens Agents and Scripts in a side flyout; a route inside closes it and tints the row; the old fold key is cleared at boot', async () => {
  const { window, $, click } = await boot({ seed: { [OLD_FOLD_KEY]: '1' } });
  await checkRows([
    { name: 'the stale fold key of the inline disclosure is removed at boot', run: () => {
      assert.equal(window.localStorage.getItem(OLD_FOLD_KEY), null);
    } },
    { name: 'closed at rest: aria-expanded false, the flyout hidden, a "›" chevron on the row', run: () => {
      assert.equal($(NODES).getAttribute('aria-expanded'), 'false');
      assert.equal($(NODES).getAttribute('aria-haspopup'), 'menu');
      assert.equal($('#nav-nodes-fly').hidden, true);
      assert.equal($(`${NODES} .nav-group-chev path`).getAttribute('d'), 'M9 6l6 6-6 6');
    } },
    { name: 'a click opens it beside the sidebar', run: () => {
      click(NODES);
      assert.equal($('#nav-nodes-fly').hidden, false);
      assert.equal($(NODES).getAttribute('aria-expanded'), 'true');
      assert.match($('#nav-nodes-fly').style.left, /px$/, 'side-flyout.mjs placed it');
    } },
    { name: 'Agents routes, closes the flyout and gives the Nodes row the open-page tint', run: async () => {
      click('#nav-nodes-fly button[data-nav="agents"]');
      await tick();
      assert.equal(window.location.hash, '#agents');
      assert.equal($('#nav-nodes-fly').hidden, true);
      assert.equal($(NODES).getAttribute('aria-expanded'), 'false');
      assert.ok($(NODES).classList.contains('has-active'));
      assert.equal($('.nav button[data-nav="agents"]').getAttribute('aria-current'), 'page');
    } },
    { name: 'leaving for another page drops the tint', run: async () => {
      click('.nav button[data-nav="runs"]');
      await tick();
      assert.equal($(NODES).classList.contains('has-active'), false);
    } },
  ]);
});

test('the keyboard: Enter on Nodes focuses Agents, Escape closes and hands focus back; a route from elsewhere puts the flyout away', async () => {
  const { window, $, click, key } = await boot();
  click(NODES, 0);
  assert.equal(window.document.activeElement, $('#nav-nodes-fly button[data-nav="agents"]'));
  key('ArrowDown');
  assert.equal(window.document.activeElement, $('#nav-nodes-fly button[data-nav="scripts"]'));
  key('Escape');
  assert.equal($('#nav-nodes-fly').hidden, true);
  assert.equal(window.document.activeElement, $(NODES));
  click(NODES);
  window.location.hash = 'runs';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await tick();
  assert.equal($('#nav-nodes-fly').hidden, true, 'any route closes it');
});

test('the interface mode: Advanced keeps the Nodes row and its flyout with Agents open; Simple keeps neither', async () => {
  await checkRows([
    { name: 'Advanced on #agents: the row, the flyout and Agents stay on screen', run: async () => {
      const { $ } = await boot({ level: 'advanced', hash: 'agents' });
      assert.equal($(NODES).dataset.levelKeep, '1');
      assert.equal($('#nav-nodes-fly').dataset.levelKeep, '1');
      assert.equal($('.nav button[data-nav="agents"]').dataset.levelKeep, '1');
      assert.equal($('.nav button[data-nav="scripts"]').dataset.levelKeep, undefined, 'only the open child');
      assert.equal($('#level-banner').hidden, false);
    } },
    { name: 'Simple on #agents: the whole group stays hidden, the banner says where you are', run: async () => {
      const { $ } = await boot({ level: 'simple', hash: 'agents' });
      assert.equal($(NODES).dataset.levelKeep, undefined);
      assert.equal($('#nav-nodes-fly').dataset.levelKeep, undefined);
      assert.equal($('.nav button[data-nav="agents"]').dataset.levelKeep, undefined);
      assert.equal($('#level-banner').hidden, false);
    } },
    { name: 'Expert: nothing to keep', run: async () => {
      const { $ } = await boot({ level: 'expert', hash: 'agents' });
      assert.equal($(NODES).dataset.levelKeep, undefined);
      assert.equal($('#level-banner').hidden, true);
    } },
  ]);
});

test('the rail: Nodes is one square titled "Nodes" that opens the same flyout; the title goes on expand', async () => {
  const { $, click } = await boot({ seed: { 'worca-cc.sidebar.collapsed': '1' } });
  assert.ok($('.sidebar').classList.contains('collapsed'));
  assert.equal($(NODES).title, 'Nodes');
  click(NODES);
  assert.equal($('#nav-nodes-fly').hidden, false);
  click('#side-toggle');
  assert.equal($('#nav-nodes-fly').hidden, true, 'a click elsewhere (here the toggle) closes it');
  assert.equal($(NODES).hasAttribute('title'), false);
});

test('a keyboard pick in the flyout hands focus back to the Nodes row; a scroll of the pages puts the flyout away', async () => {
  const { window, $, click } = await boot();
  click(NODES, 0);
  const agents = $('#nav-nodes-fly button[data-nav="agents"]');
  assert.equal(window.document.activeElement, agents);
  click(agents, 0);
  await tick();
  assert.equal(window.location.hash, '#agents');
  assert.equal($('#nav-nodes-fly').hidden, true);
  assert.equal(window.document.activeElement, $(NODES), 'focus returns to the row it opened from');
  click(NODES);
  assert.equal($('#nav-nodes-fly').hidden, false);
  $('#side-scroll').dispatchEvent(new window.Event('scroll'));
  assert.equal($('#nav-nodes-fly').hidden, true, 'its row scrolled away from it');
});

test('Escape in the Nodes flyout closes only the flyout: the New workspace wizard under it stays open', async () => {
  const { window, $, click, key } = await boot({ hash: 'workspace-create' });
  click(NODES, 0);
  assert.equal($('#nav-nodes-fly').hidden, false);
  key('Escape');
  await tick();
  assert.equal($('#nav-nodes-fly').hidden, true);
  assert.equal(window.location.hash, '#workspace-create', 'the wizard did not close under the flyout');
  assert.equal(window.document.activeElement, $(NODES));
});

test('the rail: Agents and Scripts inside the flyout get no tooltip (their label shows); the Nodes square keeps its own', async () => {
  const { $ } = await boot({ seed: { 'worca-cc.sidebar.collapsed': '1' } });
  assert.equal($(NODES).title, 'Nodes');
  for (const v of ['agents', 'scripts']) {
    assert.equal($(`#nav-nodes-fly button[data-nav="${v}"]`).hasAttribute('title'), false, v);
  }
});


test('Tab out of the Nodes flyout puts it away, so the Escape that follows reaches the page: the wizard closes', async () => {
  const { window, $, click, key } = await boot({ hash: 'workspace-create' });
  click(NODES, 0);
  assert.equal($('#nav-nodes-fly').hidden, false);
  $('.nav > button[data-nav="projects"]').focus();
  assert.equal($('#nav-nodes-fly').hidden, true, 'focus left the flyout');
  assert.equal($(NODES).getAttribute('aria-expanded'), 'false');
  assert.equal(window.document.activeElement, $('.nav > button[data-nav="projects"]'), 'and stayed where it went');
  key('Escape');
  await tick();
  assert.equal(window.location.hash, '#new', 'nothing swallowed the page\'s Escape');
});

test('with the Ask sheet open, a mouse pick in the Nodes flyout still routes: the sheet closing on the press hands focus back without closing the flyout', async () => {
  const { window, $, click } = await boot();
  $('.nav > button[data-nav="runs"]').focus();
  click('.ask-pill');
  assert.equal($('[data-ask-sheet]').hidden, false, 'the Ask sheet is open');
  click(NODES);                                              // opened without a press, as a hover opens it
  assert.equal($('#nav-nodes-fly').hidden, false, 'focus never left the flyout: it stays open beside the sheet');
  const agents = $('#nav-nodes-fly button[data-nav="agents"]');
  agents.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal($('[data-ask-sheet]').hidden, true, 'the press closed the Ask sheet');
  assert.equal($('#nav-nodes-fly').hidden, false, 'but not the flyout under the pointer');
  agents.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
  click(agents);
  await tick();
  assert.equal(window.location.hash, '#agents');
  assert.equal($('#nav-nodes-fly').hidden, true);
});

test('a mode change while the Nodes flyout is open puts it away (a change from another tab can hide its row under it)', async () => {
  const { window, $, click } = await boot();
  const { applyLevel } = await import('../ui/public/ui-level.mjs');
  click(NODES, 0);
  assert.equal($('#nav-nodes-fly').hidden, false);
  applyLevel('advanced', window.document);
  assert.equal($('#nav-nodes-fly').hidden, true);
  assert.equal($(NODES).getAttribute('aria-expanded'), 'false');
});
