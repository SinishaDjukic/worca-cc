// test/config-questions.test.mjs
// askQuestions per-role (legacy steps JSON) + per-node (config_workflow_nodes).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readConfig, setStep, setNodeModel, resolveRunConfig } from '../src/core/config.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const homes = [];
const projects = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-qcfg-home-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-qcfg-proj-'));
  projects.push(d);
  return d;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...projects].map((d) => rm(d, { recursive: true, force: true })));
});

test('setStep persists askQuestions and preserves it when omitted', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { askQuestions: true });
  assert.deepEqual((await readConfig(p)).steps.planner, { askQuestions: true });
  // A later model-only save must NOT wipe the boolean (fanOut parity).
  await setStep(p, 'planner', { model: 'claude-opus-4-8' });
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'claude-opus-4-8', askQuestions: true });
  // Explicit false round-trips.
  await setStep(p, 'planner', { model: 'claude-opus-4-8', askQuestions: false });
  assert.equal((await readConfig(p)).steps.planner.askQuestions, false);
});

test('sanitizeSteps keeps an askQuestions-only entry (read back after write)', async () => {
  const p = await freshProject();
  await setStep(p, 'implementer', { askQuestions: true });
  const cfg = await readConfig(p);
  assert.deepEqual(cfg.steps.implementer, { askQuestions: true });
});

test('schema v11: ask_questions column + step_questions table exist', async () => {
  await setStep(await freshProject(), 'planner', {}); // any call that opens the DB
  const db = getDb();
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 11);
  const cols = db.prepare('PRAGMA table_info(config_workflow_nodes)').all().map((c) => c.name);
  assert.ok(cols.includes('ask_questions'), 'ask_questions column present');
  const qCols = db.prepare('PRAGMA table_info(step_questions)').all().map((c) => c.name);
  assert.deepEqual(qCols, ['pipeline_id', 'step_key', 'round', 'node_id', 'agent_key', 'questions', 'answers']);
});

test('setNodeModel persists askQuestions, preserves it when omitted, NULL = inherit', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 's1_0', { askQuestions: true });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s1_0, { askQuestions: true });
  await setNodeModel(p, 'wf_x', 's1_0', { model: 'claude-opus-4-8' });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.s1_0, { model: 'claude-opus-4-8', askQuestions: true });
  await setNodeModel(p, 'wf_x', 's1_0', { model: 'claude-opus-4-8', askQuestions: false });
  assert.equal((await resolveRunConfig(p, 'wf_x')).nodes.s1_0.askQuestions, false);
  // Clearing everything deletes the row (all-empty selection).
  await setNodeModel(p, 'wf_x', 's2_0', {});
  assert.equal((await resolveRunConfig(p, 'wf_x')).nodes.s2_0, undefined);
});
