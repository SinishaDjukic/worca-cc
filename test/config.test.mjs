// test/config.test.mjs
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readConfig, setStep, addCustomModel, removeCustomModel,
  listModels, resolveStepModels,
} from '../src/core/config.mjs';
import { AGENT_STEPS } from '../src/core/config.mjs';
import { loadAgentRegistry, registryToSteps } from '../src/core/agent-registry.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

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

test('missing config yields the empty default', async () => {
  const p = await freshProject();
  assert.deepEqual(await readConfig(p), { steps: {}, customModels: [] });
});

test('setStep persists model + effort to the project_config row (SQLite)', async () => {
  const p = await freshProject();
  const cfg = await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'xhigh' });
  assert.deepEqual(cfg.steps.planner, { model: 'claude-opus-4-8', effort: 'xhigh' });
  const key = projectKey(p);
  const row = getDb().prepare('SELECT steps FROM project_config WHERE project_key = ?').get(key);
  assert.equal(JSON.parse(row.steps).planner.effort, 'xhigh');
});

test('rejects an effort the model does not support', async () => {
  const p = await freshProject();
  await assert.rejects(
    () => setStep(p, 'reviewer', { model: 'claude-haiku-4-5', effort: 'xhigh' }),
    /does not support/,
  );
});

test('rejects an unknown step key', async () => {
  const p = await freshProject();
  await assert.rejects(() => setStep(p, 'preflight', { model: 'claude-opus-4-8' }), /unknown step/);
});

test('rejects an unknown model', async () => {
  const p = await freshProject();
  await assert.rejects(() => setStep(p, 'planner', { model: 'not-a-real-model' }), /unknown model/);
});

test('custom model becomes selectable, then removable (and clears referencing steps)', async () => {
  const p = await freshProject();
  await addCustomModel(p, { id: 'my-fork-4-9', label: 'My Fork' });
  let models = await listModels(p);
  assert.ok(models.some((m) => m.id === 'my-fork-4-9' && m.custom));

  await setStep(p, 'implementer', { model: 'my-fork-4-9', effort: 'max' });
  const cfg = await removeCustomModel(p, 'my-fork-4-9');
  models = await listModels(p);
  assert.ok(!models.some((m) => m.id === 'my-fork-4-9'));
  assert.equal(cfg.steps.implementer, undefined); // dangling reference removed
});

test('resolveStepModels falls back to the global model when a role is unset', async () => {
  const p = await freshProject();
  await setStep(p, 'refiner', { model: 'claude-sonnet-4-6', effort: 'high' });
  const r = await resolveStepModels(p, 'claude-opus-4-8');
  assert.deepEqual(r.refiner, { model: 'claude-sonnet-4-6', effort: 'high' });
  assert.deepEqual(r.planner, { model: 'claude-opus-4-8', effort: undefined });
});

test('resolveStepModels with no global model leaves model undefined (today\'s behavior)', async () => {
  const p = await freshProject();
  const r = await resolveStepModels(p, undefined);
  assert.deepEqual(r.implementer, { model: undefined, effort: undefined });
});

test('registry surfaces fanOut: every agent role defaults ON, decomposer included', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.planner.fanOut, true, 'planner defaults to fan-out ON');
  assert.equal(reg.refiner.fanOut, true);
  assert.equal(reg.implementer.fanOut, true);
  assert.equal(reg.reviewer.fanOut, true);
  assert.equal(reg.decomposer.fanOut, true, 'the splitter fans out too');
});

test('registryToSteps / AGENT_STEPS carry the per-agent fanOut default', () => {
  const steps = registryToSteps(loadAgentRegistry());
  const planner = steps.find((s) => s.key === 'planner');
  const refiner = steps.find((s) => s.key === 'refiner');
  assert.equal(planner.fanOut, true);
  assert.equal(refiner.fanOut, true);
  // AGENT_STEPS (config.mjs) is derived from registryToSteps, so it carries it too.
  assert.equal(AGENT_STEPS.find((s) => s.key === 'planner').fanOut, true);
});

test('setStep stores fanOut and preserves it when a later model change omits it', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { fanOut: true });
  assert.equal((await readConfig(p)).steps.planner.fanOut, true);
  // A model change that omits fanOut must NOT wipe it (preserve-on-undefined).
  await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'high' });
  const s = (await readConfig(p)).steps.planner;
  assert.deepEqual(s, { model: 'claude-opus-4-8', effort: 'high', fanOut: true });
  // Explicit false overrides the stored true.
  await setStep(p, 'planner', { fanOut: false });
  assert.equal((await readConfig(p)).steps.planner.fanOut, false);
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

test('resetWorkflowConfig drops one workflow\'s overrides, and wf_default\'s legacy steps too', async () => {
  const { setNodeModel, setFeedbackCycles, resetWorkflowConfig, readRunConfig } = await import('../src/core/config.mjs');
  const p = await freshProject();
  await setStep(p, 'planner', { model: 'claude-opus-4-8' });
  await setNodeModel(p, 'wf_default', 's0_0', { fanOut: true });
  await setNodeModel(p, 'wf_other', 'n0', { fanOut: true });
  await setFeedbackCycles(p, 'wf_default', 'fb_review', 9);

  await resetWorkflowConfig(p, 'wf_default');
  const cfg = await readRunConfig(p);
  assert.deepEqual(cfg.steps, {}, 'the legacy blob is where wf_default overrides live — it must go too');
  assert.equal(cfg.workflows.wf_default, undefined);
  assert.deepEqual(cfg.workflows.wf_other.nodes.n0, { fanOut: true }, 'other workflows untouched');
});
