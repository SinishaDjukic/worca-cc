// test/ui-graphify-count-pill.test.mjs — per-sub-agent + per-group graphify-use count
// badge. Present only when count > 0. bootLive() copied from ui-subagent-type-pill.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('graphifyCountPillHtml: count badge when > 0, empty string otherwise', async () => {
  const { window } = await bootLive();
  const { graphifyCountPillHtml } = window.__np;
  assert.equal(graphifyCountPillHtml(3), '<span class="graphify-pill">graphify ×3</span>');
  assert.equal(graphifyCountPillHtml(1), '<span class="graphify-pill">graphify ×1</span>');
  assert.equal(graphifyCountPillHtml(0), '');
  assert.equal(graphifyCountPillHtml(null), '');
  assert.equal(graphifyCountPillHtml(undefined), '');
});

test('onSubagent merges graphifyCount onto the run record', async () => {
  const { window } = await bootLive();
  const { makeRun, onSubagent } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', graphifyCount: 2 });
  assert.equal(r.subAgents.find((s) => s.id === 'a1').graphifyCount, 2);
});

test('onStepGraphify records the MAIN-agent count by nodeId|cycle group key', async () => {
  const { window } = await bootLive();
  const { makeRun, onStepGraphify } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onStepGraphify(r, { nodeId: 'n1', cycle: 1, graphifyCount: 5 });
  assert.equal(r.stepGraphify['n1|1'], 5);
});

test('stepGraphifyFromSteps derives {groupKey: count}, skipping steps with no graphify', async () => {
  const { window } = await bootLive();
  const { stepGraphifyFromSteps } = window.__np;
  const map = stepGraphifyFromSteps([
    { nodeId: 'n1', cycle: 1, graphifyCount: 3 },
    { nodeId: 'n2', cycle: 1, graphifyCount: 0 },
    { nodeId: 'n3', cycle: 1 },
  ]);
  assert.deepEqual(map, { 'n1|1': 3 });
});
