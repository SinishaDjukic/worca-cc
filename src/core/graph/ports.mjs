// src/core/graph/ports.mjs
// Pure port layer of the v2 graph engine (imports only `hasBlocking` from
// protocol.mjs — no IO, no state, no callers of its own yet):
//
//   makeToken        — the latched-token shape, every default materialized.
//   classifyLoops    — loop WIRES (Tarjan SCC + blocking-source, spec §2) and
//                      loop INPUTS (meta `loop: true`, wiring-independent),
//                      plus the deterministic condensation-topo launch order.
//   firedOutputs     — conditional routing (spec §3): always ports + exactly
//                      one of the blocking / clean sides, in declared order.
//   resolveOrOutType — the or card's payload type, resolved from its inbound
//                      wires' source outputs (chained ors, seen-set guarded).
//   isReady          — the spec §3 firing rule, per node kind.
//
// Nothing here throws on a malformed template: dangling endpoints (V5), unknown
// agent keys (V4) and unknown kinds (V3) are the validator's errors to collect,
// so every lookup guards instead of crashing.
import { hasBlocking } from '../protocol.mjs';

/** Kinds whose readiness follows the flow-card arms rather than the agent rule. */
const FLOW_KINDS = new Set(['task', 'end', 'and', 'or', 'combine']);

/**
 * Build a latched output token. Every optional field is materialized so tokens
 * deep-compare cleanly in scheduler snapshots (no undefined-vs-missing drift).
 *
 * @param {{seq:number, type:string, path?:string|null, value?:*, meta?:object|null,
 *          sourceExecutionId?:string|null, forced?:boolean}} spec
 * @returns {{seq:number, type:string, path:*, value:*, meta:*, sourceExecutionId:*, forced:boolean}}
 */
export function makeToken({ seq, type, path = null, value = null, meta = null, sourceExecutionId, forced = false }) {
  return {
    seq,
    type,
    path,
    value,
    meta,
    sourceExecutionId: sourceExecutionId ?? null,
    forced,
  };
}

/**
 * Classify a template's loops and compute the launch order.
 *
 * A **loop wire** (budget + amber styling) is a wire whose endpoints sit in the
 * same nontrivial SCC — or a self-wire — AND whose source output is
 * `when: 'blocking'`. A **loop input** (firing semantics) is any input declared
 * `loop: true` in meta; it is wiring-independent, so an unwired one still lands
 * in the set.
 *
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @returns {{loopWires:Set<string>, loopInputs:Set<string>, sccs:string[][], order:string[]}}
 *          `loopInputs` and `order` are graph-global (`'<nodeId>.<port>'` / node ids).
 */
export function classifyLoops(template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const allWires = Array.isArray(template?.wires) ? template.wires : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Dangling endpoints are V5's problem — never crash here (the validator
  // collects ALL violations, so it must be able to reach them).
  const wires = allWires.filter((w) => nodeById.has(w?.from?.node) && nodeById.has(w?.to?.node));

  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const w of wires) adj.get(w.from.node).push(w.to.node);
  for (const tos of adj.values()) tos.sort();          // determinism of the SCC list itself

  const sccs = tarjan(adj);
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const nontrivial = new Set(sccs.map((scc, i) => (scc.length > 1 ? i : -1)).filter((i) => i >= 0));
  const selfWired = new Set(wires.filter((w) => w.from.node === w.to.node).map((w) => w.from.node));

  const loopWires = new Set();
  for (const w of wires) {
    const sameScc = sccOf.get(w.from.node) === sccOf.get(w.to.node)
      && (nontrivial.has(sccOf.get(w.from.node)) || selfWired.has(w.from.node));
    if (!sameScc) continue;
    // An unknown agent key resolves to no meta — guard, don't crash (V4 owns the error).
    const out = (portsFn(nodeById.get(w.from.node))?.outputs || []).find((o) => o.id === w.from.port);
    if (out && out.when === 'blocking') loopWires.add(w.id);   // blocking-source rule
  }

  // Loop INPUTS come from meta `loop: true`, never from wiring. This pass calls
  // portsFn on EVERY node, so the no-meta guard here is not cycle-specific.
  const loopInputs = new Set();
  for (const n of nodes) {
    for (const inp of portsFn(n)?.inputs || []) {
      if (inp.loop) loopInputs.add(`${n.id}.${inp.id}`);
    }
  }

  return { loopWires, loopInputs, sccs, order: condensationTopo(sccs, adj) };
}

/**
 * The output ports that fire after an execution: every `when: 'always'` port
 * plus exactly one conditional side — `blocking` iff the verdict has a critical
 * or major issue, `clean` otherwise. Declared port order is preserved, and the
 * PORT OBJECTS are returned because the executor needs each one's
 * filename/store/artifactKind.
 *
 * @param {Array<{id:string, when?:string}>} outputs  declared output ports
 * @param {{issues?:Array}|null} verdict  normalized review, or null when the node has none
 * @returns {Array<object>}
 */
export function firedOutputs(outputs, verdict) {
  const declared = Array.isArray(outputs) ? outputs : [];
  const side = hasBlocking(verdict) ? 'blocking' : 'clean';
  return declared.filter((o) => {
    const when = o?.when || 'always';
    return when === 'always' || when === side;
  });
}

/**
 * The or card's payload type, resolved from its inbound wires' source output
 * types. Inbound types must be homogeneous — that is V12's error to report; this
 * returns the first resolvable one, walking the inbound wires by `inK` index and
 * then by wire id so the answer never depends on wire insertion order. Chained
 * or cards resolve through (seen-set guarded, so a cyclic or→or chain with no
 * external source resolves to null instead of hanging).
 *
 * @param {object} node  the or node
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({outputs?:Array}|undefined)} portsFn
 * @returns {'md'|'json'|'void'|string|null}  null when unresolvable
 */
export function resolveOrOutType(node, template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const wires = Array.isArray(template?.wires) ? template.wires : [];
  return resolveOrType(node, new Map(nodes.map((n) => [n.id, n])), wires, portsFn, new Set());
}

function resolveOrType(node, nodeById, wires, portsFn, seen) {
  if (!node || seen.has(node.id)) return null;
  seen.add(node.id);
  const inbound = wires
    .filter((w) => w?.to?.node === node.id)
    .sort((a, b) => portIndex(a.to.port) - portIndex(b.to.port) || compareIds(a.id, b.id));
  for (const w of inbound) {
    const src = nodeById.get(w?.from?.node);
    if (!src) continue;                                        // dangling endpoint — V5's problem
    const out = (portsFn(src)?.outputs || []).find((o) => o.id === w.from.port);
    if (!out) continue;
    if (out.type && out.type !== 'any') return out.type;
    // An 'any' source is another or card — resolve THROUGH it.
    if (src.kind === 'or') {
      const through = resolveOrType(src, nodeById, wires, portsFn, seen);
      if (through) return through;
    }
  }
  return null;
}

/**
 * The spec §3 firing rule.
 *
 * ctx = { portsFn, wiredIn, loopInputs, tokens, consumed, everRan, awaitAll, isFlow }.
 * KEY SPACES DIFFER: `wiredIn` and `consumed` are keyed by the BARE port id (this
 * node's own ports), while `loopInputs` and `tokens` are keyed graph-globally as
 * `'<nodeId>.<port>'`. Mixing them silently yields "never ready".
 *
 * Agent nodes: the first execution waits on every WIRED NON-LOOP input (loop
 * inputs are excused — implement fires before any review exists); re-executions
 * need one fresh token anywhere, or, with `awaitAll`, every wired non-loop input
 * fresh OR a fresh loop token alone. The synthesized `await` input is an
 * ordinary wired non-loop input throughout. Flow cards ignore `awaitAll`
 * entirely: and/combine/end are all-fresh, or is any-fresh, task fires once.
 *
 * @param {object} node
 * @param {object} ctx
 * @returns {boolean}
 */
export function isReady(node, ctx) {
  const { portsFn, wiredIn, loopInputs, tokens, consumed, everRan = false, awaitAll = false, isFlow } = ctx || {};
  const resolved = (typeof portsFn === 'function' ? portsFn(node) : null) || {};
  const inputs = Array.isArray(resolved.inputs) ? resolved.inputs : [];

  const isWired = (port) => Boolean(wiredIn?.has(port));
  const isLoop = (port) => Boolean(loopInputs?.has(`${node.id}.${port}`));
  const isFresh = (port) => {
    const token = tokens?.get(`${node.id}.${port}`);
    if (!token) return false;
    const spent = consumed?.get(port);
    return spent === undefined || token.seq > spent;
  };

  if (isFlow ?? FLOW_KINDS.has(node.kind)) {
    switch (node.kind) {
      case 'task':
        return !everRan;                                        // zero inputs; fires once at t0
      case 'end':
      case 'and':
      case 'combine':
        // All inputs fresh, every execution (end declares the single `result`).
        return inputs.length > 0 && inputs.every((inp) => isFresh(inp.id));
      case 'or':
        // The only fan-in card: ANY fresh input fires it; the scheduler binds the
        // freshest and re-emits its payload, so two fresh inputs are one emission.
        return inputs.some((inp) => isFresh(inp.id));
      default:
        break;                                                  // unknown kind (V3) — fall through
    }
  }

  if (!everRan) {
    for (const inp of inputs) {
      if (!isWired(inp.id)) {
        // V9 blocks this at save; stay defensively un-ready rather than firing a
        // node whose required payload can never arrive. Loop inputs are exempt
        // from the wiring requirement, so an unwired one is not a blocker.
        if (inp.required && !isLoop(inp.id)) return false;
        continue;
      }
      if (isLoop(inp.id)) continue;                             // excused from the first-run barrier
      if (!tokens?.get(`${node.id}.${inp.id}`)) return false;
    }
    return true;
  }

  if (!awaitAll) return inputs.some((inp) => isFresh(inp.id));

  // awaitAll: a fresh loop token alone always re-fires (the loop path is the point).
  if (inputs.some((inp) => isLoop(inp.id) && isFresh(inp.id))) return true;
  let barrier = false;
  for (const inp of inputs) {
    if (!isWired(inp.id) || isLoop(inp.id)) continue;
    barrier = true;
    if (!isFresh(inp.id)) return false;
  }
  return barrier;
}

/**
 * Tarjan's SCC, iterative (an explicit stack — the graphs are small, but
 * recursion depth is not a property worth depending on). Roots are visited in
 * sorted-nodeId order and each component is returned sorted, so the result is
 * reproducible run to run.
 *
 * @param {Map<string, string[]>} adj
 * @returns {string[][]}
 */
function tarjan(adj) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  for (const root of [...adj.keys()].sort()) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);
    const work = [{ id: root, edges: adj.get(root) || [], at: 0 }];

    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.at < frame.edges.length) {
        const next = frame.edges[frame.at];
        frame.at += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ id: next, edges: adj.get(next) || [], at: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id), index.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent), low.get(frame.id)));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const scc = [];
        for (;;) {
          const id = stack.pop();
          onStack.delete(id);
          scc.push(id);
          if (id === frame.id) break;
        }
        sccs.push(scc.sort());
      }
    }
  }
  return sccs;
}

/**
 * Kahn's algorithm over the condensation: ties are broken by the component's
 * minimum node id and each component is emitted in sorted order, which is what
 * makes the launch order reproducible. Parallel wires collapse to one
 * condensation edge so in-degrees stay balanced.
 *
 * @param {string[][]} sccs  components, members sorted
 * @param {Map<string, string[]>} adj
 * @returns {string[]}
 */
function condensationTopo(sccs, adj) {
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const succ = sccs.map(() => new Set());
  const indegree = sccs.map(() => 0);
  for (const [from, tos] of adj) {
    const a = sccOf.get(from);
    if (a === undefined) continue;
    for (const to of tos) {
      const b = sccOf.get(to);
      if (b === undefined || b === a || succ[a].has(b)) continue;
      succ[a].add(b);
      indegree[b] += 1;
    }
  }

  const remaining = new Set(sccs.map((_, i) => i));
  const order = [];
  while (remaining.size) {
    let pick = -1;
    for (const i of remaining) {
      // sccs[i][0] is the component's minimum node id (members are sorted).
      if (indegree[i] === 0 && (pick < 0 || sccs[i][0] < sccs[pick][0])) pick = i;
    }
    if (pick < 0) break;                        // a condensation is acyclic — defensive only
    remaining.delete(pick);
    order.push(...sccs[pick]);
    for (const b of succ[pick]) indegree[b] -= 1;
  }
  return order;
}

/** `in3` -> 3; anything else sorts last (deterministic, never NaN). */
function portIndex(port) {
  const m = /^in(\d+)$/.exec(String(port ?? ''));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** Total order on wire ids (undefined ids sort last, never NaN-compare). */
function compareIds(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}
