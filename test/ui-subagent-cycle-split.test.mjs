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
  // A FROZEN v1 manifest (the only kind that still carries uiPhase). There is no
  // built-in legacy default any more: manifestFor(null) is an EMPTY manifest.
  const v1 = { version: 1, feedbacks: [], steps: [
    { kind: 'agents', nodes: [{ id: 'refine', uiPhase: 'refine', label: 'Refine' }] },
  ] };
  const label = window.__np.cycleAwareLabel(v1, subs);
  assert.equal(label(`s1_0${SEP}1`), 'Refine', 'resolved via uiPhase against the frozen manifest');
  assert.equal(window.__np.cycleAwareLabel(null, subs)(`s1_0${SEP}1`), 's1_0',
    'with no manifest at all there is nothing to resolve against');
});


// ── P6b: groups keyed by executionId on v2 records; v1 keys byte-identical ──

const V2 = { version: 2, template: { id: 'w', name: 'W' }, graph: { nodes: [
  { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } },
  { id: 'n_or', kind: 'or', key: null, label: 'OR', x: 0, y: 0, ports: { inputs: [], outputs: [], await: false } }], wires: [] } };

test('subsByNodeCycleArrays keys by the execution id (executionId, or a v2 x: stepKey), so task slices never merge', async () => {
  const { window } = await boot();
  const g = window.__np.subsByNodeCycleArrays([
    { id: 'a', nodeId: 'n_impl', cycle: 2, executionId: 'x:n_impl:2:p1t3', status: 'finished' },
    { id: 'b', nodeId: 'n_impl', cycle: 2, executionId: 'x:n_impl:2:p1t4', status: 'running' },
    { id: 'c', nodeId: 'n_impl', cycle: 2, status: 'finished' },
    // What the harness actually emits on v2: stepKey === executionId, no executionId field.
    { id: 'd', nodeId: 'n_impl', cycle: 2, stepKey: 'x:n_impl:2', status: 'finished' },
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['n_impl|2', 'n_impl|x:n_impl:2', 'n_impl|x:n_impl:2:p1t3', 'n_impl|x:n_impl:2:p1t4']);
});

test('v1 records keep byte-identical keys: a v1 stepKey must NOT re-key a group', async () => {
  const { window } = await boot();
  const g = window.__np.subsByNodeCycleArrays([
    { id: 'a', nodeId: 's0_0', stepKey: '0:s0_0', cycle: 1, status: 'finished' },
    { id: 'b', nodeId: 's0_0', stepKey: '0:s0_0#2', cycle: 2, status: 'finished' },
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['s0_0|1', 's0_0|2']);
  const label = window.__np.cycleAwareLabel(STEPPER, [], ['s0_0|1', 's0_0|2']);
  assert.equal(label('s0_0|2'), 'Plan · cycle 2', 'the cycle suffix still parses');
});

test('step rows key by executionId ONLY (never by key): v1 rows keep nodeId|cycle, v2 rows get nodeId|executionId', async () => {
  const { window } = await boot();
  const { stepSkillsFromSteps, stepGraphifyFromSteps, stepStatusByKey } = window.__np;
  const steps = [
    { key: '1:s1_0', nodeId: 's1_0', cycle: 1, status: 'done', skills: ['a'], graphifyCount: 2 },
    { key: 'x:n_impl:1:p1t2', executionId: 'x:n_impl:1:p1t2', nodeId: 'n_impl', cycle: 1, status: 'start', skills: ['b'], graphifyCount: 1 },
  ];
  assert.deepEqual(Object.keys(stepSkillsFromSteps(steps)), ['s1_0|1', 'n_impl|x:n_impl:1:p1t2']);
  assert.deepEqual(Object.keys(stepGraphifyFromSteps(steps)), ['s1_0|1', 'n_impl|x:n_impl:1:p1t2']);
  assert.deepEqual(stepStatusByKey(steps, V2), { 'n_impl|x:n_impl:1:p1t2': 'run' });
});

test('onStepSkills / onStepGraphify key their deltas like the snapshot maps (stepKey rides the event, never executionId)', async () => {
  const { window } = await boot();
  const np = window.__np;
  const r = np.makeRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'running' });
  np.onStepSkills(r, { stepKey: 'x:n_impl:1:p1t2', nodeId: 'n_impl', cycle: 1, skills: ['skill:graphify'] });
  np.onStepSkills(r, { stepKey: '1:s1_0', nodeId: 's1_0', cycle: 1, skills: ['mcp:x'] });
  np.onStepGraphify(r, { stepKey: 'x:n_impl:1:p1t2', nodeId: 'n_impl', cycle: 1, graphifyCount: 3 });
  np.onStepGraphify(r, { stepKey: '1:s1_0', nodeId: 's1_0', cycle: 1, graphifyCount: 1 });
  assert.deepEqual(Object.keys(r.stepSkills), ['n_impl|x:n_impl:1:p1t2', 's1_0|1']);
  assert.deepEqual(Object.keys(r.stepGraphify), ['n_impl|x:n_impl:1:p1t2', 's1_0|1']);
});

test('cycleAwareLabel names a v2 group from the ledger: label #ordinal, plus the slice title', async () => {
  const { window } = await boot();
  const steps = [
    { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', status: 'done' },
    { key: 'x:n_impl:1:p1t3', executionId: 'x:n_impl:1:p1t3', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: 'Add schema', status: 'done' },
    { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, kind: 'cycle', status: 'done' },
  ];
  const keys = ['n_impl|x:n_impl:1', 'n_impl|x:n_impl:1:p1t3', 'n_impl|x:n_impl:2'];
  const label = window.__np.cycleAwareLabel(V2, [], keys, steps);
  assert.equal(label('n_impl|x:n_impl:1'), 'Implementer #1');
  assert.equal(label('n_impl|x:n_impl:1:p1t3'), 'Implementer #1 · Add schema');
  assert.equal(label('n_impl|x:n_impl:2'), 'Implementer #2');
  assert.equal(label('n_impl|x:n_impl:9'), 'Implementer', 'a group with no ledger row falls back to the plain label');
});

test('subsGroupsForRender on a v2 manifest lists agent nodes only (P6a seam: agentNodeIdSet reads graph.nodes)', async () => {
  const { window } = await boot();
  const groups = window.__np.subsGroupsForRender([], [
    { key: 'x:n_or:1', executionId: 'x:n_or:1', nodeId: 'n_or', cycle: 1, status: 'done' },
    { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', cycle: 1, status: 'done' },
  ], V2);
  assert.deepEqual(Object.keys(groups), ['n_impl|x:n_impl:1']);
});
