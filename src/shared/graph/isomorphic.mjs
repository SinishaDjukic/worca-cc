// src/shared/graph/isomorphic.mjs
// Exact-topology equality of two v2 templates as LABELLED DIRECTED MULTIGRAPHS.
// Used by the Auto matcher (spec §4.3, D8/D9): a saved workflow is reused only
// when agents, wiring, gates, loops and their budgets are identical. Tunables
// (model/effort/fanOut/askQuestions/subagentModel), positions, ids and names
// are deliberately invisible — they are per-run tuning, not topology.
// Pure and browser-safe: its one import is the shared constants table.
import { KEYED_KINDS } from './constants.mjs';

/** The config keys that ARE topology, per kind (mirrors validate.mjs KNOWN_CONFIG minus the tunables). */
const TOPOLOGY_CONFIG = Object.freeze({
  task: ['planStoreSeed'], agent: ['awaitAll'], script: ['awaitAll', 'ports', 'params'],
  and: ['arity'], or: ['arity'], combine: ['arity'], end: [],
});

export function nodeLabel(node) {
  const kind = String(node?.kind ?? '');
  const cfg = node && typeof node.config === 'object' && node.config ? node.config : {};
  const parts = [kind, KEYED_KINDS.includes(kind) ? String(node.key ?? '') : ''];
  for (const k of TOPOLOGY_CONFIG[kind] || []) {
    const v = cfg[k];
    // A gate's arity defaults to 2; an absent flag equals an explicit false.
    const norm = k === 'arity' ? (Number.isInteger(v) ? v : 2) : (v === undefined ? false : v);
    parts.push(`${k}=${JSON.stringify(norm)}`);
  }
  return parts.join('|');
}

export function wireLabel(wire) {
  const mc = wire?.config?.maxCycles;
  return `${wire?.from?.port ?? ''}>${wire?.to?.port ?? ''}|${Number.isInteger(mc) ? mc : ''}`;
}

const isNode = (n) => Boolean(n) && typeof n === 'object' && typeof n.id === 'string';
const isWire = (w) => Boolean(w) && typeof w === 'object' && typeof w?.from?.node === 'string' && typeof w?.to?.node === 'string';

function index(tpl) {
  const nodes = (Array.isArray(tpl?.nodes) ? tpl.nodes : []).filter(isNode);
  const ids = new Set(nodes.map((n) => n.id));
  const wires = (Array.isArray(tpl?.wires) ? tpl.wires : []).filter((w) => isWire(w) && ids.has(w.from.node) && ids.has(w.to.node));
  const label = new Map(nodes.map((n) => [n.id, nodeLabel(n)]));
  const out = new Map(nodes.map((n) => [n.id, []]));   // id -> [{ to, label }]
  const inn = new Map(nodes.map((n) => [n.id, []]));   // id -> [{ from, label }]
  for (const w of wires) {
    const l = wireLabel(w);
    out.get(w.from.node).push({ to: w.to.node, label: l });
    inn.get(w.to.node).push({ from: w.from.node, label: l });
  }
  // A node's signature: its label plus the sorted labels of its in/out wires.
  const sig = new Map(nodes.map((n) => [n.id,
    `${label.get(n.id)}#${out.get(n.id).map((e) => e.label).sort().join(',')}#${inn.get(n.id).map((e) => e.label).sort().join(',')}`]));
  return { nodes, wires, label, out, inn, sig };
}

/** Sorted multiset key of the edges between u -> v. */
function edgesBetween(ix, u, v) {
  return ix.out.get(u).filter((e) => e.to === v).map((e) => e.label).sort().join(',');
}

/**
 * @returns {Map<string,string>|null} a-node id -> b-node id, or null when the
 *   two templates are not the same labelled graph.
 */
export function isomorphic(a, b) {
  const A = index(a);
  const B = index(b);
  if (A.nodes.length !== B.nodes.length || A.wires.length !== B.wires.length) return null;
  const multiset = (ix) => [...ix.sig.values()].sort().join('\n');
  if (multiset(A) !== multiset(B)) return null;
  const wireSet = (ix) => ix.wires.map((w) => `${ix.label.get(w.from.node)}|${ix.label.get(w.to.node)}|${wireLabel(w)}`).sort().join('\n');
  if (wireSet(A) !== wireSet(B)) return null;

  // Candidates per a-node: b-nodes with the same signature. Fewest first.
  const bySig = new Map();
  for (const n of B.nodes) {
    if (!bySig.has(B.sig.get(n.id))) bySig.set(B.sig.get(n.id), []);
    bySig.get(B.sig.get(n.id)).push(n.id);
  }
  const order = [...A.nodes.map((n) => n.id)].sort((x, y) =>
    (bySig.get(A.sig.get(x)) || []).length - (bySig.get(A.sig.get(y)) || []).length || (x < y ? -1 : 1));
  const map = new Map();
  const used = new Set();

  const consistent = (u, x) => {
    for (const [v, y] of map) {
      if (edgesBetween(A, u, v) !== edgesBetween(B, x, y)) return false;
      if (edgesBetween(A, v, u) !== edgesBetween(B, y, x)) return false;
    }
    return edgesBetween(A, u, u) === edgesBetween(B, x, x);   // self-wires
  };
  const walk = (i) => {
    if (i === order.length) return true;
    const u = order[i];
    for (const x of bySig.get(A.sig.get(u)) || []) {
      if (used.has(x) || !consistent(u, x)) continue;
      map.set(u, x); used.add(x);
      if (walk(i + 1)) return true;
      map.delete(u); used.delete(x);
    }
    return false;
  };
  return walk(0) ? map : null;
}
