// test/node-model-pair-floor.test.mjs — the spawn backstop in RunHarness#_nodeModelPair (#1450 D-i): a node that would
// spawn with no model — a pre-change manifest with no modelSource, or a pick the engine dropped — runs on Worca's
// default for its role instead of the CLI's own default; "Let <tool> decide" and "the tool decides" stay model-less.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
const orch = (claude = {}) => createOrchestrator({ projectDir: '/tmp/floor-proj', guardrailsId: 'permissive', claude: { mock: true, ...claude } });
const nc = (extra = {}) => ({ kind: 'agent', key: 'planner', authoredKey: 'planner', meta: { displayName: 'Plan' }, ...extra });

test('a pre-change manifest node (no modelSource key) with no model runs on the role default', () => {
  assert.deepEqual(orch()._nodeModelPair(nc()), { model: 'claude-opus-5-5', effort: undefined, source: 'worca-default' });
  assert.equal(orch()._nodeModelPair(nc({ authoredKey: 'implementer', key: 'implementer', meta: { displayName: 'Implementation' } })).model, 'claude-sonnet-5-5');
  assert.deepEqual(orch()._nodeModelPair(nc({ effort: 'high' })), { model: 'claude-opus-5-5', effort: 'high', source: 'worca-default' }, 'an effort-only node keeps its effort');
  assert.equal(orch({ engine: 'codex' })._nodeModelPair(nc()).model, 'gpt-5.6-sol');
});

test('a chosen source whose model the engine dropped falls to the default', () => {
  assert.deepEqual(orch()._nodeModelPair(nc({ model: 'gpt-5.5', modelSource: 'project' })), { model: 'claude-opus-5-5', effort: undefined, source: 'worca-default' });
});

test('a care-filled node keeps its own model', () => {
  assert.deepEqual(orch()._nodeModelPair(nc({ model: 'claude-sonnet-5', modelSource: 'care' })), { model: 'claude-sonnet-5', effort: undefined });
});

test('the tool decides (null) and cli-decides stay empty; codex cli-decides names no default', () => {
  assert.deepEqual(orch()._nodeModelPair(nc({ modelSource: null })), { model: undefined, effort: undefined });
  assert.deepEqual(orch()._nodeModelPair(nc({ modelSource: 'cli-decides' })), { model: undefined, effort: undefined });
  assert.deepEqual(orch({ engine: 'codex' })._nodeModelPair(nc({ modelSource: 'cli-decides' })), { model: undefined, effort: undefined, cliDefault: true });
  assert.deepEqual(orch({ engine: 'copilot' })._nodeModelPair(nc()), { model: undefined, effort: undefined }, 'no Worca default off Claude/Codex');
});

test('Model for all and a run model still win', () => {
  const all = orch({ model: 'claude-haiku-5-5' });
  all._modelForAll = true;
  assert.equal(all._nodeModelPair(nc({ model: 'claude-opus-5-5', modelSource: 'role' })).model, 'claude-haiku-5-5');
  assert.deepEqual(orch({ model: 'claude-haiku-5-5' })._nodeModelPair(nc()), { model: 'claude-haiku-5-5', effort: undefined });
  assert.deepEqual(orch()._nodeModelPair(nc({ model: 'claude-sonnet-5', modelSource: 'worca-default' })), { model: 'claude-sonnet-5', effort: undefined });
});

test('runOpts carries cliDefault to the adapter only when the pair set it', async () => {
  const { runOpts } = await import('../src/core/phases.mjs');
  const opts = (c) => runOpts({ projectDir: '/p', claudeOpts: c }, { role: 'implementer', prompt: 'p', systemPrompt: 's' });
  assert.equal(opts({ cliDefault: true }).cliDefault, true);
  assert.equal('cliDefault' in opts({ model: 'gpt-5.5' }), false);
});

test('a hosted session member whose only model is the Worca default stays bare, so the explicit hostModel reaches it (C26)', () => {
  const o = orch();
  o._sessionSpecs = [{ sid: 's_1', members: ['n_a'], settings: { hostModel: 'claude-haiku-4-5' } }];
  o._sessionDecisions = new Map([['s_1', { mode: 'subagents' }]]);
  const member = nc({ nodeId: 'n_a', model: 'claude-opus-5-5', modelSource: 'worca-default' });
  assert.deepEqual(o._nodeModelPair(member), { model: undefined, effort: undefined });
  assert.deepEqual(o._nodeModelPair(nc({ nodeId: 'n_a' })), { model: undefined, effort: undefined }, 'the backstop yields to the host too');
  assert.equal(o._nodeModelPair({ ...member, modelSource: 'role' }).model, 'claude-opus-5-5', 'a chosen model is the member\'s own');
  o._sessionDecisions.set('s_1', { mode: 'separate' });
  assert.equal(o._nodeModelPair(member).model, 'claude-opus-5-5', 'separate sessions have no main agent to inherit from');
});

test('Model for all is the run\'s own choice: neither premium guard treats a premium run model as unchosen (D-f)', () => {
  const all = orch({ model: 'claude-fable-5-2' });
  all._modelForAll = true;
  const node = nc({ nodeId: 'n_p', model: 'claude-opus-5-5', modelSource: 'worca-default' });
  const pair = all._nodeModelPair(node);
  assert.deepEqual(pair, { model: 'claude-fable-5-2', effort: undefined, source: 'run' });
  assert.doesNotThrow(() => all._premiumGate(node, { claudeOpts: pair, executionId: 'n_p' }), 'no pre-step pause');
  assert.equal(all._modelGuardOpts(node, { id: 'n_p' }, 'n_p', null).modelGuard.source, 'run');
  const plain = orch();
  assert.throws(() => plain._premiumGate(node, { claudeOpts: { model: 'claude-fable-5-2' }, executionId: 'n_p' }), 'an unchosen premium model still pauses');
});
