// test/graph-scheduler.test.mjs
// scheduler.mjs is the single-owner dataflow loop of the v2 graph engine: the token
// store, the drain/launch walk over loops.launchOrder, per-wire loop budgets and
// their human gates, the OR valve's same-drain collapse, End completion (the
// recorded-not-routed drain) and the resume snapshot.
//
// Every execution — agent AND flow card — is routed through the injected `execute`,
// so the fake below answers flow calls too. The fixtures use CUSTOM agent keys and a
// hand-built portsFn: if any scheduler decision ever keys off a builtin agent name,
// these go red first.
//
// TIMING NOTE: the fake resolves synchronously-scripted results through
// `Promise.resolve(out).then(...)`. Two agents launched in ONE drain pass therefore
// complete in the SAME microtask batch, and the run loop settles both before its next
// pass — that is what "same drain" means in tests 6 and 22. A fake that resolves
// later (a deferred) lands in a LATER drain (test 7). Do not "simplify" the fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/core/graph/scheduler.mjs';
import { flowPorts } from '../src/shared/graph/ports.mjs';
import { AWAIT_PORT } from '../src/shared/graph/constants.mjs';

const BLOCKING = (title = 'boom') => ({ issues: [{ severity: 'critical', title }] });
const CLEAN = { issues: [{ severity: 'minor', title: 'nit' }] };
const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Per-ordinal script; the LAST entry repeats for every later execution. */
const byOrdinal = (...list) => (args) => list[Math.min(args.ordinal, list.length) - 1] ?? {};

/** Custom sidecar port shapes — no builtin key appears anywhere in this file. */
const AGENTS = {
  maker: {
    inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'out', type: 'md', when: 'always' }],
  },
  checker: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'check-cycle{cycle}.json' },
  },
  worker: {
    inputs: [
      { id: 'fix', type: 'md', required: false, loop: true },
      { id: 'task', type: 'json', required: false, expands: true },
      { id: 'plan', type: 'md', required: true },
    ],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
  polisher: {
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }, { id: 'revise', type: 'md', when: 'blocking' }],
    verdict: { filename: 'refine-cycle{cycle}.json' },
  },
  splitter: {
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'tasks', type: 'json', when: 'always' }],
  },
};

const portsFn = (node) => (node.kind === 'agent'
  ? {
    inputs: [...(AGENTS[node.key]?.inputs || []).map((p) => ({ ...p })), { ...AWAIT_PORT }],
    outputs: (AGENTS[node.key]?.outputs || []).map((p) => ({ ...p })),
    verdict: AGENTS[node.key]?.verdict,
  }
  : flowPorts(node));

const N = (id, kind, key, config = {}) => ({ id, kind, key, x: 0, y: 0, config });
const W = (id, from, to, config) => ({
  id,
  from: { node: from.split('.')[0], port: from.split('.')[1] },
  to: { node: to.split('.')[0], port: to.split('.')[1] },
  ...(config ? { config } : null),
});
const TPL = (nodes, wires) => ({ id: 'wf_t', name: 'T', version: 2, domain: 'coding', nodes, wires });

/**
 * Scripted fake `execute`: records every call IN CALL ORDER (the execution sequence
 * the pins are written against), tracks agent concurrency, and answers unscripted
 * calls with `{}`.
 */
function harness({ template, script = {}, maxParallel, onAsk, onGate }) {
  const events = []; const snapshots = []; const calls = []; const asks = []; const gates = [];
  let inFlight = 0; let maxInFlight = 0;

  const execute = (args) => {
    calls.push({
      nodeId: args.node.id, executionId: args.executionId, ordinal: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, signal: args.signal,
      composite: args.composite, phase: args.phase, phaseStatus: args.phaseStatus,
      kind: args.kind, slice: args.slice, taskIndex: args.taskIndex, taskTotal: args.taskTotal,
    });
    const isAgent = args.node.kind === 'agent' && !args.composite;
    if (isAgent) { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); }
    const release = () => { if (isAgent) inFlight -= 1; };
    const fn = script[args.node.id];
    let out;
    try { out = typeof fn === 'function' ? fn(args) : {}; } catch (err) { release(); throw err; }
    return Promise.resolve(out).then((v) => { release(); return v; }, (e) => { release(); throw e; });
  };

  const scheduler = createScheduler({
    template,
    portsFn,
    execute,
    maxParallel,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onSnapshot: (s) => snapshots.push(s),
    onAsk: onAsk || (async (a) => { asks.push(a); return a.kind === 'gate' ? 'continue' : []; }),
    onGate: onGate || ((g) => gates.push(g)),
  });

  return {
    scheduler, events, snapshots, calls, asks, gates,
    maxInFlight: () => maxInFlight,
    execEvents: () => events.filter((e) => e.name === 'exec'),
    tokenEvents: () => events.filter((e) => e.name === 'token'),
    execSeq: () => events.filter((e) => e.name === 'exec' && e.status === 'start')
      .map((e) => `${e.nodeId} c${e.ordinal}`),
    callsFor: (nodeId) => calls.filter((c) => c.nodeId === nodeId),
    last: () => snapshots[snapshots.length - 1],
  };
}

// ── fixtures (validation deliberately not run over these) ────────────────────

/** maker -> {worker, checker}; checker.review loops back into worker.fix; the
 *  clean side reaches End. One SCC ⇒ w5 is the only loop wire (w4 is always-sourced). */
const LOOP_TPL = TPL(
  [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_work', 'agent', 'worker'),
    N('n_check', 'agent', 'checker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_work.plan'),
    W('w3', 'n_make.out', 'n_check.plan'), W('w4', 'n_work.done', 'n_check.done'),
    W('w5', 'n_check.review', 'n_work.fix', { maxCycles: 3 }), W('w6', 'n_check.pass', 'n_end.result')],
);

/** Two makers -> an OR valve (payload) and an AND card (sequencing) -> one worker
 *  whose `plan` comes from the valve and whose `await` gate comes from the AND. */
const FLOW_TPL = TPL(
  [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_b', 'agent', 'maker'),
    N('n_and', 'and', null, { arity: 2 }), N('n_or', 'or', null, { arity: 2 }),
    N('n_sink', 'agent', 'worker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_task.task', 'n_b.task'),
    W('w3', 'n_a.out', 'n_or.in1'), W('w4', 'n_b.out', 'n_or.in2'), W('w5', 'n_or.out', 'n_sink.plan'),
    W('w6', 'n_a.out', 'n_and.in1'), W('w7', 'n_b.out', 'n_and.in2'), W('w8', 'n_and.out', 'n_sink.await'),
    W('w9', 'n_sink.done', 'n_end.result')],
);

const md = (p) => ({ outputs: { out: { path: p } } });

// ── 1. the core loop ─────────────────────────────────────────────────────────

test('1 linear + loop: blocking re-fires the consumer, clean reaches End', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r1.md' } } },
        { verdict: CLEAN, outputs: {} }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_make c1', 'n_work c1', 'n_check c1', 'n_work c2', 'n_check c2', 'n_end c1',
  ]);
  const st = h.scheduler.getState();
  assert.equal(st.endReached, true);
  assert.deepEqual(st.result, { type: 'void' });
  assert.deepEqual(st.warnings, []);
});

test('2 first execution waits for every wired non-loop input, the await port included', async () => {
  const gate = deferred();
  const h = harness({
    template: FLOW_TPL,
    script: { n_a: () => md('/p/a.md'), n_b: () => gate.promise.then(() => md('/p/b.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.deepEqual(h.callsFor('n_sink'), [], 'the worker has no await token yet');
  gate.resolve();
  assert.equal(await run, 'done');
  const sink = h.callsFor('n_sink');
  assert.equal(sink.length, 1);
  assert.equal(sink[0].bindings.plan.path, '/p/b.md', 'the OR bound the freshest payload');
  assert.equal(sink[0].bindings.await, undefined, 'the await payload is discarded at bind');
  assert.ok(!sink[0].trigger.freshPorts.includes('await'), 'await never appears in freshPorts');
});

test('3 re-execution binds latched values and names only the fresh port', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r1.md' } } }, { verdict: CLEAN }),
    },
  });
  await h.scheduler.run();
  const [c1, c2] = h.callsFor('n_work');
  assert.deepEqual(c1.trigger.freshPorts, ['plan']);
  assert.deepEqual(c2.trigger.freshPorts, ['fix'], 'A3: only the fresh port selects the mode');
  assert.deepEqual(c2.trigger.wireIds, ['w5']);
  assert.equal(c2.bindings.plan.path, '/p/plan.md', 'the latched plan is still bound');
  assert.equal(c2.bindings.fix.path, '/p/r1.md');
});

test('4 a meta loop:true input fed by an always-source is still excused from the barrier', async () => {
  // The seeds' OR-valve shape: `n_chk.review -> n_or.in1 -> n_or.out -> n_sink.fix`.
  // The valve's out wire is ALWAYS-sourced, so it is not a classified loop wire, and
  // the valve cannot fire before n_sink has run once (its only input is the checker's
  // blocking review). Only the port's meta `loop` excuses `fix` from the first-run
  // barrier (P2 folds meta loop ports into `loopInputs`; the scheduler ORs the flag in
  // as well). Without the excuse n_sink waits forever for a fix token and the run
  // quiesces with n_sink never fired.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_sink', 'agent', 'worker'),
      N('n_chk', 'agent', 'checker'), N('n_or', 'or', null, { arity: 2 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_a.out', 'n_sink.plan'), W('w3', 'n_a.out', 'n_chk.plan'),
      W('w4', 'n_sink.done', 'n_chk.done'), W('w5', 'n_chk.review', 'n_or.in1', { maxCycles: 3 }),
      W('w6', 'n_or.out', 'n_sink.fix'), W('w7', 'n_chk.pass', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: {
      n_a: () => md('/p/a.md'),
      n_chk: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.scheduler.getState().endReached, true, 'the worker fired despite an unfilled loop input');
  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_a c1', 'n_sink c1', 'n_chk c1', 'n_or c1', 'n_sink c2', 'n_chk c2', 'n_end c1',
  ]);
});

test('5 awaitAll: every wired non-loop input must be fresh, or a lone fresh loop token', async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_b', 'agent', 'maker'),
      N('n_sink', 'agent', 'worker', { awaitAll: true }), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_task.task', 'n_b.task'),
      W('w3', 'n_a.out', 'n_sink.plan'), W('w4', 'n_b.out', 'n_sink.await'),
      W('w5', 'n_sink.done', 'n_check.done'), W('w6', 'n_a.out', 'n_check.plan'),
      W('w7', 'n_check.review', 'n_sink.fix', { maxCycles: 3 }), W('w8', 'n_check.pass', 'n_end.result')],
  );
  const late = deferred();
  const h = harness({
    template: tpl,
    script: {
      n_a: () => md('/p/a.md'),
      n_b: () => late.promise.then(() => md('/p/b.md')),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.deepEqual(h.callsFor('n_sink'), [], 'awaitAll blocks until BOTH wired non-loop inputs are fresh');
  late.resolve();
  assert.equal(await run, 'done');
  const sink = h.callsFor('n_sink');
  assert.equal(sink.length, 2, 'the lone fresh loop token re-fired it under awaitAll');
  assert.deepEqual(sink[1].trigger.freshPorts, ['fix']);
});

test('5b awaitAll: a lone fresh NON-loop input does not re-fire — the barrier holds for all of them', async () => {
  // The discriminating pin for the awaitAll arm: test 5's two assertions are both
  // mode-independent (the first-run barrier, then the lone fresh LOOP token), so
  // deleting the arm leaves them green. Here n_sink has TWO wired non-loop inputs
  // (`plan` from the valve, `done` from n_c) and no fresh loop token when `done`
  // arrives the second time, so the default any-fresh rule WOULD re-fire it.
  // n_c re-runs off the loop wire (w8) and the OR valve re-emits into `plan` only
  // when n_b lands, which is what puts the two inputs on separately timed clocks.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_a', 'agent', 'maker'), N('n_b', 'agent', 'maker'),
      N('n_or', 'or', null, { arity: 2 }), N('n_c', 'agent', 'worker'),
      N('n_sink', 'agent', 'checker', { awaitAll: true }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_a.task'), W('w2', 'n_task.task', 'n_b.task'),
      W('w3', 'n_a.out', 'n_or.in1'), W('w4', 'n_b.out', 'n_or.in2'),
      W('w5', 'n_or.out', 'n_sink.plan'), W('w6', 'n_task.task', 'n_c.plan'),
      W('w7', 'n_c.done', 'n_sink.done'), W('w8', 'n_sink.review', 'n_c.fix', { maxCycles: 3 }),
      W('w9', 'n_sink.pass', 'n_end.result')],
  );
  const lateB = deferred();
  const h = harness({
    template: tpl,
    script: {
      n_a: () => md('/p/a.md'),
      n_b: () => lateB.promise.then(() => md('/p/b.md')),
      n_sink: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.equal(h.callsFor('n_c').length, 2, 'the blocking review re-fired the feeder over the loop wire');
  assert.equal(h.callsFor('n_sink').length, 1, 'awaitAll: a fresh `done` alone is NOT enough to re-fire');
  lateB.resolve();                            // the valve re-emits, and `plan` goes fresh too
  assert.equal(await run, 'done');
  const sink = h.callsFor('n_sink');
  assert.equal(sink.length, 2, 'it re-fires exactly once, when the LAST wired input goes fresh');
  assert.deepEqual(sink[1].trigger.freshPorts, ['plan', 'done'], 'both wired inputs were fresh at that bind');
  assert.equal(h.scheduler.getState().endReached, true);
});

// ── 2. the flow cards ────────────────────────────────────────────────────────

test('6 OR collapses two same-drain arrivals into ONE emission of the freshest', async () => {
  const h = harness({ template: FLOW_TPL, script: { n_a: () => md('/p/a.md'), n_b: () => md('/p/b.md') } });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_or').length, 1, 'one emission per drain');
  const t = h.tokenEvents().filter((e) => e.from.node === 'n_or');
  assert.equal(t.length, 1);
  assert.equal(t[0].path, '/p/b.md', 'the freshest (max seq) payload is forwarded');
  assert.equal(t[0].type, 'md', 'the resolved OR out type');
  const inTok = h.tokenEvents().find((e) => e.from.node === 'n_b');
  assert.ok(t[0].seq > inTok.seq, 'the valve re-emits with a NEW seq');
});

test('7 OR re-emits once per arriving payload across drains; AND emits a void token', async () => {
  const late = deferred();
  const h = harness({
    template: FLOW_TPL,
    script: { n_a: () => md('/p/a.md'), n_b: () => late.promise.then(() => md('/p/b.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  late.resolve();
  assert.equal(await run, 'done');
  assert.equal(h.callsFor('n_or').length, 2, 'one emission per arriving payload');
  const andTok = h.tokenEvents().find((e) => e.from.node === 'n_and');
  assert.equal(andTok.type, 'void');
  assert.equal(andTok.path, null, 'the AND discards payloads');
  assert.equal(h.callsFor('n_and').length, 1, 'AND fires only when ALL inputs are fresh');
});

test('8 End: done carries the bound result and no token is emitted from it', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await h.scheduler.run();
  const done = h.execEvents().find((e) => e.nodeId === 'n_end' && e.status === 'done');
  assert.deepEqual(done.result, { type: 'void' });
  assert.equal(done.agentKey, null);
  assert.equal(done.kind, 'cycle');
  assert.equal(h.tokenEvents().some((e) => e.from.node === 'n_end'), false);
});

test('9 End drain: in-flight work publishes and latches, but routes nowhere', async () => {
  // n_slow finishes AFTER End binds; its consumer must never launch.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_fast', 'agent', 'maker'), N('n_slow', 'agent', 'maker'),
      N('n_late', 'agent', 'worker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_fast.task'), W('w2', 'n_task.task', 'n_slow.task'),
      W('w3', 'n_slow.out', 'n_late.plan'), W('w4', 'n_fast.out', 'n_end.result')],
  );
  const slow = deferred();
  const h = harness({
    template: tpl,
    script: { n_fast: () => md('/p/fast.md'), n_slow: () => slow.promise.then(() => md('/p/slow.md')) },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  slow.resolve();
  assert.equal(await run, 'done');
  assert.ok(h.tokenEvents().some((e) => e.from.node === 'n_slow'), 'the drained publish is RECORDED');
  assert.deepEqual(h.callsFor('n_late'), [], 'and routed NOWHERE');
  assert.equal(h.last().tokens['n_late.plan'], undefined, 'not even delivered: a drained token reaches no input');
  assert.ok(h.last().outputs['n_slow.out'], 'but it IS latched on the output side');
  assert.equal(h.scheduler.getState().endReached, true);
});

test('10 quiescence without an End token resolves done with the warning', async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_check.plan'),
      W('w3', 'n_check.review', 'n_end.result')],
  );
  const h = harness({ template: tpl, script: { n_make: () => md('/p/p.md'), n_check: () => ({ verdict: CLEAN }) } });
  assert.equal(await h.scheduler.run(), 'done');
  const st = h.scheduler.getState();
  assert.equal(st.endReached, false);
  assert.equal(st.result, null);
  // MIN-58: "finished at quiescence" alone never says WHY. The second line names the
  // output whose token had nowhere to go — here the checker's CLEAN arm, which this
  // fixture leaves unwired on purpose.
  assert.deepEqual(st.warnings, [
    'finished at quiescence — End not reached',
    'dead-ended output: n_check.pass — fired with no wire',
  ]);
});

test('10b the dead-end set rides the snapshot: a resumed run still names it', async () => {
  // MIN-58 resume twin. `deadEnds` is scheduler-local state exactly like `wires`: a
  // run that paused AFTER an output fired into nothing and only quiesces after the
  // resume would otherwise report the base line alone and lose the reason.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_check', 'agent', 'checker'),
      N('n_hold', 'agent', 'worker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_check.plan'),
      W('w3', 'n_check.review', 'n_end.result'), W('w4', 'n_make.out', 'n_hold.plan')],
  );
  const script = { n_make: () => md('/p/p.md'), n_check: () => ({ verdict: CLEAN }) };
  const first = harness({ template: tpl, script: { ...script, n_hold: () => ({ paused: true }) } });
  assert.equal(await first.scheduler.run(), 'paused');
  const snap = first.last();
  assert.deepEqual(snap.deadEnds, ['n_check.pass'], 'the pre-pause dead end is serialized');

  const second = harness({ template: tpl, script: { ...script, n_hold: () => ({}) } });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  const st = second.scheduler.getState();
  assert.equal(st.endReached, false);
  assert.deepEqual(st.warnings, [
    'finished at quiescence — End not reached',
    'dead-ended outputs: n_check.pass, n_hold.done — fired with no wire',
  ], 'the restored dead end is named beside the one the resumed leg found');
});

// ── 3. scheduling policy ─────────────────────────────────────────────────────

test('11 fail-fast: the first error aborts in-flight siblings and errors the run', async () => {
  const stall = deferred();
  let sibling = null;
  const tpl = TPL(
    [N('n_task', 'task'), N('n_bad', 'agent', 'maker'), N('n_ok', 'agent', 'maker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_bad.task'), W('w2', 'n_task.task', 'n_ok.task'),
      W('w3', 'n_bad.out', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: {
      n_ok: (a) => { sibling = a.signal; return stall.promise.then(() => md('/p/ok.md')); },
      n_bad: () => { throw new Error('kaboom'); },
    },
  });
  const result = await h.scheduler.run();
  assert.equal(result, 'error');
  assert.equal(sibling.aborted, true, 'the in-flight sibling was aborted');
  const err = h.execEvents().find((e) => e.status === 'error');
  assert.equal(err.nodeId, 'n_bad');
  assert.match(err.error, /kaboom/);
  stall.resolve();
});

test('12 maxParallel caps agent executions; flow cards bypass the semaphore', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const tpl = TPL(
    [N('n_task', 'task'), N('n_1', 'agent', 'maker'), N('n_2', 'agent', 'maker'), N('n_3', 'agent', 'maker'),
      N('n_and', 'and', null, { arity: 3 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_1.task'), W('w2', 'n_task.task', 'n_2.task'), W('w3', 'n_task.task', 'n_3.task'),
      W('w4', 'n_1.out', 'n_and.in1'), W('w5', 'n_2.out', 'n_and.in2'), W('w6', 'n_3.out', 'n_and.in3'),
      W('w7', 'n_and.out', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    maxParallel: 2,
    script: {
      n_1: () => gates[0].promise.then(() => md('/p/1.md')),
      n_2: () => gates[1].promise.then(() => md('/p/2.md')),
      n_3: () => gates[2].promise.then(() => md('/p/3.md')),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.equal(h.callsFor('n_3').length, 0, 'the third agent waits for a slot');
  gates[0].resolve(); gates[1].resolve(); gates[2].resolve();
  assert.equal(await run, 'done');
  assert.equal(h.maxInFlight(), 2);
  assert.equal(h.callsFor('n_and').length, 1);
});

test('13 determinism: identical scripts produce identical execution sequences', async () => {
  const seqs = [];
  for (let i = 0; i < 2; i += 1) {
    const h = harness({
      template: LOOP_TPL,
      script: {
        n_make: () => md('/p/plan.md'),
        n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
      },
    });
    await h.scheduler.run();
    seqs.push(h.execSeq());
  }
  assert.deepEqual(seqs[0], seqs[1]);
});

test('14 conditional routing fires exactly the verdict-matching side, in declared order', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  await h.scheduler.run();
  const fired = h.tokenEvents().filter((e) => e.from.node === 'n_check').map((e) => e.from.port);
  assert.deepEqual(fired, ['review', 'pass'], 'blocking cycle fires review only; clean cycle fires pass only');
});

test('15 exec and token events carry the documented v2 shapes', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN, sessionId: 'sess-1' }) },
  });
  await h.scheduler.run();
  const start = h.execEvents().find((e) => e.nodeId === 'n_make' && e.status === 'start');
  assert.deepEqual(Object.keys(start).sort(), ['agentKey', 'executionId', 'kind', 'name', 'nodeId', 'ordinal', 'status', 'trigger']);
  assert.equal(start.executionId, 'x:n_make:1');
  assert.equal(start.agentKey, 'maker');
  assert.equal(start.kind, 'cycle');
  const verdictDone = h.execEvents().find((e) => e.nodeId === 'n_check' && e.status === 'done');
  assert.deepEqual(verdictDone.verdict, { hasBlocking: false }, 'verifier done carries the verdict flag');
  assert.equal(h.scheduler.getState().executions.find((e) => e.executionId === 'x:n_check:1').sessionId, 'sess-1');
  const tok = h.tokenEvents().find((e) => e.from.node === 'n_make');
  assert.deepEqual(tok.to, [{ node: 'n_work', port: 'plan', wireId: 'w2' }, { node: 'n_check', port: 'plan', wireId: 'w3' }]);
  assert.equal(tok.type, 'md');
  assert.equal(tok.path, '/p/plan.md');
  assert.equal(tok.forced, false);
  assert.equal(tok.sourceExecutionId, 'x:n_make:1');
  assert.equal(typeof tok.firedAt, 'number');
  assert.equal(typeof tok.seq, 'number');
});

test('16 pause resolves the literal "paused" and launches nothing further', async () => {
  const hold = deferred();
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => hold.promise.then(() => md('/p/plan.md')), n_check: () => ({ verdict: CLEAN }) },
  });
  const run = h.scheduler.run();
  await tick();
  h.scheduler.pause();
  hold.resolve();
  assert.equal(await run, 'paused');
  assert.deepEqual(h.callsFor('n_work'), [], 'no launch after the pause request');
  assert.equal(h.scheduler.getState().endReached, false);
});

test('17 abort fires the in-flight signal and errors the run', async () => {
  const hold = deferred();
  let seen = null;
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: (a) => { seen = a.signal; return hold.promise.then(() => md('/p/p.md')); } },
  });
  const run = h.scheduler.run();
  await tick();
  h.scheduler.abort();
  assert.equal(seen.aborted, true);
  hold.resolve();
  assert.equal(await run, 'error');
});

// ── 4. loop budgets and gates ────────────────────────────────────────────────

const withMaxCycles = (template, wireId, maxCycles) => {
  const clone = structuredClone(template);
  const w = clone.wires.find((x) => x.id === wireId);
  w.config = { ...(w.config || {}), maxCycles };
  return clone;
};

/** n_pol refines itself: `revise` (blocking) self-wire is the loop wire. */
const SELF_LOOP = TPL(
  [N('n_task', 'task'), N('n_pol', 'agent', 'polisher'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_pol.plan'), W('w2', 'n_pol.revise', 'n_pol.revise', { maxCycles: 2 }),
    W('w3', 'n_pol.plan', 'n_end.result')],
);

const blockingRevise = (p) => ({ verdict: BLOCKING(), outputs: { revise: { path: p } } });

test('18 A1: maxCycles caps TOTAL source firings; the gate fires at the would-be Nth delivery', { timeout: 5000 }, async () => {
  const h = harness({
    template: withMaxCycles(LOOP_TPL, 'w5', 3),
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: (a) => ({ verdict: BLOCKING(), outputs: { review: { path: `/p/r${a.ordinal}.md` } } }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_check').length, 3, 'maxCycles 3 ⇒ three source firings, then the gate');
  assert.equal(h.callsFor('n_work').length, 3);
  assert.equal(h.asks.length, 1, 'exactly one gate ask');
  assert.equal(h.asks[0].id, 'gate-w5-3', 'the FIRST hold keeps the plain gate-<wireId>-<deliveryNo> id');
  assert.deepEqual(Object.keys(h.asks[0]).sort(),
    ['deliveryNo', 'executionId', 'holdNo', 'id', 'issues', 'kind', 'nodeId', 'wireId']);
  // MAJ-11: the cycle rides the PAYLOAD; the id is opaque (a re-hold suffixes -h<n>).
  assert.equal(h.asks[0].deliveryNo, 3);
  assert.equal(h.asks[0].holdNo, 1);
  assert.equal(h.asks[0].kind, 'gate');
  assert.equal(h.asks[0].nodeId, 'n_check', 'the gate names the SOURCE node');
  assert.equal(h.asks[0].executionId, 'x:n_check:3');
  assert.deepEqual(h.asks[0].issues, [{ severity: 'critical', title: 'boom' }]);
  assert.equal(h.scheduler.getState().wireDeliveries.w5, 2);
});

test('19 gate "another": the allowance grows by one and the held token is delivered', { timeout: 5000 }, async () => {
  const answers = ['another', 'continue'];
  const h = harness({
    template: withMaxCycles(LOOP_TPL, 'w5', 2),
    script: {
      n_make: () => md('/p/plan.md'),
      n_check: (a) => ({ verdict: BLOCKING(), outputs: { review: { path: `/p/r${a.ordinal}.md` } } }),
    },
    onAsk: async () => answers.shift() ?? 'continue',
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_check').length, 3, 'one extra iteration was granted');
  const fix = h.callsFor('n_work').at(-1);
  assert.equal(fix.bindings.fix.path, '/p/r2.md', 'the HELD token was delivered, not a fresh one');
});

test('20 gate "continue": A4 force-fires the source clean side with the held payload', { timeout: 5000 }, async () => {
  const h = harness({
    template: SELF_LOOP,
    script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_pol').length, 2, 'maxCycles 2 ⇒ two firings');
  const forced = h.tokenEvents().find((e) => e.forced === true);
  assert.deepEqual(forced.from, { node: 'n_pol', port: 'plan' }, 'the CLEAN side force-fires');
  assert.equal(forced.path, '/p/rev2.md', 'A4: same type ⇒ the held blocking payload is reused');
  assert.equal(h.scheduler.getState().endReached, true);
  const end = h.callsFor('n_end')[0];
  assert.equal(end.bindings.result.path, '/p/rev2.md');
  assert.deepEqual(end.bindings.result.meta, { issues: [{ severity: 'critical', title: 'boom' }] });
  assert.equal(end.bindings.result.forced, true);
});

test('21 gate audit: held → continue events, state.gate lifecycle, non-interactive default', { timeout: 5000 }, async () => {
  const h = harness({ template: SELF_LOOP, script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) } });
  await h.scheduler.run();
  const audit = h.events.filter((e) => e.name === 'gate');
  assert.deepEqual(audit.map((e) => e.status), ['held', 'continue']);
  assert.equal(audit[0].wireId, 'w2');
  assert.equal(audit[0].askId, 'gate-w2-2');
  assert.equal(audit[0].nodeId, 'n_pol');
  assert.deepEqual(h.gates[0], { wireId: 'w2', fromNode: 'n_pol', toNode: 'n_pol', askId: 'gate-w2-2' });
  assert.equal(h.gates.at(-1), null, 'the gate clears when it resolves');
  assert.equal(h.scheduler.getState().gate, null);
});

test('21b a gate answered AFTER the run resolved is ignored — the resumed scheduler re-asks it', { timeout: 5000 }, async () => {
  let answer = null;
  const h = harness({
    template: SELF_LOOP,
    script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) },
    onAsk: () => new Promise((res) => { answer = res; }),
  });
  const run = h.scheduler.run();
  while (!answer) await tick();
  h.scheduler.pause();
  assert.equal(await run, 'paused');
  const events = h.events.length; const snaps = h.snapshots.length;
  answer('continue');
  await tick(); await tick();
  assert.equal(h.events.length, events, 'a settled scheduler emits nothing');
  assert.equal(h.snapshots.length, snaps, 'and writes no snapshot after its final one');
  assert.equal(h.last().gates.length, 1, 'the final snapshot still carries the hold for the resume to re-ask');
  assert.equal(h.last().tokens['n_end.result'], undefined, 'and no forced token was routed by a dead run');
});

test('22 two loop wires into one OR gate independently in the same drain; a forced token keeps its flag through the valve', { timeout: 5000 }, async () => {
  const tpl = TPL(
    [N('n_task', 'task'), N('n_work', 'agent', 'worker'), N('n_c1', 'agent', 'checker'),
      N('n_c2', 'agent', 'checker'), N('n_or', 'or', null, { arity: 2 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_work.plan'), W('w2', 'n_task.task', 'n_c1.plan'), W('w3', 'n_task.task', 'n_c2.plan'),
      W('w4', 'n_work.done', 'n_c1.done'), W('w5', 'n_work.done', 'n_c2.done'),
      W('w6', 'n_c1.review', 'n_or.in1', { maxCycles: 1 }), W('w7', 'n_c2.review', 'n_or.in2', { maxCycles: 1 }),
      W('w8', 'n_or.out', 'n_work.fix'), W('w9', 'n_c1.pass', 'n_end.result')],
  );
  const h = harness({
    template: tpl,
    script: {
      n_c1: byOrdinal({ verdict: BLOCKING('a'), outputs: { review: { path: '/p/a.md' } } }, { verdict: CLEAN }),
      n_c2: byOrdinal({ verdict: BLOCKING('b'), outputs: { review: { path: '/p/b.md' } } }, { verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  // maxCycles 1 ⇒ allowance 0 ⇒ the FIRST delivery on each wire gates.
  assert.deepEqual(h.asks.map((a) => a.id).sort(), ['gate-w6-1', 'gate-w7-1']);
  assert.deepEqual(h.scheduler.getState().wireDeliveries, { w6: 0, w7: 0 });
});

test('22b a forced token crossing an OR valve keeps forced + meta', { timeout: 5000 }, async () => {
  // polisher(blocking, self-loop budget 1) -> OR -> End: the A4 forced `plan` token
  // rides through the valve and End binds it still flagged. The valve's second input
  // is deliberately left unwired (validation is not run here): a task-fed in2 would
  // fire the valve — and End — at t0, before the forced token exists.
  const tpl = TPL(
    [N('n_task', 'task'), N('n_pol', 'agent', 'polisher'), N('n_or', 'or', null, { arity: 2 }), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_pol.plan'), W('w2', 'n_pol.revise', 'n_pol.revise', { maxCycles: 1 }),
      W('w3', 'n_pol.plan', 'n_or.in1'), W('w4', 'n_or.out', 'n_end.result')],
  );
  const h = harness({ template: tpl, script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) } });
  assert.equal(await h.scheduler.run(), 'done');
  const orTok = h.tokenEvents().filter((e) => e.from.node === 'n_or').at(-1);
  assert.equal(orTok.forced, true, 'the valve forwards the forced flag');
  const end = h.callsFor('n_end').at(-1);
  assert.equal(end.bindings.result.forced, true);
  assert.deepEqual(end.bindings.result.meta, { issues: [{ severity: 'critical', title: 'boom' }] });
});

// ── 5. composite fan-out ─────────────────────────────────────────────────────

/** maker -> splitter -> worker(expands `task`), with a checker loop for the A3 case. */
const FANOUT = TPL(
  [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_split', 'agent', 'splitter'),
    N('n_work', 'agent', 'worker'), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_split.plan'),
    W('w3', 'n_make.out', 'n_work.plan'), W('w4', 'n_split.tasks', 'n_work.task'),
    W('w5', 'n_make.out', 'n_check.plan'), W('w6', 'n_work.done', 'n_check.done'),
    W('w7', 'n_check.review', 'n_work.fix', { maxCycles: 3 }), W('w8', 'n_check.pass', 'n_end.result')],
);

const PHASES = [
  { ordinal: 1, tasks: [
    { id: 'p1t1', title: 'One', file: 'tasks/p1-t1.md', path: '/p/tasks/p1-t1.md' },
    { id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md', path: '/p/tasks/p1-t2.md' },
  ] },
  { ordinal: 2, tasks: [{ id: 'p2t1', title: 'Three', file: 'tasks/p2-t1.md', path: '/p/tasks/p2-t1.md' }] },
];

const manifest = () => ({ outputs: { tasks: { path: '/p/decomposition.json' } } });

/** A composite-aware worker script; `onSlice` may throw to test sibling abort. */
const compositeWorker = ({ phases = PHASES, onSlice = () => ({}) } = {}) => (args) => {
  if (args.composite === 'expand') return { phases };
  if (args.composite === 'phase') return {};
  if (args.composite === 'finish') return { outputs: {} };
  if (args.kind === 'task') return onSlice(args);
  return {};
};

test('23 composite: expand → phases → parallel slices with siblings → finish, ONE publish', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: manifest,
      n_work: compositeWorker(),
      n_check: () => ({ verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const c = h.callsFor('n_work');
  assert.deepEqual(
    c.map((x) => x.composite ? `${x.composite}${x.phase ? `:${x.phase}:${x.phaseStatus}` : ''}` : `slice:${x.slice.id}`),
    ['expand', 'phase:1:running', 'slice:p1t1', 'slice:p1t2', 'phase:1:done',
      'phase:2:running', 'slice:p2t1', 'phase:2:done', 'finish'],
  );
  const slice = c.find((x) => x.slice?.id === 'p1t1');
  assert.deepEqual(slice.slice, {
    id: 'p1t1', title: 'One', phase: 1, path: '/p/tasks/p1-t1.md', index: 0,
    siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }],
  });
  assert.equal(slice.executionId, 'x:n_work:1:p1t1');
  assert.equal(slice.taskIndex, 1);
  assert.equal(slice.taskTotal, 2);
  assert.equal(slice.bindings.task.path, '/p/tasks/p1-t1.md', 'the expands input is rebound to the slice file');
  assert.deepEqual(c.find((x) => x.slice?.id === 'p2t1').slice.siblings, [], 'a solo task has no siblings');
  const row = h.execEvents().find((e) => e.executionId === 'x:n_work:1:p1t2' && e.status === 'start');
  assert.equal(row.kind, 'task');
  assert.equal(row.ordinal, 1);
  assert.equal(row.phase, 1);
  assert.equal(row.taskId, 'p1t2');
  assert.equal(row.title, 'Two');
  assert.equal(row.parentExecutionId, 'x:n_work:1');
  assert.equal(row.taskIndex, 2);
  assert.equal(row.taskTotal, 2);
  assert.equal(h.tokenEvents().filter((e) => e.from.node === 'n_work').length, 1, 'the node publishes ONCE');
});

/** Three tasks in ONE phase: with maxParallel 2 the third is queued behind the semaphore. */
const THREE_UP = [{ ordinal: 1, tasks: [
  { id: 'p1t1', title: 'One', file: 'tasks/p1-t1.md', path: '/p/tasks/p1-t1.md' },
  { id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md', path: '/p/tasks/p1-t2.md' },
  { id: 'p1t3', title: 'Three', file: 'tasks/p1-t3.md', path: '/p/tasks/p1-t3.md' },
] }];

test('24 sibling failure aborts phase-mates, never launches a queued slice, and fails the run', { timeout: 5000 }, async () => {
  let mateSignal = null;
  const h = harness({
    template: FANOUT,
    maxParallel: 2,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: manifest,
      n_work: compositeWorker({
        phases: THREE_UP,
        onSlice: (a) => {
          // p1t1 IGNORES its signal on purpose: the scheduler must not wait for it.
          if (a.slice.id === 'p1t1') { mateSignal = a.signal; return new Promise(() => {}); }
          if (a.slice.id === 'p1t2') throw new Error('slice exploded');
          return {};                                    // p1t3 — must never be reached
        },
      }),
    },
  });
  assert.equal(await h.scheduler.run(), 'error');
  assert.equal(mateSignal.aborted, true, 'the phase-mate was aborted');
  assert.equal(h.callsFor('n_work').some((x) => x.slice?.id === 'p1t3'), false,
    'the slice queued behind the semaphore never launches once its phase has failed');
  assert.equal(h.execEvents().some((e) => e.executionId === 'x:n_work:1:p1t3'), false, 'and gets no ledger row');
  assert.ok(h.callsFor('n_work').some((x) => x.phaseStatus === 'error'), 'the phase is marked error');
  assert.ok(h.callsFor('n_work').every((x) => x.composite !== 'finish'), 'finish never runs');
  const err = h.execEvents().find((e) => e.nodeId === 'n_work' && e.status === 'error' && e.kind === 'cycle');
  assert.match(err.error, /composite execution failed in phase 1: task "Two": slice exploded/);
});

test('25 an empty decomposition downgrades to ONE ordinary execution with the port unbound', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: manifest,
      n_work: compositeWorker({ phases: [] }),
      n_check: () => ({ verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const c = h.callsFor('n_work');
  assert.equal(c.length, 2, 'the expand probe, then one ordinary execution');
  assert.equal(c[1].composite, undefined);
  assert.equal(c[1].bindings.task, undefined, 'the expands binding is stripped');
  assert.deepEqual(c[1].trigger.freshPorts, ['plan'], 'and so is its freshness (no slice directive)');
  assert.deepEqual(c[1].trigger.wireIds, ['w3'], 'the manifest wire leaves the trigger with its port');
});

test('26 A3: a fresh loop token beats the expands port — the fix re-fire is one normal execution', async () => {
  const h = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: manifest,
      n_work: compositeWorker(),
      n_check: byOrdinal({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }, { verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const second = h.callsFor('n_work').filter((x) => x.ordinal === 2);
  assert.equal(second.length, 1, 'ordinal 2 is a single plain call');
  assert.equal(second[0].composite, undefined);
  assert.deepEqual(second[0].trigger.freshPorts, ['fix']);
  assert.equal(second[0].bindings.task.path, '/p/decomposition.json', 'the latched manifest is still bound');
});

/** worker.done feeds BOTH the checker and (through an OR shared with the maker) the
 *  splitter, so after a blocking review the fix token AND a fresh manifest reach the
 *  worker in the SAME drain — the only shape where A3's loop-wins rule is observable. */
const FANOUT2 = TPL(
  [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_or', 'or', null, { arity: 2 }),
    N('n_split', 'agent', 'splitter'), N('n_work', 'agent', 'worker'), N('n_check', 'agent', 'checker'), N('n_end', 'end')],
  [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_or.in1'), W('w3', 'n_work.done', 'n_or.in2'),
    W('w4', 'n_or.out', 'n_split.plan'), W('w5', 'n_split.tasks', 'n_work.task'), W('w6', 'n_make.out', 'n_work.plan'),
    W('w7', 'n_make.out', 'n_check.plan'), W('w8', 'n_work.done', 'n_check.done'),
    W('w9', 'n_check.review', 'n_work.fix', { maxCycles: 3 }), W('w10', 'n_check.pass', 'n_end.result')],
);

test('26b A3 in the same drain: a fresh loop token AND a fresh manifest ⇒ one normal execution, never a fan-out', async () => {
  // The checker's first verdict and the splitter's second manifest are held back and
  // released in ONE synchronous step, so both completions settle in the same batch and
  // the worker's next firing sees `fix` AND `task` fresh together. (Left to their own
  // timing they do NOT: the OR's inline `await` lets the checker land first.)
  const chk1 = deferred(); const split2 = deferred();
  const h = harness({
    template: FANOUT2,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: (a) => (a.ordinal === 2 ? split2.promise.then(manifest) : manifest()),
      n_work: compositeWorker(),
      n_check: (a) => (a.ordinal === 1
        ? chk1.promise.then(() => ({ verdict: BLOCKING(), outputs: { review: { path: '/p/r.md' } } }))
        : { verdict: CLEAN }),
    },
  });
  const run = h.scheduler.run();
  await tick(); await tick();
  assert.equal(h.callsFor('n_check').length, 1, 'the checker is in flight after the fan-out');
  assert.equal(h.callsFor('n_split').length, 2, 'and so is the splitter\'s re-run');
  chk1.resolve(); split2.resolve();
  assert.equal(await run, 'done');
  assert.ok(h.callsFor('n_work').some((x) => x.ordinal === 1 && x.composite === 'expand'), 'the first firing fanned out');
  const second = h.callsFor('n_work').filter((x) => x.ordinal === 2);
  assert.equal(second.length, 1, 'ordinal 2 is ONE plain call');
  assert.equal(second[0].composite, undefined);
  assert.deepEqual(second[0].trigger.freshPorts, ['fix', 'task'], 'both were fresh in that firing — the loop token wins');
  assert.equal(second[0].bindings.task.path, '/p/decomposition.json');
});

// ── 6. snapshot / reattach ───────────────────────────────────────────────────

test('27 the snapshot carries the full resume state, including outputs and recorded args', async () => {
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await h.scheduler.run();
  const s = h.last();
  assert.deepEqual(Object.keys(s).sort(), [
    'ask', 'asks', 'consumed', 'deadEnds', 'ended', 'execs', 'gate', 'gates', 'graph',
    'ordinals', 'outputs', 'seq', 'tokens', 'version', 'wires',
  ]);
  assert.equal(s.version, 2);
  assert.equal(s.outputs['n_make.out'].path, '/p/plan.md', 'latched OUTPUT tokens survive');
  assert.equal(s.tokens['n_work.plan'].path, '/p/plan.md', 'delivered INPUT tokens survive');
  assert.deepEqual(s.wires, { w5: { deliveries: 0, allowance: 2 } });
  assert.equal(s.consumed.n_work.plan, s.outputs['n_make.out'].seq);
  const work = s.execs.find((e) => e.executionId === 'x:n_work:1');
  assert.equal(work.status, 'done');
  assert.equal(work.bindings.plan.path, '/p/plan.md', 'the RECORDED args are serialized');
  assert.deepEqual(work.trigger.freshPorts, ['plan']);
  assert.equal(s.ended.nodeId, 'n_end');
});

test('28 reattach re-invokes only the non-terminal execution, with its recorded args', async () => {
  const hold = deferred();
  const first = harness({
    template: LOOP_TPL,
    script: {
      n_make: () => md('/p/plan.md'),
      n_work: () => hold.promise.then(() => ({ paused: true })),   // the adapter's answer to a pause
    },
  });
  const run = first.scheduler.run();
  await tick(); await tick();
  first.scheduler.pause();
  hold.resolve();
  assert.equal(await run, 'paused');
  const snap = first.last();
  assert.equal(snap.execs.find((e) => e.executionId === 'x:n_work:1').status, 'paused');
  assert.equal(first.execEvents().some((e) => e.status === 'paused'), true);
  assert.equal(first.tokenEvents().some((e) => e.from.node === 'n_work'), false, 'a paused row publishes nothing');

  // Tamper with the DELIVERED token (same seq, so it is not fresh and cannot re-fire
  // the node): a resume that rebuilt its args from `tokens` would bind the tampered
  // path; the recorded bindings are what the resumed execution must see.
  snap.tokens['n_work.plan'] = { ...snap.tokens['n_work.plan'], path: '/p/plan-v2.md' };
  const second = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  assert.deepEqual(second.callsFor('n_task'), [], 'a finished flow node is never re-run');
  assert.deepEqual(second.callsFor('n_make'), [], 'a finished agent is never re-run');
  const again = second.callsFor('n_work');
  assert.equal(again.length, 1);
  assert.equal(again[0].executionId, 'x:n_work:1', 'the SAME execution id');
  assert.equal(again[0].bindings.plan.path, '/p/plan.md', 'with the RECORDED bindings, not the moved-on token');
  assert.equal(second.scheduler.getState().endReached, true);
});

test('28b an execution that answers { paused: true } pauses the RUN — no pause() call needed', async () => {
  // The adapter's ask-then-resume path: the EXECUTION pauses the run (a human must
  // answer before the session resumes). Nothing else may launch, and the run must
  // resolve 'paused' — never quiesce to a false 'done'.
  const h = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_work: () => ({ paused: true }), n_check: () => ({ verdict: CLEAN }) },
  });
  assert.equal(await h.scheduler.run(), 'paused');
  const st = h.scheduler.getState();
  assert.equal(st.endReached, false);
  assert.deepEqual(st.warnings, [], 'no quiescence warning — the run is paused, not finished');
  assert.equal(st.executions.find((e) => e.executionId === 'x:n_work:1').status, 'paused');
  assert.deepEqual(h.callsFor('n_check'), [], 'nothing downstream launches');
  assert.equal(h.tokenEvents().some((e) => e.from.node === 'n_work'), false, 'a paused row publishes nothing');
});

test('29 drain resume: a snapshot with `ended` set launches nothing', async () => {
  const done = harness({
    template: LOOP_TPL,
    script: { n_make: () => md('/p/plan.md'), n_check: () => ({ verdict: CLEAN }) },
  });
  await done.scheduler.run();
  const resumed = harness({ template: LOOP_TPL, script: {} });
  resumed.scheduler.reattach(done.last());
  assert.equal(await resumed.scheduler.run(), 'done');
  assert.deepEqual(resumed.calls, []);
  // A foreign snapshot carrying BOTH `ended` and a hold (this scheduler never writes
  // one — End withdraws its gates before it snapshots): End wins, the hold is dropped
  // and no ask is re-raised.
  const foreign = {
    ...done.last(),
    gates: [{ wireId: 'w5', nodeId: 'n_check', executionId: 'x:n_check:1',
      token: { seq: 99, type: 'md', path: '/p/r.md' }, issues: [], askId: 'gate-w5-9' }],
  };
  const drained = harness({ template: LOOP_TPL, script: {} });
  drained.scheduler.reattach(foreign);
  assert.equal(await drained.scheduler.run(), 'done');
  assert.deepEqual(drained.asks, [], 'a drained run re-raises no gate');
  assert.deepEqual(drained.calls, []);
});

test('30 a restored hold re-raises its gate ask', { timeout: 5000 }, async () => {
  const asked = deferred();
  const first = harness({
    template: SELF_LOOP,
    script: { n_pol: (a) => blockingRevise(`/p/rev${a.ordinal}.md`) },
    onAsk: (a) => { asked.resolve(a); return new Promise(() => {}); },   // never answered
  });
  const run = first.scheduler.run();
  await asked.promise;
  first.scheduler.pause();
  assert.equal(await run, 'paused');
  const snap = first.last();
  assert.equal(snap.gates.length, 1);
  assert.equal(snap.gate.askId, 'gate-w2-2');
  assert.equal(snap.gates[0].token.path, '/p/rev2.md', 'the held token survives');

  const second = harness({ template: SELF_LOOP, script: { n_pol: (a) => blockingRevise(`/p/x.md`) } });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  assert.equal(second.asks.length, 1, 'the hold was re-asked');
  assert.equal(second.asks[0].id, 'gate-w2-2');
  assert.equal(second.scheduler.getState().endReached, true);
});

test('31 pause mid-composite: the shell stays non-terminal, publishes nothing, and the resume re-runs the fan-out', { timeout: 5000 }, async () => {
  const hold = deferred();
  const first = harness({
    template: FANOUT,
    script: {
      n_make: () => md('/p/plan.md'),
      n_split: manifest,
      // p1t1 is cancelled by the pause and answers like the adapter does; p1t2 finishes.
      n_work: compositeWorker({ onSlice: (a) => (a.slice.id === 'p1t1' ? hold.promise.then(() => ({ paused: true })) : {}) }),
    },
  });
  const run = first.scheduler.run();
  await tick(); await tick();
  first.scheduler.pause();
  hold.resolve();
  assert.equal(await run, 'paused');
  const snap = first.last();
  assert.equal(snap.execs.find((e) => e.executionId === 'x:n_work:1').status, 'paused', 'the shell is NON-terminal');
  assert.equal(snap.execs.find((e) => e.executionId === 'x:n_work:1:p1t1').status, 'paused');
  assert.equal(first.tokenEvents().some((e) => e.from.node === 'n_work'), false, 'nothing published');
  assert.ok(first.callsFor('n_work').every((c) => c.composite !== 'finish'), 'finish never ran');
  assert.ok(!first.callsFor('n_work').some((c) => c.phaseStatus === 'done'), 'no phase was marked done');
  assert.deepEqual(first.callsFor('n_check'), [], 'the consumer never saw a done token');

  const second = harness({
    template: FANOUT,
    script: { n_work: compositeWorker(), n_check: () => ({ verdict: CLEAN }) },
  });
  second.scheduler.reattach(snap);
  assert.equal(await second.scheduler.run(), 'done');
  const c = second.callsFor('n_work');
  assert.equal(c[0].composite, 'expand', 'the shell re-runs the WHOLE fan-out');
  assert.ok(c.some((x) => x.slice?.id === 'p1t1' && x.executionId === 'x:n_work:1:p1t1'), 'the same slice ids are re-minted');
  assert.equal(second.tokenEvents().filter((e) => e.from.node === 'n_work').length, 1, 'ONE publish, after finish');
  assert.equal(second.scheduler.getState().endReached, true);
});

// ── MIN-25: the End drain cuts a composite short — that is `skipped`, not `done` ──
// runComposite's bail() answered `{ outputs: {} }` for End/abort/failure, which
// completeExecution treats as a SUCCESSFUL completion: the ledger row read `done`
// although finish() never ran, and an empty token latched into the snapshot. Base
// spec §"Completion": "anything cut off by the End drain" reports `skipped`.
test('34 a composite cut short by the End drain is `skipped` and publishes nothing', { timeout: 5000 }, async () => {
  const TPL34 = TPL(
    [N('n_task', 'task'), N('n_make', 'agent', 'maker'), N('n_split', 'agent', 'splitter'),
      N('n_work', 'agent', 'worker'), N('n_fast', 'agent', 'maker'), N('n_end', 'end')],
    [W('w1', 'n_task.task', 'n_make.task'), W('w2', 'n_make.out', 'n_split.plan'),
      W('w3', 'n_split.tasks', 'n_work.task'), W('w4', 'n_make.out', 'n_work.plan'),
      W('w5', 'n_task.task', 'n_fast.task'), W('w6', 'n_fast.out', 'n_end.result')],
  );
  let h = null;
  const sliceStarted = deferred();
  const endDone = () => !!h && h.events.some((e) => e.name === 'exec' && e.nodeId === 'n_end' && e.status === 'done');
  const waitUntil = async (fn) => { for (let i = 0; i < 500 && !fn(); i += 1) await tick(); };
  h = harness({
    template: TPL34,
    script: {
      n_task: () => ({ outputs: { task: { path: '/p/task.md' } } }),
      n_make: () => ({ outputs: { out: { path: '/p/plan.md' } } }),
      n_split: () => ({ outputs: { tasks: { path: '/p/tasks.json' } } }),
      // The fast branch waits for the composite's FIRST slice, then races to End.
      n_fast: async () => { await sliceStarted.promise; return { outputs: { out: { path: '/p/fast.md' } } }; },
      n_work: async (a) => {
        if (a.composite === 'expand') {
          return { phases: [
            { ordinal: 1, tasks: [{ id: 'p1t1', title: 'A', path: '/p/a.md' }] },
            { ordinal: 2, tasks: [{ id: 'p2t1', title: 'B', path: '/p/b.md' }] },
          ] };
        }
        if (a.composite === 'finish') return { outputs: { done: {} } };
        if (a.composite) return {};
        if (a.kind === 'task' && a.slice?.phase === 1) {
          sliceStarted.resolve();
          await waitUntil(endDone);          // End binds while phase 1 is still open
          return { outputs: {} };
        }
        return { outputs: {} };
      },
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  const st = h.scheduler.getState();
  assert.equal(st.endReached, true, 'the fast branch reached End');
  const shell = st.executions.find((e) => e.executionId === 'x:n_work:1');
  assert.equal(shell.status, 'skipped', 'the shell never finished — it must not read `done`');
  assert.equal(h.callsFor('n_work').some((c) => c.slice?.phase === 2), false, 'phase 2 never ran');
  assert.equal(h.callsFor('n_work').some((c) => c.composite === 'finish'), false, 'finish() never ran');
  assert.equal('n_work.done' in st.tokens, false, 'no empty token is latched for a node that never published');
  assert.equal(h.tokenEvents().some((e) => e.from?.node === 'n_work'), false, 'and none was emitted');
  const markers = h.execEvents().filter((e) => e.nodeId === 'n_work' && e.kind === 'cycle').map((e) => e.status);
  assert.deepEqual(markers, ['start', 'skipped']);
  // `skipped` is TERMINAL, so a resume must not re-invoke the abandoned shell.
  assert.equal(h.last().execs.find((e) => e.executionId === 'x:n_work:1').status, 'skipped');
});
