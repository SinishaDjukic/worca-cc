// src/core/workflow-tests/runnable.mjs
// What a RUN of a workflow uses (plans/workflow-tests-plan.md D2, D9, D13) and the revision snapshot taken before a
// write. Kept out of core/workflows.mjs (size cap); workflows.mjs re-exports runnableOf.
import { prepare } from '../db.mjs';
import { snapshotRowTx, readVersion, liveVersionNo } from '../workflow-revisions.mjs';
import { flagEnabled } from '../flags.mjs';
import { isReservedWorkflowId } from '../graph/builtin-workflows.mjs';
import { pickTemplateExtras } from '../../shared/graph/template.mjs';

/** D3: does this write change what the row holds? (name, domain, graph, or un-archiving it). */
export function rowChanges(prev, { name, domain, graph }) {
  return prev.version !== 2 || prev.name !== name || (prev.domain || 'general') !== domain
    || prev.graph !== JSON.stringify(graph) || !!prev.archived_at;
}


/** Inside the caller's transaction, before it rewrites workflow `id`: snapshot the row as it is now when there is one and
 *  `changes(row)` says the write alters it. `opts`: {source, by, now} as for snapshotRowTx. */
export function snapshotBeforeWrite(id, changes, opts) {
  const prev = prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  if (prev && changes(prev)) snapshotRowTx(prev, opts);
}

/** readRunnableWorkflow over a template already read (readWorkflow / listWorkflows output). Synchronous.
 *  `use`: 'live' (default; the version in use when the workflowTests flag is on, else the row), 'draft' (the row),
 *  or n > 0 (that named version). Built-ins and plugin rows are never versioned. The result carries `versionNo`.
 *  @throws code 'BAD_REQUEST' on a `use` that is none of 'live', 'draft' or a positive integer (M8);
 *  code 'NOT_FOUND' when the version asked for does not exist */
export function runnableOf(row, { use = 'live' } = {}) {
  if (use !== 'live' && use !== 'draft' && !(Number.isInteger(use) && use > 0)) {
    throw Object.assign(new Error(`use must be 'live', 'draft' or a version number, not ${JSON.stringify(use)}`), { code: 'BAD_REQUEST' });
  }
  if (!row || row.version !== 2 || isReservedWorkflowId(row.id)
    || (typeof row.origin === 'string' && row.origin.startsWith('plugin:'))) return row;
  const id = row.id;
  let no = null;
  if (Number.isInteger(use) && use > 0) no = use;
  else if (use === 'live' && flagEnabled('workflowTests')) no = liveVersionNo(row.id);
  if (!no) return { ...row, versionNo: null };
  const v = readVersion(row.id, no);
  if (!v) throw Object.assign(new Error(`workflow "${id}" has no version ${no}`), { code: 'NOT_FOUND' });
  const g = v.graph && typeof v.graph === 'object' ? v.graph : {};
  const { canvas: _c, codeGraph: _g, sessions: _s, nodes: _n, wires: _w, ...rest } = row;
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  return {
    ...rest, name: v.name, domain: v.domain || row.domain,
    nodes, wires: Array.isArray(g.wires) ? g.wires : [],
    ...pickTemplateExtras(g, nodes),   // the version's canvas, code-graph opt-out and session settings
    versionNo: no,
  };
}
