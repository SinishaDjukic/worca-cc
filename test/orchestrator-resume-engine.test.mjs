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
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, guardrailsId: 'permissive', ...extra, claude: { mock: true, ...claude }, runners: recording(() => orch, seen) });
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
  // #1450: "codex's default" is Worca's Codex role default per step — never a Claude id, never the CLI's own.
  assert.ok(seen.models.length && seen.models.every((m) => /^gpt-/.test(m || '')), JSON.stringify(seen.models));
  assert.ok(said(logs, /claude-sonnet-5.*is a claude model — resuming on codex's default model/));
});

const PIN = { overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } } };
test('a Claude-default run with a step on Codex keeps the consent across a pause; a plain resume passes Codex\'s gate', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-consent', { allowUnguardedEngine: true }, { guardrailsId: 'normal', ...PIN });
  assert.deepEqual(saved.resumePoint.claude, { allowUnguardedEngine: true });
  const { res } = await resumeWith(dir, saved);
  assert.equal(res.status, 'done', res.error);
});

test('a mixed run resumed with no engine named runs each step on its own harness again', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-plain', {}, PIN);
  const { orch, res, seen } = await resumeWith(dir, saved);
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual([...new Set(seen.engines)].sort(), ['claude', 'codex']);
  assert.deepEqual(orch.getState().runEngines, ['claude', 'codex'], 'the restored run still names both harnesses');
});
test('Review Focus 3: a mixed run resumed on its own default harness runs every step there, and a later plain resume keeps it so', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-switch', {}, PIN);
  assert.equal(saved.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan').engine, 'codex');
  const { orch, res, seen, logs } = await resumeWith(dir, saved, { engine: 'claude' });
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual([...new Set(seen.engines)], ['claude']);
  assert.equal('engine' in orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_plan'), false, 'the switch is kept on the manifest');
  assert.ok(said(logs, /resuming every step on claude as asked, steps set to another harness included/));
});
test('Review Focus 3: with the credential broker turned on meanwhile, a mixed run still moves to Claude Code', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-broker', {}, PIN);
  const prev = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://broker.internal:8080';
  try {
    const { res, seen } = await resumeWith(dir, saved, { engine: 'claude' });
    assert.equal(res.status, 'done', res.error);
    assert.deepEqual([...new Set(seen.engines)], ['claude']);
  } finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
});
test('Switch model on a mixed run runs every remaining step on that model, on the resume harness', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-model', {}, PIN);
  const { res, seen } = await resumeWith(dir, saved, { model: 'claude-haiku-4-5', modelForAll: true });
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual([[...new Set(seen.engines)], [...new Set(seen.models)]], [['claude'], ['claude-haiku-4-5']]);
});
test('Review Focus 3: a harness switch that fails before the graph is restored leaves no pins behind; a later plain resume runs Claude only', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-switch-fail', {}, PIN);
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, claude: { mock: true, engine: 'claude' }, resume: saved, runners: recording(() => orch, { models: [], engines: [], paused: true }) });
  orch._restoreFromResumePoint = async () => { throw new Error('restore broke'); };
  const failed = await orch.resume();
  assert.notEqual(failed.status, 'done');
  const again = readPipelineForResume(orch.getState().id);
  assert.ok(again.resumePoint, `still resumable (${failed.status}: ${failed.error})`);
  assert.equal('engine' in again.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan'), false, 'the point holds no pin');
  const { res, seen } = await resumeWith(dir, again);
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual([...new Set(seen.engines)], ['claude']);
});
test('a Claude-default run with a step on Codex is refused on resume without the consent, naming Codex; the consent lifts it', async () => {
  const { dir, saved } = await pausedRun('eng-mixed-refuse', { allowUnguardedEngine: true }, { guardrailsId: 'normal', ...PIN });
  delete saved.resumePoint.claude;
  const probe = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, claude: { mock: true }, resume: saved });
  const r = await probe.engineResumeRefusal();
  assert.deepEqual([r?.overridable, r?.engines], [true, ['codex']], JSON.stringify(r));
  assert.match(r.error, /^engine codex \(Plan\): guardrail set "normal" has permission rules this engine cannot enforce/);
  await assert.rejects(resumeWith(dir, saved), { engineRefused: true, engine: 'codex', message: /^engine codex \(Plan\): guardrail set "normal"/ }, 'resume() itself refuses too');
  const again = readPipelineForResume(saved.row.id);
  assert.equal(again.row.status, 'paused', 'the refused run stays paused');
  const ok = await resumeWith(dir, again, { allowUnguardedEngine: true });
  assert.equal(ok.res.status, 'done', ok.res.error);
  assert.ok(said(ok.logs, /engine codex \(Plan\)/), 'the resumed run\'s gate says what runs unguarded on Codex');
});
