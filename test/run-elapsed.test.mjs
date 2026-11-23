// test/run-elapsed.test.mjs
// The run's headline time: the engine's elapsed clock when the run carries one, the summed
// step time (totalActiveMs) for runs saved before the clock existed. "No figure" must read
// as null, never 0, so the fallback can tell an absent figure from a value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runElapsedMs, runHeadlineMs, showAgentTime } from '../src/shared/run-elapsed.mjs';

const fmt = (ms) => `${Math.round(ms / 1000)}s`;

test('runElapsedMs: null without a figure; folded value when parked; adds the tail only when live', () => {
  assert.equal(runElapsedMs(null), null);
  assert.equal(runElapsedMs({}), null);
  assert.equal(runElapsedMs({ elapsedMs: null, totalActiveMs: 9000 }), null);
  assert.equal(runElapsedMs({ elapsedMs: 0, elapsedSince: null }), null);
  assert.equal(runElapsedMs({ elapsedMs: 5000, elapsedSince: null }, { now: 99_000, live: true }), 5000);
  // A fresh run: 0 folded but the clock runs, so it HAS a figure.
  assert.equal(runElapsedMs({ elapsedMs: 0, elapsedSince: 1000 }), 0);
  assert.equal(runElapsedMs({ elapsedMs: 5000, elapsedSince: 1000 }, { now: 4000, live: true }), 8000);
  assert.equal(runElapsedMs({ elapsedMs: 5000, elapsedSince: 1000 }, { now: 4000 }), 5000);
  // A browser clock behind the server's never subtracts.
  assert.equal(runElapsedMs({ elapsedMs: 5000, elapsedSince: 9000 }, { now: 4000, live: true }), 5000);
});

test('runHeadlineMs: elapsed wins; falls back to totalActiveMs; null when neither', () => {
  assert.equal(runHeadlineMs({ elapsedMs: 5000, totalActiveMs: 9000 }), 5000);
  assert.equal(runHeadlineMs({ elapsedMs: 5000, elapsedSince: 1000, totalActiveMs: 9000 }, { now: 2000, live: true }), 6000);
  assert.equal(runHeadlineMs({ elapsedMs: null, totalActiveMs: 9000 }), 9000);
  assert.equal(runHeadlineMs({ totalActiveMs: 9000 }), 9000);
  assert.equal(runHeadlineMs({ totalActiveMs: 0 }), 0);
  assert.equal(runHeadlineMs({}), null);
  assert.equal(runHeadlineMs(undefined), null);
});

test('showAgentTime: larger and differently formatted only', () => {
  assert.equal(showAgentTime(20_000, 10_000, fmt), true);
  assert.equal(showAgentTime(10_000, 10_000, fmt), false);
  assert.equal(showAgentTime(9000, 10_000, fmt), false);
  assert.equal(showAgentTime(10_200, 10_000, fmt), false);   // larger, but both read "10s"
  assert.equal(showAgentTime(null, 10_000, fmt), false);
  assert.equal(showAgentTime(20_000, null, fmt), false);
});
