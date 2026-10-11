// test/step-model-slots.test.mjs — the node model chain per engine (plans/cascading-settings-design.md §4.2, §8 test 4):
// an engine-owned node pick > the engine's step slot (project > user > team) > the template; a pick of the other
// engine is skipped whole; resolveStepModels reads the same slots.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { setNodeModel, setStep, stepSlotDefaults, resolveStepModels, slotSourceLines } from '../src/core/config.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { writeGraphWorkflow, resolveGraph } from '../src/core/workflows.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-slots-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
const projectDir = mkdtempSync(join(tmpdir(), 'worca-slots-proj-'));
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true }); rmSync(projectDir, { recursive: true, force: true });
});
const writeUser = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify(obj)); };
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null });
const GRAPH = (id) => ({
  id, name: 'Slots', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'tpl-model', effort: 'high' } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w5', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
    { id: 'w6', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
});
const pair = (nc) => ({ model: nc.model, effort: nc.effort });

beforeEach(() => {
  writeUser({});
  getDb();
  prepare('DELETE FROM project_config WHERE project_key = ?').run(projectKey(projectDir));
  prepare('DELETE FROM config_workflow_nodes WHERE project_key = ?').run(projectKey(projectDir));
});

test('a Codex run skips a Claude node pick and uses the Codex slot (Review Focus 3)', async () => {
  writeUser({ stepModels: { codex: { planner: { model: 'gpt-5.5', effort: 'low' } } } });
  await writeGraphWorkflow(GRAPH('wf_slot1'));
  await setNodeModel(projectDir, 'wf_slot1', 'n_plan', { model: 'claude-opus-5-5', effort: 'max' });
  const codex = await resolveGraph(projectDir, 'wf_slot1', REG(), undefined, { engine: 'codex' });
  assert.deepEqual(pair(codex.nodes.n_plan), { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(pair(codex.nodes.n_rev), { model: undefined, effort: undefined }, 'no slot, no node pick: Codex\'s own default');
  const claude = await resolveGraph(projectDir, 'wf_slot1', REG());
  assert.deepEqual(pair(claude.nodes.n_plan), { model: 'claude-opus-5-5', effort: 'max' }, 'on Claude the project\'s node pick wins');
});

test('Claude: the project\'s pick > your slot > the team default > the template', async () => {
  writeUser({ stepModels: { claude: { reviewer: { model: 'claude-sonnet-5', effort: 'high' }, planner: { model: 'claude-haiku-4-5' } } } });
  await writeGraphWorkflow(GRAPH('wf_slot2'));
  const g = await resolveGraph(projectDir, 'wf_slot2', REG());
  assert.deepEqual(pair(g.nodes.n_rev), { model: 'claude-sonnet-5', effort: 'high' });
  assert.deepEqual(pair(g.nodes.n_plan), { model: 'claude-haiku-4-5', effort: undefined }, 'the template effort belonged to the template model');
  await setStep(projectDir, 'reviewer', { model: 'claude-opus-5-5' });
  const def = await resolveGraph(projectDir, 'wf_default', REG());
  const rev = Object.values(def.nodes).find((n) => n.key === 'reviewer');
  assert.deepEqual(pair(rev), { model: 'claude-opus-5-5', effort: undefined }, 'the Default workflow\'s per-role column is the project layer');
});

test('Codex: the project slot beats yours; a workspace run skips it; nothing changes with no slot set', async () => {
  writeUser({ stepModels: { codex: { planner: { model: 'gpt-5.5' } } } });
  writeProjectSettings({ projectDir }, { 'models.codex.steps.planner': { model: 'gpt-5.6-sol', effort: 'high' } });
  assert.deepEqual(stepSlotDefaults('codex', { projectDir }).planner, { model: 'gpt-5.6-sol', effort: 'high', source: 'project' });
  assert.deepEqual(stepSlotDefaults('codex', { projectDir, workspace: true }).planner, { model: 'gpt-5.5', source: 'user' });
  await writeGraphWorkflow(GRAPH('wf_slot3'));
  assert.equal((await resolveGraph(projectDir, 'wf_slot3', REG(), undefined, { engine: 'codex' })).nodes.n_plan.model, 'gpt-5.6-sol');
  const steps = await resolveStepModels(projectDir, 'claude-opus-5', 'codex');
  assert.deepEqual(steps.planner, { model: 'gpt-5.6-sol', effort: 'high' });
  assert.deepEqual(steps.reviewer, { model: undefined, effort: undefined }, 'a Claude --model is not a Codex fallback');
  writeUser({});
  writeProjectSettings({ projectDir }, { 'models.codex.steps.planner': null });
  assert.deepEqual(stepSlotDefaults('claude', { projectDir }), {}, 'no slot set: Claude resolves exactly as before');
  const claudeSteps = await resolveStepModels(projectDir, 'claude-opus-5');
  assert.deepEqual(claudeSteps.planner, { model: 'claude-opus-5', effort: undefined });
});

test('§7: a run names each node model that came from a slot, and where the slot was set', () => {
  const nodes = {
    n_plan: { kind: 'agent', key: 'planner', authoredKey: 'planner', model: 'gpt-5.5' },
    n_rev: { kind: 'agent', key: 'reviewer', authoredKey: 'reviewer', model: 'gpt-5.6-sol' },
    n_end: { kind: 'end' },
  };
  const slots = { planner: { model: 'gpt-5.5', source: 'project' }, reviewer: { model: 'gpt-5.5', source: 'user' } };
  assert.deepEqual(slotSourceLines('codex', nodes, slots), ['codex model "gpt-5.5" for planner from project settings (models.codex.steps.planner)']);
  assert.deepEqual(slotSourceLines('claude', nodes, { planner: { model: 'gpt-5.5', source: 'team' } }), ['claude model "gpt-5.5" for planner from the team policy (models.claude.steps.planner)']);
});
