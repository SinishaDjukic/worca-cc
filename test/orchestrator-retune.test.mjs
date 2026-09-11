// test/orchestrator-retune.test.mjs
// Live node retune: a guarded synchronous mutation of resolved.nodeCtx plus a
// two-cell patch of every persisted manifest copy. Driven through the REAL
// dispatcher with injected runners (the mkRunners pattern,
// test/orchestrator-guardrails.test.mjs:212-235) so the claudeOpts assertion is a
// genuine dispatch, not a unit call. No claude spawn anywhere: claude {mock:true}
// plus a stub for EVERY runnerType, clarifier included.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);   // sandboxes WORCA_HOME + the db.mjs singleton, NOT HOME

// settings sandbox: listModels folds in the GLOBAL catalog, which settingsFile()
// resolves under HOME, not WORCA_HOME. Without the fallback flag settings.mjs
// THROWS under NODE_TEST_CONTEXT (test/orchestrator-graph.test.mjs:22-38).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-retune-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; // catalog guard: HOME is sandboxed above
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

const [engine] = ENGINES;
// wf_default's nodes (src/core/graph/builtin-workflows.mjs:31-37). n_clarify is
// the FIRST agent to launch and is a `clarifier`, so it needs its own stub.
const IMPL = 'n_impl';
const CLARIFY = 'n_clarify';

/** Stub runners for EVERY runnerType the graph can select — producer, verifier
 *  AND clarifier (executor.mjs:890-893). Records every dispatch's claudeOpts and
 *  lets ONE node block until the test releases it: the "run in flight" state a
 *  retune must survive. Returns the v1 shape; engine.create's adaptRunner
 *  converts it and writes the declared output files. */
function mkRunners(seen, gate) {
  const record = (ctx) => seen.push({ nodeId: ctx.nodeId, claudeOpts: ctx.claudeOpts || {} });
  const gated = async (ctx) => {
    record(ctx);
    // While gated, the execution must still honour ctx.signal: a pause aborts it
    // and the runner has to REJECT for the unwind to mark the row 'paused'
    // (orchestrator.mjs:484-486). Resolving through the gate instead would let
    // the execution finish normally and there would be no killed row to retune.
    // Same abort arm as test/orchestrator-guardrails.test.mjs:216-221.
    if (gate && gate.nodeId === ctx.nodeId && !gate.released) {
      await new Promise((resolve, reject) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
        if (ctx.signal.aborted) return onAbort();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        gate.promise.then(resolve, reject);
      });
    }
    return { status: 'ok', summary: 'ok' };
  };
  return {
    producer: gated,
    clarifier: gated,   // n_clarify: without this it runs runClarifierExecution for real
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
}

/** No `branch` option: the shared gitDir helper does a bare `git init -q`, so the
 *  default branch is init.defaultBranch ('master' on a stock box) and pinning
 *  source:'main' cannot resolve. test/orchestrator-graph.test.mjs omits it too. */
const optsFor = (seen, gate) => ({
  projectDir: gitDir('retune'), prompt: 'demo', auto: true,
  claude: { mock: true }, runners: mkRunners(seen, gate),
});

const newGate = (nodeId) => {
  let release;
  const promise = new Promise((r) => { release = r; });
  return { nodeId, released: false, promise, open() { this.released = true; release(); } };
};

test('a retune reaches the NEXT dispatch of the node and patches every manifest copy', async () => {
  const seen = [];
  const gate = newGate(CLARIFY);
  const orch = engine.create(optsFor(seen, gate));

  const done = orch.run();
  // Wait until the FIRST agent is in flight, then retune a node that has not started.
  await waitFor(() => seen.some((s) => s.nodeId === CLARIFY));
  const applied = await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  // `persisted` rides along so a caller that REPORTS success to a person can say
  // when the change is live in this process only: _persist swallows its own write
  // errors, and an unsaved retune silently reverts on resume.
  assert.deepEqual(applied, { nodeId: IMPL, model: 'claude-opus-5', effort: 'high', persisted: true });

  // The live dispatch table.
  assert.equal(orch.resolved.nodeCtx[IMPL].model, 'claude-opus-5');
  assert.equal(orch.resolved.nodeCtx[IMPL].effort, 'high');
  // The persisted manifest — both the v2 cell and the v1 shim (manifest.mjs:188-189).
  const cell = orch.state.stepper.graph.nodes.find((n) => n.id === IMPL);
  assert.equal(cell.model, 'claude-opus-5');
  assert.equal(cell.effort, 'high');
  const shim = orch.state.stepper.steps.flatMap((b) => b.nodes || []).find((n) => n.id === IMPL);
  assert.equal(shim.model, 'claude-opus-5');
  assert.equal(shim.effort, 'high');
  // The AUTHORED config is untouched (manifest.mjs:128-133).
  assert.equal(cell.config.model, undefined);

  gate.open();
  const res = await done;
  assert.equal(res.status, 'done', JSON.stringify(res));

  const implDispatch = seen.find((s) => s.nodeId === IMPL);
  assert.ok(implDispatch, 'the implementer node did dispatch');
  assert.equal(implDispatch.claudeOpts.model, 'claude-opus-5', 'the next dispatch honours the retune');
  assert.equal(implDispatch.claudeOpts.effort, 'high');
  // The DB row carries it too: writeState UPSERTs `stepper` (artifacts.mjs:1036-1060).
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(JSON.parse(saved.row.stepper).graph.nodes.find((n) => n.id === IMPL).model, 'claude-opus-5');
});

test('a node with an execution in flight is refused with NODE_BUSY', async () => {
  const seen = [];
  const gate = newGate(CLARIFY);
  const orch = engine.create(optsFor(seen, gate));
  const done = orch.run();
  await waitFor(() => seen.some((s) => s.nodeId === CLARIFY));

  await assert.rejects(() => orch.retuneNode(CLARIFY, { model: 'claude-opus-5' }),
    (err) => err.code === 'NODE_BUSY');
  // The refusal changed nothing.
  assert.equal(orch.resolved.nodeCtx[CLARIFY].model, undefined);
  assert.equal(orch.state.stepper.graph.nodes.find((n) => n.id === CLARIFY).model, '');

  gate.open();
  await done;
});

test('a node that already RAN stays editable — D1 is "in flight", not "never ran"', async () => {
  const seen = [];
  const orch = engine.create(optsFor(seen, null));
  await orch.run();
  // Every row is terminal now, but the run itself is done -> RUN_NOT_RETUNABLE.
  // Force the run status back to a live value to isolate the ROW rule.
  orch.state.status = 'running';
  const applied = await orch.retuneNode(CLARIFY, { model: 'claude-sonnet-5' });
  assert.equal(applied.model, 'claude-sonnet-5');
  assert.ok(orch.state.steps.some((s) => s.nodeId === CLARIFY && s.status === 'done'),
    'the node did run, and was still editable');
});

test('flow cards, unknown ids, terminal runs and bad selections are refused by code', async () => {
  const orch = engine.create(optsFor([], null));
  await orch.run();
  assert.equal(orch.state.status, 'done');
  await assert.rejects(() => orch.retuneNode(IMPL, {}), (e) => e.code === 'RUN_NOT_RETUNABLE');

  orch.state.status = 'running';
  // Flow nodes DO have a nodeCtx entry (workflows.mjs:616), so this is NOT_AGENT.
  await assert.rejects(() => orch.retuneNode('n_end', {}), (e) => e.code === 'NOT_AGENT');
  await assert.rejects(() => orch.retuneNode('n_task', {}), (e) => e.code === 'NOT_AGENT');
  await assert.rejects(() => orch.retuneNode('n_nope', {}), (e) => e.code === 'UNKNOWN_NODE');
  // Catalog rules, identical to setNodeModel (config.mjs:867-876).
  await assert.rejects(() => orch.retuneNode(IMPL, { model: 'made-up' }),
    (e) => e.code === 'BAD_SELECTION' && /unknown model "made-up"/.test(e.message));
  await assert.rejects(() => orch.retuneNode(IMPL, { effort: 'high' }),
    (e) => /select a model before choosing an effort/.test(e.message));
  // Haiku 4.5 advertises ['medium','high'] only (config.mjs:77).
  await assert.rejects(() => orch.retuneNode(IMPL, { model: 'claude-haiku-4-5', effort: 'max' }),
    (e) => /does not support effort "max"/.test(e.message));
  await assert.rejects(() => orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'low' }),
    (e) => /unknown effort "low"/.test(e.message), 'AUX_EFFORT is not a pipeline effort (model-env.mjs:26)');
});

test('an empty model clears the node back to inherit (answer: clear-to-inherit)', async () => {
  const orch = engine.create(optsFor([], null));
  await orch.run();
  orch.state.status = 'running';
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  await orch.retuneNode(IMPL, { model: '', effort: '' });
  assert.equal(orch.resolved.nodeCtx[IMPL].model, undefined, "'' -> undefined -> nc.model || this.claude.model");
  assert.equal(orch.resolved.nodeCtx[IMPL].effort, undefined, "'' -> no --effort flag at all");
  assert.equal(orch.state.stepper.graph.nodes.find((n) => n.id === IMPL).model, '');
  assert.equal(orch.state.stepper.graph.nodes.find((n) => n.id === IMPL).effort, '');
});

test('a retune rides the ordinary state frame and writes one node-scoped run-log line', async () => {
  const orch = engine.create(optsFor([], null));
  const frames = []; const logs = [];
  // NO dedicated event type: the patched manifest travels on `state`, which
  // getState() deep-clones, and onState adopts whatever manifest a frame carries.
  orch.on('state', (st) => frames.push(st));
  orch.on('log', (l) => { if (String(l.text || '').startsWith('retuned ')) logs.push(l); });
  await orch.run();
  orch.state.status = 'running';
  frames.length = 0;
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });

  assert.equal(frames.length, 1, 'exactly one frame — the state snapshot');
  const cell = frames[0].stepper.graph.nodes.find((n) => n.id === IMPL);
  assert.equal(cell.model, 'claude-opus-5');
  assert.equal(cell.effort, 'high');
  // The v1 stepper shim mirrors the same two values, and patchManifestNodeTune
  // keeps it in step so the two copies of the manifest never disagree.
  const band = frames[0].stepper.steps.flatMap((b) => b.nodes || []).find((n) => n.id === IMPL);
  assert.equal(band.model, 'claude-opus-5');
  assert.equal(band.effort, 'high');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].nodeId, IMPL, 'attributed so the Log tab node filter picks it up');
  assert.equal(logs[0].level, 'info');
  assert.match(logs[0].text, /applies from its next execution/);
});

test('the patched cell is MARKED as retuned, in both manifest copies', async () => {
  const orch = engine.create(optsFor([], null));
  await orch.run();
  orch.state.status = 'running';
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  const cell = orch.state.stepper.graph.nodes.find((n) => n.id === IMPL);
  assert.equal(cell.retuned, true);
  // STICKY: clearing back to inherit does not un-say that the run changed it. A
  // History reader has no other way to know the node did not always run on this.
  await orch.retuneNode(IMPL, { model: '', effort: '' });
  assert.equal(orch.state.stepper.graph.nodes.find((n) => n.id === IMPL).retuned, true);
  // A node nobody touched carries no marker.
  assert.equal(orch.state.stepper.graph.nodes.find((n) => n.id !== IMPL && n.kind === 'agent').retuned, undefined);
});

test('re-applying the pick a node ALREADY has does not brand it as changed', async () => {
  const orch = engine.create(optsFor([], null));
  await orch.run();
  orch.state.status = 'running';
  const cell = () => orch.state.stepper.graph.nodes.find((n) => n.id === IMPL);
  // A repeated `/retune`, or a second Apply on an unedited panel. Nothing moved, so
  // an "earlier executions used a different model" marker would be a permanent,
  // un-clearable false claim on the one durable record History has.
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  assert.equal(cell().retuned, true);
  delete cell().retuned;
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  assert.equal(cell().retuned, undefined, 'the same pick again changes nothing');
  // ...and a real change still marks it.
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'max' });
  assert.equal(cell().retuned, true);
});

test('a retune that could not be SAVED says so instead of reporting a flat success', async () => {
  const orch = engine.create(optsFor([], null));
  await orch.run();
  orch.state.status = 'running';
  const logs = [];
  orch.on('log', (l) => { if (String(l.text || '').includes('could not be saved')) logs.push(l); });
  // _persist swallows its own write errors by house contract, and this caller
  // REPORTS success to a person: an unsaved retune is honoured for the rest of the
  // process and then silently reverts on resume.
  orch._persist = async () => false;
  const applied = await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  assert.equal(applied.persisted, false);
  assert.equal(logs.length, 1, 'and the run log carries the warning');
  assert.equal(logs[0].level, 'warn');
  assert.equal(logs[0].nodeId, IMPL);
  // The in-memory selection still took effect — that is what makes it worth saying.
  assert.equal(orch.resolved.nodeCtx[IMPL].model, 'claude-opus-5');
});

test('a retune applied while PAUSED survives into the resumed run (D6)', async () => {
  const seen = [];
  const gate = newGate(CLARIFY);
  const opts = optsFor(seen, gate);
  const orch = engine.create(opts);
  const done = orch.run();
  await waitFor(() => seen.some((s) => s.nodeId === CLARIFY));
  assert.equal(orch.pause(), true, 'pause() accepted while running (run-harness.mjs:775-791)');
  gate.open();
  const paused = await done;
  assert.equal(paused.status, 'paused', JSON.stringify(paused));

  // The pause KILLED clarify's execution: its row is 'paused' (orchestrator.mjs:484-486)
  // and the scheduler keeps it non-terminal, so resume re-invokes it from scratch.
  // That is exactly why it stays editable (answer: paused-killed-node).
  assert.ok(orch.state.steps.some((s) => s.nodeId === CLARIFY && s.status === 'paused'));
  await orch.retuneNode(CLARIFY, { model: 'claude-opus-5', effort: 'high' });

  // The resume point is what _restoreFromResumePoint actually adopts (orchestrator.mjs:1075),
  // and _engineRehydrate hard-fails without it (:1047) — the stepper alone is not enough.
  const rpCell = orch.state.resumePoint.manifest.graph.nodes.find((n) => n.id === CLARIFY);
  assert.equal(rpCell.model, 'claude-opus-5', 'the resume point carries the patch, not a stale clone');
  assert.equal(rpCell.effort, 'high');

  // Re-read from the DB, the way the server does: writeState persists resume_point
  // (artifacts.mjs:1400-1402) and readPipelineForResume parses it back (:1338-1349).
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(saved.resumePoint.manifest.graph.nodes.find((n) => n.id === CLARIFY).model, 'claude-opus-5');

  const seen2 = [];
  const resumed = engine.create({
    projectDir: opts.projectDir, auto: true, claude: { mock: true },
    runners: mkRunners(seen2, null),
    resume: saved,               // the WHOLE {row, resumePoint, steps} bag
  });
  const res = await resumed.resume();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const reinvoked = seen2.find((s) => s.nodeId === CLARIFY);
  assert.ok(reinvoked, 'the pause-killed execution was re-invoked');
  assert.equal(reinvoked.claudeOpts.model, 'claude-opus-5', 'the re-invoked execution honours the new values');
  assert.equal(reinvoked.claudeOpts.effort, 'high');
});

test('on a RUNNING run past its first completion the resume-point patch is load-bearing', async () => {
  const seen = [];
  // Gate the SECOND agent: n_clarify then completes CLEANLY, and onSnapshot
  // (orchestrator.mjs:210-220) assigns state.resumePoint at every clean
  // completion — so a running run is NOT a run without a resume point.
  const gate = newGate('n_plan');
  const orch = engine.create(optsFor(seen, gate));
  const done = orch.run();
  await waitFor(() => seen.some((s) => s.nodeId === 'n_plan'));
  assert.ok(orch.state.resumePoint, 'a clean completion already left a resume point behind');

  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  const rpCell = orch.state.resumePoint.manifest.graph.nodes.find((n) => n.id === IMPL);
  assert.equal(rpCell.model, 'claude-opus-5', 'the existing point is patched, not left stale');
  assert.equal(rpCell.effort, 'high');

  gate.open();
  assert.equal((await done).status, 'done');
});

test('a cleared node dispatches with NO model of its own (the clear-case argv)', async () => {
  const seen = [];
  const gate = newGate(CLARIFY);
  const orch = engine.create(optsFor(seen, gate));
  const done = orch.run();
  await waitFor(() => seen.some((s) => s.nodeId === CLARIFY));
  await orch.retuneNode(IMPL, { model: 'claude-opus-5', effort: 'high' });
  assert.deepEqual(await orch.retuneNode(IMPL, { model: '', effort: '' }),
    { nodeId: IMPL, model: '', effort: '', persisted: true });

  gate.open();
  assert.equal((await done).status, 'done');
  // The set-case asserts the value REACHED argv; the clear case has to assert the
  // mirror of that — nothing node-specific reaches it, so buildEffortArgs returns
  // [] and the run-global model applies.
  const implDispatch = seen.find((s) => s.nodeId === IMPL);
  assert.ok(implDispatch, 'the implementer node did dispatch');
  assert.equal(implDispatch.claudeOpts.model, undefined, 'no per-node model survived the clear');
  assert.equal(implDispatch.claudeOpts.effort, undefined, 'and no per-node effort either');
});

/** Poll a predicate; the suites use this shape rather than a fixed sleep. */
async function waitFor(pred, timeoutMs = 10000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
