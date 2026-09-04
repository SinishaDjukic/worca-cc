// test/artifacts-progress.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { readRunProgress } from '../src/core/artifacts.mjs';

useTempHome(after);

test('readRunProgress aggregates phase/status/phases/tasks/extras', async () => {
  const { id } = await seedPipeline(process.cwd(), { title: 'A', status: 'done', phase: 'review' });
  const p = await readRunProgress(id);
  assert.equal(p.runId, id);
  assert.equal(p.status, 'done');
  assert.ok(Array.isArray(p.phases));
  assert.ok(Array.isArray(p.tasks));
  assert.ok(p.clarify && Array.isArray(p.reviews) && Array.isArray(p.stepQuestions));
});

test('readRunProgress returns null for an unknown run', async () => {
  assert.equal(await readRunProgress('deadbeef'), null);
});
