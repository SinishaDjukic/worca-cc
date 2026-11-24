// test/legacy-steps-engines.test.mjs — the legacy per-role steps (project_config.steps, the built-in Default
// workflow's storage, written by the New-Pipeline Advanced → Agents rows and the CLI's setStep) apply on ANY run
// engine, not just Claude Code. `owned`/`modelForEngine` keep a pick only when the run's engine can run it, so a
// stale Claude Code pick on an opencode run (or vice versa) is dropped exactly like a node pick — never silently
// misapplied and never ignored. Before the fix these rows were claude-only: the run window saved them on any engine,
// but an opencode run discarded every one of them and fell back to the run model.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

// Settings.json lives under HOME and listGlobalModels() is empty under the test runner unless HOME is sandboxed and
// WORCA_TEST_ALLOW_HOME_FALLBACK says so — required to seed an opencode global model the catalog will hold.
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-legacy-steps-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevEnv.HOME], ['USERPROFILE', prevEnv.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevEnv.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const { writeFileSync } = await import('node:fs');

const { GRAPH_DEFAULT_WORKFLOW, resolveGraph } = await import('../src/core/workflows.mjs');
const { setStep, resolveStepModels } = await import('../src/core/config.mjs');
const { addGlobalModel } = await import('../src/core/settings.mjs');

const PROJECT = mkdtempSync(join(tmpdir(), 'worca-legacy-steps-proj-'));

const PORTS = {
  metaVersion: 2,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
};
const REGISTRY = Object.fromEntries(
  ['clarify', 'planner', 'refiner', 'implementer', 'reviewer'].map((k) => [k, { key: k, ...PORTS }]),
);

beforeEach(() => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
});
afterEach(() => { /* settings persist between tests on purpose: re-seed below */ });

test('a per-role opencode step pick is honored on an opencode run of the Default workflow', async () => {
  await addGlobalModel({ id: 'opencode/big-pickle', engine: 'opencode', efforts: [] });
  await setStep(PROJECT, 'planner', { model: 'opencode/big-pickle' });

  const nodes = (await resolveGraph(PROJECT, GRAPH_DEFAULT_WORKFLOW.id, REGISTRY, '/nonexistent-agents-dir', { engine: 'opencode' })).nodes;
  assert.equal(nodes.n_plan.model, 'opencode/big-pickle', 'the legacy per-role pick rides the opencode run');

  const steps = await resolveStepModels(PROJECT, undefined, 'opencode');
  assert.equal(steps.planner.model, 'opencode/big-pickle', 'resolveStepModels reports the same pick for the engine');
});

test('a per-role pick the run engine cannot run is dropped, never misapplied', async () => {
  // planner -> opencode-only; implementer -> a Claude Code built-in that opencode cannot run.
  await setStep(PROJECT, 'planner', { model: 'opencode/big-pickle' });
  await setStep(PROJECT, 'implementer', { model: 'claude-haiku-4-5' });

  const opencode = (await resolveGraph(PROJECT, GRAPH_DEFAULT_WORKFLOW.id, REGISTRY, '/nonexistent-agents-dir', { engine: 'opencode' })).nodes;
  assert.equal(opencode.n_plan.model, 'opencode/big-pickle');
  assert.equal(opencode.n_impl.model, undefined, 'a Claude-only pick is dropped on opencode, falling to the run layer');

  const claude = (await resolveGraph(PROJECT, GRAPH_DEFAULT_WORKFLOW.id, REGISTRY, '/nonexistent-agents-dir')).nodes;
  assert.notEqual(claude.n_plan.model, 'opencode/big-pickle', 'an opencode-only pick is dropped on Claude Code');
  assert.deepEqual([claude.n_plan.model, claude.n_plan.modelSource], ['claude-opus-5-5', 'worca-default'], 'the emptied role then takes Worca\'s default (#1450), never the foreign pick');
  assert.equal(claude.n_impl.model, 'claude-haiku-4-5');

  const steps = await resolveStepModels(PROJECT, undefined, 'opencode');
  assert.equal(steps.planner.model, 'opencode/big-pickle');
  assert.equal(steps.implementer.model, undefined, 'resolveStepModels drops the foreign pick too');
});
