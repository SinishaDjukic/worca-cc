// test/run-presets-shared.test.mjs — what a run preset keeps of a POST /api/run body (src/shared/run-presets.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupFromBody, checkPresetName, nodeLabel, PRESET_SETUP_KEYS } from '../src/shared/run-presets.mjs';

const BODY = {
  title: 'Dark mode', prompt: 'Add dark mode', promptMarkdown: '# x', extras: ['a'], featureBranch: 'feat/x', source: { type: 'plugin' },
  allowUnguardedEngine: true, pastTeamCap: true, scheduledFor: '2030-01-01T00:00:00Z',
  workflowId: 'wf_default', engine: 'codex', guardrailsId: 'normal', mcpOptOut: ['s|srv'], mock: true, nightMode: true,
  humanInLoop: false, sourceBranch: 'main', sameAsSource: true, syncBeforeStart: true, overlay: { nodes: { n_plan: { model: 'm' } } },
};

test('setupFromBody keeps only the whitelist and never the task', () => {
  const s = setupFromBody(BODY, { scope: 'project' });
  for (const k of ['title', 'prompt', 'promptMarkdown', 'extras', 'featureBranch', 'source', 'allowUnguardedEngine', 'pastTeamCap', 'scheduledFor']) {
    assert.equal(Object.hasOwn(s, k), false, k);
  }
  assert.deepEqual(Object.keys(s).sort(), PRESET_SETUP_KEYS.filter((k) => k in BODY).sort());
});

test('a global setup drops branch names but keeps the source-branch switch', () => {
  const s = setupFromBody(BODY, { scope: 'global' });
  assert.equal(s.sourceBranch, undefined);
  assert.equal(s.sameAsSource, true);
});

test('checkPresetName and nodeLabel', () => {
  assert.equal(checkPresetName(' '), 'name is required');
  assert.match(checkPresetName('x'.repeat(81)), /max 80/);
  assert.equal(checkPresetName('Quick fix'), '');
  assert.equal(nodeLabel({ id: 'n_plan', key: 'planner' }), 'Planner');
  assert.equal(nodeLabel({ id: 'n_x', key: 'code-reviewer', config: { label: 'Reviewer A' } }), 'Reviewer A');
});
