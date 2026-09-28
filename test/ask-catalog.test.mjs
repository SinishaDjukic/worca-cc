// test/ask-catalog.test.mjs
// P1/T9: the static catalog behind the system prompt and list_projects /
// list_workflows (ask-worca-design.md §6.1 catalog.mjs, D9).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createCatalog, shapeWorkflow, buildCatalog, shapeAgents } from '../src/core/ask/catalog.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';

useTempHome(after);

const REGISTRY = {
  planner: { key: 'planner', displayName: 'Planner', description: 'Writes the plan' },
  reviewer: { key: 'reviewer', displayName: 'Reviewer', description: '' },
};
const TPL = {
  id: 'wf_review', name: 'Review only', version: 1, domain: 'coding', origin: 'plugin:qa',
  steps: [[{ id: 'n1', key: 'planner', defaults: { model: 'x' } }], [{ id: 'n2', key: 'reviewer' }, { id: 'n3', key: 'ghost' }]],
  feedbacks: [{ id: 'fb1', from: 'n2', to: 'n1', maxCycles: 3 }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

test('shapeWorkflow: groups preserved, registry names, unknown key falls back to the key, extras dropped', () => {
  assert.deepEqual(shapeWorkflow(TPL, REGISTRY), {
    id: 'wf_review', name: 'Review only', domain: 'coding', origin: 'plugin:qa',
    steps: [
      [{ nodeId: 'n1', key: 'planner', displayName: 'Planner', description: 'Writes the plan' }],
      [{ nodeId: 'n2', key: 'reviewer', displayName: 'Reviewer', description: '' },
       { nodeId: 'n3', key: 'ghost', displayName: 'ghost', description: '' }],
    ],
    feedbacks: [{ id: 'fb1', from: 'n2', to: 'n1' }],
  });
  assert.equal(shapeWorkflow(GRAPH_DEFAULT_WORKFLOW, {}).origin, null, 'wf_default has no origin key');
  assert.equal(shapeWorkflow({ id: 'x', name: 'x', steps: null, feedbacks: undefined }, {}).steps.length, 0);
  assert.equal(shapeWorkflow({ id: 'x', name: 'x' }, {}).domain, 'general');
  assert.equal(shapeWorkflow({ id: 'x', name: 'x', origin: '' }, {}).origin, '', 'only null/undefined become null');
});

test('buildCatalog: injected readers, wf_default first and never duplicated, shapes exactly as the contract', async () => {
  const srcKeys = ['a-00000001', 'b-00000002'];
  const { buildCatalog: build } = createCatalog({
    listProjects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }, { key: 'gone-00000002', name: 'Gone', path: '/p/gone', exists: false }],
    listWorkspaces: async () => [{ id: 'wks-team-0000abcd', name: 'Team', description: '', projectPaths: ['/p/a', '/p/b'], projectKeys: srcKeys, exists: [true, true] }],
    listWorkflows: async () => [TPL, { ...GRAPH_DEFAULT_WORKFLOW, name: 'Shadow' }],
    loadAgentRegistry: () => REGISTRY,
  });
  const cat = await build();
  assert.deepEqual(cat.projects, [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }, { key: 'gone-00000002', name: 'Gone', path: '/p/gone' }]);
  assert.deepEqual(cat.workspaces, [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['a-00000001', 'b-00000002'] }]);
  assert.notEqual(cat.workspaces[0].projectKeys, srcKeys, 'projectKeys is copied, never aliased to the reader\'s array');
  assert.deepEqual(cat.workflows.map((w) => w.id), ['wf_default', 'wf_memory_defrag', 'wf_review'], 'built-ins first, a stored twin of a built-in id is dropped');
  assert.equal(cat.workflows[0].name, 'Default');
  assert.equal(cat.workflows[0].steps.length, 5);
  assert.equal(cat.workflows[0].steps[1][0].key, 'planner');
  assert.equal(cat.workflows[0].steps[1][0].displayName, 'Planner');
  assert.equal(cat.workflows[1].id, 'wf_memory_defrag');
});

test('buildCatalog survives a throwing registry loader (names fall back to keys)', async () => {
  const { buildCatalog: build } = createCatalog({
    listProjects: async () => [], listWorkspaces: async () => [], listWorkflows: async () => [],
    loadAgentRegistry: () => { throw new Error('boom'); },
  });
  const cat = await build();
  assert.equal(cat.workflows[0].steps[0][0].displayName, 'clarify');
});

test('bound buildCatalog on a temp home: empty registry lists, wf_default with real agent names', async () => {
  const cat = await buildCatalog();
  assert.deepEqual(cat.projects, []);
  assert.deepEqual(cat.workspaces, []);
  assert.equal(cat.workflows[0].id, 'wf_default');
  for (const group of cat.workflows[0].steps) {
    for (const n of group) assert.ok(typeof n.displayName === 'string' && n.displayName.length > 0, `${n.key} has a display name`);
  }
});

test('buildCatalog exposes the placeable coding agents as `agents` (key, name, purpose, ports, flags), sorted by key; selfLoop follows the assembler', async () => {
  const cat = await createCatalog({ listProjects: async () => [], listWorkspaces: async () => [], listWorkflows: async () => [] }).buildCatalog();
  assert.ok(Array.isArray(cat.agents) && cat.agents.length >= 5);
  assert.deepEqual(cat.agents.map((a) => a.key), [...cat.agents.map((a) => a.key)].sort(), 'sorted by key');
  for (const a of cat.agents) {
    assert.deepEqual(Object.keys(a).sort(), ['asksQuestions', 'clarifier', 'displayName', 'fanOut', 'inputs', 'key', 'outputs', 'purpose', 'selfLoop', 'verifier']);
    assert.equal(typeof a.inputs, 'string'); assert.equal(typeof a.outputs, 'string');
  }
  assert.ok(cat.agents.some((a) => a.verifier), 'a verdict-bearing agent is flagged');
  // Measured at af39f7bd over the real registry: the refiner (revise:md loop input, revise:md/blocking output) is the ONLY
  // self-looper. The planner has a revise:md loop input too, but its plan:md output is when:always — the assembler
  // (BAD_SELF_LOOP) refuses a planner self-loop, so the prompt must not advertise one (PD27, v4).
  assert.deepEqual(cat.agents.filter((a) => a.selfLoop).map((a) => a.key), ['refiner'], 'selfLoop = a when:blocking output whose type a loop input accepts');
});

test('shapeAgents: selfLoop needs a BLOCKING output whose type a loop input accepts (any matches everything); non-placeable / port-less entries are skipped', () => {
  // v5: every entry carries `domain: 'coding'` — shapeAgents asks agentVocabulary for the coding domain, and its
  // domainOk filter (classify.mjs:64) drops entries whose domain is not coding/shared/general. Measured: without the
  // field the whole fixture is filtered out and shapeAgents(reg) is [] (v4's fixture was red).
  const reg = {
    a: { key: 'a', displayName: 'A', description: 'd', domain: 'coding', inputs: [{ id: 'in', type: 'md', required: true }, { id: 'again', type: 'md', loop: true }], outputs: [{ id: 'out', type: 'md', when: 'always' }] },
    b: { key: 'b', displayName: 'B', description: 'd', domain: 'coding', inputs: [{ id: 'again', type: 'md', loop: true }], outputs: [{ id: 'fix', type: 'md', when: 'blocking' }, { id: 'ok', type: 'void', when: 'clean' }], verdict: {} },
    c: { key: 'c', displayName: 'C', description: 'd', domain: 'coding', inputs: [{ id: 'again', type: 'any', loop: true }], outputs: [{ id: 'fix', type: 'json', when: 'blocking' }], verdict: {} },
    d: { key: 'd', displayName: 'D', description: 'd', domain: 'coding', inputs: [{ id: 'again', type: 'md', loop: true }], outputs: [{ id: 'fix', type: 'json', when: 'blocking' }], verdict: {} },
    e: { key: 'e', displayName: 'E', description: 'd', domain: 'coding', placeable: false, inputs: [], outputs: [] },
    f: { key: 'f', displayName: 'F', description: 'd', domain: 'coding' },
  };
  assert.deepEqual(shapeAgents(reg).map((a) => [a.key, a.selfLoop, a.verifier]), [['a', false, false], ['b', true, true], ['c', true, true], ['d', false, true]]);
});
