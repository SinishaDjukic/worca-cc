// test/cli-render-workflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWorkflowProposal } from '../src/cli/render.mjs';

const manifest = {
  graph: {
    nodes: [
      { id: 'n_task', kind: 'task', label: 'Task' },
      { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan', model: 'claude-opus-5', effort: 'high', fanOut: false },
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implement', model: '', effort: '', fanOut: true },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', label: 'Review', model: 'claude-sonnet-5', effort: '', fanOut: false },
      { id: 'n_end', kind: 'end', label: 'End' },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' }, loop: false },
      { id: 'w5', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
    ],
  },
};

test('formatWorkflowProposal renders header, reasoning, stages with tuning, loops, warnings and cost', () => {
  const lines = formatWorkflowProposal({ round: 2, name: 'Quick and careful', reasoning: 'small task', match: null, manifest, order: ['n_plan', 'n_impl', 'n_rev'], warnings: ['web review has nowhere to loop'], costUsd: 0.034 });
  assert.equal(lines[0], '? Auto proposes a workflow · round 2  (no saved workflow has this shape — Accept saves it as "Quick and careful")');
  assert.equal(lines[1], '  small task');
  assert.equal(lines[2], '  stages: Plan (claude-opus-5 · high) → Implement ⤴ → Review (claude-sonnet-5)');
  assert.equal(lines[3], '  loop: Review → Implement (max 3 cycles)');
  assert.equal(lines[4], '  ! web review has nowhere to loop');
  assert.equal(lines[5], '  classifier cost so far: $0.03');
  assert.equal(lines.length, 6);
});

test('a matched proposal names the saved workflow and the ignored overrides; empty parts are omitted', () => {
  const lines = formatWorkflowProposal({ round: 1, name: 'x', match: { id: 'wf_quick-fix', name: 'Quick Fix' }, manifest: { graph: { nodes: [], wires: [] } }, ignoredProjectOverrides: true });
  assert.deepEqual(lines, [
    '? Auto proposes a workflow · round 1  (same shape as your saved workflow "Quick Fix" — Accept reuses it)',
    '  stages: ',
    '  note: this project\'s saved settings for that workflow are not applied to Auto runs',
  ]);
  assert.deepEqual(formatWorkflowProposal(null), ['? Auto proposes a workflow · round 1  (no saved workflow has this shape — Accept saves it as "")', '  stages: ']);
});

test('the stages line follows the proposal\'s dispatch order, not the node order', () => {
  const lines = formatWorkflowProposal({ round: 1, name: 'x', match: null, manifest, order: ['n_rev', 'n_plan', 'n_impl'] });
  assert.equal(lines[1], '  stages: Review (claude-sonnet-5) → Plan (claude-opus-5 · high) → Implement ⤴');
});
