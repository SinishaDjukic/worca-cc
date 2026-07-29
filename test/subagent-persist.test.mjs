// test/subagent-persist.test.mjs
// Layer A (DB) — upsertSubAgent / listSubAgents round-trip + idempotency + anti-clobber.
// Seeds the FK-parent pipelines row via the production seedPipeline helper, then drives
// the two new helpers directly: a spawn INSERT, an idempotent status-only UPDATE that
// must NOT null the COALESCE-guarded columns (label/started_at/duration_ms/tokens/
// cost_usd), the camelCase row->record mapping, and started_at,id ordering.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { upsertSubAgent, listSubAgents } from '../src/core/artifacts.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-subagent-persist-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('upsertSubAgent inserts a running record; listSubAgents returns the camelCase shape', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, {
    id: 'toolu_aaa', label: 'investigate auth', nodeId: 's2_0', stepIndex: 2,
    cycle: 1, stepKey: '2:s2_0#1', status: 'running', startedAt: '2026-06-07T00:00:01Z',
  });

  const list = listSubAgents(pid);
  assert.equal(list.length, 1, 'one sub-agent persisted');
  assert.deepEqual(list[0], {
    id: 'toolu_aaa', label: 'investigate auth', nodeId: 's2_0', stepIndex: 2,
    cycle: 1, stepKey: '2:s2_0#1', status: 'running',
    startedAt: '2026-06-07T00:00:01Z', finishedAt: null,
    durationMs: null, tokens: null, costUsd: null, uiPhase: null, skills: [],
    subagentType: null, graphifyCount: null,
  }, 'row maps back to the shared camelCase record shape');
});

test('upsertSubAgent is idempotent on (pipeline_id,id) and a status update keeps the row count at 1', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, { id: 'toolu_bbb', label: 'L', nodeId: 's1_0', stepIndex: 1,
    cycle: 0, stepKey: '1:s1_0', status: 'running', startedAt: '2026-06-07T00:00:02Z' });
  // Finish: a SECOND upsert with the SAME id transitions status + sets finishedAt.
  upsertSubAgent(pid, { id: 'toolu_bbb', status: 'finished', finishedAt: '2026-06-07T00:00:09Z' });

  const list = listSubAgents(pid);
  assert.equal(list.length, 1, 'the second upsert updated the same row (no duplicate)');
  assert.equal(list[0].status, 'finished', 'status transitioned to finished');
  assert.equal(list[0].finishedAt, '2026-06-07T00:00:09Z', 'finishedAt set on the update');
});

test('a status-only update never nulls the COALESCE-guarded columns (label/started_at/telemetry)', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  // Spawn carries label + startedAt; a later telemetry upsert fills duration/tokens/cost.
  upsertSubAgent(pid, { id: 'toolu_ccc', label: 'build index', nodeId: 's0_0', stepIndex: 0,
    cycle: 0, stepKey: '0:s0_0', status: 'running', startedAt: '2026-06-07T00:00:03Z' });
  upsertSubAgent(pid, { id: 'toolu_ccc', durationMs: 4200, tokens: 1500, costUsd: 0.012 });
  // Finish update carries ONLY status + finishedAt (no label/started/telemetry).
  upsertSubAgent(pid, { id: 'toolu_ccc', status: 'finished', finishedAt: '2026-06-07T00:00:12Z' });

  const rec = listSubAgents(pid)[0];
  assert.equal(rec.label, 'build index', 'label preserved by COALESCE across the finish update');
  assert.equal(rec.startedAt, '2026-06-07T00:00:03Z', 'started_at preserved (never re-nulled)');
  assert.equal(rec.durationMs, 4200, 'duration_ms preserved across the finish update');
  assert.equal(rec.tokens, 1500, 'tokens preserved');
  assert.equal(rec.costUsd, 0.012, 'cost_usd preserved');
  assert.equal(rec.status, 'finished', 'status still advanced to finished');
  assert.equal(rec.finishedAt, '2026-06-07T00:00:12Z', 'finishedAt set');
});

test('listSubAgents orders by (started_at, id)', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  // Insert out of order; same started_at for two rows to exercise the id tiebreak.
  upsertSubAgent(pid, { id: 'toolu_z', status: 'running', startedAt: '2026-06-07T00:00:05Z' });
  upsertSubAgent(pid, { id: 'toolu_a', status: 'running', startedAt: '2026-06-07T00:00:05Z' });
  upsertSubAgent(pid, { id: 'toolu_m', status: 'running', startedAt: '2026-06-07T00:00:01Z' });

  assert.deepEqual(listSubAgents(pid).map((r) => r.id), ['toolu_m', 'toolu_a', 'toolu_z'],
    'earliest started_at first; ties broken by id ascending');
});

test('listSubAgents returns [] for a pipeline with no sub-agents', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  assert.deepEqual(listSubAgents(pid), [], 'no rows -> empty array (never null)');
});

test('sub_agents FK cascades on pipeline delete', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  upsertSubAgent(pid, { id: 'toolu_fk', status: 'running', startedAt: '2026-06-07T00:00:01Z' });
  assert.equal(listSubAgents(pid).length, 1, 'seeded one sub-agent');
  getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(pid);
  assert.equal(listSubAgents(pid).length, 0, 'sub_agents rows cascade-deleted with the pipeline');
});
