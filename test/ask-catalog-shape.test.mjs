import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../src/core/ask/catalog.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../src/core/workflows.mjs';

const SHAPE_WORKFLOW_ID = 'wf_shape';

const deps = (extra) => ({
  listProjects: async () => [],
  listWorkspaces: async () => [],
  listWorkflows: async () => [],
  loadAgentRegistry: () => ({}),
  ...extra,
});
const ids = async (extra) => (await createCatalog(deps(extra)).buildCatalog()).workflows.map((w) => w.id);

test('the Ask catalog has no wf_shape while the shapeFirst gate is off', async () => {
  const got = await ids({ shapeFirst: () => false });
  assert.ok(!got.includes(GRAPH_SHAPE_WORKFLOW.id));
});

test('the Ask catalog lists wf_shape after the other built-ins while the gate is on', async () => {
  const got = await ids({ shapeFirst: () => true });
  const off = await ids({ shapeFirst: () => false });
  assert.equal(GRAPH_SHAPE_WORKFLOW.id, SHAPE_WORKFLOW_ID);
  assert.deepEqual(got, [...off, SHAPE_WORKFLOW_ID]);
});

test('a saved row cannot duplicate wf_shape while the gate is on', async () => {
  const saved = [{ ...GRAPH_SHAPE_WORKFLOW }];
  const got = await ids({ shapeFirst: () => true, listWorkflows: async () => saved });
  assert.equal(got.filter((i) => i === SHAPE_WORKFLOW_ID).length, 1);
});
