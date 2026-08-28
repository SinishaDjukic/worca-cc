// test/workflows.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GRAPH_DEFAULT_WORKFLOW,
  workflowsDir,
  listWorkflows,
  readWorkflow,
  writeWorkflow,
  deleteWorkflow,
} from '../src/core/workflows.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

// Each test gets its own ~/.worca-cc via WORCA_HOME so the global store is
// isolated and nothing touches the developer's real home dir. The DB singleton is
// reset so the next getDb() reopens against the fresh WORCA_HOME.
const homes = [];
async function freshHome() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  homes.push(d);
  _resetForTests();
  process.env.WORCA_HOME = d;
  return d;
}
const projects = [];
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  projects.push(d);
  return d;
}
after(async () => {
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...projects].map((d) => rm(d, { recursive: true, force: true })));
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

test('workflowsDir is <WORCA_HOME>/.worca-cc/workflows', async () => {
  const home = await freshHome();
  assert.equal(workflowsDir(), join(home, '.worca-cc', 'workflows'));
});

test('writeWorkflow stamps id/createdAt/updatedAt and roundtrips through readWorkflow', async () => {
  await freshHome();
  const saved = await writeWorkflow({
    name: 'Quick Fix',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
    feedbacks: [],
  });
  assert.match(saved.id, /^wf_/);
  assert.equal(saved.name, 'Quick Fix');
  assert.equal(saved.version, 1);
  assert.ok(saved.createdAt && saved.updatedAt, 'timestamps stamped');

  // Persisted as a row in the workflows table (storage is SQLite now, not <id>.json).
  const row = getDb().prepare('SELECT name FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.name, 'Quick Fix');

  const got = await readWorkflow(saved.id);
  assert.deepEqual(got.steps, saved.steps);
  assert.deepEqual(got.feedbacks, saved.feedbacks);
});

test('writeWorkflow derives a wf_<slug> id from the name when id is missing', async () => {
  await freshHome();
  const saved = await writeWorkflow({ name: 'My Cool Flow', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.match(saved.id, /^wf_my-cool-flow/);
});

test('writeWorkflow preserves createdAt but bumps updatedAt on re-save', async () => {
  await freshHome();
  const first = await writeWorkflow({ id: 'wf_x', name: 'X', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  const second = await writeWorkflow({ ...first, name: 'X2', updatedAt: undefined });
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.name, 'X2');
});

test('listWorkflows returns user templates sorted newest-first; excludes wf_default', async () => {
  await freshHome();
  const a = await writeWorkflow({ id: 'wf_a', name: 'A', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [], createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await writeWorkflow({ id: 'wf_b', name: 'B', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [], createdAt: '2026-02-01T00:00:00.000Z' });
  const list = await listWorkflows();
  assert.deepEqual(list.map((w) => w.id), ['wf_b', 'wf_a']); // newest createdAt first
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'LEGACY_DEFAULT_WORKFLOW is not in the user store');
});

test('readWorkflow returns null for a missing id; listWorkflows is [] on an empty store', async () => {
  await freshHome();
  assert.equal(await readWorkflow('wf_nope'), null);
  assert.deepEqual(await listWorkflows(), []);
});

test('deleteWorkflow removes a saved template and returns true', async () => {
  await freshHome();
  const saved = await writeWorkflow({ id: 'wf_del', name: 'Del', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow(saved.id), true);
  assert.equal(await readWorkflow(saved.id), null);
  const row = getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_del');
  assert.equal(row, undefined, 'row gone after delete');
});

test('deleteWorkflow returns false for a missing id', async () => {
  await freshHome();
  assert.equal(await deleteWorkflow('wf_ghost'), false);
});

test('deleteWorkflow refuses to delete the built-in default (returns false, leaves it readable)', async () => {
  await freshHome();
  assert.equal(await deleteWorkflow('wf_default'), false);
  const still = await readWorkflow('wf_default');
  assert.equal(still.id, 'wf_default'); // LEGACY_DEFAULT_WORKFLOW is always present
});

// --- Security: unsafe-id guard on workflow ids -----------------------------
// The id keys the workflows table (no path is built from it anymore). The guard
// still rejects anything outside ^[A-Za-z0-9_-]+$ (covers wf_default + wf_<slug>),
// so unsafe ids never read or mutate a row.
test('readWorkflow rejects path-traversal / unsafe ids (returns null)', async () => {
  await freshHome();
  for (const bad of ['../foo', '../../etc/passwd', 'a/b', '..%2f..%2fx', 'foo.bar', 'foo bar', '', '.', '..']) {
    assert.equal(await readWorkflow(bad), null, `readWorkflow must reject "${bad}"`);
  }
});
test('deleteWorkflow refuses unsafe ids and deletes nothing real', async () => {
  await freshHome();
  const saved = await writeWorkflow({ id: 'wf_keep', name: 'Keep', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow('../wf_keep'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
  assert.ok(await readWorkflow('wf_keep'), 'a real saved workflow survives an unsafe-id delete');
  void saved;
});
test('writeWorkflow still works and ids round-trip (guard does not break valid ids)', async () => {
  await freshHome();
  const saved = await writeWorkflow({ name: 'My Cool Flow', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.match(saved.id, /^wf_/);
  assert.ok(await readWorkflow(saved.id), 'a valid derived id still reads back');
  assert.equal(await deleteWorkflow(saved.id), true);
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

test('the reserved default id can never be minted by a save', async () => {
  await freshHome();
  // A save may not claim the built-in id: it falls back to the name slug, so the
  // picker can never show two "Default"s. (The rogue-ROW half — a hand-edited
  // store — is pinned in workflows-db.test.mjs.)
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const saved = await writeGraphWorkflow({ id: 'wf_default', name: 'Claimed', nodes: [], wires: [] });
  assert.notEqual(saved.id, 'wf_default', 'wf_default is reserved and unmintable');
  assert.equal(saved.id, 'wf_claimed');
});
