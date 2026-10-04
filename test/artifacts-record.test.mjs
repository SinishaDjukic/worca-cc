// test/artifacts-record.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { recordArtifact, recordArtifacts, hasArtifactRow } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

test('recordArtifact stamps attribution on the first insert', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'A', status: 'done' });
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
  const row = getDb().prepare(
    'SELECT step_key, node_id, cycle, created_at FROM artifacts WHERE pipeline_id=? AND kind=? AND rel_path=?',
  ).get(id, 'plan', 'plans/plan.md');
  assert.equal(row.step_key, 'exec-1');
  assert.equal(row.node_id, 'planner');
  assert.equal(row.cycle, 0);
  assert.ok(row.created_at, 'created_at is stamped');
});

// One row per FILE, attributed to whoever LAST wrote it. A fix loop rewrites the
// same paths every cycle — deck-manifest.md, deck/deck.html, and shots/sNN.png,
// which the audit deletes and recreates — so first-write-wins left a three-cycle
// run claiming its rebuilt deliverables came from cycle 1, which for the reshot
// screenshots was not merely stale but false. created_at stays first-seen,
// because listRunArtifacts orders by it.
test('recordArtifact re-attributes a rewritten file to the latest writer', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'B', status: 'done' });
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
  const first = getDb().prepare('SELECT created_at FROM artifacts WHERE pipeline_id=? AND rel_path=?')
    .get(id, 'plans/plan.md').created_at;
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-2', nodeId: 'refiner', cycle: 1 });

  const rows = getDb().prepare('SELECT step_key, node_id, cycle, created_at FROM artifacts WHERE pipeline_id=? AND kind=? AND rel_path=?')
    .all(id, 'plan', 'plans/plan.md');
  assert.equal(rows.length, 1, 'still one row per file — the path is the identity');
  assert.equal(rows[0].step_key, 'exec-2');
  assert.equal(rows[0].node_id, 'refiner');
  assert.equal(rows[0].cycle, 1);
  assert.equal(rows[0].created_at, first, 'created_at is first-seen and never moves');
});

test('recordArtifact without attribution never erases the attribution already there', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'B2', status: 'done' });
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
  recordArtifact(id, 'plan', 'plans/plan.md');                       // a 2-arg legacy call
  const row = getDb().prepare('SELECT step_key, node_id, cycle FROM artifacts WHERE pipeline_id=? AND kind=? AND rel_path=?')
    .get(id, 'plan', 'plans/plan.md');
  assert.equal(row.step_key, 'exec-1');
  assert.equal(row.node_id, 'planner');
  assert.equal(row.cycle, 0);
});

test('recordArtifact 3-arg form still works (NULL attribution)', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'C', status: 'done' });
  recordArtifact(id, 'prompt', 'prompt.md');
  const row = getDb().prepare('SELECT step_key, node_id, cycle FROM artifacts WHERE pipeline_id=? AND kind=? AND rel_path=?')
    .get(id, 'prompt', 'prompt.md');
  assert.equal(row.step_key, null);
  assert.equal(row.node_id, null);
  assert.equal(row.cycle, null);
});

test('recordArtifacts indexes many rows in one transaction, last writer wins per row, one timestamp', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'D', status: 'done' });
  recordArtifact(id, 'markdown', 'steps/n_x-c1/first.md', { stepKey: 'exec-1', nodeId: 'n_x', cycle: 1 });
  const attr = { stepKey: 'exec-9', nodeId: 'n_x', cycle: 1 };
  recordArtifacts(id, [
    { kind: 'markdown', relPath: 'steps/n_x-c1/first.md', attr },   // re-attributed: the last writer wins
    { kind: 'text', relPath: 'steps/n_x-c1/a.txt', attr },
    { kind: 'json', relPath: 'steps/n_x-c1/b.json', attr },
    { kind: '', relPath: 'steps/n_x-c1/skipped', attr },             // no kind: skipped
    null,
  ]);
  const rows = getDb().prepare("SELECT kind, rel_path, step_key, created_at FROM artifacts WHERE pipeline_id=? AND rel_path LIKE 'steps/%' ORDER BY rel_path").all(id);
  assert.deepEqual(rows.map((r) => [r.kind, r.rel_path, r.step_key]), [
    ['json', 'steps/n_x-c1/b.json', 'exec-9'],
    ['text', 'steps/n_x-c1/a.txt', 'exec-9'],
    ['markdown', 'steps/n_x-c1/first.md', 'exec-9'],
  ].sort((x, y) => (x[1] < y[1] ? -1 : 1)));
  assert.equal(rows.find((r) => r.rel_path === 'steps/n_x-c1/a.txt').created_at, rows.find((r) => r.rel_path === 'steps/n_x-c1/b.json').created_at, 'one batch, one timestamp');
  recordArtifacts(id, []);   // no-op
  recordArtifacts(null, [{ kind: 'text', relPath: 'x' }]);   // no-op
});

test('hasArtifactRow is kind-agnostic and fail-safe', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'E', status: 'done' });
  assert.equal(hasArtifactRow(id, 'steps/n_x-c1/plan.md'), false);
  recordArtifact(id, 'plan', 'steps/n_x-c1/plan.md', { stepKey: 'exec-1', nodeId: 'n_x', cycle: 1 });
  assert.equal(hasArtifactRow(id, 'steps/n_x-c1/plan.md'), true, 'found under any kind');
  assert.equal(hasArtifactRow(id, 'steps/n_x-c1/other.md'), false);
  assert.equal(hasArtifactRow(null, 'steps/n_x-c1/plan.md'), false);
  assert.equal(hasArtifactRow(id, ''), false);
});
