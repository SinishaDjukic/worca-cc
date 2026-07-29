// test/config-db.test.mjs
// config.mjs persists per-project config in SQLite (project_config +
// config_workflow_nodes + config_workflow_feedbacks), keyed by projectKey. Public
// functions still take a projectDir and keep their exact return shapes. Each test
// uses a throwaway WORCA_HOME (so projectKey + the DB land in temp) and resets
// the DB singleton. The "project dir" is just a temp dir (projectKey hashes it).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readConfig, readRunConfig, listModels, resolveStepModels,
  setStep, addCustomModel, removeCustomModel,
  setNodeModel, setFeedbackCycles, setActiveWorkflow, resolveRunConfig,
} from '../src/core/config.mjs';
import { PREDEFINED_MODELS } from '../src/core/config.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

const homes = [];
const projects = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-cfgdb-home-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-cfgdb-proj-'));
  projects.push(d);
  return d;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...projects].map((d) => rm(d, { recursive: true, force: true })));
});

test('readConfig on a fresh project returns the empty default {steps:{},customModels:[]}', async () => {
  const p = await freshProject();
  assert.deepEqual(await readConfig(p), { steps: {}, customModels: [] });
});

test('readRunConfig on a fresh project returns empty workflows + no active id', async () => {
  const p = await freshProject();
  const rc = await readRunConfig(p);
  assert.deepEqual(rc.workflows, {});
  assert.equal(rc.activeWorkflowId, undefined);
  assert.deepEqual(rc.steps, {});
  assert.deepEqual(rc.customModels, []);
});

test('listModels returns predefined + custom (custom flagged), even on a fresh project', async () => {
  const p = await freshProject();
  const models = await listModels(p);
  assert.equal(models.length, PREDEFINED_MODELS.length, 'all predefined present');
  assert.ok(models.every((m) => m.custom === false), 'all predefined flagged custom:false');
});

test('readRunConfig rebuilds the nested workflows map from normalized rows', async () => {
  const p = await freshProject();
  const key = projectKey(p);
  const db = getDb();
  // Seed normalized rows directly to prove readRunConfig REBUILDS the nested shape.
  db.prepare('INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model, effort, fan_out) VALUES (?, ?, ?, ?, ?, ?)')
    .run(key, 'wf_x', 's0_0', 'claude-opus-4-8', 'high', null);
  db.prepare('INSERT INTO config_workflow_feedbacks (project_key, workflow_id, fb_id, max_cycles) VALUES (?, ?, ?, ?)')
    .run(key, 'wf_x', 'fb_0', 4);
  const rc = await readRunConfig(p);
  assert.deepEqual(rc.workflows.wf_x.nodes.s0_0, { model: 'claude-opus-4-8', effort: 'high' });
  assert.deepEqual(rc.workflows.wf_x.feedbacks.fb_0, { maxCycles: 4 });
});

test('readRunConfig surfaces activeWorkflowId + webUiTesting from project_config (extra)', async () => {
  const p = await freshProject();
  const key = projectKey(p);
  getDb().prepare(
    'INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES (?, ?, ?, ?, ?)'
  ).run(key, '{}', '[]', 'wf_active', JSON.stringify({ webUiTesting: { startCommand: 'npm run dev' } }));
  const rc = await readRunConfig(p);
  assert.equal(rc.activeWorkflowId, 'wf_active');
  assert.equal(rc.webUiTesting.startCommand, 'npm run dev');
});

test('resolveStepModels folds in the global fallback per role', async () => {
  const p = await freshProject();
  const r = await resolveStepModels(p, 'claude-opus-4-8');
  assert.deepEqual(r.planner, { model: 'claude-opus-4-8', effort: undefined });
});

// ── Task 2.5: legacy write path (setStep / addCustomModel / removeCustomModel) ──

test('setStep persists model+effort to project_config.steps (JSON), returns the legacy view', async () => {
  const p = await freshProject();
  const cfg = await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'xhigh' });
  assert.deepEqual(cfg.steps.planner, { model: 'claude-opus-4-8', effort: 'xhigh' });
  assert.deepEqual(cfg.customModels, []);
  // Persisted as JSON in the project_config row.
  const key = projectKey(p);
  const row = getDb().prepare('SELECT steps FROM project_config WHERE project_key = ?').get(key);
  assert.equal(JSON.parse(row.steps).planner.effort, 'xhigh');
});

test('setStep validates step/model/effort (unchanged throws)', async () => {
  const p = await freshProject();
  await assert.rejects(() => setStep(p, 'preflight', { model: 'claude-opus-4-8' }), /unknown step/);
  await assert.rejects(() => setStep(p, 'planner', { model: 'not-a-real-model' }), /unknown model/);
  await assert.rejects(() => setStep(p, 'reviewer', { model: 'claude-haiku-4-5', effort: 'xhigh' }), /does not support/);
});

test('setStep fanOut preserve-on-undefined + explicit override (parity with file version)', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { fanOut: true });
  assert.equal((await readConfig(p)).steps.planner.fanOut, true);
  await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'high' }); // omits fanOut
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'claude-opus-4-8', effort: 'high', fanOut: true });
  await setStep(p, 'planner', { fanOut: false });
  assert.equal((await readConfig(p)).steps.planner.fanOut, false);
});

test('setStep clearing all fields removes the step entry', async () => {
  const p = await freshProject();
  await setStep(p, 'reviewer', { model: 'claude-opus-4-8', effort: 'high' });
  await setStep(p, 'reviewer', { model: '', effort: '' }); // no fanOut stored -> remove
  assert.equal((await readConfig(p)).steps.reviewer, undefined);
});

test('addCustomModel makes a model selectable; rejects empty/dup/shadow', async () => {
  const p = await freshProject();
  await addCustomModel(p, { id: 'my-fork-4-9', label: 'My Fork' });
  assert.ok((await listModels(p)).some((m) => m.id === 'my-fork-4-9' && m.custom));
  await assert.rejects(() => addCustomModel(p, { id: '' }), /required/);
  await assert.rejects(() => addCustomModel(p, { id: 'my-fork-4-9' }), /already exists/);
  await assert.rejects(() => addCustomModel(p, { id: 'claude-opus-4-8' }), /predefined/);
});

test('removeCustomModel clears legacy steps AND normalized node rows referencing it', async () => {
  const p = await freshProject();
  const key = projectKey(p);
  await addCustomModel(p, { id: 'my-fork-4-9' });
  await setStep(p, 'implementer', { model: 'my-fork-4-9', effort: 'max' });   // legacy ref
  await setNodeModel(p, 'wf_x', 's2_0', { model: 'my-fork-4-9', effort: 'high' }); // normalized ref
  // sanity: both refs exist
  assert.equal((await resolveRunConfig(p, 'wf_x')).nodes.s2_0.model, 'my-fork-4-9');

  const cfg = await removeCustomModel(p, 'My-Fork-4-9'); // case-insensitive
  assert.ok(!(await listModels(p)).some((m) => m.id === 'my-fork-4-9'), 'model gone');
  assert.equal(cfg.steps.implementer, undefined, 'dangling legacy step cleared');
  // The normalized node row that pointed at the removed model is gone too.
  const left = getDb().prepare(
    'SELECT COUNT(*) AS n FROM config_workflow_nodes WHERE project_key = ? AND model = ? COLLATE NOCASE'
  ).get(key, 'my-fork-4-9');
  assert.equal(left.n, 0, 'normalized node refs to the removed model are deleted');
});

// ── Task 2.6: run-config write path (setNodeModel / setFeedbackCycles / setActiveWorkflow) ──

test('setNodeModel upserts a normalized config_workflow_nodes row', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_quickfix', 's1_0', { model: 'claude-opus-4-8', effort: 'high' });
  const rc = await readRunConfig(p);
  assert.deepEqual(rc.workflows.wf_quickfix.nodes.s1_0, { model: 'claude-opus-4-8', effort: 'high' });
  // Stored as a real row, not nested JSON.
  const key = projectKey(p);
  const row = getDb().prepare(
    'SELECT model, effort FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
  ).get(key, 'wf_quickfix', 's1_0');
  assert.equal(row.model, 'claude-opus-4-8');
  assert.equal(row.effort, 'high');
});

test('setNodeModel clears the row when model+effort are both blank', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'claude-opus-4-8', effort: 'high' });
  await setNodeModel(p, 'wf_x', 's0_0', { model: '', effort: '' });
  assert.equal((await readRunConfig(p)).workflows.wf_x?.nodes?.s0_0, undefined);
});

test('setNodeModel fanOut: stored, preserved across a model-only change, explicit override', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 's0_0', { fanOut: true });
  assert.equal((await resolveRunConfig(p, 'wf_x')).nodes.s0_0.fanOut, true);
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'claude-opus-4-8', effort: '' }); // omits fanOut
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s0_0, { model: 'claude-opus-4-8', fanOut: true });
  await setNodeModel(p, 'wf_x', 's0_0', { fanOut: false });
  assert.equal((await resolveRunConfig(p, 'wf_x')).nodes.s0_0.fanOut, false);
});

test('setNodeModel with only fanOut=false keeps the row', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 's2_0', { fanOut: false });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s2_0, { fanOut: false });
});

test('setFeedbackCycles upserts maxCycles coerced to an integer >= 1', async () => {
  const p = await freshProject();
  const cyc = async (v) => {
    await setFeedbackCycles(p, 'wf_x', 'fb_0', v);
    return (await readRunConfig(p)).workflows.wf_x.feedbacks.fb_0.maxCycles;
  };
  assert.equal(await cyc(0), 1);
  assert.equal(await cyc(-3), 1);
  assert.equal(await cyc(2.7), 2);
  assert.equal(await cyc(5), 5);
});

test('setActiveWorkflow records the id and PRESERVES legacy steps + extra', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'xhigh' }); // legacy first
  await setActiveWorkflow(p, 'wf_quickfix');
  const rc = await readRunConfig(p);
  assert.equal(rc.activeWorkflowId, 'wf_quickfix');
  assert.deepEqual(rc.steps.planner, { model: 'claude-opus-4-8', effort: 'xhigh' }, 'legacy survived');
});

test('run-config writes do NOT clobber legacy steps/customModels and vice-versa', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { model: 'claude-opus-4-8', effort: 'xhigh' });
  await setNodeModel(p, 'wf_x', 's0_0', { model: 'claude-sonnet-4-6', effort: 'high' });
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'claude-opus-4-8', effort: 'xhigh' });
  const rc = await readRunConfig(p);
  assert.equal(rc.workflows.wf_x.nodes.s0_0.model, 'claude-sonnet-4-6');
  assert.deepEqual(rc.steps.planner, { model: 'claude-opus-4-8', effort: 'xhigh' });
});
