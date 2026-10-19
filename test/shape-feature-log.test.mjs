// test/shape-feature-log.test.mjs — Shaper s2: the feature card's step log from durable rows (D7, D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDecisionLog, parseDecisionLine, clarifyText, planApprovedText, splitText, gateText, replanText, NOT_SPLIT_TEXT,
  roundText, roundOutcomeText }
  from '../src/shared/shape/feature-log.mjs';

const SLICES = [1, 2, 3].map((i) => ({ index: i, title: `Part ${i}`, goal: `Goal ${i}`, acceptance: [`ok ${i}`] }));
const CLARIFY = { questions: [{ id: 'q1', question: 'Where?' }, { id: 'q2', question: 'How?' }, { id: 'q3', question: 'Why?' }],
  answers: [{ id: 'q1', choice: 'Redis' }, { id: 'q2', choice: 'JSON' }, { id: 'q3', choice: ' ' }] };

test('wording: the receipts\' words', () => {
  assert.equal(clarifyText(2), 'Clarify · 2 answers');
  assert.equal(clarifyText(1), 'Clarify · 1 answer');
  assert.equal(clarifyText(0), 'Clarify · no answers');
  assert.equal(planApprovedText(0), 'Plan approved');
  assert.equal(planApprovedText(1), 'Plan approved · after 1 round of changes');
  assert.equal(splitText(3), 'Split into 3 runs');
  assert.equal(splitText(1), 'Planned as one run');
  assert.equal(gateText('another'), 'Another cycle started');
  assert.equal(gateText('continue'), 'Accepted as is');
  assert.equal(replanText([4, 3]), 'Re-planning runs 3–4');
  assert.equal(replanText([3]), 'Re-planning run 3');
  assert.equal(NOT_SPLIT_TEXT, 'Not split · planned as one run');
});

test('parseDecisionLine reads the harness audit lines, with or without "by …"', () => {
  assert.deepEqual(parseDecisionLine('Plan approval **approve** by ann.'), { kind: 'plan', decision: 'approve' });
  assert.deepEqual(parseDecisionLine('Slice outline **approve** (round 2).'), { kind: 'outline', decision: 'approve' });
  assert.deepEqual(parseDecisionLine('Gate **another**.'), { kind: 'gate', decision: 'another' });
  assert.equal(parseDecisionLine('Paused by ann.'), null);
});

test('the harness still writes the audit words the log parses (run-harness.mjs _auditDecision)', () => {
  const src = readFileSync(new URL('../src/core/run-harness.mjs', import.meta.url), 'utf8');
  for (const s of ['`Slice outline **${', '`Plan approval **${', '`Gate **${']) assert.ok(src.includes(s), s);
});

test('a sliced feature: Clarify, Split, run 1 plan after one revise, run 2 plan, run 3 gate, in that order', () => {
  const log = buildDecisionLog({
    clarify: CLARIFY, sliced: true, slices: SLICES,
    origin: ['Slice outline **approve** (round 1).', 'Plan approval **revise**.', 'Plan approval **approve**.'],
    runs: [{ index: 2, events: ['Plan approval **approve**.'] }, { index: 3, events: ['Gate **another**.'] }],
  });
  assert.deepEqual(log.map((l) => [l.run, l.text]), [
    [null, 'Clarify · 2 answers'], [null, 'Split into 3 runs'], [1, 'Plan approved · after 1 round of changes'],
    [2, 'Plan approved'], [3, 'Another cycle started'],
  ]);
  assert.deepEqual(log[0].detail, ['Where? → Redis', 'How? → JSON', 'Why? → —']);
  assert.deepEqual(log[1].detail, ['1 · Part 1', '2 · Part 2', '3 · Part 3']);
  assert.deepEqual(log[3].detail, ['Goal: Goal 2', '✓ ok 2']);
  assert.equal(new Set(log.map((l) => l.key)).size, log.length, 'keys are unique');
});

test('shaping, no feature: an unanswered Clarify logs nothing; a plan approval has no run', () => {
  assert.deepEqual(buildDecisionLog({ clarify: { questions: CLARIFY.questions, answers: [] }, origin: [] }), []);
  assert.deepEqual(buildDecisionLog({ origin: ['Plan approval **approve**.'] }).map((l) => [l.run, l.text]), [[null, 'Plan approved']]);
});

test('re-planning lists the re-planned runs last', () => {
  const log = buildDecisionLog({ sliced: true, slices: [...SLICES, { index: 4, title: 'Part 4', goal: '', acceptance: [] }], replan: [3, 4] });
  assert.deepEqual(log.at(-1), { key: 'replan', run: null, text: 'Re-planning runs 3–4', detail: ['3 · Part 3', '4 · Part 4'] });
});

test('s5: rounds add "Round 1 · …" then "Round n · request" under their run, after its decisions', () => {
  const log = buildDecisionLog({ sliced: true, slices: SLICES, origin: ['Plan approval **approve** by ann.'],
    rounds: [{ run: 1, round: 2, request: 'make it blue', status: 'running' }] });
  assert.deepEqual(log.slice(-2).map((l) => [l.run, l.text]), [[1, 'Round 1 · Part 1'], [1, 'Round 2 · make it blue']]);
});

test('s5: a stopped round says so', () => {
  const log = buildDecisionLog({ sliced: true, slices: SLICES, rounds: [{ run: 3, round: 2, request: 'blue', status: 'stopped' }] });
  assert.equal(log.at(-1).text, 'Round 2 · blue · stopped');
});

test('s5: the base line names the run once and carries no run tag', () => {
  const log = buildDecisionLog({ sliced: true, slices: SLICES, runs: [{ index: 3, events: ['Base `dev` moved: merged into `worca/c-3` (2 commits).'] }] });
  assert.deepEqual(log.map((l) => [l.run, l.text]), [[null, 'dev moved · run 3 starts from it']]);
  const c = buildDecisionLog({ sliced: true, slices: SLICES, runs: [{ index: 3, events: ['Base `dev` moved: conflicts in 2 files.'] }] });
  assert.equal(c[0].text, 'dev moved · run 3 has conflicts with it in 2 files');
});

test('s5: a fix round\'s log line ends with its outcome', () => {
  assert.equal(roundText(2, 'fix failing checks', 'done', { kind: 'pushed', sha: 'a1b2c3d' }), 'Round 2 · fix failing checks · pushed a1b2c3d');
  assert.equal(roundText(3, 'resolve conflicts', 'done', { kind: 'failed', reason: 'conflict-markers' }),
    'Round 3 · resolve conflicts · nothing pushed: conflict markers left');
  assert.equal(roundOutcomeText({ kind: 'ended', reason: 'merged' }), 'nothing pushed: the PR was merged');
  assert.equal(roundOutcomeText({ kind: 'failed', reason: 'remote-moved' }), 'nothing pushed: remote moved');
  const log = buildDecisionLog({ sliced: true, slices: SLICES,
    rounds: [{ run: 3, round: 2, request: 'fix failing checks', status: 'done', by: 'watch', outcome: { kind: 'pushed', sha: 'a1b2c3d' } }] });
  assert.equal(log.at(-1).text, 'Round 2 · fix failing checks · pushed a1b2c3d');
});
