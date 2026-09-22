// test/node-tunables.test.mjs — the ONE tunables resolution shared by New Pipeline
// (app.js) and the Ask Worca run card (ask-panel.mjs). Pure module, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNodeTunables, modifiedFieldsOf, pruneNodeSelection, buildNodeConfigRows, buildGraphNodeRows } from '../ui/public/node-tunables.mjs';

// Registry metas WITHOUT v2 ports: portsFnFor reports them `ported:false`; classifyLoops
// still orders the graph (Tarjan over node ids), it just finds no loop WIRES — launch
// order is all this module reads. Wires are the real v2 shape {from:{node,port}, to:{node,port}}.
const REG = {
  planner: { key: 'planner', displayName: 'Plan', color: 'violet', fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: true },
  reviewer: { key: 'reviewer', displayName: 'Review', color: 'peach', fanOut: true, asksQuestions: false },
};
const TPL = { id: 'wf_x', name: 'X', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
          { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'claude-opus-5-5', effort: 'high' } },
          { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
          { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
          { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
          { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 2 } },
          { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('resolveNodeTunables: override beats workflow default, effort follows its own model only', () => {
  const r = resolveNodeTunables({ model: 'claude-haiku-4-5' }, { model: 'claude-opus-5-5', effort: 'high', fanOut: true }, { fanOut: false, questionsDefault: true });
  assert.deepEqual(r.override, { model: 'claude-haiku-4-5' });
  assert.equal(r.model, 'claude-haiku-4-5');
  assert.equal(r.effort, '', 'a model override does not inherit the default effort');
  assert.equal(r.fanOut, true);
  assert.equal(r.askQuestions, true);
  assert.deepEqual(r.def, { model: 'claude-opus-5-5', effort: 'high', fanOut: true, askQuestions: true, subagentModel: '' });
});

test('modifiedFieldsOf + pruneNodeSelection agree on "equal to default = inherit"', () => {
  const t = resolveNodeTunables({}, { model: 'claude-opus-5-5', effort: 'high' }, {});
  assert.deepEqual(modifiedFieldsOf(t, t.def, { asksQuestions: true }), []);
  const row = { ...t, askQuestions: false, questionsLocked: false };
  assert.deepEqual(pruneNodeSelection(row, { effort: 'max' }), { model: 'claude-opus-5-5', effort: 'max', fanOut: null, askQuestions: null, subagentModel: '' });
  assert.deepEqual(pruneNodeSelection(row, {}), { model: '', effort: '', fanOut: null, askQuestions: null, subagentModel: '' });
  assert.equal(pruneNodeSelection({ ...t, askQuestions: null, questionsLocked: false }, {}).askQuestions, undefined, 'no capability → key dropped by JSON');
});

test('buildGraphNodeRows orders agent nodes in launch order and skips non-agents', () => {
  const rows = buildGraphNodeRows(TPL, REG, { nodes: { n_rev: { effort: 'max' } } });
  assert.deepEqual(rows.map((r) => r.nodeId), ['n_plan', 'n_rev']);
  assert.deepEqual(rows.map((r) => r.label), ['Plan', 'Review']);
  assert.equal(rows[1].effort, 'max');
  assert.equal(rows[1].modified, true);
  assert.equal(rows[0].askQuestions, true, 'registry questionsDefault');
  assert.equal(rows[1].askQuestions, null, 'no questions capability');
  assert.equal(rows[1].fanOut, true, 'registry fanOut default');
  assert.deepEqual(rows.map((r) => r.stepIndex), [1, 2], 'stepIndex = launch rank (the task card ranks 0)');
});

test('buildNodeConfigRows dispatches v2 to the graph builder and honours legacySteps for wf_default', () => {
  const rows = buildNodeConfigRows(TPL, REG, { nodes: {} }, { legacySteps: { planner: { model: 'claude-haiku-4-5' } } });
  assert.equal(rows[0].role, 'planner', 'legacy per-role storage marks the row');
  assert.equal(rows[0].model, 'claude-haiku-4-5');
  assert.equal(rows[1].role, 'reviewer');
});

// Settings › Memory: GET /api/workflows/wf_memory_defrag stamps `pinnedAgentModel`; every row then
// shows the pair as its default (the project's own model pick included — the run ignores it) and
// carries `pinned`, while every OTHER tunable keeps its usual layering.
test('buildGraphNodeRows: a pinned pair is every row\'s model + effort, unmodified and marked `pinned`; the other tunables layer as before', () => {
  const tpl = { ...TPL, pinnedAgentModel: { model: 'claude-haiku-4-5', effort: 'high', source: 'settings' } };
  const rows = buildGraphNodeRows(tpl, REG, { nodes: { n_plan: { model: 'claude-fable-5-1', effort: 'max', fanOut: true } } });
  for (const r of rows) {
    // n_plan's saved fan-out is its one override; its stored model pick is not.
    assert.deepEqual([r.model, r.effort, r.pinned, r.modified], ['claude-haiku-4-5', 'high', 'settings', r.nodeId === 'n_plan'], r.nodeId);
    assert.deepEqual([r.def.model, r.def.effort], ['claude-haiku-4-5', 'high']);
  }
  const plan = rows.find((r) => r.nodeId === 'n_plan');
  assert.equal(plan.fanOut, true, 'a saved fan-out still applies');
  assert.deepEqual(plan.override, { fanOut: true }, 'the stored model pick is not an override while the pair is pinned');
  const noEffort = buildGraphNodeRows({ ...TPL, pinnedAgentModel: { model: 'claude-haiku-4-5', effort: null } }, REG, { nodes: {} });
  assert.ok(noEffort.every((r) => r.model === 'claude-haiku-4-5' && r.effort === ''), 'the template\'s own effort never rides under the pinned model');
  assert.ok(buildGraphNodeRows(TPL, REG, { nodes: {} }).every((r) => !('pinned' in r)), 'no pin: the row shape is unchanged');
});

// Settings › Memory: a pinned row never edits model/effort, and the setters REPLACE both on every
// save — so saving another tunable re-sends the project's own hidden pick instead of erasing it.
test('pruneNodeSelection on a pinned row re-sends the project\'s stored pick; without a stored pick it stays inherit', () => {
  const tpl = { ...TPL, pinnedAgentModel: { model: 'claude-haiku-4-5', effort: 'high', source: 'settings' } };
  const rows = buildGraphNodeRows(tpl, REG, { nodes: { n_plan: { model: 'claude-fable-5-1', effort: 'max' } } });
  const plan = rows.find((r) => r.nodeId === 'n_plan');
  const rev = rows.find((r) => r.nodeId === 'n_rev');
  assert.deepEqual(plan.storedPair, { model: 'claude-fable-5-1', effort: 'max' });
  assert.deepEqual(rev.storedPair, { model: '', effort: '' }, 'no pick stored');
  assert.deepEqual(pruneNodeSelection(plan, { fanOut: true }), { model: 'claude-fable-5-1', effort: 'max', fanOut: true, askQuestions: null, subagentModel: '' });
  const r = pruneNodeSelection(rev, { fanOut: false });
  assert.deepEqual([r.model, r.effort, r.fanOut], ['', '', false], 'inherit: nothing to keep');
  // Unpinned, the same pick is an ordinary override and prunes exactly as before.
  const free = buildGraphNodeRows(TPL, REG, { nodes: { n_plan: { model: 'claude-fable-5-1', effort: 'max' } } }).find((x) => x.nodeId === 'n_plan');
  assert.equal('storedPair' in free, false);
  assert.deepEqual(pruneNodeSelection(free, { fanOut: true }), { model: 'claude-fable-5-1', effort: 'max', fanOut: true, askQuestions: null, subagentModel: '' });
});

// Settings › Memory: the hidden pick a pinned row re-sends must still be one the setter accepts —
// healed against the catalog the caller hands in, exactly as an unpinned row's selects drop it.
test('buildGraphNodeRows: a pinned row\'s hidden pick is healed against opts.models (a model gone, an effort no longer offered); no catalog keeps it', () => {
  const tpl = { ...TPL, pinnedAgentModel: { model: 'claude-haiku-4-5', effort: 'high', source: 'settings' } };
  const runConfig = { nodes: { n_plan: { model: 'claude-fable-5-1', effort: 'max' }, n_rev: { model: 'gone-model', effort: 'high' } } };
  const models = [{ id: 'claude-fable-5-1', efforts: ['medium', 'high'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] }];
  const rows = buildGraphNodeRows(tpl, REG, runConfig, { models });
  const plan = rows.find((r) => r.nodeId === 'n_plan');
  assert.deepEqual(plan.storedPair, { model: 'claude-fable-5-1', effort: '' }, 'the effort it no longer offers is dropped');
  assert.deepEqual(rows.find((r) => r.nodeId === 'n_rev').storedPair, { model: '', effort: '' }, 'a model gone from the catalog is dropped with its effort');
  assert.deepEqual(pruneNodeSelection(plan, { fanOut: true }).effort, '', 'so a fan-out save is one the setter accepts');
  assert.deepEqual(buildGraphNodeRows(tpl, REG, runConfig, {}).find((r) => r.nodeId === 'n_plan').storedPair, { model: 'claude-fable-5-1', effort: 'max' }, 'no catalog: as stored');
  assert.deepEqual(buildGraphNodeRows(tpl, REG, runConfig, { models: [] }).find((r) => r.nodeId === 'n_rev').storedPair, { model: 'gone-model', effort: 'high' }, 'an empty (failed) catalog condemns nothing');
});
