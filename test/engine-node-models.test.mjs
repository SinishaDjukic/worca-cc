// test/engine-node-models.test.mjs — a node keeps its model only on the engine that owns it, and a
// dropped model takes its effort with it (cascading-settings-design.md §4.2, Review Focus 2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setStep, addCustomModel } from '../src/core/config.mjs';

useTempHome(after);

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

function recording(seen) {
  const note = (ctx) => seen.push({ engine: ctx.claudeOpts?.engine ?? null, model: ctx.claudeOpts?.model ?? null, effort: ctx.claudeOpts?.effort ?? null });
  const done = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  return {
    clarifier: async (ctx) => { note(ctx); return done(ctx, null); },
    verifier: async (ctx) => { note(ctx); return done(ctx, { issues: [], summary: '' }); },
    producer: async (ctx) => { note(ctx); return done(ctx, null); },
  };
}

test('a codex run over Claude step picks spawns no Claude id and no Claude effort', async () => {
  const dir = gitDir('eng-node-codex');
  await setStep(dir, 'planner', { model: 'claude-opus-5-5', effort: 'max' });
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true, engine: 'codex' }, runners: recording(seen) });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(seen.length > 0);
  for (const s of seen) {
    assert.equal(s.engine, 'codex');
    assert.equal(s.model, null, JSON.stringify(seen));
    assert.equal(s.effort, null, JSON.stringify(seen));
  }
});

test('the same project on Claude still spawns the planner with its pick', async () => {
  const dir = gitDir('eng-node-claude');
  await setStep(dir, 'planner', { model: 'claude-opus-5-5', effort: 'max' });
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true }, runners: recording(seen) });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(seen.some((s) => s.model === 'claude-opus-5-5' && s.effort === 'max'), JSON.stringify(seen));
});

test('a codex run drops a legacy project custom model (Review Focus 9)', async () => {
  const dir = gitDir('eng-node-project-custom');
  await addCustomModel(dir, { id: 'my-project-proxy' });
  await setStep(dir, 'planner', { model: 'my-project-proxy', effort: 'max' });
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true, engine: 'codex' }, runners: recording(seen) });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((s) => s.model === null && s.effort === null), JSON.stringify(seen));
});
