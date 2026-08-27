// test/api-workflows-graph-alias.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflow, listWorkflows, assertRunnableWorkflow, DEFAULT_WORKFLOW, GRAPH_DEFAULT_ALIAS_ID } from '../src/core/workflows.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { createCatalog } from '../src/core/ask/catalog.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('readWorkflow serves the graph default under the alias id', async () => {
  assert.equal(GRAPH_DEFAULT_ALIAS_ID, 'wf_default_v2');
  const tpl = await readWorkflow('wf_default_v2');
  assert.ok(tpl, 'alias resolves');
  assert.equal(tpl.id, 'wf_default_v2');
  assert.equal(tpl.name, 'Default (graph)');
  assert.equal(tpl.version, 2);
  assert.deepEqual(tpl.nodes, GRAPH_DEFAULT_WORKFLOW.nodes);
  assert.deepEqual(tpl.wires, GRAPH_DEFAULT_WORKFLOW.wires);
  assert.notEqual(tpl, GRAPH_DEFAULT_WORKFLOW, 'a clone, never the frozen constant');
  assert.equal(typeof tpl.createdAt, 'string');
  // the run gate accepts it (POST /api/run and the CLI go through this)
  assert.equal((await assertRunnableWorkflow('wf_default_v2')).version, 2);
  // the v1 default is untouched
  assert.equal((await readWorkflow('wf_default')).version, 1);
  assert.equal((await readWorkflow('wf_default')).name, 'Default');
  // the alias is not a stored row
  assert.equal((await listWorkflows()).some((t) => t.id === 'wf_default_v2'), false);
});

test('the Ask catalog lists v1 default, then the alias, then saved rows', async () => {
  const cat = createCatalog({
    listProjects: async () => [], listWorkspaces: async () => [],
    listWorkflows: async () => [{ id: 'wf_mine', name: 'Mine', version: 1, domain: 'coding', origin: null, steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] }],
    defaultWorkflow: DEFAULT_WORKFLOW, loadAgentRegistry: () => ({}),
  });
  const { workflows } = await cat.buildCatalog();
  assert.deepEqual(workflows.map((w) => w.id), ['wf_default', 'wf_default_v2', 'wf_mine']);
  assert.equal(workflows[1].name, 'Default (graph)');
  assert.ok(workflows[1].steps.length >= 4, 'shapeWorkflow ranks the graph into v1-shaped steps');
});
