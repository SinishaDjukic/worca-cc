// test/model-switch-parked.test.mjs — a paused switch is a store edit with a NEW pause token. The paused
// harness still held in memory (the server's `runs` entry) must keep owning its row: its Away switch persists.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { heldRun } from './helpers/held-run.mjs';
import { readPipelineForResume, claimForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { switchPausedRunModels } from '../src/core/model-switch.mjs';

useTempHome(after);
const OPUS = 'claude-opus-5-5';
const cellOf = (m, id) => m.graph.nodes.find((n) => n.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return pred(); };

test('after a paused switch the parked harness re-adopts its row: its Away switch persists', { timeout: 120000 }, async () => {
  const run = heldRun('msw-parked', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  assert.ok(run.orch.state.resumePoint?.night, 'precondition: the paused point carries the Away state');

  await switchPausedRunModels(id, { changes: { n_impl: { model: OPUS } }, projectDirFor: () => run.orch.projectDir });
  run.orch.setNightOverride('on', 'tester');

  const read = () => readPipelineForResume(id).resumePoint;
  assert.ok(await until(() => read().night?.override === 'on'), 'the Away switch reached the row');
  assert.equal(cellOf(read().manifest, 'n_impl').model, OPUS, 'and the switched manifest survived the write');
  assert.match(read().pausedBy, /^switch:/, 'under the store edit\'s token');
  assert.equal(cellOf(run.orch.state.stepper, 'n_impl').model, OPUS, 'the parked harness shows the new model');
});

test('a stale parked harness does not adopt a row another harness resumed and re-paused', { timeout: 120000 }, async () => {
  const run = heldRun('msw-parked-stale', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  assert.ok(claimForResume(id), 'another process claims the row');
  const rp0 = readPipelineForResume(id).resumePoint;
  getDb().prepare(`UPDATE pipelines SET status='paused', resume_point=? WHERE id=?`)
    .run(JSON.stringify({ ...rp0, pausedBy: 'b-own-token', marker: 'B-progress' }), id);

  await switchPausedRunModels(id, { changes: { n_impl: { model: OPUS } }, projectDirFor: () => run.orch.projectDir });
  run.orch.setNightOverride('on', 'tester');
  await sleep(500);
  const rp = readPipelineForResume(id).resumePoint;
  assert.equal(rp.marker, 'B-progress', 'B\'s row was not overwritten by A');
  assert.notEqual(rp.night?.override, 'on', 'A\'s Away switch did not land on B\'s row');
  assert.equal(run.orch.adoptPausedStoreEdit(), false, 'the explicit path refuses too');
  assert.equal(rp.pausedFrom, 'b-own-token');
});

test('two successive switches keep the lineage: the parked harness still re-adopts', { timeout: 120000 }, async () => {
  const run = heldRun('msw-parked-two', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  const original = readPipelineForResume(id).resumePoint.pausedBy;
  const projectDirFor = () => run.orch.projectDir;
  await switchPausedRunModels(id, { changes: { n_impl: { model: OPUS } }, projectDirFor });
  await switchPausedRunModels(id, { changes: { n_review: { model: OPUS } }, projectDirFor });
  run.orch.setNightOverride('on', 'tester');
  const read = () => readPipelineForResume(id).resumePoint;
  assert.ok(await until(() => read().night?.override === 'on'), 'the Away switch reached the row');
  assert.equal(cellOf(read().manifest, 'n_impl').model, OPUS);
  assert.equal(cellOf(read().manifest, 'n_review').model, OPUS);
  assert.match(read().pausedBy, /^switch:/);
  assert.equal(read().pausedFrom, original);
});

test('a transient failure while re-adopting does not hand the row off for good: the next write lands', { timeout: 120000 }, async () => {
  const run = heldRun('msw-parked-retry', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  await switchPausedRunModels(id, { changes: { n_impl: { model: OPUS } }, projectDirFor: () => run.orch.projectDir });

  // One adoption attempt fails as a busy DB read would; every later one is the real thing.
  const real = run.orch.adoptPausedStoreEdit.bind(run.orch);
  let failOnce = true;
  run.orch.adoptPausedStoreEdit = () => { if (failOnce) { failOnce = false; return false; } return real(); };
  run.orch.setNightOverride('on', 'tester');            // its persist meets the failure
  assert.equal(failOnce, false, 'the failing attempt was consumed');
  assert.equal(await run.orch._persist(), true, 'the next write re-reads the row and adopts');
  const rp = readPipelineForResume(id).resumePoint;
  assert.equal(rp.night?.override, 'on', 'the Away switch reached the row');
  assert.match(rp.pausedBy, /^switch:/);
  assert.equal(cellOf(rp.manifest, 'n_impl').model, OPUS, 'the switched manifest survived');
});
