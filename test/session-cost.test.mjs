// test/session-cost.test.mjs — every dollar of a turn lands once: the step's share plus the main agent's overhead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTurnCost, splitCarried, reconcileTurn, reconcileEpoch, estimateMemberUsd, priceUsage, toleranceFor, usageTokens,
  RECONCILE_EST_ABS_USD, RECONCILE_EST_REL } from '../src/core/session-cost.mjs';
import { checkRows } from './helpers/rows.mjs';

const HOST = { input_tokens: 1000, output_tokens: 20 };              // Haiku 4.5: 1000×1 + 20×5 per Mtok = $0.0011
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);

test('pricing and tolerances', () => {
  near(priceUsage('claude-haiku-4-5', HOST), 0.0011);
  assert.ok(Number.isNaN(priceUsage('no-such-model', HOST)));
  assert.deepEqual(usageTokens({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), { in: 1, out: 2, cr: 3, cw: 4 });
  assert.equal(toleranceFor(0.01), 0.001);
  near(toleranceFor(1), 0.02);
  assert.deepEqual([RECONCILE_EST_ABS_USD, RECONCILE_EST_REL], [0.01, 0.15]);
  near(toleranceFor(1, { abs: RECONCILE_EST_ABS_USD, rel: RECONCILE_EST_REL }), 0.15);
});

test('C33 — the estimate counts the investigators at their own models; unpriceable parts are skipped', () => {
  near(estimateMemberUsd({ memberUsage: HOST, memberModel: 'claude-haiku-4-5', investigators: [{ usage: HOST, resolvedModel: 'claude-haiku-4-5' }, { usage: HOST, resolvedModel: 'mystery' }] }), 0.0022);
  assert.ok(Number.isNaN(estimateMemberUsd({ memberUsage: HOST, memberModel: null, investigators: [] })));
});

test('the split table', async () => {
  await checkRows([
    { name: 'harness: Δ = member + host', run: () => {
      const r = splitTurnCost({ deltaUsd: 0.5, hostUsage: HOST, hostModel: 'claude-haiku-4-5', memberUsage: {}, memberModel: 'x', engineCost: true });
      near(r.hostOverheadUsd, 0.0011); near(r.memberUsd, 0.4989); assert.equal(r.costSource, 'harness'); assert.equal(r.hostPriced, true);
    } },
    { name: 'harness: host overhead clamped to Δ', run: () => {
      const r = splitTurnCost({ deltaUsd: 0.0005, hostUsage: HOST, hostModel: 'claude-haiku-4-5', engineCost: true });
      near(r.hostOverheadUsd, 0.0005); near(r.memberUsd, 0);
    } },
    { name: 'harness: unpriced host books 0 overhead', run: () => {
      const r = splitTurnCost({ deltaUsd: 0.5, hostUsage: HOST, hostModel: 'mystery', engineCost: true });
      assert.equal(r.hostOverheadUsd, 0); near(r.memberUsd, 0.5); assert.equal(r.hostPriced, false);
    } },
    { name: 'C34 bridge: the upstream figure wins over the CLI\'s Δ', run: () => {
      const r = splitTurnCost({ deltaUsd: 0, bridgeUsd: 0.3, hostUsage: HOST, hostModel: 'claude-haiku-4-5', engineCost: true });
      assert.equal(r.costSource, 'bridge'); near(r.memberUsd, 0.2989); near(r.hostOverheadUsd, 0.0011);
    } },
    { name: 'hook when the harness figure is missing', run: () => {
      const r = splitTurnCost({ deltaUsd: NaN, hookUsd: 0.3, hostUsage: HOST, hostModel: 'claude-haiku-4-5', engineCost: true });
      assert.equal(r.costSource, 'hook'); near(r.memberUsd, 0.3);
    } },
    { name: 'estimate when the engine reports cost but this result had none', run: () => {
      const r = splitTurnCost({ deltaUsd: NaN, memberUsage: HOST, memberModel: 'claude-haiku-4-5', engineCost: true });
      assert.equal(r.costSource, 'estimate'); near(r.memberUsd, 0.0011);
    } },
    { name: 'none on an engine without cost (Copilot): blank, never 0', run: () => {
      const r = splitTurnCost({ deltaUsd: NaN, memberUsage: HOST, memberModel: 'claude-haiku-4-5', engineCost: false });
      assert.deepEqual([r.memberUsd, r.hostOverheadUsd, r.costSource], [null, null, 'none']);
    } },
  ]);
});

test('C9 — carried spend: the cut turn gets its priced usage, capped at Δ; the rest is the current turn\'s', () => {
  assert.deepEqual(splitCarried({ deltaUsd: 0.5, cutUsd: 0.07 }), { carriedUsd: 0.07, restUsd: 0.43 });
  assert.deepEqual(splitCarried({ deltaUsd: 0.05, cutUsd: 0.07 }), { carriedUsd: 0.05, restUsd: 0 });
  assert.deepEqual(splitCarried({ deltaUsd: 0.5, cutUsd: NaN }), { carriedUsd: 0, restUsd: 0.5 });
});

test('reconcile: hook within 2%, estimate within max($0.01, 15%); the booking never changes', () => {
  assert.deepEqual(reconcileTurn({ memberUsd: 1, hookUsd: 1.019, estimateUsd: NaN, costSource: 'harness' }),
    { ok: true, checks: [{ method: 'hook', harnessUsd: 1, otherUsd: 1.019, tolerance: 0.02, ok: true }] });
  assert.equal(reconcileTurn({ memberUsd: 1, hookUsd: NaN, estimateUsd: 1.14, costSource: 'harness' }).ok, true, 'a 14% estimate gap is noise, not a mismatch');
  const bad = reconcileTurn({ memberUsd: 1, hookUsd: NaN, estimateUsd: 1.5, costSource: 'harness' });
  assert.equal(bad.ok, false);
  assert.equal(bad.checks[0].method, 'estimate');
  assert.deepEqual(reconcileTurn({ memberUsd: null, costSource: 'none' }), { ok: true, checks: [] });
});

test('reconcileEpoch: Σ harness bookings vs what the harness says the epoch cost', () => {
  const e = reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: 2.41, bookedHarnessUsd: 2.41 });
  assert.deepEqual([e.epoch, e.harnessTotalUsd, e.bookedUsd, e.ok], [1, 2.41, 2.41, true]);
  near(e.tolerance, 0.0482);
  assert.equal(reconcileEpoch({ epoch: 2, openingUsd: 1.0, lastCumulativeUsd: 2.0, bookedHarnessUsd: 0.8 }).ok, false, 'a clamped "restored less" shows here');
  assert.equal(reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: NaN, bookedHarnessUsd: NaN }).ok, true);
});

test('conservation property: Σ(member + host) === Σ Δ over 500 seeded turns', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let sumDelta = 0; let sumBooked = 0;
  for (let i = 0; i < 500; i += 1) {
    const d = Math.round(rnd() * 2e6) / 1e6;
    const { carriedUsd, restUsd } = splitCarried({ deltaUsd: d, cutUsd: rnd() < 0.1 ? rnd() : NaN });
    const r = splitTurnCost({ deltaUsd: restUsd, hostUsage: { input_tokens: Math.floor(rnd() * 3e5), output_tokens: 50 }, hostModel: rnd() < 0.2 ? 'mystery' : 'claude-haiku-4-5', engineCost: true });
    sumDelta += d; sumBooked += carriedUsd + r.memberUsd + r.hostOverheadUsd;
    assert.ok(r.memberUsd >= 0 && r.hostOverheadUsd >= 0 && carriedUsd >= 0);
  }
  near(sumBooked, sumDelta);
});

// ── v2: every row, gate, fallback and field of the Interfaces has its own assert (project rule session-groups-correction-tests) ──
import { RECONCILE_ABS_USD, RECONCILE_REL } from '../src/core/session-cost.mjs';

test('v2 — usageTokens reads the API shape and the demux shape ({in,out,cr,cw}); the API key wins; a bad count is 0', async () => {
  await checkRows([
    { name: 'demux shape', run: () => assert.deepEqual(usageTokens({ in: 1, out: 2, cr: 3, cw: 4 }), { in: 1, out: 2, cr: 3, cw: 4 }) },
    { name: 'API key wins', run: () => assert.deepEqual(usageTokens({ input_tokens: 5, in: 1, output_tokens: 6, out: 2, cache_read_input_tokens: 7, cr: 3, cache_creation_input_tokens: 8, cw: 4 }), { in: 5, out: 6, cr: 7, cw: 8 }) },
    { name: 'missing, null and non-numeric are 0', run: () => {
      assert.deepEqual(usageTokens(null), { in: 0, out: 0, cr: 0, cw: 0 });
      assert.deepEqual(usageTokens({ input_tokens: 'x', out: NaN }), { in: 0, out: 0, cr: 0, cw: 0 });
    } },
  ]);
});

test('v2 — priceUsage prices the demux\'s hostUsage, cache reads and writes; no counts at all is NaN, all-zero counts are $0', async () => {
  await checkRows([
    { name: 'facts().hostUsage shape (Task 32)', run: () => near(priceUsage('claude-haiku-4-5', { in: 1000, out: 20, cr: 0, cw: 0 }), 0.0011) },
    { name: 'cache read at 0.1/Mtok', run: () => near(priceUsage('claude-haiku-4-5', { cache_read_input_tokens: 1e6 }), 0.1) },
    { name: 'cache write at 1.25/Mtok', run: () => near(priceUsage('claude-haiku-4-5', { cw: 1e6 }), 1.25) },
    { name: 'all-zero counts are priceable', run: () => assert.equal(priceUsage('claude-haiku-4-5', { in: 0, out: 0, cr: 0, cw: 0 }), 0) },
    { name: 'no counts', run: () => { assert.ok(Number.isNaN(priceUsage('claude-haiku-4-5', {}))); assert.ok(Number.isNaN(priceUsage('claude-haiku-4-5', null))); } },
    { name: 'no model', run: () => assert.ok(Number.isNaN(priceUsage(null, HOST))) },
  ]);
});

test('v2 — the split table: each row\'s gate and its host overhead', async () => {
  const P = { hostUsage: HOST, hostModel: 'claude-haiku-4-5' };
  await checkRows([
    { name: 'a negative host price books 0 overhead', run: () => {
      const r = splitTurnCost({ deltaUsd: 0.5, hostUsage: { in: -1000 }, hostModel: 'claude-haiku-4-5', engineCost: true });
      assert.deepEqual([r.hostOverheadUsd, r.memberUsd], [0, 0.5]);
    } },
    { name: 'harness with the demux\'s hostUsage shape', run: () => {
      const r = splitTurnCost({ deltaUsd: 0.5, hostUsage: { in: 1000, out: 20, cr: 0, cw: 0 }, hostModel: 'claude-haiku-4-5', engineCost: true });
      near(r.hostOverheadUsd, 0.0011); near(r.memberUsd, 0.4989); assert.equal(r.hostPriced, true);
    } },
    { name: 'bridge wins over a finite Δ; its overhead is clamped too', run: () => {
      const r = splitTurnCost({ ...P, deltaUsd: 0.5, bridgeUsd: 0.0005, engineCost: true });
      assert.equal(r.costSource, 'bridge'); near(r.hostOverheadUsd, 0.0005); near(r.memberUsd, 0);
    } },
    { name: 'harness wins over hook and estimate', run: () => {
      const r = splitTurnCost({ ...P, deltaUsd: 0.5, hookUsd: 0.3, memberUsage: HOST, memberModel: 'claude-haiku-4-5', engineCost: true });
      assert.equal(r.costSource, 'harness'); near(r.estimateUsd, 0.0011);
    } },
    { name: 'hook books the priced host on top, and wins over an estimate', run: () => {
      const r = splitTurnCost({ ...P, deltaUsd: NaN, hookUsd: 0.3, memberUsage: HOST, memberModel: 'claude-haiku-4-5', engineCost: true });
      assert.equal(r.costSource, 'hook'); near(r.hostOverheadUsd, 0.0011);
    } },
    { name: 'hook with an unpriced host books 0 overhead', run: () => {
      const r = splitTurnCost({ deltaUsd: NaN, hookUsd: 0.3, hostUsage: HOST, hostModel: 'mystery', engineCost: true });
      assert.deepEqual([r.memberUsd, r.hostOverheadUsd, r.hostPriced], [0.3, 0, false]);
    } },
    { name: 'hook even on an engine without cost', run: () => assert.equal(splitTurnCost({ deltaUsd: NaN, hookUsd: 0.3, engineCost: false }).costSource, 'hook') },
    { name: 'estimate books the priced host and counts the investigators', run: () => {
      const r = splitTurnCost({ ...P, deltaUsd: NaN, memberUsage: HOST, memberModel: 'claude-haiku-4-5', investigators: [{ usage: HOST, resolvedModel: 'claude-haiku-4-5' }] });
      assert.equal(r.costSource, 'estimate'); near(r.memberUsd, 0.0022); near(r.hostOverheadUsd, 0.0011);
    } },
    { name: 'estimate with an unpriced host books 0 overhead', run: () => assert.equal(splitTurnCost({ deltaUsd: NaN, memberUsage: HOST, memberModel: 'claude-haiku-4-5', hostUsage: HOST, hostModel: 'mystery' }).hostOverheadUsd, 0) },
    { name: 'an unknown engineCost is not false', run: () => assert.equal(splitTurnCost({ deltaUsd: NaN, memberUsage: HOST, memberModel: 'claude-haiku-4-5' }).costSource, 'estimate') },
    { name: 'none: nothing priceable; estimateUsd and hostPriced still reported', run: () => {
      const r = splitTurnCost({ ...P, deltaUsd: NaN, memberUsage: {}, memberModel: 'mystery', engineCost: true });
      assert.deepEqual([r.memberUsd, r.hostOverheadUsd, r.costSource, r.hostPriced], [null, null, 'none', true]);
      assert.ok(Number.isNaN(r.estimateUsd));
    } },
  ]);
});

test('v2 — estimateMemberUsd: a priced investigator alone is enough; bad lists and entries are skipped', () => {
  near(estimateMemberUsd({ memberUsage: {}, memberModel: 'mystery', investigators: [null, { usage: HOST, resolvedModel: 'claude-haiku-4-5' }] }), 0.0011);
  near(estimateMemberUsd({ memberUsage: HOST, memberModel: 'claude-haiku-4-5', investigators: 'nope' }), 0.0011);
  near(estimateMemberUsd({ memberUsage: HOST, memberModel: 'claude-haiku-4-5' }), 0.0011);
});

test('v2 — splitCarried clamps both sides; a non-finite Δ or cut carries nothing', () => {
  assert.deepEqual(splitCarried({ deltaUsd: 0.5, cutUsd: -0.2 }), { carriedUsd: 0, restUsd: 0.5 });
  assert.deepEqual(splitCarried({ deltaUsd: -0.1, cutUsd: 0.05 }), { carriedUsd: 0, restUsd: -0.1 });
  assert.deepEqual(splitCarried({ deltaUsd: 0.5, cutUsd: Infinity }), { carriedUsd: 0, restUsd: 0.5 });
  const nan = splitCarried({ deltaUsd: NaN, cutUsd: 0.07 });
  assert.equal(nan.carriedUsd, 0); assert.ok(Number.isNaN(nan.restUsd));
});

test('v2 — reconcileTurn: only harness and bridge are checked; hook before estimate; each tolerance and its boundary', async () => {
  await checkRows([
    { name: 'constants', run: () => assert.deepEqual([RECONCILE_ABS_USD, RECONCILE_REL], [0.001, 0.02]) },
    { name: 'bridge is checked', run: () => assert.equal(reconcileTurn({ memberUsd: 1, hookUsd: 1.5, costSource: 'bridge' }).ok, false) },
    { name: 'hook, estimate and none are never checked', run: () => {
      for (const costSource of ['hook', 'estimate', 'none']) assert.deepEqual(reconcileTurn({ memberUsd: 1, hookUsd: 9, estimateUsd: 9, costSource }), { ok: true, checks: [] });
    } },
    { name: 'both checks, hook first; one failure fails the turn', run: () => {
      const r = reconcileTurn({ memberUsd: 1, hookUsd: 1.01, estimateUsd: 2, costSource: 'harness' });
      assert.deepEqual(r.checks.map((c) => [c.method, c.ok]), [['hook', true], ['estimate', false]]);
      assert.equal(r.ok, false);
      assert.deepEqual([r.checks[1].harnessUsd, r.checks[1].otherUsd], [1, 2]);
      near(r.checks[1].tolerance, 0.15);
    } },
    { name: 'hook floor $0.001, boundary inclusive', run: () => {
      assert.equal(reconcileTurn({ memberUsd: 0, hookUsd: 0.001, costSource: 'harness' }).ok, true);
      assert.equal(reconcileTurn({ memberUsd: 0, hookUsd: 0.0011, costSource: 'harness' }).ok, false);
    } },
    { name: 'estimate floor $0.01, boundary inclusive', run: () => {
      assert.equal(reconcileTurn({ memberUsd: 0, estimateUsd: 0.01, costSource: 'harness' }).ok, true);
      assert.equal(reconcileTurn({ memberUsd: 0, estimateUsd: 0.011, costSource: 'harness' }).ok, false);
    } },
    { name: 'a check is relative to the harness figure', run: () => assert.equal(reconcileTurn({ memberUsd: -1, hookUsd: -1.01, costSource: 'harness' }).checks[0].tolerance, 0.02) },
  ]);
});

test('v2 — reconcileEpoch: the opening baseline, a missing side counts as 0, the $0.001 floor', async () => {
  await checkRows([
    { name: 'a non-finite opening is 0', run: () => assert.equal(reconcileEpoch({ epoch: 1, openingUsd: NaN, lastCumulativeUsd: 1, bookedHarnessUsd: 1 }).harnessTotalUsd, 1) },
    { name: 'booked missing', run: () => {
      const e = reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: 1, bookedHarnessUsd: NaN });
      assert.deepEqual([e.bookedUsd, e.ok], [0, false]);
    } },
    { name: 'harness missing', run: () => {
      const e = reconcileEpoch({ epoch: 3, openingUsd: 0, lastCumulativeUsd: NaN, bookedHarnessUsd: 0.5 });
      assert.deepEqual([e.epoch, e.harnessTotalUsd, e.ok], [3, 0, false]);
    } },
    { name: 'nothing to compare', run: () => assert.deepEqual(reconcileEpoch({ epoch: 1, lastCumulativeUsd: NaN, bookedHarnessUsd: NaN }), { epoch: 1, harnessTotalUsd: null, bookedUsd: null, tolerance: null, ok: true }) },
    { name: 'boundary inclusive', run: () => assert.equal(reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: 0, bookedHarnessUsd: 0.001 }).ok, true) },
    { name: 'floor', run: () => {
      const e = reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: 0.01, bookedHarnessUsd: 0.0105 });
      assert.deepEqual([e.tolerance, e.ok], [0.001, true]);
    } },
  ]);
});

// ── v3: a second sweep, its mutants taken from the Interfaces text ──
test('v3 — hook and estimate rows book the priced host unclamped; cache-creation buckets price as estimateCost does; the epoch tolerance is the harness figure\'s', () => {
  const hook = splitTurnCost({ deltaUsd: NaN, hookUsd: 0.0005, hostUsage: HOST, hostModel: 'claude-haiku-4-5', engineCost: true });
  assert.equal(hook.costSource, 'hook'); near(hook.memberUsd, 0.0005); near(hook.hostOverheadUsd, 0.0011);
  const est = splitTurnCost({ deltaUsd: NaN, memberUsage: { input_tokens: 100 }, memberModel: 'claude-haiku-4-5', hostUsage: HOST, hostModel: 'claude-haiku-4-5' });
  assert.equal(est.costSource, 'estimate'); near(est.memberUsd, 0.0001); near(est.hostOverheadUsd, 0.0011);
  near(priceUsage('claude-haiku-4-5', { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }), 2);
  const e = reconcileEpoch({ epoch: 1, openingUsd: 0, lastCumulativeUsd: 1, bookedHarnessUsd: 1.0201 });
  near(e.tolerance, 0.02); assert.equal(e.ok, false);
  assert.deepEqual(usageTokens({ input: 1, output: 2, cacheRead: 3, cacheCreation: 4 }), { in: 1, out: 2, cr: 3, cw: 4 }, 'Ask\'s normalized shape');
  assert.deepEqual(usageTokens({ in: 5, input: 1, out: 6, output: 2, cr: 7, cacheRead: 3, cw: 8, cacheCreation: 4 }), { in: 5, out: 6, cr: 7, cw: 8 }, 'the demux key wins over Ask\'s');
  near(priceUsage('claude-haiku-4-5', { input: 1000, output: 20 }), 0.0011);
});

// ── v4: a third sweep (refine cycle 3), its mutants taken from Interfaces lines no assert read yet ──
test('v4 — a null API count falls to the demux key; a harness side that is missing is 0, the opening is not subtracted', () => {
  assert.deepEqual(usageTokens({ input_tokens: null, in: 5, output_tokens: null, out: 6, cache_read_input_tokens: null, cr: 7, cache_creation_input_tokens: null, cw: 8 }),
    { in: 5, out: 6, cr: 7, cw: 8 }, 'null is a missing count, so the next key is read');
  const e = reconcileEpoch({ epoch: 2, openingUsd: 1, lastCumulativeUsd: NaN, bookedHarnessUsd: 0.5 });
  assert.deepEqual([e.epoch, e.harnessTotalUsd, e.bookedUsd, e.ok], [2, 0, 0.5, false], 'no cumulative figure: the epoch total is 0, not minus the opening');
  near(e.tolerance, 0.001);
  near(priceUsage('claude-haiku-4-5-20251001', HOST), 0.0011, 'a dated id prices as its base model (liveCostRates)');
  near(priceUsage('claude-haiku-4-5[1m]', HOST), 0.0011, 'so does a [1m] twin');
});

// ── v5: a fourth sweep (refine cycle 4) ──
test('v5 — each demux key prices on its own; an investigator without a model is skipped; the bridge row reports the estimate too', () => {
  near(priceUsage('claude-haiku-4-5', { in: 1e6 }), 1);
  near(priceUsage('claude-haiku-4-5', { out: 1e6 }), 5);
  near(priceUsage('claude-haiku-4-5', { cr: 1e6 }), 0.1);                // a demux cache read is priced, not dropped
  near(estimateMemberUsd({ memberUsage: HOST, memberModel: 'claude-haiku-4-5', investigators: [{ usage: HOST }] }), 0.0011);
  const b = splitTurnCost({ deltaUsd: 0.5, bridgeUsd: 0.3, hostUsage: HOST, hostModel: 'claude-haiku-4-5', memberUsage: HOST, memberModel: 'claude-haiku-4-5' });
  assert.equal(b.costSource, 'bridge');
  near(b.estimateUsd, 0.0011);
});
