// test/ui-chat-rounds.test.mjs — Shaper s5 (D16, D21, D23): a plain run card's rounds and its stopped watch. The live
// round's status line is runModel's (the card feeds it liveRound's `round`), so this module only finds that round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundsModel, liveRound } from '../ui/public/chat/rounds.mjs';

const live = (over = {}) => ({ source: 'live', terminal: false, status: 'running', stageProgress: { label: 'Build' }, ...over });
const R2 = { round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' };

test('no rounds: no log, no watch line, no live round', () => {
  assert.deepEqual(roundsModel({ title: 'Add a chart' }), { log: [], watch: null });
  assert.equal(liveRound({ title: 'Add a chart' }), null);
});

test('one live round: liveRound names it with its live snapshot, and round 1 is logged first', () => {
  const snap = live();
  const m = roundsModel({ title: 'Add a chart', rounds: [R2] });
  assert.deepEqual(liveRound({ title: 'Add a chart', rounds: [R2] }, (p) => (p === 'beef00r2' ? snap : null)), { r: R2, m: snap });
  assert.deepEqual(m.log.map((l) => [l.run, l.text]), [[null, 'Round 1 · Add a chart'], [null, 'Round 2 · make it blue']]);
});

test('a live round with no snapshot yet is live by its own status; a starting one too', () => {
  assert.deepEqual(liveRound({ rounds: [R2] }), { r: R2, m: null });
  const starting = { ...R2, status: 'starting' };
  assert.deepEqual(liveRound({ rounds: [starting] }), { r: starting, m: null });
});

test('a stopped round says so on its line; nothing is live', () => {
  const snap = { title: 'Add a chart', rounds: [{ ...R2, status: 'stopped' }] };
  assert.equal(roundsModel(snap).log[1].text, 'Round 2 · make it blue · stopped');
  assert.equal(liveRound(snap), null);
});

test('a round whose snapshot is terminal is not live, even while its row still says running', () => {
  assert.equal(liveRound({ rounds: [R2] }, () => live({ terminal: true, status: 'done' })), null);
});

test('s5: a live fix round is found; its log line reads its words', () => {
  const fix = { round: 2, pipelineId: 'fx2', status: 'running', request: 'fix failing checks', by: 'watch', kinds: ['checks'] };
  const snap = { title: 'Add a chart', rounds: [fix] };
  assert.equal(liveRound(snap, () => live({ stageProgress: { label: 'Implement' } })).r, fix);
  assert.deepEqual(roundsModel(snap).log.map((l) => l.text), ['Round 1 · Add a chart', 'Round 2 · fix failing checks']);
});

test('s5: the stopped watch line names the last fix round\'s kinds', () => {
  const snap = { title: 'Add a chart', watch: { prUrl: 'https://x/pull/781', status: 'needs-person', reason: 'cap', fixRuns: 3 },
    rounds: [{ round: 2, pipelineId: 'fx2', status: 'done', request: 'fix failing checks', by: 'watch', kinds: ['checks'], outcome: { kind: 'pushed', sha: 'a1b2c3d' } }] };
  const m = roundsModel(snap);
  assert.equal(m.log[1].text, 'Round 2 · fix failing checks · pushed a1b2c3d');
  assert.deepEqual(m.watch, { text: 'Watch stopped · 3 fix runs, checks still failing', prUrl: 'https://x/pull/781' });
  assert.equal(liveRound(snap), null);
});
