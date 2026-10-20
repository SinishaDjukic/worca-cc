// test/ui-shape-step-receipt.test.mjs — the receipt a step card leaves once answered (shaper-cards D5): the decision,
// named, never "Answered"; and the per-tab note app.js postAnswer writes before its POST.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepReceipt, noteAnswer, forgetAnswer, namedAnswer } from '../ui/public/shape/step-receipt.mjs';

const PLAN = (extra = {}) => ({ id: 'p1', kind: 'plan', plan: { round: 1, revisable: true, ...extra } });
const OUTLINE = { why: 'too big', slices: [
  { id: 's1', title: 'One', goal: 'g1', estimate: 'S', acceptance: [], dependsOn: [], inScope: [], outOfScope: [] },
  { id: 's2', title: 'Two', goal: 'g2', estimate: 'M', acceptance: [], dependsOn: [], inScope: [], outOfScope: [] },
  { id: 's3', title: 'Three', goal: 'g3', estimate: 'S', acceptance: [], dependsOn: [], inScope: [], outOfScope: [] },
] };
const SPLIT = { id: 'o1', kind: 'plan', plan: { round: 1, revisable: true, outline: OUTLINE } };
const GATE = { id: 'g1', kind: 'gate', issues: [] };
const RECOVERY = { id: 'r1', kind: 'recovery', recovery: { cls: 'auth', options: [{ id: 'retry' }, { id: 'pause' }] } };
const CLARIFY = { id: 'c1', kind: 'questions', questions: [{ id: 'a', question: 'Where?' }, { id: 'b', question: 'Who?' }] };
const TWO = { answers: [{ id: 'a', question: 'Where?', choice: 'Chat' }, { id: 'b', question: 'Who?', choice: 'Admins' }] };

const ROWS = [
  ['plan, round 1, approve', PLAN(), { decision: 'approve' }, {}, 'Plan approved'],
  ['plan, round 2, approve', PLAN({ round: 2 }), { decision: 'approve' }, {}, 'Plan approved · after 1 round of changes'],
  ['plan, revise with feedback', PLAN(), { decision: 'revise', feedback: 'more tests' }, {}, 'Changes asked · Plan'],
  ['plan, revise perspectives', PLAN(), { decision: 'revise', feedback: 'x', perspectives: ['product', 'ux'] }, {}, 'Changes asked · perspectives'],
  ['plan, stop', PLAN(), { decision: 'stop' }, {}, 'Stopped at the plan'],
  ['outline of 3, approve', SPLIT, { decision: 'approve', approveEach: false }, {}, 'Split into 3 runs'],
  ['outline of 3, approve after a merge', SPLIT, { decision: 'approve', edits: [{ op: 'merge', id: 's1' }] }, {}, 'Split into 2 runs'],
  ['outline, flat', SPLIT, { decision: 'flat' }, {}, 'Not split · planned as one run'],
  ['gate, another', GATE, { decision: 'another' }, {}, 'Another cycle started'],
  ['gate, continue', GATE, { decision: 'continue' }, {}, 'Accepted as is'],
  ['recovery, retry', RECOVERY, { decision: 'retry' }, {}, 'Retried'],
  ['recovery, pause', RECOVERY, { decision: 'pause' }, {}, 'Paused'],
  ['recovery, abort', RECOVERY, { decision: 'abort' }, {}, 'Aborted'],
  ['clarify, shaping, 2 of 2', CLARIFY, TWO, { shaping: true }, 'Clarify · 2 answers'],
];

for (const [name, pq, payload, opts, want] of ROWS) {
  test(`stepReceipt: ${name} → ${want}`, () => {
    const got = stepReceipt(pq, payload, opts);
    assert.equal(got, want);
    assert.doesNotMatch(got, /Answered/);
  });
}

test('stepReceipt: a non-shaping Clarify and a missing question have no step name (today\'s wording)', () => {
  assert.equal(stepReceipt(CLARIFY, TWO), null);
  assert.equal(stepReceipt(CLARIFY, TWO, { shaping: false }), null);
  assert.equal(stepReceipt(null, { decision: 'approve' }), null);
  assert.equal(stepReceipt({ id: 'f', kind: 'form' }, { values: {} }, { shaping: true }), null);
});

test('stepReceipt: an outline approve that merges down to one run reads as one run', () => {
  const two = { ...SPLIT, plan: { ...SPLIT.plan, outline: { why: '', slices: OUTLINE.slices.slice(0, 2) } } };
  assert.equal(stepReceipt(two, { decision: 'approve', edits: [{ op: 'merge', id: 's1' }] }), 'Planned as one run');
});

test('noteAnswer then namedAnswer returns { text, answers }; forgetAnswer clears it', () => {
  noteAnswer('run-a', CLARIFY, TWO, { shaping: true });
  assert.deepEqual(namedAnswer('run-a', 'c1'), { text: 'Clarify · 2 answers', answers: TWO.answers });
  noteAnswer('run-a', GATE, { decision: 'another' });
  assert.deepEqual(namedAnswer('run-a', 'g1'), { text: 'Another cycle started', answers: [] });
  forgetAnswer('run-a', 'c1');
  assert.equal(namedAnswer('run-a', 'c1'), null);
  assert.equal(namedAnswer('run-a', ''), null);
  assert.equal(namedAnswer('run-a', null), null);
  forgetAnswer('run-a', 'g1');
});

test('a note on run A\'s question never names run B\'s question with the same id (engine ids repeat across runs)', () => {
  noteAnswer('run-a', { ...GATE, id: 'gate-review-1' }, { decision: 'another' });
  assert.equal(namedAnswer('run-b', 'gate-review-1'), null);
  assert.equal(namedAnswer('run-a', 'gate-review-1').text, 'Another cycle started');
  forgetAnswer('run-b', 'gate-review-1');
  assert.equal(namedAnswer('run-a', 'gate-review-1').text, 'Another cycle started', 'forgetting run B leaves run A');
  forgetAnswer('run-a', 'gate-review-1');
});

test('noteAnswer keeps nothing for a kind without a step name', () => {
  noteAnswer('run-a', CLARIFY, TWO);
  assert.equal(namedAnswer('run-a', 'c1'), null);
});

test('the 201st note evicts the first', () => {
  for (let i = 0; i < 201; i++) noteAnswer('run-a', { ...GATE, id: `n${i}` }, { decision: 'continue' });
  assert.equal(namedAnswer('run-a', 'n0'), null);
  assert.equal(namedAnswer('run-a', 'n1').text, 'Accepted as is');
  assert.equal(namedAnswer('run-a', 'n200').text, 'Accepted as is');
  for (let i = 0; i < 201; i++) forgetAnswer('run-a', `n${i}`);
});

test('D16: a plan approve with role-review rounds names the roles and the open issue accepted; without rounds it stays planApprovedText', async () => {
  const { readFileSync } = await import('node:fs');
  const { planApprovedLine } = await import('../ui/public/log-line.mjs');
  const rr = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8')).plan.roleReviews;
  const got = stepReceipt(PLAN({ round: 2, roleReviews: rr }), { decision: 'approve' });
  assert.equal(got, planApprovedLine(rr));
  assert.match(got, /^Plan approved · \d+ roles? reviewed/);
  assert.equal(stepReceipt(PLAN({ round: 2, roleReviews: { rounds: [] } }), { decision: 'approve' }), 'Plan approved · after 1 round of changes');
});
