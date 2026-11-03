// test/ui-subagent-state.test.mjs — the sub-agent run model and its views. Also the home
// of the former ui-subagent-log, -no-phantom, -tree, -type-pill, -uiphase-merge and
// -views suites (suite reduction 2026-10-04): one shared boot harness, a WebSocket stub
// that captures its instance, and recv() to inject frames.
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

async function boot({ projects = [{ name: 'proj', path: PROJECT, exists: true }] } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv, ws: lastWs };
}

test('onSubagent: spawn inserts a running record by id, a repeat spawn updates in place, finish updates status/finishedAt/telemetry, a finish for an unknown id inserts a terminal record', async () => {
  const ctx = await boot();
  await checkRows([
    { name: 'onSubagent: spawn inserts a running record keyed by id', run: async () => {
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
    } },
    { name: 'onSubagent: a second spawn for the same id updates in place (no duplicate)', run: async () => {
      const r = ctx.window.__np.makeRun({ runId: 'p1' });
      ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', label: 'first', nodeId: 's0_0', status: 'running' });
      ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', label: 'second', nodeId: 's0_0', status: 'running' });
      assert.equal(r.subAgents.length, 1, 'still one record for tool_1');
      assert.equal(r.subAgents[0].label, 'second', 'label updated in place');
    } },
    { name: 'onSubagent: finish updates status + finishedAt + telemetry by id', run: async () => {
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
    } },
    { name: 'onSubagent: a finish for an unknown id inserts a terminal record', run: async () => {
      const r = ctx.window.__np.makeRun({ runId: 'p1' });
      ctx.window.__np.onSubagent(r, { transition: 'finish', id: 'late_1', status: 'error', nodeId: 's1_0', ts: 9 });
      assert.equal(r.subAgents.length, 1);
      assert.equal(r.subAgents[0].id, 'late_1');
      assert.equal(r.subAgents[0].status, 'error');
    } },
  ]);
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

test('onState and r.subAgents: a snapshot replaces the array (late join), an absent field leaves deltas intact, an empty array clears stale deltas', async () => {
  const ctx = await boot();
  await checkRows([
    { name: 'onState replaces r.subAgents from an authoritative snapshot (covers late-join)', run: async () => {
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
    } },
    { name: 'onState without a subAgents field leaves the delta-built array intact', run: async () => {
      const r = ctx.window.__np.makeRun({ runId: 'p1' });
      ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'tool_1', nodeId: 's0_0', status: 'running' });
      ctx.window.__np.onState(r, { type: 'state', status: 'running' }); // legacy/partial snapshot
      assert.equal(r.subAgents.length, 1, 'no subAgents key → keep what deltas built');
      assert.equal(r.subAgents[0].id, 'tool_1');
    } },
    { name: 'onState with an empty subAgents array clears stale deltas (truthy [])', run: async () => {
      const r = ctx.window.__np.makeRun({ runId: 'p1' });
      ctx.window.__np.onSubagent(r, { transition: 'spawn', id: 'stale', nodeId: 's0_0', status: 'running' });
      ctx.window.__np.onState(r, { type: 'state', status: 'running', subAgents: [] });
      assert.equal(r.subAgents.length, 0, 'empty snapshot is authoritative — stale delta cleared');
    } },
  ]);
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

test('subAgentsOf / subsByNode: per-node filtering, grouping with spawned + active counts, tolerance of empty lists and records without nodeId', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'subAgentsOf returns only a given node\'s sub-agents', run: async () => {
      const r = window.__np.makeRun({ runId: 'p1' });
      r.subAgents = [
        { id: 'a', nodeId: 's0_0', status: 'running' },
        { id: 'b', nodeId: 's0_0', status: 'finished' },
        { id: 'c', nodeId: 's1_0', status: 'running' },
      ];
      assert.deepEqual(window.__np.subAgentsOf(r, 's0_0').map((s) => s.id), ['a', 'b']);
      assert.deepEqual(window.__np.subAgentsOf(r, 's1_0').map((s) => s.id), ['c']);
      assert.deepEqual(window.__np.subAgentsOf(r, 'nope'), [], 'unknown node → empty');
    } },
    { name: 'subsByNode groups by nodeId with spawned + active counts', run: async () => {
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
    } },
    { name: 'subsByNode tolerates an empty/undefined list and skips records with no nodeId', run: async () => {
      assert.equal(window.__np.subsByNode([]).size, 0);
      assert.equal(window.__np.subsByNode(undefined).size, 0);
      const m = window.__np.subsByNode([{ id: 'x', status: 'running' }]); // no nodeId
      assert.equal(m.size, 0, 'a record with no nodeId is not grouped');
    } },
  ]);
});

// ── from the former ui-subagent-log suite: end-to-end round-trip of the `sub` flag
// (WS frame → record → DOM .log-line.sub-agent).
test('a log frame with sub:true renders a .log-line.sub-agent; a main line does not', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.recv({ type: 'run-created', runId: 'p1', title: 't', projectDir: PROJECT, status: 'running', kind: 'run', startedAt: '10:00:00' });
  ctx.recv({ type: 'state', runId: 'p1', id: 'p1', status: 'running', steps: [] });
  await new Promise((r) => setTimeout(r, 0));
  // The Running list card carries no log; the line lands in the run page's Live log tab.
  ctx.window.location.hash = 'running/p1/details/logs';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const card = ctx.window.document.querySelector('#run-detail .rd-sec-logs');
  assert.ok(card, 'the run page has its Live log tab');
  ctx.recv({ type: 'log', runId: 'p1', source: 'planner ▸ research auth', level: 'info', text: 'hi', sub: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(card.querySelector('.log-line.sub-agent'), 'sub-agent line is styled');
  ctx.recv({ type: 'log', runId: 'p1', source: 'planner', level: 'info', text: 'main', sub: false });
  await new Promise((r) => setTimeout(r, 0));
  const plain = [...card.querySelectorAll('.log-line')].find((n) => n.textContent.includes('main'));
  assert.ok(!plain.classList.contains('sub-agent'), 'main line is not styled');
});

// ── from the former ui-subagent-no-phantom suite: a subagent delta must attach to an
// existing run, never create a phantom "(untitled)" card, while a non-subagent event for
// an unknown run still creates the card (CLI / other-tab runs must still appear).
test('an unknown run gets no phantom card from a subagent event, but a phase event still creates it (CLI/other-tab runs)', async () => {
  const { window, recv, ws } = await boot({ projects: [] });
  assert.ok(ws, 'app opened a WebSocket');
  await checkRows([
    { name: 'a subagent event for an unknown run does NOT create a phantom card', run: async () => {
      recv({
        type: 'subagent', runId: 'ab12cd34', transition: 'spawn',
        id: 'tool_1', nodeId: 's0_0', status: 'running', ts: 1,
      });
      assert.equal(window.__np.getRun('ab12cd34'), undefined,
        'subagent for an unknown run is dropped — no "(untitled)" phantom');
    } },
    { name: 'a phase event for an unknown run STILL creates a card (CLI/other-tab runs)', run: async () => {
      recv({ type: 'phase', runId: 'uuid-OTHER', phase: 'plan', cycle: 0 });
      assert.ok(window.__np.getRun('uuid-OTHER'),
        'a non-subagent event still materializes the run card (existing behavior preserved)');
    } },
  ]);
});

// ── from the former ui-subagent-tree suite.
test('subGroupStatus: anyStop -> stop, else anyRun -> run, else done', async () => {
  const { window } = await boot();
  const { subGroupStatus } = window.__np;
  assert.equal(subGroupStatus([{ status: 'finished' }, { status: 'running' }]), 'run');
  assert.equal(subGroupStatus([{ status: 'running' }, { status: 'stopped' }]), 'stop', 'stop wins over run');
  assert.equal(subGroupStatus([{ status: 'error' }]), 'stop', 'error maps to the stop class');
  assert.equal(subGroupStatus([{ status: 'finished' }, { status: 'finished' }]), 'done');
  assert.equal(subGroupStatus([]), 'done');
});

// ── from the former ui-subagent-type-pill suite: the per-sub-agent type pill (raw
// subagent_type), escaped and present only when set.
test('agentTypePillHtml: raw value, escaped, empty string when absent', async () => {
  const { window } = await boot();
  const { agentTypePillHtml } = window.__np;
  assert.equal(agentTypePillHtml('worca-cc-planner'), '<span class="agent-type-pill">worca-cc-planner</span>');
  assert.equal(agentTypePillHtml(''), '');
  assert.equal(agentTypePillHtml(null), '');
  assert.equal(agentTypePillHtml(undefined), '');
  // The "escaped" half of the name: the value is interpolated into innerHTML by
  // rdAgentsBody and buildHdAgents, so markup must come back inert.
  assert.equal(agentTypePillHtml('<img src=x onerror=alert(1)>'),
    '<span class="agent-type-pill">&lt;img src=x onerror=alert(1)&gt;</span>');
  assert.equal(agentTypePillHtml('a"b'), '<span class="agent-type-pill">a&quot;b</span>');
});

test('onSubagent merges subagentType onto the run record', async () => {
  const { window } = await boot();
  const { makeRun, onSubagent } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', subagentType: 'Explore' });
  assert.equal(r.subAgents.find((s) => s.id === 'a1').subagentType, 'Explore');
});

// ── from the former ui-subagent-uiphase-merge suite.
test('onSubagent merges uiPhase from a spawn delta and a finish delta without it keeps the spawn-time value', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'onSubagent merges uiPhase from a spawn delta', run: async () => {
      const r = window.__np.makeRun({ runId: 'p1' });
      window.__np.onSubagent(r, { transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', status: 'running' });
      assert.equal(r.subAgents[0].uiPhase, 'plan');
    } },
    { name: 'a finish delta that omits uiPhase preserves the spawn-time value', run: async () => {
      const r = window.__np.makeRun({ runId: 'p1' });
      window.__np.onSubagent(r, { transition: 'spawn', id: 't1', nodeId: 's0_0', uiPhase: 'plan', status: 'running' });
      window.__np.onSubagent(r, { transition: 'finish', id: 't1', status: 'finished' });
      assert.equal(r.subAgents[0].uiPhase, 'plan', 'merge only defined fields → uiPhase retained');
    } },
  ]);
});

// ── from the former ui-subagent-views suite: subAgentsOf wired into the graph adapters.
test('subAgentsForNode: exact nodeId match wins; uiPhase is the fallback', async () => {
  const ctx = await boot();
  const r = ctx.window.__np.makeRun({ runId: 'p1' });
  // A FROZEN v1 manifest — the only kind that still carries uiPhase on a node.
  r.stepper = { version: 1, feedbacks: [], steps: [{ kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan' }] }] };
  r.subAgents = [{ id: 'a', nodeId: 's0_0', uiPhase: 'plan', status: 'running' }];
  assert.deepEqual(ctx.window.__np.subAgentsForNode(r, 'plan').map((s) => s.id), ['a'], 'matched by uiPhase against the frozen node');
  assert.deepEqual(ctx.window.__np.subAgentsForNode(r, 's0_0').map((s) => s.id), ['a'], 'exact nodeId still matches when present');
});
