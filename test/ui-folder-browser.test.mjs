// test/ui-folder-browser.test.mjs
// JSDOM tests for the add-project Browse button: native-dialog happy path and
// the in-app folder-browser modal fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

class WSStub {
  static last = null;
  constructor() { WSStub.last = this; this.sent = []; this.readyState = 0; }
  addEventListener(ev, fn) { (this._h ||= {})[ev] = fn; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() {}
  _open() { this.readyState = 1; this._h?.open?.(); }
}

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: [], current: '' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only global */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  return { window };
}

function openAddForm(window) {
  const sel = window.document.querySelector('#projectSelect');
  sel.value = '__add__';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('Browse fills the path (and an empty name) from the native dialog', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/fs/pick-folder') && opts.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'picked', path: '/Users/me/dev/my-app' }) });
      }
      return null;
    },
  });
  openAddForm(window);
  const doc = window.document;
  click(window, doc.querySelector('#newProjectBrowse'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#newProjectPath').value, '/Users/me/dev/my-app');
  assert.equal(doc.querySelector('#newProjectName').value, 'my-app', 'empty name prefilled from basename');
  assert.ok(doc.querySelector('#folder-browser').classList.contains('hidden'), 'modal stays closed');
});

test('a typed name is not overwritten by the picker', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => (u.endsWith('/api/fs/pick-folder') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'picked', path: '/srv/code' }) })
      : null),
  });
  openAddForm(window);
  const doc = window.document;
  doc.querySelector('#newProjectName').value = 'Custom';
  click(window, doc.querySelector('#newProjectBrowse'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#newProjectName').value, 'Custom');
  assert.equal(doc.querySelector('#newProjectPath').value, '/srv/code');
});

test('unsupported dialog opens the modal; navigating + Select fills the field', async () => {
  const listings = {
    '': { path: '/home/me', parent: '/home', home: '/home/me', dirs: [{ name: 'dev', path: '/home/me/dev' }] },
    '/home/me/dev': { path: '/home/me/dev', parent: '/home/me', home: '/home/me', dirs: [] },
  };
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/fs/pick-folder') && opts.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'unsupported' }) });
      }
      if (u.includes('/api/fs/dirs')) {
        const q = decodeURIComponent(u.split('path=')[1] || '');
        const body = listings[q] || listings[''];
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      return null;
    },
  });
  openAddForm(window);
  const doc = window.document;
  click(window, doc.querySelector('#newProjectBrowse'));
  await tick(); await tick(); await tick();
  const modal = doc.querySelector('#folder-browser');
  assert.ok(!modal.classList.contains('hidden'), 'fallback modal opened');
  assert.equal(doc.querySelector('#folderCurrent').textContent, '/home/me');

  const item = [...doc.querySelectorAll('#folderList .folder-item')].find((b) => b.textContent === 'dev');
  assert.ok(item, 'dev folder rendered');
  click(window, item);
  await tick(); await tick();
  assert.equal(doc.querySelector('#folderCurrent').textContent, '/home/me/dev');

  click(window, doc.querySelector('#folderSelect'));
  assert.equal(doc.querySelector('#newProjectPath').value, '/home/me/dev');
  assert.ok(modal.classList.contains('hidden'), 'modal closed after Select');
});

test('a canceled native dialog changes nothing', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => (u.endsWith('/api/fs/pick-folder') && opts.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'canceled' }) })
      : null),
  });
  openAddForm(window);
  const doc = window.document;
  doc.querySelector('#newProjectPath').value = '/keep/me';
  click(window, doc.querySelector('#newProjectBrowse'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#newProjectPath').value, '/keep/me');
  assert.ok(doc.querySelector('#folder-browser').classList.contains('hidden'));
});
