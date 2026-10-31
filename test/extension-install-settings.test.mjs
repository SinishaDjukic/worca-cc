// test/extension-install-settings.test.mjs — Settings › General › Browser extension › Install in app.js
// (docs/browser-extension.md#install): GET /api/extension/install painted into #extensionInstallHost, the tab follows
// the browser Worca is open in, a tab click switches the panel and Copy path writes the folder to the clipboard.
// Run under `timeout 60` while red: app.js timers keep the process alive.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

const INSTALL = {
  remoteMode: false, version: '1.12.0', releaseUrl: 'https://github.com/acme/worca/releases/tag/worca-app-v1.12.0', buildCommand: 'npm run ext:build',
  builds: ['chrome', 'edge', 'firefox'].map((b) => ({ browser: b, present: true, path: `/opt/worca/extension/dist/${b}`, version: '1.12.0', steps: [`step for ${b}`], downloadUrl: `https://github.com/acme/worca/releases/download/worca-app-v1.12.0/worca-${b}-1.12.0.zip` })),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 2000) {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

async function boot() {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  };
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { copied.push(s); } } });
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/extension/install')) return reply(200, INSTALL);
    if (u.includes('/api/extension/pairings')) return reply(200, { remoteMode: false, paired: [], pending: [] });
    if (u.includes('/api/counts')) return reply(200, { schedules: { scheduled: 0, missed: 0, recurring: 0, unread: 0 } });
    if (u.includes('/api/projects')) return reply(200, { projects: [] });
    if (u.includes('/api/settings')) return reply(200, { root: '/tmp/acme', default: '/tmp/acme' });
    return reply(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await sleep(0);
  return { window, doc: window.document, copied };
}

test('Settings shows the Install block; a tab switch and Copy path work', async () => {
  const t = await boot();
  t.window.location.hash = 'settings';
  await until(() => t.doc.querySelector('#extensionInstallHost .xi-path'), 'the install path');
  // jsdom's UA is neither Edge nor Firefox → Chrome opens first
  assert.equal(t.doc.querySelector('#extensionInstallHost [data-xi-panel]:not([hidden])').dataset.xiPanel, 'chrome');
  t.doc.querySelector('#xi-tab-firefox').click();
  assert.equal(t.doc.querySelector('#extensionInstallHost [data-xi-panel]:not([hidden])').dataset.xiPanel, 'firefox');
  t.doc.querySelector('#xi-panel-firefox [data-copy-path]').click();
  await until(() => t.copied.length === 1, 'the clipboard write');
  assert.equal(t.copied[0], '/opt/worca/extension/dist/firefox');
  const copyBtn = t.doc.querySelector('#xi-panel-firefox [data-copy-path]');
  await until(() => copyBtn.classList.contains('copied') && copyBtn.title === 'Copied', 'the copied tick');
  assert.equal(copyBtn.querySelector('.copy-btn-msg').textContent, 'Copied', 'the tick and its Copied caption');
});
