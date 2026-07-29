// test/ui-subagent-no-phantom.test.mjs — a subagent delta must attach to an existing
// run, never create a phantom "(untitled)" card. Two cases: (1) subagent for an
// unknown run is dropped; (2) a non-subagent event for an unknown run still creates
// the card (CLI / other-tab runs must still appear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

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
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, wsInstances };
}

test('a subagent event for an unknown run does NOT create a phantom card', async () => {
  const { window, wsInstances } = await bootLive();
  const ws = wsInstances[0];
  assert.ok(ws, 'app opened a WebSocket');
  ws._fire('message', { data: JSON.stringify({
    type: 'subagent', runId: 'ab12cd34', transition: 'spawn',
    id: 'tool_1', nodeId: 's0_0', status: 'running', ts: 1,
  }) });
  assert.equal(window.__np.getRun('ab12cd34'), undefined,
    'subagent for an unknown run is dropped — no "(untitled)" phantom');
});

test('a phase event for an unknown run STILL creates a card (CLI/other-tab runs)', async () => {
  const { window, wsInstances } = await bootLive();
  const ws = wsInstances[0];
  ws._fire('message', { data: JSON.stringify({
    type: 'phase', runId: 'uuid-OTHER', phase: 'plan', cycle: 0,
  }) });
  assert.ok(window.__np.getRun('uuid-OTHER'),
    'a non-subagent event still materializes the run card (existing behavior preserved)');
});
