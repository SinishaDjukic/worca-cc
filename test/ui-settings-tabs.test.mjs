// test/ui-settings-tabs.test.mjs — Guardrails/Models/Plugins are Settings TABS,
// not views: the nav entries are gone, the panes live inside
// [data-view="settings"] and the tab rides in the hash (#settings/<tab>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

const settingsView = () =>
  new JSDOM(html, { url: 'http://localhost:4319/' })
    .window.document.querySelector('.view[data-view="settings"]');

test('the three nav entries are gone from BOTH menus', () => {
  for (const v of ['guardrails', 'models', 'plugins'])
    assert.equal(html.includes(`data-nav="${v}"`), false, `data-nav=${v} still present`);
});

test('settings holds a .seg tab strip with the eight tabs in mode order, General preselected', () => {
  const seg = settingsView().querySelector('#settings-tabs');
  assert.ok(seg, '#settings-tabs missing');
  assert.ok(seg.classList.contains('seg'), 'reuses the .seg segmented control');
  const btns = [...seg.querySelectorAll('button[data-tab]')];
  assert.deepEqual(btns.map((b) => b.dataset.tab), ['general', 'runs', 'ask', 'guardrails', 'memory', 'plugins', 'models', 'providers']);
  assert.deepEqual(btns.map((b) => b.classList.contains('on')), [true, false, false, false, false, false, false, false]);
  // Simple, then Advanced, then Expert: every mode sees a gap-free prefix of the strip.
  const rank = { simple: 0, advanced: 1, expert: 2 };
  const ranks = btns.map((b) => rank[b.dataset.minLevel]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'tabs ordered by level');
});

test('eight panes live inside settings, in tab order; only General starts visible', () => {
  const panes = [...settingsView().querySelectorAll('.settings-pane')];
  assert.deepEqual(panes.map((p) => p.dataset.tab), ['general', 'runs', 'ask', 'guardrails', 'memory', 'plugins', 'models', 'providers']);
  assert.deepEqual(panes.map((p) => p.classList.contains('hidden')), [false, true, true, true, true, true, true, true]);
  // A pane must NOT be a routed view: showView's views.forEach would force
  // .hidden back on it at every navigation.
  for (const p of panes) {
    assert.equal(p.classList.contains('view'), false, `pane ${p.dataset.tab} must not be .view`);
    assert.equal(p.dataset.view, undefined, `pane ${p.dataset.tab} must not carry data-view`);
  }
});

test('every relocated id and action button survives the move, inside settings', () => {
  const view = settingsView();
  for (const id of [
    'plugins-list', 'plugins-available', 'marketplaces-list', 'plugins-msg',
    'plugin-add-btn', 'marketplace-add', 'marketplace-url', 'marketplace-add-row',
    'guardrails-list', 'guardrails-msg', 'guardrail-create-btn',
    'models-list', 'models-msg', 'model-create-btn', 'model-share-btn',
    'settingsRoot', 'settingsProjectsRoot',
  ]) assert.ok(view.querySelector(`#${id}`), `#${id} not inside the settings view`);
});

test('each tab keeps its own heading + sub-title in its own topbar', () => {
  const view = settingsView();
  for (const [tab, h1] of [['general', 'Settings'], ['runs', 'Runs'], ['ask', 'Ask Worca'], ['guardrails', 'Guardrails'], ['models', 'Models'], ['plugins', 'Plugins'], ['memory', 'Memory']]) {
    const bar = view.querySelector(`.settings-pane[data-tab="${tab}"] > .topbar`);
    assert.ok(bar, `${tab} pane has no .topbar`);
    assert.equal(bar.querySelector('h1').textContent.trim(), h1);
    assert.ok(bar.querySelector('.sub').textContent.trim().length > 0, `${tab} lost its sub-title`);
  }
});

// ── booted half ──────────────────────────────────────────────────────────────
const GSETS = [
  { id: 'permissive', name: 'Permissive', origin: 'builtin',
    settings: { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] } },
  { id: 'gr_org', name: 'Org Policy', origin: null,
    settings: { honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'], protectedPaths: [], deny: [] } },
];

class WSStub {
  constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { (this._l.open || []).forEach((fn) => fn({})); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

async function boot({ url = 'http://localhost:4319/' } = {}) {
  const dom = new JSDOM(html, { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  window.fetch = (u, opts) => {
    const s = String(u);
    calls.push(s);
    if (s.includes('/api/guardrails')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: GSETS }) });
    if (s.includes('/api/models')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ models: [], custom: [] }) });
    if (s.includes('/api/plugins')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ installed: [], available: [], marketplaces: [] }) });
    if (s.includes('/api/settings')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0, workspaces: 0, projects_list: [], guardrails: GSETS }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  return { window, calls };
}

// jsdom does NOT fire hashchange on a `location.hash =` assignment.
async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

const paneOf = (window, tab) => window.document.querySelector(`.settings-pane[data-tab="${tab}"]`);
const shown = (window, tab) => !paneOf(window, tab).classList.contains('hidden');

test('bare #settings shows General and nothing else', async () => {
  const { window } = await boot();
  await go(window, 'settings');
  assert.equal(window.document.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
  assert.deepEqual(['general', 'guardrails', 'models', 'plugins', 'memory'].map((t) => shown(window, t)),
    [true, false, false, false, false]);
  assert.ok(window.document.querySelector('#settings-tabs button[data-tab="general"]').classList.contains('on'));
  assert.ok(window.document.querySelector('#settingsRoot'), 'General still owns #settingsRoot');
});

test('clicking a tab writes the hash, swaps the pane and runs that tab loader', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings');
  const before = calls.filter((u) => u.includes('/api/guardrails')).length;
  click(window, window.document.querySelector('#settings-tabs button[data-tab="guardrails"]'));
  await tick(); await tick();
  assert.equal(window.location.hash, '#settings/guardrails');
  assert.equal(shown(window, 'guardrails'), true);
  assert.equal(shown(window, 'general'), false);
  assert.ok(window.document.querySelector('#settings-tabs button[data-tab="guardrails"]').classList.contains('on'));
  assert.ok(calls.filter((u) => u.includes('/api/guardrails')).length > before, 'loadGuardrailsView ran');
  assert.equal(window.document.querySelectorAll('#guardrails-list .grv-card').length, 2);
});

test('deep link #settings/models opens the Models tab; the nav Settings button is active', async () => {
  const { window } = await boot();
  await go(window, 'settings/models');
  assert.equal(shown(window, 'models'), true);
  assert.ok(window.document.querySelector('.nav button[data-nav="settings"]').classList.contains('active'));
});

test('#settings/general and an unknown tab both normalise back to bare #settings', async () => {
  const { window } = await boot();
  await go(window, 'settings/general');
  assert.equal(window.location.hash, '#settings');
  assert.equal(shown(window, 'general'), true);
  await go(window, 'settings/bogus');
  assert.equal(window.location.hash, '#settings');
  assert.equal(shown(window, 'general'), true);
});

test('a tab switch tears down the guardrail wizard (leave-guard now fires per TAB)', async () => {
  const { window } = await boot();
  await go(window, 'settings/guardrails/gr_org');
  const modal = window.document.querySelector('#plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'deep link opened the wizard');
  click(window, window.document.querySelector('#settings-tabs button[data-tab="models"]'));
  await tick(); await tick();
  assert.equal(modal.classList.contains('hidden'), true, 'stale wizard must not float over the Models tab');
  assert.equal(shown(window, 'models'), true);
});

test('legacy #plugins / #models / #guardrails redirect to their Settings tab', async () => {
  const { window } = await boot();
  for (const [legacy, tab] of [['plugins', 'plugins'], ['models', 'models'], ['guardrails', 'guardrails']]) {
    await go(window, legacy);
    assert.equal(window.location.hash, `#settings/${tab}`, `#${legacy} should redirect`);
    assert.equal(shown(window, tab), true);
    assert.equal(window.document.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
  }
});

test('legacy #guardrails/<id> keeps the id and opens the wizard', async () => {
  const { window } = await boot();
  await go(window, 'guardrails/gr_org');
  assert.equal(window.location.hash, '#settings/guardrails/gr_org');
  assert.equal(window.document.querySelector('#plugin-modal').classList.contains('hidden'), false);
});

test('a legacy deep link at BOOT lands on the tab (no hashchange involved)', async () => {
  const { window } = await boot({ url: 'http://localhost:4319/#guardrails/gr_org' });
  await tick(); await tick();
  assert.equal(window.location.hash, '#settings/guardrails/gr_org');
  assert.equal(shown(window, 'guardrails'), true);
});

test('in-app jumps point at the tabs, not at the retired views', () => {
  const js = readFileSync(appPath, 'utf8');
  const sp = readFileSync(fileURLToPath(new URL('../ui/public/source-pane.mjs', import.meta.url)), 'utf8');
  assert.match(js, /showView\('settings', 'models'\)/, 'goAddModel must open the Models tab');
  assert.match(js, /location\.hash = 'settings\/plugins'/, 'failBox must open the Plugins tab');
  assert.match(js, /location\.hash = `settings\/guardrails\/\$\{edit\.dataset\.id\}`/, 'guardrail edit deep link');
  assert.match(js, /startsWith\('settings\/guardrails\/'\)/, 'grvExitWizard normalisation');
  assert.match(sp, /href = '#settings\/plugins'/, 'source-pane profile-gate link');
  // Nothing may still navigate to a retired top-level view.
  assert.equal(/location\.hash = '(plugins|models|guardrails)'/.test(js), false);
  assert.equal(/showView\('(plugins|models|guardrails)'\)/.test(js), false);
});

// ── General split (Runs, Ask Worca, helper models on Models) ─────────────────
const cardIds = (view, tab) =>
  [...view.querySelectorAll(`.settings-pane[data-tab="${tab}"] section.card.settings-card`)].map((c) => c.id);

test('General keeps the machine cards; Runs, Ask Worca and Models hold the moved ones', () => {
  const view = settingsView();
  assert.deepEqual(cardIds(view, 'general'), [
    'appearance-card', 'credentials-card', 'mode-settings-card', 'root-settings-card',
    'debug-spawn-settings-card', 'getting-started-card', 'about-card',
  ]);
  assert.deepEqual(cardIds(view, 'runs'), ['budget-settings-card', 'schedule-settings-card', 'chat-settings-card']);
  assert.deepEqual(cardIds(view, 'ask'), ['ask-settings-card']);
  assert.deepEqual(cardIds(view, 'models'), ['title-model-settings-card', 'auto-model-settings-card']);
  // Nothing got lost or duplicated in the move: the thirteen cards are all still here, once.
  const all = [...view.querySelectorAll('section.card.settings-card')].map((c) => c.id);
  assert.equal(all.length, 13);
  assert.equal(new Set(all).size, 13);
});

test('each moved card keeps its level; Runs is a Simple tab, Ask Worca an Advanced one', () => {
  const view = settingsView();
  const lv = (id) => view.querySelector(`#${id}`).dataset.minLevel;
  assert.equal(lv('budget-settings-card'), 'simple');
  assert.equal(lv('schedule-settings-card'), 'advanced');
  assert.equal(lv('chat-settings-card'), 'advanced');
  assert.equal(lv('ask-settings-card'), 'simple', 'the Advanced tab gates it; a deep link must not open on an empty page');
  assert.equal(lv('title-model-settings-card'), 'expert');
  assert.equal(lv('auto-model-settings-card'), 'expert');
  const tab = (t) => view.querySelector(`#settings-tabs button[data-tab="${t}"]`).dataset.minLevel;
  assert.equal(tab('runs'), 'simple');
  assert.equal(tab('ask'), 'advanced');
  // The Ask card's heading no longer repeats the tab's h1.
  assert.equal(view.querySelector('#ask-settings-card h2').textContent.trim(), 'Limits & access');
  // The helper pair sits above the catalog, in its own grid.
  const grid = view.querySelector('.settings-pane[data-tab="models"] .models-helpers');
  assert.ok(grid, 'helper grid on Models');
  assert.ok(grid.compareDocumentPosition(view.querySelector('#models-list')) & 4, 'grid precedes the catalog');
});

test('the Settings tab strip is no longer hidden in Simple (Runs is a Simple tab)', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.equal(/data-level="simple"\] #settings-tabs/.test(css), false);
});

test('opening Runs or Ask Worca loads the settings payload; Models repaints its helper cards', async () => {
  for (const tab of ['runs', 'ask', 'models']) {
    const { window, calls } = await boot();
    await go(window, `settings/${tab}`);
    await tick(); await tick();
    assert.equal(shown(window, tab), true, `${tab} pane shown`);
    assert.equal(window.location.hash, `#settings/${tab}`);
    assert.ok(calls.some((u) => u.includes('/api/settings')), `${tab} fetched /api/settings`);
  }
});

test('the cost-pause banners open the Runs tab, where the budget now lives', () => {
  const js = readFileSync(appPath, 'utf8');
  assert.equal((js.match(/\.cb-settings'\)\) \{ location\.hash = 'settings\/runs'; return; \}/g) || []).length, 2);
  assert.match(js, /settingsBtn\.addEventListener\('click', \(\) => \{ location\.hash = 'settings\/runs'; \}\)/);
  assert.equal(/location\.hash = 'settings';/.test(js), false, 'no bare #settings jump left for the budget');
});
