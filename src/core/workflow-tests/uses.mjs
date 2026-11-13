// src/core/workflow-tests/uses.mjs
// What a try runs (plans/workflow-tests-part2-plan.md D13, D26): the draft (the workflows row) or a saved version, and
// its identity. The fingerprint uses TODAY's agent and script text, which every version runs (D6), so a Library edit
// since a try makes its results unusable for reuse.
import { readWorkflow } from '../workflows.mjs';
import { readVersion } from '../workflow-revisions.mjs';
import { workflowParts } from '../workflow-parts.mjs';
import { workflowFingerprint } from '../workflow-fingerprint.mjs';
import { testError } from './store.mjs';

const listOf = (a) => (Array.isArray(a) ? a : []);

/** @returns {Promise<{name: string, nodes: Array, wires: Array}|null>} */
export async function useGraph(workflowId, use) {
  if (use === 'draft') {
    const row = await readWorkflow(workflowId);
    return row && row.version === 2 ? { name: row.name, nodes: listOf(row.nodes), wires: listOf(row.wires) } : null;
  }
  const v = Number.isInteger(use) && use > 0 ? readVersion(workflowId, use) : null;
  return v ? { name: v.name, nodes: listOf(v.graph && v.graph.nodes), wires: listOf(v.graph && v.graph.wires) } : null;
}

/** @param {{registry?: object, scripts?: object, readText?: Function, scriptSource?: Function}} [deps] workflowParts' */
export async function useFingerprint(workflowId, use, deps = {}) {
  const g = await useGraph(workflowId, use);
  if (!g) throw testError(use === 'draft' ? `no workflow "${workflowId}"` : `no version ${use} of "${workflowId}"`, 'NOT_FOUND');
  return workflowFingerprint(g, await workflowParts(g, deps));
}
