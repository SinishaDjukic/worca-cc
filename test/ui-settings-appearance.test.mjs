// test/ui-settings-appearance.test.mjs — Settings › General › Appearance (dark-mode
// design §5.3/§5.5): GET paints the segmented control and <html data-theme>, a
// click applies at once and POSTs exactly { theme }, a 400 reverts to the server
// value and shows the error, settings-changed re-applies, and boot needs no
// matchMedia.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const GET_BODY = (theme = 'system', screensaver = { enabled: false, idleMinutes: 5 }) => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, debugSpawnEnabled: false, debugSpawnEffective: { enabled: false, source: 'settings' },
  titleModel: null, titleModelEffective: {}, hideBuiltinModels: false, theme, screensaver,
});

async function boot({ postResponse, initialTheme = 'system', initialScreensaver = { enabled: false, idleMinutes: 5 } } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const box = { theme: initialTheme, screensaver: { ...initialScreensaver } };
  const posts = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/settings')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        if (postResponse) return Promise.resolve(postResponse);
        if ('theme' in body) box.theme = body.theme;
        if ('screensaver' in body) box.screensaver = { ...box.screensaver, ...body.screensaver };
        return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(box.theme, box.screensaver) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(box.theme, box.screensaver) });
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

test('GET paints the segmented control and applies the stored mode; an unknown mode from the server is treated as system', async () => {
  // Each row boots with its own stored mode.
  await checkRows([
    { name: 'GET paints the segmented control and applies the stored mode', run: async () => {
      const { $, openSettings, root, on } = await boot({ initialTheme: 'dark' });
      await openSettings();
      assert.ok($('#appearance-card'), 'the card exists');
      assert.equal($('.settings-pane[data-tab="general"] .card'), $('#setup-assistant-card'), 'Setup assistant is the first card of General');
      assert.equal($('#setup-assistant-card').nextElementSibling, $('#appearance-card'), 'Appearance comes right after it');
      assert.equal(root(), 'dark');
      assert.deepEqual(on(), ['dark']);
      assert.equal($('#theme-seg').getAttribute('role'), 'group');
    } },
    { name: 'an unknown mode from the server is treated as system', run: async () => {
      const { openSettings, root, on } = await boot({ initialTheme: 'blue' });
      await openSettings();
      assert.equal(root(), 'system');
      assert.deepEqual(on(), ['system']);
    } },
  ]);
});

test('click Light: applied at once, POST is exactly { theme: "light" }, the response repaints', async () => {
  const { window, $, posts, tick, openSettings, root, on, themeEvents } = await boot({ initialTheme: 'dark' });
  await openSettings();
  $('#theme-seg button[data-theme-mode="light"]').click();
  assert.equal(root(), 'light', 'optimistic, before the POST resolves');
  await tick(); await tick();
  assert.deepEqual(posts, [{ theme: 'light' }]);
  assert.deepEqual(on(), ['light']);
  assert.equal(lastToast(window.document), null, 'a saved theme raises no toast');
  assert.ok(themeEvents.includes('light'));
});

test('a 400 reverts to the server value and raises an error toast', async () => {
  const { window, $, tick, openSettings, root, on } = await boot({
    initialTheme: 'dark',
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'theme must be system, light or dark' }) },
  });
  await openSettings();
  $('#theme-seg button[data-theme-mode="light"]').click();
  await tick(); await tick();
  assert.equal(root(), 'dark', 'reverted');
  assert.deepEqual(on(), ['dark']);
  assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Theme not saved', detail: 'theme must be system, light or dark', action: '' });
  assert.equal($('#themeMsg'), null, 'no grey status line');
});

test('settings-changed from another tab re-fetches and re-applies, on any view', async () => {
  const { tick, recv, root, box, on } = await boot({ initialTheme: 'system' });
  box.theme = 'dark';                             // another tab saved
  recv({ type: 'settings-changed' });
  await tick(); await tick();
  assert.equal(root(), 'dark');
  assert.deepEqual(on(), ['dark']);
});

const SS_HELP = 'When the Worca window is untouched, the wordmark drifts across it with how your runs and chats are doing. Any key or mouse move brings the page back.';

test('Screensaver: off by default, Start after hidden', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  const row = $('#screensaverOn').closest('.drow');
  assert.equal(row.closest('#appearance-card').querySelector('.drows'), row.parentElement, 'inside the Appearance rows');
  assert.equal(row.previousElementSibling.querySelector('#theme-seg') !== null, true, 'right after Theme');
  assert.equal(row.querySelector('.drow-label').textContent, 'Screensaver');
  assert.equal($('#screensaverHint').textContent, SS_HELP);
  assert.equal($('#screensaverOn').getAttribute('role'), 'switch');
  assert.equal($('#screensaverOn').checked, false);
  assert.equal($('#screensaverAfterRow').hidden, true);
  const sel = $('#screensaverAfter');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]),
    [['5', '5 min'], ['10', '10 min'], ['15', '15 min'], ['20', '20 min'], ['25', '25 min'], ['30', '30 min']]);
  assert.equal(sel.value, '5');
  assert.equal(sel.className, 'select select-sm select-fit');
  assert.equal($('label[for="screensaverAfter"]').textContent, 'Start after');
});

test('turning it on POSTs {screensaver:{enabled:true}} and shows Start after', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#screensaverOn').click();
  assert.equal($('#screensaverAfterRow').hidden, false, 'optimistic, before the POST resolves');
  await tick(); await tick();
  assert.deepEqual(posts, [{ screensaver: { enabled: true } }]);
  assert.equal($('#screensaverOn').checked, true);
  assert.equal($('#screensaverAfterRow').hidden, false);
  assert.equal(lastToast(window.document), null);
});

test('choosing 15 min POSTs { screensaver: { idleMinutes: 15 } }', async () => {
  const { window, $, posts, tick, openSettings } = await boot({ initialScreensaver: { enabled: true, idleMinutes: 5 } });
  await openSettings();
  assert.equal($('#screensaverAfterRow').hidden, false);
  const sel = $('#screensaverAfter');
  sel.value = '15';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.deepEqual(posts, [{ screensaver: { idleMinutes: 15 } }]);
  assert.equal(typeof posts[0].screensaver.idleMinutes, 'number');
  assert.equal(sel.value, '15');
});

test('a 400 on the switch reverts it and toasts', async () => {
  const { window, $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: '“Screensaver” must be true or false.', field: 'screensaver.enabled' }) },
  });
  await openSettings();
  $('#screensaverOn').click();
  await tick(); await tick(); await tick();
  assert.equal($('#screensaverOn').checked, false, 'reverted');
  assert.equal($('#screensaverAfterRow').hidden, true);
  assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Screensaver not saved', detail: '“Screensaver” must be true or false.', action: '' });
});

test('settings-changed repaints the Screensaver row', async () => {
  const { $, tick, recv, box, openSettings } = await boot();
  await openSettings();
  box.screensaver = { enabled: true, idleMinutes: 20 };   // another browser saved
  recv({ type: 'settings-changed' });
  await tick(); await tick();
  assert.equal($('#screensaverOn').checked, true);
  assert.equal($('#screensaverAfterRow').hidden, false);
  assert.equal($('#screensaverAfter').value, '20');
});

test('boot applies the saved screensaver setting to the screensaver', async () => {
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    for (const enabled of [true, false]) {
      const { $, tick } = await boot({ initialScreensaver: { enabled, idleMinutes: 5 } });
      await tick(); await tick();
      skew += 5 * 60_000;
      await new Promise((r) => setTimeout(r, 1100));   // the app's 1 s timer ticks the screensaver
      assert.equal($('.ss') !== null, enabled, `enabled ${enabled}`);
    }
  } finally { Date.now = realNow; }
});
