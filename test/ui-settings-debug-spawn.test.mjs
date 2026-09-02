// test/ui-settings-debug-spawn.test.mjs
// Settings "Spawn diagnostics" card: GET paints the checkbox, Save posts exactly
// { debugSpawnEnabled }, Reset posts { debugSpawnEnabled: false }, server 400 surfaces.
// Boot copied from test/ui-settings-ask.test.mjs. Fetch-stubbed only — no disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const GET_BODY = (debugSpawnEnabled = false) => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, debugSpawnEnabled,
});

async function boot({ postResponse, initialDebugSpawnEnabled = false } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/settings')) {
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        return Promise.resolve(postResponse
          || { ok: true, status: 200, json: async () => GET_BODY(body.debugSpawnEnabled) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(initialDebugSpawnEnabled) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: 0, msUntilReset: 0, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: null, blocked: false }) });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => window.document.querySelector(sel);
  const openSettings = async () => {
    window.location.hash = 'settings';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, posts, tick, $, openSettings };
}

test('ui-settings-debug-spawn: GET paints the checkbox unchecked by default', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#debugSpawnEnabled').checked, false);
});

test('ui-settings-debug-spawn: GET paints a stored true value as checked', async () => {
  const { $, openSettings } = await boot({ initialDebugSpawnEnabled: true });
  await openSettings();
  assert.equal($('#debugSpawnEnabled').checked, true);
});

test('ui-settings-debug-spawn: Save posts exactly { debugSpawnEnabled: true }', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#debugSpawnEnabled').checked = true;
  $('#debugSpawnSave').click();
  await tick();
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0], { debugSpawnEnabled: true });
  assert.match($('#debugSpawnMsg').textContent, /Saved/);
});

test('ui-settings-debug-spawn: Reset posts { debugSpawnEnabled: false }', async () => {
  const { $, posts, tick, openSettings } = await boot({ initialDebugSpawnEnabled: true });
  await openSettings();
  $('#debugSpawnReset').click();
  await tick();
  assert.deepEqual(posts[0], { debugSpawnEnabled: false });
  assert.equal($('#debugSpawnEnabled').checked, false, 'painted back from the response');
});

test('ui-settings-debug-spawn: a server 400 lands verbatim', async () => {
  const { $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'debugSpawnEnabled must be true or false' }) },
  });
  await openSettings();
  $('#debugSpawnSave').click();
  await tick();
  assert.equal($('#debugSpawnMsg').textContent, 'debugSpawnEnabled must be true or false');
});
