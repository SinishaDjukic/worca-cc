// test/history-round-marker.test.mjs — the History wire carries a round's marker (pr-fix-rounds-stacking plan Task 1):
// rowToHistoryEntry's `roundOf` = { pipelineId, round, request, by?, kinds?, outcome? } from branch.roundOf, omitted for
// round 1, a plain run and a malformed marker. The `lite` (archived) path keeps it too (D4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAllPipelines } from '../src/core/artifacts.mjs';
import { archivePipeline } from '../src/core/pipeline-delete.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

let home, prevHome, projectDir;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-round-marker-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-round-marker-proj-'));
});
after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

const feature = 'worca-cc/run-3-route-swallowed-step-failures-ba22d7fd';

test('a round row carries roundOf; the origin, a plain run and a malformed marker carry none', async () => {
  const origin = await seedPipeline(projectDir, { title: 'Route swallowed step failures', status: 'done', branch: { source: 'dev', feature } });
  const round = await seedPipeline(projectDir, { title: 'Merge dev into PR 947', status: 'done', branch: { source: 'dev', feature,
    roundOf: { pipelineId: origin.id, round: 8, request: 'merge dev in', by: 'watch', kinds: ['conflicts'],
      outcome: { kind: 'pushed', sha: '3e4f5a6b7c8d', reason: 'x'.repeat(80) } } } });
  const ask = await seedPipeline(projectDir, { title: 'Ask round', status: 'done', branch: { source: 'dev', feature,
    roundOf: { pipelineId: origin.id, round: 2, request: 'tighten the copy' } } });
  const plain = await seedPipeline(projectDir, { title: 'plain', status: 'done', branch: { source: 'dev', feature: 'worca-cc/plain' } });
  const bad1 = await seedPipeline(projectDir, { title: 'bad round', status: 'done', branch: { source: 'dev', feature, roundOf: { pipelineId: origin.id, round: 1 } } });
  const bad2 = await seedPipeline(projectDir, { title: 'bad id', status: 'done', branch: { source: 'dev', feature, roundOf: { round: 3 } } });
  const bad3 = await seedPipeline(projectDir, { title: 'bad n', status: 'done', branch: { source: 'dev', feature, roundOf: { pipelineId: origin.id, round: '4' } } });

  const rows = await listAllPipelines({ lite: true });
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(by.get(round.id).roundOf, { pipelineId: origin.id, round: 8, request: 'merge dev in', by: 'watch', kinds: ['conflicts'],
    outcome: { kind: 'pushed', sha: '3e4f5a6', reason: 'x'.repeat(60) } });
  assert.deepEqual(by.get(ask.id).roundOf, { pipelineId: origin.id, round: 2, request: 'tighten the copy' });
  for (const s of [origin, plain, bad1, bad2, bad3]) assert.equal('roundOf' in by.get(s.id), false, `${by.get(s.id).title}: no marker`);
  assert.equal(by.get(round.id).branch, feature, 'branch stays the feature name');
});

test('the archived (lite) feed keeps the marker (D4)', async () => {
  const origin = await seedPipeline(projectDir, { title: 'archived origin', status: 'done', branch: { source: 'dev', feature: 'f/a' } });
  const round = await seedPipeline(projectDir, { title: 'archived round', status: 'done', branch: { source: 'dev', feature: 'f/a',
    roundOf: { pipelineId: origin.id, round: 2, request: 'merge dev in', by: 'watch', kinds: ['behind'] } } });
  await archivePipeline({ projectDir, id: round.id });
  const rows = await listAllPipelines({ archived: true, lite: true });
  const r = rows.find((x) => x.id === round.id);
  assert.ok(r, 'the archived round lists');
  assert.deepEqual(r.roundOf, { pipelineId: origin.id, round: 2, request: 'merge dev in', by: 'watch', kinds: ['behind'] });
});
