// src/core/shape/small-runs.mjs — Shaper small runs (flag shaperSmallRuns, docs/feature-flags.md): the one place the
// server reads the flag. Server callers pass its value into browser-safe code, which never reads it itself.
import { flagEnabled } from '../flags.mjs';
import { getDb } from '../db.mjs';
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

/** Shaper small runs B1 (D1): whether a new shaped planning run is stamped. The live flag at start, or the stamp of the
 *  feature a re-plan run replaces (a marked feature stays marked whatever the flag says now). */
export function smallRunsAtStart({ replacesMarked = false, deps = {} } = {}) {
  return shaperSmallRunsOn(deps) || replacesMarked === true;
}

const markedStats = (text) => { try { return JSON.parse(text)?.smallRuns === true; } catch { return false; } };

/** B1 (D2): the marker saved on a run (`pipelines.shape_stats.smallRuns`); false for no id (before any DB access), an
 *  unknown row or bad JSON. Never throws. `deps.getDb` is a test seam. */
export function smallRunsOfPipeline(pipelineId, deps = {}) {
  if (!pipelineId) return false;
  try {
    const row = (deps.getDb || getDb)().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(String(pipelineId));
    return !!row && markedStats(row.shape_stats);
  } catch { return false; }
}

/** B1 (D2): a feature's marker is its origin run's. Slice runs are never stamped: they resolve to their feature. */
export function smallRunsOfFeature(featureId, deps = {}) {
  if (!featureId) return false;
  try {
    const row = (deps.getDb || getDb)().prepare(`SELECT p.shape_stats FROM shape_features f JOIN pipelines p ON p.id = f.origin_pipeline_id
      WHERE f.id = ?`).get(String(featureId));
    return !!row && markedStats(row.shape_stats);
  } catch { return false; }
}
