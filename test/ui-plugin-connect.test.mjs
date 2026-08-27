// test/ui-plugin-connect.test.mjs — the Settings modal's Connect flow in app.js.
// Two invariants:
//   1. one result block PER SOURCE — a later source's success must never paint
//      over an earlier source's failure (one shared slot did exactly that);
//   2. a channels-only plugin gets NO Connect button at all — every outcome the
//      button could render ("Add a profile first.") is a lie for a plugin that
//      cannot have profiles, and validateConfig is a task-source op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// Boot app.js in jsdom with a controllable fetch (mirrors ui-source-pane-mount).
async function boot(handlers) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4319/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    const u = String(url);
    for (const [prefix, fn] of Object.entries(handlers)) {
      if (u.includes(prefix)) return fn(u, opts || {});
    }
    if (u.includes('/api/projects')) return json({ projects: [] });
    if (u.includes('/api/sources') && !u.includes('/call')) return json({ sources: [] });
    if (u.includes('/api/workflows')) return json({ workflows: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

async function waitFor(fn, what, { timeoutMs = 3000, everyMs = 10 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// The Plugins list has one delegated click listener; a .pl-settings button with
// data-name is all it takes to open the Settings modal (no list render needed).
function openSettings(doc, window, name) {
  const btn = doc.createElement('button');
  btn.className = 'pl-settings';
  btn.dataset.name = name;
  doc.querySelector('#plugins-list').appendChild(btn);
  btn.click();
}

const modalButtons = (doc) =>
  [...doc.querySelectorAll('#plugin-modal-actions button')].map((b) => b.textContent);

test('Connect renders one outcome PER SOURCE — a later success never hides an earlier failure', async () => {
  const { window } = await boot({
    '/api/plugins/dual/config': (u, opts) => {
      if ((opts.method || 'GET') === 'PUT') return json({ ok: true });
      return json({
        sources: [
          { id: 'alpha', schema: [{ key: 'token', type: 'text', label: 'Token' }], values: {} },
          { id: 'beta', schema: [{ key: 'token', type: 'text', label: 'Token' }], values: {} },
        ],
        channels: [],
      });
    },
    '/api/sources/call': (u, opts) => {
      const body = JSON.parse(opts.body || '{}');
      if (body.sourceId === 'alpha') {
        return json({ ok: true, result: { ok: false, errors: [{ field: 'token', message: 'bad token' }] } });
      }
      return json({ ok: true, result: { ok: true, identity: 'beta-bot' } });
    },
  });
  const doc = window.document;

  openSettings(doc, window, 'dual');
  await waitFor(() => !doc.querySelector('#plugin-modal').classList.contains('hidden'), 'the settings modal');
  const connect = await waitFor(
    () => [...doc.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Connect'),
    'the Connect button');
  connect.click();

  const slot = doc.querySelector('.pl-connect-slot');
  await waitFor(() => slot.querySelectorAll('.pl-connect-result').length >= 2
    && !slot.textContent.includes('Connecting'), 'both results settled');

  const subs = slot.querySelectorAll('.pl-connect-sub');
  assert.equal(subs.length, 2, 'one block per source');
  assert.match(subs[0].textContent, /alpha/, 'the block names its source');
  assert.match(subs[0].textContent, /not connected/, "alpha's failure is still on screen…");
  assert.match(subs[0].textContent, /bad token/);
  assert.match(subs[1].textContent, /beta/);
  assert.match(subs[1].textContent, /connected/, '…next to beta\'s success');
  assert.match(subs[1].textContent, /beta-bot/);
});

test('a channels-only plugin has no Connect button (and no "Add a profile first." dead end)', async () => {
  const { window } = await boot({
    '/api/plugins/chatty/config': () => json({
      sources: [],
      channels: [{ id: 'tg', displayName: 'Telegram', platform: 'telegram', schema: [{ key: 'botToken', type: 'text', label: 'Bot token', secret: true }], values: {} }],
    }),
  });
  const doc = window.document;

  openSettings(doc, window, 'chatty');
  await waitFor(() => !doc.querySelector('#plugin-modal').classList.contains('hidden'), 'the settings modal');
  await waitFor(() => doc.querySelector('#plugin-modal-actions button'), 'the modal actions');

  assert.deepEqual(modalButtons(doc), ['Cancel', 'Save'],
    'Connect is absent — channels cannot have profiles, and validateConfig is a task-source op');
  assert.ok(doc.querySelector('#plugin-modal-body .pl-config-form[data-channel-id="tg"]'),
    'the channel form itself still renders and saves');
});
