// test/discover-gate.test.mjs — the server-side bound on page-open discovery: one run at a time, page opens reuse a recent result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoverGate } from '../ui/routes/worca-levels/discover-gate.mjs';

test('concurrent callers share one run; page opens inside the interval reuse it; "Check now" always runs', async () => {
  let runs = 0;
  let t = 1000;
  let release;
  const gate = createDiscoverGate(() => { runs += 1; return new Promise((r) => { release = r; }); }, { minMs: 60_000, now: () => t });
  const a = gate({ page: true });
  const b = gate({ page: false });
  assert.equal(a, b, 'the second caller waits for the run already going');
  release();
  await Promise.all([a, b]);
  assert.equal(runs, 1);
  t += 1000;
  await gate({ page: true });
  assert.equal(runs, 1, 'a page open inside the interval reuses the last result');
  const forced = gate({ page: false });
  release();
  await forced;
  assert.equal(runs, 2, '"Check now" is never skipped');
  t += 61_000;
  const again = gate({ page: true });
  release();
  await again;
  assert.equal(runs, 3, 'after the interval a page open runs again');
});

test('a failed run is not remembered as a success and clears the in-flight slot', async () => {
  let runs = 0;
  const gate = createDiscoverGate(() => { runs += 1; return runs === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(); }, { now: () => 5 });
  await assert.rejects(gate({ page: true }));
  await gate({ page: true });
  assert.equal(runs, 2);
});
