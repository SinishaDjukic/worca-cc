// src/shared/graph/loops.mjs
// Loop classification and launch order. Two orthogonal concepts (base spec §2):
//   loop WIRE  (budget + amber styling) = both endpoints in ONE nontrivial SCC
//              (or a self-wire) AND the source output is `when:'blocking'`.
//   loop INPUT (firing semantics)       = an input declared `loop:true` in meta;
//              wiring-independent, so an unwired one is still in the set.
// Pure and crash-free: dangling endpoints and unknown agent keys are the
// validator's errors (V5/V4), so they are filtered, never thrown on.
import { portsOf, findPort } from './ports.mjs';

/**
 * Iterative Tarjan (an explicit stack — recursion depth is not a property worth
 * depending on). Roots are visited in sorted id order and every component is
 * returned sorted, so the result is reproducible run to run.
 * @param {string[]} ids
 * @param {Array<{from:string, to:string}>} edges
 * @returns {string[][]}
 */
export function tarjanSccs(ids, edges) {
  const adj = new Map((Array.isArray(ids) ? ids : []).map((id) => [id, []]));
  for (const e of Array.isArray(edges) ? edges : []) {
    if (adj.has(e?.from) && adj.has(e?.to)) adj.get(e.from).push(e.to);
  }
  for (const tos of adj.values()) tos.sort();
  const index = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const sccs = []; let counter = 0;
  for (const root of [...adj.keys()].sort()) {
    if (index.has(root)) continue;
    index.set(root, counter); low.set(root, counter); counter += 1;
    stack.push(root); onStack.add(root);
    const work = [{ id: root, edges: adj.get(root) || [], at: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.at < frame.edges.length) {
        const next = frame.edges[frame.at];
        frame.at += 1;
        if (!index.has(next)) {
          index.set(next, counter); low.set(next, counter); counter += 1;
          stack.push(next); onStack.add(next);
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
        for (;;) { const id = stack.pop(); onStack.delete(id); scc.push(id); if (id === frame.id) break; }
        sccs.push(scc.sort());
      }
    }
  }
  return sccs;
}

/**
 * @param {object} tpl v2 template { nodes, wires }
 * @param {(node:object) => object|undefined} portsFn
 * @returns {{loopWireIds:Set<string>, loopInputs:Set<string>, sccOf:Map<string,number>, launchOrder:string[]}}
 *          `loopInputs` is graph-global (`'<nodeId>.<port>'`).
 */
export function classifyLoops(tpl, portsFn) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : [])
    .filter((n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n));
  const byId = new Map();
  // STRING ids only — an id-less node indexed under `undefined` would make the
  // wire filter below accept a wire with a missing `from`/`to`, and the map on
  // the next line would throw on it (V2/V5 are the validator's to report).
  for (const n of nodes) if (typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, n);
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => byId.has(w?.from?.node) && byId.has(w?.to?.node));

  const ids = [...byId.keys()];
  const sccs = tarjanSccs(ids, wires.map((w) => ({ from: w.from.node, to: w.to.node })));
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const nontrivial = new Set(sccs.map((scc, i) => (scc.length > 1 ? i : -1)).filter((i) => i >= 0));
  const selfWired = new Set(wires.filter((w) => w.from.node === w.to.node).map((w) => w.from.node));

  const loopWireIds = new Set();
  for (const w of wires) {
    const a = sccOf.get(w.from.node);
    if (a === undefined || a !== sccOf.get(w.to.node)) continue;
    if (!nontrivial.has(a) && !selfWired.has(w.from.node)) continue;
    const out = findPort(portsOf(portsFn, byId.get(w.from.node)), w.from.port, 'out');
    if (out && out.when === 'blocking') loopWireIds.add(w.id);
  }

  const loopInputs = new Set();
  for (const n of nodes) {
    for (const inp of portsOf(portsFn, n).inputs) {
      if (inp?.loop) loopInputs.add(`${n.id}.${inp.id}`);
    }
  }

  return { loopWireIds, loopInputs, sccOf, launchOrder: condensationTopo(sccs, wires) };
}

/** Kahn over the condensation: ties break by the component's minimum node id
 *  (members are sorted), which is what makes the launch order reproducible.
 *  Parallel wires collapse to one condensation edge so in-degrees stay balanced. */
function condensationTopo(sccs, wires) {
  const sccOf = new Map();
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));
  const succ = sccs.map(() => new Set());
  const indegree = sccs.map(() => 0);
  for (const w of wires) {
    const a = sccOf.get(w.from.node);
    const b = sccOf.get(w.to.node);
    if (a === undefined || b === undefined || a === b || succ[a].has(b)) continue;
    succ[a].add(b);
    indegree[b] += 1;
  }
  const remaining = new Set(sccs.map((_, i) => i));
  const order = [];
  while (remaining.size) {
    let pick = -1;
    for (const i of remaining) if (indegree[i] === 0 && (pick < 0 || sccs[i][0] < sccs[pick][0])) pick = i;
    if (pick < 0) break;                                   // acyclic by construction — defensive only
    remaining.delete(pick);
    order.push(...sccs[pick]);
    for (const b of succ[pick]) indegree[b] -= 1;
  }
  return order;
}
