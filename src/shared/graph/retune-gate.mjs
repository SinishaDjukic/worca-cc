// src/shared/graph/retune-gate.mjs
// WHEN a node can be retuned — one definition, both sides of the wire.
//
// The engine enforces this rule (orchestrator.mjs#_retunableNode) and the browser
// has to predict it: the graph card advertises a click, the popover decides
// between the editable pair and a note that explains the refusal, and the
// stylesheet greys the cursor. Written out separately in each place, the four
// copies drift — a new non-dispatching run status or a new in-flight row status
// added on one side leaves the UI offering a panel the engine answers with a 400,
// or greying out a node that is still perfectly editable.
//
// Pure and dependency-free, so `ui/public` can import it directly (run-decor.mjs
// re-exports it, the way it re-exports the manifest readers).

/**
 * Run statuses past which nothing will DISPATCH again, so no future execution
 * could pick a new model up.
 *
 * 'paused' is deliberately absent: a paused run resumes, and its pause-killed
 * execution is re-invoked from scratch, so its nodes stay retunable. So is
 * 'interrupted', for the same reason — which is why this is not the UI's
 * `isTerminalStatus`, and not the engine's own `_setStatus` terminal set either.
 * 'pausing' is in none of them.
 */
export const NO_DISPATCH_STATUS = Object.freeze(['done', 'stopped', 'error']);

/**
 * Whether an execution for `nodeId` is in flight RIGHT NOW.
 *
 * `_execStep` transitions a row in place, so 'start' means running this instant —
 * a node that finished cycle 1 and will be re-fired by a loop reads as idle,
 * which is where retuning is worth the most.
 *
 * Split out from nodeRetunable because a busy node is not the same refusal as an
 * ineligible one: the popover explains "an execution is in flight, its model is
 * fixed until that settles" rather than going inert.
 *
 * @param {{steps?:Array}} st a run model or a frozen state snapshot
 * @param {string} nodeId
 */
export function nodeBusy(st, nodeId) {
  return ((st && st.steps) || []).some((s) => s && s.nodeId === nodeId && s.status === 'start');
}

/**
 * Which face the retune UI should show for a node. ONE derivation, so the panel
 * that decides between an editable pair and an explanatory note, and the check
 * that decides whether to open at all, cannot disagree about the same node.
 *
 *   'flow' — a flow card spawns nothing, so there is no model to change
 *   'busy' — an execution is in flight; its model is fixed until that settles
 *   'edit' — retunable now
 *
 * @param {{id:string, kind?:string}|null|undefined} node the manifest cell
 * @param {boolean} busy nodeBusy() for that node
 */
export function armFor(node, busy) {
  if (!node || node.kind !== 'agent') return 'flow';
  return busy ? 'busy' : 'edit';
}

/**
 * armFor plus the RUN-level question, which only a caller holding the run state
 * can answer: past done/stopped/error nothing will dispatch again, so there is no
 * next execution for a new model to reach and no panel worth opening.
 *
 * @param {{status?:string, steps?:Array}} st a run model or a frozen state snapshot
 * @param {{id:string, kind?:string}|null|undefined} node the manifest cell
 * @returns {'dead'|'flow'|'busy'|'edit'}
 */
export function retuneArm(st, node) {
  if (NO_DISPATCH_STATUS.includes(String((st && st.status) || ''))) return 'dead';
  return armFor(node, nodeBusy(st, node && node.id));
}
