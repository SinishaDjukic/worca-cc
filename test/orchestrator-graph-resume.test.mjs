// test/orchestrator-graph-resume.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator, resolvedFromManifest } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

/** The v2 executor ABI: one entry per declared output port. */
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}
const okVerifier = async (ctx) => ({ outputs: outsOf(ctx), verdict: { issues: [], summary: '' }, summary: '' });
const okClarifier = async (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: '' });

/** A producer that emits a session id, asks for a pause ONCE, then hangs until aborted. */
function pausingOnce(getOrch, seen) {
  return async (ctx) => {
    ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.executionId}` });
    if (seen.paused) {
      seen.resumed.push({ executionId: ctx.executionId, resume: ctx.resumeSessionId || null });
      return { outputs: outsOf(ctx), verdict: null, summary: 'ok' };
    }
    seen.paused = true;
    seen.executionId = ctx.executionId;
    queueMicrotask(() => getOrch().pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}

test('a v2 run pauses mid-execution and resumes from the frozen snapshot', { timeout: 120000 }, async () => {
  const dir = gitDir('gresume');
  const seen = { resumed: [] };
  let orch;
  orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: pausingOnce(() => orch, seen), verifier: okVerifier, clarifier: okClarifier },
  });
  const first = await orch.run();
  assert.equal(first.status, 'paused');

  const saved = readPipelineForResume(orch.getState().id);
  const rp = saved.resumePoint;
  assert.equal(rp.version, 2);
  assert.ok(rp.manifest && rp.manifest.version === 2, 'the manifest is frozen into the point');
  assert.ok(rp.snapshot, 'a CLEAN scheduler snapshot was kept');
  assert.equal(rp.workflowId, 'wf_default');
  // The snapshot is the last CLEAN one (taken at a completion): the execution the
  // pause killed is either absent from it (it started after that completion) or
  // NON-TERMINAL in it — never `done`. Its session id rides the point from the
  // ledger row (the scheduler's paused rows carry none).
  const frozen = rp.snapshot.execs.find((e) => e.executionId === seen.executionId);
  assert.ok(!frozen || frozen.status !== 'done', 'the killed execution stays re-invokable');
  assert.ok(rp.nodes.some((n) => n.executionId === seen.executionId && n.sessionId === `sess-${seen.executionId}` && !n.completed));
  assert.equal(saved.steps.find((s) => s.key === seen.executionId).status, 'paused');

  // A stale row must not be consulted: point the resume at a bogus workflow id.
  let orch2;
  orch2 = createOrchestrator({
    projectDir: dir, workflowId: 'nope_does_not_exist', auto: true, claude: { mock: true },
    resume: saved,
    runners: { producer: pausingOnce(() => orch2, seen), verifier: okVerifier, clarifier: okClarifier },
  });
  const second = await orch2.resume();
  assert.equal(second.status, 'done', second.error);
  assert.equal(orch2.getState().stepper.version, 2);
  // The interrupted execution re-attached its session exactly once; later ones did not.
  assert.deepEqual(seen.resumed.filter((r) => r.executionId === seen.executionId).map((r) => r.resume), [`sess-${seen.executionId}`]);
  assert.ok(seen.resumed.filter((r) => r.executionId !== seen.executionId).every((r) => r.resume === null));
  assert.equal(readPipelineForResume(orch2.getState().id).row.resume_point, null, 'a finished run holds no point');
});

test('resume refuses a v1 resume point', async () => {
  const dir = gitDir('gresume-v1');
  const orch = createOrchestrator({
    projectDir: dir, claude: { mock: true },
    resume: { row: { id: 'p1', status: 'paused', archived_at: null, branch: null, workspace_meta: null }, resumePoint: { version: 1 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /unsupported resume point version 1/);
});

test('resolvedFromManifest: port IDENTITY comes from the snapshot, executor meta from the live registry', () => {
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  const manifest = buildGraphManifest(GRAPH_DEFAULT_WORKFLOW, registry, { overlays: { nodes: {}, wires: { w9: { maxCycles: 5 } } } });
  // A sidecar that drifted while the run sat paused: the reviewer lost its `pass` port.
  const drifted = { ...registry, reviewer: { ...registry.reviewer, outputs: registry.reviewer.outputs.filter((p) => p.id !== 'pass') } };
  const r = resolvedFromManifest(manifest, drifted);
  const ports = r.ports({ id: 'n_review', kind: 'agent', key: 'reviewer', config: {} });
  assert.ok(ports.outputs.some((p) => p.id === 'pass'), 'the snapshot keeps the port the live sidecar dropped');
  assert.equal(ports.verdict.filename, registry.reviewer.verdict.filename, 'verdict filename is the LIVE one, never the manifest stub');
  assert.equal(r.nodes.n_review.runnerType, 'verifier');
  assert.ok(r.nodes.n_impl.meta.sideEffect === 'code');
  assert.deepEqual(r.wires, { w5: { maxCycles: 3 }, w9: { maxCycles: 5 } }, 'effective budgets survive the round trip');
  assert.deepEqual(r.template.wires.find((w) => w.id === 'w9').config, { maxCycles: 5 });
  assert.equal(r.nodes.n_task.kind, 'task');
  assert.deepEqual([...r.agentKeys].sort(), ['clarify', 'implementer', 'planner', 'refiner', 'reviewer']);
});

test('resolvedFromManifest rebuilds a script ctx from the cell config + the live script registry', () => {
  const scripts = { runTests: { key: 'runTests', displayName: 'Run tests', runtime: 'node', scriptPath: '/abs/runTests.mjs', commandResolved: null, timeoutMs: 20000,
    params: [{ id: 'cmd', type: 'command', default: 'npm test' }], verdict: { filename: 'tests-cycle{cycle}.json' }, mock: null,
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] } };
  const tpl = { ...GRAPH_DEFAULT_WORKFLOW, nodes: [...GRAPH_DEFAULT_WORKFLOW.nodes, { id: 'n_tests', kind: 'script', key: 'runTests', x: 0, y: 0, config: { params: { cmd: 'npm run lint' }, timeoutMs: 5000 } }] };
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  const manifest = buildGraphManifest(tpl, registry, { scripts });
  const r = resolvedFromManifest(manifest, registry, scripts);
  const nc = r.nodes.n_tests;
  assert.equal(nc.kind, 'script');
  assert.equal(nc.key, 'runTests');
  assert.equal(nc.file, '/abs/runTests.mjs');
  assert.deepEqual(nc.params, { cmd: 'npm run lint' });
  assert.equal(nc.timeoutMs, 5000);
  assert.equal(nc.meta, scripts.runTests);
  assert.deepEqual([...r.scriptKeys], ['runTests']);
  assert.deepEqual(r.ports({ id: 'n_tests', kind: 'script', key: 'runTests', config: {} }).inputs.map((p) => p.id), ['done', 'await']);
  assert.equal(r.ports({ id: 'n_tests', kind: 'script', key: 'runTests', config: {} }).verdict.filename, 'tests-cycle{cycle}.json', 'the verdict filename is live');
  assert.equal(resolvedFromManifest(manifest, registry).nodes.n_tests.file, null, 'no scripts index: the ctx is a stub the preflight refuses');
});
