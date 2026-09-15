// test/ui-settings-title-model.test.mjs
// Settings "Title generation" card (#422): a SELECT over the project-less
// catalog with the New Pipeline optgroups, "Same as the run's model" as the
// empty default, a stale stored id painted disabled + "not installed" with a
// warn hint, the env-override note, Save/Use default posting exactly
// { titleModel }, and Test hitting POST /api/models/:id/test. Boot copied from
// test/ui-settings-debug-spawn.test.mjs. Fetch-stubbed only — no disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const CATALOG = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high'], custom: false, hasEnv: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false, hasEnv: false },
  { id: 'corp-model', label: 'Corp', efforts: ['high'], custom: 'global', hasEnv: true },
  { id: 'plug-model', label: 'Plug', efforts: ['high'], custom: 'plugin', plugin: 'vendor', hasEnv: true },
  { id: 'legacy-model', label: 'Legacy', efforts: ['high'], custom: 'project', hasEnv: false },
];

const GET_BODY = ({ titleModel = null, titleModelEffective = { model: null, source: 'run', stale: null } } = {}) => ({
  root: '/w', projectsRoot: '/p', projectsRootDefault: '/p', default: {}, chat: {},
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, debugSpawnEnabled: false, debugSpawnEffective: { enabled: false, source: 'settings' },
  titleModel, titleModelEffective, hideBuiltinModels: false,
});

async function boot({ initial = {}, catalog = CATALOG, postResponse, testResponse } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const tests = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/settings')) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        return Promise.resolve(postResponse || {
          ok: true, status: 200,
          json: async () => GET_BODY({
            titleModel: body.titleModel || null,
            titleModelEffective: body.titleModel ? { model: body.titleModel, source: 'settings', stale: null } : { model: null, source: 'run', stale: null },
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => GET_BODY(initial) });
    }
    if (/\/api\/models\/[^/]+\/test$/.test(u) && method === 'POST') {
      tests.push(decodeURIComponent(u.match(/\/api\/models\/([^/]+)\/test$/)[1]));
      return Promise.resolve(testResponse || { ok: true, status: 200, json: async () => ({ ok: true, text: 'OK' }) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: 0, msUntilReset: 0, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: null, blocked: false }) });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: catalog, efforts: ['medium', 'high'] }) });
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
    await tick(); await tick(); await tick();
  };
  return { window, posts, tests, tick, $, openSettings };
}

const optionsOf = ($) => [...$('#titleModel').options].map((o) => ({ value: o.value, text: o.textContent, group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null, disabled: o.disabled }));

test('ui-settings-title-model: default paints "Same as the run\'s model" selected + the three optgroups, legacy project models excluded', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  const sel = $('#titleModel');
  assert.ok(sel, 'card rendered');
  assert.equal(sel.value, '');
  const opts = optionsOf($);
  assert.deepEqual(opts[0], { value: '', text: "Same as the run's model", group: null, disabled: false });
  assert.deepEqual(opts.filter((o) => o.group).map((o) => [o.group, o.value]), [
    ['Your models', 'corp-model'], ['From plugins', 'plug-model'], ['Built-in', 'claude-haiku-4-5'], ['Built-in', 'claude-opus-5'],
  ]);
  assert.equal(opts.find((o) => o.value === 'plug-model').text, 'Plug (vendor)', 'plugin provenance suffix');
  assert.ok(!opts.some((o) => o.value === 'legacy-model'), 'legacy per-project models are not global');
  assert.equal($('#titleModelTest').disabled, true, 'nothing to test on the default');
  assert.equal($('#titleModelEnvNote').textContent, '');
});

test('ui-settings-title-model: a stored id is selected; hidden built-ins leave the list unless stored', async () => {
  const catalog = CATALOG.map((m) => (m.custom === false ? { ...m, hidden: true } : m));
  const { $, openSettings } = await boot({ initial: { titleModel: 'claude-opus-5', titleModelEffective: { model: 'claude-opus-5', source: 'settings', stale: null } }, catalog });
  await openSettings();
  assert.equal($('#titleModel').value, 'claude-opus-5');
  const opts = optionsOf($);
  assert.ok(opts.some((o) => o.value === 'claude-opus-5' && o.group === 'Built-in'), 'the stored built-in stays');
  assert.ok(!opts.some((o) => o.value === 'claude-haiku-4-5'), 'other hidden built-ins are gone');
  assert.equal($('#titleModelTest').disabled, false);
});

test('ui-settings-title-model: a stale stored id paints disabled + "not installed" and a warn hint; Save refuses it', async () => {
  const { $, posts, openSettings, tick } = await boot({ initial: { titleModel: 'gone-model', titleModelEffective: { model: null, source: 'run', stale: 'gone-model' } } });
  await openSettings();
  const sel = $('#titleModel');
  assert.equal(sel.value, 'gone-model');
  const o = optionsOf($).find((x) => x.value === 'gone-model');
  assert.deepEqual(o, { value: 'gone-model', text: 'gone-model — not installed', group: null, disabled: true });
  assert.match($('#titleModelEnvNote').textContent, /"gone-model" is no longer in the catalog — titles fall back to the run's model/);
  assert.ok($('#titleModelEnvNote').className.includes('warn'));
  assert.equal($('#titleModelTest').disabled, true);
  $('#titleModelSave').click();
  await tick();
  assert.equal(posts.length, 0, 'a not-installed id is never posted');
  assert.match($('#titleModelMsg').textContent, /no longer installed/);
});

test('ui-settings-title-model: env override note', async () => {
  const { $, openSettings } = await boot({ initial: { titleModel: 'corp-model', titleModelEffective: { model: 'env-model', source: 'env', stale: null } } });
  await openSettings();
  assert.match($('#titleModelEnvNote').textContent, /WORCA_TITLE_MODEL is set in the environment: titles use env-model regardless/);
});

test('ui-settings-title-model: Save posts exactly { titleModel }, Use default posts { titleModel: "" }, and the card repaints', async () => {
  const { $, posts, openSettings, tick } = await boot();
  await openSettings();
  $('#titleModel').value = 'corp-model';
  $('#titleModel').dispatchEvent(new (globalThis.window.Event)('change'));
  assert.equal($('#titleModelTest').disabled, false, 'Test enables on a real pick');
  $('#titleModelSave').click();
  await tick(); await tick(); await tick();
  assert.deepEqual(posts, [{ titleModel: 'corp-model' }]);
  assert.equal($('#titleModel').value, 'corp-model');
  assert.match($('#titleModelMsg').textContent, /Saved\. Applies to the next title/);
  $('#titleModelReset').click();
  await tick(); await tick(); await tick();
  assert.deepEqual(posts[1], { titleModel: '' });
  assert.equal($('#titleModel').value, '');
});

test('ui-settings-title-model: a 400 from the server surfaces in the hint', async () => {
  const { $, openSettings, tick } = await boot({ postResponse: { ok: false, status: 400, json: async () => ({ error: 'unknown model "corp-model" — pick one from the catalog' }) } });
  await openSettings();
  $('#titleModel').value = 'corp-model';
  $('#titleModelSave').click();
  await tick(); await tick();
  assert.match($('#titleModelMsg').textContent, /unknown model "corp-model"/);
  assert.ok($('#titleModelMsg').className.includes('err'));
});

test('ui-settings-title-model: Test posts to /api/models/:id/test and paints the reply / the hint', async () => {
  const ok = await boot({ initial: { titleModel: 'corp-model', titleModelEffective: { model: 'corp-model', source: 'settings', stale: null } } });
  await ok.openSettings();
  ok.$('#titleModelTest').click();
  await ok.tick(); await ok.tick();
  assert.deepEqual(ok.tests, ['corp-model']);
  assert.match(ok.$('#titleModelMsg').textContent, /✓ corp-model replied: OK/);
  assert.equal(ok.$('#titleModelTest').disabled, false, 're-enabled after the call');

  const bad = await boot({
    initial: { titleModel: 'corp-model', titleModelEffective: { model: 'corp-model', source: 'settings', stale: null } },
    testResponse: { ok: true, status: 200, json: async () => ({ ok: false, errorClass: 'auth', message: 'x', hint: 'authentication failed — check the token/secret for this model' }) },
  });
  await bad.openSettings();
  bad.$('#titleModelTest').click();
  await bad.tick(); await bad.tick();
  assert.match(bad.$('#titleModelMsg').textContent, /✗ authentication failed/);
  assert.ok(bad.$('#titleModelMsg').className.includes('err'));
});
