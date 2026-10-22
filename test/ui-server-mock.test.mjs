// test/ui-server-mock.test.mjs
// The server's mock mode in the UI (#510). A server started with WORCA_MOCK=1 / ORCH_MOCK=1
// makes EVERY run a mock run, whatever the request says; the WS hello carries it as
// `serverMock`. With it on, the sidebar shows a MOCK pill beside the wordmark and the New-run
// Mock switch is forced on and disabled, so the page can never claim a real run the server
// would not start. Without it nothing changes.
//
// boot() is a local copy of the jsdom harness in test/ui-attribution.test.mjs — the suites do
// not import each other.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const trackDom = useDomRelease(afterEach);

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  trackDom(dom);
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  window.fetch = (u) => {
    if (String(u).includes('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(window);
  const hello = async (extra) => {
    wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', bootId: 'b1', runs: [], ...extra }) });
    await settle(window);
  };
  return { window, doc: window.document, hello };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

const parts = (doc) => ({
  pill: doc.getElementById('side-mock-pill'),
  sw: doc.getElementById('mock-switch'),
  cb: doc.getElementById('mock'),
});

// One boot: the hello with serverMock on, then the locked switch is clicked and keyed.
test('server mock on: the MOCK pill shows and the Mock switch is locked on — clicks and keys leave it on', async () => {
  const { window, doc, hello } = await boot();
  await hello({ serverMock: true });
  await checkRows([
    { name: 'server mock on: the MOCK pill shows beside the wordmark and the Mock switch is locked on', run: async () => {
      const { pill, sw, cb } = parts(doc);
      assert.ok(pill, 'the pill is in the markup');
      assert.equal(pill.closest('.brand') !== null, true, 'it sits in the sidebar brand row');
      assert.equal(pill.hidden, false);
      assert.equal(pill.textContent.trim(), 'MOCK');
      assert.ok(pill.classList.contains('badge'), 'an existing badge style');
      assert.match(pill.title, /WORCA_MOCK=1/);
      assert.equal(cb.checked, true, 'the run body reads the hidden checkbox: mock');
      assert.equal(sw.classList.contains('on'), true);
      assert.equal(sw.getAttribute('aria-checked'), 'true');
      assert.equal(sw.getAttribute('aria-disabled'), 'true');
      assert.ok(sw.classList.contains('disabled'));
      assert.match(sw.title, /Server started with WORCA_MOCK=1, so all runs are mock\./);
    } },
    { name: 'server mock on: clicking or keying the locked switch leaves it on', run: async () => {
      const { sw, cb } = parts(doc);
      sw.click();
      sw.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      assert.equal(cb.checked, true);
      assert.equal(sw.classList.contains('on'), true);
      assert.equal(sw.getAttribute('aria-checked'), 'true');
    } },
  ]);
});

test('a restarted server without mock unlocks the switch and restores the per-run choice', async () => {
  const { doc, hello } = await boot();
  await hello({ serverMock: false });
  const { pill, sw, cb } = parts(doc);
  await hello({ serverMock: true });
  assert.equal(cb.checked, true);
  await hello({ serverMock: false });
  assert.equal(pill.hidden, true);
  assert.equal(cb.checked, false, 'back to what the user had: off');
  assert.equal(sw.classList.contains('on'), false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  assert.equal(sw.getAttribute('aria-disabled'), null);
});
