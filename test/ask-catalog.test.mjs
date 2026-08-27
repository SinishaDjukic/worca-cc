// test/ask-catalog.test.mjs
// P1/T9: the static catalog behind the system prompt and list_projects /
// list_workflows (ask-worca-design.md §6.1 catalog.mjs, D9).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createCatalog, shapeWorkflow, buildCatalog } from '../src/core/ask/catalog.mjs';
import { DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';

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
  assert.equal(shapeWorkflow(DEFAULT_WORKFLOW, {}).origin, null, 'wf_default has no origin key');
  assert.equal(shapeWorkflow({ id: 'x', name: 'x', steps: null, feedbacks: undefined }, {}).steps.length, 0);
  assert.equal(shapeWorkflow({ id: 'x', name: 'x' }, {}).domain, 'general');
  assert.equal(shapeWorkflow({ id: 'x', name: 'x', origin: '' }, {}).origin, '', 'only null/undefined become null');
});

test('buildCatalog: injected readers, wf_default first and never duplicated, shapes exactly as the contract', async () => {
  const srcKeys = ['a-00000001', 'b-00000002'];
  const { buildCatalog: build } = createCatalog({
    listProjects: async () => [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true }, { key: 'gone-00000002', name: 'Gone', path: '/p/gone', exists: false }],
    listWorkspaces: async () => [{ id: 'wks-team-0000abcd', name: 'Team', description: '', projectPaths: ['/p/a', '/p/b'], projectKeys: srcKeys, exists: [true, true] }],
    listWorkflows: async () => [TPL, { ...DEFAULT_WORKFLOW, name: 'Shadow' }],
    loadAgentRegistry: () => REGISTRY,
  });
  const cat = await build();
  assert.deepEqual(cat.projects, [{ key: 'demo-00000001', name: 'Demo', path: '/p/demo' }, { key: 'gone-00000002', name: 'Gone', path: '/p/gone' }]);
  assert.deepEqual(cat.workspaces, [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['a-00000001', 'b-00000002'] }]);
  assert.notEqual(cat.workspaces[0].projectKeys, srcKeys, 'projectKeys is copied, never aliased to the reader\'s array');
  assert.deepEqual(cat.workflows.map((w) => w.id), ['wf_default', 'wf_default_v2', 'wf_review'], 'default first, a stored twin of its id is dropped');
  assert.equal(cat.workflows[0].name, 'Default');
  assert.equal(cat.workflows[0].steps.length, 5);
  assert.equal(cat.workflows[0].steps[1][0].key, 'planner');
  assert.equal(cat.workflows[0].steps[1][0].displayName, 'Planner');
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
