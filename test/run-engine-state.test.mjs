// test/run-engine-state.test.mjs — a run's engine is part of its state (cascading-settings-design.md
// §4.2): written at start, read back from the row, and read as the resume point says (else Claude)
// for a run from before the field.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { readPipelineStateById, lookupPipelineRow, runEngineOfRow, runEnginesOfRow, listPipelines } from '../src/core/artifacts.mjs';
import { gitDir } from './helpers/git-dir.mjs';
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

test('runEngines: kept for a run that used several harnesses, read back by the row, the detail and the list; never for one harness', async () => {
  const mx = await seedPipeline(join(home, 'p-mx'), { engine: 2, runEngine: 'claude', runEngines: ['claude', 'codex'], status: 'done' });
  assert.deepEqual(readPipelineStateById(mx.id).runEngines, ['claude', 'codex']);
  assert.deepEqual(runEnginesOfRow(lookupPipelineRow(mx.key, mx.id)), ['claude', 'codex']);
  assert.deepEqual((await listPipelines(join(home, 'p-mx'))).find((p) => p.id === mx.id).runEngines, ['claude', 'codex']);
  const one = await seedPipeline(join(home, 'p-one'), { engine: 2, runEngine: 'codex', status: 'done' });
  assert.equal('runEngines' in readPipelineStateById(one.id), false);
  assert.equal('runEngines' in JSON.parse(getDb().prepare('SELECT outcome FROM pipelines WHERE id = ?').get(one.id).outcome), false);
});
test('a run whose steps use Claude Code and Codex says so in its state', async () => {
  const o = createOrchestrator({ projectDir: gitDir('re-mixed'), workflowId: 'wf_default', prompt: 'demo', auto: true, guardrailsId: 'permissive',
    claude: { mock: true }, overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } } });
  assert.equal((await o.run()).status, 'done');
  assert.deepEqual(o.getState().runEngines, ['claude', 'codex']);
  assert.equal(o.getState().runEngine, 'claude');
});
test('a run whose steps all use one harness has no runEngines in its state', async () => {
  for (const engine of ['claude', 'codex']) {
    const o = createOrchestrator({ projectDir: gitDir(`re-one-${engine}`), workflowId: 'wf_default', prompt: 'demo', auto: true, guardrailsId: 'permissive',
      claude: { mock: true, engine, allowUnguardedEngine: true } });
    const res = await o.run();
    assert.equal(res.status, 'done', res.error);
    assert.equal('runEngines' in o.getState(), false, engine);
  }
});
