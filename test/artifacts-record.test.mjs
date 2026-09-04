// test/artifacts-record.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
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
