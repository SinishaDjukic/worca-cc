import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import {
  writeWorkflow, writeGraphWorkflow, readWorkflow, listWorkflows,
  assertRunnableWorkflow, GRAPH_DEFAULT_WORKFLOW,
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


// C-3: writeGraphWorkflow guarded the ASKED id against wf_default but not the
// MINTED one, so any name slugging to "default" wrote a row listWorkflows()
// filters out, readWorkflow() short-circuits past and DELETE refuses — the
// user's pipeline vanished behind a 201.
test('a name that slugs onto the reserved default id is refused, not silently re-minted', async () => {
  const count = () => prepare('SELECT COUNT(*) AS n FROM workflows').get().n;
  const before = count();
  for (const name of ['Default', '  dEfAuLt  ', 'default!!', 'DEFAULT', '--default--', 'Défault']) {
    await assert.rejects(
      () => writeGraphWorkflow({ ...GRAPH, name }),
      (err) => {
        assert.equal(err.code, 'RESERVED_NAME', `code for ${JSON.stringify(name)}`);
        assert.equal(err.message, 'the name "Default" is reserved — choose another name');
        return true;
      },
      `name ${JSON.stringify(name)} must be refused`);
  }
  assert.equal(count(), before, 'no row was written for any of them');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_default').n, 0);
  assert.equal((await listWorkflows()).some((w) => w.id === 'wf_default'), false);
  // A name that merely CONTAINS "default" is untouched.
  assert.equal((await writeGraphWorkflow({ ...GRAPH, name: 'de fault' })).id, 'wf_de-fault');
});

// MAJ-5: an id MINTED from the name (what Save-a-copy sends — no body.id) used
// to UPSERT over whatever already sat on wf_<slug>, keeping the victim's
// created_at so the clobber left no trace. `rejectCollision` is opt-in so the
// importers/seeders that legitimately re-write a row keep their upsert.
test('rejectCollision refuses a MINTED id that already exists; an in-place save is unaffected', async () => {
  const first = await writeGraphWorkflow({ ...GRAPH, name: 'Full copy' }, { rejectCollision: true });
  assert.equal(first.id, 'wf_full-copy');
  assert.equal(first.nodes.length, 2);
  const bigger = { ...GRAPH, name: 'Full copy', nodes: [...GRAPH.nodes, { id: 'n_extra', kind: 'end', x: 600, y: 0, config: {} }] };
  await assert.rejects(
    () => writeGraphWorkflow(bigger, { rejectCollision: true }),
    (err) => {
      assert.equal(err.code, 'ID_TAKEN');
      assert.equal(err.id, 'wf_full-copy');
      assert.equal(err.message, 'a pipeline with the id "wf_full-copy" already exists — choose another name');
      return true;
    });
  const victim = await readWorkflow('wf_full-copy');
  assert.equal(victim.nodes.length, 2, 'the victim graph is untouched');
  assert.equal(victim.createdAt, first.createdAt);
  assert.equal(victim.updatedAt, first.updatedAt, 'not even updated_at moved');

  // An IN-PLACE save carries body.id — that is a deliberate overwrite, never a collision.
  const inPlace = await writeGraphWorkflow({ ...bigger, id: 'wf_full-copy' }, { rejectCollision: true });
  assert.equal(inPlace.id, 'wf_full-copy');
  assert.equal(inPlace.nodes.length, 3);
  // And WITHOUT the option the old upsert stands (importers, seeds, tests).
  assert.equal((await writeGraphWorkflow({ ...GRAPH, name: 'Full copy' })).id, 'wf_full-copy');
  assert.equal((await readWorkflow('wf_full-copy')).nodes.length, 2);
});
