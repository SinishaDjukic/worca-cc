// test/engine-validators.test.mjs — a pick validates against its own engine's efforts
// (cascading-settings-design.md §3.1a): step, node, shared-workflow and node-defaults writers.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStep, setNodeModel, readConfig, resolveRunConfig } from '../src/core/config.mjs';
import { nodeDefaultsError } from '../src/core/workflow-share.mjs';
import { sanitizeNodeDefaults } from '../src/core/workflows.mjs';
import { _resetForTests, getDb, SCHEMA_VERSION } from '../src/core/db.mjs';

const dirs = [];
const prev = process.env.WORCA_HOME;
beforeEach(async () => {
  const whome = await mkdtemp(join(tmpdir(), 'worca-eng-val-'));
  dirs.push(whome);
  _resetForTests();
  process.env.WORCA_HOME = whome;
});
after(async () => {
  _resetForTests();
  if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});
const freshProject = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-eng-val-proj-')); dirs.push(d); return d; };

test('setStep and setNodeModel validate a pick against its own engine\'s efforts', async () => {
  const p = await freshProject();
  await setStep(p, 'planner', { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'gpt-5.5', effort: 'low' });
  await assert.rejects(() => setStep(p, 'planner', { model: 'gpt-5.5', effort: 'max' }), /model "gpt-5.5" does not support effort "max"/);
  await assert.rejects(() => setStep(p, 'planner', { model: 'claude-opus-5-5', effort: 'minimal' }), /model "claude-opus-5-5" does not support effort "minimal"/);
  await assert.rejects(() => setStep(p, 'planner', { model: 'gpt-5.5', effort: 'turbo' }), /unknown effort "turbo"/);
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.6-sol', effort: 'minimal' });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.n1, { model: 'gpt-5.6-sol', effort: 'minimal' });
  await assert.rejects(() => setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.6-sol', effort: 'xhigh' }), /does not support effort "xhigh"/);
});

test('workflow node defaults: a Codex effort survives with its Codex model', () => {
  const models = [{ id: 'gpt-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex' }, { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude' }];
  assert.equal(nodeDefaultsError({ model: 'gpt-5.5', effort: 'low' }, models, 'node "n1"'), '');
  assert.equal(nodeDefaultsError({ model: 'gpt-5.5', effort: 'max' }, models, 'node "n1"'), 'model "gpt-5.5" does not support effort "max"');
  assert.equal(nodeDefaultsError({ model: 'claude-opus-5-5', effort: 'low' }, models, 'node "n1"'), 'model "claude-opus-5-5" does not support effort "low"');
  assert.equal(nodeDefaultsError({ model: 'gpt-5.5', effort: 'warp' }, models, 'node "n1"'), 'unknown effort "warp"');
  assert.deepEqual(sanitizeNodeDefaults({ model: 'gpt-5.5', effort: 'minimal' }, 'n1'), { model: 'gpt-5.5', effort: 'minimal' });
});

test('workflow node defaults: an engine names a harness that runs the model', () => {
  const models = [{ id: 'gpt-5.5', efforts: ['minimal', 'low', 'medium', 'high'], harnesses: ['codex'] }, { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'], harnesses: ['claude'] }];
  assert.equal(nodeDefaultsError({ model: 'gpt-5.5', effort: 'low', engine: 'codex' }, models, 'node "n1"'), '');
  assert.equal(nodeDefaultsError({ model: 'claude-opus-5-5', engine: 'codex' }, models, 'node "n1"'), 'model "claude-opus-5-5" does not run on OpenAI Codex');
  assert.equal(nodeDefaultsError({ model: 'gpt-5.5', engine: 'codx' }, models, 'node "n1"'), 'unknown harness "codx"');
  assert.equal(nodeDefaultsError({ engine: 'codex' }, models, 'node "n1"'), 'select a model before choosing a harness');
  assert.deepEqual(sanitizeNodeDefaults({ model: 'gpt-5.5', engine: 'codex' }, 'n1'), { model: 'gpt-5.5', engine: 'codex' });
  assert.equal(sanitizeNodeDefaults({ engine: 'codex' }, 'n1'), undefined);
});

test('a project node pick names its harness: set, cleared by null or \'\', kept while the model stays, cleared when it changes', async () => {
  const p = await freshProject();
  const n1 = async () => (await resolveRunConfig(p, 'wf_x')).nodes.n1;
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex' });
  assert.deepEqual(await n1(), { model: 'gpt-5.5', engine: 'codex' });
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual(await n1(), { model: 'gpt-5.5', effort: 'low', engine: 'codex' }, 'absent, the same model: kept');
  for (const clear of [null, '']) {
    await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex' });
    await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: clear });
    assert.deepEqual(await n1(), { model: 'gpt-5.5' }, JSON.stringify(clear));
  }
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex' });
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.6-sol' });
  assert.deepEqual(await n1(), { model: 'gpt-5.6-sol' }, 'absent, the model changed: cleared');
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex' });
  await setNodeModel(p, 'wf_x', 'n1', { fanOut: true });
  assert.deepEqual(await n1(), { fanOut: true }, 'no model, no engine');
  assert.equal(SCHEMA_VERSION, 108);
  assert.ok(getDb().prepare('PRAGMA table_info(config_workflow_nodes)').all().some((c) => c.name === 'engine'));
});
test('a project pick\'s harness is refused when it is no harness, has no model, or does not run the model', async () => {
  const p = await freshProject();
  for (const [sel, message] of [
    [{ model: 'gpt-5.5', engine: 'codx' }, 'unknown harness "codx"'],
    [{ engine: 'codex' }, 'select a model before choosing a harness'],
    [{ model: 'claude-opus-5-5', engine: 'codex' }, 'model "claude-opus-5-5" does not run on OpenAI Codex'],
    [{ model: 'gpt-5.5', engine: 7 }, 'engine must be a string'],
  ]) await assert.rejects(() => setNodeModel(p, 'wf_x', 'n1', sel), { message }, JSON.stringify(sel));
  await assert.rejects(() => setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', roles: { qa: { model: 'claude-opus-5-5', engine: 'codex' } } }), /does not run on OpenAI Codex/);
  await assert.rejects(() => setStep(p, 'planner', { model: 'claude-opus-5-5', engine: 'codex' }), /does not run on OpenAI Codex/);
});
test('role picks and the legacy steps keep their engine', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex', roles: { qa: { model: 'claude-opus-5-5', engine: 'claude' } } });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.n1.roles, { qa: { model: 'claude-opus-5-5', engine: 'claude' } });
  await setStep(p, 'planner', { model: 'gpt-5.5', engine: 'codex' });
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'gpt-5.5', engine: 'codex' });
  await setStep(p, 'planner', { model: 'gpt-5.5', effort: 'low' });
  assert.deepEqual((await readConfig(p)).steps.planner, { model: 'gpt-5.5', effort: 'low', engine: 'codex' });
});
test('Review Focus 4: a stored pin its harness no longer runs survives writes that keep its model, and never refuses them', async () => {
  const p = await freshProject();
  await setNodeModel(p, 'wf_x', 'n1', { model: 'gpt-5.5', engine: 'codex' });
  getDb().prepare("UPDATE config_workflow_nodes SET model = 'claude-opus-5-5' WHERE node_id = 'n1'").run();
  await setNodeModel(p, 'wf_x', 'n1', { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.n1, { model: 'claude-opus-5-5', effort: 'high', engine: 'codex' }, 'absent: kept, unchecked');
  await setNodeModel(p, 'wf_x', 'n1', { model: 'claude-opus-5-5', effort: 'high', engine: 'codex', fanOut: true });
  assert.deepEqual((await resolveRunConfig(p, 'wf_x')).nodes.n1, { model: 'claude-opus-5-5', effort: 'high', engine: 'codex', fanOut: true },
    'the stored engine sent back beside the stored model: accepted unchecked');
});
