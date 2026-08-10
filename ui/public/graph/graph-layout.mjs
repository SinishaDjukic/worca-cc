// ui/public/graph/graph-layout.mjs
// Auto-layout for the composer's [⇄] button: longest-path ranks with LOOP WIRES
// EXCLUDED, columns at x = 60 + rank*300, barycenter ordering inside each
// column, y stacked so no two cards touch and snapped to the 11px grid.
//
// Excluding loop wires is what keeps a feedback edge from dragging its target
// forward: implementer is fed by refiner (plain) and by reviewer (loop), and it
// must rank one past REFINER, not one past reviewer. There is no Merge fan-in
// rule any more (the node is gone), and no seed contains a node fed only by loop
// wires, so a loop-only target simply falls to rank 0.
//
// Deterministic by construction — same template in, same positions out, and
// re-running over an already laid-out template reproduces it exactly.
import { classifyLoops, CAPTION_KINDS } from './graph-model.mjs';
import { nodeSize, snap } from './graph-geometry.mjs';

/** Column origin and pitch (pinned). Only y is snapped — x IS the rank formula. */
export const RANK_X0 = 60, RANK_DX = 300;
/** Column origin and the vertical gutter between two stacked cards. */
export const RANK_Y0 = 60, ROW_GAP = 40;
/** Barycenter sweeps. Two down-passes settle every graph this editor can hold. */
const SWEEPS = 2;

/**
 * Longest-path rank per node over the NON-LOOP wires.
 *
 * @param {object} template  v2 template { nodes, wires }
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @returns {Record<string, number>}
 */
export function rankNodes(template, portsFn) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = liveNonLoopEdges(template, portsFn, ids);

  const rank = {};
  const indegree = {};
  for (const id of ids) { rank[id] = 0; indegree[id] = 0; }
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
    indegree[e.to] += 1;
  }

  // Kahn with a sorted frontier: ties break by node id, so the walk order — and
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

  // A residual cycle survives only when no loop wire cuts it (V10 blocks saving
  // such a graph, but the editor still has to draw it). Rank the leftovers from
  // whatever settled feeds them, in id order — bounded, never a hang.
  for (const id of [...ids].filter((n) => !settled.has(n)).sort()) {
    const feeds = edges.filter((e) => e.to === id && settled.has(e.from));
    rank[id] = feeds.reduce((best, e) => Math.max(best, rank[e.from] + 1), 0);
    settled.add(id);
  }
  return rank;
}

/**
 * Positions for every node: `{ [nodeId]: { x, y } }`. The caller applies them.
 *
 * @param {object} template
 * @param {(node:object) => ({inputs?:Array, outputs?:Array}|undefined)} portsFn
 * @param {{x0?:number, dx?:number, y0?:number, gap?:number}} [opts]
 */
export function autoLayout(template, portsFn, { x0 = RANK_X0, dx = RANK_DX, y0 = RANK_Y0, gap = ROW_GAP } = {}) {
  const nodes = Array.isArray(template?.nodes) ? template.nodes : [];
  const rank = rankNodes(template, portsFn);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = liveNonLoopEdges(template, portsFn, ids);

  const columns = new Map();                       // rank -> node ids, in draw order
  for (const n of nodes) {
    if (!columns.has(rank[n.id])) columns.set(rank[n.id], []);
    columns.get(rank[n.id]).push(n.id);
  }
  const ranksAscending = [...columns.keys()].sort((a, b) => a - b);

  // Barycenter: sweep left to right, ordering each column by the mean row index
  // of its predecessors in the column before it. Nodes with no ranked
  // predecessor keep their current index, so the pass is stable.
  const preds = new Map();
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
      const column = columns.get(r);
      const keyed = column.map((id, i) => ({ id, i, bary: barycenter(preds.get(id), rowOf, i) }));
      keyed.sort((a, b) => a.bary - b.bary || a.i - b.i);
      columns.set(r, keyed.map((k) => k.id));
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions = {};
  for (const r of ranksAscending) {
    let cursor = y0;
    for (const id of columns.get(r)) {
      const node = byId.get(id);
      const { h } = nodeSize(portsFn(node) || { inputs: [], outputs: [] }, { caption: CAPTION_KINDS.has(node.kind) });
      positions[id] = { x: x0 + r * dx, y: snap(cursor) };
      cursor = snap(cursor) + h + gap;             // stack from the SNAPPED row, so the pass is idempotent
    }
  }
  return positions;
}

/** Wires whose endpoints both exist and which are NOT loop wires. */
function liveNonLoopEdges(template, portsFn, ids) {
  const wires = Array.isArray(template?.wires) ? template.wires : [];
  const { loopWires } = classifyLoops(template, portsFn);
  return wires
    .filter((w) => ids.has(w?.from?.node) && ids.has(w?.to?.node)
      && w.from.node !== w.to.node && !loopWires.has(w.id))
    .map((w) => ({ from: w.from.node, to: w.to.node }));
}

/** Mean row of the ranked predecessors; `fallback` when the node has none. */
function barycenter(predecessors, rowOf, fallback) {
  const rows = (predecessors || []).map((id) => rowOf.get(id)).filter((row) => row !== undefined);
  if (!rows.length) return fallback;
  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

/** Keep the Kahn frontier sorted without re-sorting the whole array each push. */
function insertSorted(list, id) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < id) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, id);
}
