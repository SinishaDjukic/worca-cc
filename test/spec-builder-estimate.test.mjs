import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRecipe, estimateSpec, quantile, MIN_SAMPLES } from '../src/core/spec-builder/estimate.mjs';

const fm = (over = {}) => ({ kind: 'feature', size: 'medium', roles: ['product'], ...over });

test('pickRecipe: every size × risky × UX combination', () => {
  for (const size of ['small', 'medium', 'large']) for (const risky of [false, true]) for (const ux of [false, true]) {
    const big = size === 'large' || risky;
    const want = big ? (ux ? 'plan-complete-large+web' : 'plan-complete-large') : (ux ? 'plan-complete-detailed+web' : 'plan-complete-detailed');
    const got = pickRecipe(fm({ size, ...(risky ? { signals: ['risky'] } : {}), roles: ux ? ['product', 'ux'] : ['product'] }));
    assert.equal(got, want, `${size} risky=${risky} ux=${ux}`);
  }
});

test('≥ 3 samples → basis history, median low, p90 × loops high', () => {
  const h = { costs: [1, 2, 3, 4, 5], ms: [10, 20, 30, 40, 50] };
  const e = estimateSpec(fm(), { history: { implementer: h, reviewer: h } });
  assert.equal(e.recipe, 'plan-complete-detailed');
  assert.equal(e.basis, 'history');
  assert.equal(e.samples, 5);
  const impl = e.stages.find((s) => s.phase === 'implementer');
  assert.equal(impl.low, 3);
  assert.equal(impl.loops, 3);
  assert.equal(impl.high, 13.8);              // p90 = 4.6, × 3 cycles
  assert.equal(impl.ms, 30);
  assert.equal(e.low, 6);
});

test('an empty history is rough, priced from list prices', () => {
  const e = estimateSpec(fm(), { history: {} });
  assert.equal(e.basis, 'rough');
  assert.equal(e.samples, 0);
  assert.ok(e.low > 0 && e.high > e.low);
});

test('samples counts distinct runs when the history says so (cycles are not runs)', () => {
  const h = { costs: [1, 2, 3, 4, 5, 6], ms: [1, 2, 3, 4, 5, 6], runs: 2 };
  const e = estimateSpec(fm(), { history: { implementer: h, reviewer: { ...h, runs: 4 } } });
  assert.equal(e.basis, 'history');
  assert.equal(e.samples, 2);
});

test('fewer than MIN_SAMPLES for one phase → mixed', () => {
  const h = { costs: [1, 1, 1], ms: [1, 1, 1] };
  const e = estimateSpec(fm(), { history: { implementer: h, reviewer: { costs: [1], ms: [1] } } });
  assert.equal(MIN_SAMPLES, 3);
  assert.equal(e.basis, 'mixed');
});

test('loops multiply the high end only', () => {
  const e = estimateSpec(fm({ size: 'large' }), { history: {} });
  const ref = e.stages.find((s) => s.phase === 'refiner');
  assert.equal(ref.loops, 3);
  assert.equal(ref.high, Math.round(ref.low * 2 * 3 * 100) / 100);
});

test('UX adds the web stages; Security adds Refine', () => {
  assert.deepEqual(estimateSpec(fm({ roles: ['product', 'ux'] })).stages.map((s) => s.phase), ['implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting']);
  assert.deepEqual(estimateSpec(fm({ signals: ['risky'], roles: ['product', 'security'] })).stages.map((s) => s.phase), ['refiner', 'implementer', 'reviewer']);
});

test('deterministic: same input, same output; inputs are not mutated', () => {
  const history = { implementer: { costs: [5, 1, 3], ms: [3, 1, 2] } };
  const a = estimateSpec(fm(), { history });
  assert.deepEqual(estimateSpec(fm(), { history }), a);
  assert.deepEqual(history.implementer.costs, [5, 1, 3]);
  assert.equal(quantile([], 0.5), 0);
});
