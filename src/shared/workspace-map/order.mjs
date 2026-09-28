// src/shared/workspace-map/order.mjs
// Suggested change order (spec §6.5 step 3): providers first. Tarjan's strongly connected
// components over "consumer depends on provider", the condensation DAG, then Kahn's algorithm
// with a SORTED frontier so the same map always yields the same layers. A cycle (an SCC of 2+
// members) is one group, placed whole in one layer.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function tarjan(nodes, deps) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comps = [];
  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      comps.push(comp.sort(byStr));
    }
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return comps;
}

/** edges: [{from, to}] (from uses to). Providers first. Tarjan SCCs → condensation → Kahn with a
 *  sorted frontier; an SCC is one group placed in one layer; keys sorted inside a layer.
 *  @returns {{order: string[][], cycles: string[][]}} cycles = SCCs of size > 1, sorted */
export function changeOrder(memberKeys, edges) {
  const nodes = [...new Set((Array.isArray(memberKeys) ? memberKeys : []).filter((k) => typeof k === 'string' && k))].sort(byStr);
  const known = new Set(nodes);
  const deps = new Map(nodes.map((k) => [k, new Set()]));
  for (const e of Array.isArray(edges) ? edges : []) {
    if (!e || !known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    deps.get(e.from).add(e.to);
  }
  for (const [k, set] of deps) deps.set(k, [...set].sort(byStr));
  const comps = tarjan(nodes, deps);
  const compOf = new Map();
  comps.forEach((c, i) => c.forEach((k) => compOf.set(k, i)));
  // Condensation: provider component → consumer components; indegree = distinct providers.
  const after = comps.map(() => new Set());
  const indeg = comps.map(() => 0);
  for (const [consumer, providers] of deps) {
    for (const provider of providers) {
      const a = compOf.get(provider);
      const b = compOf.get(consumer);
      if (a === b || after[a].has(b)) continue;
      after[a].add(b);
      indeg[b] += 1;
    }
  }
  const name = (i) => comps[i][0];
  let frontier = comps.map((_, i) => i).filter((i) => indeg[i] === 0).sort((a, b) => byStr(name(a), name(b)));
  const order = [];
  while (frontier.length) {
    order.push(frontier.flatMap((i) => comps[i]).sort(byStr));
    const next = [];
    for (const i of frontier) {
      for (const j of after[i]) {
        indeg[j] -= 1;
        if (indeg[j] === 0) next.push(j);
      }
    }
    frontier = next.sort((a, b) => byStr(name(a), name(b)));
  }
  const cycles = comps.filter((c) => c.length > 1).sort((a, b) => byStr(a[0], b[0]));
  return { order, cycles };
}
