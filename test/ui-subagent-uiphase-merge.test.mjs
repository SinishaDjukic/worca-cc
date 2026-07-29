// test/ui-subagent-uiphase-merge.test.mjs — onSubagent merges the uiPhase field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('onSubagent merges uiPhase from a spawn delta', async () => {
  const { window } = await boot();
  const r = window.__np.makeRun({ runId: 'p1' });
  window.__np.onSubagent(r, { transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', status: 'running' });
  assert.equal(r.subAgents[0].uiPhase, 'plan');
});

test('a finish delta that omits uiPhase preserves the spawn-time value', async () => {
  const { window } = await boot();
  const r = window.__np.makeRun({ runId: 'p1' });
  window.__np.onSubagent(r, { transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', status: 'running' });
  window.__np.onSubagent(r, { transition: 'finish', id: 't1', status: 'finished' });
  assert.equal(r.subAgents[0].uiPhase, 'plan', 'merge only defined fields → uiPhase retained');
});
