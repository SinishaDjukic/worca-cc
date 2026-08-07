// test/ui-settings-budget.test.mjs
// Settings "Budget & cost limits" card: the GET paint, the exact save POST body,
// client-side validation, server error surfacing, and Clear limits. Boots the
// REAL app.js against the REAL index.html under jsdom (harness from
// test/ui-settings.test.mjs; budget fixture from test/ui-budget-indicator.test.mjs).
// Everything is a fetch stub — nothing touches disk, so this suite deliberately
// does NOT sandbox HOME/WORCA_HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const DAY = 86400000;

// $41.23 of a $50 weekly cap — the /api/budget snapshot the readout renders.
const okBudget = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'weekly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 41.23, allTimeSpendUsd: 41.23,
  remainingUsd: 8.77, blocked: false,
});

// GET /api/settings: no per-pipeline limit, a $50 total, weekly reset.
const okSettings = () => ({
  root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me',
  pipelineCostLimitUsd: null, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly',
});

async function boot({ onPost } = {}) {
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
        // Default: echo the merged state back, exactly as the real route does.
        return (onPost && onPost(body))
          || Promise.resolve({ ok: true, status: 200, json: async () => ({ ...okSettings(), ...body }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => okSettings() });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => okBudget() });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
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

test('settings paints the budget card from GET', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#budgetPerPipeline').value, '');
  assert.equal($('#budgetPerPipeline').placeholder, 'No limit');
  assert.equal($('#budgetTotal').value, '50');
  assert.equal($('#budgetResetPeriod').value, 'weekly');
  assert.match($('#budgetReadout').textContent, /Spent \$41\.23 of \$50\.00/);
});

test('save posts exactly the three keys; success message; readout refresh', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#budgetPerPipeline').value = '25';
  $('#budgetTotal').value = '50';
  $('#budgetResetPeriod').value = 'weekly';
  posts.length = 0;
  $('#budgetSave').click();
  await tick();
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0],
    { pipelineCostLimitUsd: 25, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly' });
  assert.match($('#budgetMsg').textContent, /Saved/);
  // refreshBudget() re-ran, so the readout is still live after the save.
  assert.match($('#budgetReadout').textContent, /Spent \$41\.23 of \$50\.00/);
  assert.equal($('#budgetSave').disabled, false, 'buttons re-enabled');
  assert.equal($('#budgetReset').disabled, false);
});

test('client validation: 0.001 -> no POST + error message', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#budgetTotal').value = '0.001';
  posts.length = 0;
  $('#budgetSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-cent limit never reaches the server');
  assert.match($('#budgetMsg').textContent, /at least \$0\.01/);
  assert.ok($('#budgetMsg').classList.contains('err'), 'message is styled as an error');
});

test('server 400 error text lands verbatim in #budgetMsg', async () => {
  const { $, tick, openSettings } = await boot({
    onPost: () => Promise.resolve({
      ok: false, status: 400,
      json: async () => ({ error: 'totalCostLimitUsd must be a positive number of USD' }),
    }),
  });
  await openSettings();
  $('#budgetTotal').value = '50';
  $('#budgetSave').click();
  await tick();
  assert.match($('#budgetMsg').textContent, /positive number of USD/);
  assert.equal($('#budgetSave').disabled, false, 'buttons re-enabled after a rejection');
});

test('Clear limits posts nulls for both limits and leaves the period untouched', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  posts.length = 0;
  $('#budgetReset').click();
  await tick();
  assert.deepEqual(posts[0], { pipelineCostLimitUsd: null, totalCostLimitUsd: null });
  assert.equal($('#budgetPerPipeline').value, '');
  assert.equal($('#budgetTotal').value, '');
});
