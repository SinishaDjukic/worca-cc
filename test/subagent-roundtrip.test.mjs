// test/subagent-roundtrip.test.mjs — orchestrator → DB → readPipeline reconstructs subAgents
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipeline, readPipeline, upsertSubAgent } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

// Isolate the durable store: without this, createPipeline writes the pipelines row
// + run dir to the REAL ~/.worca-cc and orphans it (CREATED "demo" history records).
useTempHome(after, 'worca-cc-home-sub-persist-');

const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
async function projDir() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-sub-persist-'));
  dirs.push(d);
  return d;
}

test('upsertSubAgent rows reconstruct into state.subAgents via readPipeline', async () => {
  const dir = await projDir();
  const pipeline = await createPipeline(dir, { prompt: 'demo' });
  upsertSubAgent(pipeline.id, {
    id: 'toolu_A', label: 'research auth', nodeId: 'n1', stepIndex: 0, cycle: 1,
    stepKey: '0:n1', status: 'running', startedAt: '2026-06-07T00:00:00.000Z', finishedAt: null,
  });
  // a finish UPSERT on the same id must not duplicate; it updates the row.
  upsertSubAgent(pipeline.id, {
    id: 'toolu_A', status: 'finished', finishedAt: '2026-06-07T00:00:05.000Z',
    durationMs: 5000, tokens: 1200, costUsd: 0.01,
  });
  const { state } = await readPipeline(dir, pipeline.id);
  assert.ok(Array.isArray(state.subAgents), 'state.subAgents is reconstructed');
  assert.equal(state.subAgents.length, 1, 'UPSERT, not duplicate-insert');
  const r = state.subAgents[0];
  assert.equal(r.id, 'toolu_A');
  assert.equal(r.label, 'research auth', 'COALESCE keeps the first non-null label');
  assert.equal(r.status, 'finished');
  assert.equal(r.finishedAt, '2026-06-07T00:00:05.000Z');
  assert.equal(r.nodeId, 'n1');
  assert.equal(r.stepKey, '0:n1');
  assert.equal(r.durationMs, 5000);
  assert.equal(r.tokens, 1200);
  assert.equal(r.costUsd, 0.01);
});
