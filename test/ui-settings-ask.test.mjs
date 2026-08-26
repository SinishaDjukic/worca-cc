// test/ui-settings-ask.test.mjs
// Settings "Ask Worca" card: the GET paint, the exact save POST body (the two
// ask keys ALONE — never with root/budget), client-side validation, the server
// error surfacing, the No-cap checkbox (stored null = no cap) and Use defaults
// (the '' clear-to-default wire value). Boots the REAL app.js against the REAL
// index.html under jsdom (boot copied from test/ui-settings-budget.test.mjs:33-71,
// with its `onPost` hook replaced by a `postResponse` override).
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

// GET /api/settings: the ask keys at their defaults, no budget limits.
const GET_BODY = () => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2,
});

// The server's storage semantics: '' clears to the default, null stays null
// ("no cap"), anything else is stored as posted.
const resolveAsk = (body) => {
  const out = {};
  if ('askMaxTurns' in body) out.askMaxTurns = body.askMaxTurns === '' ? 40 : body.askMaxTurns;
  if ('askMaxBudgetUsd' in body) out.askMaxBudgetUsd = body.askMaxBudgetUsd === '' ? 2 : body.askMaxBudgetUsd;
  return out;
};

async function boot({ postResponse } = {}) {
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
          || { ok: true, status: 200, json: async () => ({ ...GET_BODY(), ...resolveAsk(body) }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY() });
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

test('ui-settings-ask: GET paints the card (defaults, no-cap unchecked)', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#askMaxTurns').value, '40');
  assert.equal($('#askMaxBudgetUsd').value, '2');
  assert.equal($('#askNoCap').checked, false);
  assert.equal($('#askMaxBudgetUsd').disabled, false);
});

test('ui-settings-ask: Save posts exactly the two ask keys', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '55';
  $('#askMaxBudgetUsd').value = '3.5';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0], { askMaxTurns: 55, askMaxBudgetUsd: 3.5 });
  assert.match($('#askLimitsMsg').textContent, /Saved/);
});

test('ui-settings-ask: client validation short-circuits the POST', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askMaxTurns').value = '0';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'out-of-range turns never reaches the server');
  assert.ok($('#askLimitsMsg').classList.contains('err'));
  $('#askMaxTurns').value = '40';
  $('#askMaxBudgetUsd').value = '0.05';
  $('#askLimitsSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-floor budget rejected too');
});

test('ui-settings-ask: a server 400 lands verbatim', async () => {
  const { $, tick, openSettings } = await boot({
    postResponse: { ok: false, status: 400, json: async () => ({ error: 'askMaxTurns must be an integer between 1 and 500' }) },
  });
  await openSettings();
  $('#askMaxTurns').value = '77';
  $('#askLimitsSave').click();
  await tick();
  assert.equal($('#askLimitsMsg').textContent, 'askMaxTurns must be an integer between 1 and 500');
});

test('ui-settings-ask: the No-cap checkbox disables the field and posts null', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askNoCap').checked = true;
  $('#askNoCap').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal($('#askMaxBudgetUsd').disabled, true);
  $('#askLimitsSave').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: 40, askMaxBudgetUsd: null });
});

test('ui-settings-ask: Use defaults posts empty strings (the clear-to-default wire value)', async () => {
  const { $, posts, tick, openSettings } = await boot();
  await openSettings();
  $('#askLimitsReset').click();
  await tick();
  assert.deepEqual(posts[0], { askMaxTurns: '', askMaxBudgetUsd: '' });
  assert.equal($('#askMaxTurns').value, '40', 'painted back from the response defaults');
});
