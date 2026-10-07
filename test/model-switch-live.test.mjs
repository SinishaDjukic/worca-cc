// test/model-switch-live.test.mjs
// GraphOrchestrator.switchModels on a RUNNING run: not-started stages spawn on the new selection, a
// running stage is skipped, a loop stage that ran switches for its next cycle, pause -> resume keeps it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { heldRun } from './helpers/held-run.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { switchPausedRunModels, describeModelSwitch, heldWireIds } from '../src/core/model-switch.mjs';

useTempHome(after);
const OPUS = 'claude-opus-5-5';
const cellOf = (manifest, id) => manifest.graph.nodes.find((n) => n.id === id);

test('running: a not-started stage spawns on its new selection; the running stage is skipped and keeps its model', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  let id;
  try {
    await run.held;
    id = run.orch.getState().id;
    assert.deepEqual(run.orch.modelSwitchSnapshot().active, ['n_plan'], 'the scheduler view reaches the stage rule');
    const out = await run.orch.switchModels({
      n_impl: { model: OPUS, effort: 'high', subagentModel: 'opus' },
      n_plan: { model: 'claude-sonnet-5-5' },
    }, { by: 'tester' });
    assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_impl']);
    assert.deepEqual(out.skipped.map((s) => [s.nodeId, s.reason]), [['n_plan', 'running']]);
    assert.equal(run.orch.getState().status, 'running', 'the switch never pauses the run');
    const saved = readPipelineForResume(id);
    assert.equal(cellOf(JSON.parse(saved.row.stepper), 'n_impl').model, OPUS);
    assert.equal(cellOf(saved.resumePoint.manifest, 'n_impl').model, OPUS, 'the persisted point carries it');
    assert.ok(getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id)
      .some((e) => /Models switched.* on the running run: .*claude-opus-5-5/.test(e.text)), 'audited');
    await assert.rejects(run.orch.switchModels({ n_nope: { model: OPUS } }), (e) => e.code === 'UNKNOWN_STAGE' && e.status === 400);
  } finally { run.release(); }
  const res = await run.done;
  assert.equal(res.status, 'done', res.error);
  const impl = run.spawns.find((s) => s.nodeId === 'n_impl');
  assert.deepEqual([impl.model, impl.effort, impl.subagentModel], [OPUS, 'high', 'opus']);
  // The skipped running stage: spawned once (before the switch) and its cell was never rewritten.
  assert.equal(run.spawns.filter((s) => s.nodeId === 'n_plan').length, 1);
  assert.notEqual(cellOf(JSON.parse(readPipelineForResume(id).row.stepper), 'n_plan').model, 'claude-sonnet-5-5',
    'a skipped running stage is not rewritten');
});

test('running: a finished one-way stage is skipped as completed (nothing changed, nothing audited)', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-done', { holdAt: (ctx) => ctx.executionId === 'x:n_impl:1' });
  try {
    await run.held;   // n_plan finished (one-way: no wire leads back to it)
    const id = run.orch.getState().id;
    const out = await run.orch.switchModels({ n_plan: { model: OPUS } });
    assert.deepEqual(out.skipped.map((s) => [s.nodeId, s.reason]), [['n_plan', 'completed']]);
    assert.deepEqual(out.changed, []);
    assert.ok(!getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id)
      .some((e) => /Models switched/.test(e.text)), 'nothing changed → no audit line');
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
});

test('a loop stage that ran is switchable while its partner runs; its next cycle uses the new model', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-loop', { holdAt: (ctx) => ctx.executionId === 'x:n_impl:2', rejectReviewOnce: true });
  try {
    await run.held;   // Implement cycle 2 is running; Review cycle 1 is done (it rejected)
    const out = await run.orch.switchModels({ n_review: { model: OPUS, effort: 'high' } });
    assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_review']);
    assert.equal(out.stages.find((s) => s.nodeId === 'n_review').state, 'may-rerun');
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
  const reviews = run.spawns.filter((s) => s.nodeId === 'n_review');
  assert.equal(reviews.length, 2);
  assert.notEqual(reviews[0].model, OPUS);
  assert.deepEqual([reviews[1].model, reviews[1].effort], [OPUS, 'high']);
  // Each execution's row keeps the selection it started with (the Agents tab labels cycles from it):
  // cycle 1 is not relabelled by the switch. '' = the node inherited the default.
  const id = run.orch.getState().id;
  for (const steps of [run.orch.getState().steps, readPipelineForResume(id).steps]) {
    const row = (key) => steps.find((s) => s.key === key);
    assert.deepEqual([row('x:n_review:1').model, row('x:n_review:1').effort], [reviews[0].model ?? '', reviews[0].effort ?? '']);
    assert.deepEqual([row('x:n_review:2').model, row('x:n_review:2').effort], [OPUS, 'high']);
  }
});

test('a loop waiting at its cycle-cap gate is still going: its stages switch and "another cycle" runs them on it', { timeout: 120000 }, async () => {
  // Review blocks 3 times: w9's allowance (maxCycles 3 - 1) is used up and the run asks the user.
  const run = heldRun('msw-live-gate', { rejectReviews: 3, opts: { auto: false } });
  const gate = await Promise.race([
    new Promise((r) => run.orch.on('question', (q) => { if (q.kind === 'gate') r(q); })),
    run.done.then((r) => { throw new Error(`the run settled before the gate: ${JSON.stringify(r)}`); }),
  ]);
  assert.equal(gate.wireId, 'w9');
  const snap = run.orch.modelSwitchSnapshot();
  assert.deepEqual([snap.held, snap.active], [['w9'], []], 'every loop row is done and nothing runs');
  const out = await run.orch.switchModels({ n_impl: { model: OPUS }, n_review: { model: OPUS, effort: 'high' }, n_refine: { model: OPUS } });
  assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_impl', 'n_review']);
  assert.deepEqual(out.skipped.map((s) => [s.nodeId, s.reason]), [['n_refine', 'completed']], 'a hold opens only its own loop');
  assert.equal(out.stages.find((s) => s.nodeId === 'n_review').state, 'may-rerun');
  assert.equal(run.orch.answer(gate.id, { decision: 'another' }), true);
  assert.equal((await run.done).status, 'done');
  const spawn = (executionId) => run.spawns.find((s) => s.executionId === executionId);
  assert.notEqual(spawn('x:n_impl:3').model, OPUS);
  assert.equal(spawn('x:n_impl:4').model, OPUS);
  assert.deepEqual([spawn('x:n_review:4').model, spawn('x:n_review:4').effort], [OPUS, 'high']);
  assert.deepEqual(run.orch.modelSwitchSnapshot().held, [], 'the answer released the hold');
});

test('a run driven elsewhere: its row carries the cycle-cap hold, also after a resume back into it', { timeout: 120000 }, async () => {
  const gateOf = (r) => Promise.race([
    new Promise((res) => r.orch.on('question', (q) => { if (q.kind === 'gate') res(q); })),
    r.done.then((x) => { throw new Error(`the run settled before the gate: ${JSON.stringify(x)}`); }),
  ]);
  // describeModelSwitch without `live` = what the server reads for a run another process drives.
  const loopStates = async (id, dir) => (await describeModelSwitch(id, { projectDirFor: () => dir })).stages
    .filter((s) => s.nodeId === 'n_impl' || s.nodeId === 'n_review').map((s) => s.state);
  const run = heldRun('msw-live-gate-row', { rejectReviews: 3, opts: { auto: false } });
  await gateOf(run);
  const id = run.orch.getState().id;
  const dir = run.orch.projectDir;
  assert.deepEqual(await loopStates(id, dir), ['may-rerun', 'may-rerun'], 'the hold reached the row');
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  assert.deepEqual(heldWireIds(readPipelineForResume(id).resumePoint.snapshot), ['w9'], 'the paused point keeps the hold');
  const again = heldRun('msw-live-gate-row', { rejectReviews: 3, opts: { auto: false, resume: readPipelineForResume(id), projectDir: dir } });
  const gate = await gateOf(again);   // reattach re-asks the hold
  assert.deepEqual(await loopStates(id, dir), ['may-rerun', 'may-rerun'], 'the resume put the hold back on the row');
  again.orch.answer(gate.id, { decision: 'continue' });
  assert.equal((await again.done).status, 'done');
});

test('refused once a pause is requested; pause -> resume keeps the switched model', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-pause', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  await run.orch.switchModels({ n_impl: { model: OPUS, effort: 'high' } });
  run.orch.pause();
  await assert.rejects(run.orch.switchModels({ n_impl: { model: 'claude-sonnet-5-5' } }), (e) => e.code === 'NOT_RUNNING' && e.status === 409);
  assert.equal((await run.done).status, 'paused');
  const rp = readPipelineForResume(id).resumePoint;
  assert.equal(cellOf(rp.manifest, 'n_impl').model, OPUS);
  assert.equal(rp.freshSessionNodes, undefined, 'n_impl never ran paused: no fresh-session marker');
  const again = heldRun('msw-live-pause', { opts: { resume: readPipelineForResume(id), projectDir: run.orch.projectDir } });
  assert.equal((await again.done).status, 'done');
  const impl = again.spawns.find((s) => s.nodeId === 'n_impl');
  assert.deepEqual([impl.model, impl.effort], [OPUS, 'high']);
  assert.equal(again.spawns.find((s) => s.executionId === 'x:n_plan:1').resume, 'sess-x:n_plan:1',
    'the paused (unswitched) planner still re-attaches its session');
});

test('session hygiene: a paused execution not re-fired since a resume starts fresh when its MODEL switches', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-fresh', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  try {
    await run.held;
    const orch = run.orch;
    // What a resume leaves behind when a killed execution could not re-fire in the first drain pass
    // (pool full / a flow card first): a paused row with its session + the pending re-attach
    // (_restoreFromResumePoint's map). Row shape: _execStep's.
    const now = new Date().toISOString();
    const parked = (nodeId, sessionId) => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, kind: 'cycle',
      ordinal: 1, cycle: 1, status: 'paused', sessionId, startedAt: now, updatedAt: now, endedAt: now });
    orch.state.steps.push(parked('n_impl', 'sess-impl-old'), parked('n_review', 'sess-rev'));
    orch._resumeSessions = new Map([['x:n_impl:1', 'sess-impl-old'], ['x:n_review:1', 'sess-rev']]);
    const out = await orch.switchModels({ n_impl: { model: OPUS }, n_review: { subagentEffort: 'high' } });
    assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_impl', 'n_review']);
    assert.equal(orch._resumeSessions.has('x:n_impl:1'), false, 'model changed → no old-model re-attach');
    assert.equal(orch._resumeSessions.get('x:n_review:1'), 'sess-rev', 'sub-agent effort only → the session is kept');
    assert.deepEqual(orch.state.resumePoint.freshSessionNodes, ['n_impl'], 'a crash or pause before it re-fires keeps it fresh');
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
  const impl = run.spawns.find((s) => s.executionId === 'x:n_impl:1');
  assert.deepEqual([impl.model, impl.resume], [OPUS, null]);
  assert.equal(run.spawns.find((s) => s.executionId === 'x:n_review:1').resume, 'sess-rev');
  assert.equal(run.orch._freshSessionNodes.size, 0, 'cleared once its execution started');
  // The recording runner emits no 'session' event for an unheld execution, so the rows show exactly what
  // _execute left: the switched node's re-entered row no longer offers its old-model session to a later
  // resume; the unswitched one keeps its (re-attached) id.
  const rowOf = (key) => run.orch.state.steps.find((s) => s.key === key);
  assert.equal(rowOf('x:n_impl:1').sessionId, null, 'the old-model session id left the re-entered row');
  assert.equal(rowOf('x:n_review:1').sessionId, 'sess-rev');
});

test('session hygiene: the first execution of a switched composite node to start drops the old-model session of every paused slice', { timeout: 120000 }, async () => {
  // What a pause or crash right after the marker is consumed would persist: the paused n_impl rows a resume
  // would re-offer (_restoreFromResumePoint keys its map on paused rows with a session id) and the point.
  let atReview = null;
  const run = heldRun('msw-live-slices', { holdAt: (ctx) => {
    if (ctx.executionId === 'x:n_review:1' && !atReview) {
      atReview = {
        offered: run.orch.state.steps.filter((s) => s.nodeId === 'n_impl' && s.status === 'paused' && s.sessionId).map((s) => s.key),
        fresh: run.orch._buildResumePoint(null).freshSessionNodes,
      };
    }
    return ctx.executionId === 'x:n_plan:1';
  } });
  try {
    await run.held;
    const orch = run.orch;
    // A fan-out the pause caught mid-way: x:n_impl:1 re-fires first; its sibling slice still waits on the
    // agent pool (it never re-fires in wf_default). Row shape: _execStep's slice row.
    const now = new Date().toISOString();
    const parked = (key, sessionId, extra = {}) => ({ key, executionId: key, nodeId: 'n_impl', kind: 'cycle',
      ordinal: 1, cycle: 1, status: 'paused', sessionId, startedAt: now, updatedAt: now, endedAt: now, ...extra });
    orch.state.steps.push(parked('x:n_impl:1', 'sess-impl-old'),
      parked('x:n_impl:1:p1t2', 'sess-slice-old', { kind: 'task', taskId: 'p1t2', parentExecutionId: 'x:n_impl:1' }));
    orch._resumeSessions = new Map([['x:n_impl:1', 'sess-impl-old'], ['x:n_impl:1:p1t2', 'sess-slice-old']]);
    const out = await orch.switchModels({ n_impl: { model: OPUS } });
    assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_impl']);
    assert.equal(orch._resumeSessions.size, 0, 'neither old-model session is re-attached');
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
  assert.ok(atReview, 'n_review ran after n_impl started');
  assert.equal(atReview.fresh, undefined, 'the marker was consumed when x:n_impl:1 started');
  assert.deepEqual(atReview.offered, [], 'no paused slice still offers its old-model session to a later resume');
  assert.equal(run.orch.state.steps.find((s) => s.key === 'x:n_impl:1:p1t2').sessionId, null);
  assert.deepEqual(run.spawns.filter((s) => s.nodeId === 'n_impl').map((s) => [s.model, s.resume]), [[OPUS, null]]);
});

test('a run that resolved no MCP servers records no tool-name limit, so a switch never advises re-resolving them', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-mcp', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  try {
    await run.held;
    // switchModels warns only when `_mcpToolNameLimit` is set and the switched models need less.
    assert.equal(run.orch._mcpToolNameLimit, null);
  } finally { run.release(); }
  assert.equal((await run.done).status, 'done');
});

test('a resume keeps a paused switch\'s fresh-session marker until the node starts', { timeout: 120000 }, async () => {
  const run = heldRun('msw-live-seed', { holdAt: (ctx) => ctx.executionId === 'x:n_plan:1' });
  await run.held;
  const id = run.orch.getState().id;
  const dir = run.orch.projectDir;
  run.orch.pause();
  assert.equal((await run.done).status, 'paused');
  // The paused path marks every stage whose MODEL changed (switchPausedRunModels → rp.freshSessionNodes).
  await switchPausedRunModels(id, { changes: { n_impl: { model: OPUS } }, projectDirFor: () => dir });
  assert.deepEqual(readPipelineForResume(id).resumePoint.freshSessionNodes, ['n_impl']);
  // The point a pause or crash would persist while n_impl runs, the marker just consumed.
  let savedWhileImpl = 'unset';
  const again = heldRun('msw-live-seed', { holdAt: (ctx) => {
    if (ctx.executionId === 'x:n_impl:1') savedWhileImpl = again.orch.state.resumePoint?.freshSessionNodes;
    return ctx.executionId === 'x:n_plan:1';
  }, opts: { resume: readPipelineForResume(id), projectDir: dir } });
  try {
    await again.held;   // the planner re-fired (it re-attaches: n_plan is not marked); n_impl has not started
    assert.deepEqual([...again.orch._freshSessionNodes], ['n_impl'], 'seeded from rp.freshSessionNodes');
    assert.deepEqual(again.orch._buildResumePoint(null).freshSessionNodes, ['n_impl'], 'a crash or pause now keeps it fresh');
  } finally { again.release(); }
  assert.equal((await again.done).status, 'done');
  assert.equal(again.orch._freshSessionNodes.size, 0, 'cleared when n_impl started');
  assert.equal(savedWhileImpl, undefined, 'the saved point dropped the consumed marker at once');
  assert.equal(again.spawns.find((s) => s.nodeId === 'n_impl').model, OPUS);
});
