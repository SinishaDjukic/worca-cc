// test/subagent-rowtostate.test.mjs
// Layer A (DB) — rowToState exposes state.subAgents so History reconstructs the live
// view. Persist via upsertSubAgent, then read back through readPipelineByKey (the same
// path all 3 detail endpoints use) and assert state.subAgents carries the camelCase
// records in (started_at,id) order — proving the read wiring with zero endpoint changes.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { upsertSubAgent, readPipelineByKey } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-sa-rts-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('readPipelineByKey returns state.subAgents reconstructed from the sub_agents table', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-rts-proj-'));
  const { id: pid, key } = await seedPipeline(proj, { title: 'Demo', status: 'done',
    startedAt: '2026-06-07T00:00:00Z' });

  upsertSubAgent(pid, { id: 'toolu_2', label: 'second', nodeId: 's1_0', stepIndex: 1,
    cycle: 0, stepKey: '1:s1_0', status: 'finished',
    startedAt: '2026-06-07T00:00:05Z', finishedAt: '2026-06-07T00:00:08Z' });
  upsertSubAgent(pid, { id: 'toolu_1', label: 'first', nodeId: 's1_0', stepIndex: 1,
    cycle: 0, stepKey: '1:s1_0', status: 'running', startedAt: '2026-06-07T00:00:02Z' });

  const detail = await readPipelineByKey(key, pid);
  assert.ok(detail && detail.state, 'detail resolved');
  assert.ok(Array.isArray(detail.state.subAgents), 'state.subAgents is an array');
  assert.equal(detail.state.subAgents.length, 2, 'both sub-agents reconstructed');
  // Ordered by started_at -> the running 'first' precedes the finished 'second'.
  assert.deepEqual(detail.state.subAgents.map((s) => s.id), ['toolu_1', 'toolu_2'], 'ordered by started_at');
  assert.equal(detail.state.subAgents[0].status, 'running');
  assert.equal(detail.state.subAgents[0].label, 'first');
  assert.equal(detail.state.subAgents[1].status, 'finished');
  assert.equal(detail.state.subAgents[1].finishedAt, '2026-06-07T00:00:08Z');
});

test('state.subAgents is [] for a run with no sub-agents (always present)', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-sa-rts-proj-'));
  const { id: pid, key } = await seedPipeline(proj, { title: 'Bare', status: 'done',
    startedAt: '2026-06-07T00:00:00Z' });
  const detail = await readPipelineByKey(key, pid);
  assert.deepEqual(detail.state.subAgents, [], 'subAgents present and empty (never undefined)');
});
