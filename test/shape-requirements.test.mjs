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

// Shaper requirements s3 (D13): a requirements-first Changes run takes the stage, a follow-up slice included.
test('shapeRequirementsEligible: requirementsFirst, a slice included, only with the flag on; it wins over the slice variant', async () => {
  const { resolveShapeRequest } = await import('../src/core/shape/run.mjs');
  assert.equal(shapeRequirementsEligible({ slice: { index: 2 }, requirementsFirst: true }, true), true);
  assert.equal(shapeRequirementsEligible({ slice: { index: 2 }, requirementsFirst: true }, false), false);
  const slice = { feature: 'f1', index: 2, total: 2, outline: { agreed: [{ id: 'R-po-1', text: 'a' }], leftOut: [], slices: [
    { id: 's1', title: 'One', goal: 'g', inScope: [], outOfScope: [], acceptance: ['a'], dependsOn: [], estimate: 'small', requirements: ['R-po-1'] },
    { id: 's2', title: 'Follow-up', goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: null, requirements: [] }] } };
  const fire = (shape, requirementsOn) => resolveShapeRequest({ shape, workflowId: 'wf_shape' }, { internal: true, requirementsOn });
  const on = fire({ perspectives: ['product'], slices: 'off', slice, requirementsFirst: true }, true);
  assert.equal(on.ok, true, on.error);
  assert.deepEqual([on.workflowId, on.shape.requirementsFirst], ['wf_shape_req', true]);
  assert.equal(fire({ perspectives: ['product', 'ux'], slices: 'off', slice, requirementsFirst: true }, true).workflowId, 'wf_shape_ux_req');
  assert.equal(fire({ perspectives: ['product'], slices: 'off', slice, requirementsFirst: true }, false).workflowId, 'wf_shape', 'flag off: the rollback');
  assert.equal(fire({ perspectives: ['product'], slices: 'off', slice: { ...slice, index: 1 } }, true).workflowId, 'wf_shape_slice_req', 'a plain slice keeps its variant');
  assert.deepEqual(fire({ perspectives: ['product'], requirementsFirst: 'yes' }, true), { ok: false, error: 'shape.requirementsFirst must be true' });
  assert.match(resolveShapeRequest({ shape: { requirementsFirst: true } }, { requirementsOn: true }).error, /unknown field\(s\): requirementsFirst/, 'internal only');
});
