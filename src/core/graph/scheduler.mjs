// src/core/graph/scheduler.mjs
// The single-owner dataflow loop of the v2 graph engine: the token store, the
// drain/launch walk, per-wire loop budgets and their human gates, End completion
// and the resume-v2 snapshot.
//
// Shape of a pass: publishing routes tokens IMMEDIATELY (per-wire delivery counting
// and gate checks happen AT DELIVERY), but FIRING happens only in the drain loop. A
// pass walks `loops.launchOrder` ONCE; a node ready at its slot fires AT that slot —
// agent nodes as an async `execute` under the semaphore, flow nodes inline,
// whose publishes route immediately and may make LATER slots ready within the same
// pass. Earlier slots are never revisited mid-pass; passes repeat until a pass fires
// nothing. The execution sequence is therefore the order of `execute` CALLS, and it
// is deterministic.
//
// EVERY node's execution is routed through the injected `execute` — flow kinds
// inline and outside the semaphore, agent kinds under it. The scheduler never
// reads an agent key and does no IO.
//
// `rerunPending` coalescing is structural: a node that is already running is skipped
// in the walk, and readiness is re-evaluated after every completion, so readiness
// reached while running re-fires exactly once and never queues.
import { FLOW_KINDS, DEFAULT_MAX_CYCLES, AWAIT_PORT } from '../../shared/graph/constants.mjs';
import { classifyLoops } from '../../shared/graph/loops.mjs';
import { firedOutputs, resolveOrOutType } from '../../shared/graph/ports.mjs';
import { blockingIssues, hasBlocking } from '../../shared/graph/verdict.mjs';

/** Execution statuses that need no re-invocation on restore. */
const TERMINAL = new Set(['done', 'error', 'skipped']);
/** The reserved synthesized gate input: bound for readiness, never a payload, never a mode. */
const AWAIT_ID = AWAIT_PORT.id;
/** The §3 completion warning for a run that quiesced without reaching End (A8: ONE literal). */
export const QUIESCENCE_WARNING = 'finished at quiescence — End not reached';

function defaultMaxParallel() {
  const n = Number(process.env.WORCA_MAX_PARALLEL);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** Non-interactive default: gates continue, clarify asks answer empty (v1 `_ask` auto). */
const defaultAsk = async (ask) => (ask?.kind === 'gate' ? 'continue' : []);

/**
 * The execution id of one composite sub-execution: the parent's id plus the manifest
 * task id (`x:n_impl:1:p1t1`). Deterministic on purpose — a resumed composite
 * re-mints the SAME ids, so its ledger entries overwrite rather than accumulate.
 * @param {string} parentExecutionId
 * @param {string} taskId
 */
export function sliceExecutionId(parentExecutionId, taskId) {
  return `${parentExecutionId}:${taskId}`;
}

/** An abort rejection — a sibling cancelled by a phase-mate's failure, or the whole
 *  run going down. Never counted as the FIRST genuine failure. */
const isAbortError = (err) => err?.name === 'AbortError';

/**
 * Settle with the promise, or reject with the signal's reason the moment it aborts.
 * The scheduler never WAITS on an executor that ignores its signal: fail-fast and
 * abort resolve the run while stalled work is still pending (the top-level path has
 * the same property through `finish`). `AbortSignal.any`'s reason is an AbortError.
 */
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * Build a scheduler over a resolved v2 template.
 *
 * @param {object} opts
 * @param {object} opts.template   v2 template `{ nodes, wires }`
 * @param {(node:object) => ({inputs?:Array, outputs?:Array, verdict?:object}|undefined)} opts.portsFn
 * @param {{loopWireIds:Set<string>, loopInputs:Set<string>, launchOrder:string[]}} [opts.loops]
 * @param {(args:object) => Promise<object>} opts.execute
 * @param {(name:'exec'|'token'|'gate', payload:object) => void} [opts.onEvent]
 * @param {(snapshot:object) => void} [opts.onSnapshot]
 * @param {(gate:{wireId,fromNode,toNode,askId}|null) => void} [opts.onGate]
 * @param {(ask:object) => Promise<any>} [opts.onAsk]
 * @param {number} [opts.maxParallel]
 * @param {(line:string, attrs?:object) => void} [opts.log]
 */
export function createScheduler(opts) {
  const {
    template,
    portsFn,
    execute,
    loops = classifyLoops(template, portsFn),
    onEvent = () => {},
    onSnapshot = () => {},
    onGate = () => {},
    onAsk = defaultAsk,
    maxParallel = defaultMaxParallel(),
    log = () => {},
  } = opts || {};

  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wires = (Array.isArray(template?.wires) ? template.wires : [])
    .filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node));
  const wireById = new Map(wires.map((w) => [w.id, w]));
  const loopWireIds = new Set(loops?.loopWireIds || []);
  const loopInputs = new Set(loops?.loopInputs || []);
  const order = Array.isArray(loops?.launchOrder) && loops.launchOrder.length
    ? loops.launchOrder.filter((id) => nodeById.has(id))
    : nodes.map((n) => n.id);

  // Static wiring indexes. `wiredIn` is keyed by BARE port id per node; `outWires`
  // fans a fired output out to its wires.
  const wiredIn = new Map(nodes.map((n) => [n.id, new Map()]));
  const outWires = new Map();
  for (const w of wires) {
    wiredIn.get(w.to.node).set(w.to.port, w.id);
    const key = `${w.from.node}.${w.from.port}`;
    if (!outWires.has(key)) outWires.set(key, []);
    outWires.get(key).push(w);
  }

  // --- run state -----------------------------------------------------------
  let seq = 0;
  const tokens = new Map();       // '<node>.<inputPort>'  -> delivered token
  const outputs = new Map();      // '<node>.<outputPort>' -> latched token
  const consumed = new Map();     // nodeId -> Map(port -> seq), recorded at bind
  const ordinals = new Map();     // nodeId -> executions started
  const wireState = new Map();    // loop wireId -> { deliveries, allowance }
  const execs = new Map();        // executionId -> ledger entry
  const held = new Map();         // wireId -> { wireId, nodeId, executionId, token, issues, askId }
  const outstanding = new Set();  // wireIds with an un-withdrawn ask in flight
  const running = new Map();      // nodeId -> executionId
  const completions = [];
  const warnings = [];
  const controller = new AbortController();
  let activeAgents = 0;
  let ended = null;
  let gate = null;                // the CURRENT gate for state.gate (P4 stamps it)
  let failure = null;
  let pauseRequested = false;
  let abortRequested = false;
  let settled = false;

  for (const id of loopWireIds) {
    const raw = Number(wireById.get(id)?.config?.maxCycles ?? DEFAULT_MAX_CYCLES);
    const maxCycles = Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_MAX_CYCLES;
    wireState.set(id, { deliveries: 0, allowance: maxCycles - 1 });     // A1: allowance = maxCycles − 1
  }

  // --- wake plumbing -------------------------------------------------------
  let signalled = false;
  let waiter = null;
  function wake() {
    signalled = true;
    if (waiter) { const w = waiter; waiter = null; w(); }
  }
  async function waitForChange() {
    if (signalled) { signalled = false; return; }
    await new Promise((res) => { waiter = res; });
    signalled = false;
  }

  // --- the agent semaphore -------------------------------------------------
  // A counting semaphore with a FIFO waiter queue. The drain walk POLLS it before
  // launching a node; composite slices AWAIT it (they are launched from inside an
  // already-running execution). The composite SHELL holds no slot, which is what
  // keeps a fan-out from deadlocking behind itself at maxParallel 1.
  const slotQueue = [];
  function takeSlot() {
    if (activeAgents < maxParallel) { activeAgents += 1; return Promise.resolve(); }
    return new Promise((resolve) => { slotQueue.push(resolve); });
  }
  function freeSlot() {
    const next = slotQueue.shift();
    if (next) { next(); return; }             // handed straight over: the count is unchanged
    activeAgents -= 1;
    wake();                                   // a freed slot may unblock a queued launch
  }

  // --- small helpers -------------------------------------------------------
  /** This scheduler's 1-arg ports lookup (the shared `portsOf(portsFn, node)` is 2-arg). */
  const portsOfNode = (node) => (typeof portsFn === 'function' ? portsFn(node) : null) || {};
  const isFlow = (node) => FLOW_KINDS.includes(node.kind);   // FLOW_KINDS is a frozen ARRAY (P1)
  const spentOf = (nodeId) => consumed.get(nodeId) || new Map();

  /** A port is a loop input when the classification says so OR its meta declares it.
   *  Both halves are load-bearing: `or.out -> agent.fix` is an ALWAYS-sourced wire
   *  (never a classified loop wire) into a `loop:true` port, and only the meta half
   *  excuses it from the first-run barrier. */
  const isLoopPort = (nodeId, port) => Boolean(port?.loop) || loopInputs.has(`${nodeId}.${port?.id}`);

  function makeToken({ type, path = null, value = null, meta = null, sourceExecutionId = null, forced = false }) {
    seq += 1;
    return { seq, type, path, value, meta, firedAt: Date.now(), sourceExecutionId, forced };
  }

  /** The payload half of a token, materialized only where it exists. */
  function payloadOf(token) {
    const out = { seq: token.seq, type: token.type };
    if (token.path != null) out.path = token.path;
    if (token.value != null) out.value = token.value;
    if (token.meta != null) out.meta = token.meta;
    if (token.forced) out.forced = true;
    return out;
  }

  function emitExec(node, entry, status, extra) {
    onEvent('exec', {
      nodeId: node.id,
      executionId: entry.executionId,
      kind: entry.kind,
      ordinal: entry.ordinal,
      status,
      agentKey: node.kind === 'agent' ? (node.key ?? null) : null,   // flow rows carry none
      trigger: entry.trigger,
      // Composite sub-executions carry their slice identity; the UI collapses them
      // under the node and labels them by title (A9: taskIndex/taskTotal ride along).
      ...(entry.kind === 'task'
        ? { phase: entry.phase, taskId: entry.taskId, title: entry.title, parentExecutionId: entry.parentExecutionId,
          taskIndex: entry.taskIndex, taskTotal: entry.taskTotal }
        : null),
      ...(extra || null),
    });
  }

  function emitToken(node, port, token) {
    onEvent('token', {
      seq: token.seq,
      from: { node: node.id, port: port.id },
      to: (outWires.get(`${node.id}.${port.id}`) || [])
        .map((w) => ({ node: w.to.node, port: w.to.port, wireId: w.id })),
      type: token.type,
      path: token.path,
      forced: token.forced,
      firedAt: token.firedAt,
      sourceExecutionId: token.sourceExecutionId,
    });
  }

  // --- binding -------------------------------------------------------------

  /**
   * Latch this execution's inputs. Every input holding a token is bound (a
   * re-execution binds latched values for its non-triggering inputs) and spent in
   * `consumed`; the OR card binds ONLY the freshest fresh input, so the older fresh
   * tokens are spent at that same bind without being bound.
   */
  function bindFor(node) {
    const inputs = portsOfNode(node).inputs || [];
    const spent = spentOf(node.id);
    const present = [];
    for (const inp of inputs) {
      const token = tokens.get(`${node.id}.${inp.id}`);
      if (!token) continue;
      const prior = spent.get(inp.id);
      present.push({ port: inp.id, token, fresh: prior === undefined || token.seq > prior });
    }

    let bound = present;
    if (node.kind === 'or') {
      const freshest = present
        .filter((p) => p.fresh)
        .reduce((best, p) => (best && best.token.seq >= p.token.seq ? best : p), null);
      bound = freshest ? [freshest] : [];
    }

    const bindings = {};
    for (const p of bound) {
      if (p.port === AWAIT_ID) continue;             // consumed for the barrier, payload discarded
      bindings[p.port] = payloadOf(p.token);
    }
    const fresh = present.filter((p) => p.fresh);
    return {
      bindings,
      present,
      trigger: {
        wireIds: fresh.map((p) => wiredIn.get(node.id)?.get(p.port)).filter(Boolean),
        // A3: only a FRESH port selects the mode. `await` never does — it is a barrier,
        // not a payload, so it is never listed (first executions and re-fires alike).
        freshPorts: fresh.filter((p) => p.port !== AWAIT_ID).map((p) => p.port),
      },
    };
  }

  function commitBind(node, present) {
    let spent = consumed.get(node.id);
    if (!spent) { spent = new Map(); consumed.set(node.id, spent); }
    for (const p of present) spent.set(p.port, p.token.seq);
  }

  // --- launching -----------------------------------------------------------

  function startExecution(node) {
    const ordinal = (ordinals.get(node.id) || 0) + 1;
    const executionId = `x:${node.id}:${ordinal}`;
    const b = bindFor(node);                 // reads `consumed` — bind BEFORE the bump
    ordinals.set(node.id, ordinal);
    commitBind(node, b.present);
    const entry = {
      executionId,
      nodeId: node.id,
      kind: 'cycle',
      ordinal,
      status: 'start',
      sessionId: null,
      bindings: b.bindings,
      trigger: b.trigger,
    };
    const expandsPort = expandsTrigger(node, b);
    if (expandsPort) entry.expandsPort = expandsPort;
    execs.set(executionId, entry);
    running.set(node.id, executionId);
    emitExec(node, entry, 'start');
    return { node, entry, args: argsFor(node, entry), composite: !!expandsPort };
  }

  function argsFor(node, entry) {
    return {
      node,
      executionId: entry.executionId,
      ordinal: entry.ordinal,
      bindings: entry.bindings,
      trigger: entry.trigger,
      signal: controller.signal,
    };
  }

  /** Flow cards run inline at their slot so their publishes reach later slots. */
  async function fireFlow(node) {
    const h = startExecution(node);
    let res = null;
    let err = null;
    try { res = await execute(h.args); } catch (e) { err = e; }
    settle(h, res, err);
  }

  /** Agent nodes take a semaphore slot; `execute` is called AT the slot. */
  function fireAgent(node) {
    const h = startExecution(node);
    if (!h.composite) activeAgents += 1;
    let p;
    try { p = invoke(h); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(
      (res) => { completions.push({ h, res, err: null }); wake(); },
      (err) => { completions.push({ h, res: null, err }); wake(); },
    );
  }

  /** Run one started execution: the composite driver, or the plain injected call. */
  function invoke(h) {
    return h.composite ? runComposite(h) : execute(h.args);
  }

  /**
   * The FRESH `expands` input that makes this firing COMPOSITE, or null.
   *
   * A3, parity-mandatory: a fresh LOOP input wins outright — a fix-cycle re-fire runs
   * ONE ordinary execution on the combined diff, which is v1's `!bus.review` arm of
   * the same guard. A latched expands token never fans out again either, because only
   * FRESH ports are considered.
   */
  function expandsTrigger(node, b) {
    if (isFlow(node)) return null;
    const inputs = portsOfNode(node).inputs || [];
    const fresh = new Set(b.trigger.freshPorts || []);
    if (inputs.some((inp) => isLoopPort(node.id, inp) && fresh.has(inp.id))) return null;
    const port = inputs.find((inp) => inp?.expands && fresh.has(inp.id) && b.bindings[inp.id]);
    return port ? port.id : null;
  }

  /**
   * Drive ONE composite execution. Phases run in order, each phase's tasks in
   * parallel under the semaphore, and the single value returned here is what the node
   * PUBLISHES — so its outputs fire exactly once, after the last phase, never once
   * per task. Pause/abort is checked at every phase boundary.
   */
  async function runComposite(h) {
    const portId = h.entry.expandsPort;
    const expanded = await execute({ ...h.args, composite: 'expand', expandsPort: portId });
    const phases = Array.isArray(expanded?.phases) ? expanded.phases : [];
    if (!phases.length) return runUnexpanded(h, portId);

    // A halted run returns WITHOUT `finish`: nothing is staged and no phase is falsely
    // marked done. A PAUSE answers `{ paused: true }` so the shell row stays
    // non-terminal and the resume re-runs the whole fan-out; any other halt (End,
    // abort, failure) answers `{ skipped: true }` — the base spec's Completion
    // paragraph puts "anything cut off by the End drain" in `skipped`. The old
    // `{ outputs: {} }` was read as a SUCCESSFUL completion: the ledger row said
    // `done` although finish() never ran, and an empty (path:null) token latched
    // into the snapshot and animated in the monitor.
    const bail = (paused) => (paused || pauseRequested ? { paused: true } : { skipped: true });
    for (const ph of phases) {
      if (halted()) return bail(false);
      const { paused } = await runPhase(h, portId, ph);
      if (paused || halted()) return bail(paused);
    }
    return await execute({ ...h.args, composite: 'finish', expandsPort: portId, phases });
  }

  /**
   * Nothing to fan out. Strip the expands binding — so the consumer neither sees the
   * manifest as an input nor renders its slice directive (A3) — and run the ONE
   * ordinary execution the firing would have been. The entry is mutated in place
   * because it is the ledger row a resume would re-invoke from.
   */
  async function runUnexpanded(h, portId) {
    const { node, entry } = h;
    const wireId = wiredIn.get(node.id)?.get(portId);
    delete entry.bindings[portId];
    entry.trigger = {
      wireIds: (entry.trigger.wireIds || []).filter((w) => w !== wireId),
      freshPorts: (entry.trigger.freshPorts || []).filter((p) => p !== portId),
    };
    delete entry.expandsPort;
    h.composite = false;                    // … so settle() frees the slot taken here
    await takeSlot();
    h.args = argsFor(node, entry);
    return await execute(h.args);
  }

  /**
   * One phase: every task launched together, each awaiting its own semaphore slot.
   * The FIRST genuine (non-abort) failure aborts its siblings immediately through the
   * phase-local controller and fails the whole composite — v1's abort-on-first-
   * failure, kept. Returns `{ paused }` — true when any slice answered `{ paused: true }`.
   */
  async function runPhase(h, portId, ph) {
    const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
    const phaseAbort = new AbortController();
    let firstError = null;
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'running' });

    const results = await Promise.allSettled(tasks.map((task, index) =>
      runSlice(h, portId, ph, task, index, phaseAbort).catch((err) => {
        // The slice already aborted its phase-mates (see runSlice); record the FIRST
        // genuine failure as the composite's error.
        if (!firstError && !isAbortError(err)) firstError = { task, err };
        throw err;
      })));

    if (firstError) {
      await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'error' });
      const label = firstError.task.title || firstError.task.id;
      throw new Error(
        `composite execution failed in phase ${ph.ordinal}: task "${label}": ` +
        `${firstError.err?.message || firstError.err}`,
      );
    }
    const paused = results.some((r) => r.status === 'fulfilled' && r.value?.paused === true);
    // A halted or paused run leaves the phase RUNNING: the resume re-runs the whole
    // composite, and a phase that never finished must not read as done.
    if (paused || halted()) return { paused };
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'done' });
    return { paused: false };
  }

  /**
   * One task sub-execution: the consumer node with its expands input rebound to this
   * task's own markdown file, still FRESH so the slice directive renders, and its
   * phase-mates listed in `slice.siblings` (the shared-working-tree block). Recorded
   * `kind:'task'` under the SAME node — it publishes nothing; `finish` does that.
   * The adapter's `{ paused: true }` / `{ error }` answers are honored exactly as
   * `settle` honors them for a top-level execution.
   */
  async function runSlice(h, portId, ph, task, index, phaseAbort) {
    const { node, entry } = h;
    const signal = AbortSignal.any([controller.signal, phaseAbort.signal]);
    await takeSlot();
    // A slot handed over AFTER the phase (or the run) aborted: never launch. The slice
    // gets no ledger row (it never started) and rejects with the abort reason, so it
    // is not counted as the phase's failure.
    if (signal.aborted) { freeSlot(); throw signal.reason; }
    const sub = {
      executionId: sliceExecutionId(entry.executionId, task.id),
      nodeId: node.id,
      kind: 'task',
      ordinal: entry.ordinal,
      status: 'start',
      sessionId: null,
      phase: ph.ordinal,
      taskId: task.id,
      title: task.title || task.id,
      parentExecutionId: entry.executionId,
      taskIndex: index + 1,                                   // 1-based within its phase (the CLI's "task 3/7")
      taskTotal: (Array.isArray(ph.tasks) ? ph.tasks : []).length,
      bindings: {
        ...entry.bindings,
        [portId]: { seq: entry.bindings[portId]?.seq, type: 'md', path: task.path ?? null },
      },
      trigger: entry.trigger,
    };
    execs.set(sub.executionId, sub);
    emitExec(node, sub, 'start');
    const args = {
      ...argsFor(node, sub),
      node: { ...node },
      signal,
      kind: 'task',
      parentExecutionId: sub.parentExecutionId,   // the adapter's ledger row + exec_meta read these three
      taskIndex: sub.taskIndex,
      taskTotal: sub.taskTotal,
      slice: {
        id: task.id,
        title: task.title ?? null,
        phase: ph.ordinal,
        path: task.path ?? null,
        index,
        siblings: (Array.isArray(ph.tasks) ? ph.tasks : [])
          .filter((t) => t.id !== task.id)
          .map((t) => ({ id: t.id, title: t.title ?? null, file: t.file ?? null })),
      },
    };
    try {
      const res = await raceAbort(execute(args), signal);
      if (res?.error) throw (res.error instanceof Error ? res.error : new Error(String(res.error)));
      sub.status = res?.paused === true ? 'paused' : 'done';
      if (res?.sessionId) sub.sessionId = res.sessionId;
      emitExec(node, sub, sub.status);
      return res;
    } catch (err) {
      sub.status = 'error';
      sub.error = String(err?.message || err);
      emitExec(node, sub, 'error', { error: sub.error });
      // Fail-fast: the FIRST genuine failure aborts its phase-mates HERE — before the
      // slot is handed on in `finally` — so a queued sibling wakes up already aborted
      // and never launches.
      if (!isAbortError(err)) phaseAbort.abort();
      throw err;
    } finally {
      freeSlot();
    }
  }

  function settle(h, res, err) {
    running.delete(h.node.id);
    if (!isFlow(h.node) && !h.composite) freeSlot();
    if (err || res?.error) failExecution(h, err || res.error);
    else if (res?.paused === true) pausedExecution(h);
    else if (res?.skipped === true) skippedExecution(h);
    else completeExecution(h, res || {});
  }

  /**
   * The execution was CUT SHORT by a terminal run condition (the End drain, an abort,
   * a sibling's failure) rather than completing. TERMINAL, so a resume never re-invokes
   * it, but it publishes NOTHING — no token event, no latched payload, and no `done`
   * in the ledger for work that did not happen.
   */
  function skippedExecution(h) {
    const { node, entry } = h;
    entry.status = 'skipped';
    emitExec(node, entry, 'skipped');
    snap();
  }

  function completeExecution(h, res) {
    const { node, entry } = h;
    entry.status = 'done';
    // An execution may report NON-FATAL problems (a verifier that never wrote its
    // verdict, MAJ-10). The scheduler owns `warnings` and the injected `log`, so
    // they ride the execution result rather than a second channel.
    for (const w of Array.isArray(res?.warnings) ? res.warnings : []) {
      const text = String(w || '');
      if (!text) continue;
      warnings.push(text);
      log(text);
    }
    if (res?.sessionId) entry.sessionId = res.sessionId;
    emitExec(node, entry, 'done', {
      ...(node.kind === 'end' ? { result: boundResult(entry) } : null),
      ...(res?.verdict ? { verdict: { hasBlocking: hasBlocking(res.verdict), ...(res.verdict.missing ? { missing: true } : {}) } } : null),
    });
    publish(node, entry, res);
    snap();
  }

  function failExecution(h, err) {
    const { node, entry } = h;
    entry.status = 'error';
    entry.error = String(err?.message || err);
    emitExec(node, entry, 'error', { error: entry.error });
    failure = err;
    controller.abort();                       // fail-fast aborts everything in flight
    snap();
  }

  /**
   * A pause cancelled this execution (or, for a composite shell, one of its slices).
   * The row stays NON-TERMINAL and nothing is published, so `reattach` re-invokes it
   * with the recorded args on resume.
   */
  function pausedExecution(h) {
    const { node, entry } = h;
    entry.status = 'paused';
    emitExec(node, entry, 'paused');
    // The EXECUTION paused the run (the adapter's ask-then-resume path, or its pause
    // abort): treat it exactly like pause() — nothing else launches and run() resolves
    // 'paused' once the in-flight work drains — instead of quiescing to a false 'done'.
    pauseRequested = true;
    snap();
  }

  // --- publishing / routing ------------------------------------------------

  /** End's result is derived from the token the SCHEDULER bound, never from the
   *  execution's (informational) return value. Shape per A7: {type, path?, value?}. */
  function boundResult(entry) {
    const bound = Object.values(entry.bindings)[0] || {};
    const result = { type: bound.type ?? 'void' };
    if (bound.path != null) result.path = bound.path;
    if (bound.value != null) result.value = bound.value;
    return result;
  }

  function publish(node, entry, res) {
    if (node.kind === 'end') {
      ended = {
        nodeId: node.id,
        executionId: entry.executionId,
        seq: Object.values(entry.bindings)[0]?.seq ?? null,
        result: boundResult(entry),
      };
      withdrawGates();                        // no run() may block on a pending ask now
      return;                                 // zero outputs — the publish step fires no token
    }
    const verdict = res?.verdict ?? null;
    for (const port of firedOutputs(portsOfNode(node).outputs || [], verdict)) {
      const token = makeToken({
        type: outTypeOf(node, port),
        ...payloadFor(node, port, entry, res),
        sourceExecutionId: entry.executionId,
      });
      emitToken(node, port, token);
      outputs.set(`${node.id}.${port.id}`, token);
      route(node, port, token, verdict, entry.executionId);
    }
  }

  const outTypeOf = (node, port) => (node.kind === 'or'
    ? (resolveOrOutType(template, portsFn, node.id) ?? port.type)
    : port.type);

  function payloadFor(node, port, entry, res) {
    // The OR valve re-emits the token IT bound — payload AND provenance (an A4
    // forced token keeps its flag and its open issues through the valve); the AND
    // card is a pure synchronizer and emits void.
    if (node.kind === 'or') {
      const bound = Object.values(entry.bindings)[0] || {};
      return { path: bound.path ?? null, value: bound.value ?? null, meta: bound.meta ?? null, forced: !!bound.forced };
    }
    if (node.kind === 'and') return { path: null, value: null };
    const given = res?.outputs?.[port.id];
    if (given) return { path: given.path ?? null, value: given.value ?? null };
    return { path: null, value: null };
  }

  /**
   * Deliver a token along every wire out of a fired port. Loop-wire deliveries are
   * counted and gated HERE, per wire — before, and independently of, any downstream
   * bind. During the End drain nothing is routed at all: the token is recorded
   * (latched + evented) and accounting/gates are skipped.
   */
  function route(node, port, token, verdict, executionId) {
    if (ended) return;
    for (const w of outWires.get(`${node.id}.${port.id}`) || []) {
      const st = wireState.get(w.id);
      if (st) {
        if (st.deliveries >= st.allowance) { holdAt(w, token, verdict, node, executionId); continue; }
        st.deliveries += 1;
      }
      tokens.set(`${w.to.node}.${w.to.port}`, token);
    }
  }

  // --- gates ---------------------------------------------------------------

  /** The current gate descriptor for `state.gate` — the FIRST hold, or null. */
  function syncGate() {
    const first = held.values().next().value || null;
    const w = first ? wireById.get(first.wireId) : null;
    const next = first && w
      ? { wireId: first.wireId, fromNode: w.from.node, toNode: w.to.node, askId: first.askId }
      : null;
    const changed = JSON.stringify(next ?? null) !== JSON.stringify(gate ?? null);
    gate = next;
    if (changed) onGate(gate ? { ...gate } : null);
  }

  function askGate(entry) {
    Promise.resolve(onAsk({
      id: entry.askId,
      kind: 'gate',
      wireId: entry.wireId,
      nodeId: entry.nodeId,
      executionId: entry.executionId,
      issues: entry.issues,
      // The CYCLE this hold stands in for, and WHICH hold it is. Both ride the
      // payload because the id is opaque: a re-held wire suffixes `-h<holdNo>`,
      // so anything parsing a trailing number off the id reads the hold ordinal
      // as the cycle (src/cli/render.mjs formatGateHeader).
      deliveryNo: entry.deliveryNo,
      holdNo: entry.holdNo,
    })).then(
      (answer) => resolveGate(entry.wireId, answer),
      () => resolveGate(entry.wireId, 'continue'),
    );
  }

  /** Past the allowance: HOLD the token and ask the human. "Open issues" = the
   *  critical/major findings that caused the block; they ride the ask and, on
   *  continue, the forced token's meta. A wire that is ALREADY held keeps its first
   *  hold — a later over-budget token on the same wire is dropped, so one ask never
   *  answers for a token it was not raised about.
   *
   *  The ask id is UNIQUE PER HOLD. resolveGate('continue') advances neither
   *  counter, so the next blocking token on the same spent wire holds again with the
   *  same deliveryNo; minting the same id twice let a retried/duplicated answer
   *  resolve a hold the user never saw (run-harness.answer matches by id), and made
   *  the two holds indistinguishable in the audit trail. `st.holds` is monotonic per
   *  wire and rides the snapshot with the rest of the wire state, so a resume keeps
   *  counting. The first hold keeps the original `gate-<wireId>-<deliveryNo>`. */
  function holdAt(wire, token, verdict, node, executionId) {
    if (held.has(wire.id)) return;
    const st = wireState.get(wire.id);
    const deliveryNo = st.deliveries + 1;           // the delivery this hold stands in for
    const holdNo = (st.holds = (st.holds || 0) + 1); // which hold on THIS wire (1-based)
    const issues = blockingIssues(verdict);
    const askId = holdNo > 1
      ? `gate-${wire.id}-${deliveryNo}-h${holdNo}`
      : `gate-${wire.id}-${deliveryNo}`;
    const entry = { wireId: wire.id, nodeId: node.id, executionId, token, issues, askId, deliveryNo, holdNo };
    held.set(wire.id, entry);
    outstanding.add(wire.id);
    onEvent('gate', {
      wireId: wire.id, nodeId: node.id, executionId, issues, askId, deliveryNo, holdNo, status: 'held',
    });
    syncGate();
    askGate(entry);
  }

  function resolveGate(wireId, answer) {
    if (settled) return;                      // the run already resolved: the resume re-asks this hold (P3-36)
    if (!outstanding.has(wireId)) return;     // withdrawn by End (or already answered) — a no-op
    outstanding.delete(wireId);
    const entry = held.get(wireId);
    held.delete(wireId);
    syncGate();
    if (!entry) return;
    const decision = answer === 'another' ? 'another' : 'continue';
    onEvent('gate', {
      wireId, nodeId: entry.nodeId, executionId: entry.executionId,
      issues: entry.issues, askId: entry.askId,
      deliveryNo: entry.deliveryNo, holdNo: entry.holdNo, status: decision,
    });
    if (decision === 'another') {
      const st = wireState.get(wireId);
      st.allowance += 1;
      st.deliveries += 1;
      const w = wireById.get(wireId);
      tokens.set(`${w.to.node}.${w.to.port}`, entry.token);
    } else {
      forceClean(entry);
    }
    snap();
    wake();
  }

  /**
   * A4: on "continue" the held blocking token is discarded and each of the SOURCE
   * node's clean outputs force-fires — payload = the held token's path/value when
   * the port types match, else the clean port's latched payload, else null;
   * `forced` + the open issues in meta either way.
   */
  function forceClean(entry) {
    const node = nodeById.get(entry.nodeId);
    if (!node) return;
    for (const port of (portsOfNode(node).outputs || []).filter((o) => o.when === 'clean')) {
      const latched = outputs.get(`${node.id}.${port.id}`);
      const payload = port.type === entry.token.type
        ? { path: entry.token.path ?? null, value: entry.token.value ?? null }
        : latched
          ? { path: latched.path ?? null, value: latched.value ?? null }
          : { path: null, value: null };
      const token = makeToken({
        type: port.type,
        ...payload,
        meta: { issues: entry.issues },
        sourceExecutionId: entry.executionId,
        forced: true,
      });
      emitToken(node, port, token);
      outputs.set(`${node.id}.${port.id}`, token);
      route(node, port, token, null, entry.executionId);
    }
  }

  /** End reached: stop awaiting every outstanding ask and drop the held state. */
  function withdrawGates() {
    held.clear();
    outstanding.clear();
    syncGate();
  }

  // --- snapshot ------------------------------------------------------------

  function snapshotObject() {
    // `held` is a Map — N loop wires can block in ONE drain (two verifiers into an
    // OR, both at allowance). Every hold is serialized; `gate`/`ask` keep their
    // singular spec shape as the FIRST hold.
    const gates = [...held.values()].map((g) => ({
      wireId: g.wireId, nodeId: g.nodeId, executionId: g.executionId,
      token: g.token, issues: g.issues, askId: g.askId,
      deliveryNo: g.deliveryNo, holdNo: g.holdNo,
    }));
    const asks = gates.map((g) => ({
      id: g.askId, kind: 'gate', wireId: g.wireId, nodeId: g.nodeId,
      executionId: g.executionId, issues: g.issues,
      deliveryNo: g.deliveryNo, holdNo: g.holdNo,
    }));
    return {
      version: 2,
      seq,
      graph: template,
      tokens: Object.fromEntries(tokens),
      outputs: Object.fromEntries(outputs),
      consumed: Object.fromEntries([...consumed].map(([id, m]) => [id, Object.fromEntries(m)])),
      ordinals: Object.fromEntries(ordinals),
      wires: Object.fromEntries([...wireState].map(([id, st]) => [id, { ...st }])),
      ended: ended ? { ...ended, result: { ...ended.result } } : null,
      // The FULL ledger entry is serialized (bindings + trigger included): reattach
      // re-invokes `execute` with the RECORDED args, and recomputing them from
      // `consumed` + `tokens` would silently change what a resumed execution works on.
      execs: [...execs.values()].map((e) => ({ ...e })),
      gates,
      asks,
      gate: gates[0] || null,
      ask: asks[0] || null,
    };
  }

  const snap = () => onSnapshot(snapshotObject());

  function restore(s) {
    if (!s) return;
    seq = s.seq ?? 0;
    for (const [k, v] of Object.entries(s.tokens || {})) tokens.set(k, v);
    for (const [k, v] of Object.entries(s.outputs || {})) outputs.set(k, v);
    for (const [id, m] of Object.entries(s.consumed || {})) consumed.set(id, new Map(Object.entries(m)));
    for (const [id, n] of Object.entries(s.ordinals || {})) ordinals.set(id, n);
    for (const [id, st] of Object.entries(s.wires || {})) wireState.set(id, { ...st });
    for (const e of s.execs || []) execs.set(e.executionId, { ...e });
    ended = s.ended ? { ...s.ended, result: { ...s.ended.result } } : null;
    // Every hold comes back (reattach re-asks all of them). A pre-plural resume point
    // carries only the singular `gate`; read it as a one-element list.
    const gates = Array.isArray(s.gates) ? s.gates : (s.gate ? [s.gate] : []);
    if (!ended) for (const g of gates) held.set(g.wireId, { ...g });
  }

  /**
   * Restore a snapshot and re-invoke `execute` once per NON-TERMINAL execution with
   * exactly the recorded arguments — the injected execute decides re-attach vs
   * re-run. Call BEFORE `run()`.
   *
   * A composite's slices are re-invoked BY their shell, not from here: the shell
   * re-runs the whole fan-out (v1 resumed the decomposed stage whole) and re-mints
   * the same ids, so those stale rows are overwritten in place.
   */
  function reattach(snapshot) {
    restore(snapshot);
    for (const entry of [...execs.values()]) {
      if (TERMINAL.has(entry.status)) continue;
      if (entry.kind === 'task') continue;
      const node = nodeById.get(entry.nodeId);
      if (!node) continue;
      running.set(node.id, entry.executionId);
      const h = { node, entry, args: argsFor(node, entry), composite: !!entry.expandsPort };
      if (!isFlow(node) && !h.composite) activeAgents += 1;
      let p;
      try { p = invoke(h); } catch (err) { p = Promise.reject(err); }
      Promise.resolve(p).then(
        (res) => { completions.push({ h, res, err: null }); wake(); },
        (err) => { completions.push({ h, res: null, err }); wake(); },
      );
    }
    // A gate restored without an End re-raises its ask — otherwise the held token has
    // nobody to answer for it and the run would deadlock.
    for (const entry of [...held.values()]) {
      if (outstanding.has(entry.wireId)) continue;
      outstanding.add(entry.wireId);
      askGate(entry);
    }
    syncGate();
  }

  // --- readiness -----------------------------------------------------------

  /**
   * Amendment f, §3 "Firing rule". Flow kinds first (Task fires once; End/AND/
   * Combine all-fresh every execution; OR any-fresh), then the agent rules: the
   * first-run barrier over wired non-loop inputs (the synthesized `await` port
   * included), then any-fresh (default) or awaitAll.
   */
  function isReady(node) {
    const inputs = portsOfNode(node).inputs || [];
    const wired = wiredIn.get(node.id) || new Map();
    const spent = spentOf(node.id);
    const everRan = (ordinals.get(node.id) || 0) > 0;
    const awaitAll = node.config?.awaitAll === true;
    const isFresh = (port) => {
      const token = tokens.get(`${node.id}.${port}`);
      if (!token) return false;
      const prior = spent.get(port);
      return prior === undefined || token.seq > prior;
    };

    if (isFlow(node)) {
      switch (node.kind) {
        case 'task':
          return !everRan;                                  // zero inputs; fires once at t0
        case 'end':
        case 'and':
        case 'combine':
          return inputs.length > 0 && inputs.every((inp) => isFresh(inp.id));
        case 'or':
          return inputs.some((inp) => isFresh(inp.id));
        default:
          return false;                                     // unknown kind (V3)
      }
    }

    if (!everRan) {
      for (const inp of inputs) {
        if (!wired.has(inp.id)) {
          // V9 blocks this at save; stay defensively un-ready rather than firing a
          // node whose required payload can never arrive. Loop inputs are exempt.
          if (inp.required && !isLoopPort(node.id, inp)) return false;
          continue;
        }
        if (isLoopPort(node.id, inp)) continue;             // excused from the barrier
        if (!tokens.get(`${node.id}.${inp.id}`)) return false;
      }
      return true;
    }

    if (!awaitAll) return inputs.some((inp) => isFresh(inp.id));

    // awaitAll: a fresh loop token alone always re-fires (the loop path is the point).
    if (inputs.some((inp) => isLoopPort(node.id, inp) && isFresh(inp.id))) return true;
    let barrier = false;
    for (const inp of inputs) {
      if (!wired.has(inp.id) || isLoopPort(node.id, inp)) continue;
      barrier = true;
      if (!isFresh(inp.id)) return false;
    }
    return barrier;
  }

  const halted = () => Boolean(ended) || Boolean(failure) || pauseRequested || abortRequested;

  async function drainPasses() {
    for (;;) {
      let fired = false;
      for (const nodeId of order) {
        if (halted()) return;                 // pause/abort/End checked at every launch decision
        const node = nodeById.get(nodeId);
        if (!node || running.has(nodeId) || !isReady(node)) continue;
        if (isFlow(node)) { await fireFlow(node); fired = true; continue; }
        if (activeAgents >= maxParallel) continue;   // capped: retried once a slot frees
        fireAgent(node);
        fired = true;
      }
      if (!fired) return;
    }
  }

  function finish(result) {
    settled = true;
    if (result === 'error') controller.abort();
    if (result === 'done' && !ended) {
      warnings.push(QUIESCENCE_WARNING);
      log(QUIESCENCE_WARNING);
    }
    snap();                                   // one final snapshot at run resolution
    return result;
  }

  async function run() {
    for (;;) {
      while (completions.length) {
        const c = completions.shift();
        settle(c.h, c.res, c.err);
      }
      if (failure) return finish('error');
      if (abortRequested) return finish('error');
      if (!halted()) await drainPasses();
      if (failure) return finish('error');
      if (abortRequested) return finish('error');
      // Anything that landed while the pass ran — a completion, or a gate answer
      // that delivered its held token — gets its own pass before quiescence.
      if (completions.length || signalled) { signalled = false; continue; }
      if (running.size === 0) {
        if (ended) return finish('done');
        if (pauseRequested) return finish('paused');
        if (held.size === 0 && outstanding.size === 0) return finish('done');   // quiescence
      }
      await waitForChange();
    }
  }

  return {
    run,
    reattach,
    pause() { pauseRequested = true; wake(); },
    abort() { abortRequested = true; controller.abort(); wake(); },
    getState() {
      return {
        active: [...running].map(([nodeId, executionId]) => ({ nodeId, executionId })),
        executions: [...execs.values()].map((e) => ({ ...e })),
        // Latched OUTPUT tokens (what a wire carries), keyed '<node>.<outputPort>'.
        tokens: Object.fromEntries([...outputs].map(([k, t]) => [
          k, { seq: t.seq, type: t.type, path: t.path ?? null, firedAt: t.firedAt },
        ])),
        wireDeliveries: Object.fromEntries([...wireState].map(([id, st]) => [id, st.deliveries])),
        ended: ended ? { ...ended, result: { ...ended.result } } : null,
        endReached: Boolean(ended),
        result: ended ? { ...ended.result } : null,
        warnings: [...warnings],
        gate: gate ? { ...gate } : null,
        settled,
      };
    },
    get settled() { return settled; },
  };
}
