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
const SPLIT_SR = { id: 'o1', kind: 'plan', plan: { round: 1, revisable: true, outline: OUTLINE, smallRuns: true, challenge: { roles: [], challenger: true, rounds: 1, open: 2 } } };
const REQUIREMENTS = { id: 'q1', kind: 'plan', plan: { round: 1, revisable: true, criteria: { ok: true, passed: 8, total: 8, items: [], criteria: [] }, decisions: [] } };
const REQ_ERROR = { id: 'q2', kind: 'plan', plan: { round: 1, revisable: true, error: { message: 'boom' } } };
const GATE = { id: 'g1', kind: 'gate', issues: [] };
const RECOVERY = { id: 'r1', kind: 'recovery', recovery: { cls: 'auth', options: [{ id: 'retry' }, { id: 'pause' }] } };
const CLARIFY = { id: 'c1', kind: 'questions', questions: [{ id: 'a', question: 'Where?' }, { id: 'b', question: 'Who?' }] };
const CARE = { id: 'care-1', kind: 'care', care: { pick: { position: 'thorough', reason: 'r' } } };
const TWO = { answers: [{ id: 'a', question: 'Where?', choice: 'Chat' }, { id: 'b', question: 'Who?', choice: 'Admins' }] };

const ROWS = [
  ['plan, round 1, approve', PLAN(), { decision: 'approve' }, {}, 'Plan approved'],
  ['plan, round 2, approve', PLAN({ round: 2 }), { decision: 'approve' }, {}, 'Plan approved · after 1 round of changes'],
  ['plan, revise with feedback', PLAN(), { decision: 'revise', feedback: 'more tests' }, {}, 'Changes asked · Plan'],
  ['plan, revise perspectives', PLAN(), { decision: 'revise', feedback: 'x', perspectives: ['product', 'ux'] }, {}, 'Changes asked · perspectives'],
  ['plan, stop', PLAN(), { decision: 'stop' }, {}, 'Stopped at the plan'],
  ['requirements, approve', REQUIREMENTS, { decision: 'approve', decisions: {} }, {}, 'Requirements agreed'],
  ['requirements, revise', REQUIREMENTS, { decision: 'revise', feedback: 'x' }, {}, 'Changes asked · Requirements'],
  ['requirements, stop', REQUIREMENTS, { decision: 'stop' }, {}, 'Stopped at the requirements'],
  ['requirements error, retry', REQ_ERROR, { decision: 'retry' }, {}, 'Tried again'],
  ['outline of 3, approve', SPLIT, { decision: 'approve', approveEach: false }, {}, 'Split into 3 runs'],
  ['outline of 3, approve after a merge', SPLIT, { decision: 'approve', edits: [{ op: 'merge', id: 's1' }] }, {}, 'Split into 2 runs'],
  ['outline, flat', SPLIT, { decision: 'flat' }, {}, 'Not split · planned as one run'],
  ['small runs Split, approve keeping 2 objections', SPLIT_SR, { decision: 'approve', approveEach: false, openObjections: 'kept' }, {}, 'Runs approved · 2 objections kept'],
  ['small runs Split, approve', SPLIT_SR, { decision: 'approve', approveEach: false }, {}, 'Runs approved'],
  ['small runs Split, revise', SPLIT_SR, { decision: 'revise', feedback: 'x' }, {}, 'Changes asked · Runs'],
  ['gate, another', GATE, { decision: 'another' }, {}, 'Another cycle started'],
  ['gate, continue', GATE, { decision: 'continue' }, {}, 'Accepted as is'],
  ['recovery, retry', RECOVERY, { decision: 'retry' }, {}, 'Retried'],
  ['recovery, pause', RECOVERY, { decision: 'pause' }, {}, 'Paused'],
  ['recovery, abort', RECOVERY, { decision: 'abort' }, {}, 'Aborted'],
  ['clarify, shaping, 2 of 2', CLARIFY, TWO, { shaping: true }, 'Clarify · 2 answers'],
  ['care below the pick (B2)', CARE, { care: { position: 'lean' } }, {}, 'Care: Lean · your choice · Worca recommended Thorough'],
  ['care at the pick (B2)', CARE, { care: { position: 'thorough' } }, {}, "Care: Thorough · Worca's pick"],
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

// #990 slice 4: the Review loop's gate card lists the code roles through the ONE role-rows component (jsdom, in-process).
const codeRound = () => {
  const f = (id, severity, status) => ({ id, severity, title: id, section: 'src/a.mjs:4', fix: `fix ${id}`, status });
  const role = (key, label, findings) => ({ key, label, skipped: false, checklist: [], findings });
  return { pass: 1, round: 3, node: 'n_review', target: 'diff', plan: 'p', roles: [
    role('correctness', 'Correctness', [f('correctness-3-1', 'major', 'open')]),
    role('security', 'Security', []),
    role('fit', 'Project fit', [f('fit-3-1', 'minor', 'open')])] };
};
async function gateCard(pq) {
  const { JSDOM } = await import('jsdom');
  const { renderGateCard } = await import('../ui/public/shape/step-card.mjs');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const panel = doc.createElement('div');
  renderGateCard(panel, pq, { doc, title: 'Review needs a decision', chip: 'Gate', wireCopy: '', tagLevel: () => {}, submit: async () => true });
  return panel;
}
const GATE_ISSUES = [{ severity: 'major', title: 'correctness-3-1: race', detail: 'lock it', location: 'src/a.mjs:4' }];

test('Review gate card lists the code role rows through the role-rows component, with no second issue list', async () => {
  const panel = await gateCard({ id: 'gate-n_review-3', kind: 'gate', nodeId: 'n_review', issues: GATE_ISSUES, roleReviews: { rounds: [codeRound()] } });
  const rows = [...panel.querySelectorAll('.plan-roles .plan-check-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-label').textContent.split(' · ')[0]), ['Correctness', 'Security', 'Project fit']);
  assert.equal(panel.querySelectorAll('.plan-role-line').length, 1);
  assert.equal(panel.querySelector('.plan-role-line .plan-fold-text').textContent, 'Reviewed by 3 roles · 1 open');
  assert.equal(panel.querySelectorAll('ul.issues').length, 0, 'the rows\' Show already lists the findings');
  assert.equal(panel.querySelector('.plan-finding-section').textContent, 'src/a.mjs:4');
  assert.ok(panel.querySelector('.gate-another') && panel.querySelector('.gate-continue'), 'the buttons are unchanged');
  assert.match(panel.querySelector('.gate-intro').textContent, /with open issues/);
});

test('the gate card without roleReviews keeps its issue list', async () => {
  const panel = await gateCard({ id: 'gate-n_review-3', kind: 'gate', nodeId: 'n_review', issues: GATE_ISSUES });
  assert.equal(panel.querySelectorAll('ul.issues li').length, 1);
  assert.equal(panel.querySelectorAll('.plan-roles').length, 0);
});

test('C1: the Prototype receipts: the remark that changed a requirement, the confirm, the skip; nothing for the rest', () => {
  const pq = (prototype) => ({ id: 'proto-1', kind: 'prototype', prototype });
  const remark = { text: 'R-ux-2 should show dark mode', id: 'R-ux-2', proposed: { text: 'a', example: 'b', was: 'c' } };
  assert.equal(stepReceipt(pq({ moment: 'remark', remark }), { decision: 'change' }), 'Your remark: “R-ux-2 should show dark mode” → R-ux-2 updated');
  assert.equal(stepReceipt(pq({ moment: 'remark', remark }), { decision: 'change' }, { register: 'plain' }), 'Your remark: “R-ux-2 should show dark mode” → the requirement is updated');
  assert.equal(stepReceipt(pq({ moment: 'built', screens: [{}, {}], remarks: 1 }), { decision: 'confirm' }), 'Prototype confirmed · 2 screens · 1 remark');
  assert.equal(stepReceipt(pq({ moment: 'built', screens: [{}], remarks: 0 }), { decision: 'confirm' }), 'Prototype confirmed · 1 screen');
  assert.equal(stepReceipt(pq({ moment: 'offered', position: 'lean' }), { decision: 'skip' }), 'Prototype skipped · Lean builds it only when asked');
  assert.equal(stepReceipt(pq({ moment: 'offered', position: 'balanced' }), { decision: 'skip' }), 'Prototype skipped by you');
  assert.equal(stepReceipt(pq({ moment: 'failed' }), { decision: 'skip' }), 'Prototype skipped by you');
  for (const [m, d] of [['offered', 'build'], ['built', 'remark'], ['remark', 'keep'], ['failed', 'build']]) assert.equal(stepReceipt(pq({ moment: m, remark }), { decision: d }), null, `${m} ${d}`);
});

test('C3: a stop\'s receipt is its answered line (stopDoneText), and the log reads the audit line back the same', async () => {
  const { gateStop, stopDoneText } = await import('../src/shared/shape/run-stops.mjs');
  const { buildDecisionLog } = await import('../src/shared/shape/feature-log.mjs');
  const stop = gateStop({ run: 8, issues: [{ severity: 'major', title: 'x' }], fixCycles: 3 });
  const pq = { id: 'gate-w9-3', kind: 'gate', issues: [], stop };
  assert.equal(stepReceipt(pq, { decision: 'another' }), 'Run 8: another cycle · decided by you');
  assert.equal(stepReceipt(pq, { decision: 'another' }), stopDoneText(stop, { decision: 'another' }));
  const log = buildDecisionLog({ sliced: true, runs: [{ index: 8, events: [stepReceipt(pq, { decision: 'continue' })] }] });
  assert.deepEqual(log.map((r) => [r.run, r.text]), [[8, 'accepted as is · decided by you']]);
});
