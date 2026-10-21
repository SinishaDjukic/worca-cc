// test/model-switch-parked.test.mjs — a paused switch is a store edit with a NEW pause token. The paused
// harness still held in memory (the server's `runs` entry) must keep owning its row: its Away switch persists.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { heldRun } from './helpers/held-run.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { switchPausedRunModels } from '../src/core/model-switch.mjs';

useTempHome(after);
const OPUS = 'claude-opus-5-5';
const cellOf = (m, id) => m.graph.nodes.find((n) => n.id === id);
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
