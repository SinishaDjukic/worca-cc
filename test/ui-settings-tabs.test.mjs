// test/ui-settings-tabs.test.mjs — Guardrails is a Settings TAB, not a view:
// the nav entry is gone, the panes live inside [data-view="settings"] and the
// tab rides in the hash (#settings/<tab>). Plugins, Sets, Models and Providers
// left for pages of their own (test/ui-addons-pages.test.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, edit } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

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

test('Settings route normalisation: bare #settings shows General only; #settings/guardrails opens Guardrails with the Settings nav active; #settings/general and unknown tabs normalise to bare #settings', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'bare #settings shows General and nothing else', run: async () => {
      const { window } = await boot();
      await go(window, 'settings');
      assert.equal(window.document.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
      assert.deepEqual(['general', 'guardrails', 'memory'].map((t) => shown(window, t)),
        [true, false, false]);
      assert.ok(window.document.querySelector('#settings-tabs button[data-tab="general"]').classList.contains('on'));
      assert.ok(window.document.querySelector('#settingsRoot'), 'General still owns #settingsRoot');
    } },
    { name: 'deep link #settings/guardrails opens the Guardrails tab; the nav Settings button is active', run: async () => {
      const { window } = await boot();
      await go(window, 'settings/guardrails');
      assert.equal(shown(window, 'guardrails'), true);
      assert.ok(window.document.getElementById('acct-settings').classList.contains('active'), 'the account menu\'s Settings row');
    } },
    { name: '#settings/general and an unknown tab both normalise back to bare #settings', run: async () => {
      const { window } = await boot();
      await go(window, 'settings/general');
      assert.equal(window.location.hash, '#settings');
      assert.equal(shown(window, 'general'), true);
      await go(window, 'settings/bogus');
      assert.equal(window.location.hash, '#settings');
      assert.equal(shown(window, 'general'), true);
    } },
  ]);
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

test('a tab switch tears down the guardrail wizard (leave-guard now fires per TAB)', async () => {
  const { window } = await boot();
  await go(window, 'settings/guardrails/gr_org');
  const modal = window.document.querySelector('#plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'deep link opened the wizard');
  click(window, window.document.querySelector('#settings-tabs button[data-tab="runs"]'));
  await tick(); await tick();
  assert.equal(modal.classList.contains('hidden'), true, 'stale wizard must not float over the Runs tab');
  assert.equal(shown(window, 'runs'), true);
});

test('legacy #guardrails (incl. #guardrails/<id> and a boot-time deep link) redirects to its Settings tab, keeping the id', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: 'legacy #guardrails redirects to its Settings tab', run: async () => {
      const { window } = await boot();
      for (const [legacy, tab] of [['guardrails', 'guardrails']]) {
        await go(window, legacy);
        assert.equal(window.location.hash, `#settings/${tab}`, `#${legacy} should redirect`);
        assert.equal(shown(window, tab), true);
        assert.equal(window.document.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
      }
    } },
    { name: 'legacy #guardrails/<id> keeps the id and opens the wizard', run: async () => {
      const { window } = await boot();
      await go(window, 'guardrails/gr_org');
      assert.equal(window.location.hash, '#settings/guardrails/gr_org');
      assert.equal(window.document.querySelector('#plugin-modal').classList.contains('hidden'), false);
    } },
    { name: 'a legacy deep link at BOOT lands on the tab (no hashchange involved)', run: async () => {
      const { window } = await boot({ url: 'http://localhost:4319/#guardrails/gr_org' });
      await tick(); await tick();
      assert.equal(window.location.hash, '#settings/guardrails/gr_org');
      assert.equal(shown(window, 'guardrails'), true);
    } },
  ]);
});

test('opening Runs or Ask Worca loads the settings payload', async () => {
  for (const tab of ['runs', 'ask']) {
    const { window, calls } = await boot();
    await go(window, `settings/${tab}`);
    await tick(); await tick();
    assert.equal(shown(window, tab), true, `${tab} pane shown`);
    assert.equal(window.location.hash, `#settings/${tab}`);
    assert.ok(calls.some((u) => u.includes('/api/settings')), `${tab} fetched /api/settings`);
  }
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

test('#555 Actions: a low port above the high port flags both ports and posts nothing; a server error on the shared range lands on both', async () => {
  // One boot per row (cuts the count, not the time).
  await checkRows([
    { name: '#555 Actions: a low port above the high port flags both ports with one message and posts nothing', run: async () => {
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
    } },
    { name: '#555 Actions: a server error on the shared port range lands on both ports', run: async () => {
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
    } },
  ]);
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
