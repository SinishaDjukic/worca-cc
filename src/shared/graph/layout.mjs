// src/shared/graph/layout.mjs
// Auto-layout for the composer's header button: longest-path ranks with LOOP
// WIRES EXCLUDED (a card fed only by loop wires goes one column after the cards
// it collects from), columns at x = 60 + rank*320, barycenter ordering inside each
// column, y stacked so no two cards touch and snapped to the 11px grid.
// Deterministic by construction — same template in, same positions out, and
// re-running over an already laid-out template reproduces it exactly.
import { classifyLoops } from './loops.mjs';
import { nodeSize, snap } from './geometry.mjs';

export const RANK_X0 = 60;
export const RANK_DX = 320;                // 100px column gap: two 24px clearance bands + laned verticals
export const RANK_Y0 = 60;
export const ROW_GAP = 64;                 // > 2×ROUTE_CLEARANCE so a wire corridor survives between stacked cards
const SWEEPS = 2;

/** A layoutable node: an object with a string id. `filter(Boolean)` let a truthy
 *  non-object through and indexed an id-less node under `undefined`, so a wire
 *  with a missing endpoint resolved through it and threw. */
const isNode = (n) => Boolean(n) && typeof n === 'object' && !Array.isArray(n) && typeof n.id === 'string';

/** @param {object} tpl @param {{loopWireIds:Set<string>}} loops classifyLoops() output */
export function rankNodes(tpl, loops) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = nonLoopEdges(tpl, loops, ids);

  const rank = {};
  const indegree = {};
  for (const id of ids) { rank[id] = 0; indegree[id] = 0; }
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
    indegree[e.to] += 1;
  }
  // Kahn with a SORTED frontier: ties break by node id, so the walk order — and
  // therefore the result — never depends on declaration order.
  const ready = [...ids].filter((id) => indegree[id] === 0).sort();
  const settled = new Set();
  while (ready.length) {
    const id = ready.shift();
    settled.add(id);
    for (const next of out.get(id) || []) {
      rank[next] = Math.max(rank[next], rank[id] + 1);
      indegree[next] -= 1;
      if (indegree[next] === 0) insertSorted(ready, next);
    }
  }
  // A residual cycle survives only when no loop wire cuts it (V10 blocks SAVING
  // such a graph, but the editor still has to draw it). Rank the leftovers from
  // whatever settled feeds them, in id order — bounded, never a hang.
  for (const id of [...ids].filter((n) => !settled.has(n)).sort()) {
    rank[id] = edges.filter((e) => e.to === id && settled.has(e.from))
      .reduce((best, e) => Math.max(best, rank[e.from] + 1), 0);
    settled.add(id);
  }
  return rank;
}

/** @returns {{[nodeId:string]: {x:number, y:number}}} — the caller applies them. */
export function autoLayout(tpl, portsFn, { x0 = RANK_X0, dx = RANK_DX, y0 = RANK_Y0, gap = ROW_GAP, describe = false } = {}) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const loops = classifyLoops(tpl, portsFn);
  const rank = rankNodes(tpl, loops);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = nonLoopEdges(tpl, loops, ids);
  const loopFrom = loopOnlyCards(tpl, loops, ids, edges);
  // A card fed ONLY by loop wires (the OR that collects every reviewer's findings) ranked 0 above: its
  // wires were cut. Rank it after the cards it collects from, so they reach it as short forward wires and
  // ONE wire returns. Bounded passes: a loop-only card fed by another settles, a cycle of them cannot hang.
  for (let pass = 0; pass < loopFrom.size; pass += 1) {
    let moved = false;
    for (const [id, srcs] of loopFrom) {
      const r = Math.max(...srcs.map((src) => rank[src])) + 1;
      if (r > rank[id]) { rank[id] = r; moved = true; }
    }
    if (!moved) break;
  }

  const columns = new Map();
  for (const n of nodes) {
    if (!columns.has(rank[n.id])) columns.set(rank[n.id], []);
    columns.get(rank[n.id]).push(n.id);
  }
  const ranksAscending = [...columns.keys()].sort((a, b) => a - b);

  // Barycenter: sweep left to right, ordering each column by the mean row index
  // of its predecessors. A node with no ranked predecessor keeps its index, so
  // the pass is stable.
  const preds = new Map(loopFrom);           // a loop-only card sits by the cards it collects from
  for (const e of edges) {
    if (!preds.has(e.to)) preds.set(e.to, []);
    preds.get(e.to).push(e.from);
  }
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (const r of ranksAscending) {
      const rowOf = new Map();
      for (const prevRank of ranksAscending) {
        if (prevRank >= r) break;
        columns.get(prevRank).forEach((id, i) => rowOf.set(id, i));
      }
      const keyed = columns.get(r).map((id, i) => ({ id, i, late: loopFrom.has(id) ? 1 : 0, bary: barycenter(preds.get(id), rowOf, i) }));
      keyed.sort((a, b) => a.bary - b.bary || a.late - b.late || a.i - b.i);   // on a tie it stacks UNDER the main row
      columns.set(r, keyed.map((k) => k.id));
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const heightOf = (node) => {
    const ports = (typeof portsFn === 'function' ? portsFn(node) : null) || { inputs: [], outputs: [] };
    return nodeSize(node, ports, { describe }).h;   // edit hosts bill the description footer
  };
  const positions = {};
  for (const r of ranksAscending) {
    let cursor = y0;
    for (const id of columns.get(r)) {
      const node = byId.get(id);
      const h = heightOf(node);
      // A loop-only card clears the bottoms of the cards it collects from: its loops come DOWN to it.
      for (const src of loopFrom.get(id) || []) {
        if (positions[src]) cursor = Math.max(cursor, positions[src].y + heightOf(byId.get(src)) + gap);
      }
      const y = snap(cursor);
      positions[id] = { x: x0 + r * dx, y };
      cursor = y + h + gap;                 // stack from the SNAPPED row: idempotent
    }
  }
  return positions;
}

/** card id -> the sources of its loop wires, for every card that NO other wire feeds (sorted: deterministic). */
function loopOnlyCards(tpl, loops, ids, edges) {
  const loopWireIds = loops?.loopWireIds instanceof Set ? loops.loopWireIds : new Set();
  const fed = new Set(edges.map((e) => e.to));
  const out = new Map();
  for (const w of Array.isArray(tpl?.wires) ? tpl.wires : []) {
    if (!loopWireIds.has(w?.id) || !ids.has(w?.from?.node) || !ids.has(w?.to?.node)) continue;
    if (w.from.node === w.to.node || fed.has(w.to.node)) continue;
    if (!out.has(w.to.node)) out.set(w.to.node, []);
    out.get(w.to.node).push(w.from.node);
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, srcs]) => [id, [...new Set(srcs)].sort()]));
}

function nonLoopEdges(tpl, loops, ids) {
  const loopWireIds = loops?.loopWireIds instanceof Set ? loops.loopWireIds : new Set();
  return (Array.isArray(tpl?.wires) ? tpl.wires : [])
    .filter((w) => ids.has(w?.from?.node) && ids.has(w?.to?.node)
      && w.from.node !== w.to.node && !loopWireIds.has(w.id))
    .map((w) => ({ from: w.from.node, to: w.to.node }));
}

function barycenter(predecessors, rowOf, fallback) {
  const rows = (predecessors || []).map((id) => rowOf.get(id)).filter((row) => row !== undefined);
  if (!rows.length) return fallback;
  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

function insertSorted(list, id) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < id) lo = mid + 1; else hi = mid;
  }
  list.splice(lo, 0, id);
}
