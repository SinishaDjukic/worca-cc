// test/ui-settings-debug-spawn.test.mjs
// Settings "Spawn diagnostics" card: GET paints the checkbox, Save posts exactly
// { debugSpawnEnabled }, Reset posts { debugSpawnEnabled: false }, server 400 surfaces.
// Boot copied from test/ui-settings-ask.test.mjs. Fetch-stubbed only — no disk.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, lastToast, edit } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const GET_BODY = (debugSpawnEnabled = false, debugSpawnEffective = { enabled: debugSpawnEnabled, source: 'settings' }) => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, debugSpawnEnabled, debugSpawnEffective,
});

async function boot({ postResponse, initialDebugSpawnEnabled = false, initialEffective } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
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
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(initialDebugSpawnEnabled, initialEffective) });
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

const settle = async (tick, n = 4) => { for (let i = 0; i < n; i++) await tick(); };

// One boot: Save stores true (the response paints it), then Reset clears it.
test('Save posts exactly { debugSpawnEnabled: true } and Reset posts { debugSpawnEnabled: false }, painting back from the response', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  await checkRows([
    { name: 'ui-settings-debug-spawn: Save posts exactly { debugSpawnEnabled: true }', run: async () => {
      assert.equal($('#debugSpawnSave').disabled, true, 'nothing to save on a freshly painted card');
      edit(window, $('#debugSpawnEnabled'), true);
      $('#debugSpawnSave').click();
      await settle(tick);
      assert.equal(posts.length, 1, 'exactly one POST');
      assert.deepEqual(posts[0], { debugSpawnEnabled: true });
      assert.equal($('#debugSpawnSave').textContent, 'Saved');
      assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Saved', detail: 'Applies to the next spawn. No restart needed.', action: '' });
      assert.equal($('#debugSpawnMsg'), null, 'no grey status line');
    } },
    { name: 'ui-settings-debug-spawn: Reset posts { debugSpawnEnabled: false }', run: async () => {
      assert.equal($('#debugSpawnEnabled').checked, true, 'the stored true is painted before Reset');
      $('#debugSpawnReset').click();
      await settle(tick);
      assert.deepEqual(posts.at(-1), { debugSpawnEnabled: false });
      assert.equal($('#debugSpawnReset').textContent, 'Reset');
      assert.equal($('#debugSpawnEnabled').checked, false, 'painted back from the response');
    } },
  ]);
});

test('ui-settings-debug-spawn: a server 400 lands on the field', async () => {
  const { window, $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: '“Spawn diagnostics” must be true or false.', field: 'debugSpawnEnabled' }) },
  });
  await openSettings();
  edit(window, $('#debugSpawnEnabled'), true);
  $('#debugSpawnSave').click();
  await settle(tick);
  assert.equal(fieldErrorText($('#debugSpawnEnabled')), '“Spawn diagnostics” must be true or false.');
});

test('ui-settings-debug-spawn: a 2xx with an unparsable body leaves the checkbox as the user set it', async () => {
  const { window, $, tick, openSettings } = await boot({
    postResponse: { ok: true, status: 200, json: async () => { throw new Error('bad json'); } },
  });
  await openSettings();
  edit(window, $('#debugSpawnEnabled'), true);
  $('#debugSpawnSave').click();
  await settle(tick);
  assert.equal($('#debugSpawnEnabled').checked, true, 'not repainted as unset from an empty body');
  assert.equal($('#debugSpawnSave').textContent, 'Saved');
});
