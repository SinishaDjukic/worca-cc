// test/ui-run-decor.test.mjs
// P6a — the pure run-decor reducer: state tables in, one decor bag out. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorFromState, statusOf, fmtDur, fmtUsd, manifestAgents, QUIESCENCE_WARNING } from '../ui/public/graph/run-decor.mjs';

// ── fixture builders ────────────────────────────────────────────────────────
const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1),
  color: 'violet', ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true },
  ...over,
});
const end = (id = 'n_end') => ({ id, kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '',
  ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } });
const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', {
      ports: { inputs: [{ id: 'fix', type: 'md', loop: true }, { id: 'plan', type: 'md', loop: false }], outputs: [{ id: 'done', type: 'void', when: 'always' }], await: true },
    }), end()],
    wires: [
      { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'plan' }, loop: false },
      { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' }, loop: false },
      { id: 'w3', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: true, maxCycles: 3 },
    ],
  },
  bookends: { preflight: true, done: true },
};
// A ledger row as the graph engine writes it (`key === executionId`, `ordinal === cycle`).
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1,
  status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const S = (over = {}) => ({ stepper: MANIFEST, status: 'running', steps: [], active: [],
  endReached: false, result: null, warnings: [], wireDeliveries: {}, tokens: {}, gate: null, ...over });

// ── statuses ────────────────────────────────────────────────────────────────
test('a node with no ledger rows is pending on a live run and skipped on a done run', () => {
  assert.equal(decorFromState(S()).status.n_plan, 'pending');
  assert.equal(decorFromState(S({ status: 'done', endReached: true })).status.n_plan, 'skipped');
  assert.equal(decorFromState(S({ status: 'stopped' })).status.n_plan, 'pending', 'stopped runs keep never-fired nodes pending');
  assert.equal(decorFromState(S({ status: 'error' })).status.n_plan, 'pending');
});

test('End is skipped on a done run that never reached it (quiescence)', () => {
  const d = decorFromState(S({ status: 'done', endReached: false }));
  assert.equal(d.status.n_end, 'skipped');
  assert.equal(d.quiescent, true);
  assert.deepEqual(d.warnings, [QUIESCENCE_WARNING]);
});

test('the step row wins over the exec status for paused and stopped', () => {
  const st = S({ status: 'paused', steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused' })] });
  assert.equal(decorFromState(st).status.n_plan, 'paused');
  const st2 = S({ status: 'stopped', steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'stopped' })] });
  assert.equal(decorFromState(st2).status.n_plan, 'stopped');
});

test('error anywhere in a node\'s rows beats a later done', () => {
  const st = S({ status: 'error', steps: [
    step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'error' }),
    step({ executionId: 'x:n_plan:2', nodeId: 'n_plan', status: 'done' }),
  ] });
  assert.equal(decorFromState(st).status.n_plan, 'error');
});

test('membership in active wins FIRST — even before the node has a ledger row (the parent exec `start` lands before the row)', () => {
  // The scheduler names a node in `state.active` before `_execStep` writes its row.
  assert.equal(decorFromState(S({ active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }] })).status.n_plan, 'active');
  const rows = [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' })];
  assert.equal(decorFromState(S({ steps: rows, active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }] })).status.n_plan, 'active');
  assert.equal(decorFromState(S({ steps: rows })).status.n_plan, 'active', 'live run, no active list → still running');
  assert.equal(decorFromState(S({ steps: rows, status: 'done' })).status.n_plan, 'stopped');
});

test('an active entry whose OWN row is already terminal is ignored: the row wins (state precedes the scheduler sync)', () => {
  // `_execStep(ctx,'done')` emits the state snapshot BEFORE `_syncSchedulerState`
  // drops the execution from `active`, so one frame names a finished execution.
  const st = S({ active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }],
    steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done' })] });
  const d = decorFromState(st);
  assert.equal(d.status.n_plan, 'done');
  assert.deepEqual(d.activeNodes, [], 'and it is not an active node either');
});

test('statusOf is exported and takes (node, rows, ctx)', () => {
  assert.equal(statusOf({ id: 'n', kind: 'agent' }, [], { active: new Set(), stepByExec: new Map(), resolved: false, runStatus: 'running' }), 'pending');
});

test('paused, stopped and error runs are never quiescent (only a DONE run can drain without End)', () => {
  for (const status of ['paused', 'stopped', 'error']) {
    const d = decorFromState(S({ status, endReached: false }));
    assert.equal(d.quiescent, false, `${status} is not quiescence`);
    assert.deepEqual(d.warnings, [], `${status} pushes no warning`);
  }
});
// ── progress / active nodes / End chip / formatters ─────────────────────────
test('progress counts AGENT nodes only, done over total', () => {
  const st = S({ steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done' })] });
  assert.deepEqual(decorFromState(st).progress, { done: 1, total: 2 }, 'End is not an agent node');
});

test('activeNodes is most-recently-started first and carries label + colour', () => {
  const st = S({
    steps: [
      step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start', startedAt: '2026-08-26T10:00:00Z' }),
      step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', status: 'start', startedAt: '2026-08-26T10:00:05Z' }),
    ],
    active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }, { nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
  });
  const d = decorFromState(st);
  assert.equal(d.activeNodes.length, 2);
  assert.equal(d.activeNodes[0].nodeId, 'n_impl', 'newest first');
  assert.equal(d.activeNodes[0].label, 'Implementer');
  assert.equal(d.activeNodes[0].color, 'violet');
});

test('a composite (fan-out) parent has NO row of its own: its start time comes from its slices', () => {
  // `state.active` names the PARENT id (x:n_impl:1); the ledger holds only the
  // kind:'task' slices (parentExecutionId), so the fallback keeps the sort honest.
  const st = S({
    steps: [
      step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start', startedAt: '2026-08-26T10:00:00Z' }),
      step({ executionId: 'x:n_impl:1:p1t1', nodeId: 'n_impl', kind: 'task', title: 'Slice one', parentExecutionId: 'x:n_impl:1',
        status: 'start', startedAt: '2026-08-26T10:00:05Z' }),
    ],
    active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }, { nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
  });
  assert.deepEqual(decorFromState(st).activeNodes.map((a) => a.nodeId), ['n_impl', 'n_plan'], 'the slice started later');
});

test('the End chip links a path by basename and says "— completed" for a void result', () => {
  const done = { status: 'done', endReached: true,
    steps: [step({ executionId: 'x:n_end:1', nodeId: 'n_end', status: 'done', costUsd: 0 })] };
  const withPath = decorFromState(S({ ...done, result: { type: 'md', path: '/tmp/run/plan-review.md' } }));
  assert.deepEqual(withPath.endResult, { nodeId: 'n_end', path: '/tmp/run/plan-review.md', rel: 'plan-review.md', text: 'plan-review.md', kind: 'path' });
  const voidRes = decorFromState(S({ ...done, result: { type: 'void' } }));
  assert.equal(voidRes.endResult.kind, 'void');
  assert.equal(voidRes.endResult.text, '— completed');
  assert.equal(voidRes.endResult.path, null);
  assert.equal(decorFromState(S()).endResult, null, 'no chip until End binds');
  // A recorded result on a run that never bound End (endReached false) shows nothing.
  assert.equal(decorFromState(S({ status: 'done', endReached: false, result: { type: 'md', path: '/tmp/run/plan.md' } })).endResult, null,
    'a quiescent run carries no result chip');
});

test('executions and loopDeliveries exclude BOTH bookend shapes and count only loop wires', () => {
  // Today's bookends: run-harness `_bookend` -> `_recordStep(name, 0, …)` -> a row
  // `{ key:'preflight'|'done', phase, cycle:0 }` with NO nodeId and NO executionId.
  // P8's bookends: real executions keyed `x:preflight:1` / `x:done:1`.
  const st = S({
    status: 'done', endReached: true,
    steps: [
      { key: 'preflight', phase: 'preflight', cycle: 0, status: 'done', activeMs: 198, runningSince: null },
      step({ executionId: 'x:preflight:1', nodeId: 'preflight', status: 'done' }),
      step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'done' }),
      step({ executionId: 'x:done:1', nodeId: 'done', status: 'done' }),
      { key: 'done', phase: 'done', cycle: 0, status: 'done', activeMs: 0, runningSince: null },
    ],
    wireDeliveries: { w1: 4, w3: 2 },
  });
  const d = decorFromState(st);
  assert.equal(d.executions, 1, 'neither bookend shape is an execution');
  assert.equal(d.loopDeliveries, 2, 'only w3 is a loop wire');
});

test('formatters', () => {
  assert.equal(fmtDur(4200), '4s');
  assert.equal(fmtDur(130000), '2m 10s');
  assert.equal(fmtDur(3660000), '1h 1m');
  assert.equal(fmtDur(59600), '1m 0s', 'integer seconds FIRST — the same spelling as app.js fmtDuration');
  assert.equal(fmtUsd(0.42), '$0.42');
  assert.equal(fmtUsd(0.004), '<$0.01');
  assert.equal(fmtUsd(0), '$0.00');
});

test('manifestAgents builds the header registry from the manifest (History renders with the registry absent)', () => {
  assert.deepEqual(manifestAgents(MANIFEST), {
    planner: { displayName: 'Planner', color: 'violet', icon: '' },
    implementer: { displayName: 'Implementer', color: 'violet', icon: '' },
  });
  assert.deepEqual(manifestAgents(null), {});
});

test('quiescence needs an EXPLICIT endReached === false; an absent field is never bannered', () => {
  const explicit = decorFromState(S({ status: 'done', endReached: false }));
  assert.equal(explicit.quiescent, true);
  assert.deepEqual(explicit.warnings, [QUIESCENCE_WARNING]);
  const absent = decorFromState(S({ status: 'done', endReached: undefined }));
  assert.equal(absent.quiescent, false, 'makeRun seeds endReached: undefined — never bannered');
  assert.deepEqual(absent.warnings, []);
});
