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
import { blockingIssues } from '../protocol.mjs';
import { classifyLoops, firedOutputs, isReady, makeToken, resolveOrOutType } from './ports.mjs';

/** Kinds executed by the engine itself: instant, $0, no semaphore slot. */
const FLOW_KINDS = new Set(['task', 'end', 'and', 'or', 'combine']);
/** Execution statuses that need no re-invocation on restore. */
const TERMINAL = new Set(['done', 'error', 'skipped']);
const DEFAULT_MAX_CYCLES = 3;

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
    execs.set(executionId, entry);
    running.set(node.id, executionId);
    emitExec(node, entry, 'start');
    return { node, entry, args: argsFor(node, entry) };
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

  /** Agent nodes take a semaphore slot; `execute` is called AT the slot. */
  function fireAgent(node) {
    const h = startExecution(node);
    activeAgents += 1;
    let p;
    try { p = execute(h.args); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(
      (res) => { completions.push({ h, res, err: null }); wake(); },
      (err) => { completions.push({ h, res: null, err }); wake(); },
    );
  }

  function settle(h, res, err) {
    running.delete(h.node.id);
    if (!isFlow(h.node)) activeAgents -= 1;
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
    const gate = held.values().next().value || null;
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
      gate: gate
        ? { wireId: gate.wireId, nodeId: gate.nodeId, executionId: gate.executionId, token: gate.token, issues: gate.issues }
        : null,
      ask: gate ? { kind: 'gate', wireId: gate.wireId, issues: gate.issues } : null,
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
    if (s.gate && !ended) held.set(s.gate.wireId, { ...s.gate });
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
      const node = nodeById.get(entry.nodeId);
      if (!node) continue;
      running.set(node.id, entry.executionId);
      if (!isFlow(node)) activeAgents += 1;
      const h = { node, entry, args: argsFor(node, entry) };
      let p;
      try { p = execute(h.args); } catch (err) { p = Promise.reject(err); }
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
