// test/graph-scheduler.test.mjs
// scheduler.mjs is the single-owner dataflow loop of the v2 graph engine: the
// token store, the drain/launch loop over classifyLoops(...).order, per-wire
// loop budgets and their human gates, the OR valve's same-drain collapse, End
// completion (COMPLETING drain) and the resume-v2 snapshot.
//
// Every execution — agent AND flow card — is routed through the injected
// `execute`, so the fake below answers flow calls too. Fixtures here skip
// validation on purpose: a synthetic graph without an End node is legal and
// simply quiesces with `ended === null`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { createScheduler } from '../src/core/graph/scheduler.mjs';

const ports = portsFnFor(FIXTURE_PORTS);

const BLOCKING = (title = 'boom') => ({ issues: [{ severity: 'critical', title }] });
const CLEAN = { issues: [{ severity: 'minor', title: 'nit' }] };

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Per-ordinal script; the LAST entry repeats for every later execution. */
const byOrdinal = (...list) => (args) => list[Math.min(args.ordinal, list.length) - 1] ?? {};

/**
 * Scripted fake `execute`: records every call IN CALL ORDER (the execution
 * sequence the pins are written against), tracks agent concurrency, and answers
 * unscripted flow calls with `{}` — end echoes its bound token as the
 * INFORMATIONAL `result` the scheduler must ignore.
 */
function harness({ template, script = {}, taskArtifact = { path: '/p/task.md' }, maxParallel, ask, snapshot }) {
  const events = [];
  const snapshots = [];
  const calls = [];
  const askCalls = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const execute = (args) => {
    calls.push({
      nodeId: args.node.id, executionId: args.executionId, ordinal: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, taskArtifact: args.taskArtifact, signal: args.signal,
    });
    const isAgent = args.node.kind === 'agent';
    if (isAgent) { inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); }
    const release = () => { if (isAgent) inFlight -= 1; };
    const fn = script[args.node.id];
    let out;
    try {
      out = typeof fn === 'function'
        ? fn(args)
        : args.node.kind === 'end' ? { result: Object.values(args.bindings)[0] ?? null } : {};
    } catch (err) {
      release();
      throw err;
    }
    return Promise.resolve(out).then((v) => { release(); return v; }, (e) => { release(); throw e; });
  };

  const scheduler = createScheduler({
    template,
    portsFn: ports,
    execute,
    taskArtifact,
    maxParallel,
    snapshot,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onSnapshot: (s) => snapshots.push(s),
    ask: ask || (async (q) => { askCalls.push(q); return 'continue'; }),
  });

  return {
    scheduler,
    events,
    snapshots,
    calls,
    askCalls,
    maxInFlight: () => maxInFlight,
    execEvents: () => events.filter((e) => e.name === 'exec'),
    tokenEvents: () => events.filter((e) => e.name === 'token'),
    starts: () => events.filter((e) => e.name === 'exec' && e.status === 'start'),
    execSeq: () => events
      .filter((e) => e.name === 'exec' && e.status === 'start')
      .map((e) => `${e.nodeId} c${e.ordinal}`),
    callsFor: (nodeId) => calls.filter((c) => c.nodeId === nodeId),
    last: () => snapshots[snapshots.length - 1],
  };
}

/** ask() that records and answers from a canned list (last answer repeats). */
function scriptedAsk(...answers) {
  const seen = [];
  const fn = async (q) => {
    seen.push(q);
    return answers[Math.min(seen.length, answers.length) - 1] ?? 'continue';
  };
  fn.seen = seen;
  return fn;
}

const withMaxCycles = (template, wireId, maxCycles) => {
  const clone = structuredClone(template);
  const w = clone.wires.find((x) => x.id === wireId);
  w.config = { ...(w.config || {}), maxCycles };
  return clone;
};

// ---------------------------------------------------------------------------
// Synthetic fixtures (validation deliberately not run over these)
// ---------------------------------------------------------------------------

/** consumer.done → two verifiers → OR → consumer.fix: the seeds' double-review
 *  shape. One SCC, so the two blocking in-wires (only them) are loop wires. */
const orLoop = (maxA = 3, maxB = 3) => ({
  id: 'wf_or_loop', name: 'Or loop', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'reviewer', x: 280, y: 80, config: {} },
    { id: 'n_b', kind: 'agent', key: 'workspaceReviewer', x: 280, y: 320, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 0, y: 200, config: {} },
    { id: 'n_or', kind: 'or', x: 560, y: 200, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w_t1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w_t2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w_t3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'plan' } },
    { id: 'w_da', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_a', port: 'done' } },
    { id: 'w_db', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_b', port: 'done' } },
    { id: 'w_in1', from: { node: 'n_a', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: maxA } },
    { id: 'w_in2', from: { node: 'n_b', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: maxB } },
    { id: 'w_fix', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
});

/** A fast branch to End, a slow branch to a consumer that must never launch. */
const END_EARLY = {
  id: 'wf_end_early', name: 'End early', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'manualTestsChecklist', x: 280, y: 0, config: {} },
    { id: 'n_b', kind: 'agent', key: 'planner', x: 280, y: 240, config: {} },
    { id: 'n_c', kind: 'agent', key: 'refiner', x: 560, y: 240, config: {} },
    { id: 'n_end', kind: 'end', x: 560, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'task' } },
    { id: 'w3', from: { node: 'n_a', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w4', from: { node: 'n_b', port: 'plan' }, to: { node: 'n_c', port: 'plan' } },
  ],
};

/** Same shape, but the slow branch's blocking output rides a loop wire that is
 *  already AT its allowance — accounting and gates must be skipped in the drain. */
const DRAIN_ACCOUNTING = {
  id: 'wf_drain_acct', name: 'Drain accounting', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'manualTestsChecklist', x: 280, y: 0, config: {} },
    { id: 'n_b', kind: 'agent', key: 'refiner', x: 280, y: 240, config: {} },
    { id: 'n_end', kind: 'end', x: 560, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'plan' } },
    { id: 'w3', from: { node: 'n_a', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w4', from: { node: 'n_b', port: 'revise' }, to: { node: 'n_b', port: 'revise' }, config: { maxCycles: 1 } },
  ],
};

/** AND that never goes all-fresh: B blocks forever down a terminal side branch. */
const QUIESCE = {
  id: 'wf_quiesce', name: 'Quiesce', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'reviewer', x: 280, y: 0, config: {} },
    { id: 'n_b', kind: 'agent', key: 'workspaceReviewer', x: 280, y: 240, config: {} },
    { id: 'n_c', kind: 'agent', key: 'manualTestsChecklist', x: 560, y: 400, config: {} },
    { id: 'n_and', kind: 'and', x: 560, y: 120, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 820, y: 120, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'plan' } },
    { id: 'w3', from: { node: 'n_a', port: 'pass' }, to: { node: 'n_and', port: 'in1' } },
    { id: 'w4', from: { node: 'n_b', port: 'pass' }, to: { node: 'n_and', port: 'in2' } },
    { id: 'w5', from: { node: 'n_and', port: 'out' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w6', from: { node: 'n_b', port: 'review' }, to: { node: 'n_c', port: 'plan' } },
  ],
};

/** Two md producers into one OR, forwarding into a single consumer input. */
const OR_COLLAPSE = {
  id: 'wf_or_collapse', name: 'Or collapse', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_p1', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
    { id: 'n_p2', kind: 'agent', key: 'manualTestsChecklist', x: 280, y: 240, config: {} },
    { id: 'n_or', kind: 'or', x: 560, y: 120, config: { arity: 2 } },
    { id: 'n_c', kind: 'agent', key: 'refiner', x: 820, y: 120, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_p1', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_p2', port: 'plan' } },
    { id: 'w3', from: { node: 'n_p1', port: 'plan' }, to: { node: 'n_or', port: 'in1' } },
    { id: 'w4', from: { node: 'n_p2', port: 'checklist' }, to: { node: 'n_or', port: 'in2' } },
    { id: 'w5', from: { node: 'n_or', port: 'out' }, to: { node: 'n_c', port: 'plan' } },
  ],
};

/** Three independent agents behind one task node — the semaphore fixture. */
const FANOUT = {
  id: 'wf_fanout', name: 'Fanout', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'manualTestsChecklist', x: 280, y: 0, config: {} },
    { id: 'n_b', kind: 'agent', key: 'refiner', x: 280, y: 200, config: {} },
    { id: 'n_c', kind: 'agent', key: 'reviewer', x: 280, y: 400, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'plan' } },
    { id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_c', port: 'plan' } },
  ],
};

/** A slow branch to End racing a gate ask that never resolves. */
const END_WITH_GATE = {
  id: 'wf_end_gate', name: 'End with gate', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_a', kind: 'agent', key: 'reviewer', x: 280, y: 0, config: {} },
    { id: 'n_fast', kind: 'agent', key: 'manualTestsChecklist', x: 280, y: 400, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 0, y: 200, config: {} },
    { id: 'n_or', kind: 'or', x: 560, y: 120, config: { arity: 1 } },
    { id: 'n_end', kind: 'end', x: 820, y: 400, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'plan' } },
    { id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_fast', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_a', port: 'done' } },
    { id: 'w_in1', from: { node: 'n_a', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 1 } },
    { id: 'w_fix', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
    { id: 'w_end', from: { node: 'n_fast', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** wf_default script: both loops take exactly one blocking cycle. */
const defaultScript = () => ({
  n_clarify: () => ({ outputs: { answers: { path: '/p/clarify.json' } } }),
  n_plan: () => ({ outputs: { plan: { path: '/p/plan.md' } } }),
  n_refine: byOrdinal(
    { verdict: BLOCKING('replan'), outputs: { revise: { path: '/p/plan-v2.md' } } },
    { verdict: CLEAN, outputs: { plan: { path: '/p/plan-v2.md' } } },
  ),
  n_impl: () => ({}),
  n_review: byOrdinal(
    { verdict: BLOCKING('fixme'), outputs: { review: { path: '/p/review.md' } } },
    { verdict: CLEAN, outputs: {} },
  ),
});

/** FIXTURE_FLOW script: refiner and reviewer each block once, then pass. */
const flowScript = () => ({
  n_plan: () => ({ outputs: { plan: { path: '/p/draft.md' } } }),
  n_refine: byOrdinal(
    { verdict: BLOCKING('replan'), outputs: { revise: { path: '/p/draft.md' } } },
    { verdict: CLEAN, outputs: { plan: { path: '/p/refined.md' } } },
  ),
  n_impl: () => ({}),
  n_review: byOrdinal(
    { verdict: BLOCKING('fixme'), outputs: { review: { path: '/p/review.md' } } },
    { verdict: CLEAN, outputs: {} },
  ),
  n_check: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
});

// ---------------------------------------------------------------------------
// 1 — default graph, happy path with both loops
// ---------------------------------------------------------------------------

test('1 wf_default: one refine cycle, one fix cycle, End completes the run', async () => {
  const h = harness({ template: FIXTURE_DEFAULT, script: defaultScript() });
  assert.equal(await h.scheduler.run(), 'done');
  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_clarify c1', 'n_plan c1', 'n_refine c1', 'n_refine c2',
    'n_impl c1', 'n_review c1', 'n_impl c2', 'n_review c2', 'n_end c1',
  ]);

  const state = h.scheduler.getState();
  assert.equal(state.ended.nodeId, 'n_end');
  assert.deepEqual(state.ended.result, { type: 'void' });        // reviewer.pass is void — no path
  const pass = state.tokens['n_end.result'];
  assert.equal(state.ended.seq, pass.seq);
  assert.equal(pass.sourceExecutionId, 'x:n_review:2');          // provenance: reviewer c2
  assert.equal(pass.type, 'void');

  // The review token was bound by implementer c2 and then superseded — nothing
  // is ready at quiescence.
  const review = state.tokens['n_impl.fix'];
  assert.equal(h.last().consumed.n_impl.fix, review.seq);
  assert.equal(h.callsFor('n_impl').length, 2);
  // The task node's token carries the pre-rendered artifact path.
  assert.equal(state.tokens['n_clarify.task'].path, '/p/task.md');
  assert.equal(h.callsFor('n_task')[0].taskArtifact.path, '/p/task.md');
});

// ---------------------------------------------------------------------------
// 2 — maxCycles gate, "continue" (A1 arithmetic + A4 forced payload)
// ---------------------------------------------------------------------------

test('2 gate at allowance: continue discards the held token and force-fires the clean side', async () => {
  const ask = scriptedAsk('continue');
  const script = defaultScript();
  script.n_refine = () => ({ verdict: BLOCKING('never happy'), outputs: { revise: { path: '/p/plan-v2.md' } } });
  script.n_review = () => ({ verdict: CLEAN, outputs: {} });
  const h = harness({ template: withMaxCycles(FIXTURE_DEFAULT, 'w5', 2), script, ask });

  assert.equal(await h.scheduler.run(), 'done');
  // maxCycles 2 ⇒ allowance 1 delivery ⇒ the refiner fires exactly twice.
  assert.equal(h.callsFor('n_refine').length, 2);
  assert.equal(ask.seen.length, 1);
  assert.equal(ask.seen[0].kind, 'gate');
  assert.equal(ask.seen[0].wireId, 'w5');
  assert.deepEqual(ask.seen[0].issues, BLOCKING('never happy').issues);

  const state = h.scheduler.getState();
  const forced = state.tokens['n_impl.plan'];
  assert.equal(forced.forced, true);
  assert.equal(forced.path, '/p/plan-v2.md');                    // A4: types match, held path reused
  assert.deepEqual(forced.meta.issues, BLOCKING('never happy').issues);
  assert.ok(h.execSeq().includes('n_impl c1'));
  assert.equal(h.callsFor('n_review').length, 1);
  assert.ok(state.ended);
  assert.equal(h.last().gate, null);
  assert.equal(h.last().ask, null);
});

// ---------------------------------------------------------------------------
// 3 — gate "another"
// ---------------------------------------------------------------------------

test('3 gate another: allowance grows by one, the held token is delivered', async () => {
  const ask = scriptedAsk('another');
  const script = defaultScript();
  script.n_refine = byOrdinal(
    { verdict: BLOCKING('a'), outputs: { revise: { path: '/p/plan-v2.md' } } },
    { verdict: BLOCKING('b'), outputs: { revise: { path: '/p/plan-v3.md' } } },
    { verdict: CLEAN, outputs: { plan: { path: '/p/plan-v3.md' } } },
  );
  script.n_review = () => ({ verdict: CLEAN, outputs: {} });
  const h = harness({ template: withMaxCycles(FIXTURE_DEFAULT, 'w5', 2), script, ask });

  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_refine').length, 3);
  assert.equal(ask.seen.length, 1);
  assert.equal(h.last().wires.w5.deliveries, 2);
  assert.equal(h.last().wires.w5.allowance, 2);
  assert.ok(h.scheduler.getState().ended);
});

// ---------------------------------------------------------------------------
// 4 — OR / AND / await drain over FIXTURE_FLOW (pinned interleaving)
// ---------------------------------------------------------------------------

test('4 FIXTURE_FLOW: OR forwards payloads, AND gates the await port, End carries the result', async () => {
  const h = harness({ template: FIXTURE_FLOW, script: flowScript() });
  assert.equal(await h.scheduler.run(), 'done');
  assert.deepEqual(h.execSeq(), [
    'n_task2 c1', 'n_plan c1', 'n_refine c1', 'n_or c1', 'n_refine c2', 'n_impl c1',
    'n_or c2', 'n_review c1', 'n_impl c2', 'n_review c2', 'n_and c1', 'n_check c1', 'n_end c1',
  ]);

  const orTokens = h.tokenEvents().filter((e) => e.from.node === 'n_or');
  assert.equal(orTokens.length, 2);
  assert.deepEqual(orTokens.map((e) => e.path), ['/p/draft.md', '/p/refined.md']);
  assert.deepEqual(orTokens.map((e) => e.type), ['md', 'md']);   // resolveOrOutType

  const [andToken] = h.tokenEvents().filter((e) => e.from.node === 'n_and');
  assert.equal(andToken.type, 'void');
  assert.equal(andToken.path, null);

  // n_check binds the REFINER's plan (or c2 superseded the planner draft) and
  // waited for the AND: pass.seq < and.out.seq, and await was consumed at bind.
  const check = h.callsFor('n_check')[0];
  assert.equal(check.bindings.plan.path, '/p/refined.md');
  assert.equal(check.bindings.plan.seq, orTokens[1].seq);
  assert.equal(check.bindings.await, undefined);                 // payload discarded at bind
  const [passToken] = h.tokenEvents().filter((e) => e.from.node === 'n_review' && e.from.port === 'pass');
  assert.ok(passToken.seq < andToken.seq);
  assert.equal(h.last().consumed.n_check.await, andToken.seq);
  assert.deepEqual(check.trigger.freshPorts, ['plan']);          // first run: await absent
  assert.deepEqual(check.trigger.wireIds, ['w10', 'w13']);

  assert.deepEqual(h.scheduler.getState().ended.result, { type: 'md', path: '/p/checklist.md' });
});

// ---------------------------------------------------------------------------
// 5 — determinism
// ---------------------------------------------------------------------------

test('5 determinism: identical scripts produce identical exec sequences', async () => {
  const runOnce = async () => {
    const h = harness({ template: FIXTURE_FLOW, script: flowScript() });
    assert.equal(await h.scheduler.run(), 'done');
    return h.execEvents().map((e) => `${e.status}:${e.nodeId}:${e.ordinal}`);
  };
  assert.deepEqual(await runOnce(), await runOnce());
});

// ---------------------------------------------------------------------------
// 6 — snapshot / restore
// ---------------------------------------------------------------------------

test('6 restore: the run resumes at implementer c2 and re-runs nothing finished', async () => {
  const SENTINEL = new Error('kill');
  const script = defaultScript();
  let captured = null;
  const first = harness({ template: FIXTURE_DEFAULT, script });
  script.n_impl = (args) => {
    if (args.ordinal === 2) { captured = first.snapshots[first.snapshots.length - 1]; throw SENTINEL; }
    return {};
  };
  assert.equal(await first.scheduler.run(), 'error');
  assert.ok(captured);
  assert.equal(captured.version, 2);
  assert.equal(captured.ended, null);                            // pre-End
  assert.equal(captured.execs.every((e) => e.status !== 'start'), true);

  const resumeScript = defaultScript();
  const second = harness({ template: FIXTURE_DEFAULT, script: resumeScript, snapshot: captured });
  assert.equal(await second.scheduler.run(), 'done');
  assert.deepEqual(second.execSeq(), ['n_impl c2', 'n_review c2', 'n_end c1']);
  const finishedIds = new Set(captured.execs.map((e) => e.executionId));
  assert.equal(second.calls.some((c) => finishedIds.has(c.executionId)), false);
  assert.ok(second.scheduler.getState().ended);
});

test('6b drain resume: a snapshot with `ended` set launches nothing and only re-attaches', async () => {
  const slow = deferred();
  const first = harness({
    template: END_EARLY,
    script: {
      n_a: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
      n_b: () => slow.promise.then(() => ({ outputs: { plan: { path: '/p/plan.md' } } })),
    },
  });
  const running = first.scheduler.run();
  await tick();
  const captured = first.snapshots.find((s) => s.ended);
  assert.ok(captured);
  const inflight = captured.execs.filter((e) => e.status === 'start');
  assert.deepEqual(inflight.map((e) => e.nodeId), ['n_b']);
  assert.ok(inflight[0].bindings.task);                          // bindings persisted, not recomputed
  assert.ok(inflight[0].trigger);
  slow.resolve();
  assert.equal(await running, 'done');

  const second = harness({
    template: END_EARLY,
    snapshot: captured,
    script: { n_b: () => ({ outputs: { plan: { path: '/p/plan.md' } } }) },
  });
  assert.equal(await second.scheduler.run(), 'done');
  assert.deepEqual(second.calls.map((c) => c.executionId), [inflight[0].executionId]);
  assert.deepEqual(second.calls[0].bindings, inflight[0].bindings);
  assert.equal(second.calls[0].ordinal, inflight[0].ordinal);
  assert.equal(second.callsFor('n_c').length, 0);                // recorded, not routed
});

// ---------------------------------------------------------------------------
// 7 — fail-fast
// ---------------------------------------------------------------------------

test('7 fail-fast: an execution error errors the run and stops launching', async () => {
  const script = defaultScript();
  script.n_impl = () => { throw new Error('boom'); };
  const h = harness({ template: FIXTURE_DEFAULT, script });
  assert.equal(await h.scheduler.run(), 'error');
  assert.deepEqual(h.execSeq(), ['n_task c1', 'n_clarify c1', 'n_plan c1', 'n_refine c1', 'n_refine c2', 'n_impl c1']);
  const err = h.execEvents().find((e) => e.status === 'error');
  assert.equal(err.nodeId, 'n_impl');
  assert.equal(h.scheduler.getState().ended, null);
});

// ---------------------------------------------------------------------------
// 8 — maxParallel
// ---------------------------------------------------------------------------

test('8 maxParallel caps agent executions; flow nodes bypass the semaphore', async () => {
  const gate = deferred();
  const agent = () => gate.promise.then(() => ({}));
  const h = harness({
    template: FANOUT,
    maxParallel: 2,
    script: { n_a: agent, n_b: agent, n_c: agent },
  });
  const running = h.scheduler.run();
  await tick();
  assert.equal(h.maxInFlight(), 2);
  assert.equal(h.starts().filter((e) => e.agentKey).length, 2);
  gate.resolve();
  assert.equal(await running, 'done');
  assert.equal(h.maxInFlight(), 2);
  assert.equal(h.callsFor('n_a').length + h.callsFor('n_b').length + h.callsFor('n_c').length, 3);
});

// ---------------------------------------------------------------------------
// 9 — pause / resume
// ---------------------------------------------------------------------------

test("9 pause resolves the literal 'paused' and the snapshot resumes with no re-runs", async () => {
  const gate = deferred();
  const script = defaultScript();
  const base = script.n_refine;
  script.n_refine = (args) => gate.promise.then(() => base(args));
  const h = harness({ template: FIXTURE_DEFAULT, script });
  const running = h.scheduler.run();
  await tick();
  h.scheduler.pause();
  gate.resolve();
  assert.equal(await running, 'paused');
  const snap = h.last();
  assert.equal(snap.execs.some((e) => e.status === 'start'), false);

  const resumeScript = defaultScript();
  const second = harness({ template: FIXTURE_DEFAULT, script: resumeScript, snapshot: snap });
  assert.equal(await second.scheduler.run(), 'done');
  const before = new Set(h.calls.map((c) => c.executionId));
  assert.equal(second.calls.some((c) => before.has(c.executionId)), false);
  assert.equal(second.execSeq()[0], 'n_refine c2');
});

// ---------------------------------------------------------------------------
// 10 — abort
// ---------------------------------------------------------------------------

test('10 abort fires the in-flight signal and launches nothing further', async () => {
  const gate = deferred();
  const script = defaultScript();
  script.n_clarify = () => gate.promise.then(() => ({ outputs: { answers: { path: '/p/clarify.json' } } }));
  const h = harness({ template: FIXTURE_DEFAULT, script });
  const running = h.scheduler.run();
  await tick();
  const before = h.calls.length;
  h.scheduler.abort();
  assert.equal(await running, 'error');
  assert.equal(h.calls[before - 1].signal.aborted, true);
  gate.resolve();
  await tick();
  assert.equal(h.calls.length, before);
});

// ---------------------------------------------------------------------------
// 11 — OR-card loop fan-in
// ---------------------------------------------------------------------------

test('11 OR loop fan-in: per-wire counters stay independent across iterations', async () => {
  const h = harness({
    template: orLoop(3, 3),
    script: {
      n_impl: () => ({}),
      n_a: byOrdinal(
        { verdict: BLOCKING('a1'), outputs: { review: { path: '/p/rev-a1.md' } } },
        { verdict: CLEAN, outputs: {} },
      ),
      n_b: byOrdinal(
        { verdict: CLEAN, outputs: {} },
        { verdict: BLOCKING('b2'), outputs: { review: { path: '/p/rev-b2.md' } } },
        { verdict: CLEAN, outputs: {} },
      ),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.scheduler.getState().ended, null);              // no End node — quiescence
  assert.equal(h.callsFor('n_or').length, 2);
  assert.equal(h.last().wires.w_in1.deliveries, 1);
  assert.equal(h.last().wires.w_in2.deliveries, 1);

  const [or1, or2] = h.callsFor('n_or');
  assert.deepEqual(or1.trigger.wireIds, ['w_in1']);
  assert.deepEqual(or2.trigger.wireIds, ['w_in2']);
  const impl = h.callsFor('n_impl');
  assert.equal(impl.length, 3);
  assert.equal(impl[1].bindings.fix.path, '/p/rev-a1.md');
  assert.equal(impl[2].bindings.fix.path, '/p/rev-b2.md');
  assert.deepEqual(impl[1].trigger.wireIds, ['w_fix']);
  assert.deepEqual(impl[1].trigger.freshPorts, ['fix']);
});

test('11b OR loop fan-in: both blocking in ONE drain counts both wires but emits once', async () => {
  const h = harness({
    template: orLoop(3, 3),
    script: {
      n_impl: () => ({}),
      // Both verifiers resolve in the same microtask batch, so both publishes
      // land in ONE routing batch before the drain loop is released.
      n_a: byOrdinal(
        { verdict: BLOCKING('a1'), outputs: { review: { path: '/p/rev-a1.md' } } },
        { verdict: CLEAN, outputs: {} },
      ),
      n_b: byOrdinal(
        { verdict: BLOCKING('b1'), outputs: { review: { path: '/p/rev-b1.md' } } },
        { verdict: CLEAN, outputs: {} },
      ),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_or').length, 1);                    // same-drain collapse
  assert.equal(h.last().wires.w_in1.deliveries, 1);              // counted at DELIVERY…
  assert.equal(h.last().wires.w_in2.deliveries, 1);              // …not at bind
  const impl = h.callsFor('n_impl');
  assert.equal(impl.length, 2);
  assert.equal(impl[1].bindings.fix.path, '/p/rev-b1.md');       // the freshest bound
  const consumed = h.last().consumed.n_or;
  assert.ok(consumed.in1 && consumed.in2);                       // the older fresh token spent
});

// ---------------------------------------------------------------------------
// 12 — End drain event shape
// ---------------------------------------------------------------------------

test('12 End: an instant flow execution whose done event carries the result', async () => {
  const h = harness({ template: FIXTURE_FLOW, script: flowScript() });
  assert.equal(await h.scheduler.run(), 'done');
  const endRows = h.execEvents().filter((e) => e.nodeId === 'n_end');
  assert.deepEqual(endRows.map((e) => e.status), ['start', 'done']);
  assert.deepEqual(endRows[1].result, { type: 'md', path: '/p/checklist.md' });
  for (const row of h.execEvents().filter((e) => ['n_end', 'n_and', 'n_or', 'n_task2'].includes(e.nodeId))) {
    assert.equal(row.agentKey, null);                            // flow rows carry no agent
    assert.equal(row.kind, 'cycle');
  }
  assert.equal(h.execEvents().find((e) => e.nodeId === 'n_check').agentKey, 'manualTestsChecklist');
  assert.equal(h.execSeq().at(-1), 'n_end c1');                  // nothing launches after End
  assert.equal(h.tokenEvents().some((e) => e.from.node === 'n_end'), false);
});

// ---------------------------------------------------------------------------
// 13 — End early-finish with an in-flight execution
// ---------------------------------------------------------------------------

test('13 End drain: an in-flight execution completes and publishes, its consumer never launches', async () => {
  const slow = deferred();
  const h = harness({
    template: END_EARLY,
    script: {
      n_a: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
      n_b: () => slow.promise.then(() => ({ outputs: { plan: { path: '/p/plan.md' } } })),
    },
  });
  const running = h.scheduler.run();
  await tick();
  assert.ok(h.scheduler.getState().ended);
  slow.resolve();
  assert.equal(await running, 'done');
  assert.equal(h.callsFor('n_b').length, 1);
  assert.ok(h.tokenEvents().some((e) => e.from.node === 'n_b'));  // published…
  assert.equal(h.scheduler.getState().tokens['n_c.plan'], undefined); // …but not routed
  assert.equal(h.callsFor('n_c').length, 0);
});

// ---------------------------------------------------------------------------
// 14 — quiescence without End
// ---------------------------------------------------------------------------

test("14 quiescence without an End token resolves 'done' with ended === null", async () => {
  const h = harness({
    template: QUIESCE,
    script: {
      n_a: () => ({ verdict: CLEAN, outputs: {} }),
      n_b: () => ({ verdict: BLOCKING('nope'), outputs: { review: { path: '/p/review.md' } } }),
      n_c: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.scheduler.getState().ended, null);
  assert.equal(h.callsFor('n_and').length, 0);
  assert.equal(h.callsFor('n_end').length, 0);
  assert.equal(h.callsFor('n_c').length, 1);
});

// ---------------------------------------------------------------------------
// 15 — OR re-emission and same-drain payload collapse
// ---------------------------------------------------------------------------

test('15 OR re-emits per arriving payload across drains', async () => {
  const slow = deferred();
  const h = harness({
    template: OR_COLLAPSE,
    script: {
      n_p1: () => ({ outputs: { plan: { path: '/p/p1.md' } } }),
      n_p2: () => slow.promise.then(() => ({ outputs: { checklist: { path: '/p/p2.md' } } })),
      n_c: () => ({ verdict: CLEAN, outputs: { plan: { path: '/p/refined.md' } } }),
    },
  });
  const running = h.scheduler.run();
  await tick();
  assert.equal(h.callsFor('n_or').length, 1);
  slow.resolve();
  assert.equal(await running, 'done');
  assert.equal(h.callsFor('n_or').length, 2);
  assert.deepEqual(h.callsFor('n_c').map((c) => c.bindings.plan.path), ['/p/p1.md', '/p/p2.md']);
});

test('15b OR collapses two same-drain arrivals into one emission of the freshest', async () => {
  const h = harness({
    template: OR_COLLAPSE,
    script: {
      n_p1: () => ({ outputs: { plan: { path: '/p/p1.md' } } }),
      n_p2: () => ({ outputs: { checklist: { path: '/p/p2.md' } } }),
      n_c: () => ({ verdict: CLEAN, outputs: { plan: { path: '/p/refined.md' } } }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.callsFor('n_or').length, 1);
  assert.deepEqual(h.callsFor('n_c').map((c) => c.bindings.plan.path), ['/p/p2.md']);
});

// ---------------------------------------------------------------------------
// 16 — drain accounting + error during the drain
// ---------------------------------------------------------------------------

test('16 End drain skips loop accounting and gates for a late blocking publish', async () => {
  const slow = deferred();
  const ask = scriptedAsk('continue');
  const h = harness({
    template: DRAIN_ACCOUNTING,
    ask,
    script: {
      n_a: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
      n_b: () => slow.promise.then(() => ({ verdict: BLOCKING('late'), outputs: { revise: { path: '/p/plan-v2.md' } } })),
    },
  });
  const running = h.scheduler.run();
  await tick();
  assert.ok(h.scheduler.getState().ended);
  slow.resolve();
  assert.equal(await running, 'done');
  assert.equal(ask.seen.length, 0);                              // gates skipped in the drain
  assert.equal(h.last().wires.w4.deliveries, 0);                 // accounting skipped
  assert.ok(h.tokenEvents().some((e) => e.from.node === 'n_b' && e.from.port === 'revise'));
  assert.equal(h.callsFor('n_b').length, 1);
});

test("16b an error during the End drain still errors the run", async () => {
  const slow = deferred();
  const h = harness({
    template: DRAIN_ACCOUNTING,
    script: {
      n_a: () => ({ outputs: { checklist: { path: '/p/checklist.md' } } }),
      n_b: () => slow.promise.then(() => { throw new Error('late boom'); }),
    },
  });
  const running = h.scheduler.run();
  await tick();
  assert.ok(h.scheduler.getState().ended);
  slow.resolve();
  assert.equal(await running, 'error');
});

// ---------------------------------------------------------------------------
// 17 — OR-loop gate, "continue" escapes via the source's clean side
// ---------------------------------------------------------------------------

test('17 OR-loop gate: continue force-fires the SOURCE clean output, never the valve', async () => {
  const ask = scriptedAsk('continue');
  const h = harness({
    template: orLoop(2, 3),
    ask,
    script: {
      n_impl: () => ({}),
      n_a: () => ({ verdict: BLOCKING('always'), outputs: { review: { path: '/p/rev-a.md' } } }),
      n_b: () => ({ verdict: CLEAN, outputs: {} }),
    },
  });
  assert.equal(await h.scheduler.run(), 'done');
  assert.equal(h.scheduler.getState().ended, null);              // A's forced pass is unwired ⇒ terminal
  assert.equal(ask.seen.length, 1);
  assert.equal(ask.seen[0].wireId, 'w_in1');                     // the IN-wire, never w_fix
  assert.deepEqual(ask.seen[0].issues, BLOCKING('always').issues);

  const forced = h.last().outputs['n_a.pass'];
  assert.equal(forced.forced, true);
  assert.equal(forced.type, 'void');
  assert.equal(forced.path, null);                               // A4 fallback: types differ, no latch
  assert.deepEqual(forced.meta.issues, BLOCKING('always').issues);

  assert.equal(h.callsFor('n_or').length, 1);                    // the valve never fired for the held token
  assert.equal(h.callsFor('n_impl').length, 2);
  assert.equal(h.last().wires.w_in2.deliveries, 0);              // B's budget untouched
  assert.equal(h.last().wires.w_in1.deliveries, 1);
});

// ---------------------------------------------------------------------------
// 18 — End with a pending gate ask (withdrawal)
// ---------------------------------------------------------------------------

test('18 End withdraws a pending gate ask; a late answer is a no-op', async () => {
  const slow = deferred();
  let answer = null;
  const asked = [];
  const h = harness({
    template: END_WITH_GATE,
    ask: (q) => { asked.push(q); return new Promise((res) => { answer = res; }); },
    script: {
      n_impl: () => ({}),
      n_a: () => ({ verdict: BLOCKING('held'), outputs: { review: { path: '/p/rev.md' } } }),
      n_fast: () => slow.promise.then(() => ({ outputs: { checklist: { path: '/p/checklist.md' } } })),
    },
  });
  const running = h.scheduler.run();
  await tick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].wireId, 'w_in1');
  assert.equal(h.last().ask.wireId, 'w_in1');                    // held while outstanding
  slow.resolve();
  assert.equal(await running, 'done');                           // run() never blocks on the ask

  const state = h.scheduler.getState();
  assert.ok(state.ended);
  assert.equal(h.last().gate, null);                             // withdrawn, not held
  assert.equal(h.last().ask, null);

  const eventsBefore = h.events.length;
  const callsBefore = h.calls.length;
  answer('another');
  await tick();
  assert.equal(h.events.length, eventsBefore);                   // no event, no force-fire, no re-ask
  assert.equal(h.calls.length, callsBefore);
  assert.equal(asked.length, 1);
  // allowance 0 ⇒ the FIRST blocking delivery was held; the late answer must
  // not deliver it after the fact.
  assert.equal(h.last().wires.w_in1.deliveries, 0);
  assert.deepEqual(h.scheduler.getState().ended, state.ended);
});
