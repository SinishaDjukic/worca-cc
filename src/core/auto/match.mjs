// "Reuse an exact twin, else create" (spec D8/D9): every runnable workflow —
// the built-in Default, the seeds, plugin rows, user rows and earlier
// Auto-created rows — is a candidate; the classifier never sees the list.
import { listWorkflows, GRAPH_DEFAULT_WORKFLOW } from '../workflows.mjs';
import { isomorphic } from '../../shared/graph/isomorphic.mjs';

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The built-in Default first, then every LIVE v2 row OLDEST first (spec §4.3: a
 *  seed beats a later twin, the first Auto-created row beats a duplicate).
 *  listWorkflows() hides archived and disabled-plugin rows and orders newest-first,
 *  hence the explicit sort. v1 rows (no `nodes`) are never candidates. */
export async function autoCandidates() {
  const rows = (await listWorkflows()).filter((t) => t && t.version === 2 && Array.isArray(t.nodes) && Array.isArray(t.wires));
  rows.sort((a, b) => byCodeUnit(String(a.createdAt ?? ''), String(b.createdAt ?? '')) || byCodeUnit(String(a.id), String(b.id)));
  return [GRAPH_DEFAULT_WORKFLOW, ...rows];
}

/**
 * @param {object} template an assembled v2 template
 * @param {object[]} candidates autoCandidates() output (or any template list)
 * @returns {{candidate:object, nodeMap:Map<string,string>}|null} the FIRST exact-topology twin
 */
export function findEquivalentWorkflow(template, candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const nodeMap = isomorphic(template, candidate);
    if (nodeMap) return { candidate, nodeMap };
  }
  return null;
}
