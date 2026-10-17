// test/workflows-db.test.mjs
// workflows.mjs stores user templates in SQLite (table: workflows); GRAPH_DEFAULT_WORKFLOW
// stays built-in. Signatures unchanged (all async, same shapes). Per-test throwaway
// WORCA_HOME + DB reset.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GRAPH_DEFAULT_WORKFLOW, listWorkflows, readWorkflow, writeWorkflow, deleteWorkflow,
} from '../src/core/workflows.mjs';
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

test('readWorkflow returns the built-in GRAPH_DEFAULT_WORKFLOW for "wf_default" (not a row)', async () => {
  const got = await readWorkflow('wf_default');
  assert.equal(got.id, 'wf_default');
  assert.equal(got, GRAPH_DEFAULT_WORKFLOW, 'the frozen constant itself');
  assert.equal(got.version, 2);
  // It is NOT stored in the table.
  const row = getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_default');
  assert.equal(row, undefined, 'default workflow is never a DB row');
});

test('readWorkflow returns null for a missing id; a fresh store carries only the wf_presentation, wf_architecture_c4 and wf_promo_video seeds', async () => {
  assert.equal(await readWorkflow('wf_nope'), null);
  assert.deepEqual((await listWorkflows()).map((w) => w.id).sort(), ['wf_architecture_c4', 'wf_presentation', 'wf_promo_video']);
});

test('listWorkflows reads rows newest-first by created_at and parses steps/feedbacks JSON', async () => {
  const db = getDb();
  const ins = db.prepare(
    'INSERT INTO workflows (id, name, version, steps, feedbacks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  ins.run('wf_a', 'A', 1, JSON.stringify([[{ id: 's0_0', key: 'planner' }]]), '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  ins.run('wf_b', 'B', 1, JSON.stringify([[{ id: 's0_0', key: 'planner' }]]), '[]', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  const list = await listWorkflows();
  // wf_presentation (schema V30), wf_architecture_c4 (V55) and wf_promo_video (V57) are shipped seeds on
  // every store — filter them out to pin the user-row ordering this test is about.
  const user = list.filter((w) => !['wf_presentation', 'wf_architecture_c4', 'wf_promo_video'].includes(w.id));
  assert.deepEqual(user.map((w) => w.id), ['wf_b', 'wf_a'], 'newest created_at first');
  assert.ok(Array.isArray(user[0].steps), 'steps parsed from JSON');
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'the built-in default is never in the user store');
});

test('readWorkflow parses a stored row into the template shape', async () => {
  getDb().prepare(
    'INSERT INTO workflows (id, name, version, steps, feedbacks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('wf_x', 'X', 1,
    JSON.stringify([[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]]),
    JSON.stringify([{ id: 'fb_0', from: 's1_0', to: 's0_0' }]),
    '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z');
  const got = await readWorkflow('wf_x');
  assert.equal(got.name, 'X');
  assert.equal(got.steps.length, 2);
  assert.deepEqual(got.feedbacks, [{ id: 'fb_0', from: 's1_0', to: 's0_0' }]);
});

test('readWorkflow rejects path-traversal / unsafe ids (returns null)', async () => {
  for (const bad of ['../foo', '../../etc/passwd', 'a/b', '..%2f..%2fx', 'foo.bar', 'foo bar', '', '.', '..']) {
    assert.equal(await readWorkflow(bad), null, `must reject "${bad}"`);
  }
});

test('deleteWorkflow removes a saved row and returns true; missing id => false', async () => {
  const saved = await writeWorkflow({ id: 'wf_del', name: 'Del', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow(saved.id), true);
  assert.equal(await readWorkflow(saved.id), null);
  assert.equal(await deleteWorkflow('wf_ghost'), false);
});

test('deleteWorkflow refuses the built-in default and unsafe ids (returns false)', async () => {
  assert.equal(await deleteWorkflow('wf_default'), false);
  assert.equal((await readWorkflow('wf_default')).id, 'wf_default', 'default still readable');
  assert.equal(await deleteWorkflow('../SENTINEL'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
});

// The two reserved-id guards are defence-in-depth: writeGraphWorkflow refuses to
// mint `wf_default`, so no legitimate path can create the row this pins. Force it
// in with raw SQL (a hand-edited or corrupted store) — listWorkflows must still
// hide it and deleteWorkflow must still refuse it, or the built-in default would
// appear twice in the picker and become deletable.
test('a rogue wf_default ROW is hidden by listWorkflows and undeletable', async () => {
  await freshHome();
  getDb().prepare(
    `INSERT INTO workflows (id, name, domain, version, steps, feedbacks, graph, created_at, updated_at)
     VALUES ('wf_default', 'Rogue', 'coding', 2, '[]', '[]', ?, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
  ).run(JSON.stringify({ nodes: [], wires: [] }));
  assert.equal(await deleteWorkflow('wf_default'), false, 'the reserved id is undeletable');
  assert.ok(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_default'), 'the rogue row survived');
  const list = await listWorkflows();
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'the rogue row is never listed');
  assert.equal((await readWorkflow('wf_default')).name, GRAPH_DEFAULT_WORKFLOW.name, 'the CONSTANT still wins');
});

test('writeWorkflow persists domain; readWorkflow round-trips; malformed/blank → general', async () => {
  await freshHome();
  await writeWorkflow({ id: 'wf_mk', name: 'Campaign', steps: [], feedbacks: [], domain: 'marketing' });
  const got = await readWorkflow('wf_mk');          // exercises readRaw's OWN SELECT
  assert.equal(got.domain, 'marketing');

  await writeWorkflow({ id: 'wf_bad', name: 'X', steps: [], feedbacks: [], domain: 'Bad Domain!' });
  assert.equal((await readWorkflow('wf_bad')).domain, 'general');

  await writeWorkflow({ id: 'wf_none', name: 'Y', steps: [], feedbacks: [] });   // absent
  assert.equal((await readWorkflow('wf_none')).domain, 'general');
});

test('pre-migration row reads back as general (COALESCE) via list + read', async () => {
  await freshHome();
  const db = getDb();
  db.exec("INSERT INTO workflows (id,name,version,steps,feedbacks,created_at,updated_at) " +
          "VALUES ('wf_old','Old',1,'[]','[]','1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z')");
  const list = await listWorkflows();
  assert.equal(list.find((w) => w.id === 'wf_old').domain, 'general');   // list path
  assert.equal((await readWorkflow('wf_old')).domain, 'general');        // readRaw path
});

// --- Security: unsafe-id guard on workflow ids -----------------------------
// The id keys the workflows table (no path is built from it anymore). The guard
// still rejects anything outside ^[A-Za-z0-9_-]+$ (covers wf_default + wf_<slug>),
// so unsafe ids never read or mutate a row.
test('deleteWorkflow refuses unsafe ids and deletes nothing real', async () => {
  await freshHome();
  const saved = await writeWorkflow({ id: 'wf_keep', name: 'Keep', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow('../wf_keep'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
  assert.ok(await readWorkflow('wf_keep'), 'a real saved workflow survives an unsafe-id delete');
  void saved;
});

test('wf_default IS the graph default; the v1 topology and its alias are gone', async () => {
  await freshHome();
  const tpl = await readWorkflow('wf_default');
  assert.equal(tpl.version, 2);
  assert.equal(tpl.id, 'wf_default');
  assert.equal(tpl.name, 'Default');
  assert.equal(tpl.nodes.length, 7);
  assert.equal(tpl.wires.length, 10);
  assert.equal(tpl.steps, undefined, 'no v1 topology on the default any more');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.id, 'wf_default');
  // Both retired ids are ordinary unknown ids now: the coexistence alias went in
  // P8a, the v1 engine's private default went with the engine.
  assert.equal(await readWorkflow('wf_default_v2'), null, 'the coexistence alias is retired');
  assert.equal(await readWorkflow('wf_default_v1'), null, 'the v1 engine default died with the engine');
});
