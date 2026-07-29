// test/subagent-uiphase-roundtrip.test.mjs — ui_phase persists + reconstructs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipeline, readPipeline, upsertSubAgent } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

// Isolate the durable store: without this, createPipeline writes the pipelines row
// + run dir to the REAL ~/.worca-cc and orphans it (CREATED "demo" history records).
useTempHome(after, 'worca-cc-home-sub-uiphase-');

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
async function projDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-sub-uiphase-')); dirs.push(d); return d; }

test('upsertSubAgent persists uiPhase; readPipeline reconstructs it', async () => {
  const dir = await projDir();
  const pipeline = await createPipeline(dir, { prompt: 'demo' });
  upsertSubAgent(pipeline.id, {
    id: 'toolu_A', label: 'research', nodeId: 's0_0', uiPhase: 'plan',
    stepIndex: 0, cycle: 0, stepKey: '0:s0_0', status: 'running',
    startedAt: '2026-06-07T00:00:00.000Z', finishedAt: null,
  });
  const { state } = await readPipeline(dir, pipeline.id);
  assert.equal(state.subAgents.length, 1);
  assert.equal(state.subAgents[0].uiPhase, 'plan', 'uiPhase round-trips through the DB');
});

test('a finish UPSERT that omits uiPhase keeps the spawn-time value (COALESCE)', async () => {
  const dir = await projDir();
  const pipeline = await createPipeline(dir, { prompt: 'demo' });
  upsertSubAgent(pipeline.id, { id: 'toolu_B', nodeId: 's1_0', uiPhase: 'refine', status: 'running', startedAt: '2026-06-07T00:00:00.000Z' });
  upsertSubAgent(pipeline.id, { id: 'toolu_B', status: 'finished', finishedAt: '2026-06-07T00:00:05.000Z' });
  const { state } = await readPipeline(dir, pipeline.id);
  assert.equal(state.subAgents[0].uiPhase, 'refine', 'COALESCE keeps uiPhase across a finish that omits it');
});
