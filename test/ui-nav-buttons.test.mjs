// test/ui-nav-buttons.test.mjs — sidebar menu items are buttons, not links.
// They must drive the hash router exactly like the anchors did (reload restore,
// back/forward, deep links), while producing no browser status-bar link preview.
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
const PROJECT = '/tmp/proj';
const html = readFileSync(htmlPath, 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) =>
  node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const hidden = (doc, view) =>
  doc.querySelector(`[data-view="${view}"]`).classList.contains('hidden');

async function boot(url = 'http://localhost:4317/') {
  const dom = trackDom(new JSDOM(html, { url }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (u) => String(u).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, recv };
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

// ---- behavior: buttons drive the same hash router ----

test('sidebar buttons route via the hash, and back/forward (a plain hashchange) still routes', async () => {
  const { window } = await boot();
  const doc = window.document;
  await checkRows([
    { name: 'clicking a menu button routes via the hash (view, hash, active, aria-current)', run: async () => {
      const btn = doc.querySelector('.nav button[data-nav="runs"]');
      assert.ok(btn, 'sidebar Runs button exists');
      click(window, btn);
      await tick();
      assert.equal(window.location.hash, '#runs', 'hash follows the click');
      assert.equal(hidden(doc, 'runs'), false, 'Runs view shown');
      assert.ok(btn.classList.contains('active'), 'button highlighted');
      assert.equal(btn.getAttribute('aria-current'), 'page', 'active state exposed to AT');
      assert.equal(doc.getElementById('topnav-new').getAttribute('aria-current'), null, 'New run is never lit as the open page');
    } },
    { name: 'back/forward (a plain hashchange) still routes', run: async () => {
      click(window, doc.querySelector('.nav button[data-nav="runs"]'));
      await tick();
      click(window, doc.querySelector('.nav button[data-nav="agents"]'));
      await tick();
      window.location.hash = 'runs';                          // what Back does
      window.dispatchEvent(new window.Event('hashchange'));
      await tick();
      assert.equal(hidden(doc, 'runs'), false, 'Back restored the Runs view');
    } },
    // Settings lives in the account menu: app.js's navLinks takes #acct-settings beside the
    // `.nav button[data-nav]` rows, so it routes and lights like them.
    { name: 'Settings in the account menu routes via the hash, lights while open, and closes the menu', run: async () => {
      click(window, doc.getElementById('side-acct'));
      assert.equal(doc.getElementById('acct-menu').hidden, false);
      const btn = doc.getElementById('acct-settings');
      click(window, btn);
      await tick();
      assert.equal(window.location.hash, '#settings');
      assert.equal(doc.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
      assert.ok(btn.classList.contains('active'));
      assert.equal(btn.getAttribute('aria-current'), 'page');
      assert.equal(doc.getElementById('acct-menu').hidden, true, 'a route closes the menu');
      click(window, doc.querySelector('.nav button[data-nav="runs"]'));
      await tick();
      assert.equal(btn.getAttribute('aria-current'), null, 'leaving Settings clears it');
    } },
    { name: 'New run in the top bar routes back to the New view; no sidebar row is lit there', run: async () => {
      click(window, doc.querySelector('.nav button[data-nav="projects"]'));
      await tick();
      click(window, doc.getElementById('topnav-new'));
      await tick();
      assert.equal(window.location.hash, '#new');
      assert.equal(doc.querySelector('[data-view="new"]').classList.contains('hidden'), false);
      assert.deepEqual([...doc.querySelectorAll('.nav button.active')], [], 'the sidebar has no New run row to light');
    } },
  ]);
});

test('reload on #running/<id> keeps the Runs view (no reset to New)', async () => {
  const { window } = await boot('http://localhost:4317/#running/auth-fix');
  const doc = window.document;
  await tick(); await tick();   // let boot's showView + the detail mount settle
  assert.equal(hidden(doc, 'new'), true, 'must not fall back to the New view');
  assert.equal(hidden(doc, 'runs'), false, 'Runs view restored from the deep link');
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the deep link lands on the detail screen, not the list');
});
