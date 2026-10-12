// test/ui-settings-budget.test.mjs
// Settings "Budget & cost limits" card: the GET paint, the exact save POST body,
// client-side validation, server error surfacing, and Clear limits. Boots the
// REAL app.js against the REAL index.html under jsdom (harness from
// test/ui-settings.test.mjs; budget fixture from test/ui-budget-indicator.test.mjs).
// Everything is a fetch stub — nothing touches disk, so this suite deliberately
// does NOT sandbox HOME/WORCA_HOME.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fieldErrorText, cardAlertOf, edit } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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

test('settings paints the budget card from GET', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  assert.equal($('#budgetPerPipeline').value, '');
  assert.equal($('#budgetPerPipeline').placeholder, 'No limit');
  assert.equal($('#budgetTotal').value, '50');
  assert.equal($('#budgetResetPeriod').value, 'weekly');
  assert.match($('#budgetReadout').textContent, /Spent \$41\.23 of \$50\.00/);
});

test('save posts exactly the three keys; Saved on the button; readout refresh', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  assert.equal($('#budgetSave').disabled, true, 'a freshly painted card has nothing to save');
  edit(window, $('#budgetPerPipeline'), '25');
  edit(window, $('#budgetTotal'), '50');
  edit(window, $('#budgetResetPeriod'), 'weekly');
  posts.length = 0;
  $('#budgetSave').click();
  await settle(tick);
  assert.equal(posts.length, 1, 'exactly one POST');
  assert.deepEqual(posts[0],
    { pipelineCostLimitUsd: 25, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly', humanRateUsdPerHour: null, resumeAfterUsageLimit: false });
  assert.equal($('#budgetSave').textContent, 'Saved');
  assert.ok($('#budgetSave').classList.contains('is-done'));
  assert.equal($('#budgetMsg').textContent, '', 'the old status line is no longer written');
  // refreshBudget() re-ran, so the readout is still live after the save.
  assert.match($('#budgetReadout').textContent, /Spent \$41\.23 of \$50\.00/);
  assert.equal($('#budgetReset').disabled, false, 'Reset is never locked');
  assert.equal($('#budget-settings-card .dirty-mark').hidden, true, 'saved: the card is clean');
});

test('client validation: 0.001 -> no POST + an error on each bad field', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  edit(window, $('#budgetTotal'), '0.001');
  edit(window, $('#budgetHumanRate'), '0');
  posts.length = 0;
  $('#budgetSave').click();
  await tick();
  assert.equal(posts.length, 0, 'sub-cent limit never reaches the server');
  assert.equal(fieldErrorText($('#budgetTotal')), 'Enter at least $0.01, or leave it blank.');
  assert.equal(fieldErrorText($('#budgetHumanRate')), 'Enter at least $0.01, or leave it blank.');
  assert.equal(fieldErrorText($('#budgetPerPipeline')), '', 'a good field is not flagged');
  assert.equal($('#budgetTotal').getAttribute('aria-invalid'), 'true');
  assert.equal(window.document.activeElement, $('#budgetTotal'), 'focus on the first bad field');
});

// Each response boots its own page (cuts the count, not the time).
test('a server 400 naming a field lands verbatim on it (Save re-enabled); a field-less error is a card alert', async () => {
  await checkRows([
    { name: 'server 400 error text lands verbatim on the field it names', run: async () => {
      const { window, $, tick, openSettings } = await boot({
        onPost: () => Promise.resolve({
          ok: false, status: 400,
          json: async () => ({ error: '“Limit for all runs” must be a positive number of USD.', field: 'totalCostLimitUsd' }),
        }),
      });
      await openSettings();
      edit(window, $('#budgetTotal'), '60');
      $('#budgetSave').click();
      await settle(tick);
      assert.equal(fieldErrorText($('#budgetTotal')), '“Limit for all runs” must be a positive number of USD.');
      assert.equal($('#budgetSave').disabled, false, 'still dirty: Save re-enabled after a rejection');
    } },
    { name: 'a server error with no field is a card alert', run: async () => {
      const { window, $, tick, openSettings } = await boot({
        onPost: () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Settings were not saved: EACCES.' }) }),
      });
      await openSettings();
      edit(window, $('#budgetTotal'), '60');
      $('#budgetSave').click();
      await settle(tick);
      assert.deepEqual(cardAlertOf($('#budget-settings-card')), { title: 'Not saved', detail: 'Settings were not saved: EACCES.' });
    } },
  ]);
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

test('Save posts the developer rate; Clear limits leaves it alone', async () => {
  const { window, $, posts, tick, openSettings } = await boot();
  await openSettings();
  edit(window, $('#budgetHumanRate'), '95');
  posts.length = 0;
  $('#budgetSave').click();
  await settle(tick);
  assert.equal(posts[0].humanRateUsdPerHour, 95);
  posts.length = 0;
  $('#budgetReset').click();
  await tick();
  assert.deepEqual(Object.keys(posts[0]).sort(), ['pipelineCostLimitUsd', 'totalCostLimitUsd']);
});

test('#555 Clear limits: Save waits while it is pending, and the emptied card is dirty after a failure', async () => {
  let answer;
  const { $, posts, tick, openSettings } = await boot({
    onPost: () => new Promise((r) => { answer = r; }),
  });
  await openSettings();
  await settle(tick);
  assert.equal($('#budgetTotal').value, '50', 'a stored limit to clear');
  assert.equal($('#budgetSave').disabled, true);
  $('#budgetReset').click();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal($('#budgetReset').textContent, 'Resetting…');
  assert.equal($('#budgetSave').disabled, true, 'Save waits while Clear limits is busy');
  answer({ ok: false, status: 500, json: async () => ({ error: 'Settings were not saved: EACCES.' }) });
  await settle(tick);
  assert.equal($('#budgetTotal').value, '', 'the emptied inputs stay as they are');
  assert.equal($('#budgetSave').disabled, false, 'the card differs from what is stored: Save is offered');
  assert.equal($('#budget-settings-card .dirty-mark').hidden, false);
  assert.equal($('#budgetReset').disabled, false);
});
