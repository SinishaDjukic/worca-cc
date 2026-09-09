// test/ui-settings-appearance.test.mjs — Settings › General › Appearance (dark-mode
// design §5.3/§5.5): GET paints the segmented control and <html data-theme>, a
// click applies at once and POSTs exactly { theme }, a 400 reverts to the server
// value and shows the error, settings-changed re-applies, boot needs no
// matchMedia, and the theme-color meta follows the resolved background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const GET_BODY = (theme = 'system') => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, debugSpawnEnabled: false, debugSpawnEffective: { enabled: false, source: 'settings' },
  titleModel: null, titleModelEffective: {}, hideBuiltinModels: false, theme,
});

async function boot({ postResponse, initialTheme = 'system', bodyBg = '' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  if (bodyBg) {                                   // resolved colours exist only in a real browser
    const real = window.getComputedStyle.bind(window);
    window.getComputedStyle = (el, pseudo) => { const cs = real(el, pseudo); return el === window.document.body ? new Proxy(cs, { get: (t, k) => (k === 'backgroundColor' ? bodyBg : t[k]) }) : cs; };
  }
  const box = { theme: initialTheme };
  const posts = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/settings')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        if (postResponse) return Promise.resolve(postResponse);
        box.theme = body.theme;
        return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(box.theme) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(box.theme) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: 0, msUntilReset: 0, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: null, blocked: false }) });   // the house shape (test/ui-settings-debug-spawn.test.mjs)
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  const themeEvents = [];
  window.document.addEventListener('worca:theme', (e) => themeEvents.push(e.detail.mode));
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => window.document.querySelector(sel);
  const openSettings = async () => { window.location.hash = 'settings'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick(); };
  const recv = (obj) => wsBox.ws.dispatch('message', { data: JSON.stringify(obj) });
  const root = () => window.document.documentElement.dataset.theme;
  const on = () => [...window.document.querySelectorAll('#theme-seg button')].filter((b) => b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.themeMode);
  return { window, posts, tick, $, openSettings, recv, root, on, box, themeEvents };
}

test('boot: no matchMedia in jsdom, the server-rendered attribute is normalised and worca:theme fires once', async () => {
  const { window, root, themeEvents } = await boot();
  assert.equal(typeof window.matchMedia, 'undefined', 'jsdom has no matchMedia — boot must not need it');
  assert.equal(root(), 'system');
  assert.deepEqual(themeEvents, ['system']);
});

test('GET paints the segmented control and applies the stored mode', async () => {
  const { $, openSettings, root, on } = await boot({ initialTheme: 'dark' });
  await openSettings();
  assert.ok($('#appearance-card'), 'the card exists');
  assert.equal($('.settings-pane[data-tab="general"] .card'), $('#appearance-card'), 'first card of General');
  assert.equal(root(), 'dark');
  assert.deepEqual(on(), ['dark']);
  assert.equal($('#theme-seg').getAttribute('role'), 'group');
});

test('click Light: applied at once, POST is exactly { theme: "light" }, the response repaints', async () => {
  const { $, posts, tick, openSettings, root, on, themeEvents } = await boot({ initialTheme: 'dark' });
  await openSettings();
  $('#theme-seg button[data-theme-mode="light"]').click();
  assert.equal(root(), 'light', 'optimistic, before the POST resolves');
  await tick(); await tick();
  assert.deepEqual(posts, [{ theme: 'light' }]);
  assert.deepEqual(on(), ['light']);
  assert.equal($('#themeMsg').textContent, '');
  assert.ok(themeEvents.includes('light'));
});

test('a 400 reverts to the server value and lands the message', async () => {
  const { $, tick, openSettings, root, on } = await boot({
    initialTheme: 'dark',
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'theme must be system, light or dark' }) },
  });
  await openSettings();
  $('#theme-seg button[data-theme-mode="light"]').click();
  await tick(); await tick();
  assert.equal(root(), 'dark', 'reverted');
  assert.deepEqual(on(), ['dark']);
  assert.equal($('#themeMsg').textContent, 'theme must be system, light or dark');
  assert.equal($('#themeMsg').className, 'hint err');
});

test('settings-changed from another tab re-fetches and re-applies, on any view', async () => {
  const { tick, recv, root, box, on } = await boot({ initialTheme: 'system' });
  box.theme = 'dark';                             // another tab saved
  recv({ type: 'settings-changed' });
  await tick(); await tick();
  assert.equal(root(), 'dark');
  assert.deepEqual(on(), ['dark']);
});

test('meta theme-color follows the resolved body background, and stays put without one', async () => {
  const a = await boot();
  assert.equal(a.$('meta[name="theme-color"]').getAttribute('content'), '#ffffff', 'jsdom resolves no colour → untouched');
  const b = await boot({ bodyBg: 'rgb(22, 22, 20)' });
  assert.equal(b.$('meta[name="theme-color"]').getAttribute('content'), 'rgb(22, 22, 20)');
});

test('an unknown mode from the server is treated as system', async () => {
  const { openSettings, root, on } = await boot({ initialTheme: 'blue' });
  await openSettings();
  assert.equal(root(), 'system');
  assert.deepEqual(on(), ['system']);
});
