// test/ui-graphify-count-pill.test.mjs — per-sub-agent + per-group graphify-use count
// bookkeeping. bootLive() copied from the former ui-subagent-type-pill suite (its tests
// now live in ui-subagent-state.test.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive() {
  const wsInstances = [];
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
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

test('graphify counts: onSubagent merges graphifyCount, onStepGraphify records by nodeId|cycle, stepGraphifyFromSteps derives the map', async () => {
  const { window } = await bootLive();
  const { makeRun, onSubagent, onStepGraphify, stepGraphifyFromSteps } = window.__np;
  await checkRows([
    { name: 'onSubagent merges graphifyCount onto the run record', run: () => {
      const r = makeRun({ runId: 'run1' });
      onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', graphifyCount: 2 });
      assert.equal(r.subAgents.find((s) => s.id === 'a1').graphifyCount, 2);
    } },
    { name: 'onStepGraphify records the MAIN-agent count by nodeId|cycle group key', run: () => {
      const r = makeRun({ runId: 'run1' });
      onStepGraphify(r, { nodeId: 'n1', cycle: 1, graphifyCount: 5 });
      assert.equal(r.stepGraphify['n1|1'], 5);
    } },
    { name: 'stepGraphifyFromSteps derives {groupKey: count}, skipping steps with no graphify', run: () => {
      const map = stepGraphifyFromSteps([
        { nodeId: 'n1', cycle: 1, graphifyCount: 3 },
        { nodeId: 'n2', cycle: 1, graphifyCount: 0 },
        { nodeId: 'n3', cycle: 1 },
      ]);
      assert.deepEqual(map, { 'n1|1': 3 });
    } },
  ]);
});
