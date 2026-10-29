// test/session-trace-reduce.test.mjs — the session view is a fold over the trace; incremental equals batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTraceRecord, emptySummary, reduceTrace, turnRows, sessionHistory } from '../src/core/session-trace.mjs';
import { sessionAuditLine, sessionHostEvent } from '../src/core/session-trace.mjs';

const SID = 's_k3f9a2b1';
let seq = 0;
const R = (kind, f) => ({ v: 1, ts: `2026-10-28T10:00:${String(seq).padStart(2, '0')}.000Z`, seq: ++seq, kind, runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H1', ...f });
const RECS = [
  R('open', { hostSessionId: null, engine: 'claude', mode: 'subagents', transport: 'turns', hostModel: null, hostEffort: 'low', members: ['n_impl', 'n_review'], label: 'Build' }),
  R('mode', { hostSessionId: null, mode: 'subagents', requested: 'subagents', reason: 'ok', engine: 'claude', transport: 'turns' }),
  R('turn_start', { turnId: `t:${SID}:1`, resume: false, maxTurns: 4, maxBudgetUsd: null, hostModel: null, hostEffort: 'low' }),
  R('dispatch', { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', attempt: 1, agentType: 'worca-x-n_impl-1-a1', cold: false, queueMs: 0 }),
  R('member_bound', { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', memberAgentId: 'T1' }),
  R('member_done', { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', memberAgentId: 'T1', memberTranscriptId: 'ag-1', tokens: { in: 5000, out: 700, cr: 0, cw: 0 }, resolvedModel: 'claude-opus-5-5', durationMs: 61000, isError: false }),
  R('turn_end', { turnId: `t:${SID}:1`, cumulativeUsd: 0.5, deltaUsd: 0.5, hostUsage: { in: 1000, out: 20, cr: 0, cw: 0 }, hostModel: 'claude-haiku-4-5', numTurns: 3, durationMs: 64000, exit: 'ok' }),
  R('cost', { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', memberUsd: 0.375, hostOverheadUsd: 0.125, costSource: 'harness', hostPriced: true }),
  R('reconcile', { turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', ok: false, checks: [{ method: 'estimate', harnessUsd: 0.375, otherUsd: 0.6, tolerance: 0.05625, ok: false }] }),
  R('verdict', { dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', verdict: 'none', issues: 0 }),
  R('rotate', { reason: 'dispatches', fromSessionId: 'H1', fromEpoch: 1, dispatches: 24, contextTokens: 1000, epochCheck: { epoch: 1, harnessTotalUsd: 0.5, bookedUsd: 0.5, tolerance: 0.01, ok: true } }),
];

test('reduceTrace builds the §6.4 summary; hostModel is the resolved one', () => {
  const s = reduceTrace(RECS);
  assert.deepEqual(s, { sid: SID, label: 'Build', mode: 'subagents', modeReason: 'ok', engine: 'claude', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1',
    hostModel: 'claude-haiku-4-5', status: 'idle', turns: 1, dispatches: 1, rotations: 1, restarts: 0, costUsd: 0.5, hostOverheadUsd: 0.125,
    startedAt: RECS[0].ts, endedAt: null, lastTurnAt: RECS[6].ts, reconciled: false, members: ['n_impl', 'n_review'] });
});

test('incremental fold equals batch', () => {
  let s = emptySummary({ sid: SID, label: 'Build', members: ['n_impl', 'n_review'] });
  for (const r of RECS) s = applyTraceRecord(s, r);
  assert.deepEqual(s, reduceTrace(RECS));
});

test('turnRows joins dispatch, member, cost, reconcile and verdict per turn', () => {
  assert.deepEqual(turnRows(RECS), [{ turnId: `t:${SID}:1`, dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', attempt: 1, memberAgentId: 'T1', memberTranscriptId: 'ag-1',
    startedAt: RECS[2].ts, durationMs: 64000, tokens: { in: 5000, out: 700, cr: 0, cw: 0 }, memberUsd: 0.375, hostOverheadUsd: 0.125, costSource: 'harness', carriedUsd: 0,
    isError: false, verdict: 'none', issues: 0, reconcileOk: false, watchdog: null }]);
  assert.deepEqual(sessionHistory(RECS).map((h) => [h.kind, h.reason]), [['rotate', 'dispatches']]);
});

test('M-5/C9 — a carried booking lands on the cut turn\'s row; the current turn shows what it carried', () => {
  const T = (n) => `t:${SID}:${n}`;
  const recs = [RECS[0],
    R('turn_start', { turnId: T(2) }), R('dispatch', { turnId: T(2), dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', attempt: 1 }),
    R('turn_end', { turnId: T(2), exit: 'aborted' }),
    R('turn_start', { turnId: T(3) }), R('dispatch', { turnId: T(3), dispatchId: 'd:x:n_review:1:a1', executionId: 'x:n_review:1', nodeId: 'n_review', attempt: 1 }),
    R('turn_end', { turnId: T(3), deltaUsd: 0.5, exit: 'ok' }),
    R('cost', { turnId: T(2), dispatchId: 'd:x:n_impl:1:a1', executionId: 'x:n_impl:1', nodeId: 'n_impl', memberUsd: 0.07, hostOverheadUsd: 0, costSource: 'harness', carriedBy: T(3) }),
    R('cost', { turnId: T(3), dispatchId: 'd:x:n_review:1:a1', executionId: 'x:n_review:1', nodeId: 'n_review', memberUsd: 0.42, hostOverheadUsd: 0.01, costSource: 'harness' })];
  const rows = turnRows(recs);
  assert.deepEqual(rows.map((r) => [r.turnId, r.nodeId, r.memberUsd, r.carriedUsd]), [[T(2), 'n_impl', 0.07, 0], [T(3), 'n_review', 0.42, 0.07]]);
  assert.equal(new Set(rows.map((r) => r.turnId)).size, rows.length);
  assert.ok(Math.abs(reduceTrace(recs).costUsd - 0.5) < 1e-12);
});

test('no priced booking: cost stays null (blank, never 0); an engine switch updates engine', () => {
  const s = reduceTrace([RECS[0], R('cost', { turnId: 't', dispatchId: 'd', executionId: 'x', nodeId: 'n', memberUsd: null, hostOverheadUsd: null, costSource: 'none' })]);
  assert.equal(s.costUsd, null);
  assert.equal(s.hostOverheadUsd, null);
  assert.equal(reduceTrace([RECS[0], R('restart', { reason: 'engine-switch', fromSessionId: 'H1', engine: 'codex', transport: 'turns' })]).engine, 'codex');
});
test('audit lines are pinned; a warn-level watchdog is a log line only; the event carries the §6.4 shape', () => {
  const summary = { sid: SID, label: 'One session', engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1', members: ['n_a', 'n_b'] };
  assert.equal(sessionAuditLine(R('open', { engine: 'claude', mode: 'subagents', members: ['n_a', 'n_b'], label: 'One session' }), summary),
    `Session ${SID} "One session" (Claude, sub-agents): opened for 2 steps.`);
  assert.equal(sessionAuditLine(R('degrade', { from: 'subagents', to: 'separate', reason: 'the main agent did not dispatch' }), summary),
    `Session ${SID}: runs as separate sessions — the main agent did not dispatch.`);
  assert.equal(sessionAuditLine(R('watchdog', { dispatchId: 'd:x:n_a:1:a1', code: 'SESSION_HOST_NO_DISPATCH', level: 'error' }), summary),
    `Session ${SID}: dispatch d:x:n_a:1:a1 failed — SESSION_HOST_NO_DISPATCH.`);
  assert.equal(sessionAuditLine(R('watchdog', { code: 'model-mismatch', level: 'warn' }), summary), null);
  assert.equal(sessionAuditLine(R('reconcile', { turnId: 't:1', ok: false, checks: [{ method: 'estimate', harnessUsd: 0.5, otherUsd: 0.7, tolerance: 0.075, ok: false }] }), summary),
    `Session ${SID}: cost reconcile mismatch on t:1 — harness $0.5000 vs estimate $0.7000 (the harness figure is booked).`);
  assert.equal(sessionAuditLine(R('cost', {}), summary), null);
  const ev = sessionHostEvent(R('cost', { turnId: 't:1', dispatchId: 'd', executionId: 'x:n_a:1', nodeId: 'n_a', memberUsd: 0.4, hostOverheadUsd: 0.01, costSource: 'harness' }), summary);
  assert.deepEqual([ev.transition, ev.costUsd, ev.hostOverheadUsd, ev.costSource, ev.engine], ['cost', 0.4, 0.01, 'harness', 'claude']);
});

// ── v2: each Summary rule, TurnRow field, history kind and audit line on its own ──
import { checkRows } from './helpers/rows.mjs';

test('v2 — Summary rules', async () => {
  const open = RECS[0];
  const fold = (...recs) => reduceTrace([open, ...recs]);
  await checkRows([
    { name: 'status per kind', run: () => {
      assert.equal(reduceTrace([open]).status, 'cold');
      assert.equal(fold(R('turn_start', { turnId: 't' })).status, 'busy');
      assert.equal(fold(R('degrade', { from: 'subagents', to: 'separate', reason: 'x' })).status, 'separate');
      assert.equal(fold(R('pause', { reason: 'manual' })).status, 'paused');
      assert.equal(fold(R('pause', { reason: 'manual' }), R('resume', { after: 'pause' })).status, 'idle');
      assert.equal(fold(R('close', { status: 'done' })).status, 'done');
    } },
    { name: 'degrade sets mode and reason', run: () => {
      const s = fold(RECS[1], R('degrade', { from: 'subagents', to: 'separate', reason: 'the main agent did not dispatch' }));
      assert.deepEqual([s.mode, s.modeReason], ['separate', 'the main agent did not dispatch']);
    } },
    { name: 'engine and transport from mode', run: () => {
      const s = fold(R('mode', { mode: 'subagents', requested: 'subagents', reason: 'ok', engine: 'codex', transport: 't2' }));
      assert.deepEqual([s.engine, s.transport], ['codex', 't2']);
    } },
    { name: 'hostModel: open\'s until a turn_end resolves it; a null one keeps it', run: () => {
      assert.equal(reduceTrace([R('open', { members: [], label: 'L', hostModel: 'claude-sonnet-4-5' })]).hostModel, 'claude-sonnet-4-5');
      assert.equal(fold(R('turn_end', { turnId: 't', hostModel: 'claude-haiku-4-5' }), R('turn_end', { turnId: 't2', hostModel: null })).hostModel, 'claude-haiku-4-5');
      assert.equal(fold(R('turn_end', { turnId: 't', hostModel: 'claude-haiku-4-5' }), R('open', { members: [], label: 'L', hostModel: 'claude-sonnet-4-5' })).hostModel, 'claude-haiku-4-5', 'an open never replaces a resolved model');
    } },
    { name: 'hostEpoch is the max; hostSessionId the latest non-null', run: () => {
      const s = fold(R('turn_start', { turnId: 't', hostEpoch: 2, hostSessionId: 'H2' }), R('pause', { hostEpoch: 1, hostSessionId: null, reason: 'x' }));
      assert.deepEqual([s.hostEpoch, s.hostSessionId], [2, 'H2']);
    } },
    { name: 'counts and times', run: () => {
      const s = fold(R('turn_start', { turnId: 't' }), R('dispatch', { turnId: 't' }), R('restart', { reason: 'vanished', fromSessionId: 'H1' }), R('close', { status: 'done' }));
      assert.deepEqual([s.turns, s.dispatches, s.restarts, s.rotations, s.startedAt], [1, 1, 1, 0, open.ts]);
      assert.equal(typeof s.endedAt, 'string');
    } },
    { name: 'reconciled turns false on a failed epoch check (rotate, restart, close)', run: () => {
      const bad = { epoch: 1, harnessTotalUsd: 1, bookedUsd: 0, tolerance: 0.02, ok: false };
      assert.equal(fold(R('rotate', { reason: 'x', epochCheck: bad })).reconciled, false);
      assert.equal(fold(R('restart', { reason: 'x', epochCheck: bad })).reconciled, false);
      assert.equal(fold(R('close', { status: 'done', epochChecks: [{ ...bad, ok: true }, bad] })).reconciled, false);
      assert.equal(fold(R('close', { status: 'done', epochChecks: [{ ...bad, ok: true }] })).reconciled, true);
    } },
    { name: 'a priced member with an unknown host overhead keeps the overhead blank', run: () => {
      const s = fold(R('cost', { turnId: 't', memberUsd: 0.2, hostOverheadUsd: null, costSource: 'estimate' }));
      assert.deepEqual([s.costUsd, s.hostOverheadUsd], [0.2, null]);
    } },
  ]);
});

test('v2 — turnRows: watchdog, reconcile, verdict join and the cut-turn rows', () => {
  const T = `t:${SID}:9`;
  const rows = turnRows([RECS[0],
    R('turn_start', { turnId: T }), R('dispatch', { turnId: T, dispatchId: 'd9', executionId: 'x:n_b:1', nodeId: 'n_b', attempt: 2 }),
    R('watchdog', { turnId: T, dispatchId: 'd9', code: 'model-mismatch', level: 'warn' }),
    R('watchdog', { turnId: T, dispatchId: 'd9', code: 'SESSION_HOST_NO_DISPATCH', level: 'error' }),
    R('watchdog', { turnId: T, dispatchId: 'd9', code: 'late-warn', level: 'warn' }),
    R('member_done', { turnId: T, dispatchId: 'd9', memberAgentId: 'T9', memberTranscriptId: 'ag-9', tokens: { in: 1, out: 2, cr: 0, cw: 0 }, isError: true }),
    R('reconcile', { turnId: T, dispatchId: 'd9', ok: true, checks: [] }),
    R('pause', { turnId: 't:other', reason: 'manual' }),
    R('verdict', { dispatchId: 'd9', executionId: 'x:n_b:1', nodeId: 'n_b', verdict: 'blocking', issues: 3 }),
    R('verdict', { dispatchId: 'unknown', verdict: 'clean', issues: 0 })]);
  assert.equal(rows.length, 1, 'a pause and an unknown verdict make no row');
  const [r] = rows;
  assert.deepEqual(r.watchdog, { code: 'SESSION_HOST_NO_DISPATCH', level: 'error' });
  assert.deepEqual([r.attempt, r.memberAgentId, r.memberTranscriptId, r.isError, r.reconcileOk, r.verdict, r.issues, r.memberUsd, r.costSource],
    [2, 'T9', 'ag-9', true, true, 'blocking', 3, null, null]);
  assert.deepEqual(turnRows([R('watchdog', { turnId: 'w', code: 'model-mismatch', level: 'warn' })])[0].watchdog, { code: 'model-mismatch', level: 'warn' });
  const two = turnRows([R('cost', { turnId: 'c', memberUsd: 0.25, hostOverheadUsd: 0.01, costSource: 'harness' }), R('cost', { turnId: 'c', memberUsd: 0.5, hostOverheadUsd: null, costSource: 'estimate' })]);
  assert.deepEqual([two[0].memberUsd, two[0].hostOverheadUsd, two[0].costSource], [0.75, 0.01, 'estimate'], 'two bookings on one turn add up (C31 says there is one)');
});

test('v2 — sessionHistory names every kind it lists; a resume\'s reason is its "after"', () => {
  const h = sessionHistory([RECS[0], R('degrade', { to: 'separate', reason: 'd' }), R('restart', { reason: 'vanished' }), R('pause', { reason: 'manual' }),
    R('resume', { after: 'pause' }), R('cost', {}), R('rotate', { reason: 'context' })]);
  assert.deepEqual(h.map((x) => [x.kind, x.reason, x.hostEpoch, x.hostSessionId]),
    [['degrade', 'd', 1, 'H1'], ['restart', 'vanished', 1, 'H1'], ['pause', 'manual', 1, 'H1'], ['resume', 'pause', 1, 'H1'], ['rotate', 'context', 1, 'H1']]);
  assert.equal(typeof h[0].ts, 'string');
});

test('v2 — the other pinned audit lines, and the event fields', async () => {
  const summary = { sid: SID, label: 'One session', engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1', members: ['n_a', 'n_b'] };
  await checkRows([
    { name: 'open in shared mode', run: () => assert.equal(sessionAuditLine(R('open', { engine: 'codex', mode: 'shared', members: ['n_a', 'n_b', 'n_c'], label: 'Build' }), summary),
      `Session ${SID} "Build" (Codex, one conversation): opened for 3 steps.`) },
    { name: 'rotate', run: () => assert.equal(sessionAuditLine(R('rotate', { reason: 'dispatches', fromEpoch: 2 }), summary), `Session ${SID}: rotated to a fresh host session (dispatches; epoch 3).`) },
    { name: 'restart', run: () => assert.equal(sessionAuditLine(R('restart', { reason: 'vanished' }), summary), `Session ${SID}: restarted fresh (vanished).`) },
    { name: 'resume', run: () => assert.equal(sessionAuditLine(R('resume', { hostSessionId: 'H7', after: 'crash' }), summary), `Session ${SID}: resumed host session H7 after crash.`) },
    { name: 'close', run: () => {
      assert.equal(sessionAuditLine(R('close', { status: 'done', turns: 3, dispatches: 4, costUsd: 1.23456, rotations: 1, restarts: 0, reconciled: true }), summary),
        `Session ${SID}: closed — 3 turns, 4 dispatches, $1.2346, 1 rotations, 0 restarts, reconciled yes.`);
      assert.equal(sessionAuditLine(R('close', { status: 'done', turns: 1, dispatches: 1, costUsd: null, rotations: 0, restarts: 0, reconciled: false }), summary),
        `Session ${SID}: closed — 1 turns, 1 dispatches, cost unknown, 0 rotations, 0 restarts, reconciled no.`);
    } },
    { name: 'a reconcile that is ok, a mode record and a dispatch add no line', run: () => {
      assert.equal(sessionAuditLine(R('reconcile', { ok: true, checks: [] }), summary), null);
      assert.equal(sessionAuditLine(RECS[1], summary), null);
      assert.equal(sessionAuditLine(RECS[3], summary), null);
    } },
    { name: 'event: close costs, a watchdog code as reason, only the record\'s own keys, the summary\'s ids', run: () => {
      const close = sessionHostEvent(R('close', { status: 'done', costUsd: 2, hostOverheadUsd: 0.1 }), { ...summary, hostSessionId: 'H9', hostEpoch: 3 });
      assert.deepEqual([close.transition, close.costUsd, close.hostOverheadUsd, close.hostSessionId, close.hostEpoch, close.mode, close.transport], ['close', 2, 0.1, 'H9', 3, 'subagents', 'turns']);
      assert.equal('turnId' in close, false);
      const w = sessionHostEvent(R('watchdog', { turnId: 't', dispatchId: 'd', code: 'SESSION_HOST_STRAY_TOOL', level: 'error' }), summary);
      assert.deepEqual([w.reason, w.turnId, w.dispatchId, w.sid, w.costUsd], ['SESSION_HOST_STRAY_TOOL', 't', 'd', SID, undefined]);
      assert.equal(sessionHostEvent(R('degrade', { reason: 'r' }), summary).reason, 'r');
    } },
  ]);
});

// ── v3: the order rules (first open, latest turn_end and close, first watchdog), member_bound, a cost-only row, the line fallbacks ──
test('v3 — Summary times, the watchdog order, member_bound, a cost-only row, the audit-line fallbacks and the verdict join', () => {
  const open2 = R('open', { members: [], label: 'L' });
  const te1 = R('turn_end', { turnId: 'a' }); const te2 = R('turn_end', { turnId: 'b' });
  const c1 = R('close', { status: 'done' }); const c2 = R('close', { status: 'failed' });
  const s = reduceTrace([RECS[0], open2, te1, te2, c1, c2]);
  assert.deepEqual([s.startedAt, s.lastTurnAt, s.endedAt, s.status], [RECS[0].ts, te2.ts, c2.ts, 'failed']);
  assert.equal(reduceTrace([RECS[0], { ...RECS[1], sid: 's_zzzzzzzz' }]).sid, SID, 'the sid is the first record\'s');
  const w = (turnId, code, level) => R('watchdog', { turnId, code, level });
  const rows = turnRows([w('w1', 'warn-a', 'warn'), w('w1', 'warn-b', 'warn'), w('w2', 'err-a', 'error'), w('w2', 'err-b', 'error'),
    R('member_bound', { turnId: 'm', dispatchId: 'dm', memberAgentId: 'T7' }),
    R('cost', { turnId: 'c', dispatchId: 'dc', executionId: 'x:n_c:1', nodeId: 'n_c', memberUsd: 0.1, hostOverheadUsd: 0, costSource: 'harness' })]);
  assert.deepEqual(rows.map((r) => [r.turnId, r.watchdog?.code ?? null, r.memberAgentId, r.executionId, r.nodeId]),
    [['w1', 'warn-a', null, null, null], ['w2', 'err-a', null, null, null], ['m', null, 'T7', null, null], ['c', null, null, 'x:n_c:1', 'n_c']]);
  const summary = { sid: SID, label: 'One session', engine: 'codex', mode: 'subagents', members: ['n_a', 'n_b'] };
  assert.equal(sessionAuditLine(R('open', {}), summary), `Session ${SID} "One session" (Codex, sub-agents): opened for 2 steps.`);
  assert.equal(sessionAuditLine(R('rotate', { reason: 'context' }), summary), `Session ${SID}: rotated to a fresh host session (context; epoch 2).`);
  assert.equal(sessionAuditLine(R('reconcile', { turnId: 't:2', ok: false, checks: [
    { method: 'hook', harnessUsd: 0.5, otherUsd: 0.5, tolerance: 0.01, ok: true },
    { method: 'estimate', harnessUsd: 0.5, otherUsd: 0.9, tolerance: 0.075, ok: false }] }), summary),
    `Session ${SID}: cost reconcile mismatch on t:2 — harness $0.5000 vs estimate $0.9000 (the harness figure is booked).`);
  const vr = turnRows([R('dispatch', { turnId: 'v1', dispatchId: 'da1', executionId: 'x:n_v:1', nodeId: 'n_v', attempt: 1 }),
    R('dispatch', { turnId: 'v2', dispatchId: 'da2', executionId: 'x:n_v:1', nodeId: 'n_v', attempt: 2 }),
    R('verdict', { executionId: 'x:n_v:1', nodeId: 'n_v', verdict: 'clean', issues: 0 }),
    R('verdict', { dispatchId: 'da1', executionId: 'x:n_v:1', verdict: 'blocking', issues: 2 })]);
  assert.deepEqual(vr.map((r) => [r.turnId, r.verdict, r.issues]), [['v1', 'blocking', 2], ['v2', 'clean', 0]], 'a verdict joins by dispatchId, else the execution\'s latest dispatch');
});

// ── v4: the defaults, the open and mode folds, a host-only booking, purity, every event key, the separate words, the resume fallback ──
test('v4 — the defaults, open and mode fill the summary, a host-only booking counts, the fold is pure, every event key and the last audit fallbacks', () => {
  assert.deepEqual(emptySummary({ sid: SID }), { sid: SID, label: null, mode: null, modeReason: null, engine: null, transport: null, hostEpoch: 0, hostSessionId: null,
    hostModel: null, status: 'cold', turns: 0, dispatches: 0, rotations: 0, restarts: 0, costUsd: null, hostOverheadUsd: null,
    startedAt: null, endedAt: null, lastTurnAt: null, reconciled: true, members: [] });
  assert.deepEqual(reduceTrace([RECS[0]]), { ...emptySummary({ sid: SID }), label: 'Build', mode: 'subagents', engine: 'claude', transport: 'turns', hostEpoch: 1,
    startedAt: RECS[0].ts, members: ['n_impl', 'n_review'] }, 'the open record alone');
  const fold = (...recs) => reduceTrace([RECS[0], ...recs]);
  const m = fold(R('mode', { hostSessionId: null, mode: 'separate', requested: 'subagents', reason: 'the Labs flag sessionGroups is off', engine: 'claude', transport: 'turns' }));
  assert.deepEqual([m.mode, m.modeReason], ['separate', 'the Labs flag sessionGroups is off'], 'the mode record is the decision');
  assert.equal(fold(R('restart', { reason: 'engine-switch', fromSessionId: 'H1', engine: 'codex', transport: 't2' })).transport, 't2');
  const h = fold(R('cost', { turnId: 't', dispatchId: 'd', memberUsd: null, hostOverheadUsd: 0.01, costSource: 'estimate' }));
  assert.deepEqual([h.costUsd, h.hostOverheadUsd], [0.01, 0.01], 'a booking with only the overhead priced makes the cost a number');
  const before = emptySummary({ sid: SID });
  const snap = JSON.stringify(before);
  const next = applyTraceRecord(before, R('turn_start', { turnId: 't' }));
  assert.notEqual(next, before);
  assert.equal(JSON.stringify(before), snap, 'the input summary is not changed');
  const summary = { sid: SID, label: 'One session', engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H1', members: ['n_a', 'n_b'] };
  const d = R('dispatch', { turnId: 't:1', dispatchId: 'd:x:n_a:1:a2', executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 2, agentType: 'worca-x-n_a-1-a2', cold: true, queueMs: 5 });
  assert.deepEqual(sessionHostEvent(d, summary), { sid: SID, transition: 'dispatch', hostSessionId: 'H1', hostEpoch: 1, engine: 'claude', mode: 'subagents', transport: 'turns',
    ts: d.ts, turnId: 't:1', dispatchId: 'd:x:n_a:1:a2', executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 2, reason: undefined }, 'every §6.4 key, and nothing else the record has');
  assert.equal(sessionHostEvent(R('member_bound', { turnId: 't:1', dispatchId: 'd', memberAgentId: 'T1' }), summary).memberAgentId, 'T1');
  assert.equal(sessionAuditLine(R('open', { engine: 'claude', mode: 'separate', members: ['n_a', 'n_b'], label: 'Build' }), summary),
    `Session ${SID} "Build" (Claude, separate sessions): opened for 2 steps.`);
  assert.equal(sessionAuditLine(R('open', { engine: 'claude', mode: 'later-mode', members: ['n_a', 'n_b'], label: 'Build' }), summary),
    `Session ${SID} "Build" (Claude, later-mode): opened for 2 steps.`, 'a mode with no words prints as itself');
  assert.equal(sessionAuditLine(R('resume', { hostSessionId: null, after: 'crash' }), summary), `Session ${SID}: resumed host session H1 after crash.`);
});

test('v4 — a new epoch drops the old host id until its own init; an older epoch never brings it back; a fold from nothing takes the trace\'s sid', () => {
  const rot = reduceTrace([...RECS, R('turn_start', { hostEpoch: 2, hostSessionId: null, turnId: `t:${SID}:2`, resume: false })]);
  assert.deepEqual([rot.hostEpoch, rot.hostSessionId], [2, null], 'Task 47 restores the id belonging to the epoch: none yet');
  const bound = applyTraceRecord(rot, R('member_bound', { hostEpoch: 2, hostSessionId: 'H2', turnId: `t:${SID}:2`, dispatchId: 'd2', memberAgentId: 'T2' }));
  assert.equal(bound.hostSessionId, 'H2');
  assert.equal(applyTraceRecord(bound, R('pause', { hostEpoch: 1, hostSessionId: 'H1', reason: 'x' })).hostSessionId, 'H2', 'an older epoch\'s id never comes back');
  assert.equal(applyTraceRecord(bound, R('pause', { hostEpoch: null, hostSessionId: 'H3', reason: 'x' })).hostSessionId, 'H3', 'a record with no epoch still names the host');
  assert.equal(reduceTrace([]).sid, null);
  assert.equal(applyTraceRecord(emptySummary(), RECS[0]).sid, SID);
  assert.equal(applyTraceRecord(emptySummary({ sid: 's_bbbbbbbb' }), RECS[0]).sid, 's_bbbbbbbb', 'a known sid is kept');
});

// ── v5: a fourth sweep (refine cycle 4): the summary read after EACH record, the same-epoch id, a null record, sparse records ──
test('v5 — the live summary after each record: every kind moves only its own status, counters, times, mode and reconciled', () => {
  let n = 0;
  const at = (kind, f = {}) => ({ v: 1, ts: `2026-10-28T11:00:${String(++n).padStart(2, '0')}.000Z`, seq: n, kind, runId: 'p1', sid: SID, hostEpoch: 1, hostSessionId: 'H1', ...f });
  const T = `t:${SID}:1`;
  const recs = [
    at('open', { engine: 'claude', mode: 'subagents', transport: 'turns', members: ['n_a', 'n_b'], label: 'L' }),
    at('mode', { mode: 'subagents', requested: 'subagents', reason: 'ok', engine: 'claude', transport: 'turns' }),
    at('turn_start', { turnId: T }),
    at('dispatch', { turnId: T, dispatchId: 'd1', executionId: 'x:n_a:1', nodeId: 'n_a', attempt: 1 }),
    at('member_bound', { turnId: T, dispatchId: 'd1', memberAgentId: 'T1' }),
    at('member_done', { turnId: T, dispatchId: 'd1', memberAgentId: 'T1', durationMs: 5, isError: false }),
    at('turn_end', { turnId: T, durationMs: 9, hostModel: 'claude-haiku-4-5', exit: 'ok' }),
    at('cost', { turnId: T, dispatchId: 'd1', memberUsd: 0.2, hostOverheadUsd: 0.1, costSource: 'harness' }),
    at('reconcile', { turnId: T, dispatchId: 'd1', ok: true, checks: [] }),
    at('watchdog', { turnId: T, dispatchId: 'd1', code: 'MODEL_MISMATCH', level: 'warn' }),
    at('verdict', { dispatchId: 'd1', executionId: 'x:n_a:1', verdict: 'none', issues: 0 }),
    at('pause', { reason: 'cost cap' }),
    at('resume', { after: 'pause' }),
    at('rotate', { reason: 'dispatches', fromEpoch: 1 }),
    at('restart', { reason: 'engine switch', engine: 'codex', transport: 'turns' }),
    at('degrade', { from: 'subagents', to: 'separate', reason: 'the main agent did not dispatch' }),
    at('close', { status: 'closed' }),
  ];
  let s = emptySummary({ sid: SID });
  const got = [];
  for (const rec of recs) {
    s = applyTraceRecord(s, rec);
    got.push([rec.kind, s.status, s.turns, s.dispatches, s.rotations, s.restarts, s.lastTurnAt, s.endedAt, s.mode, s.modeReason, s.reconciled]);
  }
  const ts = (i) => recs[i].ts;
  const D = 'the main agent did not dispatch';
  assert.deepEqual(got, [
    ['open', 'cold', 0, 0, 0, 0, null, null, 'subagents', null, true],
    ['mode', 'cold', 0, 0, 0, 0, null, null, 'subagents', 'ok', true],
    ['turn_start', 'busy', 1, 0, 0, 0, null, null, 'subagents', 'ok', true],
    ['dispatch', 'busy', 1, 1, 0, 0, null, null, 'subagents', 'ok', true],
    ['member_bound', 'busy', 1, 1, 0, 0, null, null, 'subagents', 'ok', true],
    ['member_done', 'busy', 1, 1, 0, 0, null, null, 'subagents', 'ok', true],
    ['turn_end', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['cost', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['reconcile', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['watchdog', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['verdict', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['pause', 'paused', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['resume', 'idle', 1, 1, 0, 0, ts(6), null, 'subagents', 'ok', true],
    ['rotate', 'idle', 1, 1, 1, 0, ts(6), null, 'subagents', 'ok', true],
    ['restart', 'idle', 1, 1, 1, 1, ts(6), null, 'subagents', 'ok', true],
    ['degrade', 'separate', 1, 1, 1, 1, ts(6), null, 'separate', D, true],
    ['close', 'closed', 1, 1, 1, 1, ts(6), ts(16), 'separate', D, true],
  ], 'an ok reconcile, and a rotate or restart with no epoch check, leave reconciled true');
  assert.equal(turnRows(recs.slice(0, 6))[0].durationMs, null, 'before turn_end the row shows no duration: the member\'s is not the turn\'s');
  assert.equal(turnRows([...recs, at('cost', { turnId: T, carriedBy: 't2', memberUsd: 0.01 })])[0].reconcileOk, true, 'a later booking on the row keeps its reconcile result');
  assert.deepEqual(sessionHistory(recs).map((h) => h.kind), ['pause', 'resume', 'rotate', 'restart', 'degrade'], 'close is not history');
  assert.deepEqual(recs.filter((r) => sessionAuditLine(r, s) !== null).map((r) => r.kind), ['open', 'resume', 'rotate', 'restart', 'degrade', 'close'],
    'every other kind (a warn watchdog and an ok reconcile included) adds no line');
  const v = turnRows([...recs.slice(0, 4), at('verdict', { dispatchId: 'd-other', executionId: 'x:n_a:1', verdict: 'blocking', issues: 2 })]);
  assert.deepEqual([v[0].verdict, v[0].issues], ['blocking', 2], 'a dispatchId no row knows falls back to the execution');
});

test('v5 — a same-epoch record without an id keeps the host id; a null record is a no-op; sparse records give null, never undefined; a resume with no host', () => {
  const H = (kind, f = {}) => ({ kind, sid: SID, ...f });
  const e1 = reduceTrace([H('turn_end', { hostEpoch: 1, hostSessionId: 'H1' }), H('verdict', { hostEpoch: 1, hostSessionId: null })]);
  assert.deepEqual([e1.hostEpoch, e1.hostSessionId], [1, 'H1'], 'only a record that RAISES the epoch resets the id');
  const raised = applyTraceRecord(emptySummary({ sid: SID }), H('turn_start', { hostEpoch: 2 }));
  assert.deepEqual([raised.hostEpoch, raised.hostSessionId], [2, null], 'a raising record with no host id key resets it to null');
  const base = reduceTrace(RECS);
  assert.deepEqual(applyTraceRecord(base, null), base, 'append() returns null when a record cannot be written; the live fold (C6) goes on');
  assert.deepEqual(turnRows([null, ...RECS, 'x']), turnRows(RECS));
  assert.deepEqual([sessionHostEvent(null, base), sessionAuditLine(null, base)], [null, null], 'so do the event and the audit line');
  const open = reduceTrace([H('open')]);
  assert.deepEqual([open.hostModel, open.startedAt], [null, null], 'an open with no hostModel and no ts leaves both null');
  assert.deepEqual(turnRows([H('turn_start', { turnId: 'T9' }), H('dispatch', { turnId: 'T9', dispatchId: 'd9' }), H('member_done', { turnId: 'T9' }),
    H('turn_end', { turnId: 'T9' }), H('watchdog', { turnId: 'T9' }), H('cost', { turnId: 'T9' }), H('verdict', { dispatchId: 'd9' })]), [{
    turnId: 'T9', dispatchId: 'd9', executionId: null, nodeId: null, attempt: null, memberAgentId: null, memberTranscriptId: null,
    startedAt: null, durationMs: null, tokens: null, memberUsd: null, hostOverheadUsd: null, costSource: null, carriedUsd: 0,
    isError: null, verdict: null, issues: null, reconcileOk: null, watchdog: { code: null, level: null } }]);
  assert.deepEqual(sessionHistory([H('pause')]), [{ kind: 'pause', ts: null, reason: null, hostEpoch: null, hostSessionId: null }]);
  assert.equal(sessionHistory([H('degrade', { hostEpoch: 0 })])[0].hostEpoch, 0, 'epoch 0 is kept');
  assert.equal(turnRows([H('turn_end', { turnId: 'T8', durationMs: 0 })])[0].durationMs, 0, 'a 0 ms turn shows 0, not blank');
  const ev = sessionHostEvent(H('pause', { ts: 'T' }), {});
  assert.deepEqual([ev.hostSessionId, ev.hostEpoch, ev.engine, ev.mode, ev.transport], [null, null, null, null, null]);
  assert.equal(sessionHostEvent(H('open', { hostEpoch: null }), emptySummary()).hostEpoch, 0, 'the summary\'s epoch: 0 before the first host session');
  assert.equal(sessionAuditLine(H('resume', { hostSessionId: null, after: 'crash' }), emptySummary({ sid: SID })), `Session ${SID}: resumed after crash.`,
    'a session with no host yet (paused before its first init, or separate) never prints "host session null"');
});
