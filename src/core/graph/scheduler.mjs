// src/core/graph/scheduler.mjs
// The single-owner dataflow loop of the v2 graph engine (spec §3): the token
// store, the drain/launch loop, per-wire loop budgets and their human gates,
// End completion and the resume-v2 snapshot.
//
// Shape of a pass: publishing routes tokens IMMEDIATELY (per-wire delivery
// counting and gate checks happen AT DELIVERY), but FIRING happens only in the
// drain loop. A pass walks `classifyLoops(...).order` ONCE; a node ready at its
// slot fires AT that slot — agent nodes as an async `execute` under the
// semaphore, flow nodes synchronously, whose publishes route immediately and
// may make LATER slots ready within the same pass. Earlier slots are never
// revisited mid-pass; passes repeat until a pass fires nothing. The execution
// sequence is therefore the order of `execute` CALLS, and it is deterministic.
//
// EVERY node's execution is routed through the injected `execute` — flow kinds
// synchronously and outside the semaphore, agent kinds under it. The scheduler
// never reads back a flow execution's returned outputs except for the task node
// (whose returned token is load-bearing: A2 planStoreSeed redirects it); end's
// `result` and the or card's payload are derived from the token the scheduler
// ITSELF bound.
//
// `rerunPending` coalescing is structural here: a node that is already running
// is skipped in the walk, and readiness is re-evaluated after every completion,
// so readiness reached while running re-fires exactly once and never queues.
//
// COMPOSITE (fan-out) EXECUTIONS. A fresh token on an `expands` input — and no
// fresh loop trigger (A3) — turns one firing into a COMPOSITE execution: the
// scheduler drives phases sequentially and each phase's tasks in parallel, all
// recorded under the SAME node, and the node publishes ONCE at the end. Because
// the scheduler does no IO and never reads an agent key, the four steps are asked
// of the injected `execute` through a `composite` discriminator — one injection
// point, four modes:
//
//   { …args, composite: 'expand', expandsPort }         -> { phases: [ { ordinal, tasks: [ { id, title?, path } ] } ] }
//   { …args, composite: 'phase', phase, phaseStatus }   -> (ignored; status plumbing only)
//   { …args, executionId: <slice>, kind: 'task', slice } -> an ordinary execution of one slice
//   { …args, composite: 'finish', expandsPort, phases } -> { outputs } — the ONE publish
//
// `expand` returns absolute task paths (the caller owns the pipeline dir);
// `phases: []` means "nothing to fan out" and downgrades the firing to one
// ordinary execution with the expands input left UNBOUND. `finish` is where a
// `sideEffect:'code'` consumer stages its worktree — after the LAST phase, so the
// next node's diff sees every slice's files at once.
import { blockingIssues } from '../protocol.mjs';
import { classifyLoops, firedOutputs, isReady, makeToken, resolveOrOutType } from './ports.mjs';

/** Kinds executed by the engine itself: instant, $0, no semaphore slot. */
const FLOW_KINDS = new Set(['task', 'end', 'and', 'or', 'combine']);
/** Execution statuses that need no re-invocation on restore. */
const TERMINAL = new Set(['done', 'error', 'skipped']);
const DEFAULT_MAX_CYCLES = 3;

/**
 * The execution id of one composite sub-execution: the parent's id plus the
 * manifest task id (`x:n_impl:1:p1t1`). Deterministic on purpose — a resumed
 * composite re-mints the SAME ids, so its ledger entries overwrite rather than
 * accumulate, and the id is derivable by anyone holding the parent's.
 * @param {string} parentExecutionId
 * @param {string} taskId
 */
export function sliceExecutionId(parentExecutionId, taskId) {
  return `${parentExecutionId}:${taskId}`;
}

/** An abort rejection — a sibling cancelled by a phase-mate's failure, or the
 *  whole run going down. Never counted as the FIRST genuine failure. */
const isAbortError = (err) => err?.name === 'AbortError';

/**
 * Build a scheduler over a resolved v2 template.
 *
 * @param {object} opts
 * @param {object} opts.template  v2 template { nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} opts.portsFn
 * @param {(args:object) => Promise<{verdict?:object, outputs?:object, result?:*, error?:*}>} opts.execute
 * @param {{path:string}|null} [opts.taskArtifact]  pre-rendered task document
 * @param {(name:string, payload:object) => void} [opts.onEvent]  'exec' | 'token' | 'gate'
 * @param {(q:object) => Promise<'another'|'continue'>} [opts.ask]
 * @param {number} [opts.maxParallel]
 * @param {object|null} [opts.snapshot]  resume-v2 object to restore from
 * @param {(snapshot:object) => void} [opts.onSnapshot]
 * @returns {{run:() => Promise<'done'|'error'|'paused'>, pause:() => void, abort:() => void, getState:() => object}}
 */
export function createScheduler(opts) {
  const {
    template,
    portsFn,
    execute,
    taskArtifact = null,
    onEvent = () => {},
    ask = async () => 'continue',
    maxParallel = 4,
    snapshot = null,
    onSnapshot = () => {},
  } = opts || {};

  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wires = (Array.isArray(template?.wires) ? template.wires : [])
    .filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node));
  const wireById = new Map(wires.map((w) => [w.id, w]));
  const { loopWires, loopInputs, order } = classifyLoops(template, portsFn);

  // Static wiring indexes. `wiredIn` is keyed by BARE port id per node (the key
  // space isReady expects); `outWires` fans a fired output out to its wires.
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
  const held = new Map();         // wireId -> { wireId, nodeId, executionId, token, issues }
  const outstanding = new Set();  // wireIds with an un-withdrawn ask in flight
  const running = new Map();      // nodeId -> executionId
  const completions = [];
  const controller = new AbortController();
  let activeAgents = 0;
  let ended = null;
  let failure = null;
  let pauseRequested = false;
  let abortRequested = false;
  let settled = false;

  for (const id of loopWires) {
    const maxCycles = Number(wireById.get(id)?.config?.maxCycles ?? DEFAULT_MAX_CYCLES);
    wireState.set(id, { deliveries: 0, allowance: Math.max(0, maxCycles - 1) });
  }

  if (snapshot) restore(snapshot);

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
  // A counting semaphore with a FIFO waiter queue. `drainPasses` POLLS it before
  // launching a node; composite slices AWAIT it, because they are launched from
  // inside an already-running execution rather than from the walk. The composite
  // SHELL deliberately holds no slot (it spawns nothing), which is also what keeps
  // a fan-out from deadlocking behind itself at maxParallel 1.
  const slotQueue = [];
  function takeSlot() {
    if (activeAgents < maxParallel) { activeAgents += 1; return Promise.resolve(); }
    return new Promise((resolve) => { slotQueue.push(resolve); });
  }
  function freeSlot() {
    const next = slotQueue.shift();
    if (next) { next(); return; }           // handed straight over: the count is unchanged
    activeAgents -= 1;
    wake();                                 // a freed slot may unblock a queued node launch
  }

  // --- small helpers -------------------------------------------------------
  const portsOf = (node) => (typeof portsFn === 'function' ? portsFn(node) : null) || {};
  const isFlow = (node) => FLOW_KINDS.has(node.kind);
  const spentOf = (nodeId) => consumed.get(nodeId) || new Map();

  /** The payload half of a token, materialized only where it exists. */
  function payloadOf(token) {
    const out = { seq: token.seq, type: token.type };
    if (token.path != null) out.path = token.path;
    if (token.value != null) out.value = token.value;
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
      // Composite sub-executions carry their slice identity; the UI collapses them
      // under the node and labels them by title (run-decor's kind:'task' arm).
      ...(entry.kind === 'task'
        ? { phase: entry.phase, taskId: entry.taskId, title: entry.title }
        : null),
      ...(status === 'start' ? { trigger: entry.trigger } : null),
      ...(extra || null),
    });
  }

  function emitToken(node, port, token) {
    onEvent('token', {
      seq: token.seq,
      from: { node: node.id, port: port.id },
      type: token.type,
      path: token.path,
      forced: token.forced,
      firedAt: Date.now(),
    });
  }

  // --- binding -------------------------------------------------------------

  /**
   * Latch this execution's inputs. Every input holding a token is bound (a
   * re-execution binds latched values for its non-triggering inputs) and spent
   * in `consumed`; the or card binds ONLY the freshest fresh input, so the
   * older fresh tokens are spent at that same bind without being bound.
   */
  function bindFor(node) {
    const inputs = portsOf(node).inputs || [];
    const spent = spentOf(node.id);
    const first = (ordinals.get(node.id) || 0) === 0;
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
      if (p.port === 'await') continue;              // consumed for the barrier, payload discarded
      bindings[p.port] = payloadOf(p.token);
    }
    const fresh = present.filter((p) => p.fresh);
    return {
      bindings,
      present,
      trigger: {
        wireIds: fresh.map((p) => wiredIn.get(node.id)?.get(p.port)).filter(Boolean),
        // A3: only a FRESH port selects the mode. `await` never does — it is
        // absent on first executions and ignored by the executor everywhere.
        freshPorts: fresh.filter((p) => !(first && p.port === 'await')).map((p) => p.port),
      },
    };
  }

  function commitBind(node, present) {
    let spent = consumed.get(node.id);
    if (!spent) { spent = new Map(); consumed.set(node.id, spent); }
    for (const p of present) spent.set(p.port, p.token.seq);
  }

  // --- launching -----------------------------------------------------------

  /**
   * The FRESH `expands` input that makes this firing COMPOSITE, or null.
   *
   * A3, parity-mandatory: a fresh LOOP input wins outright — a fix-cycle re-fire
   * runs ONE ordinary execution on the combined diff, which is v1's `!bus.review`
   * arm of the same guard. A latched expands token never fans out again either,
   * because only FRESH ports are considered.
   */
  function expandsTrigger(node, b) {
    if (isFlow(node)) return null;
    const inputs = portsOf(node).inputs || [];
    const fresh = new Set(b.trigger.freshPorts || []);
    if (inputs.some((inp) => inp?.loop && fresh.has(inp.id))) return null;
    const port = inputs.find((inp) => inp?.expands && fresh.has(inp.id) && b.bindings[inp.id]);
    return port ? port.id : null;
  }

  function startExecution(node) {
    const ordinal = (ordinals.get(node.id) || 0) + 1;
    const executionId = `x:${node.id}:${ordinal}`;
    const b = bindFor(node);                 // reads `ordinals` — bind BEFORE the bump
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

  /** Run one started execution: the composite driver, or the plain injected call. */
  function invoke(h) {
    return h.composite ? runComposite(h) : execute(h.args);
  }

  function argsFor(node, entry) {
    const args = {
      node,
      executionId: entry.executionId,
      ordinal: entry.ordinal,
      bindings: entry.bindings,
      trigger: entry.trigger,
      signal: controller.signal,
    };
    if (node.kind === 'task') args.taskArtifact = taskArtifact;
    return args;
  }

  /** Flow cards run inline at their slot so their publishes reach later slots. */
  async function fireFlow(node) {
    const h = startExecution(node);
    let res = null;
    let err = null;
    try { res = await execute(h.args); } catch (e) { err = e; }
    settle(h, res, err);
  }

  /** Agent nodes take a semaphore slot; `execute` is called AT the slot. A
   *  composite shell takes none — its slices each take one instead. */
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

  function settle(h, res, err) {
    running.delete(h.node.id);
    if (!isFlow(h.node) && !h.composite) freeSlot();
    if (err || res?.error) failExecution(h, err || res.error);
    else completeExecution(h, res || {});
  }

  function completeExecution(h, res) {
    const { node, entry } = h;
    entry.status = 'done';
    if (res?.sessionId) entry.sessionId = res.sessionId;
    emitExec(node, entry, 'done', node.kind === 'end' ? { result: boundResult(entry) } : null);
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

  // --- composite (fan-out) executions --------------------------------------

  /**
   * Drive ONE composite execution of `h.node` (see the protocol in this file's
   * header). Phases run in order, each phase's tasks in parallel under the
   * semaphore, and the single value returned here is what the node PUBLISHES —
   * so its outputs fire exactly once, after the last phase, never once per task.
   *
   * Pause/abort is checked at every phase boundary. A halted run returns the
   * empty publish (mirroring an execution that unwound as paused) and never calls
   * `finish`, so no worktree is staged and no phase is falsely marked done.
   */
  async function runComposite(h) {
    const portId = h.entry.expandsPort;
    const expanded = await execute({ ...h.args, composite: 'expand', expandsPort: portId });
    const phases = Array.isArray(expanded?.phases) ? expanded.phases : [];
    if (!phases.length) return runUnexpanded(h, portId);

    for (const ph of phases) {
      if (halted()) return { outputs: {} };
      await runPhase(h, portId, ph);
    }
    if (halted()) return { outputs: {} };
    return await execute({ ...h.args, composite: 'finish', expandsPort: portId, phases });
  }

  /**
   * Nothing to fan out. Strip the expands binding — so the consumer neither sees
   * the manifest as an input nor renders its slice directive (A3) — and run the
   * ONE ordinary execution the firing would have been. The entry is mutated in
   * place because it is the ledger row a resume would re-invoke from.
   */
  async function runUnexpanded(h, portId) {
    const { node, entry } = h;
    delete entry.bindings[portId];
    entry.trigger = {
      ...entry.trigger,
      freshPorts: (entry.trigger.freshPorts || []).filter((p) => p !== portId),
    };
    delete entry.expandsPort;
    h.composite = false;                    // ... so settle() frees the slot taken here
    await takeSlot();
    h.args = argsFor(node, entry);
    return await execute(h.args);
  }

  /**
   * One phase: every task launched together, each awaiting its own semaphore slot.
   * The FIRST genuine (non-abort) failure aborts its siblings immediately through
   * the phase-local controller and fails the whole composite — v1's
   * abort-on-first-failure, kept.
   */
  async function runPhase(h, portId, ph) {
    const tasks = Array.isArray(ph.tasks) ? ph.tasks : [];
    const phaseAbort = new AbortController();
    let firstError = null;
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'running' });

    await Promise.allSettled(tasks.map((task, index) =>
      runSlice(h, portId, ph, task, index, phaseAbort).catch((err) => {
        if (!firstError && !isAbortError(err)) {
          firstError = { task, err };
          phaseAbort.abort();
        }
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
    // A halted run leaves the phase RUNNING: the resume re-runs the whole
    // composite, and a phase that never finished must not read as done.
    if (halted()) return;
    await execute({ ...h.args, composite: 'phase', phase: ph.ordinal, phaseStatus: 'done' });
  }

  /**
   * One task sub-execution: a CLONE of the consumer node (same key, meta and
   * ports) with the expands input rebound to this task's own markdown file, still
   * FRESH so the slice directive renders. Recorded `kind:'task'` under the SAME
   * node — it publishes nothing; the composite's single `finish` does that.
   */
  async function runSlice(h, portId, ph, task, index, phaseAbort) {
    const { node, entry } = h;
    await takeSlot();
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
      signal: AbortSignal.any([controller.signal, phaseAbort.signal]),
      kind: 'task',
      slice: { id: task.id, title: task.title ?? null, phase: ph.ordinal, path: task.path ?? null, index },
    };
    try {
      const res = await execute(args);
      sub.status = 'done';
      if (res?.sessionId) sub.sessionId = res.sessionId;
      emitExec(node, sub, 'done');
      return res;
    } catch (err) {
      sub.status = 'error';
      sub.error = String(err?.message || err);
      emitExec(node, sub, 'error', { error: sub.error });
      throw err;
    } finally {
      freeSlot();
    }
  }

  // --- publishing / routing ------------------------------------------------

  /** End's result is derived from the token the SCHEDULER bound, never from the
   *  execution's (informational) return value. */
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
    for (const port of firedOutputs(portsOf(node).outputs, verdict)) {
      const token = makeToken({
        seq: (seq += 1),
        type: outTypeOf(node, port),
        ...payloadFor(node, port, entry, res),
        sourceExecutionId: entry.executionId,
      });
      emitToken(node, port, token);
      outputs.set(`${node.id}.${port.id}`, token);
      route(node, port, token, verdict, entry.executionId);
    }
  }

  const outTypeOf = (node, port) =>
    (node.kind === 'or' ? resolveOrOutType(node, template, portsFn) ?? port.type : port.type);

  function payloadFor(node, port, entry, res) {
    // The or valve re-emits the payload of the token IT bound; the and card is
    // a pure synchronizer and emits void.
    if (node.kind === 'or') {
      const bound = Object.values(entry.bindings)[0] || {};
      return { path: bound.path ?? null, value: bound.value ?? null };
    }
    if (node.kind === 'and') return { path: null, value: null };
    const given = res?.outputs?.[port.id];
    if (given) return { path: given.path ?? null, value: given.value ?? null };
    // The task node's returned token is load-bearing (A2 redirects it); without
    // one, the pre-rendered artifact is the payload.
    if (node.kind === 'task') return { path: taskArtifact?.path ?? null, value: null };
    return { path: null, value: null };
  }

  /**
   * Deliver a token along every wire out of a fired port. Loop-wire deliveries
   * are counted and gated HERE, per wire — before, and independently of, any
   * downstream or bind. During the End drain nothing is routed at all: the
   * token is recorded (latched + evented) and accounting/gates are skipped.
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

  function holdAt(wire, token, verdict, node, executionId) {
    // "Open issues" = the critical/major findings that caused the block; they
    // ride the ask and, on continue, the forced token's meta.
    const issues = blockingIssues(verdict);
    const entry = { wireId: wire.id, nodeId: node.id, executionId, token, issues };
    held.set(wire.id, entry);
    outstanding.add(wire.id);
    onEvent('gate', { wireId: wire.id, nodeId: node.id, executionId, issues, status: 'held' });
    Promise.resolve(ask({ kind: 'gate', wireId: wire.id, issues })).then(
      (answer) => resolveGate(wire.id, answer),
      () => resolveGate(wire.id, 'continue'),
    );
  }

  function resolveGate(wireId, answer) {
    if (!outstanding.has(wireId)) return;     // withdrawn by End (or already answered) — a no-op
    outstanding.delete(wireId);
    const entry = held.get(wireId);
    held.delete(wireId);
    if (!entry) return;
    const verdictAnswer = answer === 'another' ? 'another' : 'continue';
    onEvent('gate', {
      wireId, nodeId: entry.nodeId, executionId: entry.executionId, issues: entry.issues, status: verdictAnswer,
    });
    if (verdictAnswer === 'another') {
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
   * A4: on "continue" the held blocking token is discarded and each of the
   * SOURCE node's clean outputs force-fires — payload = the held token's
   * path/value when the port types match, else the clean port's latched
   * payload, else null; `forced` + the open issues in meta either way.
   */
  function forceClean(entry) {
    const node = nodeById.get(entry.nodeId);
    if (!node) return;
    for (const port of (portsOf(node).outputs || []).filter((o) => o.when === 'clean')) {
      const latched = outputs.get(`${node.id}.${port.id}`);
      const payload = port.type === entry.token.type
        ? { path: entry.token.path ?? null, value: entry.token.value ?? null }
        : latched
          ? { path: latched.path ?? null, value: latched.value ?? null }
          : { path: null, value: null };
      const token = makeToken({
        seq: (seq += 1),
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
  }

  // --- snapshot ------------------------------------------------------------

  function snapshotObject() {
    // `held` is a Map — N loop wires can block in ONE drain (two verifiers into
    // an OR, both at allowance). Every hold is serialized; `gate`/`ask` keep
    // their singular spec shape as the FIRST hold so resume points written by
    // either build stay readable in both directions.
    const gates = [...held.values()].map((g) => (
      { wireId: g.wireId, nodeId: g.nodeId, executionId: g.executionId, token: g.token, issues: g.issues }
    ));
    const asks = gates.map((g) => ({ kind: 'gate', wireId: g.wireId, issues: g.issues }));
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
      execs: [...execs.values()].map((e) => ({ ...e })),
      gates,
      asks,
      gate: gates[0] || null,
      ask: asks[0] || null,
    };
  }

  const snap = () => onSnapshot(snapshotObject());

  function restore(s) {
    seq = s.seq ?? 0;
    for (const [k, v] of Object.entries(s.tokens || {})) tokens.set(k, v);
    for (const [k, v] of Object.entries(s.outputs || {})) outputs.set(k, v);
    for (const [id, m] of Object.entries(s.consumed || {})) consumed.set(id, new Map(Object.entries(m)));
    for (const [id, n] of Object.entries(s.ordinals || {})) ordinals.set(id, n);
    for (const [id, st] of Object.entries(s.wires || {})) wireState.set(id, { ...st });
    for (const e of s.execs || []) execs.set(e.executionId, { ...e });
    ended = s.ended ? { ...s.ended, result: { ...s.ended.result } } : null;
    // Every hold comes back (reattach re-asks all of them). A pre-plural resume
    // point carries only the singular `gate`; read it as a one-element list.
    const gates = Array.isArray(s.gates) ? s.gates : (s.gate ? [s.gate] : []);
    if (!ended) for (const g of gates) held.set(g.wireId, { ...g });
  }

  /**
   * Re-invoke `execute` once per NON-TERMINAL execution entry with exactly the
   * recorded arguments — the injected execute decides re-attach vs re-run.
   * Recomputing the bindings from `consumed` + `tokens` is forbidden: a source
   * that re-published after the bind would silently change what the resumed
   * execution is working on.
   */
  function reattach() {
    for (const entry of [...execs.values()]) {
      if (TERMINAL.has(entry.status)) continue;
      // A composite's slices are re-invoked BY their shell, not from here: the
      // shell re-runs the whole fan-out (v1 resumed the decomposed stage whole)
      // and re-mints the same ids, so these stale rows are overwritten in place.
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
    // A gate restored without an End re-raises its ask — otherwise the held
    // token has nobody to answer for it and the run would deadlock.
    for (const entry of [...held.values()]) {
      if (outstanding.has(entry.wireId)) continue;
      outstanding.add(entry.wireId);
      Promise.resolve(ask({ kind: 'gate', wireId: entry.wireId, issues: entry.issues })).then(
        (answer) => resolveGate(entry.wireId, answer),
        () => resolveGate(entry.wireId, 'continue'),
      );
    }
  }

  // --- the loop ------------------------------------------------------------

  function readyNow(node) {
    return isReady(node, {
      portsFn,
      wiredIn: wiredIn.get(node.id) || new Map(),
      loopInputs,
      tokens,
      consumed: spentOf(node.id),
      everRan: (ordinals.get(node.id) || 0) > 0,
      awaitAll: node.config?.awaitAll === true,
      isFlow: isFlow(node),
    });
  }

  const halted = () => Boolean(ended) || Boolean(failure) || pauseRequested || abortRequested;

  async function drainPasses() {
    for (;;) {
      let fired = false;
      for (const nodeId of order) {
        if (halted()) return;                 // pause/abort/End checked at every launch decision
        const node = nodeById.get(nodeId);
        if (!node || running.has(nodeId) || !readyNow(node)) continue;
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
    snap();                                   // one final snapshot at run resolution
    return result;
  }

  async function run() {
    if (snapshot) reattach();
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
      // Anything that landed while the pass ran — a completion, or a gate
      // answer that delivered its held token — gets its own pass before the
      // run is allowed to call quiescence.
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
    pause() { pauseRequested = true; wake(); },
    abort() { abortRequested = true; controller.abort(); wake(); },
    getState() {
      return {
        active: [...running].map(([nodeId, executionId]) => ({ nodeId, executionId })),
        executions: [...execs.values()].map((e) => ({ ...e })),
        tokens: Object.fromEntries(tokens),
        ended: ended ? { ...ended, result: { ...ended.result } } : null,
      };
    },
    get settled() { return settled; },
  };
}
