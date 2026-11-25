// src/core/shape/small-runs.mjs — Shaper small runs (flag shaperSmallRuns, docs/feature-flags.md): the one place the
// server reads the flag. Server callers pass its value into browser-safe code, which never reads it itself.
import { flagEnabled } from '../flags.mjs';
import { getDb } from '../db.mjs';
import { CARE_DEFAULT, careOfRow, normalizeStartCare } from '../../shared/shape/feature-record.mjs';
import { normalizePrototype } from '../../shared/shape/prototype.mjs';

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

/** B4 (D3): the split rules of a run, from its small-runs marker and the Care saved at Start (`shapeRec`, the
 *  orchestrator's `_shapeRec`): `{ smallRuns: true, care }` with the marker (the raw position: checkSlices and
 *  slicingBlock normalise it), `{}` without. Never reads the live flag. */
export function splitRules(shapeRec) {
  return shapeRec?.smallRuns === true ? { smallRuns: true, care: shapeRec.care?.position } : {};
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

/** B2 (D8): the Care saved at a planning run's Start step (`pipelines.shape_stats.care`), or null (no id, before any DB
 *  access; no row; no Care; an invalid record; bad JSON). Never throws. */
export function careOfPipeline(pipelineId, deps = {}) {
  if (!pipelineId) return null;
  try {
    const row = (deps.getDb || getDb)().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(String(pipelineId));
    const c = row ? normalizeStartCare(JSON.parse(row.shape_stats)?.care) : null;
    return c?.ok ? c.care : null;
  } catch { return null; }
}

/** B2: a feature's Care as its row stores it (`careOfRow`), or null for no id (before any DB access) or an unknown
 *  feature. Never throws. */
export function careOfFeature(featureId, deps = {}) {
  if (!featureId) return null;
  try {
    const row = (deps.getDb || getDb)().prepare('SELECT care, care_chosen_by, care_worca_pick FROM shape_features WHERE id = ?').get(String(featureId));
    return row ? careOfRow(row) : null;
  } catch { return null; }
}

const protoOf = (row) => (row ? normalizePrototype(JSON.parse(row.shape_stats)?.prototype) : null);

/** C1 (D12): the Prototype step's record saved on a planning run (`pipelines.shape_stats.prototype`), or null (no id,
 *  before any DB access; no row; none saved; an invalid record; bad JSON). Never throws. */
export function prototypeOfPipeline(pipelineId, deps = {}) {
  if (!pipelineId) return null;
  try { return protoOf((deps.getDb || getDb)().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(String(pipelineId))); } catch { return null; }
}

/** C1 (D14): the pipeline id of the run that planned the feature (where its prototype was frozen), or null. */
export function originPipelineOfFeature(featureId, deps = {}) {
  if (!featureId) return null;
  try { return (deps.getDb || getDb)().prepare('SELECT origin_pipeline_id FROM shape_features WHERE id = ?').get(String(featureId))?.origin_pipeline_id || null; } catch { return null; }
}

/** C1 (D14): a feature's prototype record, its origin run's (the confirmed `ref` included), or null. Never throws. */
export function prototypeOfFeature(featureId, deps = {}) {
  if (!featureId) return null;
  try {
    return protoOf((deps.getDb || getDb)().prepare(`SELECT p.shape_stats FROM shape_features f JOIN pipelines p ON p.id = f.origin_pipeline_id
      WHERE f.id = ?`).get(String(featureId)));
  } catch { return null; }
}
