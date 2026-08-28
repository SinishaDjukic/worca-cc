// test/helpers/graph-templates.mjs
// One place for "give me a runnable saved pipeline". Before the v2 break these
// suites hand-built a v1 `{steps, feedbacks}` template; the graph engine reads
// nodes + wires, so they borrow one of the 7 shipped seed graphs instead of
// hand-wiring typed ports in every file.
import { writeGraphWorkflow } from '../../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../../src/core/workflows.mjs';
import { buildGraphManifest } from '../../src/shared/graph/manifest.mjs';
import { loadAgentRegistry } from '../../src/core/agent-registry.mjs';

/**
 * Persist one shipped seed graph under a caller-chosen id and return the row.
 * @param {string} seedId one of SEED_TEMPLATES' ids (e.g. 'wf_quick-fix')
 * @param {string} [id] the id to save it under (default: the seed's own id)
 * @returns {Promise<object>} the stored template
 */
export async function writeSeedGraph(seedId, id = seedId) {
  const t = SEED_TEMPLATES.find((s) => s.id === seedId);
  if (!t) throw new Error(`unknown seed template: ${seedId}`);
  return writeGraphWorkflow({ id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
}

/**
 * A REAL v2 resume point for a paused-run fixture: the graph engine rehydrates
 * from `manifest`, so a bare `{ version: 2 }` blob is not enough (it throws
 * "the v2 resume point carries no manifest"). The snapshot is null, which
 * replays the graph from the start — exactly what the v1 `kind:'boundary'`
 * points these fixtures used to carry did.
 * @param {object} [over] fields to merge onto the point
 * @returns {object} a resume point the graph engine accepts
 */
export function graphResumePoint(over = {}) {
  const manifest = buildGraphManifest(GRAPH_DEFAULT_WORKFLOW, loadAgentRegistry());
  return {
    version: 2,
    snapshot: null,
    manifest,
    nodes: [],
    planVersion: 0,
    stepModels: null,
    workflowId: GRAPH_DEFAULT_WORKFLOW.id,
    checkpointRef: null,
    pausedAt: '2026-06-09T00:00:00Z',
    ...over,
  };
}
