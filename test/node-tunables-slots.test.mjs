// test/node-tunables-slots.test.mjs — New pipeline rows inherit the run engine's step slot (plans/cascading-settings-design.md
// §4.2, §6): the slot stands above the template's own config and below the project's pick, so "inherit" shows what runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphNodeRows, pruneNodeSelection } from '../ui/public/node-tunables.mjs';

const REG = { planner: { key: 'planner', displayName: 'Plan' }, reviewer: { key: 'reviewer', displayName: 'Review' } };
const TPL = { id: 'wf_x', name: 'X', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w3', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('the slot is the inherited default; the project\'s pick still wins; saving the slot value prunes to inherit', () => {
  const slots = { planner: { model: 'claude-sonnet-5' }, reviewer: { model: 'claude-haiku-4-5', effort: 'medium' } };
  const rows = buildGraphNodeRows(TPL, REG, { nodes: { n_rev: { model: 'claude-opus-5-5' } } }, { slotDefaults: slots });
  const plan = rows.find((r) => r.nodeId === 'n_plan');
  const rev = rows.find((r) => r.nodeId === 'n_rev');
  assert.deepEqual([plan.model, plan.effort], ['claude-sonnet-5', ''], 'the template effort belonged to the template model');
  assert.deepEqual([plan.def.model, plan.def.effort], ['claude-sonnet-5', '']);
  assert.equal(rev.model, 'claude-opus-5-5', 'the project\'s node pick');
  assert.deepEqual([rev.def.model, rev.def.effort], ['claude-haiku-4-5', 'medium']);
  assert.equal(pruneNodeSelection(plan, { model: 'claude-sonnet-5' }).model, '', 'equal to the slot = inherit');
  const none = buildGraphNodeRows(TPL, REG, { nodes: {} }, {});
  assert.deepEqual([none[0].def.model, none[0].def.effort], ['claude-opus-5-5', 'high'], 'no slots: exactly as before');
});
