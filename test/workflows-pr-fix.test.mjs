// test/workflows-pr-fix.test.mjs — the reserved PR fix workflow (wf_pr_fix) every Watch PR fix run
// starts. It ships with worca, so a fresh home with no saved workflows can still run it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph,
} from '../src/core/workflows.mjs';
import {
  PR_FIX_WORKFLOW_ID, PR_FIX_WORKFLOW_NAME, GRAPH_PR_FIX_WORKFLOW, isReservedWorkflowId,
} from '../src/core/graph/builtin-workflows.mjs';
import { FIX_WORKFLOW_ID } from '../src/core/pr-watch.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';

useTempHome(after);

test('wf_pr_fix is the reserved Implement ⇄ Review graph the fix runs start', () => {
  const wf = GRAPH_PR_FIX_WORKFLOW;
  assert.equal(PR_FIX_WORKFLOW_ID, 'wf_pr_fix');
  assert.equal(FIX_WORKFLOW_ID, PR_FIX_WORKFLOW_ID);
  assert.equal(PR_FIX_WORKFLOW_NAME, 'PR fix');
  assert.equal(wf.id, 'wf_pr_fix'); assert.equal(wf.name, 'PR fix'); assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.map((n) => [n.id, n.kind, n.key ?? null]),
    [['n_task', 'task', null], ['n_impl', 'agent', 'implementer'], ['n_review', 'agent', 'reviewer'], ['n_end', 'end', null]]);
  assert.deepEqual(wf.wires.map((w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`), [
    'n_task.task->n_impl.plan', 'n_task.task->n_review.plan', 'n_impl.done->n_review.done',
    'n_review.review->n_impl.fix', 'n_review.pass->n_end.result',
  ]);
  assert.deepEqual(wf.wires.find((w) => w.from.port === 'review').config, { maxCycles: 3 }, 'the review loop is bounded');
  assert.ok(Object.isFrozen(wf.nodes[1]) && Object.isFrozen(wf.wires[3].config), 'deep-frozen');
  assert.equal(isReservedWorkflowId('wf_pr_fix'), true);
  const reg = loadAgentRegistry();
  const { ok, errors } = validateGraph(wf, registryPortsFn(reg, loadScriptRegistry({ agentKeys: Object.keys(reg) })));
  assert.ok(ok, JSON.stringify(errors));
});

test('on a fresh home with no saved workflows it reads, runs and resolves', async () => {
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_pr_fix').n, 0);
  assert.equal(await readWorkflow(FIX_WORKFLOW_ID), GRAPH_PR_FIX_WORKFLOW);
  assert.equal(await assertRunnableWorkflow(FIX_WORKFLOW_ID), GRAPH_PR_FIX_WORKFLOW);
  const resolved = await resolveGraph(process.cwd(), FIX_WORKFLOW_ID, loadAgentRegistry());
  assert.deepEqual(Object.keys(resolved.nodes).sort(), ['n_end', 'n_impl', 'n_review', 'n_task']);
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_pr_fix'), 'internal: never listed');
});

test('a save cannot claim the reserved id and a delete is refused', async () => {
  const saved = await writeGraphWorkflow({ id: 'wf_pr_fix', name: 'Mine too', nodes: [], wires: [] });
  assert.equal(saved.id, 'wf_mine-too', 'an explicit reserved id falls back to the slug of the name');
  assert.equal((await writeGraphWorkflow({ name: 'pr fix', nodes: [], wires: [] })).id, 'wf_pr-fix', 'no name slugs onto it');
  assert.equal(await deleteWorkflow('wf_pr_fix'), false);
  // A rogue row with the id is hidden, undeletable and never wins over the constant.
  getDb().prepare(`INSERT INTO workflows (id, name, domain, version, steps, feedbacks, graph, created_at, updated_at)
    VALUES ('wf_pr_fix', 'Rogue', 'coding', 2, '[]', '[]', '{"nodes":[],"wires":[]}', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`).run();
  assert.equal(await deleteWorkflow('wf_pr_fix'), false);
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_pr_fix'), 'the rogue row survived');
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_pr_fix'));
  assert.equal(await readWorkflow('wf_pr_fix'), GRAPH_PR_FIX_WORKFLOW);
});
