// test/run-telemetry-host.test.mjs — with Run telemetry on, each host turn adds one compact record.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTelemetryRecorder, TELEMETRY_FILE } from '../src/core/telemetry/recorder.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

test('host() writes one record with ctx = in + cr + cw', () => {
  const pushed = [];
  const rec = createTelemetryRecorder({ writer: { bind() {}, push: (e) => pushed.push(e), close: async () => {} }, now: () => 5, lag: false });
  rec.host({ step: 'x:n_impl:1', sid: 's_aaaaaaaa', turn: 3, in: 1000, cr: 200, cw: 0, out: 20, costUsd: 0.5, memberUsd: 0.49, durationMs: 64000 });
  assert.deepEqual(pushed.at(-1), { t: 'host', ts: 5, step: 'x:n_impl:1', sid: 's_aaaaaaaa', turn: 3, in: 1000, cr: 200, cw: 0, out: 20, ctx: 1200, costUsd: 0.5, memberUsd: 0.49, durationMs: 64000 });
});

// ── v2: the recorder's guards, the harness's join of a turn's records, and a real mock run ──
useTempHome(after);
const SID = 's_aaaaaaaa';
const sink = () => {
  const pushed = [];
  return { pushed, rec: createTelemetryRecorder({ writer: { bind() {}, push: (e) => pushed.push(e), close: async () => {} }, now: () => 7, lag: false }) };
};

test('v2 — host(): no step writes nothing; junk figures are 0 or null; a throwing writer never reaches the run', () => {
  const { pushed, rec } = sink();
  rec.host({ sid: SID, turn: 1, in: 5 });
  rec.host();
  assert.deepEqual(pushed, []);
  rec.host({ step: 'x:n_a:1', in: -3, cr: 'x', cw: 2.6, out: null, costUsd: NaN, memberUsd: '0.4', durationMs: Infinity });
  assert.deepEqual(pushed.at(-1), { t: 'host', ts: 7, step: 'x:n_a:1', sid: null, turn: null, in: 0, cr: 0, cw: 3, out: 0, ctx: 3, costUsd: null, memberUsd: null, durationMs: null });
  const bad = createTelemetryRecorder({ writer: { bind() {}, push: () => { throw new Error('disk full'); }, close: async () => {} }, now: () => 1, lag: false });
  assert.doesNotThrow(() => bad.host({ step: 'x:n_a:1' }));
});

const rec = (kind, f) => ({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind, runId: 'p', sid: SID, hostEpoch: 1, hostSessionId: 'H1', ...f });
const summary = { sid: SID, label: 'One session', engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1', turns: 1, dispatches: 1, rotations: 0, restarts: 0, members: ['n_a', 'n_b'] };
function unit() {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-host-telemetry'), claude: { mock: true } });
  o._persist = async () => {};
  o._sessionAudit = () => {};
  return o;
}

test('v2 — the harness joins a turn\'s dispatch, turn_end and first cost into one record; a cut turn\'s comes with its carry or estimate', () => {
  const o = unit();
  const { pushed, rec: r } = sink();
  o.telemetry = r;
  const T = `t:${SID}:3`;
  const feed = (kind, f) => o._onSessionRecord(SID, rec(kind, f), summary);
  feed('turn_start', { turnId: T, resume: true, maxTurns: 4 });
  feed('dispatch', { turnId: T, dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', nodeId: 'n_b', attempt: 1, agentType: 'worca-x-n_b-1-a1' });
  feed('member_bound', { turnId: T, dispatchId: 'd:x:n_b:1:a1', memberAgentId: 'T3' });
  feed('turn_end', { turnId: T, cumulativeUsd: 2.1, deltaUsd: 0.6, hostUsage: { in: 1000, out: 20, cr: 200, cw: 0 }, hostModel: 'claude-haiku-4-5', durationMs: 64000, exit: 'ok' });
  assert.deepEqual(pushed, [], 'nothing before the turn\'s own cost record');
  feed('cost', { turnId: `t:${SID}:2`, dispatchId: 'd:x:n_a:1:a1', executionId: 'x:n_a:1', nodeId: 'n_a', memberUsd: 0.1, hostOverheadUsd: 0, costSource: 'harness', carriedBy: T });
  feed('cost', { turnId: T, dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', nodeId: 'n_b', memberUsd: 0.49, hostOverheadUsd: 0.01, costSource: 'harness' });
  assert.deepEqual(pushed, [{ t: 'host', ts: 7, step: 'x:n_b:1', sid: SID, turn: 3, in: 1000, cr: 200, cw: 0, out: 20, ctx: 1200, costUsd: 0.5, memberUsd: 0.49, durationMs: 64000 }],
    'turn 2 was never seen by this harness (cut before a restart of the server): its carry writes none');
  feed('cost', { turnId: T, dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', nodeId: 'n_b', memberUsd: 0.49, hostOverheadUsd: 0.01 });
  assert.equal(pushed.length, 1, 'once per turn');
  const C = `t:${SID}:4`;
  feed('dispatch', { turnId: C, dispatchId: 'd:x:n_a:2:a1', executionId: 'x:n_a:2', nodeId: 'n_a', attempt: 1 });
  feed('cost', { turnId: C, executionId: 'x:n_a:2', nodeId: 'n_a', memberUsd: 0.2, hostOverheadUsd: 0, costSource: 'estimate', cut: true });
  assert.equal(pushed.length, 1, 'a turn with no turn_end here writes none');
  const K = `t:${SID}:6`;   // cut by a kill: its turn_end has no cost; the next turn carries its spend
  feed('dispatch', { turnId: K, executionId: 'x:n_a:4', nodeId: 'n_a', attempt: 1 });
  feed('turn_end', { turnId: K, hostUsage: { in: 300, out: 5, cr: 0, cw: 0 }, durationMs: 20000, exit: 'error' });
  assert.equal(pushed.length, 1);
  feed('cost', { turnId: K, executionId: 'x:n_a:4', nodeId: 'n_a', memberUsd: 0.1 + 0.2, hostOverheadUsd: null, costSource: 'harness', carriedBy: `t:${SID}:7` });
  assert.deepEqual(pushed.at(-1), { t: 'host', ts: 7, step: 'x:n_a:4', sid: SID, turn: 6, in: 300, cr: 0, cw: 0, out: 5, ctx: 300, costUsd: 0.3, memberUsd: 0.1 + 0.2, durationMs: 20000, cut: true },
    'a cut turn is recorded when its spend is booked (costUsd rounded)');
  const N = `t:${SID}:5`;
  feed('dispatch', { turnId: N, executionId: 'x:n_a:3', nodeId: 'n_a', attempt: 1 });
  feed('turn_end', { turnId: N, hostUsage: { in: 10, out: 1, cr: 0, cw: 0 }, durationMs: 900, exit: 'ok' });
  feed('cost', { turnId: N, executionId: 'x:n_a:3', nodeId: 'n_a', memberUsd: null, hostOverheadUsd: null, costSource: 'none' });
  assert.deepEqual(pushed.at(-1), { t: 'host', ts: 7, step: 'x:n_a:3', sid: SID, turn: 5, in: 10, cr: 0, cw: 0, out: 1, ctx: 10, costUsd: null, memberUsd: null, durationMs: 900 },
    'an engine without cost: blank, never $0');
  feed('close', { status: 'done' });
  assert.equal([...o._hostTurns.keys()].some((k) => k.startsWith(`t:${SID}:`)), false, 'close forgets the session\'s open turns');
});

test('v4 — a pause ends the session\'s host here: its open turns are forgotten (the resumed run has a new harness)', () => {
  const o = unit();
  const { pushed, rec: r } = sink();
  o.telemetry = r;
  const T = `t:${SID}:2`;
  const feed = (kind, f) => o._onSessionRecord(SID, rec(kind, f), summary);
  feed('dispatch', { turnId: T, executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 1 });
  feed('turn_end', { turnId: T, hostUsage: { in: 50, out: 2, cr: 0, cw: 0 }, durationMs: 300, exit: 'error' });
  o._onSessionRecord('s_bbbbbbbb', { ...rec('dispatch', { turnId: 't:s_bbbbbbbb:1', executionId: 'x:n_c:1' }), sid: 's_bbbbbbbb' }, { ...summary, sid: 's_bbbbbbbb' });
  feed('pause', { reason: 'pause', turnId: T, dispatchId: 'd:x:n_a:1:a1', cutTokens: 52 });
  assert.deepEqual([...o._hostTurns.keys()], ['t:s_bbbbbbbb:1'], 'only this session\'s turns go');
  assert.deepEqual(pushed, []);
});

test('v2 — Run telemetry off: no recorder, no record, no map', () => {
  const o = unit();
  assert.equal(o.telemetry, null);
  o._onSessionRecord(SID, rec('dispatch', { turnId: `t:${SID}:1`, executionId: 'x:n_a:1' }), summary);
  assert.equal(o._hostTurns, undefined);
});

test('v2 — a mock run with a session and Run telemetry on: one host record per booked turn, as the trace books them', async () => {
  process.env.WORCA_FLAGS = 'sessionGroups,runTelemetry';
  try {
    const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
    for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
    await writeGraphWorkflow({ ...t, id: 'wf_host_tel', name: 'Host telemetry' });
    const o = createOrchestrator({ projectDir: gitDir('host-telemetry'), workflowId: 'wf_host_tel', prompt: 'build it', auto: true, claude: { mock: true } });
    assert.equal((await o.run()).status, 'done');
    const st = o.getState();
    const host = readFileSync(join(st.pipelineDir, TELEMETRY_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.t === 'host');
    const { records } = await readTrace(tracePath(st.pipelineDir, SID));
    const ended = new Set(records.filter((x) => x.kind === 'turn_end').map((x) => x.turnId));
    const seen = new Set();
    const booked = records.filter((x) => x.kind === 'cost' && ended.has(x.turnId) && !seen.has(x.turnId) && seen.add(x.turnId));
    assert.ok(booked.length >= 2, 'both members ran inside the host');
    assert.deepEqual(host.map((h) => [h.step, h.turn]), booked.map((c) => [c.executionId, Number(c.turnId.split(':').pop())]), 'one per booked turn, in booking order');
    for (const h of host) assert.equal(h.sid, SID);
  } finally { delete process.env.WORCA_FLAGS; }
});
