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
import { _resetForTests } from '../src/core/db.mjs';

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
