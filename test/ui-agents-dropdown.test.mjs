// test/ui-agents-dropdown.test.mjs — the "Sub-agents" dropdown is renamed to
// "Agents" and now lists EVERY main agent that ran (incl. graphify/skill-only and
// zero-sub agents), each with its header pills and a muted "No sub-agents spawned"
// placeholder when it spawned none. Boots app.js under JSDOM and drives the
// test-only internals on window.__np. boot() copied from ui-subagent-views.test.mjs.
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

// Manifest used by the unit + integration tests. clarify/plan/review are kind:'agents';
// preflight/done are bookends that MUST be excluded from the dropdown.
const STEPPER = { version: 1, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
  { kind: 'agents', nodes: [{ id: 'clarify', uiPhase: 'clarify', label: 'Clarify' }] },
  { kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan' }] },
  { kind: 'agents', nodes: [{ id: 'review', uiPhase: 'review', label: 'Review', cycles: true }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
], feedbacks: [] };

test('subsGroupsForRender lists every agent step (∪ sub groups), [] when no subs, skips preflight/done', async () => {
  const { window } = await boot();
  const { subsGroupsForRender } = window.__np;
  const subAgents = [
    { id: 'a1', nodeId: 'plan', cycle: 0, label: 'research', status: 'finished' },
  ];
  const steps = [
    { key: 'preflight', nodeId: 'preflight', cycle: 0, status: 'done' }, // excluded (not kind:'agents')
    { key: 'clarify', nodeId: 'clarify', cycle: 0, status: 'done' },     // ran, NO subs
    { key: 'plan', nodeId: 'plan', cycle: 0, status: 'done' },           // ran, HAS subs
    { key: 'review#1', nodeId: 'review', cycle: 1, status: 'start' },    // ran, NO subs
    { key: 'done', nodeId: 'done', cycle: 0, status: 'done' },           // excluded
  ];
  const groups = subsGroupsForRender(subAgents, steps, STEPPER);
  assert.deepEqual(Object.keys(groups), ['clarify|0', 'plan|0', 'review|1'], 'agent steps only, in step order');
  assert.equal(groups['clarify|0'].length, 0, 'no-sub agent -> empty array');
  assert.deepEqual(groups['plan|0'].map((s) => s.id), ['a1'], 'sub-bearing agent keeps its rows');
  assert.equal(groups['review|1'].length, 0);
});

test('subsGroupsForRender appends a sub-group with no matching step (defensive)', async () => {
  const { window } = await boot();
  const { subsGroupsForRender } = window.__np;
  const groups = subsGroupsForRender(
    [{ id: 'x', nodeId: 'ghost', cycle: 0, status: 'finished' }],
    [{ key: 'plan', nodeId: 'plan', cycle: 0, status: 'done' }],
    STEPPER,
  );
  assert.deepEqual(Object.keys(groups), ['plan|0', 'ghost|0'], 'step groups first, stray sub group appended');
  assert.equal(groups['ghost|0'].length, 1);
});

test('stepStatusByKey maps agent step status -> group status (skips non-agents)', async () => {
  const { window } = await boot();
  const { stepStatusByKey } = window.__np;
  const map = stepStatusByKey([
    { key: 'preflight', nodeId: 'preflight', cycle: 0, status: 'start' }, // excluded
    { key: 'clarify', nodeId: 'clarify', cycle: 0, status: 'done' },
    { key: 'review#1', nodeId: 'review', cycle: 1, status: 'start' },
    { key: 'plan', nodeId: 'plan', cycle: 0, status: 'error' },           // halt -> 'stop'
  ], STEPPER);
  assert.deepEqual(map, { 'clarify|0': 'done', 'review|1': 'run', 'plan|0': 'stop' });
});

test('cycleAwareLabel adds "· cycle N" across rendered group keys (even sub-less cycles)', async () => {
  const { window } = await boot();
  const { cycleAwareLabel } = window.__np;
  // review ran cycles 1 and 2; only cycle 2 spawned a sub. Suffix must still appear for both.
  const subAgents = [{ id: 'r2', nodeId: 'review', cycle: 2, status: 'finished' }];
  const keys = ['review|1', 'review|2'];
  const label = cycleAwareLabel(STEPPER, subAgents, keys);
  assert.equal(label('review|1'), 'Review · cycle 1');
  assert.equal(label('review|2'), 'Review · cycle 2');
  // Legacy 2-arg call (no keys) keeps sub-derived behavior: single sub cycle -> no suffix.
  assert.equal(cycleAwareLabel(STEPPER, subAgents)('review|2'), 'Review');
});

