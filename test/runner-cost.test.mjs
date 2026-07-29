// test/runner-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractResultCost, runClaude } from '../src/core/claude-runner.mjs';

test('extractResultCost reads total_cost_usd from a result event', () => {
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: 0.1234 }), 0.1234);
});

test('extractResultCost accepts the legacy cost_usd spelling', () => {
  assert.equal(extractResultCost({ type: 'result', cost_usd: 0.5 }), 0.5);
});

test('extractResultCost reads a truthful zero (does not treat 0 as absent)', () => {
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: 0 }), 0);
});

test('extractResultCost returns null for non-result / costless events', () => {
  assert.equal(extractResultCost({ type: 'assistant', message: {} }), null);
  assert.equal(extractResultCost({ type: 'result' }), null); // no cost field present
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: 'NaN' }), null);
  assert.equal(extractResultCost(null), null);
});

test('extractResultCost rejects a negative cost (treats it as no cost)', () => {
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: -5 }), null);
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: 0 }), 0, 'genuine zero still kept');
  assert.equal(extractResultCost({ type: 'result', total_cost_usd: 0.07 }), 0.07);
});

test('mock runClaude emits a single zero-cost result event', async () => {
  const events = [];
  // clarify with no MOCK_OUT performs no file writes (mockClarify
  // returns at the `if (!out)` guard before any writeFile / tool_use emit, and
  // emits no `type:'result'` event of its own), so this is a side-effect-free way
  // to exercise the single synthesized mock result emission.
  await runClaude({ mock: true, prompt: 'MOCK_ROLE: clarify', onEvent: (e) => events.push(e) });
  const results = events.filter((e) => e.type === 'result');
  assert.equal(results.length, 1, 'exactly one result event in mock mode');
  assert.equal(results[0].costUsd, 0, 'mock cost is a truthful zero');
});
