// test/ui-settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('Settings is the last nav item, loads root, and saves a new one', async () => {
  let posted = null;
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/settings')) {
        if ((opts.method || 'GET').toUpperCase() === 'POST') {
          posted = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: posted.root, default: '/home/me' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', default: '/home/me' }) });
      }
      return null;
    },
  });
  const { window } = ctx;

  // (1) below all other menus: Settings is the LAST sidebar nav link.
  const navLinks = [...window.document.querySelectorAll('.nav button[data-nav]')];
  assert.equal(navLinks[navLinks.length - 1].dataset.nav, 'settings', 'Settings is the last menu');

  // (2) navigating to it loads the current root (default shown as placeholder).
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const input = window.document.querySelector('#settingsRoot');
  assert.ok(input, 'settings view has a root input');
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '/home/me', 'default shown as placeholder');

  // (3) typing a new root + Save POSTs it.
  input.value = '/Volumes/ext';
  window.document.querySelector('#settingsSave').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(posted && posted.root === '/Volumes/ext', 'Save POSTs the typed root');

  // (4) Reset posts an empty root.
  posted = null;
  window.document.querySelector('#settingsReset').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(posted && posted.root === '', 'Reset POSTs an empty root');
});
