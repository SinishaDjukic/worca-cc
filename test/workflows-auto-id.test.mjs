// test/workflows-auto-id.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph,
  AUTO_WORKFLOW_ID,
} from '../src/core/workflows.mjs';
import { AUTO_WORKFLOW_STUB, AUTO_WORKFLOW_NAME } from '../src/core/graph/builtin-workflows.mjs';
import { exportGraphJson } from '../src/core/workflow-share.mjs';

useTempHome(after);

test('wf_auto reads as the frozen stub and is never listed', async () => {
  assert.equal(AUTO_WORKFLOW_ID, 'wf_auto');
  assert.equal(AUTO_WORKFLOW_NAME, 'Auto');
  assert.equal(await readWorkflow('wf_auto'), AUTO_WORKFLOW_STUB);
  assert.equal(AUTO_WORKFLOW_STUB.auto, true);
  assert.ok(Object.isFrozen(AUTO_WORKFLOW_STUB));
  assert.ok(!(await listWorkflows()).some((t) => t.id === 'wf_auto'));
});

test('a name slugging onto wf_auto is refused; the id cannot be claimed or deleted', async () => {
  for (const name of ['Auto', ' auto ', 'AUTO!!']) {
    await assert.rejects(
      () => writeGraphWorkflow({ name, nodes: [], wires: [] }),
      (err) => err.code === 'RESERVED_NAME' && err.message === 'the name "Auto" is reserved — choose another name',
    );
  }
  const saved = await writeGraphWorkflow({ id: 'wf_auto', name: 'Mine', nodes: [], wires: [] });
  assert.equal(saved.id, 'wf_mine', 'an explicit reserved id falls back to the slug of the name');
  assert.equal(await deleteWorkflow('wf_auto'), false);
});

test('assertRunnableWorkflow accepts wf_auto without a graph check; resolveGraph and the exporter refuse it', async () => {
  assert.equal(await assertRunnableWorkflow('wf_auto'), AUTO_WORKFLOW_STUB);
  await assert.rejects(() => resolveGraph(process.cwd(), 'wf_auto', {}), /decided per run/);
  await assert.rejects(() => exportGraphJson('wf_auto'), (e) => e.code === 'UNSUPPORTED' && /decided per run/.test(e.message), 'the node-less stub is never exported as a template');
});

// Defence in depth, exactly as test/workflows-db.test.mjs pins for wf_default: no
// legitimate path can mint the row, so force one in with raw SQL. Without a row the
// listWorkflows filter and the deleteWorkflow guard would be VACUOUS (a mutation
// audit found both survive without this test).
test('a rogue wf_auto ROW is hidden by listWorkflows, undeletable, and never wins over the stub', async () => {
  getDb().prepare(
    `INSERT INTO workflows (id, name, domain, version, steps, feedbacks, graph, created_at, updated_at)
     VALUES ('wf_auto', 'Rogue', 'coding', 2, '[]', '[]', ?, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
  ).run(JSON.stringify({ nodes: [], wires: [] }));
  assert.equal(await deleteWorkflow('wf_auto'), false, 'the reserved id is undeletable');
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_auto'), 'the rogue row survived');
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_auto'), 'the rogue row is never listed');
  assert.equal(await readWorkflow('wf_auto'), AUTO_WORKFLOW_STUB, 'the CONSTANT still wins');
});
