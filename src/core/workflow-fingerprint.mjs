// src/core/workflow-fingerprint.mjs
// A workflow version's identity (plans/workflow-tests-plan.md D6): the graph's shape — nodes {id, kind, key, config}
// and wires {id, from, to, config} (config = the loop settings, maxCycles and onExhausted, read by wireConfig), layout excluded — plus the hash of every agent/script it uses
// (workflow-parts.mjs). Leaf module: node:crypto + the shared canon only.
import { createHash } from 'node:crypto';
import { canon, cleanConfig, wireConfig } from '../shared/graph/diff-graphs.mjs';

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const items = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);

/** @param {{nodes?: Array, wires?: Array}} graph */
export function graphShape(graph) {
  return {
    nodes: items(graph?.nodes).map((n) => ({ id: n.id, kind: n.kind ?? null, key: n.key ?? null, config: cleanConfig(n.config) })).sort(byId),
    wires: items(graph?.wires).map((w) => ({ id: w.id, from: w.from ?? null, to: w.to ?? null, config: wireConfig(w) })).sort(byId),
  };
}

/** @param {object} graph @param {Array<{kind:string,key:string,hash:string}>} [parts] @returns {string} 16 hex chars */
export function workflowFingerprint(graph, parts = []) {
  const p = (Array.isArray(parts) ? parts : []).map((x) => [x.kind, x.key, x.hash]);
  return createHash('sha256').update(canon({ g: graphShape(graph), p })).digest('hex').slice(0, 16);
}
