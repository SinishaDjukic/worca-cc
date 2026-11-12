// T-e3-model: the E3 step model (plan §4.3) and the measured runs that must follow the real delivery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { predict, runCase, S_B } from '../e3-contract-change.mjs';
import { round } from '../lib/stats.mjs';

const LAG = fileURLToPath(new URL('./fixtures/lagging-hook.mjs', import.meta.url));
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const TABLE = {
  spread: { bus: [2, 5, 8], review: 10, ratio: 0.5, makespanBus: [13, 16, 19], makespanReview: 22 },
  late: { bus: [0, 0, 3], review: 5, ratio: 0.2, makespanBus: [11, 11, 14], makespanReview: 17 },
};
const KS = [2, 5, 8];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('predict reproduces every cell of the §4.3 table', () => {
  for (const [variant, row] of Object.entries(TABLE)) {
    const ratios = [];
    KS.forEach((k, i) => {
      const bus = predict({ S_B: S_B[variant], k, d: 0, arm: 'bus-act' });
      const rev = predict({ S_B: S_B[variant], k, arm: 'review' });
      assert.equal(bus.rework, row.bus[i], `${variant} k=${k} bus`);
      assert.equal(rev.rework, row.review, `${variant} k=${k} review`);
      assert.equal(bus.leadTime, 1);
      assert.equal(rev.leadTime, 10 - k + 1);
      assert.equal(bus.makespan, row.makespanBus[i]);
      assert.equal(rev.makespan, row.makespanReview);
      assert.equal(bus.reviewCycles, 0);
      assert.equal(rev.reviewCycles, 1);
      const ign = predict({ S_B: S_B[variant], k, d: 0, arm: 'bus-ignore' });
      assert.equal(ign.rework, rev.rework);
      ratios.push(bus.rework / rev.rework);
    });
    assert.equal(round(mean(ratios), 2), row.ratio);
  }
});

test('at d = 1 the model gives spread 3/6/9 and late 0/1/4 (mean ratios 0.60 and 0.33)', () => {
  const at = (variant) => KS.map((k) => predict({ S_B: S_B[variant], k, d: 1, arm: 'bus-act' }).rework);
  assert.deepEqual(at('spread'), [3, 6, 9]);
  assert.deepEqual(at('late'), [0, 1, 4]);
  assert.equal(round(mean(at('spread').map((r) => r / 10)), 2), 0.6);
  assert.equal(round(mean(at('late').map((r) => r / 5)), 2), 0.33);
});

test('measured: bus-act delivers at d = 0, review needs one cycle; both end correct', async () => {
  const bus = await runCase({ variant: 'spread', k: 5, topology: 'decompose', arm: 'bus-act' });
  assert.deepEqual([bus.d, bus.rework, bus.correct, bus.reviewCycles], [0, 5, true, 0]);
  assert.equal(bus.leadTime, 1);
  const rev = await runCase({ variant: 'spread', k: 5, topology: 'decompose', arm: 'review' });
  assert.deepEqual([rev.rework, rev.reviewCycles, rev.correct], [10, 1, true]);
});

test('measured: a hook that lags one call makes d = 1 and rework 6', async () => {
  const d = mkdtempSync(join(tmpdir(), 'bus-e3lag-'));
  dirs.push(d);
  process.env.LAG_STATE = join(d, 'lag.state');
  try {
    const r = await runCase({ variant: 'spread', k: 5, topology: 'decompose', arm: 'bus-act', hookCmd: [process.execPath, LAG] });
    assert.deepEqual([r.d, r.rework, r.correct], [1, 6, true]);
  } finally {
    delete process.env.LAG_STATE;
  }
});

test('measured: sub-agents B, C and the late joiner D each see the change once, A never', async () => {
  const r = await runCase({ variant: 'spread', k: 5, topology: 'subagents', arm: 'bus-act' });
  assert.deepEqual(r.deliveries, { A: 0, B: 1, C: 1, D: 1 });
  assert.equal(r.lateJoinerFirstCall, true);
  assert.ok(r.lateJoinerFirstCallTokens > 0);
  assert.equal(r.cursorsUnmovedByA, true);
  assert.deepEqual([r.d, r.rework, r.correct], [0, 5, true]);
});

test('detector trigger: a spread k=5 decompose bus-act case equals its scripted twin, 0 false publishes', async () => {
  const base = { variant: 'spread', k: 5, topology: 'decompose', arm: 'bus-act' };
  const scripted = await runCase(base);
  const det = await runCase({ ...base, trigger: 'detector' });
  for (const key of ['rework', 'leadTime', 'makespan', 'correct', 'd', 'reviewCycles']) assert.equal(det[key], scripted[key], key);
  assert.equal(det.falsePublishes, 0);
  assert.equal(det.autoPublishes, 1);
  assert.equal(det.selfShows, 0);
  assert.equal(scripted.trigger, undefined, 'the scripted output is unchanged');
});
