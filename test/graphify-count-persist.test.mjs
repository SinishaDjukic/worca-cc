// test/graphify-count-persist.test.mjs  (structure copied from subagent-type-persist.test.mjs
// for the sub_agents side and persist-roundtrip.test.mjs for the pipeline_steps side)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertSubAgent, listSubAgents, readPipeline } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-graphify-persist-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => {
  _resetForTests(); delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

test('sub_agents.graphify_count round-trips as an integer; absent -> null', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-graphify-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });

  upsertSubAgent(pid, { id: 'a1', label: 'AR sheet', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:00Z', graphifyCount: 3 });
  upsertSubAgent(pid, { id: 'a2', label: 'AR items', nodeId: 'n1', stepIndex: 0, cycle: 1,
    status: 'finished', startedAt: '2026-06-20T00:00:01Z' }); // no graphify

  const subs = listSubAgents(pid);
  assert.equal(subs.find((s) => s.id === 'a1').graphifyCount, 3);
  assert.equal(subs.find((s) => s.id === 'a2').graphifyCount, null, 'absent count surfaces as null');
});

test('a status-only update never nulls the COALESCE-guarded graphify_count', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-graphify-proj-'));
  const { id: pid } = await seedPipeline(proj, { title: 'Run', status: 'running' });
  upsertSubAgent(pid, { id: 'a1', status: 'running', startedAt: '2026-06-20T00:00:00Z', graphifyCount: 2 });
  upsertSubAgent(pid, { id: 'a1', status: 'finished', finishedAt: '2026-06-20T00:00:09Z' }); // count-less finish
  assert.equal(listSubAgents(pid)[0].graphifyCount, 2, 'count preserved across a count-less finish update');
});

test("a step's graphify_count round-trips through writeState -> readPipeline; absent reads back as undefined", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-graphify-rt-proj-'));
  const { id } = await seedPipeline(projectDir, {
    title: 'Run', status: 'done',
    steps: [
      { key: '2:n1', nodeId: 'n1', cycle: 1, graphifyCount: 5 },
      { key: '3:n2', nodeId: 'n2', cycle: 1 }, // no graphify
    ],
  });
  const saved = await readPipeline(projectDir, id);
  assert.ok(saved && saved.state, 'readPipeline returns the persisted run');
  const byKey = (k) => saved.state.steps.find((s) => s.key === k);
  assert.equal(byKey('2:n1').graphifyCount, 5, 'step graphify_count survived the round-trip');
  assert.equal(byKey('3:n2').graphifyCount, undefined, 'a step with no graphify reads back as undefined');
});
