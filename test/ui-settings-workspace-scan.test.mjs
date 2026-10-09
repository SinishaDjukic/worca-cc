// test/ui-settings-workspace-scan.test.mjs — Settings › Runs › Workspaces (the scan models card).
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

const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
];
const DEFAULTS = { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' };
const SETTINGS = {
  autoWorkflowModel: '', autoWorkflowModelEffective: { model: 'claude-sonnet-5', source: 'default' },
  workspaceScan: null, workspaceScanDefault: DEFAULTS,
  app: {}, theme: {}, chat: {},
};

const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function boot({ configOk = true } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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

const vals = (doc) => ['wsScanModel', 'wsScanEffort', 'wsAgentModel', 'wsAgentEffort'].map((id) => doc.getElementById(id).value);

test('the Workspaces card (Runs tab) shows the defaults; Save posts the four picks, Use default posts null, a scan model change repaints its efforts', async () => {
  const { window, openSettings, posts, tick } = await boot(); await openSettings();
  const doc = window.document;
  await checkRows([
    { name: 'the Workspaces card sits on the Runs tab between Scheduled runs and Chat notifications and shows the defaults', run: async () => {
      const runsIds = [...doc.querySelectorAll('.settings-pane[data-tab="runs"] section.card.settings-card')].map((c) => c.id);
      assert.deepEqual(runsIds, ['budget-settings-card', 'night-settings-card', 'sync-settings-card', 'schedule-settings-card', 'actions-settings-card', 'ws-scan-models-card', 'chat-settings-card']);
      assert.equal(doc.querySelector('#ws-scan-models-card h2').textContent.trim(), 'Workspaces');
      assert.equal(doc.getElementById('ws-scan-models-card').dataset.minLevel, 'advanced');
      assert.deepEqual(vals(doc), ['claude-sonnet-5', 'medium', 'sonnet', 'medium']);
    } },
    { name: 'Save posts the four picks; Use default posts null; changing the scan model repaints its efforts', run: async () => {
      assert.equal(doc.getElementById('wsScanModelsSave').disabled, true, 'Save starts disabled');
      edit(window, doc.getElementById('wsScanModel'), 'claude-opus-5-5');
      edit(window, doc.getElementById('wsScanEffort'), 'xhigh');
      edit(window, doc.getElementById('wsAgentModel'), 'fable');
      edit(window, doc.getElementById('wsAgentEffort'), 'high');
      doc.getElementById('wsScanModelsSave').click(); await tick(); await tick();
      assert.deepEqual(posts.at(-1), { workspaceScan: { scanModel: 'claude-opus-5-5', scanEffort: 'xhigh', agentModel: 'fable', agentEffort: 'high' } });
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Saved', detail: 'Applies to the next scan.', action: '' });
      doc.getElementById('wsScanModelsReset').click(); await tick(); await tick();
      assert.deepEqual(posts.at(-1), { workspaceScan: null });
    } },
  ]);
});

test('a stored scan model that left the catalog is shown as not installed and Save refuses it', async () => {
  const { window, openSettings, posts, setSettings, tick } = await boot();
  setSettings({ workspaceScan: { ...DEFAULTS, scanModel: 'gone-model' } }); await openSettings();
  const doc = window.document;
  const sel = doc.getElementById('wsScanModel');
  assert.equal(sel.value, 'gone-model');
  assert.equal(sel.options[sel.selectedIndex].disabled, true);
  assert.match(doc.getElementById('wsScanModelsNote').textContent, /no longer in the catalog/);
  const before = posts.length;
  assert.equal(doc.getElementById('wsScanModelsSave').disabled, true, 'the painted card is clean');
  doc.getElementById('wsScanModelsSave').click(); await tick();
  assert.equal(posts.length, before, 'nothing posted');
  assert.equal(doc.getElementById('wsScanModelsMsg'), null, 'no save line');
});
