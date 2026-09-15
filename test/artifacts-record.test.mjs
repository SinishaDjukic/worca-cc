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

test('recordArtifact keeps INSERT OR IGNORE: first write wins, no clobber', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'B', status: 'done' });
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-1', nodeId: 'planner', cycle: 0 });
  recordArtifact(id, 'plan', 'plans/plan.md', { stepKey: 'exec-2', nodeId: 'refiner', cycle: 1 });
  const row = getDb().prepare('SELECT step_key, cycle FROM artifacts WHERE pipeline_id=? AND kind=? AND rel_path=?')
    .get(id, 'plan', 'plans/plan.md');
  assert.equal(row.step_key, 'exec-1');
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

test('recordArtifacts indexes many rows in one transaction, INSERT OR IGNORE per row, one timestamp', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'D', status: 'done' });
  recordArtifact(id, 'markdown', 'steps/n_x-c1/first.md', { stepKey: 'exec-1', nodeId: 'n_x', cycle: 1 });
  const attr = { stepKey: 'exec-9', nodeId: 'n_x', cycle: 1 };
  recordArtifacts(id, [
    { kind: 'markdown', relPath: 'steps/n_x-c1/first.md', attr },   // ignored: first write wins
    { kind: 'text', relPath: 'steps/n_x-c1/a.txt', attr },
    { kind: 'json', relPath: 'steps/n_x-c1/b.json', attr },
    { kind: '', relPath: 'steps/n_x-c1/skipped', attr },             // no kind: skipped
    null,
  ]);
  const rows = getDb().prepare("SELECT kind, rel_path, step_key, created_at FROM artifacts WHERE pipeline_id=? AND rel_path LIKE 'steps/%' ORDER BY rel_path").all(id);
  assert.deepEqual(rows.map((r) => [r.kind, r.rel_path, r.step_key]), [
    ['json', 'steps/n_x-c1/b.json', 'exec-9'],
    ['text', 'steps/n_x-c1/a.txt', 'exec-9'],
    ['markdown', 'steps/n_x-c1/first.md', 'exec-1'],
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
