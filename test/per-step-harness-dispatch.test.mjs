// test/per-step-harness-dispatch.test.mjs — a step whose pick names a harness spawns there: its adapter, model and
// effort, its sub-agents and fan-out, its deny rules and the model guard follow the step's harness, and the run's
// test-only bin goes only to its own harness (_stepEngine, _engineNodeOpts, _spawnPermissionRules, _modelGuardOpts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

function recording(seen) {
  const note = (ctx) => seen.push({
    key: ctx.node?.key, engine: ctx.claudeOpts?.engine, nodeEngine: ctx.node?.engine, model: ctx.claudeOpts?.model ?? null,
    effort: ctx.claudeOpts?.effort ?? null, bin: ctx.claudeOpts?.bin ?? null, noSubagents: ctx.node?.noSubagents === true,
  });
  const done = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  return {
    clarifier: async (ctx) => { note(ctx); return done(ctx, null); },
    verifier: async (ctx) => { note(ctx); return done(ctx, { issues: [], summary: '' }); },
    producer: async (ctx) => { note(ctx); return done(ctx, null); },
  };
}


const orch = (claude = {}) => createOrchestrator({ projectDir: '/tmp/psh-proj', guardrailsId: 'permissive', claude: { mock: true, ...claude } });
const NC = { nodeId: 'n_rev', kind: 'agent', key: 'planReviewer', model: 'claude-opus-5-5', effort: 'high',
  roles: { security: { model: 'gpt-5.5', effort: 'high', engine: 'codex', source: 'run' }, stale: { model: 'claude-opus-5-5', engine: 'codex', source: 'project' }, fit: { model: 'claude-haiku-4-5', source: 'run' } } };

test('a step pinned to Codex spawns on Codex with its model and a Codex effort; every other step stays on Claude Code with the run\'s bin', async () => {
  const seen = [];
  const o = createOrchestrator({ projectDir: gitDir('psh-dispatch'), workflowId: 'wf_default', prompt: 'demo', auto: true, guardrailsId: 'permissive',
    claude: { mock: true, bin: '/opt/fake-claude' }, overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex', effort: 'max' } } }, runners: recording(seen) });
  const res = await o.run();
  assert.equal(res.status, 'done', res.error);
  const plan = seen.filter((s) => s.key === 'planner');
  assert.ok(plan.length > 0);
  for (const s of plan) assert.deepEqual(s, { key: 'planner', engine: 'codex', nodeEngine: 'codex', model: 'gpt-5.5', effort: 'high', bin: null, noSubagents: true });
  for (const s of seen.filter((x) => x.key !== 'planner')) assert.deepEqual([s.engine, s.nodeEngine, s.bin], ['claude', 'claude', '/opt/fake-claude'], s.key);
});
test('_stepEngine: a role\'s pin while its model runs there, else its node\'s harness; pins step aside after a switch and under Model for all', () => {
  const o = orch();
  assert.equal(o._stepEngine(NC), 'claude');
  assert.equal(o._stepEngine({ ...NC, model: 'gpt-5.5', engine: 'codex' }), 'codex');
  assert.equal(o._stepEngine(NC, 'security'), 'codex');
  assert.equal(o._stepEngine(NC, 'stale'), 'claude', 'a pin whose model left that harness follows its node');
  assert.equal(o._stepEngine(NC, 'fit'), 'claude');
  assert.deepEqual(o._rolePair(NC, 'security'), { model: 'gpt-5.5', effort: 'high' });
  const switched = orch({ engine: 'cursor' });
  switched._resumeEngineSwitch = { from: 'claude', to: 'cursor', pins: true };
  assert.equal(switched._stepEngine({ ...NC, model: 'gpt-5.5', engine: 'codex' }), 'cursor');
  assert.equal(orch({ model: 'claude-haiku-4-5', modelForAll: true })._stepEngine({ ...NC, model: 'gpt-5.5', engine: 'codex' }), 'claude');
});
test('sub-agents, deny rules and the model guard follow the step\'s harness', () => {
  const o = orch();
  assert.deepEqual(o._engineNodeOpts({ kind: 'agent', engine: 'codex', fanOut: true }), { engine: 'codex', subagents: true, fanOut: true });
  assert.deepEqual(o._engineNodeOpts({ kind: 'agent', engine: 'cursor', fanOut: true }), { engine: 'cursor', subagents: false, fanOut: false });
  o.guardrailPermissionRules = { deny: ['Bash(curl:*)'] };
  o._engineProjectRules = { deny: ['Read(.env*)'] };
  assert.deepEqual([...o._spawnPermissionRules('codex').deny].sort(), ['Bash(curl:*)', 'Read(.env*)']);
  assert.deepEqual(o._spawnPermissionRules('claude').deny, ['Bash(curl:*)']);
  assert.deepEqual(o._modelGuardOpts({ kind: 'agent', engine: 'codex', model: 'gpt-5.5' }, { id: 'n_plan' }, 'e1', null), {});
  assert.ok(o._modelGuardOpts({ kind: 'agent', model: 'claude-opus-5-5' }, { id: 'n_impl' }, 'e2', null).modelGuard);
});
