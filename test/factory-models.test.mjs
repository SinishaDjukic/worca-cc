// test/factory-models.test.mjs — Worca's factory model defaults (src/core/factory-models.mjs): the settings layer the
// built-in graphs used to pin in their templates, the sign-in check, the varied effort, and the warning / refusal texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTORY_MODELS, WORKSPACE_SCAN_DEFAULT_MODELS, factoryNodePick, factoryRolePick, needsClaudeSignIn, variedEffort,
  factoryFallbackLines, signInRefusalText, factoryModelsPayload,
} from '../src/core/factory-models.mjs';

const RR = { roles: [{ key: 'product', label: 'Product' }, { key: 'ux', label: 'UX' }], secondOpinion: 'product' };

test('factoryNodePick: one pick per helper and role-review step, null elsewhere', () => {
  assert.deepEqual(factoryNodePick('memoryDefragmenter', null), { setting: 'memoryDefrag', pick: { model: 'claude-sonnet-5' } });
  const scan = { model: 'claude-sonnet-5', effort: 'medium', subagentModel: 'sonnet', subagentEffort: 'medium' };
  assert.deepEqual(factoryNodePick('workspaceScanner', null), { setting: 'workspaceScan', pick: scan });
  assert.deepEqual(factoryNodePick('workspaceUsageMapper', null), { setting: 'workspaceScan', pick: scan });
  assert.deepEqual(factoryNodePick('workspaceSynthesizer', null), { setting: 'workspaceScan', pick: { model: 'claude-sonnet-5', effort: 'medium' } });
  assert.deepEqual(factoryNodePick('planReviewer', RR), { setting: 'steps.planReviewer', pick: { model: 'claude-sonnet-5-5', effort: 'medium' } });
  assert.deepEqual(factoryNodePick('requirementsReviewer', { roles: [] }), { setting: 'steps.requirementsReviewer', pick: { model: 'claude-sonnet-5-5', effort: 'medium' } });
  assert.equal(factoryNodePick('planReviewer', null), null, 'a plain plan review keeps the user default');
  assert.equal(factoryNodePick('planner', RR), null);
  assert.equal(FACTORY_MODELS.helpers.workspaceScan, WORKSPACE_SCAN_DEFAULT_MODELS);
  assert.ok(Object.isFrozen(FACTORY_MODELS.steps.planReviewer));
});

test('factoryRolePick: only a secondOpinion naming a declared role', () => {
  assert.deepEqual(factoryRolePick(RR), { roleKey: 'product', setting: 'secondOpinion', pick: { model: 'claude-opus-5-5', effort: 'medium' } });
  assert.equal(factoryRolePick({ roles: RR.roles }), null);
  assert.equal(factoryRolePick({ roles: RR.roles, secondOpinion: 'qa' }), null);
  assert.equal(factoryRolePick(null), null);
});

test('needsClaudeSignIn: a sign-in connection that is not routed', () => {
  const connection = (id) => (id.startsWith('claude-') ? { kind: 'signin', engine: 'claude' } : { kind: 'apikey' });
  const routed = (id) => id === 'claude-routed';
  assert.equal(needsClaudeSignIn('claude-opus-5-5', { connection, routed }), true);
  assert.equal(needsClaudeSignIn('claude-routed', { connection, routed }), false);
  assert.equal(needsClaudeSignIn('gw-model', { connection, routed }), false);
  assert.equal(needsClaudeSignIn('', { connection, routed }), false);
  assert.equal(needsClaudeSignIn('claude-x', { connection: () => { throw new Error('boom'); }, routed }), false);
});

test('variedEffort: the next effort, else the previous; null with fewer than 2', () => {
  const E = ['low', 'medium', 'high'];
  assert.equal(variedEffort(E, 'medium'), 'high');
  assert.equal(variedEffort(E, 'high'), 'medium');
  assert.equal(variedEffort(E, 'low'), 'medium');
  assert.equal(variedEffort(E, undefined), 'high', 'absent reads as medium');
  assert.equal(variedEffort(['high', 'max'], null), 'max', 'absent, no medium: the first entry');
  assert.equal(variedEffort(['medium'], 'medium'), null);
  assert.equal(variedEffort([], 'medium'), null);
  assert.equal(variedEffort(undefined, 'medium'), null);
});

test('factoryFallbackLines: one line per setting, labelled', () => {
  const labels = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5': 'Sonnet 5', 'gw-s46': 'Copilot Claude Sonnet 4.6' };
  const lines = factoryFallbackLines([
    { setting: 'steps.planReviewer', nodeId: 'n_roles', wanted: { model: 'claude-sonnet-5-5', effort: 'medium' }, used: { model: 'gw-s46' } },
    { setting: 'secondOpinion', nodeId: 'n_roles', role: 'product', wanted: { model: 'claude-opus-5-5', effort: 'medium' }, used: { model: 'gw-s46', effort: 'high' } },
    { setting: 'workspaceScan', nodeId: 'n_scan', wanted: { model: 'claude-sonnet-5' }, used: {} },
    { setting: 'workspaceScan', nodeId: 'n_usage', wanted: { model: 'claude-sonnet-5' }, used: {} },
  ], labels);
  assert.deepEqual(lines, [
    'Plan Review: Sonnet 5.5 needs Claude Code sign-in; using Copilot Claude Sonnet 4.6',
    'Second-opinion reviewer: Opus 5.5 needs Claude Code sign-in; using Copilot Claude Sonnet 4.6 · high',
    "Workspace scan: Sonnet 5 needs Claude Code sign-in; using Claude's default model",
  ]);
  assert.deepEqual(factoryFallbackLines([{ setting: 'secondOpinion', role: 'product', wanted: { model: 'claude-opus-5-5' }, used: { model: 'gw-s46', effort: null } }], labels),
    ['Second-opinion reviewer: Opus 5.5 needs Claude Code sign-in; using Copilot Claude Sonnet 4.6 (same model and effort as the step)']);
  assert.deepEqual(factoryFallbackLines([{ setting: 'memoryDefrag', wanted: { model: 'claude-sonnet-5' }, used: {} }], {}),
    ["Memory defragment: claude-sonnet-5 needs Claude Code sign-in; using Claude's default model"], 'an unknown label reads as the id');
  assert.deepEqual(factoryFallbackLines(undefined, labels), []);
});

test('signInRefusalText: one item per source', () => {
  const labels = { 'claude-opus-5-5': 'Opus 5.5' };
  const item = (source, extra = {}) => ({ nodeId: 'n_roles', node: 'Plan Review', model: 'claude-opus-5-5', source, ...extra });
  const text = (b) => signInRefusalText([b], labels);
  const frame = (where) => `Claude Code isn't signed in, and ${where} names Opus 5.5, which needs it — pick a model routed through a provider on the Models page, or sign in (run \`claude\`, then /login)`;
  assert.equal(text(item('run')), frame("this run's pick for Plan Review"));
  assert.equal(text(item('project')), frame("the project's pick for Plan Review"));
  assert.equal(text(item('legacy')), frame('Models › Step models › Plan Review'));
  assert.equal(text(item('slot')), frame('Models › Step models › Plan Review'));
  assert.equal(text(item('role', { modelRole: 'deep' })), frame('Models › Model roles › Deep thinking'));
  assert.equal(text(item('template')), frame("the workflow's Plan Review step"));
  assert.equal(text(item('pair', { pair: 'defrag' })), frame('Models › Helper jobs › Memory defragment'));
  assert.equal(text(item('pair', { pair: 'scan' })), frame('the workspace scan model'));
  assert.equal(text(item('slot', { role: 'Product' })), frame('Models › Helper jobs › Second-opinion reviewer'));
  assert.equal(text(item('run', { role: 'Product' })), frame("this run's pick for Plan Review · Product"));
  assert.equal(text(item('project', { role: 'Product' })), frame("the project's pick for Plan Review · Product"));
  assert.equal(text({ model: 'claude-opus-5-5', source: 'runModel' }), frame("the run's model"));
  assert.equal(signInRefusalText([item('slot'), item('slot', { role: 'Product' })], labels),
    "Claude Code isn't signed in, and Models › Step models › Plan Review names Opus 5.5; Models › Helper jobs › Second-opinion reviewer names Opus 5.5, which need it — pick a model routed through a provider on the Models page, or sign in (run `claude`, then /login)");
});

test('factoryModelsPayload: the Claude steps and the two Models-page helpers', () => {
  assert.deepEqual(factoryModelsPayload(), { claude: {
    steps: { planReviewer: { model: 'claude-sonnet-5-5', effort: 'medium' }, requirementsReviewer: { model: 'claude-sonnet-5-5', effort: 'medium' } },
    helpers: { secondOpinion: { model: 'claude-opus-5-5', effort: 'medium' }, memoryDefrag: { model: 'claude-sonnet-5' } },
  } });
});
