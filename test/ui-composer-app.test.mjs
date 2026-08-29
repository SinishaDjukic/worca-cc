// test/ui-composer-app.test.mjs — the composer's app.js integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realRegistryIndex } from './helpers/graph-ports.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, metaVersion: 2, fanOut: true, asksQuestions: true,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  // `verdict` is required by V13 for any `when: blocking|clean` output — without
  // it every graph carrying this agent is permanently invalid and Save never enables.
  { key: 'reviewer', displayName: 'Review', domain: 'coding', color: 'blue', order: 4, metaVersion: 2, asksQuestions: true,
    verdict: { filename: 'review-cycle{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const V2_ROW = { id: 'wf_g', name: 'Graph one', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };
const V1_ROW = { id: 'wf_old', name: 'Legacy one', version: 1, domain: 'coding', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] };

async function boot({ agentsFail = false, archived = [] } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  window.fetch = (u) => {
    const url = String(u);
    if (url.includes('/api/agents')) return agentsFail ? Promise.reject(new Error('down')) : json({ agents: AGENTS });
    if (url.includes('/api/workflows?archived=1')) return json({ workflows: archived });
    if (url.includes('/api/workflows')) return json({ workflows: [V2_ROW, V1_ROW] });
    if (url.includes('/api/config')) return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
    return json({ projects: [], runs: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  return window;
}

test('entering the composer mounts once, preloads Task+End and lists saved rows', async () => {
  const win = await boot();
  const doc = win.document;
  assert.ok(doc.querySelector('#gv-canvas .gv-stage'), 'stage mounted');
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'new canvas preloads Task + End');
  assert.equal(doc.querySelector('.gv-empty'), null, 'no empty-state overlay on the canvas');
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="planner"]'), 'palette rendered from /api/agents');
  const rows = [...doc.querySelectorAll('#gv-saved-list .pl-item')];
  assert.equal(rows.length, 2);
  assert.ok(rows[0].querySelector('svg'), 'v2 row carries a thumbnail');
  assert.equal(rows[1].querySelector('.pl-legacy').textContent, 'legacy · runnable until the graph cut-over');
  assert.equal(rows[1].querySelector('.pl-open'), null, 'a v1 row cannot be opened in the v2 composer');
  // re-entry re-fits without re-mounting
  win.location.hash = 'running'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = 'composer'; win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1, 'mounted once');
});

test('an /api/agents failure shows Retry and disables Save; the graph still renders', async () => {
  const win = await boot({ agentsFail: true });
  const doc = win.document;
  assert.match(doc.querySelector('#gv-palette').textContent, /Couldn’t load agents|Couldn't load agents/);
  assert.ok(doc.querySelector('#gv-palette .gv-retry'), 'Retry button');
  assert.equal(doc.querySelector('#gv-save').disabled, true);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'the canvas still renders');
});

test('the Archived footer appears only when the endpoint returns rows', async () => {
  const win = await boot();
  assert.equal(win.document.querySelector('#gv-archived').hidden, true);
  const win2 = await boot({ archived: [{ id: 'wf_dead', name: 'Old', version: 1, archivedAt: '2026-08-26' }] });
  const foot = win2.document.querySelector('#gv-archived');
  assert.equal(foot.hidden, false);
  assert.match(foot.textContent, /Archived \(1\)/);
});

test('leaving the composer calls composerExit: no document listener survives', async () => {
  const win = await boot();
  const doc = win.document;
  win.location.hash = 'running';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const before = doc.querySelectorAll('#gv-canvas .node').length;
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, before, 'Backspace elsewhere never edits the graph');
});

test('v2 workflows produce topo-ordered node rows and loop-wire cycle rows', async () => {
  const win = await boot();
  const np = win.__np;
  const tpl = {
    id: 'wf_g2', name: 'G', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'sonnet' } },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 2 } },
      { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  const reg = { planner: { displayName: 'Plan', color: 'violet', fanOut: true, asksQuestions: true },
    reviewer: { displayName: 'Review', color: 'blue', asksQuestions: true } };
  const rows = np.buildNodeConfigRows(tpl, reg, { nodes: { n_rev: { effort: 'high' } }, wires: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['n_plan', 'n_rev'], 'agent nodes only, topo order, loop wire ignored');
  assert.equal(rows[0].label, 'Plan');
  assert.equal(rows[1].effort, 'high', 'per-project override wins');
  assert.equal(rows[1].model, 'sonnet', 'template node.config is layer 2');
  assert.deepEqual(rows[1].override, { effort: 'high' });
  const fbs = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: { w3: { maxCycles: 5 } } });
  assert.equal(fbs.length, 1, 'one row per LOOP wire');
  assert.equal(fbs[0].fbId, 'w3');
  assert.equal(fbs[0].maxCycles, 5, 'run-config overlay wins over wire.config');
  assert.equal(fbs[0].label, 'Plan ← Review');
  const fbs2 = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: {} });
  assert.equal(fbs2[0].maxCycles, 2, 'falls back to wire.config.maxCycles');
});

test('a v1 workflow still produces v1 rows (no regression)', async () => {
  const win = await boot();
  const np = win.__np;
  const rows = np.buildNodeConfigRows(V1_ROW, { planner: { displayName: 'Plan' } }, { nodes: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nodeId, 's0_0');
  assert.deepEqual(np.buildFeedbackRows(V1_ROW, {}, { feedbacks: {} }), []);
});

// MAJ-21: a flow card inside a loop must be named by the SHARED FLOW_LABEL table
// (the same one the run monitor's manifest uses), never by its raw node id.
test('the loop caption names an OR flow card "OR", never its raw n_or id', async () => {
  const win = await boot();
  const full = SEED_TEMPLATES.find((t) => t.id === 'wf_full');
  const rows = win.__np.buildFeedbackRows(full, realRegistryIndex(), {});
  assert.deepEqual(rows.map((r) => r.label), [
    'Refine Plan \u21ba (self loop)',
    'OR \u2190 Review Implementation',
    'OR \u2190 Manual web UI testing',
  ]);
  assert.equal(rows.some((r) => /n_/.test(r.label)), false, 'no raw node id reaches the caption');
});
