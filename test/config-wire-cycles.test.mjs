import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  setWireCycles, setFeedbackCycles, setNodeModel, readRunConfig, resolveRunConfig, resetWorkflowConfig,
} from '../src/core/config.mjs';

useTempHome(after);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-cfg-'));

test('setWireCycles round-trips and coerces to >= 1', async () => {
  await setWireCycles(projectDir, 'wf_g', 'w5', 4);
  await setWireCycles(projectDir, 'wf_g', 'w9', 0);
  await setWireCycles(projectDir, 'wf_g', 'w12', '3.7');
  const { wires } = await resolveRunConfig(projectDir, 'wf_g');
  assert.deepEqual(wires, { w5: { maxCycles: 4 }, w9: { maxCycles: 1 }, w12: { maxCycles: 3 } });
  await setWireCycles(projectDir, 'wf_g', 'w5', 6);
  assert.equal((await resolveRunConfig(projectDir, 'wf_g')).wires.w5.maxCycles, 6, 'upsert, not duplicate');
});

test('GET /api/config shape: nodes + feedbacks (v1) + wires (v2) coexist', async () => {
  // `setNodeModel` VALIDATES against listModels() (`config.mjs:617-629`; its
  // per-role twin `setStep` is `:400-414`) and
  // EFFORTS = ['medium','high','xhigh','max'] — an invented short id throws
  // `unknown model "…"`. Use catalog ids everywhere a SETTER runs.
  await setNodeModel(projectDir, 'wf_g', 'n_plan', { model: 'claude-sonnet-5' });
  await setFeedbackCycles(projectDir, 'wf_v1', 'fb_0', 2);
  const cfg = await readRunConfig(projectDir);
  assert.deepEqual(cfg.workflows.wf_g.nodes.n_plan, { model: 'claude-sonnet-5' });
  assert.deepEqual(cfg.workflows.wf_g.wires.w5, { maxCycles: 6 });
  assert.deepEqual(cfg.workflows.wf_g.feedbacks, {});
  assert.deepEqual(cfg.workflows.wf_v1.feedbacks.fb_0, { maxCycles: 2 });
  assert.deepEqual(cfg.workflows.wf_v1.wires, {});
});

test('resetWorkflowConfig clears nodes AND wires for that workflow only', async () => {
  await setWireCycles(projectDir, 'wf_other', 'w1', 5);
  await resetWorkflowConfig(projectDir, 'wf_g');
  const cfg = await readRunConfig(projectDir);
  assert.equal(cfg.workflows.wf_g, undefined);
  assert.deepEqual(cfg.workflows.wf_other.wires.w1, { maxCycles: 5 });
});

test('an unconfigured workflow resolves to empty maps', async () => {
  assert.deepEqual(await resolveRunConfig(projectDir, 'wf_nothing'), { nodes: {}, wires: {}, feedbacks: {} });
});

// MAJ-1: readWorkflowsMap's `ensure` allocated on a PLAIN object, so a stored
// workflow_id of '__proto__' resolved truthy to Object.prototype and the very
// next `.wires[id] =` threw — permanently, on every readRunConfig for that
// project, against a docstring that says "never throws".
test('a stored workflow id of __proto__ degrades instead of throwing forever', async () => {
  const poisoned = mkdtempSync(join(tmpdir(), 'worca-cc-cfg-proto-'));
  await setWireCycles(poisoned, '__proto__', 'w1', 3);
  const cfg = await readRunConfig(poisoned);                        // must NOT throw
  assert.ok(Object.prototype.hasOwnProperty.call(cfg.workflows, '__proto__'),
    'the poisoned row is reported under a plain OWN key');
  assert.equal(cfg.workflows['__proto__'].wires.w1.maxCycles, 3);
  assert.equal(Object.getPrototypeOf(cfg.workflows), Object.prototype,
    'the map handed to callers keeps the ordinary object shape');
  assert.equal({}.wires, undefined, 'Object.prototype itself is untouched');
  assert.equal(JSON.parse(JSON.stringify(cfg)).workflows['__proto__'].wires.w1.maxCycles, 3,
    'and it survives the JSON round trip to the client');
  assert.deepEqual(await resolveRunConfig(poisoned, '__proto__'),
    { nodes: {}, wires: { w1: { maxCycles: 3 } }, feedbacks: {} });
  // recovery stays possible on a legacy poisoned row (resetWorkflowConfig is keyed by column, not object key)
  await resetWorkflowConfig(poisoned, '__proto__');
  assert.deepEqual((await readRunConfig(poisoned)).workflows, {}, 'DELETE /api/config/workflow can still clear it');
});
