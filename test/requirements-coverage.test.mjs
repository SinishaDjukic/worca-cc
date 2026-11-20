// The diff coverage provider (`checklist: 'coverage'`): the Requirements role checks the bound R-ids, every other role
// keeps the generic diff brief, and the check a slice row draws. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVERAGE_ROLE, SHAPE_CODE_ROLES, REQUIREMENTS_COVERAGE_CHECKLIST as P, uncoveredTitle, onlyCriteria, requirementsCheck,
} from '../src/shared/review/requirements-coverage.mjs';
import { genericRoleBrief } from '../src/shared/graph/role-review-step.mjs';
import { criterionIds } from '../src/shared/review/coverage.mjs';

const REQ = '# Requirements\n\n- **R-po-1** People see the chart\n- **R-ux-1** It reads well\n- **R-ops-1** It rolls back\n';

test('items: the Requirements role checks the bound ids, every other role none', () => {
  const text = '- **R-po-1** a\n- **R-ops-1** b\n';
  assert.deepEqual(P.items('requirements', 'plan', text), ['R-po-1', 'R-ops-1']);
  assert.deepEqual(P.items('correctness', 'plan', text), []);
  assert.deepEqual(P.roles().map((r) => r.key), ['correctness', 'security', 'fit', 'requirements']);
  assert.deepEqual(COVERAGE_ROLE, { key: 'requirements', label: 'Requirements' });
  assert.deepEqual(P.normalizePicked(['security']), ['correctness', 'security', 'fit', 'requirements']);
  assert.equal(SHAPE_CODE_ROLES.length, 3);
});

test('brief: the coverage contract for Requirements only; another role gets the generic diff brief', () => {
  const b = P.brief('requirements', 'plan', {});
  assert.match(b, /R-x-n · not covered by the diff/);
  assert.match(b, /`major`/);
  assert.ok(b.startsWith(genericRoleBrief(COVERAGE_ROLE, 'diff')));
  assert.equal(P.brief('fit', 'plan', {}), genericRoleBrief({ key: 'fit', label: 'Project fit' }, 'diff'));
  assert.equal(P.brief('other', 'plan', {}), genericRoleBrief({ key: 'other', label: 'other' }, 'diff'));
  assert.equal(P.wantsHouseBrief('fit'), false);
  assert.equal(uncoveredTitle('R-ops-1'), 'R-ops-1 · not covered by the diff');
});

test('onlyCriteria keeps only the given ids, in input order; null ids is identity', () => {
  const out = onlyCriteria(REQ, ['R-ops-1', 'R-po-1']);
  assert.deepEqual(criterionIds(out), ['R-po-1', 'R-ops-1']);
  assert.match(out, /^- \*\*R-po-1\*\* People see the chart$/m);
  assert.equal(onlyCriteria(REQ, null), REQ);
  assert.deepEqual(criterionIds(onlyCriteria(REQ, [])), []);
});

test('requirementsCheck: 2/3 with one issue naming an id; null for no ids; R-po-10 does not mark R-po-1', () => {
  const texts = { 'R-po-1': 'People see the chart', 'R-ux-1': 'It reads well', 'R-ops-1': 'It rolls back' };
  const c = requirementsCheck(['R-po-1', 'R-ux-1', 'R-ops-1'], texts, [{ severity: 'major', title: 'requirements-1-1: R-ops-1 · not covered by the diff' }]);
  assert.deepEqual([c.passed, c.total], [2, 3]);
  const bad = c.items.find((i) => !i.pass);
  assert.deepEqual(bad, { id: 'R-ops-1', label: 'R-ops-1 · not covered by the diff', pass: false, detail: 'It rolls back' });
  assert.equal(c.items[0].label, 'R-po-1 · covered by the diff');
  assert.equal(requirementsCheck([], texts, []), null);
  const ten = requirementsCheck(['R-po-1'], texts, [{ title: 'R-po-10 · not covered by the diff' }]);
  assert.deepEqual([ten.passed, ten.total], [1, 1]);
});

test('requirementsCheck: only the uncovered title marks an id; a same-id plan item or a passing mention does not', () => {
  const c = requirementsCheck(['R-arch-1', 'R-po-1', 'R-ops-1'], {}, [
    { severity: 'major', title: 'R-arch-1 not met: the engine compares a key' },
    { severity: 'minor', title: 'correctness-1-1: R-po-1 reads a stale row' },
    { severity: 'major', title: 'R-ops-1 · not covered by the diff' },
  ]);
  assert.deepEqual(c.items.map((i) => i.pass), [true, true, false]);
});

test('feedsPlanChecklist: false for the Requirements role only', () => {
  assert.equal(P.feedsPlanChecklist('requirements'), false);
  assert.equal(P.feedsPlanChecklist('correctness'), true);
});
