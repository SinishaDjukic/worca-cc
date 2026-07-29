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
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv };
}

test('makeRun seeds an empty r.subAgents array (read via __np.makeRun)', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  assert.ok(Array.isArray(r.subAgents), 'subAgents is an array');
  assert.equal(r.subAgents.length, 0, 'starts empty');
});

test('onSubagent: spawn inserts a running record keyed by id', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, {
    type: 'subagent', runId: 'p1', transition: 'spawn',
    id: 'tool_1', label: 'research auth', nodeId: 's0_0',
    stepKey: '0:s0_0', stepIndex: 0, cycle: 0, status: 'running', ts: 1,
  });
  assert.equal(r.subAgents.length, 1);
  const rec = r.subAgents[0];
  assert.equal(rec.id, 'tool_1');
  assert.equal(rec.status, 'running');
  assert.equal(rec.label, 'research auth');
  assert.equal(rec.nodeId, 's0_0');
  assert.equal(rec.stepKey, '0:s0_0');
});

test('onSubagent: a second spawn for the same id updates in place (no duplicate)', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', label: 'first', nodeId: 's0_0', status: 'running' });
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', label: 'second', nodeId: 's0_0', status: 'running' });
  assert.equal(r.subAgents.length, 1, 'still one record for tool_1');
  assert.equal(r.subAgents[0].label, 'second', 'label updated in place');
});

test('onSubagent: finish updates status + finishedAt + telemetry by id', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', label: 'x', nodeId: 's0_0', status: 'running', ts: 1 });
  ctx.window.__np.onSubagent(r, {
    transition: 'finish', id: 'tool_1', status: 'finished', ts: 2,
    durationMs: 4200, tokens: 1500, costUsd: 0.02,
  });
  assert.equal(r.subAgents.length, 1, 'finish does not add a row');
  const rec = r.subAgents[0];
  assert.equal(rec.status, 'finished');
  assert.equal(rec.durationMs, 4200);
  assert.equal(rec.tokens, 1500);
  assert.equal(rec.costUsd, 0.02);
  assert.ok(rec.finishedAt != null, 'finishedAt stamped');
  assert.equal(rec.label, 'x', 'spawn label preserved when finish omits it');
});

test('onSubagent: a finish for an unknown id inserts a terminal record', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, { transition: 'finish', id: 'late_1', status: 'error', nodeId: 's1_0', ts: 9 });
  assert.equal(r.subAgents.length, 1);
  assert.equal(r.subAgents[0].id, 'late_1');
  assert.equal(r.subAgents[0].status, 'error');
});

test('switch routes a subagent frame through onSubagent onto the live run model', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  ctx.recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 }); // mounts the card + run model
  ctx.recv({
    type: 'subagent', runId: 'p1', transition: 'spawn',
    id: 'tool_1', label: 'sub one', nodeId: 's0_0', stepKey: '0:s0_0',
    stepIndex: 0, cycle: 0, status: 'running', ts: 1,
  });
  await new Promise((r) => setTimeout(r, 0));
  const r = ctx.window.__np.getRun('p1');
  assert.ok(r, 'run model exists');
  assert.equal(r.subAgents.length, 1, 'subagent frame reached the model via the switch');
  assert.equal(r.subAgents[0].id, 'tool_1');
});

test('onState replaces r.subAgents from an authoritative snapshot (covers late-join)', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  // A stale delta-built record that the snapshot should overwrite wholesale.
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'stale', nodeId: 's0_0', status: 'running' });
  ctx.window.__np.onState(r, {
    type: 'state', status: 'running',
    subAgents: [
      { id: 'tool_1', label: 'a', nodeId: 's0_0', stepKey: '0:s0_0', stepIndex: 0, cycle: 0, status: 'finished' },
      { id: 'tool_2', label: 'b', nodeId: 's0_0', stepKey: '0:s0_0', stepIndex: 0, cycle: 0, status: 'running' },
    ],
  });
  assert.equal(r.subAgents.length, 2, 'snapshot is authoritative — stale record dropped');
  assert.deepEqual(r.subAgents.map((s) => s.id), ['tool_1', 'tool_2']);
});

test('onState without a subAgents field leaves the delta-built array intact', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', nodeId: 's0_0', status: 'running' });
  ctx.window.__np.onState(r, { type: 'state', status: 'running' }); // legacy/partial snapshot
  assert.equal(r.subAgents.length, 1, 'no subAgents key → keep what deltas built');
  assert.equal(r.subAgents[0].id, 'tool_1');
});

test('onState with an empty subAgents array clears stale deltas (truthy [])', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'stale', nodeId: 's0_0', status: 'running' });
  ctx.window.__np.onState(r, { type: 'state', status: 'running', subAgents: [] });
  assert.equal(r.subAgents.length, 0, 'empty snapshot is authoritative — stale delta cleared');
});

test('a state frame with subAgents reconciles the live run model (end-to-end)', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  ctx.recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });
  ctx.recv({
    type: 'state', runId: 'p1', status: 'running',
    subAgents: [{ id: 'tool_1', label: 'x', nodeId: 's0_0', stepKey: '0:s0_0', stepIndex: 0, cycle: 0, status: 'running' }],
  });
  await new Promise((r) => setTimeout(r, 0));
  const r = ctx.window.__np.getRun('p1');
  assert.equal(r.subAgents.length, 1);
  assert.equal(r.subAgents[0].id, 'tool_1');
});

test('subAgentsOf returns only a given node\'s sub-agents', async () => {
  const { window } = await boot();
  const r = window.__np.makeRun({ runId: 'p1' });
  r.subAgents = [
    { id: 'a', nodeId: 's0_0', status: 'running' },
    { id: 'b', nodeId: 's0_0', status: 'finished' },
    { id: 'c', nodeId: 's1_0', status: 'running' },
  ];
  assert.deepEqual(window.__np.subAgentsOf(r, 's0_0').map((s) => s.id), ['a', 'b']);
  assert.deepEqual(window.__np.subAgentsOf(r, 's1_0').map((s) => s.id), ['c']);
  assert.deepEqual(window.__np.subAgentsOf(r, 'nope'), [], 'unknown node → empty');
});

test('subsByNode groups by nodeId with spawned + active counts', async () => {
  const { window } = await boot();
  const m = window.__np.subsByNode([
    { id: 'a', nodeId: 's0_0', status: 'running' },
    { id: 'b', nodeId: 's0_0', status: 'finished' },
    { id: 'c', nodeId: 's0_0', status: 'running' },
    { id: 'd', nodeId: 's1_0', status: 'finished' },
  ]);
  assert.ok(m instanceof Map);
  assert.equal(m.get('s0_0').spawned, 3);
  assert.equal(m.get('s0_0').active, 2, 'two running under s0_0');
  assert.deepEqual(m.get('s0_0').subs.map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(m.get('s1_0').spawned, 1);
  assert.equal(m.get('s1_0').active, 0);
});

test('subsByNode tolerates an empty/undefined list and skips records with no nodeId', async () => {
  const { window } = await boot();
  assert.equal(window.__np.subsByNode([]).size, 0);
  assert.equal(window.__np.subsByNode(undefined).size, 0);
  const m = window.__np.subsByNode([{ id: 'x', status: 'running' }]); // no nodeId
  assert.equal(m.size, 0, 'a record with no nodeId is not grouped');
});
