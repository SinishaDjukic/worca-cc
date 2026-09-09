// test/ui-settings-auto-model.test.mjs — the "Auto workflow model" settings card (spec D14 / §7.7).
// Boot preamble copied from test/ui-settings-title-model.test.mjs:32-80 (house convention: duplicated
// per suite); its openSettings awaits three ticks, which the card's own /api/config round-trip needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const CATALOG = [{ id: 'claude-opus-5', label: 'Opus 5' }, { id: 'claude-sonnet-5', label: 'Sonnet 5' }];
const SETTINGS = {
  autoWorkflowModel: '', autoWorkflowModelEffective: { model: 'claude-sonnet-5', source: 'default' },
  app: {}, theme: {}, chat: {},
};

const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function boot({ configOk = true } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const box = { settings: { ...SETTINGS } };
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (u.includes('/api/settings')) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        box.settings = { ...box.settings, ...body };
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
    }
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly', windowStartMs: 0, windowEndMs: 0, msUntilReset: 0, windowSpendUsd: 0, allTimeSpendUsd: 0, remainingUsd: null, blocked: false }) });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (!configOk) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'catalog unreachable' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: CATALOG, efforts: ['medium', 'high'] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const openSettings = async () => {
    window.location.hash = 'settings';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick(); await tick(); await tick();
  };
  const setSettings = (patch) => { box.settings = { ...SETTINGS, ...patch }; };
  return { window, posts, tick, openSettings, setSettings };
}

test('the card sits after Title generation, before About; options come from the catalog; the note names the effective source', async () => {
  const { window, openSettings } = await boot(); await openSettings();
  const ids = [...window.document.querySelectorAll('.view[data-view="settings"] section.card.settings-card')].map((c) => c.id);
  assert.equal(ids[ids.indexOf('title-model-settings-card') + 1], 'auto-model-settings-card');
  assert.equal(ids.at(-1), 'about-card');
  const sel = window.document.getElementById('autoModel');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'claude-opus-5', 'claude-sonnet-5']);
  assert.equal(sel.options[0].textContent, 'Default (Sonnet-class)');
  assert.equal(sel.value, '');
  assert.match(window.document.getElementById('autoModelEnvNote').textContent, /Auto classifies with claude-sonnet-5 \(the default\)/);
});

test('Save posts autoWorkflowModel; env override paints a warning; a stored id that left the catalog paints "not installed"', async () => {
  const { window, openSettings, posts, setSettings } = await boot(); await openSettings();
  const sel = window.document.getElementById('autoModel'); sel.value = 'claude-opus-5';
  window.document.getElementById('autoModelSave').click(); await settle(window);
  assert.deepEqual(posts.at(-1), { autoWorkflowModel: 'claude-opus-5' });
  setSettings({ autoWorkflowModel: 'claude-opus-5', autoWorkflowModelEffective: { model: 'claude-haiku-4-5', source: 'env' } }); await openSettings();
  assert.match(window.document.getElementById('autoModelEnvNote').textContent, /WORCA_AUTO_MODEL is set in the environment: Auto uses claude-haiku-4-5/);
  setSettings({ autoWorkflowModel: 'claude-gone-1', autoWorkflowModelEffective: { model: 'claude-sonnet-5', source: 'default' } }); await openSettings();
  const stale = [...sel.options].find((o) => o.value === 'claude-gone-1');
  assert.ok(stale && stale.disabled && /not installed/.test(stale.textContent));
  assert.match(window.document.getElementById('autoModelEnvNote').textContent, /no longer in the catalog/);
});

// fetchTitleModelCatalog returns [] on any non-OK/throw, so an unreachable catalog looks
// exactly like an empty one. Only the server may condemn a stored id: autoModelState()
// reports source 'settings' when the id actually resolved.
test('a failed catalog GET never becomes a "no longer in the catalog" verdict', async () => {
  const { window, openSettings, setSettings, posts } = await boot({ configOk: false });
  setSettings({ autoWorkflowModel: 'claude-opus-5', autoWorkflowModelEffective: { model: 'claude-opus-5', source: 'settings' } });
  await openSettings();
  const sel = window.document.getElementById('autoModel');
  const opt = [...sel.options].find((o) => o.value === 'claude-opus-5');
  assert.ok(opt && !opt.disabled, 'the stored id stays selectable');
  assert.equal(sel.value, 'claude-opus-5');
  assert.doesNotMatch(window.document.getElementById('autoModelEnvNote').textContent, /no longer in the catalog/);
  assert.equal(window.document.getElementById('autoModelTest').disabled, false, 'Test stays available');
  window.document.getElementById('autoModelSave').click(); await settle(window);
  assert.deepEqual(posts.at(-1), { autoWorkflowModel: 'claude-opus-5' }, 'Save is not refused');
});

// The card's own "back to the default" affordance — nothing pinned the empty POST.
test('Use default posts an empty autoWorkflowModel', async () => {
  const { window, openSettings, posts, setSettings } = await boot();
  setSettings({ autoWorkflowModel: 'claude-opus-5', autoWorkflowModelEffective: { model: 'claude-opus-5', source: 'settings' } });
  await openSettings();
  window.document.getElementById('autoModelReset').click(); await settle(window);
  assert.deepEqual(posts.at(-1), { autoWorkflowModel: '' });
});
