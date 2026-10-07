// test/model-switch-claim.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { getDb } from '../src/core/db.mjs';
import { rewritePausedManifest } from '../src/core/artifacts.mjs';

useTempHome(after);

const rowOf = (id) => getDb().prepare('SELECT status, stepper, resume_point FROM pipelines WHERE id = ?').get(id);

test('rewrites stepper + resume_point only while the row is paused and unchanged', async () => {
  const dir = gitDir('msw-claim');
  const rp = graphResumePoint({ pipelineDir: dir });
  const { id } = await seedPipeline(dir, { status: 'paused', stepper: rp.manifest, resumePoint: rp });
  const before = rowOf(id).resume_point;
  const stepper = { ...rp.manifest, marker: 1 };
  assert.equal(rewritePausedManifest(id, { stepper, resumePoint: { ...rp, manifest: stepper }, expect: before }), true);
  assert.equal(JSON.parse(rowOf(id).stepper).marker, 1);
  assert.equal(JSON.parse(rowOf(id).resume_point).manifest.marker, 1);
  // A stale expectation (someone wrote in between) loses.
  assert.equal(rewritePausedManifest(id, { stepper, resumePoint: rp, expect: before }), false);
});

test('a row that is not paused is never rewritten', async () => {
  const dir = gitDir('msw-claim-np');
  const rp = graphResumePoint({ pipelineDir: dir });
  const { id } = await seedPipeline(dir, { status: 'interrupted', stepper: rp.manifest, resumePoint: rp });
  assert.equal(rewritePausedManifest(id, { stepper: rp.manifest, resumePoint: rp, expect: rowOf(id).resume_point }), false);
});
