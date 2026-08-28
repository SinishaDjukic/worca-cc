import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import {
  writeWorkflow, writeGraphWorkflow, readWorkflow, listWorkflows,
  assertRunnableWorkflow, resolveWorkflow, GRAPH_DEFAULT_WORKFLOW,
} from '../src/core/workflows.mjs';

useTempHome(after);

const GRAPH = {
  name: 'Graph One', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }],
};
const archive = (id) => { getDb(); prepare('UPDATE workflows SET archived_at = ? WHERE id = ?').run('2026-08-27T00:00:00Z', id); };

test('writeGraphWorkflow stores version 2 with graph JSON and empty v1 columns', async () => {
  const saved = await writeGraphWorkflow(GRAPH);
  assert.equal(saved.id, 'wf_graph-one');
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.nodes.map((n) => n.id), ['n_task', 'n_end']);
  const row = prepare('SELECT version, graph, steps, feedbacks, archived_at FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.version, 2);
  assert.deepEqual(Object.keys(JSON.parse(row.graph)).sort(), ['nodes', 'wires']);
  assert.equal(row.steps, '[]');
  assert.equal(row.feedbacks, '[]');
  assert.equal(row.archived_at, null);
});

test('the id rule: an explicit safe id wins, the reserved ids never do', async () => {
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_custom' })).id, 'wf_custom');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_default' })).id, 'wf_graph-one');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: 'wf_default' })).id, 'wf_graph-one');
  assert.equal((await writeGraphWorkflow({ ...GRAPH, id: '../escape' })).id, 'wf_graph-one');
});

test('a re-save that omits origin keeps it (plugin rows stay plugin-owned)', async () => {
  const owned = await writeGraphWorkflow({ ...GRAPH, id: 'wfp_owned', origin: 'plugin:demo' });
  assert.equal(owned.origin, 'plugin:demo');
  const resaved = await writeGraphWorkflow({ ...GRAPH, id: 'wfp_owned', name: 'Renamed' });
  assert.equal(resaved.origin, 'plugin:demo', 'the composer never sends origin — it must not be cleared');
  assert.equal(prepare('SELECT origin FROM workflows WHERE id = ?').get('wfp_owned').origin, 'plugin:demo');
});

test('rowToTpl is version-aware: v2 rows carry nodes/wires, v1 rows steps/feedbacks', async () => {
  const v2 = await readWorkflow((await writeGraphWorkflow({ ...GRAPH, id: 'wf_v2' })).id);
  assert.equal(v2.version, 2);
  assert.equal('steps' in v2, false);
  assert.ok(Array.isArray(v2.wires));
  const v1 = await writeWorkflow({ name: 'Legacy', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  const back = await readWorkflow(v1.id);
  assert.equal(back.version, 1);
  assert.ok(Array.isArray(back.steps));
  assert.equal('nodes' in back, false);
});

test('archiving hides a row from readWorkflow and listWorkflows', async () => {
  const saved = await writeGraphWorkflow({ ...GRAPH, id: 'wf_arch' });
  archive(saved.id);
  assert.equal(await readWorkflow(saved.id), null);
  assert.equal((await readWorkflow(saved.id, { includeArchived: true })).id, saved.id);
  assert.equal((await listWorkflows()).some((w) => w.id === saved.id), false);
  assert.equal((await listWorkflows({ includeArchived: true })).some((w) => w.id === saved.id), true);
  const again = await writeGraphWorkflow({ ...GRAPH, id: 'wf_arch' });
  assert.equal(again.id, 'wf_arch');
  assert.equal((await readWorkflow('wf_arch')).id, 'wf_arch', 'saving over an archived id un-archives it');
});

test('assertRunnableWorkflow: NOT_FOUND, ARCHIVED (verbatim), and the happy path', async () => {
  const saved = await writeGraphWorkflow({ ...GRAPH, id: 'wf_run' });
  assert.equal((await assertRunnableWorkflow(saved.id)).id, 'wf_run');
  assert.equal((await assertRunnableWorkflow(GRAPH_DEFAULT_WORKFLOW.id)).id, GRAPH_DEFAULT_WORKFLOW.id);
  await assert.rejects(() => assertRunnableWorkflow('wf_ghost'), (e) => {
    assert.equal(e.code, 'NOT_FOUND');
    assert.equal(e.message, 'unknown workflowId "wf_ghost"');
    return true;
  });
  archive('wf_run');
  await assert.rejects(() => assertRunnableWorkflow('wf_run'), (e) => {
    assert.equal(e.code, 'ARCHIVED');
    assert.equal(e.message, 'workflow "wf_run" was archived by the v2 upgrade (v1 template, not runnable) '
      + '— pick a v2 pipeline or rebuild it in the Composer');
    return true;
  });
});

test('resolveWorkflow refuses a graph row', async () => {
  await writeGraphWorkflow({ ...GRAPH, id: 'wf_resolve' });
  await assert.rejects(() => resolveWorkflow(process.cwd(), 'wf_resolve', {}),
    /^Error: template is a graph — runs on the graph engine$/);
});
