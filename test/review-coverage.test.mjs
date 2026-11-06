// test/review-coverage.test.mjs — the deterministic criteria list, criteria check and plan coverage
// (src/shared/review/coverage.mjs). Pure: no model, no IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criteriaList, criterionIds, criteriaCheck, coverageOf } from '../src/shared/review/coverage.mjs';

const REQS = [
  '# Requirements',
  '',
  '- **R-po-1** A person can export their own runs',
  '- [ ] R-sec-2 Only project members can export',
  '- **R-ops-1** The export rolls back with the flag',
  '',
  '```',
  '- **R-arch-9** fenced, not a criterion',
  '```',
  '- **R-po-1** a duplicate keeps the first text',
  '- **R-bad-0** a zero is not an id',
].join('\n');

test('criteriaList: both line forms, in source order; fenced ids and bad ids ignored; the first duplicate wins', () => {
  assert.deepEqual(criteriaList(REQS), [
    { id: 'R-po-1', text: 'A person can export their own runs' },
    { id: 'R-sec-2', text: 'Only project members can export' },
    { id: 'R-ops-1', text: 'The export rolls back with the flag' },
  ]);
  assert.deepEqual(criterionIds(REQS), ['R-po-1', 'R-sec-2', 'R-ops-1']);
  assert.deepEqual(criteriaList(''), []);
});

test('criteriaCheck: one passing row per criterion; a missing agreed id, a duplicate and a 7th per prefix fail', () => {
  const ok = criteriaCheck('- **R-sec-2** Only members\n- **R-po-1** Export');
  assert.deepEqual(ok, {
    ok: true, passed: 2, total: 2,
    items: [
      { id: 'R-sec-2', label: 'R-sec-2 · Only members', pass: true },
      { id: 'R-po-1', label: 'R-po-1 · Export', pass: true },
    ],
    criteria: [{ id: 'R-sec-2', text: 'Only members' }, { id: 'R-po-1', text: 'Export' }],
  });
  const missing = criteriaCheck('- **R-po-1** Export', { agreed: ['R-po-1', 'R-po-3'] });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.items.at(-1), { id: 'R-po-3', label: 'R-po-3 · agreed in the spec but missing', pass: false });
  const dup = criteriaCheck(REQS);
  assert.deepEqual(dup.items.filter((i) => !i.pass).map((i) => i.label), ['R-po-1 · listed twice']);
  const seven = Array.from({ length: 7 }, (_, i) => `- **R-arch-${i + 1}** item ${i + 1}`).join('\n');
  const many = criteriaCheck(seven);
  assert.deepEqual(many.items.filter((i) => !i.pass).map((i) => i.label), ['R-arch-7 · more than 6 for one perspective']);
  assert.equal(many.passed, 7);
  assert.equal(many.total, 8);
});

const PLAN = [
  '# Plan',
  '',
  '## 2. Decisions',
  '',
  '| D1 | export R-arch-1 boundary | x |',
  '',
  '### Checklist',
  '- [ ] R-qa-1 only in a checklist',
  '',
  '## 4. Implementation steps',
  '',
  '**Step 2: export.** Delivers: R-sec-2.',
  'Step 3 and Step 4 hold R-po-1.',
  '',
  '### Step 5: rollback',
  '- the flag goes off; R-po-2 rolls back',
  '- R-ops-10 holds a different id',
  '',
  '```',
  'R-ux-1 in a fence',
  '```',
  '',
  '## 8. Risks and edge cases',
  '- R-ops-2 a risk only',
  '',
  '## 11. Out of scope',
  '- R-ops-3 out of scope only',
  '',
  '## Open questions',
  '- R-ops-4 an open question only',
  '',
  '## Clarifications (Q&A)',
  '- R-ops-5 only in a clarification',
].join('\n');

test('coverageOf: a line outside checklists, fences and the excluded sections covers; the label names the Step or the heading', () => {
  const c = coverageOf(['R-sec-2', 'R-po-1', 'R-po-2', 'R-arch-1'], PLAN);
  assert.deepEqual(c.items.map((i) => [i.id, i.label, i.pass]), [
    ['R-sec-2', 'R-sec-2 · covered by Step 2', true],
    ['R-po-1', 'R-po-1 · covered by Step 3', true],
    ['R-po-2', 'R-po-2 · covered by Step 5', true],
    ['R-arch-1', 'R-arch-1 · covered by Decisions', true],
  ]);
  assert.equal(c.items[3].section, 'Decisions');
  assert.deepEqual([c.ok, c.passed, c.total], [true, 4, 4]);
});

test('coverageOf: an id only in a Checklist, a fence, Risks, Out of scope, Open questions or Clarifications is not covered; R-ops-1 never matches R-ops-10', () => {
  const ids = ['R-qa-1', 'R-ux-1', 'R-ops-2', 'R-ops-3', 'R-ops-4', 'R-ops-5', 'R-ops-1'];
  const c = coverageOf(ids, PLAN, { texts: { 'R-ops-1': 'The export rolls back' } });
  assert.deepEqual(c.items.map((i) => i.pass), ids.map(() => false));
  assert.deepEqual(c.items.at(-1), { id: 'R-ops-1', label: 'R-ops-1 · not covered by any step', pass: false, detail: 'The export rolls back' });
  assert.deepEqual([c.ok, c.passed, c.total], [false, 0, 7]);
});

test('coverageOf: 0 ids is ok; the same input always gives the same result', () => {
  assert.deepEqual(coverageOf([], PLAN), { ok: true, passed: 0, total: 0, items: [] });
  assert.deepEqual(coverageOf(['R-sec-2'], PLAN), coverageOf(['R-sec-2'], PLAN));
});
