// src/core/shape/care-run.mjs — Shaper small runs C2 (D6): the one place a slice run's Care plan (careRunPlan) becomes
// graph changes. Pure: resolveGraph runs it as `opts.transform` on its private copy of the slice template.
import { withTestWriter } from '../graph/builtin-workflows.mjs';

/** The code fix loops Care bounds: the code review's (`w9`) and, in the UX variant, the web UI check's (`w14`). */
const FIX_LOOP_WIRES = Object.freeze(['w9', 'w14']);
const ROLES_NODE = 'n_roles';

/**
 * A slice template shaped by `plan`: the Test writer when `plan.testWriter`; the authored `maxCycles` of the fix loops
 * set to `plan.fixCycles` (authored, so a project or run budget still wins); Product's second opinion on the plan
 * review only when `plan.secondOpinion`. Returns a new template; `template` is never changed. A template without
 * `w14` gets none.
 */
export function careRunGraph(template, plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const g = p.testWriter ? withTestWriter(template) : structuredClone(template);
  for (const w of g.wires) {
    if (!FIX_LOOP_WIRES.includes(w.id) || !Number.isInteger(p.fixCycles)) continue;
    w.config = { ...(w.config || {}), maxCycles: p.fixCycles };
  }
  const roles = g.nodes.find((n) => n.id === ROLES_NODE);
  const rr = roles?.config?.roleReview;
  if (rr && typeof rr === 'object' && rr.secondOpinion && !p.secondOpinion) {
    const { secondOpinion, ...rest } = rr;
    roles.config = { ...roles.config, roleReview: rest };
  }
  return g;
}
