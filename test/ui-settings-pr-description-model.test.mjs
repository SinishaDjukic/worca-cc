// test/ui-settings-pr-description-model.test.mjs — the "PR description model" settings card:
// which model drafts the "Ship it?" modal's Generate with AI description. Mirrors the Auto
// workflow model card (test/ui-settings-auto-model.test.mjs); boot preamble copied from there
// (house convention: duplicated per suite).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, edit } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const CATALOG = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-sonnet-5', label: 'Sonnet 5' }];
const SETTINGS = {
  autoWorkflowModel: '', autoWorkflowModelEffective: { model: 'claude-sonnet-5', source: 'default' },
  prDescriptionModel: '', prDescriptionModelEffective: { model: 'claude-sonnet-5', source: 'default' },
  app: {}, theme: {}, chat: {},
};

const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function boot({ configOk = true } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  const calls = [];
  const box = { settings: { ...SETTINGS } };
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: u, method });
    if (u.includes('/api/settings')) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        box.settings = { ...box.settings, ...body };
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...box.settings }) });
    }
    if (/\/api\/models\/[^/]+\/test$/.test(u))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, text: 'pong' }) });
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
  return { window, posts, calls, tick, openSettings, setSettings };
}

test('the PR description model card (Models page, after Auto, expert) lists the catalog with Default first; Use default posts an empty prDescriptionModel; Test sends one tiny prompt to the picked model', async () => {
  const { window, openSettings, posts, calls, setSettings } = await boot(); await openSettings();
  await checkRows([
    { name: 'the card sits after the Auto workflow model on the Models page; options come from the catalog; the note names the effective model', run: async () => {
      const ids = [...window.document.querySelectorAll('.view[data-view="models"] section.card.settings-card')].map((c) => c.id);
      assert.equal(ids[ids.indexOf('auto-model-settings-card') + 1], 'pr-description-model-settings-card');
      const card = window.document.getElementById('pr-description-model-settings-card');
      assert.equal(card.closest('[data-view]').dataset.view, 'models');
      assert.equal(card.dataset.minLevel, 'expert', 'an expert card, like its siblings');
      const sel = window.document.getElementById('prDescModel');
      assert.deepEqual([...sel.options].map((o) => o.value), ['', 'claude-opus-5-5', 'claude-sonnet-5']);
      assert.equal(sel.options[0].textContent, 'Default (Sonnet-class)');
      assert.equal(sel.value, '');
      assert.match(window.document.getElementById('prDescModelNote').textContent, /PR descriptions are written with claude-sonnet-5 \(the default\)/);
    } },
    { name: 'Use default posts an empty prDescriptionModel; Test sends one tiny prompt to the picked model', run: async () => {
      setSettings({ prDescriptionModel: 'claude-opus-5-5', prDescriptionModelEffective: { model: 'claude-opus-5-5', source: 'settings' } });
      await openSettings();
      window.document.getElementById('prDescModelTest').click(); await settle(window);
      assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/models/claude-opus-5-5/test')));
      assert.equal(window.document.getElementById('prDescModelMsg').textContent, 'claude-opus-5-5 replied: pong');
      assert.equal(window.document.getElementById('prDescModelMsg').className, 'hint ok');
      assert.equal(window.document.getElementById('prDescModelTest').textContent, 'Works');
      window.document.getElementById('prDescModelReset').click(); await settle(window);
      assert.deepEqual(posts.at(-1), { prDescriptionModel: '' });
    } },
  ]);
});

test('Save posts prDescriptionModel; a stored id paints its own line; one that left the catalog paints "not installed"', async () => {
  const { window, openSettings, posts, setSettings } = await boot(); await openSettings();
  const sel = window.document.getElementById('prDescModel');
  edit(window, sel, 'claude-opus-5-5');
  window.document.getElementById('prDescModelSave').click(); await settle(window);
  assert.deepEqual(posts.at(-1), { prDescriptionModel: 'claude-opus-5-5' });
  assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Saved', detail: 'Applies to the next Generate with AI.', action: '' });
  assert.equal(window.document.getElementById('prDescModelMsg').textContent, '', 'no grey "Saved." line');
  setSettings({ prDescriptionModel: 'claude-opus-5-5', prDescriptionModelEffective: { model: 'claude-opus-5-5', source: 'settings' } }); await openSettings();
  assert.equal(sel.value, 'claude-opus-5-5');
  assert.match(window.document.getElementById('prDescModelNote').textContent, /PR descriptions are written with claude-opus-5-5\.$/);
  setSettings({ prDescriptionModel: 'claude-gone-1', prDescriptionModelEffective: { model: 'claude-sonnet-5', source: 'default' } }); await openSettings();
  const stale = [...sel.options].find((o) => o.value === 'claude-gone-1');
  assert.ok(stale && stale.disabled && /not installed/.test(stale.textContent));
  assert.match(window.document.getElementById('prDescModelNote').textContent, /no longer in the catalog/);
  // Save is still showing "Saved" from the first save; a click on its clean card is ignored.
  window.document.getElementById('prDescModelSave').click(); await settle(window);
  assert.equal(posts.length, 1, 'a stale pick is never posted');
});

test('a failed catalog GET never becomes a "no longer in the catalog" verdict', async () => {
  const { window, openSettings, setSettings } = await boot({ configOk: false });
  setSettings({ prDescriptionModel: 'claude-opus-5-5', prDescriptionModelEffective: { model: 'claude-opus-5-5', source: 'settings' } });
  await openSettings();
  const sel = window.document.getElementById('prDescModel');
  const opt = [...sel.options].find((o) => o.value === 'claude-opus-5-5');
  assert.ok(opt && !opt.disabled, 'the stored id stays selectable');
  assert.doesNotMatch(window.document.getElementById('prDescModelNote').textContent, /no longer in the catalog/);
  assert.equal(window.document.getElementById('prDescModelTest').disabled, false, 'Test stays available');
});
