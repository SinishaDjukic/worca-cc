// test/ui-node-model.test.mjs  (NEW)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Harness mirrors test/ui-run-graph.test.mjs bootLive (we only need `window`).
async function bootLive() {
  const wsInstances = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsInstances.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    _fire(type, data) { for (const fn of (this._listeners[type] || [])) fn(data); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

const AGENT = (over) => ({ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', cycles: false, ...over });

test('nodeModelLine: friendly model label + raw effort, matching the New-pipeline caption', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high'] }]);
  assert.equal(window.__np.nodeModelLine(AGENT({ model: 'claude-opus-4-8', effort: 'high' })), 'Opus 4.8 · high');
});

test('nodeModelLine: unset model AND effort -> "default" placeholder', async () => {
  const { window } = await bootLive();
  assert.equal(window.__np.nodeModelLine(AGENT({ model: '', effort: '' })), 'default');
});

test('nodeModelLine: unknown model id falls back to the raw id', async () => {
  const { window } = await bootLive();
  window.__np._setModels([]); // nothing resolvable
  assert.equal(window.__np.nodeModelLine(AGENT({ model: 'opus', effort: 'high' })), 'opus · high');
});

test('nodeModelLine: model set, effort unset -> per-field "default"', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high'] }]);
  assert.equal(window.__np.nodeModelLine(AGENT({ model: 'claude-opus-4-8', effort: '' })), 'Opus 4.8 · default');
});

test('nodeModelLine: model unset, effort set -> "default · <effort>"', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high'] }]);
  assert.equal(window.__np.nodeModelLine(AGENT({ model: '', effort: 'high' })), 'default · high');
});

test('nodeModelLine: bookend node (no uiPhase) -> empty (no sub-line)', async () => {
  const { window } = await bootLive();
  assert.equal(window.__np.nodeModelLine({ id: 'preflight', label: 'Preflight', sub: 'checks' }), '');
});

test('runNode renders the visible .nmodel sub-line and NO title tooltip', async () => {
  const { window } = await bootLive();
  window.__np._setModels([{ id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['high'] }]);
  const el = window.__np.runNode(AGENT({ model: 'claude-opus-4-8', effort: 'high' }), 'pending');
  const line = el.querySelector('.nmeta .nmodel');
  assert.ok(line, '.nmodel sub-line present');
  assert.equal(line.textContent, 'Opus 4.8 · high');
  assert.equal(el.getAttribute('title'), null, 'tooltip removed in favour of the visible line');
  // It sits AFTER the cost/time row, inside .nmeta.
  const kids = [...el.querySelector('.nmeta').children].map((n) => n.className);
  assert.ok(kids.indexOf('nrun') < kids.indexOf('nmodel'), '.nmodel is below .nrun');
});

test('runNode on a bookend renders no .nmodel', async () => {
  const { window } = await bootLive();
  const el = window.__np.runNode({ id: 'done', label: 'Done', sub: 'complete' }, 'pending');
  assert.equal(el.querySelector('.nmodel'), null);
});
