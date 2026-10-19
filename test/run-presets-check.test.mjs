// test/run-presets-check.test.mjs — what stops a preset from starting, named per item, and the full-picks snapshot
// (src/core/run-presets-check.mjs). Every dependency is injected, so no server runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetRefusals, completeSnapshot } from '../src/core/run-presets-check.mjs';

const WF = { id: 'wf_x', nodes: [{ id: 'n_plan', kind: 'agent', key: 'planner' }, { id: 'n_impl', kind: 'agent', key: 'implementer' }], wires: [{ id: 'w_loop' }] };
const MODELS = [{ id: 'claude-opus-5-5', efforts: ['low', 'high'], harnesses: ['claude'] }];
const ctx = (over = {}) => ({
  assertWorkflow: async (id) => { if (id !== 'wf_x') throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' }); return WF; },
  guardrailExists: async (id) => ['permissive', 'normal'].includes(id),
  scopeExists: async () => true, models: MODELS, ...over,
});

test('a clean setup has no broken items', async () => {
  assert.deepEqual(await presetRefusals({ workflowId: 'wf_x', guardrailsId: 'normal', overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } } }, ctx()), []);
});

test('each gone reference is named once, with the agent label for models', async () => {
  const items = await presetRefusals({ workflowId: 'wf_x', guardrailsId: 'gr_gone',
    overlay: { nodes: { n_plan: { model: 'my-gateway-opus' }, n_impl: { model: 'claude-opus-5-5', effort: 'max' }, n_old: { model: 'claude-opus-5-5' } }, wires: { w_gone: { maxCycles: 2 } } } },
  ctx({ scope: { kind: 'project', ref: 'api-12345678' }, scopeExists: async () => false }));
  assert.deepEqual(items.map((i) => i.message), [
    'Project api-12345678 is no longer registered in worca',
    'Guardrail set gr_gone no longer exists',
    'Planner: model my-gateway-opus is no longer in the catalog',
    'Implementer: model claude-opus-5-5 has no effort "max"',
    'n_old: no longer an agent of workflow wf_x',
    'Loop w_gone: no longer a loop of workflow wf_x',
  ]);
  assert.equal(items[0].reset, false);
});

test('a gone workflow and an engine refusal are named', async () => {
  const items = await presetRefusals({ workflowId: 'wf_gone', engine: 'codex' }, ctx({ engineRefusal: async () => 'Codex is not signed in' }));
  assert.deepEqual(items.map((i) => i.message), ['Workflow wf_gone no longer exists', 'Engine codex: Codex is not signed in']);
});

test('completeSnapshot fills every agent node and loop from the resolved graph, keeping explicit picks', () => {
  const resolved = { nodes: { n_plan: { kind: 'agent', model: 'claude-sonnet-5-5', effort: 'medium', fanOut: false, askQuestions: true, subagentModel: '' },
    n_task: { kind: 'task' } }, wires: { w_loop: { maxCycles: 3 } } };
  assert.deepEqual(completeSnapshot({ workflowId: 'wf_x', overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } } }, resolved).overlay, {
    nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', fanOut: false, askQuestions: true } },
    wires: { w_loop: { maxCycles: 3 } },
  });
});
