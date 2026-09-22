// test/workflows-memory-defrag.test.mjs — the reserved Memory defragment workflow (agent-memory-design.md §7.2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph, setWorkflowNodeDefaults,
  GRAPH_MEMORY_DEFRAG_WORKFLOW, MEMORY_DEFRAG_WORKFLOW_ID, isReservedWorkflowId, GRAPH_DEFAULT_WORKFLOW, AUTO_WORKFLOW_ID,
} from '../src/core/workflows.mjs';
import { RESERVED_WORKFLOW_IDS, MEMORY_DEFRAG_WORKFLOW_NAME } from '../src/core/graph/builtin-workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { mintAutoWorkflowId } from '../src/core/auto/proposal.mjs';
import { createCatalog } from '../src/core/ask/catalog.mjs';

useTempHome(after);

test('the constant: one agent node between the task and End, the report wired to result, deep-frozen', () => {
  const wf = GRAPH_MEMORY_DEFRAG_WORKFLOW;
  assert.equal(MEMORY_DEFRAG_WORKFLOW_ID, 'wf_memory_defrag');
  assert.equal(MEMORY_DEFRAG_WORKFLOW_NAME, 'Memory defragment');
  assert.equal(wf.id, 'wf_memory_defrag'); assert.equal(wf.name, 'Memory defragment');
  assert.equal(wf.version, 2); assert.equal(wf.domain, 'shared');
  assert.deepEqual(wf.nodes.map((n) => [n.id, n.kind, n.key ?? null]), [['n_task', 'task', null], ['n_defrag', 'agent', 'memoryDefragmenter'], ['n_end', 'end', null]]);
  assert.deepEqual(wf.wires.map((w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`), ['n_task.task->n_defrag.task', 'n_defrag.report->n_end.result']);
  assert.ok(Object.isFrozen(wf) && Object.isFrozen(wf.nodes[1]) && Object.isFrozen(wf.wires[0].from), 'deepFreeze, not Object.freeze');
  assert.deepEqual([...RESERVED_WORKFLOW_IDS], ['wf_default', 'wf_auto', 'wf_memory_defrag']);
  for (const id of ['wf_default', 'wf_auto', 'wf_memory_defrag']) assert.equal(isReservedWorkflowId(id), true, id);
  assert.equal(isReservedWorkflowId('wf_memory-defrag'), false);
});

test('reserved: reads as the constant, never listed, the id cannot be claimed, undeletable, no stored defaults', async () => {
  assert.equal(await readWorkflow('wf_memory_defrag'), GRAPH_MEMORY_DEFRAG_WORKFLOW);
  assert.ok(!(await listWorkflows()).some((t) => t.id === 'wf_memory_defrag'));
  const saved = await writeGraphWorkflow({ id: 'wf_memory_defrag', name: 'Mine', nodes: [], wires: [] });
  assert.equal(saved.id, 'wf_mine', 'an explicit reserved id falls back to the slug of the name');
  // slugify maps "_" to "-": no NAME can slug onto wf_memory_defrag, so the RESERVED_NAME arm never fires for it.
  const slugged = await writeGraphWorkflow({ name: 'memory defrag', nodes: [], wires: [] });
  assert.equal(slugged.id, 'wf_memory-defrag');
  assert.equal(await deleteWorkflow('wf_memory_defrag'), false);
  await assert.rejects(() => setWorkflowNodeDefaults('wf_memory_defrag', { n_defrag: { model: 'x' } }), /cannot store defaults/);
});

test('runnable: assertRunnableWorkflow validates the graph against the shipped registry; resolveGraph resolves the agent', async () => {
  assert.equal(await assertRunnableWorkflow('wf_memory_defrag'), GRAPH_MEMORY_DEFRAG_WORKFLOW, 'the graph check passes with the real sidecars');
  const registry = loadAgentRegistry();
  const resolved = await resolveGraph(process.cwd(), 'wf_memory_defrag', registry);
  assert.notEqual(resolved.template, GRAPH_MEMORY_DEFRAG_WORKFLOW, 'a private deep copy, never the frozen constant');
  assert.equal(resolved.template.nodes.find((n) => n.id === 'n_defrag').key, 'memoryDefragmenter');
  assert.equal(resolved.nodes.n_defrag.model, 'claude-sonnet-5', 'the template pins Sonnet 5 as the default model');
});

// Defence in depth, exactly as test/workflows-auto-id.test.mjs pins for wf_auto: no legitimate path
// can mint the row, so force one in with raw SQL — without it the listWorkflows filter and the
// deleteWorkflow guard would be VACUOUS.
test('a rogue wf_memory_defrag ROW is hidden by listWorkflows, undeletable, and never wins over the constant', async () => {
  getDb().prepare(
    `INSERT INTO workflows (id, name, domain, version, steps, feedbacks, graph, created_at, updated_at)
     VALUES ('wf_memory_defrag', 'Rogue', 'coding', 2, '[]', '[]', ?, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
  ).run(JSON.stringify({ nodes: [], wires: [] }));
  assert.equal(await deleteWorkflow('wf_memory_defrag'), false, 'the reserved id is undeletable');
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_memory_defrag'), 'the rogue row survived');
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_memory_defrag'), 'the rogue row is never listed');
  assert.equal(await readWorkflow('wf_memory_defrag'), GRAPH_MEMORY_DEFRAG_WORKFLOW, 'the CONSTANT still wins');
});

test('Auto never mints the id; the Ask catalog lists the built-ins default first, defrag second, rows after', async () => {
  assert.equal(await mintAutoWorkflowId('memory_defrag', async () => false), 'wf_memory-defrag', 'slugify turns "_" into "-", so no NAME can mint the reserved id — the guard in proposal.mjs is defence in depth');
  const { buildCatalog } = createCatalog({
    listProjects: async () => [], listWorkspaces: async () => [],
    listWorkflows: async () => [{ ...GRAPH_MEMORY_DEFRAG_WORKFLOW, name: 'Shadow' }, { id: 'wf_x', name: 'X', version: 2, domain: 'coding', nodes: [], wires: [] }],
    loadAgentRegistry: () => loadAgentRegistry(),
  });
  const cat = await buildCatalog();
  assert.deepEqual(cat.workflows.map((w) => w.id), [GRAPH_DEFAULT_WORKFLOW.id, 'wf_memory_defrag', 'wf_x'], 'a stored twin of the built-in id is dropped');
  assert.equal(cat.workflows[1].name, 'Memory defragment');
  assert.deepEqual(cat.workflows[1].steps, [[{ nodeId: 'n_defrag', key: 'memoryDefragmenter', displayName: 'Memory defragment', description: 'Restructures one memory scope: merges duplicates, splits overgrown topics, drops stale rules, tightens hooks.' }]]);
  assert.ok(!cat.workflows.some((w) => w.id === AUTO_WORKFLOW_ID), 'Auto stays out of the catalog');
});

test('the composer treats every graph built-in as read-only (Save is Save-a-copy)', async () => {
  // The composer keeps its OWN twin of the reserved set (a Set, not the core Array): without a
  // pin, shrinking it back to just wf_default would let the UI overwrite the shipped built-in.
  const composer = await import('../ui/public/graph/composer.mjs');
  assert.deepEqual([...composer.RESERVED_WORKFLOW_IDS].sort(), ['wf_default', 'wf_memory_defrag']);
  assert.equal(composer.isReservedWorkflowId('wf_memory_defrag'), true);
  assert.equal(composer.isReservedWorkflowId('wf_auto'), false, 'wf_auto never reaches the composer');
  assert.equal(composer.isReservedWorkflowId('wf_memory-defrag'), false);
});
