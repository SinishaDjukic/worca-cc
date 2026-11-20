// test/review-decisions.test.mjs — decisions on an approval hold (src/shared/review/decisions.mjs): the refiner's
// decisions file normalised, role conflicts as decisions with the lead's side recommended, the person's picks
// validated, and the Clarifications lines they become. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDecisions, conflictDecisions, validateDecisionPicks, decisionClarifications, DECISIONS_MAX,
} from '../src/shared/review/decisions.mjs';

const entry = (n, extra = {}) => ({
  id: `x${n}`, text: `Question ${n}?`,
  options: [{ value: 'a', label: 'One way' }, { value: 'b', label: 'Other way' }], recommended: 'a', ...extra,
});

test('normalizeDecisions: 9 entries keep 8, re-minted d-1…d-8; optional plain, criteria and from survive', () => {
  const raw = { decisions: Array.from({ length: 9 }, (_, i) => entry(i + 1)) };
  raw.decisions[0] = entry(1, { plain: 'Plain one', criteria: ['R-sec-2'], from: ['security'],
    options: [{ value: 'a', label: 'One `x`', plain: 'One' }, { value: 'b', label: 'Other way' }] });
  const { decisions, errors } = normalizeDecisions(raw);
  assert.equal(DECISIONS_MAX, 8);
  assert.deepEqual(decisions.map((d) => d.id), ['d-1', 'd-2', 'd-3', 'd-4', 'd-5', 'd-6', 'd-7', 'd-8']);
  assert.deepEqual(decisions[0], {
    id: 'd-1', text: 'Question 1?', plain: 'Plain one',
    options: [{ value: 'a', label: 'One `x`', plain: 'One' }, { value: 'b', label: 'Other way' }],
    recommended: 'a', criteria: ['R-sec-2'], from: ['security'],
  });
  assert.deepEqual(decisions[1], { id: 'd-2', text: 'Question 2?', options: [{ value: 'a', label: 'One way' }, { value: 'b', label: 'Other way' }], recommended: 'a' });
  assert.deepEqual(errors, ['decisions: only the first 8 are kept']);
});

test('normalizeDecisions: a bad entry is dropped with one error each; a non-object is refused', () => {
  const { decisions, errors } = normalizeDecisions({ decisions: [
    entry(1, { recommended: 'zzz' }),
    entry(2, { options: [{ value: 'a', label: 'Only' }] }),
    entry(3, { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'A again' }] }),
    entry(4, { text: '' }),
    entry(5),
  ] });
  assert.deepEqual(decisions.map((d) => [d.id, d.text]), [['d-1', 'Question 5?']]);
  assert.deepEqual(errors, [
    'decisions[0]: recommended must name an option',
    'decisions[1]: 2–4 options with distinct values',
    'decisions[2]: 2–4 options with distinct values',
    'decisions[3]: text must be 1–300 characters',
  ]);
  assert.deepEqual(normalizeDecisions(null), { decisions: [], errors: ['decisions must be an object'] });
  assert.deepEqual(normalizeDecisions([]), { decisions: [], errors: ['decisions must be an object'] });
  assert.deepEqual(normalizeDecisions({}), { decisions: [], errors: [] });
});

test('normalizeDecisions: an option keeps persona and reason; one with neither keeps its exact shape', () => {
  const { decisions } = normalizeDecisions({ decisions: [entry(1, {
    options: [{ value: 'a', label: 'One way', persona: ' security ', reason: 'emails are\n personal data' }, { value: 'b', label: 'Other way' }],
  })] });
  assert.deepEqual(decisions[0].options, [
    { value: 'a', label: 'One way', persona: 'security', reason: 'emails are personal data' },
    { value: 'b', label: 'Other way' },
  ]);
});

test('normalizeDecisions: an over-long persona or reason is dropped, and the option and decision stay', () => {
  const { decisions, errors } = normalizeDecisions({ decisions: [entry(1, {
    options: [
      { value: 'a', label: 'One way', persona: 'x'.repeat(61), reason: 'kept' },
      { value: 'b', label: 'Other way', persona: 'ux', reason: 'x'.repeat(201) },
    ],
  })] });
  assert.deepEqual(errors, []);
  assert.deepEqual(decisions[0].options, [
    { value: 'a', label: 'One way', reason: 'kept' },
    { value: 'b', label: 'Other way', persona: 'ux' },
  ]);
  const atCap = normalizeDecisions({ decisions: [entry(1, {
    options: [{ value: 'a', label: 'One way', persona: 'x'.repeat(60), reason: 'x'.repeat(200) }, { value: 'b', label: 'Other way' }],
  })] }).decisions[0].options[0];
  assert.deepEqual([atCap.persona.length, atCap.reason.length], [60, 200]);
  // An agent's non-string field is dropped like an over-long one: never coerced to `[object Object]`, never a throw.
  for (const bad of [{ toString: 1 }, { a: 1 }, ['x', 'y'], 7, true]) {
    const { decisions, errors } = normalizeDecisions({ decisions: [{ text: 'Q?', recommended: 'a',
      options: [{ value: 'a', label: 'One way', persona: bad, reason: bad }, { value: 'b', label: 'Other way' }] }] });
    assert.deepEqual(errors, []);
    assert.deepEqual(decisions[0].options[0], { value: 'a', label: 'One way' });
  }
});

const CONFLICT = { id: 'conflict-1', findings: ['security-1-1', 'product-1-2'], roles: ['security', 'product'], section: 'Export',
  question: 'Email in export?', options: ['Leave them out', 'Include them'] };

test('conflictDecisions: the lead\'s side is recommended, the other side the alternative; numbering continues within 8', () => {
  const sec = conflictDecisions([CONFLICT], { lead: 'security' });
  assert.deepEqual(sec, [{
    id: 'd-1', text: 'Email in export?', options: [{ value: 'leave-them-out', label: 'Leave them out', persona: 'security' }, { value: 'include-them', label: 'Include them', persona: 'product' }],
    recommended: 'leave-them-out', from: ['security', 'product'],
  }]);
  assert.equal(conflictDecisions([CONFLICT], { lead: 'product' })[0].recommended, 'include-them');
  assert.equal(conflictDecisions([CONFLICT], {})[0].recommended, 'leave-them-out', 'no lead: the first option');
  assert.deepEqual(conflictDecisions([CONFLICT], { lead: 'security', after: 7 }).map((d) => d.id), ['d-8']);
  assert.deepEqual(conflictDecisions([CONFLICT], { lead: 'security', after: 8 }), [], 'the cap of 8 holds');
});

test('conflictDecisions: option i takes roles[i] as persona; an option past the roles has none', () => {
  const [d] = conflictDecisions([{ ...CONFLICT, options: ['Leave them out', 'Include them', 'Ask each time'] }], {});
  assert.deepEqual(d.options.map((o) => o.persona ?? null), ['security', 'product', null]);
  assert.equal(Object.hasOwn(d.options[2], 'persona'), false);
  const [noRoles] = conflictDecisions([{ ...CONFLICT, roles: undefined }], {});
  assert.deepEqual(noRoles.options, [{ value: 'leave-them-out', label: 'Leave them out' }, { value: 'include-them', label: 'Include them' }]);
});

test('validateDecisionPicks: an unknown value is refused at decisions.d-2; a missing pick takes recommended', () => {
  const { decisions } = normalizeDecisions({ decisions: [entry(1), entry(2)] });
  assert.deepEqual(validateDecisionPicks({ 'd-1': 'b' }, decisions), { ok: true, picks: { 'd-1': 'b', 'd-2': 'a' } });
  assert.deepEqual(validateDecisionPicks(undefined, decisions), { ok: true, picks: { 'd-1': 'a', 'd-2': 'a' } });
  assert.deepEqual(validateDecisionPicks({ 'd-2': 'nope' }, decisions), {
    ok: false, errors: [{ path: 'decisions.d-2', code: 'invalid', message: 'pick one of: a, b' }],
  });
  assert.deepEqual(validateDecisionPicks('a', decisions), {
    ok: false, errors: [{ path: 'decisions', code: 'invalid', message: 'decisions must be an object of picks' }],
  });
  assert.deepEqual(validateDecisionPicks({ 'd-9': 'a' }, decisions).picks, { 'd-1': 'a', 'd-2': 'a' }, 'an unknown id is ignored');
});

test('decisionClarifications: one Q&A line per decision, the picked option\'s label', () => {
  const { decisions } = normalizeDecisions({ decisions: [entry(1), entry(2)] });
  assert.deepEqual(decisionClarifications(decisions, { 'd-1': 'b', 'd-2': 'a' }), [
    '- **d-1** — Question 1? → **Other way (decided at approval)**',
    '- **d-2** — Question 2? → **One way (decided at approval)**',
  ]);
});
