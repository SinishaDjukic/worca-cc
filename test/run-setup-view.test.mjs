// The Task tab's Run setup (ui/public/run-setup-view.mjs): the choices a run started with, named as on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { runSetupModel, renderRunSetup } from '../ui/public/run-setup-view.mjs';

const STATE = {
  runEngine: 'claude', guardrailsId: 'normal', tools: { tool: 'graphify' },
  branch: { source: 'origin/dev' },
  stepper: { template: { id: 'wf_lean_build', name: 'Lean' }, graph: {
    nodes: [{ id: 'n_task', kind: 'task', label: 'Task' }, { id: 'n_clarify', kind: 'agent', key: 'clarify', label: 'Clarify' },
      { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan', config: { subagentModel: 'sonnet' } },
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementation' },
      { id: 'n_review', kind: 'agent', key: 'reviewer', label: '' }],
    wires: [{ id: 'w1', from: { node: 'n_task' }, to: { node: 'n_plan' }, loop: false },
      { id: 'w9', from: { node: 'n_review' }, to: { node: 'n_impl' }, loop: true, maxCycles: 2 }] } },
};

test('a run with a kept setup: the run rows, the agents whose picks were set, and each loop\'s budget', () => {
  const m = runSetupModel({ workflowId: 'wf_lean_build', engine: 'claude', guardrailsId: 'permissive', humanInLoop: false,
    nightMode: true, sourceBranch: 'origin/dev', syncBeforeStart: true, mcpOptOut: ['figma'],
    overlay: { nodes: { n_clarify: { askQuestions: true }, n_plan: { fanOut: true }, n_impl: { model: 'opus', effort: 'high' } },
      wires: { w9: { maxCycles: 3 } } } }, STATE);
  assert.deepEqual(m.rows, [
    { label: 'Workflow', value: 'Lean' },
    { label: 'Engine', value: 'Claude Code' },
    { label: 'Guardrails', value: 'Permissive' },
    { label: 'Human in the loop', value: 'Off: runs without asking' },
    { label: 'Away mode', value: 'On: Worca may answer for you' },
    { label: 'Source branch', value: 'origin/dev · synced before start' },
    { label: 'MCP servers off', value: 'figma' },
    { label: 'Code graph', value: 'graphify' },
  ]);
  assert.deepEqual(m.agents, [
    { name: 'Clarify', value: 'asks questions' },
    { name: 'Plan', value: 'parallel sub-agents on sonnet' },
    { name: 'Implementation', value: 'opus · high effort' },
  ]);
  assert.deepEqual(m.loops, [{ name: 'Reviewer → Implementation', value: 'up to 3 rounds' }], 'the run\'s own budget over the graph\'s; a blank label falls back to the key');
});

test('a run from before runs kept their setup: what its state says, and no Away mode or human-in-the-loop guess', () => {
  const m = runSetupModel(null, STATE);
  assert.deepEqual(m.rows.map((r) => r.label), ['Workflow', 'Engine', 'Guardrails', 'Source branch', 'Code graph']);
  assert.deepEqual(m.agents, [{ name: 'Plan', value: 'sub-agents on sonnet' }]);
  assert.deepEqual(m.loops, [{ name: 'Reviewer → Implementation', value: 'up to 2 rounds' }]);
});

test('the card: one heading, a list per group, nothing for an empty model', () => {
  const doc = new JSDOM('').window.document;
  const card = renderRunSetup(doc, runSetupModel({ overlay: { nodes: { n_plan: { fanOut: true } } } }, STATE));
  assert.equal(card.querySelector('.run-setup-h').textContent, 'Run setup');
  assert.deepEqual([...card.querySelectorAll('.run-setup-sub')].map((h) => h.textContent), ['Agents', 'Loops']);
  assert.equal(card.querySelectorAll('.run-setup-list').length, 3);
  assert.equal(renderRunSetup(doc, runSetupModel(null, {})) && renderRunSetup(doc, runSetupModel(null, {})).querySelectorAll('dt').length, 1, 'the engine alone (Claude Code by default)');
});
