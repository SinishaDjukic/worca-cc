// test/graph-phase-shim.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

/** The harness's own bookends (`preflight`/`done`, cycle 0) are emitted by the
 *  base for BOTH engines with no exec before them — they are not the shim's. */
const isBookend = (p) => p.cycle === 0 && (p.phase === 'preflight' || p.phase === 'done');

test('every exec is followed by a derived phase, and the manifest carries v1 shim cells', { timeout: 120000 }, async () => {
  const dir = gitDir('shim');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  const seq = [];
  const scalars = [];   // state.phase/cycle as seen on every state event after an exec start
  orch.on('exec', (e) => seq.push({ t: 'exec', status: e.status, nodeId: e.nodeId, ordinal: e.ordinal }));
  orch.on('phase', (p) => seq.push({ t: 'phase', ...p }));
  orch.on('state', (s) => { seq.push({ t: 'state' }); scalars.push({ phase: s.phase, cycle: s.cycle }); });

  await orch.run();

  const phases = seq.filter((e) => e.t === 'phase' && !isBookend(e));
  assert.ok(phases.length > 0, 'the shim emitted phase events');
  // RULE 1: every non-bookend phase is immediately preceded by an exec of the same
  // status, with no state event between them (order exec -> phase -> state).
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].t !== 'phase' || isBookend(seq[i])) continue;
    const prev = seq[i - 1];
    assert.equal(prev?.t, 'exec', `phase at ${i} must follow an exec, got ${prev?.t}`);
    assert.equal(prev.status, seq[i].status, 'status is 1:1');
    assert.equal(prev.nodeId, seq[i].nodeId, 'nodeId is carried through');
    assert.equal(prev.ordinal, seq[i].cycle, 'cycle === ordinal');
  }
  // RULE 3: phase vocabulary comes from the manifest node's uiPhase.
  const man = orch.getState().stepper;
  const uiPhases = new Set(man.graph.nodes.map((n) => n.uiPhase));
  for (const p of phases) assert.ok(uiPhases.has(p.phase), `unknown uiPhase "${p.phase}"`);
  assert.ok(uiPhases.has('plan') && uiPhases.has('implement'), 'builtin keys map through UI_PHASE');
  // RULE 4: the manifest carries the v1-shaped shim cells the untouched UI reads.
  assert.equal(man.version, 2);
  assert.equal(man.steps[0].kind, 'preflight');
  assert.equal(man.steps[man.steps.length - 1].kind, 'done');
  const agentCells = man.steps.filter((c) => c.kind === 'agents');
  assert.ok(agentCells.length >= 1);
  for (const cell of agentCells) {
    for (const n of cell.nodes) {
      for (const k of ['id', 'key', 'uiPhase', 'label', 'color', 'sub', 'cycles', 'model', 'effort']) {
        assert.ok(k in n, `shim cell node missing ${k}`);
      }
    }
  }
  assert.ok(Array.isArray(man.feedbacks));
  for (const f of man.feedbacks) {
    for (const k of ['id', 'from', 'to', 'maxCycles']) assert.ok(k in f, `feedback missing ${k}`);
    assert.equal(typeof f.from, 'string');
  }
  // RULE 5: state.phase/cycle mirror the LAST-STARTED execution while it runs.
  // (After the run the base's `done` bookend resets them to 'done'/0, as on v1.)
  const lastStartIdx = seq.map((e) => e.t === 'exec' && e.status === 'start').lastIndexOf(true);
  const lastStart = seq[lastStartIdx];
  const statesAfter = seq.slice(lastStartIdx).filter((e) => e.t === 'state').length;
  const seen = scalars[scalars.length - statesAfter];   // the first state event after that start
  assert.equal(seen.cycle, lastStart.ordinal);
  assert.equal(seen.phase, man.graph.nodes.find((n) => n.id === lastStart.nodeId).uiPhase);
  assert.equal(orch.getState().phase, 'done', 'the base bookend closes the run as on v1');
});

test('a `skipped` exec emits no phase (unit: the scheduler never emits it at runtime)', () => {
  const orch = createGraphOrchestrator({ projectDir: process.cwd(), claude: { mock: true } });
  orch.resolved = { nodeCtx: {}, ports: () => ({}) };
  const phases = [];
  orch.on('phase', (p) => phases.push(p));
  orch._onSchedulerEvent('exec', { nodeId: 'n_x', executionId: 'x:n_x:1', kind: 'cycle', ordinal: 1, status: 'skipped', agentKey: null, trigger: { wireIds: [], freshPorts: [] } });
  assert.deepEqual(phases, []);
  orch._onSchedulerEvent('exec', { nodeId: 'n_x', executionId: 'x:n_x:1', kind: 'cycle', ordinal: 1, status: 'start', agentKey: null, trigger: { wireIds: [], freshPorts: [] } });
  assert.deepEqual(phases, [{ phase: 'n_x', cycle: 1, status: 'start', nodeId: 'n_x' }]);
});
