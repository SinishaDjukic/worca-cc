// Shaper small runs C2: the Care-per-run plan (careRunPlan), the run's roles (runRolesOf) and the Care graph
// (careRunGraph).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careRunPlan, careModelRoles } from '../src/shared/shape/feature-record.mjs';
import { runRolesOf } from '../src/shared/shape/requirements.mjs';
import { CHALLENGER_KEY, CHALLENGER_LABEL } from '../src/shared/shape/perspectives.mjs';
import * as split from '../src/core/shape/split-step.mjs';

const ROLES = ['product', 'architect', 'security'];

test('careRunPlan per position: Test writer, plan reviewers, Challenger, second opinion, fix cycles, model roles', () => {
  assert.deepEqual(careRunPlan('lean', { runRoles: ROLES }), {
    position: 'lean', testWriter: false, planReviewers: ['product', 'architect'], challenger: false, secondOpinion: null,
    fixCycles: 1, modelRoles: careModelRoles('lean'),
  });
  assert.deepEqual(careRunPlan('balanced', { runRoles: ROLES }), {
    position: 'balanced', testWriter: true, planReviewers: ROLES, challenger: false, secondOpinion: null,
    fixCycles: 2, modelRoles: careModelRoles('balanced'),
  });
  assert.deepEqual(careRunPlan('thorough', { runRoles: ROLES }), {
    position: 'thorough', testWriter: true, planReviewers: [...ROLES, CHALLENGER_KEY], challenger: true, secondOpinion: 'product',
    fixCycles: 3, modelRoles: careModelRoles('thorough'),
  });
});

test('careRunPlan Lean: the lead joins Product when it is one of the run roles, else the first other role', () => {
  assert.deepEqual(careRunPlan('lean', { runRoles: ROLES, lead: 'security' }).planReviewers, ['product', 'security']);
  assert.deepEqual(careRunPlan('lean', { runRoles: ROLES, lead: 'ux' }).planReviewers, ['product', 'architect']);
  assert.deepEqual(careRunPlan('lean', { runRoles: ROLES, lead: 'product' }).planReviewers, ['product', 'architect']);
});

test('careRunPlan: a run with no other role reviews as Product only; never empty, never devil below Thorough', () => {
  for (const pos of ['lean', 'balanced']) assert.deepEqual(careRunPlan(pos, { runRoles: ['product'] }).planReviewers, ['product']);
  assert.deepEqual(careRunPlan('thorough', { runRoles: ['product'] }).planReviewers, ['product', CHALLENGER_KEY]);
  assert.deepEqual(careRunPlan('balanced').planReviewers, ['product']);
  assert.deepEqual(careRunPlan('balanced', { runRoles: [] }).planReviewers, ['product']);
});

test('careRunPlan: an unknown position reads as the default (Balanced) and never throws', () => {
  for (const pos of [undefined, null, 'extreme', 3]) {
    const p = careRunPlan(pos, { runRoles: ROLES });
    assert.equal(p.position, 'balanced');
    assert.equal(p.fixCycles, 2);
  }
  assert.doesNotThrow(() => careRunPlan('lean', null));
});

test('runRolesOf: Product plus the perspectives of the owned ids, deduplicated, in perspective order', () => {
  assert.deepEqual(runRolesOf(['R-sec-1', 'R-arch-2', 'R-sec-2']), ['product', 'architect', 'security']);
  assert.deepEqual(runRolesOf(['R-ux-1', 'R-po-3']), ['product', 'ux']);
  // Compliance sits after DevOps in the small-runs order, so before Release.
  assert.deepEqual(runRolesOf(['R-rel-1', 'R-comp-1']), ['product', 'compliance', 'release']);
  assert.deepEqual(runRolesOf([]), ['product']);
  assert.deepEqual(runRolesOf(null), ['product']);
  assert.notDeepEqual(runRolesOf(['R-arch-1']), runRolesOf(['R-qa-1']));
});

test('the Challenger constants live in perspectives.mjs; split-step re-exports them', () => {
  assert.equal(CHALLENGER_KEY, 'devil');
  assert.equal(CHALLENGER_LABEL, 'Challenger');
  assert.equal(split.CHALLENGER_KEY, CHALLENGER_KEY);
  assert.equal(split.CHALLENGER_LABEL, CHALLENGER_LABEL);
});

test('careRunGraph is pure; Test writer, fix cycles and second opinion follow the plan; a template without w14 gets none', async () => {
  const { careRunGraph } = await import('../src/core/shape/care-run.mjs');
  const { GRAPH_SHAPE_SLICE_REQ_WORKFLOW: slice, GRAPH_SHAPE_UX_SLICE_REQ_WORKFLOW: ux } = await import('../src/core/graph/builtin-workflows.mjs');
  const plain = JSON.parse(JSON.stringify(slice));
  const before = JSON.stringify(plain);
  const thorough = careRunGraph(plain, careRunPlan('thorough', { runRoles: ROLES }));
  assert.equal(JSON.stringify(plain), before, 'the input is never changed');
  assert.notEqual(thorough, plain);
  const node = (g, id) => g.nodes.find((n) => n.id === id);
  const cycles = (g, id) => g.wires.find((w) => w.id === id)?.config?.maxCycles;
  assert.ok(node(thorough, 'n_tests'));
  assert.equal(cycles(thorough, 'w9'), 3);
  assert.equal(thorough.wires.some((w) => w.id === 'w14'), false, 'no w14 is added');
  assert.equal(node(thorough, 'n_roles').config.roleReview.secondOpinion, 'product');
  const lean = careRunGraph(plain, careRunPlan('lean', { runRoles: ROLES }));
  assert.equal(node(lean, 'n_tests'), undefined);
  assert.equal(cycles(lean, 'w9'), 1);
  assert.equal('secondOpinion' in node(lean, 'n_roles').config.roleReview, false);
  const bal = careRunGraph(ux, careRunPlan('balanced', { runRoles: ROLES }));
  assert.deepEqual([cycles(bal, 'w9'), cycles(bal, 'w14'), cycles(bal, 'w5')], [2, 2, 2], 'the plan review loop w5 is not Care\'s');
  assert.ok(Object.isFrozen(ux), 'the frozen template stays frozen and unchanged');
});
