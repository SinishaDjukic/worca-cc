// test/subagent-type-persist.test.mjs  (structure copied from skill-persist.test.mjs)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertSubAgent, listSubAgents } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-type-persist-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests(); delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('sub_agents.subagent_type round-trips; absent -> null', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-type-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, { id: 'a1', label: 'AR sheet', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:00Z', subagentType: 'Explore' });
  upsertSubAgent(pid, { id: 'a2', label: 'AR items', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:01Z' }); // no type

  const subs = listSubAgents(pid);
  assert.equal(subs.find((s) => s.id === 'a1').subagentType, 'Explore');
  assert.equal(subs.find((s) => s.id === 'a2').subagentType, null, 'absent type surfaces as null');
});

test('a status-only update never nulls the COALESCE-guarded subagent_type', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-type-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  upsertSubAgent(pid, { id: 'a1', status: 'running', startedAt: '2026-06-20T00:00:00Z', subagentType: 'general-purpose' });
  upsertSubAgent(pid, { id: 'a1', status: 'finished', finishedAt: '2026-06-20T00:00:09Z' }); // type-less finish
  assert.equal(listSubAgents(pid)[0].subagentType, 'general-purpose', 'type preserved across a type-less finish update');
});
