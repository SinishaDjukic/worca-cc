// test/config.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readConfig, setStep, resolveStepModels } from '../src/core/config.mjs';
import { AGENT_STEPS } from '../src/core/config.mjs';
import { loadAgentRegistry, registryToSteps } from '../src/core/agent-registry.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';

// node:sqlite migration: config now lives in the DB. Each test isolates the DB
// under a throwaway WORCA_HOME and resets the singleton so the next getDb()
// reopens against it (mirrors config-db.test.mjs).
const homes = [];
const dirs = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cfg-home-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  dirs.push(d);
  return d;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...dirs].map((d) => rm(d, { recursive: true, force: true })));
});

test('resolveStepModels falls back to the global model when a role is unset', async () => {
  const p = await freshProject();
  await setStep(p, 'refiner', { model: 'claude-sonnet-4-6', effort: 'high' });
  const r = await resolveStepModels(p, 'claude-opus-4-8');
  assert.deepEqual(r.refiner, { model: 'claude-sonnet-4-6', effort: 'high' });
  assert.deepEqual(r.planner, { model: 'claude-opus-4-8', effort: undefined });
});

test('resolveStepModels with no global model fills an empty role with Worca\'s default (#1450)', async () => {
  const p = await freshProject();
  const r = await resolveStepModels(p, undefined);
  assert.deepEqual(r.implementer, { model: 'claude-sonnet-5-5', effort: undefined });
});

test('fanOut defaults ON in the registry, registryToSteps and AGENT_STEPS', async () => {
  await checkRows([
    { name: 'registry surfaces fanOut: every agent role defaults ON, decomposer included', run: async () => {
      const reg = loadAgentRegistry();
      assert.equal(reg.planner.fanOut, true, 'planner defaults to fan-out ON');
      assert.equal(reg.refiner.fanOut, true);
      assert.equal(reg.implementer.fanOut, true);
      assert.equal(reg.reviewer.fanOut, true);
      assert.equal(reg.decomposer.fanOut, true, 'the splitter fans out too');
    } },
    { name: 'registryToSteps / AGENT_STEPS carry the per-agent fanOut default', run: async () => {
      const steps = registryToSteps(loadAgentRegistry());
      const planner = steps.find((s) => s.key === 'planner');
      const refiner = steps.find((s) => s.key === 'refiner');
      assert.equal(planner.fanOut, true);
      assert.equal(refiner.fanOut, true);
      // AGENT_STEPS (config.mjs) is derived from registryToSteps, so it carries it too.
      assert.equal(AGENT_STEPS.find((s) => s.key === 'planner').fanOut, true);
    } },
  ]);
});

test('setStep with only fanOut=false on an otherwise-empty step still persists', async () => {
  const p = await freshProject();
  await setStep(p, 'reviewer', { fanOut: false });
  assert.deepEqual((await readConfig(p)).steps.reviewer, { fanOut: false });
});

// An explicit null is the third state the New-Pipeline accordion needs: not
// "leave it alone" (undefined) and not "store false" (boolean), but "drop the
// override so this row inherits its default again" (newpipeline-ux-design.md §4.5).
test('setStep: null CLEARS a toggle, undefined preserves it, false stores false', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { fanOut: true, askQuestions: true });
  assert.deepEqual((await readConfig(p)).steps.planner, { fanOut: true, askQuestions: true });

  await setStep(p, 'planner', { fanOut: null });
  assert.deepEqual((await readConfig(p)).steps.planner, { askQuestions: true }, 'fanOut cleared, sibling kept');

  await setStep(p, 'planner', { askQuestions: false });
  assert.deepEqual((await readConfig(p)).steps.planner, { askQuestions: false }, 'false is a stored value, not a clear');

  // Clearing the last thing on a step removes the step entry entirely.
  await setStep(p, 'planner', { askQuestions: null });
  assert.equal((await readConfig(p)).steps.planner, undefined);
});

test('setNodeModel: null clears a toggle and an emptied node drops its row', async () => {
  const { setNodeModel, readRunConfig } = await import('../src/core/config.mjs');
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 'n0', { model: 'claude-opus-4-8', fanOut: true });
  assert.deepEqual((await readRunConfig(p)).workflows.wf_x.nodes.n0, { model: 'claude-opus-4-8', fanOut: true });

  await setNodeModel(p, 'wf_x', 'n0', { model: 'claude-opus-4-8', fanOut: null });
  assert.deepEqual((await readRunConfig(p)).workflows.wf_x.nodes.n0, { model: 'claude-opus-4-8' });

  await setNodeModel(p, 'wf_x', 'n0', { model: '', effort: '', fanOut: null, askQuestions: null });
  assert.equal((await readRunConfig(p)).workflows.wf_x, undefined, 'an empty node leaves nothing behind');
});
