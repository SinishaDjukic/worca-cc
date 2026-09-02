// test/run-harness-hooks.test.mjs
// The engine-agnostic harness contract: a stub engine (no v1 code, no claude)
// drives RunHarness through run() and resume() and proves the six hooks are the
// ONLY seams — bookends, stepper stamping, the preflight key set, the
// pre-pause point and the rehydrate bag all flow through them.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';

useTempHome(after);

const dirs = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {}); });

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-harness-'));
  dirs.push(dir);
  await writeFile(join(dir, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

class StubEngine extends RunHarness {
  constructor(opts) {
    super(opts);
    this.calls = { topology: 0, engineRun: [], prePause: 0, rehydrate: [] };
    this.agentKeys = opts.agentKeys || new Set(['planner']);
  }
  async _resolveTopology(registry) {
    this.calls.topology += 1;
    this.calls.registryKeys = Object.keys(registry).length;
    return {
      manifest: { version: 99, steps: [{ kind: 'stub' }], feedbacks: [] },
      agentKeys: this.agentKeys,
      workflow: { id: 'wf_stub', name: 'Stub' },
    };
  }
  async _engineRun(args) {
    this.calls.engineRun.push(args);
    // Exactly what v1's dispatcher does on entry: honour a pause that was
    // requested while the harness was still in preflight.
    this._checkPause();
    return 'done';
  }
  _enginePrePausePoint() { this.calls.prePause += 1; return { version: 99, kind: 'stub-boundary' }; }
  _engineRehydrate(rp) {
    this.calls.rehydrate.push(rp);
    if (rp.version !== 99) throw new Error(`stub: unsupported resume point version ${rp.version}`);
    return {
      checkpointRef: 'ref-from-hook',
      memberWorktrees: [{ projectKey: 'k', worktreeDir: '/nope', graphInstruction: 'gi' }],
      plan: { marker: 'frozen' },
      audit: 'Pipeline **resumed** (stub).',
    };
  }
}

/** The pipeline's audit lines, in order — the two seams S5 and S10 write here. */
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id')
  .all(id).map((r) => r.text).join('\n');

beforeEach(() => { _resetForTests(); });

test('base hooks throw a named "engine hook not implemented" error', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  assert.throws(() => h._enginePrePausePoint(), /engine hook not implemented: _enginePrePausePoint/);
  assert.throws(() => h._engineRehydrate({}), /engine hook not implemented: _engineRehydrate/);
  return Promise.all([
    assert.rejects(() => h._resolveTopology({}), /engine hook not implemented: _resolveTopology/),
    assert.rejects(() => h._engineRun({}), /engine hook not implemented: _engineRun/),
  ]);
});

test('the base implements _bookend and _initRunners (no engine needed)', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  const execs = [];
  h.on('exec', (p) => execs.push(p));
  h.on('phase', () => assert.fail('the phase event died with the v1 engine'));
  h._bookend('preflight', 'start');
  h._bookend('preflight', 'done');
  // A bookend is an EXECUTION row now: keyed x:<name>:1, agentKey null, kind
  // 'cycle' — the two readers filter it by executionId, not by name.
  assert.deepEqual(execs, [
    { nodeId: 'preflight', executionId: 'x:preflight:1', kind: 'cycle', ordinal: 1, status: 'start', agentKey: null, trigger: { wireIds: [], freshPorts: [] } },
    { nodeId: 'preflight', executionId: 'x:preflight:1', kind: 'cycle', ordinal: 1, status: 'done', agentKey: null, trigger: { wireIds: [], freshPorts: [] } },
  ]);
  assert.equal(h.state.steps.length, 1);
  assert.equal(h.state.steps[0].key, 'x:preflight:1');
  assert.equal(h.state.steps[0].executionId, 'x:preflight:1', 'persisted as execution_id');
  assert.equal(h.state.steps[0].status, 'done');
  assert.equal(h._runners, undefined, 'the base installs no runner registry');
});

test('_preflightAgentKeys gates on a key SET, with the §9.4 message', () => {
  const h = new RunHarness({ projectDir: process.cwd() });
  h.registry = { planner: {}, reviewer: {} };
  h._preflightAgentKeys(new Set(['planner', 'reviewer']));           // no throw
  assert.throws(
    () => h._preflightAgentKeys(new Set(['planner', 'ghost'])),
    /Preflight failed: 1 workflow agent key\(s\) do not resolve:\n {2}- agent "ghost" is not installed \(removed plugin\?\)/,
  );
});

test('run(): the topology hook stamps state.stepper, feeds the preflight gate and the bookends bracket the engine', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo task', claude: { mock: true }, auto: true });
  const seen = { stepperAt: -1, phases: [] };
  orch.on('state', (s) => { if (seen.stepperAt < 0 && s.stepper) seen.stepperAt = seen.phases.length; });
  orch.on('exec', (p) => seen.phases.push(`${p.nodeId}:${p.status}`));
  const res = await orch.run();
  assert.equal(res.status, 'done');
  assert.equal(orch.calls.topology, 1);
  assert.ok(orch.calls.registryKeys > 0, 'the base loads the registry and hands it to the hook');
  assert.deepEqual(orch.state.stepper, { version: 99, steps: [{ kind: 'stub' }], feedbacks: [] });
  assert.equal(seen.stepperAt, 0, 'stepper is stamped before the first exec event');
  assert.deepEqual(seen.phases, ['preflight:start', 'preflight:done', 'done:done']);
  assert.deepEqual(orch.calls.engineRun, [{ resume: null }]);
  assert.equal(orch.state.steps.at(-1).key, 'x:done:1');
  // The workflow field of the topology bag is what the audit line renders (P1-c).
  assert.match(auditOf(orch.pipeline.id), /Workflow: \*\*Stub\*\* \(wf_stub\)\./, 'the audit line comes from topology.workflow');
});

test('run(): a key the registry does not know fails preflight through the hook set', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({
    projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true,
    agentKeys: new Set(['planner', 'ghostAgent']),
  });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /agent "ghostAgent" is not installed/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});

test('run(): a topology bag missing `workflow` fails AT THE SEAM, before the engine runs', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  // Exactly what P4's first draft returned: the spec's two fields, no workflow.
  orch._resolveTopology = async () => ({ manifest: { version: 99, steps: [], feedbacks: [] }, agentKeys: new Set(['planner']) });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /engine hook contract: _resolveTopology/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});

test('run(): a pause requested during preflight lands on _enginePrePausePoint and is what resume() will read back', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  orch.on('exec', (p) => { if (p.nodeId === 'preflight' && p.status === 'done') assert.equal(orch.pause(), true); });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(orch.calls.prePause, 1, 'the engine decided the pre-engine resume point');
  assert.deepEqual(orch.state.resumePoint, { version: 99, kind: 'stub-boundary' });
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  assert.equal(JSON.parse(row.resume_point).kind, 'stub-boundary', 'persisted through _completePaused');
});

test('run(): a throw AFTER createPipeline pauses on the pre-engine point with reason error (never status error)', async () => {
  const dir = await makeRepo();
  const orch = new StubEngine({ projectDir: dir, prompt: 'demo', claude: { mock: true }, auto: true });
  orch._setupRunRoot = async () => { throw new Error('disk full'); };
  const errors = [];
  orch.on('error', (e) => errors.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  assert.equal(res.detail, 'disk full');
  assert.equal(errors.length, 0, "a converted failure emits no 'error' event");
  assert.equal(orch.calls.prePause, 1, 'the engine decided the pre-engine resume point (the base hook default _engineLastPoint() is null)');
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
  const rp = orch.state.resumePoint;
  assert.equal(rp.kind, 'stub-boundary');
  assert.equal(rp.snapshot, null);
  assert.equal(rp.pauseReason, 'error');
  assert.equal(rp.pauseDetail, 'disk full');
  assert.equal(rp.setupIncomplete, true, 'resume() must replay the setup');
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  assert.equal(JSON.parse(row.resume_point).pauseReason, 'error', 'persisted through _completePaused');
  assert.match(auditOf(orch.state.id), /Pipeline \*\*paused\*\*: disk full/);
  assert.doesNotMatch(auditOf(orch.state.id), /Pipeline \*\*error\*\*/);
});

test('resume(): the shell consumes the _engineRehydrate bag and never reads rp.bus', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const rp = {
    version: 99, kind: 'stub-boundary', stepIndex: 0, pipelineDir: p.dir,
    stepModels: null, workflowId: 'wf_stub', guardrailsId: 'permissive', toolInstruction: '',
    bus: { code: { baseRef: 'POISON' } }, // v1-shaped field: the shell must ignore it
  };
  const row = {
    id: p.id, status: 'paused', archived_at: null, title: 'demo', started_at: new Date().toISOString(),
    prompt: 'demo', stepper: null, tools: null, branch: null, base_name: 'demo',
    date_prefix: '01-01-26', workspace_meta: null,
  };
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row, resumePoint: rp, steps: [] },
  });
  const res = await orch.resume();
  assert.equal(res.status, 'done');
  assert.equal(orch.checkpointRef, 'ref-from-hook');
  assert.deepEqual(orch.calls.rehydrate, [rp]);
  assert.equal(orch.calls.engineRun.length, 1);
  assert.equal(orch.calls.engineRun[0].resume, rp);
  assert.deepEqual(orch.calls.engineRun[0].rehydrated.plan, { marker: 'frozen' });
  assert.deepEqual(
    Object.keys(orch.calls.engineRun[0].rehydrated).sort(),
    ['audit', 'checkpointRef', 'memberWorktrees', 'plan'],
  );
  assert.match(auditOf(p.id), /Pipeline \*\*resumed\*\* \(stub\)\./, 'the resume audit line is the rehydrate bag\'s');
});

test('resume(): a foreign resume point is rejected BY THE HOOK, not by the shell', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: {
      row: { id: p.id, status: 'paused', archived_at: null, title: 't', started_at: null, prompt: '', stepper: null, tools: null, branch: null, base_name: 'b', date_prefix: 'd', workspace_meta: null },
      resumePoint: { version: 1, kind: 'boundary', pipelineDir: p.dir },
      steps: [],
    },
  });
  await assert.rejects(() => orch.resume(), /stub: unsupported resume point version 1/);
});

test('resume(): a rehydrate bag missing `audit` fails AT THE SEAM, before anything is rehydrated', async () => {
  const dir = await makeRepo();
  const p = await createPipeline(dir, { promptText: 'demo', sourceType: 'prompt' });
  const orch = new StubEngine({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: {
      row: { id: p.id, status: 'paused', archived_at: null, title: 't', started_at: null, prompt: '', stepper: null, tools: null, branch: null, base_name: 'b', date_prefix: 'd', workspace_meta: null },
      resumePoint: { version: 99, kind: 'stub-boundary', stepIndex: 0, pipelineDir: p.dir },
      steps: [],
    },
  });
  // Exactly what P4's first draft returned: the spec's §5.1 fields, no audit —
  // which would otherwise insert an EMPTY pipeline_events row (P1-d).
  orch._engineRehydrate = () => ({ checkpointRef: null, memberWorktrees: [], plan: null });
  await assert.rejects(() => orch.resume(), /engine hook contract: _engineRehydrate/);
  assert.equal(orch.calls.engineRun.length, 0, 'the engine never ran');
});
