// test/model-switch-mailbox.test.mjs
// The run-control mailbox's 'switch-models' action: _checkControlSlot routes it to switchModels and
// writes pipeline_commands.result; requestLiveModelSwitch and `worca switch-model` read it back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { heldRun } from './helpers/held-run.mjs';
import { getDb } from '../src/core/db.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import {
  enqueuePipelineCommand, claimPipelineCommand, completePipelineCommand, discardPendingPipelineCommands,
} from '../src/core/pipeline-commands.mjs';
import { requestLiveModelSwitch, ModelSwitchError } from '../src/core/model-switch.mjs';

process.env.WORCA_CONTROL_CHECK_MS = '25';   // read when a harness starts its control timer
const home = useTempHome(after);
const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const OPUS = 'claude-opus-5-5';
const flush = () => new Promise((r) => setImmediate(r));
const resultOf = (id) => JSON.parse(getDb().prepare('SELECT result FROM pipeline_commands WHERE id = ?').get(id)?.result ?? 'null');
const fakeOwner = (pipelineId, switchModels) => ({
  pipeline: { id: pipelineId }, _rehydrated: true, _log() {}, switchModels,
  _checkControlSlot: RunHarness.prototype._checkControlSlot,
});
function cli(args, env = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args],
      { env: { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
async function seedRunning(name, owner) {
  const dir = gitDir(name);
  const rp = graphResumePoint({ pipelineDir: dir });
  const { id } = await seedPipeline(dir, { status: 'running', stepper: rp.manifest, resumePoint: rp, steps: [
    { key: 'x:n_clarify:1', executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'done' },
    { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' },
  ] });
  getDb().prepare('UPDATE pipelines SET owner_pid = ?, owner_host = ?, heartbeat_at = ? WHERE id = ?')
    .run(owner.pid, hostname(), owner.beat ?? null, id);
  return id;
}

test('_checkControlSlot answers switch-models in `result` (trimmed); refusals keep their code', async () => {
  const args = [];
  const ok = fakeOwner('mbx00001', async (changes, opts) => {
    args.push([changes, opts]);
    return { ok: true, changed: [{ nodeId: 'n_impl' }], skipped: [{ nodeId: 'n_plan', label: 'Planner', reason: 'running' }],
      warnings: [], stages: [1], stepper: { big: true } };
  });
  const { id: c1 } = enqueuePipelineCommand('mbx00001', 'switch-models', { payload: { changes: { n_impl: { model: OPUS } } }, by: 'ada' });
  ok._checkControlSlot(); await flush(); await flush();
  assert.deepEqual(args, [[{ n_impl: { model: OPUS } }, { by: 'ada' }]]);
  assert.deepEqual(resultOf(c1), { ok: true, changed: [{ nodeId: 'n_impl' }],
    skipped: [{ nodeId: 'n_plan', label: 'Planner', reason: 'running' }], warnings: [] });

  const refuse = fakeOwner('mbx00002', async () => { throw new ModelSwitchError('NOT_RUNNING', 'the run is pausing', 409); });
  const { id: c2 } = enqueuePipelineCommand('mbx00002', 'switch-models', { payload: { changes: {} } });
  refuse._checkControlSlot(); await flush(); await flush();
  assert.deepEqual(resultOf(c2), { ok: false, code: 'NOT_RUNNING', error: 'the run is pausing', httpStatus: 409 });

  const retired = fakeOwner('mbx00003', undefined);
  const { id: c3 } = enqueuePipelineCommand('mbx00003', 'switch-models', { payload: { changes: {} } });
  retired._checkControlSlot();
  assert.equal(resultOf(c3).code, 'ENGINE_RETIRED');
});

test('completePipelineCommand writes a CLAIMED row only; a pending switch is discarded on (re)start', () => {
  const { id } = enqueuePipelineCommand('mbx00004', 'switch-models', { payload: { changes: {} } });
  assert.equal(completePipelineCommand(id, { ok: true }), false, 'pending: it has not run');
  assert.equal(discardPendingPipelineCommands('mbx00004'), 1);
  const { id: id2 } = enqueuePipelineCommand('mbx00004', 'switch-models', { payload: { changes: {} } });
  assert.equal(claimPipelineCommand('mbx00004').id, id2);
  assert.equal(completePipelineCommand(id2, { ok: true }), true);
  assert.equal(discardPendingPipelineCommands('mbx00004'), 0, 'a claimed row with its result survives');
});

test('requestLiveModelSwitch: dead owner -> NO_OWNER; nobody claiming -> "enqueued"; not running -> NOT_RUNNING', async () => {
  const dead = await seedRunning('mbx-dead', { pid: 2147483646 });
  await assert.rejects(requestLiveModelSwitch(dead, { changes: { n_impl: { model: OPUS } } }), (e) => e.code === 'NO_OWNER' && e.status === 409);
  const idle = await seedRunning('mbx-idle', { pid: process.pid, beat: new Date().toISOString() });
  const out = await requestLiveModelSwitch(idle, { changes: { n_impl: { model: OPUS } }, timeoutMs: 300 });
  assert.deepEqual([out.ok, out.outcome], [false, 'enqueued']);
  const cmd = getDb().prepare('SELECT action, payload, consumed_at FROM pipeline_commands WHERE id = ?').get(out.commandId);
  assert.equal(cmd.action, 'switch-models');
  assert.deepEqual(JSON.parse(cmd.payload), { changes: { n_impl: { model: OPUS } } });
  getDb().prepare("UPDATE pipelines SET status = 'paused' WHERE id = ?").run(idle);
  await assert.rejects(requestLiveModelSwitch(idle, { changes: { n_impl: { model: OPUS } } }), (e) => e.code === 'NOT_RUNNING');
});

test('a live owner in this process answers requestLiveModelSwitch; a refusal comes back as its code', { timeout: 120000 }, async () => {
  const run = heldRun('mbx-live', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  try {
    await run.held;
    const id = run.orch.getState().id;
    const res = await requestLiveModelSwitch(id, { changes: { n_impl: { model: OPUS, effort: 'high' } }, by: 'tester' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.changed.map((c) => c.nodeId), ['n_impl']);
    await assert.rejects(requestLiveModelSwitch(id, { changes: { n_impl: { model: 'nope' } } }),
      (e) => e.code === 'INVALID_SELECTION' && e.status === 400);
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
  const impl = run.spawns.find((s) => s.nodeId === 'n_impl');
  assert.deepEqual([impl.model, impl.effort], [OPUS, 'high']);
});

test('`worca switch-model` against a run another process drives: Skipped + Switched (acceptance 4)', { timeout: 120000 }, async () => {
  const run = heldRun('mbx-cli', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  try {
    await run.held;
    const id = run.orch.getState().id;
    const t0 = Date.now();
    const skip = await cli(['switch-model', id, '--stage', 'n_plan', '--model', 'claude-sonnet-5-5']);
    assert.equal(skip.code, 0, skip.stderr);
    assert.match(skip.stdout, /Skipped .*\(n_plan\).*already running/);
    const sw = await cli(['switch-model', id, '--stage', 'implementer', '--model', OPUS, '--effort', 'high']);
    assert.equal(sw.code, 0, sw.stderr);
    assert.match(sw.stdout, /Switched .*\(n_impl\)/);
    assert.doesNotMatch(sw.stdout, /worca resume/, 'no resume hint on a running run');
    assert.ok(Date.now() - t0 < 30000);
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
  assert.equal(run.spawns.find((s) => s.nodeId === 'n_impl').model, OPUS);
});
