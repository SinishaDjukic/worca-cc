// test/ui-settings-tabs.test.mjs — Guardrails/Models/Plugins are Settings TABS,
// not views: the nav entries are gone, the panes live inside
// [data-view="settings"] and the tab rides in the hash (#settings/<tab>).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, edit } from './helpers/feedback.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

const settingsView = () =>
  trackDom(new JSDOM(html, { url: 'http://localhost:4319/' }))
    .window.document.querySelector('.view[data-view="settings"]');

test('the three nav entries are gone from BOTH menus', () => {
  for (const v of ['guardrails', 'models', 'plugins'])
    assert.equal(html.includes(`data-nav="${v}"`), false, `data-nav=${v} still present`);
});

test('settings holds a .seg tab strip with the nine tabs in mode order, General preselected', () => {
  const seg = settingsView().querySelector('#settings-tabs');
  assert.ok(seg, '#settings-tabs missing');
  assert.ok(seg.classList.contains('seg'), 'reuses the .seg segmented control');
  const btns = [...seg.querySelectorAll('button[data-tab]')];
  assert.deepEqual(btns.map((b) => b.dataset.tab), ['general', 'runs', 'ask', 'guardrails', 'memory', 'plugins', 'mcp', 'models', 'providers']);
  assert.deepEqual(btns.map((b) => b.classList.contains('on')), [true, false, false, false, false, false, false, false, false]);
  // Simple, then Advanced, then Expert: every mode sees a gap-free prefix of the strip.
  const rank = { simple: 0, advanced: 1, expert: 2 };
  const ranks = btns.map((b) => rank[b.dataset.minLevel]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'tabs ordered by level');
});

test('nine panes live inside settings, in tab order; only General starts visible', () => {
  const panes = [...settingsView().querySelectorAll('.settings-pane')];
  assert.deepEqual(panes.map((p) => p.dataset.tab), ['general', 'runs', 'ask', 'guardrails', 'memory', 'plugins', 'mcp', 'models', 'providers']);
  assert.deepEqual(panes.map((p) => p.classList.contains('hidden')), [false, true, true, true, true, true, true, true, true]);
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
  const dom = trackDom(new JSDOM(html, { url }));
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
  assert.deepEqual(cardIds(view, 'runs'), ['budget-settings-card', 'night-settings-card', 'sync-settings-card', 'schedule-settings-card', 'actions-settings-card', 'ws-scan-models-card', 'chat-settings-card']);
  assert.deepEqual(cardIds(view, 'ask'), ['ask-engine-card', 'ask-settings-card']);
  assert.deepEqual(cardIds(view, 'models'), ['engine-settings-card', 'title-model-settings-card', 'auto-model-settings-card', 'pr-description-model-settings-card']);
  // Nothing got lost or duplicated in the move: the twenty cards (dev's thirteen + Workspaces + PR description model + Sync before run + Actions + Away mode + Engines + Ask engine) are all still here, once.
  const all = [...view.querySelectorAll('section.card.settings-card')].map((c) => c.id);
  assert.equal(all.length, 20);
  assert.equal(new Set(all).size, 20);
});

test('each moved card keeps its level; Runs is a Simple tab, Ask Worca an Advanced one', () => {
  const view = settingsView();
  const lv = (id) => view.querySelector(`#${id}`).dataset.minLevel;
  assert.equal(lv('budget-settings-card'), 'simple');
  assert.equal(lv('schedule-settings-card'), 'advanced');
  assert.equal(lv('sync-settings-card'), 'advanced', 'Sync before run: an Advanced card on the Simple Runs tab');
  assert.equal(lv('chat-settings-card'), 'advanced');
  assert.equal(lv('ws-scan-models-card'), 'advanced', 'Workspaces (scan models): an Advanced card on the Simple Runs tab');
  assert.equal(lv('ask-settings-card'), 'simple', 'the Advanced tab gates it; a deep link must not open on an empty page');
  assert.equal(lv('title-model-settings-card'), 'expert');
  assert.equal(lv('auto-model-settings-card'), 'expert');
  assert.equal(lv('pr-description-model-settings-card'), 'expert');
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
  assert.equal((js.match(/\.cb-settings'\)\) \{ location\.hash = 'settings\/runs'; return; \}/g) || []).length, 1,
    'one delegated handler: the run page (the list card no longer carries a cost banner)');
  assert.match(js, /settingsBtn\.addEventListener\('click', \(\) => \{ location\.hash = 'settings\/runs'; \}\)/);
  assert.equal(/location\.hash = 'settings';/.test(js), false, 'no bare #settings jump left for the budget');
});

test('#settings/runs/actions opens Runs, scrolls to the Actions card and focuses its first field', async () => {
  const { window } = await boot();
  const seen = [];
  window.Element.prototype.scrollIntoView = function () { seen.push(this.id); };
  await go(window, 'settings/runs/actions');
  await tick(); await tick();
  assert.equal(shown(window, 'runs'), true);
  assert.ok(seen.length && seen.every((id) => id === 'actions-settings-card'), JSON.stringify(seen));
  assert.equal(window.document.activeElement?.closest('#actions-settings-card')?.id, 'actions-settings-card');
  const before = seen.length;
  await go(window, 'settings/runs/bogus');
  await tick(); await tick();
  assert.equal(shown(window, 'runs'), true, 'an unknown card still opens the tab');
  assert.equal(seen.length, before, 'and scrolls nowhere');
});

test('Settings › Runs › Actions: blank Editor / Terminal say what detection found, or that nothing was', async () => {
  const { window } = await boot();
  const base = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, opts) => (String(u).includes('/api/settings')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x',
      actions: { keep: 'never', editor: '', terminal: '' }, actionsDetected: { editor: null, terminal: 'Terminal' } }) })
    : base(u, opts));
  await go(window, 'settings/runs');
  await tick(); await tick();
  const doc = window.document;
  const editor = doc.getElementById('act-editor');
  assert.equal(editor.placeholder, 'None found on this machine');
  assert.equal(doc.getElementById('act-editor-note').textContent, 'No editor was found on this machine. Enter the command or full path of an IDE or code editor that opens a folder.');
  assert.equal(doc.getElementById('act-terminal').placeholder, 'Terminal (detected)');
  assert.equal(doc.getElementById('act-terminal-note').textContent, 'Left blank, Worca uses Terminal.');
  editor.value = 'zed';
  editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.getElementById('act-editor-note').hidden, true, 'a typed command needs no note');
  editor.value = '';
  editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.getElementById('act-editor-note').hidden, false, 'cleared: the note is back');
});

test('Editor / Terminal: the dropdown (Browse… first, then the found apps) fills the command, the ⓘ shows the server OS examples, Try and a save warning land on the field', async () => {
  const { window } = await boot();
  const base = globalThis.fetch;
  let tryAnswer = { ok: true, status: 200, json: async () => ({ ok: true }) };
  let browseAnswer = { status: 'picked', path: 'C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', label: 'Code', line: '"C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" {folder}' };
  const tries = [];
  globalThis.fetch = window.fetch = (u, opts) => {
    const s = String(u);
    if (s.includes('/api/actions/launchers/try')) { tries.push(JSON.parse(opts.body)); return Promise.resolve(tryAnswer); }
    if (s.includes('/api/actions/launchers/browse')) return Promise.resolve({ ok: true, status: 200, json: async () => browseAnswer });
    if (s.includes('/api/actions/launchers')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ platform: 'win32',
        editor: [{ label: 'VS Code', line: '"C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" {folder}' }], terminal: [],
        examples: { editor: ['code {folder}', '"C:\\Program Files\\Microsoft VS Code\\Code.exe" --new-window {folder}'], terminal: ['wt -d {folder}'] },
        detected: { editor: null, terminal: 'Command Prompt' }, browse: true }) });
    }
    if (s.includes('/api/settings')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x',
        actions: { keep: 'never', editor: '', terminal: '' }, actionsDetected: { editor: null, terminal: 'Command Prompt' },
        actionsWarnings: { terminal: 'wtt was not found on this machine. It is saved anyway; use Try to check it.' } }) });
    }
    return base(u, opts);
  };
  await go(window, 'settings/runs');
  for (let i = 0; i < 4; i++) await tick();
  const doc = window.document;
  const sel = doc.getElementById('act-editor-choose');
  const opts = [...sel.querySelectorAll('option')];
  assert.equal(opts[0].hidden, true, 'the closed dropdown reads Browse… through a hidden placeholder');
  assert.equal(opts[0].textContent, 'Browse…');
  assert.deepEqual(opts.slice(1).map((o) => o.textContent), ['Browse…', 'VS Code'], 'Browse… first, then what was found');
  assert.equal(sel.querySelector('optgroup').label, 'Found on this machine');
  assert.equal(doc.getElementById('act-terminal-choose').querySelector('optgroup').label, 'No terminal found on this machine');
  const tip = doc.getElementById('act-editor-tip');
  assert.match(tip.textContent, /Examples on Windows:/);
  assert.deepEqual([...tip.querySelectorAll('code')].map((c) => c.textContent), ['code {folder}', '"C:\\Program Files\\Microsoft VS Code\\Code.exe" --new-window {folder}']);
  assert.equal(doc.getElementById('act-terminal-note').textContent, 'wtt was not found on this machine. It is saved anyway; use Try to check it.');
  assert.ok(doc.getElementById('act-terminal-note').classList.contains('warn'));

  const input = doc.getElementById('act-editor');
  const pick = async (value) => { sel.value = value; sel.dispatchEvent(new window.Event('change', { bubbles: true })); for (let i = 0; i < 4; i++) await tick(); };
  // A found app fills its command line; the dropdown goes back to its label.
  await pick(opts[2].value);
  assert.equal(input.value, '"C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" {folder}');
  assert.equal(sel.value, '');
  assert.equal(doc.getElementById('act-editor-note').textContent, 'Picked VS Code. Try checks that it opens a folder; Save keeps it.');
  // Browse… opens the system picker; its pick comes back as a command line.
  input.value = '';
  await pick('__browse__');
  assert.equal(input.value, '"C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" {folder}');
  assert.equal(doc.getElementById('act-editor-note').textContent, 'Picked Code. Try checks that it opens a folder; Save keeps it.');
  browseAnswer = { status: 'unsupported' };
  await pick('__browse__');
  assert.equal(doc.getElementById('act-editor-note').textContent, 'No app picker can open on this machine. Pick a found app or type the command.');


  doc.getElementById('act-editor-try').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(tries[0], { kind: 'editor', line: input.value });
  const note = doc.getElementById('act-editor-note');
  assert.equal(note.textContent, 'It opened your home folder as a test. Save to keep it.');
  assert.ok(note.classList.contains('ok'));

  tryAnswer = { ok: false, status: 409, json: async () => ({ error: "'zedd' is not recognized as an internal or external command", code: 'LAUNCH_FAILED' }) };
  doc.getElementById('act-editor-try').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(note.textContent, "It did not open: 'zedd' is not recognized as an internal or external command");
  assert.ok(note.classList.contains('err'));
  input.value = 'code {folder}';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(!note.classList.contains('err'), 'editing clears the Try result');
});

test('Editor / Terminal: where no app picker can open, the dropdown reads "Pick an app" and has no Browse…', async () => {
  const { window } = await boot();
  const base = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, opts) => {
    const s = String(u);
    if (s.includes('/api/actions/launchers')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ platform: 'linux', editor: [{ label: 'VS Code', line: 'code {folder}' }], terminal: [],
        examples: { editor: ['code {folder}'], terminal: ['konsole --workdir {folder}'] }, detected: { editor: 'VS Code', terminal: null }, browse: false }) });
    }
    return base(u, opts);
  };
  await go(window, 'settings/runs');
  for (let i = 0; i < 4; i++) await tick();
  const opts = [...window.document.getElementById('act-editor-choose').querySelectorAll('option')];
  assert.equal(opts[0].textContent, 'Pick an app');
  assert.deepEqual(opts.slice(1).map((o) => o.textContent), ['VS Code']);
  assert.ok(!opts.some((o) => o.value === '__browse__'));
});

// #555 D8: a failed Settings GET used to land in the Root folders card, which
// Simple mode hides. It now shows above the tabs, outside every level-gated card.
test('#555 D8: a failed /api/settings load shows above the tabs, outside every card', async () => {
  const { window } = await boot();
  const base = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, opts) => (String(u).includes('/api/settings')
    ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) })
    : base(u, opts));
  await go(window, 'settings');
  await tick(); await tick();
  const msg = window.document.getElementById('settingsLoadMsg');
  assert.equal(msg.hidden, false, 'the load error is visible');
  assert.equal(msg.textContent, 'Could not load settings: disk full');
  assert.equal(msg.closest('[data-min-level]'), null, 'no UI level hides it');
  assert.equal(msg.closest('.settings-card'), null, 'it is not inside a settings card');
});

// ── #555: Settings cards report on the button, the field or the card ────────
// Wrap the boot's fetch: record POST /api/settings bodies and answer them with `answer(body)`.
function recordSettingsPosts(window, answer = null) {
  const posts = [];
  const base = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, opts = {}) => {
    if (String(u).includes('/api/settings') && (opts.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      if (answer) return Promise.resolve(answer(body));
    }
    return base(u, opts);
  };
  return posts;
}
const ticks = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

test('#555 Actions: a low port above the high port flags both ports with one message and posts nothing', async () => {
  const { window } = await boot();
  const posts = recordSettingsPosts(window);
  await go(window, 'settings/runs');
  await ticks();
  const doc = window.document;
  const low = doc.getElementById('act-port-low');
  const high = doc.getElementById('act-port-high');
  assert.equal(low.getAttribute('aria-label'), 'Low port');
  assert.equal(doc.getElementById('act-save').disabled, true, 'clean card: Save waits for a change');
  edit(window, low, '5000');
  edit(window, high, '4000');
  doc.getElementById('act-save').click();
  await ticks();
  assert.equal(posts.length, 0, 'nothing reaches the server');
  const msg = 'The low port can’t be higher than the high port.';
  assert.equal(fieldErrorText(low), msg);
  assert.equal(fieldErrorText(high), msg);
  assert.equal(doc.querySelectorAll('#actions-settings-card .field-error').length, 1, 'one message for the pair');
  assert.equal(low.getAttribute('aria-invalid'), 'true');
  assert.equal(high.getAttribute('aria-invalid'), 'true');
  assert.equal(doc.getElementById('actSettingsMsg'), null, 'no grey status line');
});

test('#555 Actions: a server error on the shared port range lands on both ports', async () => {
  const { window } = await boot();
  const posts = recordSettingsPosts(window, () => ({ ok: false, status: 400,
    json: async () => ({ error: 'The port range must hold at least 10 ports.', field: 'actions.portRange' }) }));
  await go(window, 'settings/runs');
  await ticks();
  const doc = window.document;
  edit(window, doc.getElementById('act-port-low'), '4400');
  edit(window, doc.getElementById('act-port-high'), '4401');
  doc.getElementById('act-save').click();
  await ticks();
  assert.equal(posts.length, 1);
  assert.equal(fieldErrorText(doc.getElementById('act-port-low')), 'The port range must hold at least 10 ports.');
  assert.equal(fieldErrorText(doc.getElementById('act-port-high')), 'The port range must hold at least 10 ports.');
});

test('#555 Chat: after a save the card is clean once the done state ends, with no repaint', async () => {
  const { window } = await boot();
  const posts = recordSettingsPosts(window, () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  await go(window, 'settings/runs');
  await ticks();
  const doc = window.document;
  const save = doc.getElementById('chatSettingsSave');
  const mark = () => doc.querySelector('#chat-settings-card .dirty-mark');
  assert.equal(save.disabled, true);
  const cb = doc.querySelector('#chat-settings-host input.chat-ev');
  assert.equal(cb.dataset.setting, 'chat');
  edit(window, cb, !cb.checked);
  assert.equal(save.disabled, false);
  assert.equal(mark().hidden, false);
  save.click();
  await ticks();
  assert.equal(posts.length, 1);
  assert.ok('chat' in posts[0]);
  assert.equal(save.textContent, 'Saved');
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(save.textContent, 'Save');
  assert.equal(save.disabled, true, 'clean after the done state');
  assert.equal(mark().hidden, true);
});

test('#555 Away: unsaved edits stay dirty when another card\'s save fires settings-changed', async () => {
  const { window } = await boot();
  await go(window, 'settings/runs');
  await ticks();
  const doc = window.document;
  const save = doc.getElementById('nightModeSave');
  assert.equal(save.disabled, true);
  const num = doc.querySelector('#night-mode-host [data-field="maxDecisions"]');
  edit(window, num, '12');
  assert.equal(save.disabled, false);
  WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) }));
  await ticks(10);
  assert.equal(doc.querySelector('#night-mode-host [data-field="maxDecisions"]').value, '12', 'the edit survived the repaint');
  assert.equal(save.disabled, false, 'Save stays enabled');
  assert.equal(doc.querySelector('#night-settings-card .dirty-mark').hidden, false, 'the marker stays');
});

test('#555 Away: a server field nightMode.maxDecisions lands on the data-field input', async () => {
  const { window } = await boot();
  recordSettingsPosts(window, () => ({ ok: false, status: 400,
    json: async () => ({ error: '“Answer limit” must be a whole number from 1 to 500.', field: 'nightMode.maxDecisions' }) }));
  await go(window, 'settings/runs');
  await ticks();
  const doc = window.document;
  const num = doc.querySelector('#night-mode-host [data-field="maxDecisions"]');
  edit(window, num, '7');
  doc.getElementById('nightModeSave').click();
  await ticks();
  assert.equal(num.getAttribute('aria-invalid'), 'true');
  assert.equal(fieldErrorText(num), '“Answer limit” must be a whole number from 1 to 500.');
  assert.equal(doc.getElementById('nightModeMsg'), null, 'no grey status line');
});
