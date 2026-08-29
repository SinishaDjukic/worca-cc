import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import {
  writeWorkflow, writeGraphWorkflow, readWorkflow, listWorkflows,
  assertRunnableWorkflow, GRAPH_DEFAULT_WORKFLOW,
} from '../src/core/workflows.mjs';
import { createAgent, updateAgent } from '../src/core/agent-store.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';

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

// ── MAJ-15: the run gate re-validates the graph against the LIVE registry ──────
// A template is validated at SAVE time against the sidecars of that moment. Edit
// an agent's ports afterwards and nothing re-checks it: the run started and
// quiesced "done" with the reviewer never reached (lost output) or a node running
// on an empty binding (lost input). assertRunnableWorkflow is the ONE pre-spawn
// gate, so the check belongs there.
const PORTED_META = {
  metaVersion: 2, displayName: 'Rev X', description: 'reviews', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'review.md' }],
};
const PORTED_GRAPH = {
  id: 'wf_ports', name: 'Ported', domain: 'general',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'revX', x: 200, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w2', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('assertRunnableWorkflow refuses a template wired to a port its agent no longer declares', async () => {
  await createAgent({ meta: { ...PORTED_META, key: 'revX' }, markdown: '# body\n\nbody text\n' });
  await writeGraphWorkflow(PORTED_GRAPH);
  assert.equal((await assertRunnableWorkflow('wf_ports')).id, 'wf_ports', 'clean before the edit');
  // The user renames the output port in the Agents view. The store accepts it
  // (a rename must be possible), so the RUN is what has to refuse.
  await updateAgent('revX', {
    meta: { ...PORTED_META, key: 'revX', outputs: [{ id: 'verdictOut', type: 'md', filename: 'review.md' }] },
  });
  await assert.rejects(() => assertRunnableWorkflow('wf_ports'), (e) => {
    assert.equal(e.code, 'INVALID_GRAPH');
    assert.equal(e.message, 'workflow "wf_ports" no longer matches the agents it uses: '
      + "V5: wire 'w2': 'n_a.review' is not a declared output (wire w2); "
      + "V21: end node 'n_end' input 'result' must be wired (node n_end) "
      + '— open it in the Composer and re-wire it');
    assert.deepEqual(e.issues.map((i) => i.code), ['V5', 'V21']);
    return true;
  });
  // The READ path must still serve the row, or the user can never repair it.
  assert.equal((await assertRunnableWorkflow('wf_ports', { checkGraph: false })).id, 'wf_ports');
  // An injected registry wins over the live one (the run paths already hold one).
  const reg = loadAgentRegistry();
  await assert.rejects(() => assertRunnableWorkflow('wf_ports', { registry: reg }), (e) => e.code === 'INVALID_GRAPH');
});

test('the run gate refuses on ERRORS only — a warning-only template still runs', async () => {
  // V17 (level W): an unknown config key is "preserved and ignored". A validator
  // warning must never block a run, or every advisory rule becomes a hard stop.
  const warny = await writeGraphWorkflow({
    ...GRAPH, id: 'wf_warny',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: { somethingNewer: 1 } },
      { id: 'n_end', kind: 'end', x: 300, y: 0, config: {} }],
  });
  const rep = validateGraph(await readWorkflow(warny.id), registryPortsFn(loadAgentRegistry()));
  assert.deepEqual(rep.errors, []);
  assert.deepEqual(rep.warnings.map((w) => w.code), ['V17'], 'the fixture really is warning-only');
  assert.equal((await assertRunnableWorkflow('wf_warny')).id, 'wf_warny');
});

test('every shipped graph still passes the run gate', async () => {
  assert.equal((await assertRunnableWorkflow(GRAPH_DEFAULT_WORKFLOW.id)).id, GRAPH_DEFAULT_WORKFLOW.id);
  for (const t of SEED_TEMPLATES) {
    await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
    assert.equal((await assertRunnableWorkflow(t.id)).id, t.id, `${t.id} must stay runnable`);
  }
});
