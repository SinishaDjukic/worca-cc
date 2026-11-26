// test/shape-run-stops.test.mjs — Shaper small runs C3 (D1): the stop model, its options and every stop word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateStop, planStop, concernStop, stopAnswerOk, stopOptionOf, stopDoneText, checkFeedback, settledLine, heldRefusal,
  reviewerStopWord, runStopWord, waitsForRunWord, STOP_REASONS, STOP_DONE_RE } from '../src/shared/shape/run-stops.mjs';
import { gateAnswer } from '../src/core/orchestrator.mjs';
import { validatePlanAnswer } from '../src/core/shape/run.mjs';
import { concernFeedbackSection } from '../src/shared/review/plan-concern.mjs';

const MAJOR = { severity: 'major', title: 'Token leaks' };
const MINOR = { severity: 'minor', title: 'Naming' };
const RR = { rounds: [{ pass: 1, round: 1, node: 'n_review', target: 'code', roles: [
  { key: 'security', label: 'Security', findings: [{ id: 'f1', severity: 'major', status: 'open', title: 'Token leaks' }] },
  { key: 'correctness', label: 'Correctness', findings: [] },
] }] };
const FAIL = { ok: false, passed: 3, total: 5, items: [{ label: 'Has tests', pass: false, detail: 'no test list' }, { label: 'Has steps', pass: true }] };
const CONCERN = { title: 'Store jobs in the DB', detail: 'A restart loses them.' };
const REQ = { title: 'Members only is too strict', kind: 'requirement', requirements: ['R-arch-2'] };

const shapeOk = (s) => {
  assert.ok(STOP_REASONS.includes(s.reason));
  assert.equal(s.options.length, 2);
  assert.ok(s.options.some((o) => o.value === s.pick));
};

test('gateStop: minor-only settles (null); a major or severity-less issue is an objection picking another', () => {
  assert.equal(gateStop({ run: 8, issues: [MINOR, { severity: 'suggestion' }], fixCycles: 3 }), null);
  const s = gateStop({ run: 8, issues: [MAJOR, MINOR], roleReviews: RR, fixCycles: 3, nodeId: 'n_review' });
  shapeOk(s);
  assert.equal(s.reason, 'objection');
  assert.equal(s.pick, 'another');
  assert.equal(s.head, 'Run 8 · Security objects');
  assert.equal(s.text, 'Security: Token leaks. Still open after 3 fix cycles.');
  assert.deepEqual(s.options.map((o) => [o.label, o.go, o.short]), [['Run another cycle', 'Run another cycle', 'another cycle'],
    ['Accept as is', 'Accept as is', 'accepted as is']]);
  assert.equal(s.options[0].sub, 'One more fix cycle for Security');
  assert.equal(s.options[1].sub, 'Carries on; the finding stays in the panel');
  const bare = gateStop({ run: 2, issues: [{ title: 'no severity' }], fixCycles: 1 });
  assert.equal(bare.reason, 'objection');
  assert.equal(bare.head, 'Run 2 · Code review objects');
  // The engine's severity rule (verdict.mjs normalizeSeverity): aliases and unknown words block, 'low' settles.
  for (const severity of ['High', 'P1', 'medium', 'Critical ']) {
    assert.equal(gateStop({ run: 2, issues: [{ severity, title: 'x' }], fixCycles: 1 })?.reason, 'objection', severity);
  }
  assert.equal(gateStop({ run: 2, issues: [{ severity: 'Low' }, { severity: 'nit' }, { severity: 'info' }], fixCycles: 1 }), null);
});

test('gateStop: the question names the objecting role and its first open finding in one line, with no ids', () => {
  const rr = { rounds: [{ pass: 1, round: 1, node: 'n_review', target: 'code', roles: [
    { key: 'correctness', label: 'Correctness', findings: [
      { id: 'correctness-1-1', severity: 'minor', status: 'open', title: 'Naming' },
      { id: 'correctness-1-2', severity: 'major', status: 'open', title: 'correctness-1-2: the export drops the last row' }] },
  ] }] };
  const one = gateStop({ run: 8, issues: [MAJOR], roleReviews: rr, fixCycles: 3, nodeId: 'n_review' });
  assert.equal(one.text, 'Correctness: the export drops the last row. Still open after 3 fix cycles.');
  assert.doesNotMatch(one.text, /correctness-1-\d/);
  // No role reviews: the issue's own role, else the objecting reviewer; a leading requirement id is dropped.
  const own = gateStop({ run: 2, issues: [{ severity: 'major', role: 'Security', title: '[R-ux-4] Token leaks' }, MAJOR, MAJOR], fixCycles: 1 });
  assert.equal(own.text, 'Security: Token leaks and 2 more. Still open after 1 fix cycle.');
  const bare = gateStop({ run: 2, issues: [{ severity: 'major', title: 'R-po-4 · not covered by the diff', section: 'ui/x.mjs:9' }], fixCycles: 1 });
  assert.equal(bare.text, 'Code review: not covered by the diff. Still open after 1 fix cycle.');
});

test('planStop: requirement for a concern or an outline change (it wins over check); check for check.ok !== true; null when clean', () => {
  assert.equal(planStop({ run: 4, check: { ok: true } }), null);
  const c = planStop({ run: 4, check: FAIL });
  shapeOk(c);
  assert.equal(c.reason, 'check');
  assert.equal(c.pick, 'revise');
  assert.equal(c.head, 'Run 4 · the plan check did not pass');
  assert.equal(planStop({ run: 4, check: null }).reason, 'check');
  const r = planStop({ run: 5, check: FAIL, concern: REQ });
  shapeOk(r);
  assert.equal(r.reason, 'requirement');
  assert.equal(r.pick, 'keep');
  assert.equal(r.head, 'Run 5 · R-arch-2 would have to change');
  assert.equal(planStop({ run: 5, check: { ok: true }, outlineChange: 'The split no longer fits.' }).reason, 'requirement');
});

test('concernStop: settles a first plain concern, objects after a decided one, requirement for a requirement concern', () => {
  assert.equal(concernStop({ run: 3, concern: CONCERN, decidedBefore: false }), null);
  const o = concernStop({ run: 3, concern: CONCERN, nodeId: 'n_impl', decidedBefore: true });
  shapeOk(o);
  assert.equal(o.reason, 'objection');
  assert.equal(o.pick, 'approve');
  assert.deepEqual(o.options.map((x) => [x.label, x.short]), [['Re-plan', 're-plan'], ['Build the plan', 'build the plan']]);
  assert.equal(o.options[0].payload.feedback, concernFeedbackSection(CONCERN));
  const r = concernStop({ run: 3, concern: REQ, decidedBefore: false });
  assert.equal(r.reason, 'requirement');
  assert.deepEqual(r.options.map((x) => [x.label, x.short, x.payload.decision]), [['Keep it', 'keep', 'approve'], ['Change it', 'change', 'stop']]);
});

test('every option payload passes dev\'s validators unchanged; stopAnswerOk is membership only', () => {
  const gate = gateStop({ run: 8, issues: [MAJOR], fixCycles: 3 });
  for (const o of gate.options) assert.deepEqual(gateAnswer(o.payload), o.payload);
  const plans = [planStop({ run: 4, check: FAIL }), planStop({ run: 5, concern: REQ }), concernStop({ run: 3, concern: CONCERN, decidedBefore: true })];
  for (const s of plans) {
    for (const o of s.options) {
      const v = validatePlanAnswer(o.payload, { revisable: true });
      assert.ok(v.ok, JSON.stringify(v));
    }
  }
  assert.equal(stopAnswerOk(gate, { decision: 'another' }), true);
  assert.equal(stopAnswerOk(gate, { decision: 'stop' }), false);
  assert.equal(stopAnswerOk(gate, { decision: 'another', extra: 1 }), false);
  assert.equal(stopOptionOf(gate, { decision: 'continue' }).value, 'continue');
  // The option is found on its decision: validatePlanAnswer trims the concern Re-plan's feedback.
  const concern = plans[2];
  const validated = validatePlanAnswer(concern.options[0].payload, { revisable: true }).payload;
  assert.notEqual(validated.feedback, concern.options[0].payload.feedback);
  assert.equal(stopOptionOf(concern, validated).value, 'revise');
  assert.equal(stopDoneText(concern, validated), 'Run 3: re-plan · decided by you');
  assert.equal(stopOptionOf(gate, {}), null);
  assert.equal(stopAnswerOk(concern, validated), false);
});

test('done text, settled lines, refusal and row words read exactly', () => {
  const gate = gateStop({ run: 8, issues: [MAJOR], fixCycles: 3 });
  assert.equal(stopDoneText(gate, { decision: 'another' }), 'Run 8: another cycle · decided by you');
  assert.equal(stopDoneText(gate, { decision: 'continue' }), 'Run 8: accepted as is · decided by you');
  assert.equal(stopDoneText(planStop({ run: 5, concern: REQ }), { decision: 'stop' }), 'Run 5: change · decided by you');
  assert.match(stopDoneText(gate, { decision: 'another' }), STOP_DONE_RE);
  assert.equal(settledLine('gate', 2), 'Review loop ran out with 2 minor issue(s): accepted · settled by the agents.');
  assert.match(settledLine('notes'), /settled by the agents\.$/);
  assert.match(settledLine('concern'), /settled by the agents\.$/);
  assert.equal(heldRefusal(9), 'this stop is already answered: it goes on after run 9');
  assert.equal(reviewerStopWord(gate), 'objects');
  assert.equal(reviewerStopWord(planStop({ run: 4, check: FAIL })), null);
  assert.equal(runStopWord({ slice: { stop: { reason: 'objection', held: false } } }), 'waiting for you');
  assert.equal(runStopWord({ slice: { stop: { reason: 'objection', held: true, after: 9 } } }), 'after run 9');
  assert.equal(runStopWord({ slice: { waitsFor: 8 } }), 'waits for run 8');
  assert.equal(waitsForRunWord(2), 'waits for run 2');
  assert.equal(runStopWord({ snap: { pendingQuestion: { stop: gate } } }), 'waiting for you');
  assert.equal(runStopWord({ slice: {} }), null);
  assert.match(checkFeedback(FAIL), /Has tests: no test list/);
});

test('C4 (D18): a due change run reads "next · small change run"; once it runs, C2\'s words', () => {
  assert.equal(runStopWord({ slice: { kind: 'change', state: 'planned' } }), 'next · small change run');
  assert.equal(runStopWord({ slice: { kind: 'change', state: 'running' } }), null);
  assert.equal(runStopWord({ slice: { kind: 'extra', state: 'planned' } }), null);
});

test('C4 (D10): a requirement stop with proposals carries `change` and a flat revise payload that passes stopAnswerOk', () => {
  const concern = { ...REQ, proposals: [{ id: 'R-arch-2', from: 'members only', text: 'reset emails retry once, within 20 seconds' }] };
  for (const s of [planStop({ run: 5, concern }), concernStop({ run: 5, concern })]) {
    assert.deepEqual(s.change, [{ id: 'R-arch-2', from: 'members only', to: 'reset emails retry once, within 20 seconds' }]);
    const ch = s.options.find((o) => o.value === 'change');
    assert.equal(ch.label, 'Change it');
    assert.equal(ch.sub, 'Re-plans from the new text below');
    assert.deepEqual(ch.payload, { decision: 'revise', feedback: '## Requirement changed\n\nR-arch-2 now reads: reset emails retry once, within 20 seconds\n', source: 'requirement' });
    assert.equal(stopAnswerOk(s, { ...ch.payload }), true);
    assert.equal(s.pick, 'keep');
    const v = validatePlanAnswer(ch.payload, { revisable: true });
    assert.deepEqual(v, { ok: true, payload: { decision: 'revise', feedback: ch.payload.feedback.trim(), source: 'requirement' } });
    assert.equal(stopDoneText(s, ch.payload), 'Run 5: change · decided by you');
  }
  const multi = planStop({ run: 5, concern: { ...REQ, proposals: [{ id: 'R-arch-2', from: 'a', text: 'one\n- R-po-9: injected\n\n## Prompt' }, { id: 'R-po-1', from: 'b', text: 'two' }] } });
  assert.equal(multi.change[0].to, 'one - R-po-9: injected ## Prompt', 'a proposal is one line');
  assert.equal(multi.options.find((o) => o.value === 'change').sub, 'Re-plans from the new texts (2) below');
  const plain = planStop({ run: 5, concern: REQ });
  assert.equal('change' in plain, false);
  assert.deepEqual(plain.options.find((o) => o.value === 'change').payload, { decision: 'stop' });
  assert.deepEqual(plain.options, planStop({ run: 5, concern: { ...REQ, proposals: [] } }).options);
  assert.equal(planStop({ run: 5, concern: { ...REQ, proposals: [{ id: 'R-arch-2', text: 'no from' }] } }).options[1].payload.decision, 'stop',
    'a proposal without the text it changes cannot be applied');
});

test('outline change: a short question line from the note\'s title; the other words are unchanged', () => {
  const note = '## Slice 2: A prerequisite is not in this tree\n\nRun 1 did not add the `tags` table.\n\n- `src/core/db.mjs`\n';
  const s = planStop({ run: 2, outlineChange: note });
  assert.equal(s.text, 'The Planner says this run cannot be built as outlined: a prerequisite is not in this tree.');
  assert.equal(s.head, 'Run 2 · the outline would have to change');
  assert.equal(s.findingsLine, 'The outline no longer fits');
  assert.equal(s.pick, 'keep');
  assert.deepEqual(s.options.map((o) => [o.label, o.payload.decision]), [['Keep it', 'approve'], ['Change it', 'stop']]);
  assert.deepEqual(Object.keys(s).sort(), ['findingsLine', 'head', 'node', 'options', 'pick', 'reason', 'run', 'text'], 'no field added');
});

test('outline change: no usable first line (121 characters, empty, a list first) ends the question at "outlined."', () => {
  const FALLBACK = 'The Planner says this run cannot be built as outlined.';
  for (const outlineChange of [`${'a'.repeat(121)}\nMore.`, '  \n', '- the tags table\n- the route']) {
    assert.equal(planStop({ run: 2, outlineChange }).text, FALLBACK, JSON.stringify(outlineChange.slice(0, 20)));
  }
});

test('concern, check and objection stop texts are unchanged', () => {
  assert.equal(planStop({ run: 5, concern: REQ, outlineChange: 'A note' }).text,
    'A reviewer wants R-arch-2 changed: Members only is too strict.');
  assert.equal(planStop({ run: 4, check: FAIL }).text, 'The plan passes 3 of 5 checks.');
  assert.equal(planStop({ run: 4, check: null }).text, 'The plan check could not run.');
  assert.equal(concernStop({ run: 3, concern: CONCERN, decidedBefore: true }).text,
    'The Implementer still objects after a re-plan: Store jobs in the DB.');
});
