// test/orchestrator-resume-engine.test.mjs
// A run started on another engine (`worca --engine codex`, New pipeline's Codex) keeps it across
// a pause: the resume point carries `claude: { engine, allowUnguardedEngine }`, written only when
// they differ from the default, and a resume that names no engine comes back on the saved one
// with the saved consent. A resume that names an engine wins. A Claude run's point is unchanged.
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

/** Records every spawn's model and engine; pauses the run once, on the first producer. */
function recording(getOrch, seen) {
  const note = (ctx) => { seen.models.push(ctx.claudeOpts?.model ?? null); seen.engines.push(ctx.claudeOpts?.engine ?? null); };
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

async function pausedRun(name, claude, extra = {}) {
  const dir = gitDir(name);
  const seen = { models: [], engines: [] };
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, ...extra, claude: { mock: true, ...claude }, runners: recording(() => orch, seen) });
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  return { dir, seen, saved: readPipelineForResume(orch.getState().id) };
}

async function resumeWith(dir, saved, claude = {}) {
  const seen = { models: [], engines: [], paused: true };
  const logs = [];
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, claude: { mock: true, ...claude }, resume: saved, runners: recording(() => orch, seen) });
  orch.on('log', (l) => logs.push(l));
  const res = await orch.resume();
  return { orch, res, seen, logs };
}

const said = (logs, re) => logs.some((l) => re.test(JSON.stringify(l)));

test('a codex run saves its engine and its consent in the resume point', async () => {
  const { saved } = await pausedRun('eng-save', { engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'normal' });
  assert.deepEqual(saved.resumePoint.claude, { engine: 'codex', allowUnguardedEngine: true });
});

test('a Claude run writes neither, even when it was given the consent', async () => {
  const { saved } = await pausedRun('eng-claude', { allowUnguardedEngine: true });
  assert.equal(saved.resumePoint.claude, undefined);
  const named = await pausedRun('eng-claude-named', { engine: 'claude' });
  assert.equal(named.saved.resumePoint.claude, undefined, 'the default engine is never written');
});

test('a resume that names no engine runs on the saved one, with the saved consent', async () => {
  const { dir, saved } = await pausedRun('eng-restore', { engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'normal' });
  const { orch, res, seen, logs } = await resumeWith(dir, saved);
  // Without the saved consent the resume gate would reject resume() on the "normal" set.
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.engine, 'codex');
  assert.equal(orch._allowUnguardedEngine, true);
  assert.ok(!said(logs, /resuming on .* as asked/), 'no switch, no line');
  assert.ok(seen.engines.length > 0 && seen.engines.every((e) => e === 'codex'), JSON.stringify(seen.engines));
});

test('a resume that names another engine wins, says so, and leaves the consent behind', async () => {
  const { dir, saved } = await pausedRun('eng-switch', { engine: 'codex', allowUnguardedEngine: true }, { guardrailsId: 'normal' });
  const { orch, res, seen, logs } = await resumeWith(dir, saved, { engine: 'claude' });
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.engine, 'claude');
  assert.equal(orch._allowUnguardedEngine, false);
  assert.ok(seen.engines.length > 0 && seen.engines.every((e) => e === 'claude'), JSON.stringify(seen.engines));
  assert.ok(said(logs, /the run's saved engine is codex — resuming on claude as asked/));
});

test('a point written before the field resumes on Claude, as before', async () => {
  const { dir, saved } = await pausedRun('eng-legacy', {});
  const { orch, res, logs } = await resumeWith(dir, saved);
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.engine, 'claude');
  assert.ok(!said(logs, /resuming on .* as asked/));
});

test('a codex run keeps its own model across a resume', async () => {
  const { dir, saved, seen: first } = await pausedRun('eng-model', { engine: 'codex', model: 'gpt-5.2-codex' });
  // Precondition (D4): the fresh run itself spawned with the model (_engineModel keeps a
  // non-Claude id on codex).
  assert.ok(first.models.includes('gpt-5.2-codex'), JSON.stringify(first.models));
  assert.deepEqual(saved.resumePoint.claude, { model: 'gpt-5.2-codex', engine: 'codex' });
  const { res, seen, logs } = await resumeWith(dir, saved);
  assert.equal(res.status, 'done', res.error);
  assert.ok(seen.models.length > 0 && seen.models.every((m) => m === 'gpt-5.2-codex'), JSON.stringify(seen.models));
  assert.ok(!said(logs, /no longer in the catalog/));
});

test('a codex model is dropped when the resume switches back to Claude', async () => {
  // Its own paused run: a run that finished `done` has no resume point any more.
  const { dir, saved } = await pausedRun('eng-model-back', { engine: 'codex', model: 'gpt-5.2-codex' });
  const { orch, res, logs } = await resumeWith(dir, saved, { engine: 'claude' });
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.model, undefined);
  assert.ok(said(logs, /no longer in the catalog/), 'on Claude the catalog check applies again');
});

test('a codex catalog model is dropped when the resume switches back to Claude, and says why', async () => {
  const { dir, saved } = await pausedRun('eng-codex-builtin-back', { engine: 'codex', model: 'gpt-5.6-sol' });
  const { orch, res, logs } = await resumeWith(dir, saved, { engine: 'claude' });
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.model, undefined);
  assert.ok(said(logs, /gpt-5\.6-sol.*is a codex model — resuming on claude's default model/), 'names the owning engine');
});

test('a Claude model is dropped when the resume switches the run to codex', async () => {
  const { dir, saved } = await pausedRun('eng-claude-to-codex', { model: 'claude-sonnet-5' });
  const { orch, res, seen, logs } = await resumeWith(dir, saved, { engine: 'codex' });
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.claude.model, undefined);
  assert.ok(seen.models.every((m) => m === null), JSON.stringify(seen.models));
  assert.ok(said(logs, /claude-sonnet-5.*is a claude model — resuming on codex's default model/));
});
