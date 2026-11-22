// test/shape-feature-log.test.mjs — Shaper s2: the feature card's step log from durable rows (D7, D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDecisionLog, parseDecisionLine, clarifyText, planApprovedText, splitText, gateText, replanText, NOT_SPLIT_TEXT,
  roundText, roundOutcomeText, REQUIREMENTS_AGREED, RUNS_APPROVED, outlineKeptNote, outlineKeptStub }
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

test('an Away approval names Away in the log', () => {
  assert.deepEqual(parseDecisionLine('Plan approval **approve** by night-mode.'), { kind: 'plan', decision: 'approve', away: true });
  assert.deepEqual(parseDecisionLine('Slice outline **approve** (round 1) by night-mode.'), { kind: 'outline', decision: 'approve', away: true });
  const log = buildDecisionLog({ sliced: true, slices: SLICES,
    origin: ['Slice outline **approve** (round 1) by night-mode.', 'Plan approval **revise**.', 'Plan approval **approve** by night-mode.'],
    runs: [{ index: 2, events: ['Plan approval **approve** by night-mode.'] }] });
  assert.deepEqual(log.map((l) => [l.run, l.text]), [
    [null, 'Split into 3 runs · by Away mode'], [1, 'Plan approved · after 1 round of changes · by Away mode'], [2, 'Plan approved · by Away mode'],
  ]);
});

test("a person's approval reads as before", () => {
  assert.deepEqual(parseDecisionLine('Plan approval **approve** by nightmode fan.'), { kind: 'plan', decision: 'approve' });
  assert.deepEqual(parseDecisionLine('Plan concern **overridden** by ann.'), { kind: 'concern', decision: 'overridden' });
  const log = buildDecisionLog({ origin: ['Plan approval **approve** by ann.', 'Plan concern **overridden** by ann.', 'Plan concern **accepted** by night-mode.'] });
  assert.deepEqual(log.map((l) => l.text), ['Plan approved'], "a person's concern line stays silent");
});

test('an Away-overridden concern gets a row, and it ends a round of changes', () => {
  const log = buildDecisionLog({ origin: ['Plan approval **revise**.', 'Plan concern **overridden** by night-mode.', 'Plan approval **approve**.'] });
  assert.deepEqual(log.map((l) => l.text), ['Plan kept as written · by Away mode · please check', 'Plan approved']);
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

test('B1: parseDecisionLine reads the marked run\'s requirements line', () => {
  assert.deepEqual(parseDecisionLine('Requirements approval **approve** by ann.'), { kind: 'requirements', decision: 'approve' });
  assert.deepEqual(parseDecisionLine('Requirements approval **revise**.'), { kind: 'requirements', decision: 'revise' });
  const src = readFileSync(new URL('../src/core/run-harness.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('`Requirements approval **${'), 'the harness writes the words the log parses');
});

test('B1: with oneCard the log names "Requirements agreed" and "Runs approved" (no count); without it, dev\'s words', () => {
  const origin = ['Requirements approval **revise**.', 'Requirements approval **approve**.', 'Plan approval **approve**.', 'Slice outline **approve** (round 1).'];
  const one = buildDecisionLog({ clarify: CLARIFY, sliced: true, slices: SLICES, origin, oneCard: true });
  assert.equal(REQUIREMENTS_AGREED, 'Requirements agreed');
  assert.equal(RUNS_APPROVED, 'Runs approved');
  assert.deepEqual(one.map((l) => [l.run, l.text]), [[null, 'Clarify · 2 answers'], [1, 'Requirements agreed'], [1, 'Plan approved'], [null, 'Runs approved']]);
  assert.deepEqual(one[3].detail, ['1 · Part 1', '2 · Part 2', '3 · Part 3']);
  assert.equal(new Set(one.map((l) => l.key)).size, one.length);
  // Without oneCard a requirements line reads as the plan approval it was before B1, and the split keeps splitText.
  const dev = buildDecisionLog({ clarify: CLARIFY, sliced: true, slices: SLICES, origin });
  assert.deepEqual(dev.map((l) => [l.run, l.text]), [[null, 'Clarify · 2 answers'], [1, 'Plan approved · after 1 round of changes'], [1, 'Plan approved'],
    [null, 'Split into 3 runs']]);
  const devPlan = ['Plan approval **revise**.', 'Plan approval **approve**.', 'Plan approval **approve**.', 'Slice outline **approve** (round 1).'];
  assert.deepEqual(dev, buildDecisionLog({ clarify: CLARIFY, sliced: true, slices: SLICES, origin: devPlan }), 'same lines as dev\'s plan words');
  // Before the split (no feature) the marked run's own log.
  assert.deepEqual(buildDecisionLog({ origin: ['Requirements approval **approve**.'], oneCard: true }).map((l) => [l.run, l.text]), [[null, 'Requirements agreed']]);
});

test('B2: parseDecisionLine reads the Care line; the log leads with careRecordLine\'s words', () => {
  assert.deepEqual(parseDecisionLine("Care **lean** · Worca's pick **thorough** by ann."), { kind: 'care', decision: 'lean', pick: 'thorough' });
  const src = readFileSync(new URL('../src/core/run-harness.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("`Care **${care.position}** · Worca's pick **${"), 'the harness writes the words the log parses');
  const person = buildDecisionLog({ clarify: CLARIFY, origin: ["Care **lean** · Worca's pick **thorough**.", 'Requirements approval **approve**.'], oneCard: true });
  assert.deepEqual(person.map((l) => l.text), ['Care: Lean · your choice · Worca recommended Thorough', 'Clarify · 2 answers', 'Requirements agreed']);
  const pick = buildDecisionLog({ origin: ["Care **thorough** · Worca's pick **thorough**."], oneCard: true });
  assert.deepEqual(pick.map((l) => l.text), ["Care: Thorough · Worca's pick"]);
  const sliced = buildDecisionLog({ sliced: true, slices: SLICES, origin: ["Care **balanced** · Worca's pick **balanced**.", 'Slice outline **approve** (round 1).'], oneCard: true });
  assert.equal(sliced[0].text, "Care: Balanced · Worca's pick");
});

test('B4 (D20): the one card reads "Runs approved · 2 objections kept" for a Split approved over 2 open objections', () => {
  const origin = ['Requirements approval **approve**.', 'Slice outline **approve** (round 1 · 2 objections kept).'];
  const one = buildDecisionLog({ sliced: true, slices: SLICES, origin, oneCard: true });
  assert.equal(one.at(-1).text, 'Runs approved · 2 objections kept');
  const single = buildDecisionLog({ sliced: true, slices: SLICES, origin: ['Slice outline **approve** (round 2 · 1 objection kept).'], oneCard: true });
  assert.equal(single.at(-1).text, 'Runs approved · 1 objection kept');
  assert.equal(buildDecisionLog({ sliced: true, slices: SLICES, origin: [origin[1]] }).at(-1).text, 'Split into 3 runs', 'dev keeps splitText');
});

test('fit-1-2: the outline audit line\'s kept note and the pending stub\'s count come from the Shaper module', () => {
  const stub = { outline: true, round: 1, ...outlineKeptStub({ challenge: { open: 2 } }) };
  assert.equal(stub.open, 2);
  assert.deepEqual(outlineKeptStub({ challenge: { open: 0 } }), {});
  assert.deepEqual(outlineKeptStub({}), {});
  assert.equal(outlineKeptNote(stub, 'approve', { openObjections: 'kept' }), ' · 2 objections kept');
  assert.equal(outlineKeptNote({ open: 1 }, 'approve', { openObjections: 'kept' }), ' · 1 objection kept');
  assert.equal(outlineKeptNote(stub, 'approve', {}), '');
  assert.equal(outlineKeptNote(stub, 'revise', { openObjections: 'kept' }), '');
  // parseDecisionLine reads the note back (D20)
  assert.equal(parseDecisionLine(`Slice outline **approve** (round 1${outlineKeptNote(stub, 'approve', { openObjections: 'kept' })}).`).kept, 2);
});

test('C1: the 4 Prototype log lines parse and show on the one card only', async () => {
  const { PROTOTYPE_CONFIRMED, prototypeBuiltText, remarkUpdatedText, parsePrototypeLine } = await import('../src/shared/shape/feature-log.mjs');
  assert.equal(PROTOTYPE_CONFIRMED, 'Prototype confirmed by you');
  assert.equal(prototypeBuiltText(2, 2.8), "Prototype built by Design's agents · 2 screens · $2.80");
  assert.equal(prototypeBuiltText(1, 0), "Prototype built by Design's agents · 1 screen · $0.00");
  assert.equal(prototypeBuiltText(2, 3.2, true), 'Prototype rebuilt with your remark · 2 screens · $3.20');
  assert.deepEqual(parsePrototypeLine(`${prototypeBuiltText(2, 3.2, true)}.`), { kind: 'prototype', text: prototypeBuiltText(2, 3.2, true) });
  assert.equal(remarkUpdatedText('dark please', 'R-ux-2'), 'Your remark: “dark please” → R-ux-2 updated');
  const lines = ['Prototype skipped · no screen requirements', 'Prototype skipped by you', prototypeBuiltText(2, 2.8),
    remarkUpdatedText('dark please', 'R-ux-2'), PROTOTYPE_CONFIRMED];
  for (const l of lines) assert.deepEqual(parsePrototypeLine(`${l}.`), { kind: 'prototype', text: l }, l);
  assert.equal(parsePrototypeLine('Prototype was nice'), null);
  const origin = ['Requirements approval **approve**.', `${prototypeBuiltText(2, 2.8)}.`, `${PROTOTYPE_CONFIRMED}.`];
  assert.deepEqual(buildDecisionLog({ origin, oneCard: true }).map((l) => l.text),
    ['Requirements agreed', prototypeBuiltText(2, 2.8), PROTOTYPE_CONFIRMED]);
  assert.deepEqual(buildDecisionLog({ origin }).map((l) => l.text), ['Plan approved'], "not on dev's card");
});

test('C3 (D14): a stop\'s answered line is read back as a decision row, once, under its run', () => {
  const log = buildDecisionLog({ origin: [], sliced: true,
    runs: [{ index: 8, events: ['Loop on wire w9 (n_review) spent after its last round: sent to approval with 1 open issue(s).',
      'Run 8: another cycle · decided by you', 'Review loop ran out with 2 minor issue(s): accepted · settled by the agents.'] }] });
  assert.deepEqual(log.map((r) => [r.run, r.text]), [[8, 'another cycle · decided by you']], 'the run shows once, in its span');
});

test('C4 (D17): buildDecisionLog({changes}) lists one row per change it is given, after the runs', () => {
  const changes = [
    { id: 'R-po-3', from: 'a', to: 'b', at: '2026-11-22T15:00:00Z', source: { kind: 'chat' }, case: 'finished', run: 2, added: 9 },
    { id: 'R-po-4', from: 'a', to: 'b', at: '2026-11-22T15:01:00Z', source: { kind: 'chat' }, case: 'none', run: null },
  ];
  const log = buildDecisionLog({ origin: [], sliced: true, runs: [{ index: 8, events: ['Run 8: another cycle · decided by you'] }], changes });
  assert.deepEqual(log.map((r) => [r.run, r.text]), [[8, 'another cycle · decided by you'],
    [null, 'R-po-3 changed · run 9 added: a small change run'], [null, 'R-po-4 changed']]);
  assert.equal(new Set(log.map((r) => r.key)).size, log.length);
  assert.deepEqual(buildDecisionLog({ origin: [] }), buildDecisionLog({ origin: [], changes: [] }));
});

test('C5 (D13): buildDecisionLog({verify}) adds one receipt per check with a result; without it the log is the same', () => {
  const held = (n) => Array.from({ length: n }, (_, i) => `R-h-${i}`);
  const verify = { checks: [
    { round: 1, state: 'gaps', result: { held: held(15), gaps: [{ id: 'R-po-2', why: 'x', title: 'y' }] }, gapRuns: [11] },
    { round: 2, state: 'clean', result: { held: held(16), gaps: [] }, gapRuns: [] },
    { round: 1, state: 'verifying', result: null, gapRuns: [] },
  ] };
  const log = buildDecisionLog({ origin: [], sliced: true, verify });
  assert.deepEqual(log.map((r) => [r.run, r.text]), [
    [null, 'Verifier: 15 of 16 hold · 1 gap · run 11 added for it'],
    [null, 'Verified: the 16 requirements owned by runs hold in the main flow'],
  ]);
  assert.equal(new Set(log.map((r) => r.key)).size, log.length);
  assert.deepEqual(log.map((r) => r.kind), ['verify', 'verify'], 'drawn as .srows rows (paintFeatureLog)');
  assert.deepEqual(buildDecisionLog({ origin: [] }), buildDecisionLog({ origin: [], verify: null }));
});
