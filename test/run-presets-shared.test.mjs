// test/run-presets-shared.test.mjs — what a run preset keeps of a POST /api/run body (src/shared/run-presets.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupFromBody, checkPresetName, nodeLabel, PRESET_SETUP_KEYS, presetRunBody, bodyFollowingPreset, overlayOver, applyPresetStart } from '../src/shared/run-presets.mjs';

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

const QUICK = { id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'project', ref: 'p-12345678' },
  setup: { workflowId: 'wf_default', guardrailsId: 'normal', nightMode: true, humanInLoop: false,
    overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } }, wires: { w_review: { maxCycles: 2 } } } } };

test('presetRunBody is the setup, then the task, then presetId', () => {
  assert.deepEqual(presetRunBody(QUICK, { projectDir: '/p', prompt: 'x' }), {
    workflowId: 'wf_default', guardrailsId: 'normal', nightMode: true, humanInLoop: false,
    overlay: QUICK.setup.overlay, projectDir: '/p', prompt: 'x', presetId: 'rp_aaaaaaaaaaaa' });
  assert.notEqual(presetRunBody(QUICK, {}).overlay, QUICK.setup.overlay, 'a copy, never the stored object');
});

test('bodyFollowingPreset replaces every setup key of a stored request with the preset\'s current one', () => {
  const stored = { projectDir: '/p', prompt: 'nightly', title: 'Nightly', featureBranch: 'nightly', guardrailsId: 'secure',
    mock: true, tags: ['old'], overlay: { nodes: { n_plan: { model: 'claude-opus-4-1' } } }, internal: { startedBy: 'local' } };
  const b = bodyFollowingPreset(stored, QUICK);
  assert.equal(b.guardrailsId, 'normal');
  assert.equal(b.mock, undefined, 'a key the preset does not set is dropped, not kept from the old copy');
  assert.equal(b.tags, undefined);
  assert.equal(b.overlay.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.equal(b.presetId, QUICK.id);
  for (const k of ['projectDir', 'prompt', 'title', 'featureBranch', 'internal']) assert.deepEqual(b[k], stored[k], k);
});

test('an Any project preset keeps the request\'s own branch names', () => {
  const global = { ...QUICK, scope: { kind: 'global', ref: null } };
  const b = bodyFollowingPreset({ projectDir: '/p', prompt: 'x', sourceBranch: 'dev' }, global);
  assert.equal(b.sourceBranch, 'dev');
  const pinned = bodyFollowingPreset({ projectDir: '/p', prompt: 'x', sourceBranch: 'dev' }, { ...QUICK, setup: { ...QUICK.setup, sourceBranch: 'main' } });
  assert.equal(pinned.sourceBranch, 'main');
});

test('overlayOver: top picks win per node, wires merge, empty sides drop out', () => {
  assert.deepEqual(overlayOver(QUICK.setup.overlay, { nodes: { n_plan: { model: 'claude-sonnet-4-5' } } }),
    { nodes: { n_plan: { model: 'claude-sonnet-4-5', effort: 'medium' } }, wires: { w_review: { maxCycles: 2 } } });
  assert.deepEqual(overlayOver(undefined, undefined), {});
});

test('applyPresetStart adds presetId and the keys an Ask card has no control for', () => {
  const card = { id: QUICK.id, name: QUICK.name, workflowId: 'wf_default', setup: { humanInLoop: false, nightMode: true, mock: true, overlay: QUICK.setup.overlay } };
  const body = applyPresetStart({ workflowId: 'wf_default', guardrailsId: 'normal', mock: false, prompt: 'x' }, card);
  assert.equal(body.presetId, QUICK.id);
  assert.equal(body.nightMode, true);
  assert.equal(body.mock, true);
  assert.deepEqual(body.overlay.wires, { w_review: { maxCycles: 2 } });
  const other = applyPresetStart({ workflowId: 'wf_quick', prompt: 'x' }, card);
  assert.equal(other.overlay, undefined, 'another workflow: the preset\'s agent picks are not sent');
  const own = { nodes: { n_impl: { model: 'claude-opus-5-5' } } };
  const kept = applyPresetStart({ workflowId: 'wf_quick', prompt: 'x', overlay: own }, card);
  assert.deepEqual(kept.overlay, own, 'another workflow: the card\'s own picks for that workflow are still sent');
});

test('applyPresetStart never lays the preset\'s model picks under the card\'s lane', () => {
  const card = { id: QUICK.id, name: QUICK.name, workflowId: 'wf_default',
    setup: { overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium', fanOut: true } }, wires: { w_review: { maxCycles: 2 } } } } };
  // The person reset n_plan to the project's model on the card: the lane sends nothing for it.
  const reset = applyPresetStart({ workflowId: 'wf_default', prompt: 'x' }, card);
  assert.deepEqual(reset.overlay, { nodes: { n_plan: { fanOut: true } }, wires: { w_review: { maxCycles: 2 } } });
  // A lane pick still wins over the preset's hidden keys.
  const picked = applyPresetStart({ workflowId: 'wf_default', prompt: 'x', overlay: { nodes: { n_plan: { model: 'claude-sonnet-4-6', effort: 'high', fanOut: false } } } }, card);
  assert.deepEqual(picked.overlay.nodes.n_plan, { model: 'claude-sonnet-4-6', effort: 'high', fanOut: false });
});
