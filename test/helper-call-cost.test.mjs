// The helper call's cost chain and per-model step estimates (plans/requirements-9c-design.md D9, D14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOfResult, addCost, stepEstimate, ratesFor } from '../src/core/helper-call/cost.mjs';

const RATES = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };

test('costOfResult: a Claude result with a cost is billed', () => {
  const r = costOfResult({ engine: 'claude', model: 'plain-model-x', event: { costUsd: 0.03, usage: { input_tokens: 10, output_tokens: 4 } }, rates: null });
  assert.deepEqual(r, { costUsd: 0.03, costKind: 'billed', inputTokens: 10, outputTokens: 4 });
});

test('costOfResult: an override price wins over the reported cost and stays billed', () => {
  const r = costOfResult({ engine: 'codex', model: 'm', event: { costUsd: 9, usage: { input: 1000000, output: 0 } }, rates: null },
    { resolveModelCost: (model, cost, usage) => { assert.equal(model, 'm'); assert.equal(cost, 9); assert.equal(usage.input, 1000000); return 0.5; } });
  assert.deepEqual(r, { costUsd: 0.5, costKind: 'billed', inputTokens: 1000000, outputTokens: 0 });
});

test('costOfResult: a NaN billed cost is unknown, 0', () => {
  const r = costOfResult({ engine: 'codex', model: 'm', event: { costUsd: 1, usage: null }, rates: null },
    { resolveModelCost: () => NaN });
  assert.deepEqual(r, { costUsd: 0, costKind: 'unknown', inputTokens: null, outputTokens: null });
});

test('costOfResult: no cost but usage and rates is estimated', () => {
  const r = costOfResult({ engine: 'gemini', model: 'g', event: { usage: { input: 1000000, output: 500000 } }, rates: RATES });
  assert.equal(r.costKind, 'estimated');
  assert.ok(Math.abs(r.costUsd - 2) < 1e-9);
  assert.equal(r.inputTokens, 1000000);
  assert.equal(r.outputTokens, 500000);
});

test('costOfResult: no usage is unknown, 0; no rates is unknown, 0', () => {
  assert.deepEqual(costOfResult({ engine: 'gemini', model: 'g', event: {}, rates: RATES }),
    { costUsd: 0, costKind: 'unknown', inputTokens: null, outputTokens: null });
  const r = costOfResult({ engine: 'gemini', model: 'g', event: { usage: { input_tokens: 3, output_tokens: 1 } }, rates: null });
  assert.deepEqual(r, { costUsd: 0, costKind: 'unknown', inputTokens: 3, outputTokens: 1 });
});

test('addCost: billed + estimated = estimated; unknown parts', () => {
  const b = (n) => ({ costUsd: n, costKind: 'billed' });
  const e = (n) => ({ costUsd: n, costKind: 'estimated' });
  const u = { costUsd: 0, costKind: 'unknown' };
  assert.deepEqual(addCost(b(0.1), b(0.2)), { costUsd: 0.30000000000000004, costKind: 'billed' });
  assert.equal(addCost(b(0.1), e(0.2)).costKind, 'estimated');
  assert.equal(addCost(e(0.1), e(0.2)).costKind, 'estimated');
  assert.deepEqual(addCost(u, u), { costUsd: 0, costKind: 'unknown' });
  assert.deepEqual(addCost(b(0.1), u), { costUsd: 0.1, costKind: 'billed', unknownParts: 1 });
  assert.deepEqual(addCost(u, e(0.2)), { costUsd: 0.2, costKind: 'estimated', unknownParts: 1 });
});

const deps = (over = {}) => ({ recentStepCosts: () => [], recentStepTokens: () => [], ratesFor: () => RATES, ...over });

test('stepEstimate: the model\'s own history wins (median, 4 places)', () => {
  const seen = [];
  const r = stepEstimate({ engine: 'claude', model: 'a', step: 'look' }, deps({
    recentStepCosts: (step, o) => { seen.push([step, o.model]); return [0.1, 0.30003, 0.2]; },
    recentStepTokens: () => { throw new Error('not reached'); } }));
  assert.deepEqual(r, { usd: 0.2, kind: 'history' });
  assert.deepEqual(seen, [['look', 'a']]);
  assert.deepEqual(stepEstimate({ engine: 'claude', model: 'a', step: 'brief' }, deps({ recentStepCosts: () => [0.1, 0.2] })), { usd: 0.15, kind: 'history' });
});

test('stepEstimate: another model\'s history is never used', () => {
  const byModel = { a: [5], b: [] };
  const r = stepEstimate({ engine: 'claude', model: 'b', step: 'round' }, deps({ recentStepCosts: (s, o) => byModel[o.model] }));
  assert.equal(r.usd, null);
  assert.equal(r.reason, 'no-estimate');
});

test('stepEstimate: tokens priced for a model without history', () => {
  const r = stepEstimate({ engine: 'gemini', model: 'g', step: 'look' }, deps({
    recentStepTokens: () => [{ input: 1000000, output: 100000 }, { input: 3000000, output: 300000 }, { input: 2000000, output: 200000 }] }));
  assert.equal(r.kind, 'priced');
  assert.ok(Math.abs(r.usd - 2.4) < 1e-9);
});

test('stepEstimate: no-price without rates, no-estimate with nothing, null model = no history', () => {
  assert.deepEqual(stepEstimate({ engine: 'gemini', model: 'g', step: 'look' }, deps({
    recentStepTokens: () => [{ input: 10, output: 1 }], ratesFor: () => null })), { usd: null, reason: 'no-price' });
  assert.deepEqual(stepEstimate({ engine: 'claude', model: 'g', step: 'look' }, deps()), { usd: null, reason: 'no-estimate' });
  const r = stepEstimate({ engine: 'claude', model: null, step: 'look' }, deps({ recentStepCosts: () => { throw new Error('no'); } }));
  assert.deepEqual(r, { usd: null, reason: 'no-estimate' });
});

test('ratesFor: Claude reads the live rates, another engine the chat rates', () => {
  const seen = [];
  assert.equal(ratesFor('claude', 'm', { liveCostRates: (m) => { seen.push(['live', m]); return RATES; } }), RATES);
  assert.equal(ratesFor(undefined, 'm', { liveCostRates: () => RATES }), RATES);
  assert.equal(ratesFor('codex', 'm', { chatDescriptor: (e) => ({ engine: e }), chatModelRates: (d, m) => { seen.push([d.engine, m]); return RATES; } }), RATES);
  assert.deepEqual(seen, [['live', 'm'], ['codex', 'm']]);
});
