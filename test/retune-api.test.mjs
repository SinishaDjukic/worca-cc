// test/retune-api.test.mjs
// POST /api/retune + the `state` pass-through that carries a retune to the
// browser. The orchestrator is a stub EventEmitter
// (test/server-title-broadcast.test.mjs): EVENT_NAMES is not exported, so
// forwarding is asserted BEHAVIOURALLY on the entry's ring buffer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs, _testing } from '../ui/server.mjs';
import { _resetForTests } from '../src/core/db.mjs';

let srv, base, home, prevHome;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-retune-api-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

/** A run entry whose orch is a bare EventEmitter carrying a stub retuneNode. */
function entryWith(id, retuneNode) {
  const orch = new EventEmitter();
  if (retuneNode) orch.retuneNode = retuneNode;
  const entry = { id, orch, projectDir: '/tmp/x', kind: 'run', title: 't', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
  runs.set(id, entry);
  return entry;
}
const post = (body) => fetch(`${base}/api/retune`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('happy path: 200 with the applied selection', async () => {
  const calls = [];
  entryWith('r-ok', async (nodeId, sel) => { calls.push([nodeId, sel]); return { nodeId, ...sel }; });
  const res = await post({ runId: 'r-ok', nodeId: 'n_impl', model: 'claude-opus-5', effort: 'high' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, nodeId: 'n_impl', model: 'claude-opus-5', effort: 'high' });
  assert.deepEqual(calls, [['n_impl', { model: 'claude-opus-5', effort: 'high' }]]);
  runs.delete('r-ok');
});

test('400 on a missing/unknown runId and a missing nodeId', async () => {
  assert.equal((await post({ nodeId: 'n_impl' })).status, 400);
  assert.equal((await post({ runId: 'nope', nodeId: 'n_impl' })).status, 400);
  entryWith('r-400', async () => ({}));
  const res = await post({ runId: 'r-400', nodeId: '' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /nodeId is required/);
  runs.delete('r-400');
});

test('an absent or mistyped model is refused, never read as a clear', async () => {
  const calls = [];
  entryWith('r-type', async (nodeId, sel) => { calls.push([nodeId, sel]); return { nodeId, ...sel }; });
  // retuneNode normalizes anything that is not a string to '' — which CLEARS the
  // node to inherit. A caller meaning "change only the effort", or a client that
  // dropped a field, must never be answered 200 having destroyed the authored
  // value. The chat router refuses the same shape for the same reason.
  for (const body of [{}, { model: null }, { model: 123 }, { model: {} }, { effort: 'high' }]) {
    const res = await post({ runId: 'r-type', nodeId: 'n_impl', ...body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} is a bad request`);
    assert.match((await res.json()).error, /model is required/);
  }
  assert.deepEqual(calls, [], 'the engine is never reached');
  // A mistyped EFFORT is refused on its own terms; absent still means "reset to
  // the model's default", the same reading `/retune <node> <model>` has.
  for (const body of [{ effort: 7 }, { effort: ['high'] }]) {
    const res = await post({ runId: 'r-type', nodeId: 'n_impl', model: '', ...body });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /effort must be a string/);
  }
  // '' IS the deliberate clear — what the popover posts.
  assert.equal((await post({ runId: 'r-type', nodeId: 'n_impl', model: '', effort: null })).status, 200);
  assert.equal((await post({ runId: 'r-type', nodeId: 'n_impl', model: '' })).status, 200);
  runs.delete('r-type');
});

test('every RETUNE_ERROR_CODES refusal maps to 400 with the engine message', async () => {
  for (const code of ['UNKNOWN_NODE', 'NOT_AGENT', 'NODE_BUSY', 'RUN_NOT_RETUNABLE', 'BAD_SELECTION']) {
    entryWith('r-code', async () => { throw Object.assign(new Error(`refused: ${code}`), { code }); });
    const res = await post({ runId: 'r-code', nodeId: 'n_impl', model: 'claude-opus-5' });
    assert.equal(res.status, 400, code);
    assert.equal((await res.json()).error, `refused: ${code}`, code);
    runs.delete('r-code');
  }
});

test('an untagged throw is a 500; a non-run entry is a 400 RUN_NOT_RETUNABLE', async () => {
  entryWith('r-boom', async () => { throw new Error('kaboom'); });
  assert.equal((await post({ runId: 'r-boom', nodeId: 'n_impl', model: '' })).status, 500);
  runs.delete('r-boom');
  // A workspace-scan entry (`scan_<uuid>`, workspace-scan.mjs:91) shares the runs
  // Map and has no retuneNode.
  entryWith('scan_r-scan', null);
  const res = await post({ runId: 'scan_r-scan', nodeId: 'n_impl', model: '' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /does not support live retuning/);
  runs.delete('scan_r-scan');
});

test("a retune reaches the browser on the ordinary 'state' frame, not a type of its own", () => {
  const entry = entryWith('uuid-R1', async () => ({}));
  try {
    _testing.wireRun(entry);
    const tuned = { model: 'claude-opus-5', effort: 'high' };
    entry.orch.emit('state', {
      status: 'running',
      stepper: {
        version: 2,
        graph: { nodes: [{ id: 'n_impl', kind: 'agent', ...tuned }] },
        steps: [{ nodes: [{ id: 'n_impl', ...tuned }] }],
      },
    });
    const frames = entry.events.filter((e) => e.type === 'state');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].runId, 'uuid-R1', 'bufferEvent stamps the Map key last (ui/server.mjs:488-489)');
    assert.deepEqual(frames[0].stepper.graph.nodes[0], { id: 'n_impl', kind: 'agent', ...tuned });
    assert.deepEqual(frames[0].stepper.steps[0].nodes[0], { id: 'n_impl', ...tuned },
      "the v1 shim's mirror of the same two values travels with it");
    assert.equal(entry.status, 'running', 'a retune must not change run status');

    // There is no dedicated retune event type: EVENT_NAMES does not carry one,
    // so nothing subscribes to it and emitting it forwards nothing.
    entry.orch.emit('noderetune', { nodeId: 'n_impl', ...tuned });
    assert.equal(entry.events.filter((e) => e.type === 'noderetune').length, 0);
  } finally { runs.delete(entry.id); }
});

test('a SUPERSEDED paused entry is refused: its persist would clobber the live row', async () => {
  const calls = [];
  const old = entryWith('r-old', async (nodeId, sel) => { calls.push([nodeId, sel]); return { nodeId, ...sel }; });
  old.pipelineId = 'p-1';
  old.status = 'paused';
  // resumeRun reuses the SAME pipeline id and evicts the paused lineage only AFTER
  // registering the new run. retuneNode ends in _persist(), and writeState UPSERTs
  // the pipelines row then DELETEs and re-inserts every pipeline_steps row for that
  // id — so a retune landing in that window writes the paused entry's stale status,
  // stepper, resume point and ledger over the live one.
  const live = entryWith('r-new', async () => ({}));
  live.pipelineId = 'p-1';
  live.status = 'running';

  const res = await post({ runId: 'r-old', nodeId: 'n_impl', model: 'claude-opus-5' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /has been resumed/);
  assert.deepEqual(calls, [], 'the engine is never reached, so nothing is written');

  // Once the run that took over has FINISHED it is not taking over any more, and
  // the paused entry is retunable again (it can still be resumed).
  live.status = 'done';
  assert.equal((await post({ runId: 'r-old', nodeId: 'n_impl', model: 'claude-opus-5' })).status, 200);
  runs.delete('r-old');
  runs.delete('r-new');
});

test('a PARKED sibling does not supersede: only a run that actually took over does', async () => {
  const entry = entryWith('r-live', async (nodeId, sel) => ({ nodeId, ...sel }));
  entry.pipelineId = 'p-3';
  entry.status = 'running';
  // resumeRun's eviction deletes the 'paused' OR 'interrupted' lineage, so those
  // are what GET superseded — they can never be the thing doing the superseding.
  // Leaving 'interrupted' out of the set let a lingering entry refuse the LIVE
  // run's own retune.
  for (const status of ['paused', 'interrupted', 'done', 'stopped', 'error']) {
    const parked = entryWith('r-parked', async () => ({}));
    parked.pipelineId = 'p-3';
    parked.status = status;
    assert.equal((await post({ runId: 'r-live', nodeId: 'n_impl', model: 'claude-opus-5' })).status, 200, status);
    runs.delete('r-parked');
  }
  runs.delete('r-live');
});

test('the supersede check is re-asked AFTER the catalog await, not just before it', async () => {
  const entry = entryWith('r-old', async (nodeId, sel, opts) => {
    // Stand in for retuneNode's own shape: it awaits the model catalog before it
    // writes, and resumeRun can register the taking-over entry during that await.
    // The engine re-asks the caller's guard on the synchronous path right before
    // it persists — the only moment that matters, since that is the write that
    // would land on the shared pipeline row.
    const live = entryWith('r-new', async () => ({}));
    live.pipelineId = 'p-9';
    live.status = 'running';
    opts.guard();
    return { nodeId, ...sel };
  });
  entry.pipelineId = 'p-9';
  entry.status = 'paused';
  const res = await post({ runId: 'r-old', nodeId: 'n_impl', model: 'claude-opus-5' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /has been resumed/);
  runs.delete('r-old');
  runs.delete('r-new');
});

test('a resume that has CLAIMED the pipeline blocks the retune before its entry exists', async () => {
  const calls = [];
  const entry = entryWith('r-claim', async (nodeId, sel) => { calls.push([nodeId, sel]); return { nodeId, ...sel }; });
  entry.pipelineId = 'p-claim';
  entry.status = 'paused';
  // resumeRun reads the resume point and then awaits cost caps, the project lookup
  // and createOrchestratorFor before registering the taking-over entry. A retune in
  // that window is written by the OLD orchestrator, reported as saved, and then
  // overwritten by the resume restoring the point it had already read — with no
  // error anywhere. `runs` cannot express it: the new entry does not exist yet.
  _testing.RESUMING.add('p-claim');
  try {
    const res = await post({ runId: 'r-claim', nodeId: 'n_impl', model: 'claude-opus-5' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /has been resumed/);
    assert.deepEqual(calls, [], 'nothing was written');
  } finally { _testing.RESUMING.delete('p-claim'); }
  // The claim lifts when the resume finishes.
  assert.equal((await post({ runId: 'r-claim', nodeId: 'n_impl', model: 'claude-opus-5' })).status, 200);
  runs.delete('r-claim');
});

test('a paused entry with no live sibling is still retunable', async () => {
  const entry = entryWith('r-solo', async (nodeId, sel) => ({ nodeId, ...sel }));
  entry.pipelineId = 'p-2';
  entry.status = 'paused';
  assert.equal((await post({ runId: 'r-solo', nodeId: 'n_impl', model: 'claude-opus-5' })).status, 200);
  runs.delete('r-solo');
});

test('chatActions.retune is the SAME implementation the route calls', async () => {
  const calls = [];
  entryWith('r-chat', async (nodeId, sel) => { calls.push([nodeId, sel]); return { nodeId, ...sel }; });
  const out = await _testing.chatActions.retune('r-chat', 'n_plan', { model: 'claude-sonnet-5', effort: '' });
  assert.deepEqual(out, { nodeId: 'n_plan', model: 'claude-sonnet-5', effort: '' });
  assert.deepEqual(calls, [['n_plan', { model: 'claude-sonnet-5', effort: '' }]]);
  runs.delete('r-chat');
});

test("the unknown-runId arm is a RUN_NOT_RETUNABLE refusal, not a crash", async () => {
  // Unreachable through the route (it pre-checks runs.has), so chatActions is the
  // only caller that can lose the eviction race the arm exists for. A lost race
  // deserves the same 400 the pre-check would have given.
  await assert.rejects(() => _testing.chatActions.retune('r-evicted', 'n_plan', { model: '', effort: '' }),
    (err) => err.code === 'RUN_NOT_RETUNABLE' && /unknown runId/.test(err.message));
});
