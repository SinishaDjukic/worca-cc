// test/shape-rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
useTempHome(test.after);
const { roundsOf, roundOrigin, nextRound, setRoundOutcome } = await import('../src/core/shape/rounds.mjs');

test('roundsOf lists each origin\'s rounds in order; roundOrigin is one hop', () => {
  seedPipelineRow({ id: 'aaaa0001', status: 'done', branch: { source: 'dev', feature: 'worca/c-1' } });
  seedPipelineRow({ id: 'aaaa0003', status: 'done', branch: { source: 'worca/c-1', sameAsSource: true,
    roundOf: { pipelineId: 'aaaa0001', round: 3, request: 'and bold' } } });
  seedPipelineRow({ id: 'aaaa0002', status: 'running', branch: { source: 'worca/c-1', sameAsSource: true,
    roundOf: { pipelineId: 'aaaa0001', round: 2, request: 'make it blue' } } });
  const m = roundsOf(['aaaa0001']);
  assert.deepEqual(m.get('aaaa0001').map((r) => [r.round, r.pipelineId, r.status]), [[2, 'aaaa0002', 'running'], [3, 'aaaa0003', 'done']]);
  assert.equal(roundOrigin('aaaa0002'), 'aaaa0001');
  assert.equal(roundOrigin('aaaa0001'), 'aaaa0001');
  assert.equal(roundsOf([]).size, 0);
});

test('the round index never blocks a write: a non-JSON branch still saves and is skipped', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  seedPipelineRow({ id: 'aaaa0009', status: 'done' });
  getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run('not json', 'aaaa0009');   // throws with an unguarded index
  assert.equal(roundOrigin('aaaa0009'), 'aaaa0009');
  assert.equal(roundsOf(['aaaa0009']).size, 0);
});

test('s5: nextRound is one past the highest round; 2 for a run with none', () => {
  seedPipelineRow({ id: 'bbbb0001', status: 'done', branch: { source: 'dev', feature: 'feat/b' } });
  assert.equal(nextRound('bbbb0001'), 2);
  seedPipelineRow({ id: 'bbbb0002', status: 'done', branch: { source: 'dev', featureBranch: 'feat/b',
    roundOf: { pipelineId: 'bbbb0001', round: 2, request: 'fix failing checks', by: 'watch', kinds: ['checks'] } } });
  assert.equal(nextRound('bbbb0001'), 3);
  assert.deepEqual(roundsOf(['bbbb0001']).get('bbbb0001')[0], { round: 2, pipelineId: 'bbbb0002', status: 'done',
    request: 'fix failing checks', by: 'watch', kinds: ['checks'] });
});

test('s5: setRoundOutcome writes a fix round\'s outcome once; a plain run or a non-JSON branch is left alone', async () => {
  assert.equal(setRoundOutcome('bbbb0002', { kind: 'pushed', sha: 'a1b2c3d9', stopped: null, fixRuns: 1 }), true);
  assert.equal(setRoundOutcome('bbbb0002', { kind: 'failed', reason: 'fix-failed' }), false, 'written once');
  assert.deepEqual(roundsOf(['bbbb0001']).get('bbbb0001')[0].outcome, { kind: 'pushed', sha: 'a1b2c3d' });
  assert.equal(setRoundOutcome('bbbb0001', { kind: 'pushed', sha: 'x' }), false, 'not a round');
  assert.equal(setRoundOutcome('aaaa0009', { kind: 'pushed', sha: 'x' }), false, 'branch is "not json"');
});
