// src/core/shape/small-runs.mjs — Shaper small runs (flag shaperSmallRuns, docs/feature-flags.md): the one place the
// server reads the flag. Server callers pass its value into browser-safe code, which never reads it itself.
import { flagEnabled } from '../flags.mjs';

/** Whether Shaper's small runs are on, read fresh on each call (env plus settings). `deps.flagEnabled` is a test seam. */
export function shaperSmallRunsOn(deps = {}) {
  return (deps.flagEnabled ? deps.flagEnabled('shaperSmallRuns') : flagEnabled('shaperSmallRuns')) === true;
}
