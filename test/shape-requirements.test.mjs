// test/shape-requirements.test.mjs — Shaper's requirements stage configuration (src/shared/shape/requirements.mjs):
// the provider's roles and items, lead and supporting asks, and the skip rule. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIREMENTS_ROLE_CHECKLIST, REQUIREMENT_PREFIX, requirementsAsks, shapeRequirementsEligible,
} from '../src/shared/shape/requirements.mjs';
import { ROLE_CHECKLISTS, roleReviewOf } from '../src/shared/graph/role-review-step.mjs';

const MD = '- **R-po-1** Export\n- **R-sec-1** Members only\n- **R-sec-2** No secrets\n- **R-ops-1** Rolls back';

test('the provider is registered and its roles exclude Project fit and the Devil\'s advocate', () => {
  assert.equal(ROLE_CHECKLISTS.requirements, REQUIREMENTS_ROLE_CHECKLIST);
  const keys = REQUIREMENTS_ROLE_CHECKLIST.roles().map((r) => r.key);
  assert.deepEqual(keys, Object.keys(REQUIREMENT_PREFIX));
  assert.equal(keys.includes('fit') || keys.includes('devil'), false);
  assert.deepEqual(REQUIREMENTS_ROLE_CHECKLIST.normalizePicked(['security', 'fit']), ['product', 'security']);
  assert.deepEqual(roleReviewOf({ roleReview: { source: 'picked', target: 'requirements', checklist: 'requirements', sink: 'refiner' } }).roles.map((r) => r.key), keys);
});

test('items lists only that perspective\'s criteria', () => {
  assert.deepEqual(REQUIREMENTS_ROLE_CHECKLIST.items('security', MD), ['R-sec-1', 'R-sec-2']);
  assert.deepEqual(REQUIREMENTS_ROLE_CHECKLIST.items('ux', MD), []);
});

test('the lead brief differs from the supporting brief; both list the role\'s criteria', () => {
  const lead = REQUIREMENTS_ROLE_CHECKLIST.brief('security', MD, { shape: { lead: 'security' } });
  const support = REQUIREMENTS_ROLE_CHECKLIST.brief('security', MD, { shape: { lead: 'architect' } });
  assert.notEqual(lead, support);
  assert.match(lead, /You lead\./);
  assert.match(support, /You support Architect, who leads\./);
  for (const b of [lead, support]) {
    assert.match(b, /^## Your role: Security\n/);
    assert.match(b, /`R-sec-1`: Members only/);
    assert.doesNotMatch(b, /R-po-1/);
  }
  assert.equal(requirementsAsks('fit', { lead: 'product' }), '');
});

test('shapeRequirementsEligible: flag on, medium or large, not a slice ticket', () => {
  assert.equal(shapeRequirementsEligible({ size: 'large' }, true), true);
  assert.equal(shapeRequirementsEligible({ size: 'medium' }, true), true);
  assert.equal(shapeRequirementsEligible({ size: 'small' }, true), false);
  assert.equal(shapeRequirementsEligible({}, true), false);
  assert.equal(shapeRequirementsEligible({ size: 'large' }, false), false);
  assert.equal(shapeRequirementsEligible({ size: 'large', slice: { index: 1 } }, true), false);
});
