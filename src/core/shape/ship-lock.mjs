// src/core/shape/ship-lock.mjs — the Ship lock: which features this process is shipping now. While a small-runs feature
// ships (its marker, flag on), nothing of it may start: a round, an appended run, a requirement change, a re-plan or a Verifier check.
// Unmarked features and the flag off start as on dev. A leaf: features.mjs and verifier.mjs import it.
import { shaperSmallRunsOn, smallRunsOfFeature } from './small-runs.mjs';

/** Feature ids with a Ship in flight (ship_mode is written only at the end). */
export const SHIPPING = new Set();
export const featureShipping = (id) => SHIPPING.has(String(id));

/** The refusal every start answers while the lock holds. */
export const SHIP_LOCK = Object.freeze({ code: 'SHIPPING', error: 'this feature is shipping: try again when Ship is done' });

/** Whether the lock holds for the feature. */
export const shipLocked = (id) => featureShipping(id) && shaperSmallRunsOn() && smallRunsOfFeature(id);

/** Throws the refusal (code, status 409) while the lock holds. Called inside the transaction that writes the row. */
export function refuseWhileShipping(id) {
  if (shipLocked(id)) throw Object.assign(new Error(SHIP_LOCK.error), { code: SHIP_LOCK.code, status: 409 });
}

/** Pipeline ids with a run's own Create PR in flight (POST /api/pr), counted: a One ship that sees one refuses
 *  HAS_SLICE_PR, since that run's PR would open past the guard and be left open under the one PR. */
const PR_CREATING = new Map();
export function prCreateStarted(pipelineId) {
  const k = String(pipelineId);
  PR_CREATING.set(k, (PR_CREATING.get(k) || 0) + 1);
  return () => { const n = (PR_CREATING.get(k) || 1) - 1; if (n > 0) PR_CREATING.set(k, n); else PR_CREATING.delete(k); };
}
export const prCreating = (pipelineId) => PR_CREATING.has(String(pipelineId));
