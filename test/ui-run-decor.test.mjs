// test/ui-run-decor.test.mjs
// P6a — the pure run-decor reducer: state tables in, one decor bag out. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorFromState, statusOf, fmtDur, fmtUsd, manifestAgents, execBandLayout, QUIESCENCE_WARNING } from '../ui/public/graph/run-decor.mjs';

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

// ── executions footer / totals / ants / badges / gate ───────────────────────
const impl = (n, over = {}) => step({ executionId: `x:n_impl:${n}`, nodeId: 'n_impl', ordinal: n, ...over });

test('footer rows label a loop-port re-fire "cycle N · <port>" and a plain re-fire "cycle N"', () => {
  const st = S({ steps: [
    impl(1, { status: 'done', trigger: { wireIds: ['w1'], freshPorts: ['plan'] } }),
    impl(2, { status: 'done', trigger: { wireIds: ['w3'], freshPorts: ['fix'] } }),
  ] });
  const rows = decorFromState(st).footers.n_impl.rows;
  assert.deepEqual(rows.map((r) => r.label), ['cycle 1', 'cycle 2 · fix']);
  assert.deepEqual(rows.map((r) => r.executionId), ['x:n_impl:1', 'x:n_impl:2']);
  assert.equal(rows[1].kind, 'cycle');
});

test('a kind:"task" row is labelled by its title and truncated at 40 chars', () => {
  const long = 'Add the schema migration and every single backfill step';
  const st = S({ steps: [impl(1, { kind: 'task', title: long, status: 'done' })] });
  const row = decorFromState(st).footers.n_impl.rows[0];
  assert.equal(row.kind, 'task');
  assert.equal(row.label.length, 40);
  assert.ok(row.label.endsWith('…'));
});

test('flow rows carry neither a duration nor a cost and no header totals; an agent that ran keeps a truthful $0.00', () => {
  const st = S({ status: 'done', endReached: true, result: { type: 'void' }, steps: [
    step({ executionId: 'x:n_end:1', nodeId: 'n_end', status: 'done', costUsd: 0.55, activeMs: 3 }),
    impl(1, { status: 'done', costUsd: 0 }),
  ] });
  const d = decorFromState(st);
  assert.equal(d.footers.n_end.rows[0].cost, '', 'a flow row has no cost pill');
  assert.equal(d.footers.n_end.rows[0].dur, '', 'a flow execution is instant — no duration either');
  assert.equal(d.footers.n_end.rows[0].costUsd, 0, 'the NUMBER is zeroed too, not just the pill text');
  assert.equal(d.footers.n_end.rows[0].durMs, 0, 'and so is durMs — the row carries activeMs 3, but a flow execution took no time');
  assert.equal(d.footers.n_end.rows[0].flow, true);
  assert.equal(d.totals.n_end, undefined, 'no header dur · cost on a flow card');
  assert.equal(d.footers.n_impl.rows[0].cost, '$0.00', 'an agent that ran shows $0.00');
  assert.equal(d.totals.n_impl.cost, '$0.00');
});

test('the collapsed summary reads "N runs · $X" and drops the cost when it is zero', () => {
  const paid = S({ steps: [impl(1, { costUsd: 0.6 }), impl(2, { costUsd: 0.52 })] });
  assert.equal(decorFromState(paid).footers.n_impl.summary, '2 runs · $1.12');
  const free = S({ steps: [impl(1, { costUsd: 0 })] });
  assert.equal(decorFromState(free).footers.n_impl.summary, '1 run');
});

test('header totals sum the node\'s rows — money rounded to cents past IEEE-754 drift', () => {
  const st = S({ steps: [impl(1, { activeMs: 63000, costUsd: 0.1 }), impl(2, { activeMs: 67000, costUsd: 0.32 })] });
  // 0.1 + 0.32 === 0.42000000000000004 in doubles; the bag carries 0.42.
  assert.deepEqual(decorFromState(st).totals.n_impl, { durMs: 130000, dur: '2m 10s', costUsd: 0.42, cost: '$0.42', hasStep: true });
});

test('the sub-agent fan rides the footer when subsOf supplies rows', () => {
  const st = S({ steps: [impl(1, {})] });
  const d = decorFromState(st, { subsOf: (id) => (id === 'n_impl' ? [{ status: 'running' }, { status: 'finished' }] : []) });
  assert.deepEqual(d.footers.n_impl.fan, { leds: ['run', 'done'], count: 2 });
  assert.equal(d.footers.n_plan, undefined, 'no rows and no subs → no footer at all');
});

test('ants light the trigger wires of ACTIVE executions and nothing on a resolved run', () => {
  const live = S({ steps: [impl(2, { status: 'start', trigger: { wireIds: ['w3'], freshPorts: ['fix'] } })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }] });
  assert.deepEqual(decorFromState(live).liveWireIds, ['w3']);
  assert.deepEqual(decorFromState({ ...live, status: 'done' }).liveWireIds, [], 'resolved runs never march');
  assert.deepEqual(decorFromState(live, { live: false }).liveWireIds, []);
  // An `active` entry whose own row is already terminal lights nothing (the row wins).
  const stale = S({ steps: [impl(2, { status: 'done', trigger: { wireIds: ['w3'], freshPorts: ['fix'] } })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }] });
  assert.deepEqual(decorFromState(stale).liveWireIds, [], 'a finished execution never marches');
});

test('a composite parent (no row of its own) marches on its slices\' trigger wires', () => {
  const st = S({
    steps: [step({ executionId: 'x:n_impl:1:p1t1', nodeId: 'n_impl', kind: 'task', title: 'Slice one', parentExecutionId: 'x:n_impl:1',
      status: 'start', trigger: { wireIds: ['w1'], freshPorts: ['plan'] } })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
  });
  assert.deepEqual(decorFromState(st).liveWireIds, ['w1'], 'the slice carries the parent\'s trigger verbatim');
});

test('an OR-valve re-fire marches on the VALVE\'s out wire while the badge sits on the LOOP wire', () => {
  // Through an OR valve the re-fire's trigger.wireIds names the valve's (non-loop)
  // out wire; wireDeliveries is keyed by LOOP wire ids only. Ants are never
  // restricted to loop wires; badges always are.
  const st = S({ steps: [impl(2, { status: 'start', trigger: { wireIds: ['w1'], freshPorts: ['fix'] } })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }], wireDeliveries: { w3: 1 } });
  const d = decorFromState(st);
  assert.deepEqual(d.liveWireIds, ['w1']);
  assert.deepEqual(Object.keys(d.loopBadges), ['w3']);
  assert.equal(d.footers.n_impl.rows[0].label, 'cycle 2 · fix');
});

test('loop badges come from wireDeliveries, on loop wires only', () => {
  const st = S({ wireDeliveries: { w1: 3, w3: 2 } });
  const badges = decorFromState(st).loopBadges;
  assert.deepEqual(Object.keys(badges), ['w3'], 'w1 is not a loop wire');
  assert.deepEqual(badges.w3, { n: 2, max: 3, text: '2×', title: '2 of 3 cycles' });
});

test('a loop wire with zero deliveries gets no badge, and maxCycles defaults to 3', () => {
  assert.deepEqual(decorFromState(S({ wireDeliveries: { w3: 0 } })).loopBadges, {}, 'never fired ⇒ no badge');
  const noMax = JSON.parse(JSON.stringify(MANIFEST));
  delete noMax.graph.wires[2].maxCycles;                       // w3 loses its explicit cap
  const badges = decorFromState(S({ stepper: noMax, wireDeliveries: { w3: 2 } })).loopBadges;
  assert.deepEqual(badges.w3, { n: 2, max: 3, text: '2×', title: '2 of 3 cycles' }, 'DEFAULT_MAX_CYCLES');
});

test('the gate pip lands on the wire\'s FROM node', () => {
  const st = S({ gate: { wireId: 'w3', fromNode: 'n_plan', toNode: 'n_impl', askId: 'gate-w3-3' } });
  assert.deepEqual(decorFromState(st).gate, { nodeId: 'n_plan', wireId: 'w3', askId: 'gate-w3-3' });
  assert.equal(decorFromState(S()).gate, null);
});

test("a row's led maps the wire word 'start' onto 'active'", () => {
  const st = S({ steps: [step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', status: 'start' })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }] });
  const f = decorFromState(st).footers.n_impl;
  assert.equal(f.rows[0].led, 'active');
  assert.deepEqual(f.leds, ['active']);
});

test('execBandLayout bills 1 line for a compact row, 2 with dur · cost stacked, 3 with a two-line label', () => {
  // The short-cycle common case shares one line.
  assert.deepEqual(execBandLayout('cycle 1', '43m 11s · $142.62'), { units: 1, stack: false, l2: false });
  // A loop re-fire label pushes dur · cost onto its own line.
  assert.deepEqual(execBandLayout('cycle 2 · revise', '20m 42s · $31.98'), { units: 2, stack: true, l2: false });
  // A fan-out slice title takes two clamped lines above the dur · cost line.
  assert.deepEqual(execBandLayout('Link FirebaseAI, plist setup + smoke tes…', '12m 28s · $1.45'), { units: 3, stack: true, l2: true });
  // A flow row has no dur · cost and always fits its one line.
  assert.deepEqual(execBandLayout('cycle 1', ''), { units: 1, stack: false, l2: false });
});
