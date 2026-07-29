// test/fanout.test.mjs
// Unit tests for the bounded-concurrency helper used by the orchestrator's OWN
// per-project IO (worktree setup, graph builds, checkpoints, staging). Pure: no
// git, no WORCA_HOME, no spawn — just determinism, cap, and order guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fanoutCap, mapWithCap } from '../src/core/fanout.mjs';

test('fanoutCap: defaults to 4 when WORCA_FANOUT_CAP is unset', () => {
  const prev = process.env.WORCA_FANOUT_CAP;
  delete process.env.WORCA_FANOUT_CAP;
  try {
    assert.equal(fanoutCap(), 4);
  } finally {
    if (prev === undefined) delete process.env.WORCA_FANOUT_CAP;
    else process.env.WORCA_FANOUT_CAP = prev;
  }
});

test('fanoutCap: reads WORCA_FANOUT_CAP; invalid/zero falls back to 4', () => {
  const prev = process.env.WORCA_FANOUT_CAP;
  try {
    process.env.WORCA_FANOUT_CAP = '7';
    assert.equal(fanoutCap(), 7);
    process.env.WORCA_FANOUT_CAP = '0';
    assert.equal(fanoutCap(), 4, '0 is not a positive cap -> default');
    process.env.WORCA_FANOUT_CAP = 'not-a-number';
    assert.equal(fanoutCap(), 4, 'NaN -> default');
    process.env.WORCA_FANOUT_CAP = '-3';
    assert.equal(fanoutCap(), 4, 'negative -> default');
  } finally {
    if (prev === undefined) delete process.env.WORCA_FANOUT_CAP;
    else process.env.WORCA_FANOUT_CAP = prev;
  }
});

test('mapWithCap: results are in INPUT order regardless of completion order', async () => {
  const items = [50, 10, 30, 0, 20];
  // Each task sleeps for its value ms, so completion order != input order.
  const out = await mapWithCap(items, 2, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 10;
  });
  assert.deepEqual(out, [500, 100, 300, 0, 200], 'output index-aligned with input');
});

test('mapWithCap: passes the input index to fn', async () => {
  const items = ['a', 'b', 'c'];
  const out = await mapWithCap(items, 2, async (it, i) => `${it}${i}`);
  assert.deepEqual(out, ['a0', 'b1', 'c2']);
});

test('mapWithCap: never exceeds the concurrency cap', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  await mapWithCap(items, 3, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n;
  });
  assert.ok(maxInFlight <= 3, `cap 3 must bound concurrency, saw ${maxInFlight}`);
  assert.ok(maxInFlight >= 2, `cap should actually parallelize, saw ${maxInFlight}`);
});

test('mapWithCap: empty input resolves to [] (no fn calls)', async () => {
  let calls = 0;
  const out = await mapWithCap([], 4, async () => { calls += 1; });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test('mapWithCap: cap larger than the item count still completes every item', async () => {
  const items = [1, 2, 3];
  const out = await mapWithCap(items, 99, async (n) => n + 1);
  assert.deepEqual(out, [2, 3, 4]);
});

test('mapWithCap: a rejecting task rejects the whole call', async () => {
  await assert.rejects(
    () => mapWithCap([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});
