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
