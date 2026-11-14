// src/core/workflow-usage.mjs — what each workflow has done (Stillhet slice 7 D13): the tasks that ran it, the share of
// their PRs that merged, how many run now, and per node the average cost and minutes of a step. Read-only: the
// pipelines rows name their workflow in `stepper` ($.template.id); their steps carry node_id, cost_usd and active_ms.

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{prepare: Function}} db
 * @returns {Record<string, {tasks:number, merged:number|null, running:number, nodes: Record<string, {costUsd:number, minutes:number}>}>}
 */
export function workflowUsage(db) {
  let rows, steps;
  try {
    rows = db.prepare('SELECT id, status, stepper, pr_url, pr_state FROM pipelines').all();
    steps = db.prepare('SELECT pipeline_id, node_id, cost_usd, active_ms FROM pipeline_steps WHERE node_id IS NOT NULL').all();
  } catch { return {}; }
  const out = {}, wfOf = new Map(), withPr = {}, merged = {}, sums = {};
  for (const r of rows) {
    let id;
    try { id = JSON.parse(r.stepper)?.template?.id; } catch { continue; }
    if (typeof id !== 'string' || !id) continue;
    wfOf.set(r.id, id);
    const u = (out[id] ||= { tasks: 0, merged: null, running: 0, nodes: {} });
    u.tasks += 1;
    if (r.status === 'running') u.running += 1;
    if (r.pr_url) { withPr[id] = (withPr[id] || 0) + 1; if (r.pr_state === 'MERGED') merged[id] = (merged[id] || 0) + 1; }
  }
  for (const [id, n] of Object.entries(withPr)) out[id].merged = Math.round(((merged[id] || 0) / n) * 100);
  for (const s of steps) {
    const id = wfOf.get(s.pipeline_id); if (!id) continue;
    const a = ((sums[id] ||= {})[s.node_id] ||= { cost: 0, ms: 0, n: 0 });
    a.cost += Number(s.cost_usd) || 0; a.ms += Number(s.active_ms) || 0; a.n += 1;
  }
  for (const [id, nodes] of Object.entries(sums)) {
    for (const [node, a] of Object.entries(nodes)) out[id].nodes[node] = { costUsd: round2(a.cost / a.n), minutes: round2(a.ms / a.n / 60000) };
  }
  return out;
}
