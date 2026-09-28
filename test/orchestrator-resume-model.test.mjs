// test/orchestrator-resume-model.test.mjs
// A run started with a run-level model (`worca --model <id>`, the UI's start pair)
// keeps it across a pause: the resume point carries `claude: {model, effort}`, and
// a resume that names no model of its own spawns every inheriting node with it —
// so a bridged model's routing env follows too (resolveModelEnv is keyed by the id).
// A saved model that left the catalog is dropped with a warning (today's default),
// and a point written before this field resumes exactly as before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

/** Records every spawn's model; pauses the run once, on the first producer. */
function recording(getOrch, seen) {
  const note = (ctx) => seen.models.push(ctx.claudeOpts?.model ?? null);
  const done = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  return {
    clarifier: async (ctx) => { note(ctx); return done(ctx, null); },
    verifier: async (ctx) => { note(ctx); return done(ctx, { issues: [], summary: '' }); },
    producer: async (ctx) => {
      note(ctx);
      if (seen.paused) return done(ctx, null);
      seen.paused = true;
      queueMicrotask(() => getOrch().pause());
      return new Promise((_r, rej) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
        if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

async function pausedRun(name, claude) {
  const dir = gitDir(name);
  const seen = { models: [] };
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true, ...claude }, runners: recording(() => orch, seen) });
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  return { dir, saved: readPipelineForResume(orch.getState().id) };
}

async function resumeWith(dir, saved, claude = {}) {
  const seen = { models: [], paused: true };
  const logs = [];
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, claude: { mock: true, ...claude }, resume: saved, runners: recording(() => orch, seen) });
  orch.on('log', (l) => logs.push(l));
  const res = await orch.resume();
  assert.equal(res.status, 'done', res.error);
  return { models: seen.models, logs, orch };
}

test('the run-level model and effort ride the resume point, and a bare resume spawns with them', { timeout: 120000 }, async () => {
  const { dir, saved } = await pausedRun('rmodel-keep', { model: 'claude-sonnet-5', effort: 'high' });
  assert.deepEqual(saved.resumePoint.claude, { model: 'claude-sonnet-5', effort: 'high' });
  const { models, orch } = await resumeWith(dir, saved);
  assert.ok(models.length > 0);
  assert.ok(models.every((m) => m === 'claude-sonnet-5'), JSON.stringify(models));
  assert.equal(orch.claude.effort, 'high');
});

test('a resume that names its own model wins over the saved one', { timeout: 120000 }, async () => {
  const { dir, saved } = await pausedRun('rmodel-override', { model: 'claude-sonnet-5' });
  const { models } = await resumeWith(dir, saved, { model: 'claude-opus-5' });
  assert.ok(models.length > 0 && models.every((m) => m === 'claude-opus-5'), JSON.stringify(models));
});

test('a saved model that left the catalog is dropped with a warning; the run resumes on the default', { timeout: 120000 }, async () => {
  const { dir, saved } = await pausedRun('rmodel-stale', { model: 'claude-sonnet-5' });
  saved.resumePoint.claude = { model: 'openrouter-gone-model', effort: 'high' };
  const { models, logs } = await resumeWith(dir, saved);
  assert.ok(models.every((m) => m == null), JSON.stringify(models));
  assert.ok(logs.some((l) => l.level === 'warn' && /openrouter-gone-model/.test(l.text) && /no longer in the catalog/.test(l.text)), JSON.stringify(logs.map((l) => l.text)));
});

test('a point without the field (an older run, or none named) resumes exactly as before', { timeout: 120000 }, async () => {
  const { dir, saved } = await pausedRun('rmodel-old', {});
  assert.equal(saved.resumePoint.claude, undefined, 'nothing named, nothing saved');
  const { models, logs } = await resumeWith(dir, saved);
  assert.ok(models.every((m) => m == null), JSON.stringify(models));
  assert.ok(!logs.some((l) => /no longer in the catalog/.test(l.text || '')));
});
