// test/ui-subagent-cycle-split.test.mjs — dropdown groups split per cycle.
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
  window.WebSocket = class { constructor() { this.readyState = 1; this._listeners = {}; } send() {} close() {} addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); } };
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

const SEP = '|';
const STEPPER = { version: 1, steps: [
  { kind: 'agents', nodes: [{ id: 's0_0', uiPhase: 'plan', label: 'Plan' }] },
  // cycles:true here is decorative — the suffix is decided by cyclesPerNode(records), not this flag.
  { kind: 'agents', nodes: [{ id: 's1_0', uiPhase: 'refine', label: 'Refine Plan', cycles: true }] },
], feedbacks: [] };

test('subsByNodeCycleArrays splits a node\'s subs by cycle', async () => {
  const { window } = await boot();
  const g = window.__np.subsByNodeCycleArrays([
    { id: 'a', nodeId: 's1_0', cycle: 1, status: 'finished' },
    { id: 'b', nodeId: 's1_0', cycle: 2, status: 'running' },
    { id: 'c', nodeId: 's1_0', cycle: 1, status: 'finished' },
  ]);
  const keys = Object.keys(g);
  assert.equal(keys.length, 2, 'two cycle groups for s1_0');
  assert.deepEqual(keys.map((k) => g[k].length).sort(), [1, 2], 'two subs in cycle 1, one in cycle 2');
});

test('cycleAwareLabel adds "· cycle N" only for multi-cycle nodes', async () => {
  const { window } = await boot();
  const subs = [
    { id: 'p', nodeId: 's0_0', uiPhase: 'plan', cycle: 1, status: 'finished' },
    { id: 'r0', nodeId: 's1_0', uiPhase: 'refine', cycle: 1, status: 'finished' },
    { id: 'r1', nodeId: 's1_0', uiPhase: 'refine', cycle: 2, status: 'running' },
  ];
  const label = window.__np.cycleAwareLabel(STEPPER, subs);
  assert.equal(label(`s0_0${SEP}1`), 'Plan', 'single-cycle node → no suffix');
  assert.equal(label(`s1_0${SEP}1`), 'Refine Plan · cycle 1');
  assert.equal(label(`s1_0${SEP}2`), 'Refine Plan · cycle 2');
});

test('cycleAwareLabel falls back to uiPhase when the stepper lacks the nodeId', async () => {
  const { window } = await boot();
  const subs = [{ id: 'x', nodeId: 's1_0', uiPhase: 'refine', cycle: 1, status: 'running' }];
  const label = window.__np.cycleAwareLabel(null, subs); // null → legacy default manifest
  assert.equal(label(`s1_0${SEP}1`), 'Refine', 'resolved via uiPhase against the legacy default label');
});

test('renderSubsTree renders one step per cycle group with cycle-suffixed headers', async () => {
  const { window } = await boot();
  const panel = window.document.createElement('div');
  panel.className = 'subs-panel';
  const subs = [
    { id: 'r0', nodeId: 's1_0', uiPhase: 'refine', cycle: 1, label: 'a', status: 'finished' },
    { id: 'r1', nodeId: 's1_0', uiPhase: 'refine', cycle: 2, label: 'b', status: 'running' },
  ];
  window.__np.renderSubsTree(panel, window.__np.subsByNodeCycleArrays(subs), window.__np.cycleAwareLabel(STEPPER, subs));
  const heads = [...panel.querySelectorAll('.subs-step-head b')].map((b) => b.textContent);
  assert.deepEqual(heads, ['Refine Plan · cycle 1', 'Refine Plan · cycle 2']);
});
