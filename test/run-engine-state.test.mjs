// test/run-engine-state.test.mjs — a run's engine is part of its state (cascading-settings-design.md
// §4.2): written at start, read back from the row, and read as the resume point says (else Claude)
// for a run from before the field.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { readPipelineStateById, lookupPipelineRow, runEngineOfRow } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

const home = useTempHome(after);

test('a run names its engine in its state from the start', () => {
  assert.equal(createOrchestrator({ projectDir: '/tmp/re-proj', claude: { mock: true, engine: 'codex' } }).getState().runEngine, 'codex');
  assert.equal(createOrchestrator({ projectDir: '/tmp/re-proj', claude: { mock: true } }).getState().runEngine, 'claude');
});

test('the run engine survives the row; a Claude row stores nothing new', async () => {
  const cx = await seedPipeline(join(home, 'p-cx'), { engine: 2, runEngine: 'codex', status: 'done' });
  assert.equal(readPipelineStateById(cx.id).runEngine, 'codex');
  assert.equal(runEngineOfRow(lookupPipelineRow(cx.key, cx.id)), 'codex');
  const cl = await seedPipeline(join(home, 'p-cl'), { engine: 2, runEngine: 'claude', status: 'done' });
  assert.equal(readPipelineStateById(cl.id).runEngine, 'claude');
  const outcome = JSON.parse(getDb().prepare('SELECT outcome FROM pipelines WHERE id = ?').get(cl.id).outcome);
  assert.equal('runEngine' in outcome, false);
});

test('a run from before the field reads as its resume point says, else claude (Review Focus 3)', async () => {
  const paused = await seedPipeline(join(home, 'p-old'), { engine: 2, status: 'paused', resumePoint: { version: 2, claude: { engine: 'codex' } } });
  assert.equal(readPipelineStateById(paused.id).runEngine, 'codex');
  const old = await seedPipeline(join(home, 'p-older'), { status: 'done' });
  assert.equal(readPipelineStateById(old.id).runEngine, 'claude');
  assert.equal(runEngineOfRow(null), 'claude');
});

test('a completed v1 Codex run keeps its engine (Review Focus 8)', async () => {
  // A completed v1 row has no resume-point fallback, so outcome.runEngine must be emitted
  // solely because the run is non-Claude; `engine: 1` is the workflow graph version.
  const cx = await seedPipeline(join(home, 'p-v1-cx'), { engine: 1, runEngine: 'codex', status: 'done' });
  assert.equal(readPipelineStateById(cx.id).runEngine, 'codex');
  assert.equal(runEngineOfRow(lookupPipelineRow(cx.key, cx.id)), 'codex');
});
