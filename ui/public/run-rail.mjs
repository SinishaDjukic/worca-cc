// ui/public/run-rail.mjs
//
// Pure, DOM-free: the list-density projection of a pipeline's progress.
//
// The full graph (.run-flow, paintRunGraph) is 324px tall, scrolls horizontally
// and clips — fine when a pipeline is the only thing on screen, wrong when six
// of them are. The rail is the same information at one line: one marker per
// stage plus the connectors between them.
//
// It deliberately consumes the SAME view adapter paintRunGraph takes
// ({ statusOf, activeId, cycles, live }), so the two densities can never
// disagree about a node's status — there is one status computation, in
// paintStepper / paintHistStepper, and two renderers.

/** Marker status for one cell, folded from the statuses of the nodes in it.
 *  A cell holds parallel nodes; the cell is as far along as its LEAST advanced
 *  node, except that any stopped/paused node dominates (that is what halted the
 *  pipeline, and it is what the reader needs to see). */
export function cellStatus(statuses) {
  const list = (statuses || []).filter(Boolean);
  if (!list.length) return 'pending';
  if (list.includes('stopped')) return 'stopped';
  if (list.includes('paused')) return 'paused';
  if (list.includes('active')) return 'active';
  return list.every((s) => s === 'done') ? 'done' : 'pending';
}

/**
 * Project a manifest + view adapter into a flat row list for the rail:
 * alternating markers and connectors, in reading order.
 *
 *   [{kind:'cell', idx, label, status, cycles, nodeIds},
 *    {kind:'bar', done}, {kind:'cell', …}, …]
 *
 * `label` is the cell's own label when it has one, else the single node's label,
 * else "Step N" — the same precedence buildRunGraph uses for its column tag,
 * because the rail replaces that tag. A parallel cell reports the node count so
 * the renderer can mark it without inventing a label.
 *
 * A connector is `done` when the cell BEFORE it is done: that is what makes the
 * completed prefix of the pipeline read as one continuous run.
 *
 * @param {{steps: Array<{label?: string, nodes: Array<{id: string, label?: string}>}>}} manifest
 *        a NORMALIZED manifest (callers pass manifestFor(...)'s result)
 * @param {{statusOf: (id: string) => string, activeId?: string|null,
 *          cycles?: Record<string, number>}} view
 */
export function railRows(manifest, view) {
  const cells = Array.isArray(manifest?.steps) ? manifest.steps : [];
  const statusOf = typeof view?.statusOf === 'function' ? view.statusOf : () => 'pending';
  const cycles = view?.cycles || {};
  const rows = [];
  cells.forEach((cell, idx) => {
    const nodes = Array.isArray(cell?.nodes) ? cell.nodes : [];
    const nodeIds = nodes.map((n) => n && n.id).filter(Boolean);
    const status = cellStatus(nodeIds.map((id) => statusOf(id)));
    if (idx > 0) rows.push({ kind: 'bar', done: rows.length ? lastCellDone(rows) : false });
    rows.push({
      kind: 'cell',
      idx,
      label: cellLabel(cell, nodes, idx),
      status,
      // Highest loop count among the cell's nodes: the rail shows THAT a stage
      // looped, not which of its parallel nodes did.
      cycles: nodeIds.reduce((max, id) => Math.max(max, Number(cycles[id]) || 0), 0),
      parallel: nodes.length > 1 ? nodes.length : 0,
      nodeIds,
      active: !!(view && view.activeId && nodeIds.includes(view.activeId)),
    });
  });
  return rows;
}

function lastCellDone(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].kind === 'cell') return rows[i].status === 'done';
  }
  return false;
}

function cellLabel(cell, nodes, idx) {
  if (cell && cell.label) return String(cell.label);
  if (nodes.length === 1 && nodes[0] && nodes[0].label) return String(nodes[0].label);
  return `Step ${idx + 1}`;
}

/**
 * The "3/6" progress a mini card shows next to the rail.
 *
 * `done` counts cells that are fully done. `at` is the 1-based position of the
 * cell the pipeline is AT — the active/paused/stopped one when there is one,
 * else the count of done cells (so a finished run reads "6/6" and a fresh one
 * "0/6"). Returns nulls-free plain numbers; the caller decides the wording.
 */
export function railProgress(rows) {
  const cells = (rows || []).filter((r) => r && r.kind === 'cell');
  const done = cells.filter((c) => c.status === 'done').length;
  const frontier = cells.find((c) => c.status === 'active' || c.status === 'paused' || c.status === 'stopped');
  return { done, total: cells.length, at: frontier ? frontier.idx + 1 : done };
}

/**
 * True when the rail should hide its per-cell labels: past a certain number of
 * stages the labels collide, and the markers alone still carry the shape. The
 * active cell keeps its label regardless (that is the one datum a reader wants),
 * which the renderer applies — this only decides the general case.
 */
export const RAIL_LABEL_LIMIT = 8;
export function railLabelsFit(rows) {
  return (rows || []).filter((r) => r && r.kind === 'cell').length <= RAIL_LABEL_LIMIT;
}
