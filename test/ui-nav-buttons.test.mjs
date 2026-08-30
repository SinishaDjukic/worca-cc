// test/ui-nav-buttons.test.mjs — sidebar/topnav menu items are buttons, not links.
// They must drive the hash router exactly like the anchors did (reload restore,
// back/forward, deep links), while producing no browser status-bar link preview.
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
const PROJECT = '/tmp/proj';
const html = readFileSync(htmlPath, 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) =>
  node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const hidden = (doc, view) =>
  doc.querySelector(`[data-view="${view}"]`).classList.contains('hidden');

async function boot(url = 'http://localhost:4317/') {
  const dom = new JSDOM(html, { url });
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

// ---- static markup: no anchors left in either menu ----

test('sidebar and topnav menus contain buttons, not links', () => {
  const sidebar = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
  const topnav = html.match(/<nav class="topnav"[\s\S]*?<\/nav>/)[0];
  for (const [name, block] of [['sidebar', sidebar], ['topnav', topnav]]) {
    assert.ok(!/<a[\s>]/.test(block), `${name} still contains an <a> (browser shows a link preview on hover)`);
    assert.ok(!/href="#/.test(block), `${name} still carries hash hrefs`);
    assert.equal((block.match(/<button type="button"/g) || []).length, 12,
      `${name} should have exactly 12 menu buttons`);
  }
});

// ---- behavior: buttons drive the same hash router ----

test('clicking a menu button routes via the hash (view, hash, active, aria-current)', async () => {
  const { window } = await boot();
  const doc = window.document;
  const btn = doc.querySelector('.nav button[data-nav="history"]');
  assert.ok(btn, 'sidebar History button exists');
  click(window, btn);
  await tick();
  assert.equal(window.location.hash, '#history', 'hash follows the click');
  assert.equal(hidden(doc, 'history'), false, 'History view shown');
  assert.ok(btn.classList.contains('active'), 'button highlighted');
  assert.equal(btn.getAttribute('aria-current'), 'page', 'active state exposed to AT');
  assert.equal(doc.querySelector('.nav button[data-nav="new"]').getAttribute('aria-current'), null);
});

test('back/forward (a plain hashchange) still routes', async () => {
  const { window } = await boot();
  const doc = window.document;
  click(window, doc.querySelector('.nav button[data-nav="history"]'));
  await tick();
  click(window, doc.querySelector('.nav button[data-nav="agents"]'));
  await tick();
  window.location.hash = 'history';                       // what Back does
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  assert.equal(hidden(doc, 'history'), false, 'Back restored the History view');
});

test('running child rows are buttons with no href and still deep-link', async () => {
  const { window, recv } = await boot();
  recv({ type: 'hello', runs: [live('auth-fix')] });
  await tick();                                           // let renderPipelineTabs paint
  const row = window.document.querySelector('#nav-running-children .nav-child');
  assert.ok(row, 'child row rendered');
  assert.equal(row.tagName, 'BUTTON', 'child row is a button');
  assert.equal(row.getAttribute('href'), null, 'no href → no hover preview');
  click(window, row);
  await tick();
  assert.equal(window.location.hash, '#running/auth-fix', 'child row still focuses the run');
  assert.equal(window.document.querySelectorAll('.nav a, .topnav a').length, 0,
    'no anchors remain anywhere in the menus');
});

test('reload on #running/<id> keeps the Running view (no reset to New)', async () => {
  const { window } = await boot('http://localhost:4317/#running/auth-fix');
  const doc = window.document;
  await tick(); await tick();   // let boot's showView + the detail mount settle
  assert.equal(hidden(doc, 'new'), true, 'must not fall back to the New view');
  assert.equal(hidden(doc, 'running'), false, 'Running view restored from the deep link');
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the deep link lands on the detail screen, not the list');
});
