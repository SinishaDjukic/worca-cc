// test/orchestrator-model-preflight.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, findPipelineRowById } from '../src/core/artifacts.mjs';
import { ClassifierError } from '../src/core/auto/classify.mjs';

useTempHome(after);

const PROBLEM = { model: 'gw-gpt', provider: 'openai', nodes: ['Implement'], connection: 'provider', reason: 'no_key',
  message: 'provider openai: no API key — open Settings › Providers', fix: 'add an API key for openai in Settings › Providers' };
const fail = () => ({ ok: false, problems: [PROBLEM], warnings: [], checked: [] });
const pass = () => ({ ok: true, problems: [], warnings: [], checked: [] });
// Verbatim from test/orchestrator-resume-model.test.mjs:17-21.
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}
// Verbatim from test/orchestrator-auto-signed-out.test.mjs:35 (+ its POOL_429): a transient classifier
// failure, retried with no backoff (WORCA_RECOVERY_BACKOFF_MS=0), then _autoFallbackDefault adopts wf_default.
const POOL_429 = 'claude exited with code 1: API Error: Request rejected (429) · openai: rate limited (429)';
const transient = (cls, msg) => new ClassifierError('CLASSIFIER_FAILED', msg, [], { costUsd: 0.001, errorClass: cls });
function runners(seen, getOrch, { pauseAtProducer = false } = {}) {
  const done = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  return {
    clarifier: async (ctx) => { seen.push(ctx.nodeId); return done(ctx, null); },
    verifier: async (ctx) => { seen.push(ctx.nodeId); return done(ctx, { issues: [], summary: '' }); },
    producer: async (ctx) => {
      seen.push(ctx.nodeId);
      if (!pauseAtProducer || seen.paused) return done(ctx, null);
      seen.paused = true;
      queueMicrotask(() => getOrch().pause());
      return new Promise((_r, rej) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
        if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

test('fresh start: an unavailable model refuses before the row exists — launch error, no agent ran', { timeout: 120000 }, async () => {
  const seen = []; const calls = [];
  let orch;
  orch = createOrchestrator({ projectDir: gitDir('mpf-launch'), workflowId: 'wf_default', prompt: 'demo', auto: true,
    claude: { mock: true }, runners: runners(seen, () => orch),
    modelCheck: async (manifest, o) => { calls.push(o); return fail(); } });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.equal(res.pipelineDir, null);
  assert.match(res.error, /^Preflight failed: a model this run uses is not available, so the run was not started/);
  assert.match(res.error, /"gw-gpt" \(openai\) — used by Implement: .*Fix: add an API key/);
  assert.deepEqual(seen, [], 'no agent step ran');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].live, true);
});

test('fresh start under mock with no seam: the check is skipped and the run completes', { timeout: 120000 }, async () => {
  const seen = []; let orch;
  orch = createOrchestrator({ projectDir: gitDir('mpf-mock'), workflowId: 'wf_default', prompt: 'demo', auto: true,
    claude: { mock: true, model: 'gpt-nowhere' }, runners: runners(seen, () => orch) });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
});

test('Auto: launch checks only the run model; the adopted graph is checked before its first step and pauses', { timeout: 120000 }, async (t) => {
  const seen = []; const manifests = [];
  let orch;
  process.env.WORCA_RECOVERY_BACKOFF_MS = '0';
  t.after(() => { delete process.env.WORCA_RECOVERY_BACKOFF_MS; });
  orch = createOrchestrator({ projectDir: gitDir('mpf-auto'), workflowId: 'wf_auto', prompt: 'Build it.', humanInLoop: false,
    claude: { mock: true }, runners: runners(seen, () => orch),
    claudeAuth: async () => ({ state: 'signed-in', source: 'cli', detail: null }),
    classify: async () => { throw transient('rate_limit', POOL_429); },   // → _autoFallbackDefault adopts wf_default
    modelCheck: async (manifest, o) => { manifests.push({ nodes: manifest.graph.nodes.length, includeRunModel: o.includeRunModel }); return manifest.graph.nodes.length ? fail() : pass(); } });
  const res = await orch.run();
  assert.equal(res.status, 'paused', res.error);
  assert.deepEqual(seen, [], 'no agent step ran');
  assert.equal(manifests[0].nodes, 0); assert.equal(manifests[0].includeRunModel, true);
  assert.ok(manifests[1].nodes > 0, 'the adopted graph was checked');
  const st = orch.getState();
  assert.equal(st.pauseReason, 'model_unavailable');
  assert.match(st.pauseDetail, /checked once Auto chose the workflow[\s\S]*Fix it, then resume\./);
  // Resume with the model fixed: the decision is kept (no second classify) and the run completes.
  const saved = readPipelineForResume(st.id);
  let orch2;
  orch2 = createOrchestrator({ projectDir: saved.projectDir ?? orch.projectDir, workflowId: 'wf_auto', resume: saved, humanInLoop: false,
    claude: { mock: true }, runners: runners(seen, () => orch2), modelCheck: async () => pass(),
    classify: async () => { throw new Error('must not re-classify'); } });
  const res2 = await orch2.resume();
  assert.equal(res2.status, 'done', res2.error);
});

test('resume: the pending nodes are re-checked; a failure keeps the run paused with the reason', { timeout: 120000 }, async () => {
  const seen = []; let orch;
  const dir = gitDir('mpf-resume');
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true,
    claude: { mock: true }, runners: runners(seen, () => orch, { pauseAtProducer: true }), modelCheck: async () => pass() });
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  const id = orch.getState().id;

  const onlyNodes = [];
  const seen2 = []; seen2.paused = true; let orch2;
  orch2 = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, resume: readPipelineForResume(id),
    claude: { mock: true }, runners: runners(seen2, () => orch2),
    modelCheck: async (_m, o) => { onlyNodes.push(o.onlyNodes); return fail(); } });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'paused', r2.error);
  assert.equal(seen2.length, 0, 'nothing ran');   // seen2 carries a `paused` flag property: no deepEqual against []
  assert.equal(orch2.getState().pauseReason, 'model_unavailable');
  assert.equal(findPipelineRowById(id).status, 'paused', 'the run is never ended');
  assert.ok(Array.isArray(onlyNodes[0]) && !onlyNodes[0].includes('n_clarify') && onlyNodes[0].includes('n_impl'),
    `only nodes that can still run are checked: ${JSON.stringify(onlyNodes[0])}`);

  // fixed → resumes and finishes from the same point
  const seen3 = []; seen3.paused = true; let orch3;
  orch3 = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, resume: readPipelineForResume(id),
    claude: { mock: true }, runners: runners(seen3, () => orch3), modelCheck: async () => pass() });
  const r3 = await orch3.resume();
  assert.equal(r3.status, 'done', r3.error);
  assert.ok(!seen3.includes('n_clarify'), 'finished work is not redone');
});
