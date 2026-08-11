// test/workflows-db.test.mjs
// workflows.mjs stores v2 GRAPH templates in SQLite (table: workflows, `graph`
// column); GRAPH_DEFAULT_WORKFLOW stays built-in and is never a row. Signatures
// unchanged (all async, same shapes). Per-test throwaway WORCA_HOME + DB reset.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listWorkflows, readWorkflow, writeWorkflow, deleteWorkflow } from '../src/core/workflows.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wfdb-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

/** task -> planner -> end, the smallest legal v2 graph. */
function graph(id, name) {
  return {
    id,
    name,
    version: 2,
    domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 560, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

/** Insert a v2 row the way the V17 migration does: the FULL flat template in `graph`. */
function insertRow(tpl, createdAt) {
  getDb().prepare(`
    INSERT INTO workflows (id, name, version, domain, graph, steps, feedbacks, created_at, updated_at)
    VALUES (?, ?, 2, ?, ?, '[]', '[]', ?, ?)
  `).run(tpl.id, tpl.name, tpl.domain, JSON.stringify({ ...tpl, createdAt }), createdAt, createdAt);
}

test('readWorkflow returns the built-in GRAPH_DEFAULT_WORKFLOW for "wf_default" (not a row)', async () => {
  const got = await readWorkflow('wf_default');
  assert.equal(got.id, 'wf_default');
  assert.equal(got.version, 2);
  assert.equal(got.nodes.length, 7);
  // It is NOT stored in the table.
  const row = getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_default');
  assert.equal(row, undefined, 'default workflow is never a DB row');
});

test('readWorkflow returns null for a missing id; listWorkflows is [] on an empty store', async () => {
  assert.equal(await readWorkflow('wf_nope'), null);
  assert.deepEqual(await listWorkflows(), []);
});

test('listWorkflows reads rows newest-first by created_at and parses the graph column', async () => {
  insertRow(graph('wf_a', 'A'), '2026-01-01T00:00:00.000Z');
  insertRow(graph('wf_b', 'B'), '2026-02-01T00:00:00.000Z');
  const list = await listWorkflows();
  assert.deepEqual(list.map((w) => w.id), ['wf_b', 'wf_a'], 'newest created_at first');
  assert.ok(Array.isArray(list[0].nodes) && Array.isArray(list[0].wires), 'graph parsed');
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'the built-in default is never in the user store');
});

test('readWorkflow parses a stored row into the flat template shape', async () => {
  insertRow(graph('wf_x', 'X'), '2026-03-01T00:00:00.000Z');
  const got = await readWorkflow('wf_x');
  assert.equal(got.name, 'X');
  assert.equal(got.version, 2);
  assert.equal(got.domain, 'coding');
  assert.deepEqual(got.nodes.map((n) => n.id), ['n_task', 'n_plan', 'n_end']);
  assert.deepEqual(got.wires.map((w) => w.id), ['w1', 'w2']);
  assert.equal(got.createdAt, '2026-03-01T00:00:00.000Z');
});

test('readWorkflow rejects path-traversal / unsafe ids (returns null)', async () => {
  for (const bad of ['../foo', 'a/b', 'foo.bar', 'foo bar', '', '.', '..']) {
    assert.equal(await readWorkflow(bad), null, `must reject "${bad}"`);
  }
});

test('writeWorkflow stamps id/version/createdAt/updatedAt and roundtrips through readWorkflow', async () => {
  const saved = await writeWorkflow({ ...graph(undefined, 'Quick Fix'), id: undefined });
  assert.match(saved.id, /^wf_quick-fix/);
  assert.equal(saved.name, 'Quick Fix');
  assert.equal(saved.version, 2);
  assert.ok(saved.createdAt && saved.updatedAt, 'timestamps stamped');
  // Persisted as a row whose `graph` column is the full flat template.
  const row = getDb().prepare('SELECT name, version, graph FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.name, 'Quick Fix');
  assert.equal(row.version, 2);
  assert.equal(JSON.parse(row.graph).nodes.length, 3);
  // Roundtrip.
  const got = await readWorkflow(saved.id);
  assert.deepEqual(got.nodes, saved.nodes);
  assert.deepEqual(got.wires, saved.wires);
});

test('writeWorkflow derives a wf_<slug> id from the name when id is missing', async () => {
  const saved = await writeWorkflow({ ...graph(undefined, 'My Cool Flow'), id: undefined });
  assert.match(saved.id, /^wf_my-cool-flow/);
});

test('writeWorkflow preserves createdAt but bumps updatedAt on re-save', async () => {
  const first = await writeWorkflow(graph('wf_x', 'X'));
  await new Promise((r) => setTimeout(r, 5));
  const second = await writeWorkflow({ ...first, name: 'X2', updatedAt: undefined });
  assert.equal(second.createdAt, first.createdAt, 'createdAt preserved on re-save');
  assert.equal(second.name, 'X2');
  assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt advanced');
  // Still a single row (upsert, not duplicate).
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_x');
  assert.equal(n, 1);
});

test('deleteWorkflow removes a saved row and returns true; missing id => false', async () => {
  const saved = await writeWorkflow(graph('wf_del', 'Del'));
  assert.equal(await deleteWorkflow(saved.id), true);
  assert.equal(await readWorkflow(saved.id), null);
  assert.equal(await deleteWorkflow('wf_ghost'), false);
});

test('deleteWorkflow refuses the built-in default and unsafe ids (returns false)', async () => {
  assert.equal(await deleteWorkflow('wf_default'), false);
  assert.equal((await readWorkflow('wf_default')).id, GRAPH_DEFAULT_WORKFLOW.id, 'default still readable');
  assert.equal(await deleteWorkflow('../SENTINEL'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
});
