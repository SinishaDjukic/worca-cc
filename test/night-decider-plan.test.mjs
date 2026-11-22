// test/night-decider-plan.test.mjs — Away mode's rule for plan asks: every Shaper stop is answered, the way a person may.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAsk } from '../src/core/night/decider.mjs';
import { planRule } from '../src/core/night/strategies.mjs';
import { NIGHT_DEFAULTS, NIGHT_KINDS } from '../src/core/night/config.mjs';
import { validatePlanAnswer, validateOutlineAnswer } from '../src/core/shape/run.mjs';
import { normalizeOutline, checkSlices } from '../src/shared/shape/slices.mjs';

const PASS = { ok: true, passed: 8, total: 8, items: [] };
const FAIL = { ok: false, passed: 3, total: 8, items: [] };
const OUTLINE = { why: 'x', slices: [{ title: 'A' }, { title: 'B' }] };
const plan = (fields = {}) => ({ kind: 'plan', id: 'plan-n_refine-1', plan: { file: 'plan.md', round: 1, check: PASS, ...fields } });
const outline = (fields = {}) => ({ kind: 'plan', id: 'plan-outline-n_plan-1', plan: { outline: OUTLINE, round: 1, check: PASS, ...fields } });
const REQ = { kind: 'requirement', title: 'A plan review names R-po-1', requirements: ['R-po-1'], detail: 'R-po-1 (QA): Add it.' };
const IMPL = { title: 'Store jobs in the DB', detail: 'A restart loses them.', section: 'Decisions' };

const SHAPED = { config: NIGHT_DEFAULTS, shaped: true };
const WAITS = [
  ['no plan on the ask', { kind: 'plan', id: 'x' }],
  ['a Requirements hold whose check failed and cannot be revised', { kind: 'plan', id: 'x', plan: { criteria: FAIL, decisions: [] } }],
];

for (const [name, q] of WAITS) {
  test(`Shaper run, waits for a person: ${name}`, async () => {
    assert.equal(planRule(q, { shaped: true }), null);
    assert.equal(await decideAsk(q, SHAPED), null);
  });
}

// A run that is not a Shaper run keeps the rule it had: only a clean plan, a clean outline or a concern is answered.
const CLASSIC_WAITS = [
  ['a Requirements hold', { kind: 'plan', id: 'x', plan: { criteria: { ok: true, passed: 8, total: 8 }, decisions: [] } }],
  ['a Requirements hold whose files could not be read', { kind: 'plan', id: 'x', plan: { error: 'unreadable' } }],
  ['an outline ask carrying an error', outline({ error: 'Could not set up the later slices' })],
  ['an outline whose check failed', outline({ check: FAIL, revisable: true })],
  ['a failed shape check', plan({ check: FAIL, revisable: true })],
  ['a shape check that errored (null)', plan({ check: null })],
  ['outline-change.md', plan({ outlineChange: 'Slice 1 did not add the tags table.' })],
  ['chat notes', plan({ notes: [{ kind: 'plan', text: 'use a log scale' }] })],
  ['uncovered requirements', plan({ coverage: { ok: false, passed: 7, total: 8, items: [] } })],
  ['attached requirements agreement', plan({ attached: { features: [{ seq: 1, id: 'f1', title: 'Feature' }] } })],
];

for (const [name, q] of CLASSIC_WAITS) {
  test(`not a Shaper run, unchanged, waits for a person: ${name}`, async () => {
    assert.equal(planRule(q), null);
    assert.equal(planRule(q, { shaped: false }), null);
    assert.equal(await decideAsk(q, { config: NIGHT_DEFAULTS }), null);
  });
}

const REVISE = (fields = {}) => ({ decision: 'revise', ...fields });
const ANSWERED = [
  // [name, ask, expected payload (feedback matched by type), flagged, meta.ask]
  ['a Requirements hold whose check passed', { kind: 'plan', id: 'x', plan: { criteria: PASS, decisions: [] } }, { decision: 'approve' }, true, 'requirements'],
  ['a Requirements hold whose check passed, even with a plan check present', plan({ criteria: { ok: true } }), { decision: 'approve' }, true, 'requirements'],
  ['a revisable Requirements hold whose check failed', { kind: 'plan', id: 'x', plan: { criteria: FAIL, decisions: [], revisable: true } }, REVISE({ source: 'check' }), true, 'requirements'],
  ['a Requirements hold whose files could not be read', { kind: 'plan', id: 'x', plan: { error: 'unreadable' } }, { decision: 'retry' }, true, 'requirements'],
  ['a plan ask carrying an error', plan({ error: 'boom' }), { decision: 'retry' }, true, 'requirements'],
  ['an outline ask carrying an error', outline({ error: 'Could not set up the later slices' }), { decision: 'approve', approveEach: false }, true, 'outline'],
  ['a revisable outline whose check failed', outline({ check: FAIL, revisable: true }), REVISE(), true, 'outline'],
  ['an outline whose check failed and cannot be revised', outline({ check: FAIL }), { decision: 'approve', approveEach: false }, true, 'outline'],
  ['an outline with no check', outline({ check: null }), { decision: 'approve', approveEach: false }, true, 'outline'],
  ['a revisable plan whose shape check failed', plan({ check: FAIL, revisable: true }), REVISE({ source: 'check' }), true, 'plan'],
  ['a failed shape check that cannot be revised', plan({ check: FAIL }), { decision: 'approve' }, true, 'plan'],
  ['a shape check that errored (null)', plan({ check: null }), { decision: 'approve' }, true, 'plan'],
  ['a plan with no check field', plan({ check: undefined }), { decision: 'approve' }, true, 'plan'],
  ['a truthy check that does not say ok', plan({ check: { passed: 8, total: 8 } }), { decision: 'approve' }, true, 'plan'],
  ['a requirement concern with a failed check', { ...plan({ check: FAIL }), concern: REQ }, { decision: 'approve' }, true, 'concern'],
  ['outline-change.md', plan({ outlineChange: 'Slice 1 did not add the tags table.', revisable: true }), { decision: 'approve' }, true, 'plan'],
  ['chat notes', plan({ notes: [{ kind: 'plan', text: 'use a log scale' }], revisable: true }), { decision: 'approve' }, true, 'plan'],
  ['revisable uncovered requirements', plan({ coverage: { ok: false, passed: 7, total: 8, items: [] }, revisable: true }), REVISE({ source: 'check' }), true, 'plan'],
  ['coverage that could not be read', plan({ coverage: null }), { decision: 'approve' }, true, 'plan'],
  ['attached requirements agreement on an otherwise clean plan', plan({ attached: { features: [{ seq: 1, id: 'f1', title: 'Feature' }] } }), { decision: 'approve', agreedSeqs: [1] }, true, 'attached'],
  ['attached requirements agreement on an outline ask', outline({ attached: { features: [{ seq: 2, id: 'f1', title: 'Feature' }, { seq: 3, id: 'f2', agreed: true }] } }), { decision: 'approve', agreedSeqs: [2] }, true, 'attached'],
];

for (const [name, q, want, flagged, ask] of ANSWERED) {
  test(`Shaper run, Away answers: ${name}`, async () => {
    const out = await decideAsk(q, SHAPED);
    const { feedback, ...rest } = out.payload;
    if (want.decision === 'revise') assert.equal(typeof feedback, 'string');
    assert.deepEqual(rest, want);
    assert.equal(out.record.choice, want.decision);
    assert.equal(out.record.flagged, flagged);
    assert.deepEqual(out.record.meta, { ask });
    assert.equal(out.record.strategy, 'rule');
  });
}

test('Away sends a stop back once: on a later round a failing plan or outline is approved, flagged; a failing Requirements hold waits', () => {
  for (const q of [plan({ check: FAIL, revisable: true, round: 2 }), outline({ check: FAIL, revisable: true, round: 2 })]) {
    const out = planRule(q, { shaped: true });
    assert.equal(out.payload.decision, 'approve');
    assert.equal(out.flagged, true);
    assert.match(out.reason, /still did not pass/);
  }
  assert.equal(planRule({ kind: 'plan', id: 'x', plan: { criteria: FAIL, decisions: [], revisable: true, round: 2 } }, { shaped: true }), null);
});

test("a check's failing rows become the revise feedback, and the payload passes the real validator", () => {
  const check = { ok: false, passed: 1, total: 2, items: [{ id: 'a', label: 'Acceptance', pass: false, detail: '"B" has no acceptance check' }, { id: 'b', label: 'Count', pass: true }] };
  const out = planRule(plan({ check, revisable: true }), { shaped: true });
  assert.equal(out.payload.feedback, `The plan's checks did not pass. Fix these:\n\n- Acceptance: "B" has no acceptance check`);
  assert.equal(validatePlanAnswer(out.payload, { revisable: true }).ok, true);
  const o = planRule(outline({ check, revisable: true }), { shaped: true });
  assert.equal(validateOutlineAnswer(o.payload, { outline: { why: 'x', slices: [] }, revisable: true }).ok, true);
});

test('a Requirements hold: every decision takes its recommended option, one Q&A question each, and the validator accepts it', () => {
  const decisions = [{ id: 'd-1', text: 'Which store?', recommended: 'pg', options: [{ value: 'sqlite', label: 'SQLite' }, { value: 'pg', label: 'Postgres' }] }];
  const out = planRule({ kind: 'plan', id: 'x', plan: { criteria: PASS, decisions } }, { shaped: true });
  assert.deepEqual(out.questions.map((x) => [x.id, x.question, x.choice, x.flagged]), [['d-1', 'Which store?', 'Postgres', true]]);
  assert.equal(out.reason, 'agreed to the requirements as written; 1 decision took the recommended option');
  const v = validatePlanAnswer(out.payload, { decisions, criteria: PASS });
  assert.equal(v.ok, true);
  assert.deepEqual(v.payload.decisions, { 'd-1': 'pg' });
});

test('a clean plan is approved by rule: the payload passes the real validator, no analysis, no flag', async () => {
  let analyzed = 0;
  const q = plan();
  const out = await decideAsk(q, { config: NIGHT_DEFAULTS, analyze: async () => { analyzed += 1; return {}; } });
  assert.equal(analyzed, 0);
  assert.deepEqual(out, {
    payload: { decision: 'approve' },
    record: { choice: 'approve', strategy: 'rule', confidence: null, flagged: false, rationale: "the plan's shape check passed",
      reversible: false, meta: { ask: 'plan' } },
  });
  assert.equal(validatePlanAnswer(out.payload, { revisable: true }).ok, true);
});

test('covered requirements and empty notes do not stop a clean plan', () => {
  const out = planRule(plan({ coverage: { ok: true, passed: 8, total: 8, items: [] }, notes: [] }));
  assert.deepEqual(out.payload, { decision: 'approve' });
  assert.equal(out.flagged, false);
});

test('outline approve keeps the switch: on stays on, absent stays off', async () => {
  const on = await decideAsk(outline({ approveEach: true }), { config: NIGHT_DEFAULTS });
  const off = await decideAsk(outline(), { config: NIGHT_DEFAULTS });
  assert.deepEqual(on.payload, { decision: 'approve', approveEach: true });
  assert.deepEqual(off.payload, { decision: 'approve', approveEach: false });
  assert.equal(off.record.rationale, "the slice outline's check passed");
  assert.deepEqual(off.record.meta, { ask: 'outline' });
  assert.equal(off.record.flagged, false);
  const real = { why: 'because', slices: [{ id: 'a', title: 'A', dependsOn: [] }, { id: 'b', title: 'B', dependsOn: [] }] };
  for (const payload of [on.payload, off.payload]) {
    const v = validateOutlineAnswer(payload, { outline: real, revisable: true });
    assert.equal(v.ok, true);
    assert.equal(v.payload.approveEach, payload.approveEach);
  }
});

test('an outline that leaves out an agreed requirement: approved, but flagged and named', async () => {
  const agreed = [{ id: 'R-po-1', text: 'One' }, { id: 'R-po-2', text: 'Two' }];
  const read = normalizeOutline({ why: 'because', leftOut: [{ id: 'R-po-2', reason: 'too much work' }],
    slices: [{ id: 'a', title: 'A', goal: 'A', dependsOn: [], requirements: ['R-po-1'] }, { id: 'b', title: 'B', goal: 'B', dependsOn: ['a'] }] }, { agreed });
  assert.equal(read.ok, true, read.error);
  const check = checkSlices(read.outline);
  assert.equal(check.items.find((i) => i.id === 'requirements').pass, true, 'a left-out id with a reason passes the check');
  const out = await decideAsk(outline({ outline: read.outline, check: { ...check, ok: true } }), { config: NIGHT_DEFAULTS });
  assert.deepEqual(out.payload, { decision: 'approve', approveEach: false });
  assert.equal(out.record.flagged, true);
  assert.equal(out.record.rationale, "the slice outline's check passed; left out of every slice: R-po-2");
  assert.equal(planRule(outline({ outline: { ...OUTLINE, leftOut: [] } })).flagged, false, 'nothing left out: no flag');
});

test('a requirement concern on a clean plan: approved, flagged, the requirement stays as agreed', async () => {
  const q = { ...plan(), concern: REQ };
  const out = await decideAsk(q, { config: NIGHT_DEFAULTS });
  assert.deepEqual(out.payload, { decision: 'approve' });
  assert.equal(out.record.flagged, true);
  assert.deepEqual(out.record.meta, { ask: 'concern' });
  assert.equal(out.record.rationale, `a reviewer raised a concern on an agreed requirement: ${REQ.title}; the requirement stays as agreed`);
});

test('an implementer concern: approved and flagged, though its plan carries no check', async () => {
  const q = { kind: 'plan', id: 'plan-concern-n_impl-c1', concern: IMPL, plan: { nodeId: 'n_plan', file: 'plan.md', round: 1, revisable: true } };
  const out = await decideAsk(q, { config: NIGHT_DEFAULTS });
  assert.deepEqual(out.payload, { decision: 'approve' });
  assert.equal(out.record.flagged, true);
  assert.deepEqual(out.record.meta, { ask: 'concern' });
  assert.equal(out.record.rationale, `the implementer raised a concern on the plan: ${IMPL.title}; the plan is built as written`);
  assert.equal(validatePlanAnswer(out.payload, { revisable: true }).ok, true);
});

test('open reviewer conflicts: still approved, flagged, and the reason counts them', () => {
  const two = planRule(plan({ openConflicts: 2 }));
  assert.deepEqual(two.payload, { decision: 'approve' });
  assert.equal(two.flagged, true);
  assert.equal(two.reason, "the plan's shape check passed; 2 reviewer conflicts left undecided");
  assert.match(planRule(plan({ openConflicts: 1 })).reason, /; 1 reviewer conflict left undecided$/);
  const both = planRule({ ...plan({ openConflicts: 2 }), concern: REQ });
  assert.match(both.reason, /the requirement stays as agreed; 2 reviewer conflicts left undecided$/);
  assert.equal(both.flagged, true);
});

test('plan is not in NIGHT_KINDS, so it has no "Always wait for me on…" tick', () => {
  assert.equal(NIGHT_KINDS.includes('plan'), false);
});
