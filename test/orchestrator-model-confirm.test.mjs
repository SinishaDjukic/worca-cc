// test/orchestrator-model-confirm.test.mjs — the premium-model guard on the real orchestrator in mock mode (#1450):
// the [init] guard's model_confirm error and the pre-step gate both PAUSE the run (never an ask: --yes would answer it);
// the resume point carries what it waits on; a resume that confirms the model runs the step and keeps the confirmation.
// Orchestrator level because the pause and persist path spans the harness and the orchestrator.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const home = mkdtempSync(join(tmpdir(), 'worca-confirm-home-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

const FABLE = 'claude-fable-5-2';
const outsOf = (ctx) => Object.fromEntries((ctx.ports.outputs || []).map((p) => [p.id, { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type }]));
const done = (ctx, verdict = null) => ({ outputs: outsOf(ctx), verdict, summary: '' });

/** The default workflow, --yes; the planner's runner is `producer`. `patch(nodes)` edits the resolved graph. */
function start({ dir = gitDir('model-confirm'), producer, patch = null, resume = null, confirmModel = null, getOrch = null } = {}) {
  const runners = { clarifier: async (ctx) => done(ctx), verifier: async (ctx) => done(ctx, { issues: [], summary: '' }), producer };
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, guardrailsId: 'permissive',
    claude: { mock: true }, runners, ...(resume ? { resume, resumedBy: 'alice' } : {}), ...(confirmModel ? { confirmModel } : {}) });
  if (getOrch) getOrch.current = orch;
  if (patch) {
    const adopt = orch._adoptResolvedGraph.bind(orch);
    orch._adoptResolvedGraph = (r) => { patch(r.nodes); adopt(r); };
  }
  return { orch, dir, done: resume ? orch.resume() : orch.run() };
}
const planner = (nodes) => Object.values(nodes).find((n) => n.authoredKey === 'planner');

test('the [init] guard: the step pauses model_confirm, the resume point says what it waits on, the step drops its session', async () => {
  let thrown = 0;
  const h = start({
    producer: async (ctx) => {
      if (ctx.node?.key !== 'planner') return done(ctx);
      thrown += 1;
      ctx.onEvent({ type: 'session', sessionId: 'sess-init-1' });
      throw Object.assign(new Error(`Claude Code started Plan on ${FABLE}, a premium model nobody chose.`), {
        errorClass: 'model_confirm', modelConfirm: { nodeId: ctx.nodeId, stepKey: ctx.executionId, model: FABLE, requested: null, at: 'init' } });
    },
  });
  const res = await h.done;
  assert.equal(res.status, 'paused', res.error);
  assert.equal(thrown, 1, 'never retried: a pause, not a recovery round');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.pauseReason, 'model_confirm');
  assert.deepEqual({ ...saved.resumePoint.modelConfirm, stepKey: null, nodeId: null }, { nodeId: null, stepKey: null, model: FABLE, requested: null, at: 'init' });
  const step = saved.steps.find((s) => s.key === saved.resumePoint.modelConfirm.stepKey);
  assert.ok(step, 'the paused step is in the ledger');
  assert.equal(step.sessionId ?? null, null, 'an [init] pause starts the resume in a fresh session');
  assert.equal(h.orch.getState().modelConfirm.model, FABLE);

  // Resume with "Continue on Fable 5.2": the step runs; the confirmation is kept on the next point, the wait is cleared.
  const ref = {};
  let ran = 0;
  const r2 = start({ dir: h.dir, resume: saved, confirmModel: FABLE, getOrch: ref, producer: async (ctx) => {
    if (ctx.node?.key === 'planner') { ran += 1; queueMicrotask(() => ref.current.pause()); }
    return done(ctx);
  } });
  const res2 = await r2.done;
  assert.equal(ran, 1, 'the confirmed step ran');
  assert.equal(res2.status, 'paused');
  const again = readPipelineForResume(r2.orch.getState().id);
  assert.deepEqual(again.resumePoint.confirmedModels, [FABLE], 'the confirmation survives a later pause');
  assert.equal(again.resumePoint.modelConfirm, undefined);
  assert.equal(again.resumePoint.pauseReason, null, 'a plain manual pause');
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(saved.row.id).map((r) => r.text);
  assert.ok(audit.includes('Pipeline **resumed**: continued on Fable 5.2 (premium) by alice.'), audit.join('\n'));
});

test('pre-step gate: an Auto pick on a premium model pauses before the producer runs (--yes too); a project pick does not', async () => {
  let calls = 0;
  const auto = start({
    patch: (nodes) => { Object.assign(planner(nodes), { model: FABLE, modelSource: 'auto' }); },
    producer: async (ctx) => { if (ctx.node?.key === 'planner') calls += 1; return done(ctx); },
  });
  const res = await auto.done;
  assert.equal(res.status, 'paused', res.error);
  assert.equal(calls, 0, 'paused before the spawn');
  const saved = readPipelineForResume(auto.orch.getState().id);
  assert.equal(saved.resumePoint.pauseReason, 'model_confirm');
  assert.equal(saved.resumePoint.modelConfirm.model, FABLE);
  assert.equal(saved.resumePoint.modelConfirm.at, 'pre');
  assert.match(saved.resumePoint.pauseDetail, /^Paused before Plan: it would run on claude-fable-5-2, a premium model nobody chose\.$/);

  // A resume that confirms the model passes the gate (the step runs), and is never asked again for it.
  let ran = 0;
  const r2 = start({ dir: auto.dir, resume: saved, confirmModel: FABLE,
    producer: async (ctx) => { if (ctx.node?.key === 'planner') ran += 1; return done(ctx); } });
  const res2 = await r2.done;
  assert.equal(ran, 1);
  assert.notEqual(res2.status === 'paused' && r2.orch.getState().pauseReason === 'model_confirm', true, 'not asked again');

  let chosenCalls = 0;
  const chosen = start({
    patch: (nodes) => { Object.assign(planner(nodes), { model: FABLE, modelSource: 'project' }); },
    producer: async (ctx) => { if (ctx.node?.key === 'planner') chosenCalls += 1; return done(ctx); },
  });
  const res3 = await chosen.done;
  assert.equal(chosenCalls, 1, 'a model someone chose runs');
  assert.notEqual(chosen.orch.getState().pauseReason, 'model_confirm', res3.error);
});
