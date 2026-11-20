// src/core/shape/small-runs.mjs — Shaper small runs (flag shaperSmallRuns, docs/feature-flags.md): the one place the
// server reads the flag. Server callers pass its value into browser-safe code, which never reads it itself.
import { flagEnabled } from '../flags.mjs';
import { CARE_DEFAULT } from '../../shared/shape/feature-record.mjs';

/** Whether Shaper's small runs are on, read fresh on each call (env plus settings). `deps.flagEnabled` is a test seam. */
export function shaperSmallRunsOn(deps = {}) {
  return (deps.flagEnabled ? deps.flagEnabled('shaperSmallRuns') : flagEnabled('shaperSmallRuns')) === true;
}

/** The split rules' options for normalizeOutline, checkSlices and slicingBlock (A3): the small-runs rules when the flag
 *  is on, else `{}` (dev's rules). Care is Balanced until the Care dial (B2): no feature record exists while the outline
 *  is checked. */
export function splitRulesOptions(deps = {}) {
  return shaperSmallRunsOn(deps) ? { smallRuns: true, care: CARE_DEFAULT.position } : {};
}
