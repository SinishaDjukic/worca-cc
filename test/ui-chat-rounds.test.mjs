// test/ui-chat-rounds.test.mjs — Shaper s5 (D16, D21, D23): a plain run card's rounds and its stopped watch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundsModel } from '../ui/public/chat/rounds.mjs';

const live = (over = {}) => ({ source: 'live', terminal: false, status: 'running', stageProgress: { label: 'Build' }, ...over });
const R2 = { round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' };

test('no rounds: no status, no log, no watch line', () => {
  assert.deepEqual(roundsModel({ title: 'Add a chart' }), { status: null, log: [], watch: null });
});

test('one live round: "Running · Round 2 · Build", and round 1 is logged first', () => {
  const m = roundsModel({ title: 'Add a chart', rounds: [R2] }, (p) => (p === 'beef00r2' ? live() : null));
  assert.equal(m.status, 'Running · Round 2 · Build');
  assert.deepEqual(m.log.map((l) => [l.run, l.text]), [[null, 'Round 1 · Add a chart'], [null, 'Round 2 · make it blue']]);
});

test('a stopped round says so on its line; nothing is live', () => {
  const m = roundsModel({ title: 'Add a chart', rounds: [{ ...R2, status: 'stopped' }] });
  assert.equal(m.status, null);
  assert.equal(m.log[1].text, 'Round 2 · make it blue · stopped');
});

test('a live round that asks: "Needs you · Round 2 · Plan"', () => {
  const m = roundsModel({ title: 'Add a chart', rounds: [R2] }, () => live({ pendingQuestion: { id: 'plan-1', kind: 'plan' }, stageProgress: { label: 'Plan' } }));
  assert.equal(m.status, 'Needs you · Round 2 · Plan');
  assert.deepEqual([m.icon, m.word, m.run], ['ask', 'Needs you', { label: 'Plan' }], 'the card head shows the round');
});

test('s5: a live fix round reads its words, not its stage', () => {
  const snap = { title: 'Add a chart', rounds: [{ round: 2, pipelineId: 'fx2', status: 'running', request: 'fix failing checks', by: 'watch', kinds: ['checks'] }] };
  const m = roundsModel(snap, () => ({ source: 'live', terminal: false, status: 'running', stageProgress: { label: 'Implement' } }));
  assert.equal(m.status, 'Running · Round 2 · fix failing checks');
  assert.deepEqual(m.log.map((l) => l.text), ['Round 1 · Add a chart', 'Round 2 · fix failing checks']);
});

test('s5: the stopped watch line names the last fix round\'s kinds', () => {
  const snap = { title: 'Add a chart', watch: { prUrl: 'https://x/pull/781', status: 'needs-person', reason: 'cap', fixRuns: 3 },
    rounds: [{ round: 2, pipelineId: 'fx2', status: 'done', request: 'fix failing checks', by: 'watch', kinds: ['checks'], outcome: { kind: 'pushed', sha: 'a1b2c3d' } }] };
  const m = roundsModel(snap);
  assert.equal(m.log[1].text, 'Round 2 · fix failing checks · pushed a1b2c3d');
  assert.deepEqual(m.watch, { text: 'Watch stopped · 3 fix runs, checks still failing', prUrl: 'https://x/pull/781' });
  assert.equal(m.status, null);
});
