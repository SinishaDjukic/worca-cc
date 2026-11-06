// test/night-decider-plan.test.mjs — Away mode's rule for plan asks: a person answers what to build, Away handles how.
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

const WAITS = [
  ['no plan on the ask', { kind: 'plan', id: 'x' }],
  ['a Requirements hold', { kind: 'plan', id: 'x', plan: { criteria: { ok: true, passed: 8, total: 8 }, decisions: [] } }],
  ['a Requirements hold whose check passed, even with a plan check present', plan({ criteria: { ok: true } })],
  ['a Requirements hold whose files could not be read', { kind: 'plan', id: 'x', plan: { error: 'unreadable' } }],
  ['a plan ask carrying an error', plan({ error: 'boom' })],
  ['an outline ask carrying an error', outline({ error: 'Could not set up the later slices' })],
  ['an outline whose check failed', outline({ check: FAIL })],
  ['an outline with no check', outline({ check: null })],
  ['a failed shape check', plan({ check: FAIL })],
  ['a shape check that errored (null)', plan({ check: null })],
  ['a plan with no check field', plan({ check: undefined })],
  ['a truthy check that does not say ok', plan({ check: { passed: 8, total: 8 } })],
  ['a requirement concern with a failed check', { ...plan({ check: FAIL }), concern: REQ }],
  ['outline-change.md', plan({ outlineChange: 'Slice 1 did not add the tags table.' })],
  ['chat notes', plan({ notes: [{ kind: 'plan', text: 'use a log scale' }] })],
  ['uncovered requirements', plan({ coverage: { ok: false, passed: 7, total: 8, items: [] } })],
  ['coverage that could not be read', plan({ coverage: null })],
];

for (const [name, q] of WAITS) {
  test(`waits for a person: ${name}`, async () => {
    assert.equal(planRule(q), null);
    assert.equal(await decideAsk(q, { config: NIGHT_DEFAULTS }), null);
  });
}

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
