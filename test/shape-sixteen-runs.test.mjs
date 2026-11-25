// test/shape-sixteen-runs.test.mjs — Slice 1 (R-arch-5): several live runs of one feature, replayed on the real 16-run
// feature (test/helpers/shape-sixteen-runs.mjs). Each moment asserts the scheduler's own answer (sliceGateState), on
// today's code. Characterization: nothing under src/ or ui/ changes in this run.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { getDb } from '../src/core/db.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { busySliceOf } from '../src/core/shape/features.mjs';
import { sliceChainGate, heldStopTurn } from '../src/core/shape/chain.mjs';
import { SIXTEEN_RUN_LINKS, sixteenRunFeature, startable } from './helpers/shape-sixteen-runs.mjs';

useTempHome(after, 'worca-shape-sixteen-');
const root = mkdtempSync(join(tmpdir(), 'worca-shape-sixteen-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });

/** A fresh feature with `done` runs finished and each `{run: how}` applied. */
const world = (done, states = {}) => {
  getDb().prepare("UPDATE scheduled_runs SET status = 'canceled' WHERE status = 'scheduled'").run();
  const fx = sixteenRunFeature({ projectDir: root });
  for (const r of done) fx.setRun(r, { pipe: 'done' });
  for (const [r, how] of Object.entries(states)) fx.setRun(Number(r), how);
  return fx;
};
const M1 = { 1: { stop: 'requirement' } };
const M3_DONE = [1];
const M3 = { 9: { stop: 'check' }, 11: { stop: 'check' }, 2: { stop: 'requirement' } };
const M4_DONE = [1, 2, 3, 4, 9, 11];

test('the fixture links equal the stored outline of the feature (16 runs)', () => {
  const fx = world([1]);
  const outline = JSON.parse(getDb().prepare('SELECT outline FROM shape_features WHERE id = ?').get(fx.featureId).outline);
  const runOf = new Map(outline.slices.map((s, i) => [s.id, i + 1]));
  assert.equal(SIXTEEN_RUN_LINKS.length, 16);
  assert.deepEqual(outline.slices.map((s) => ({ run: runOf.get(s.id), dependsOn: s.dependsOn.map((d) => runOf.get(d)) })),
    SIXTEEN_RUN_LINKS.map((l) => ({ run: l.run, dependsOn: [...l.dependsOn] })));
  // Only run 12 builds on run 7 (slice 11: run 7's "Needed by" reads 12).
  assert.deepEqual(SIXTEEN_RUN_LINKS.filter((l) => l.dependsOn.includes(7)).map((l) => l.run), [12]);
});

test('M1: run 1 at an open requirement stop frees the turn: only run 9 may start', () => {
  assert.deepEqual(startable(world([], M1)), [9]);
});

test('M2: runs 1 and 9 at open stops: run 11 starts', () => {
  assert.deepEqual(startable(world([], { ...M1, 9: { stop: 'check' } })), [11]);
});

test('M3: run 1 done, runs 9, 11 and 2 at open stops: run 3 starts', () => {
  assert.deepEqual(startable(world(M3_DONE, M3)), [3]);
});

test('M4: run 5 paused frees the turn: run 8 starts (10 and 13 wait behind the lower number)', () => {
  assert.deepEqual(startable(world(M4_DONE, { 5: { pipe: 'paused' } })), [8]);
});

test('M5a (boot race, follow-up run before slice 2): run 8 resuming at boot reads as a paused row with no live entry, so run 10 starts', () => {
  const m4 = world(M4_DONE, { 5: { pipe: 'paused' } });
  const boot = world(M4_DONE, { 5: { pipe: 'paused' }, 8: { pipe: 'paused' } });
  const status = (fx, run) => getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(fx.pipelineOf(run)).status;
  // The gate cannot tell run 8 (boot resume) from run 5 (person pause): the same paused row, live null.
  assert.equal(status(m4, 5), 'paused');
  assert.equal(status(boot, 8), 'paused');
  assert.equal(m4.live(m4.pipelineOf(5)), null);
  assert.equal(boot.live(boot.pipelineOf(8)), null);
  assert.deepEqual(startable(boot), [10]);
});

test('M5b: runs 8 and 10 going while run 5 is paused: nothing starts; a stop answer of run 5 would wait for run 8 (a resume reads no turn)', () => {
  const fx = world(M4_DONE, { 5: { pipe: 'paused' }, 8: { pipe: 'running' }, 10: { pipe: 'running' } });
  assert.deepEqual(startable(fx), []);
  assert.deepEqual(busySliceOf(fx.featureId, { exclude: 5, live: fx.live }), { index: 8 });
  assert.deepEqual(heldStopTurn(fx.featureId, 5, { live: fx.live }), { due: false, after: 8 });
});

test('contrast (D3): M3 with run 2\'s stop held keeps the slot: nothing starts', () => {
  assert.deepEqual(startable(world(M3_DONE, { ...M3, 2: { stop: 'requirement', held: true } })), []);
});

test('contrast (D3): M3 with run 2 asking a non-stop question keeps the slot: nothing starts', () => {
  assert.deepEqual(startable(world(M3_DONE, { ...M3, 2: { asking: true } })), []);
});

test('flag off: sliceChainGate answers null for every not-started run (dev\'s gate decides)', () => withEnvVars({ WORCA_FLAGS: undefined }, () => {
  const fx = world(M3_DONE, M3);
  for (let run = 2; run <= 16; run++) {
    assert.equal(sliceChainGate(getTicket(fx.ticketOf(run)), {}, { flagEnabled: () => false }), null, `run ${run}`);
  }
  // On, the same ticket gets the scheduler's answer.
  assert.equal(sliceChainGate(getTicket(fx.ticketOf(3)), { live: fx.live }, { flagEnabled: () => true }).state, 'ok');
}));
