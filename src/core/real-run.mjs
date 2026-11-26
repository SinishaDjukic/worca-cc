// src/core/real-run.mjs
// The one definition of a "real run", shared by Getting started, Statistics and the levels facts: a run that
// finished, was not a demo (mock) run, and cost something. A demo run or a $0 run never counts, and deleting
// a run (pipelines.deleted_at) does not take it back, so none of this filters on deleted_at. A workflow test try
// (pipelines.is_test, D21/D22) is never a real run: tries stay out of Getting started, Statistics and the levels.
// SQL fragments are over a pipelines alias; the mock flag lives in pipelines.run_setup (JSON).

import { prepare } from './db.mjs';

/** True when pipelines.run_setup says the run was started as a mock (demo) run. SQL over alias `alias`. */
export const DEMO_RUN_SQL = (alias = 'p') =>
  `json_extract(CASE WHEN json_valid(${alias}.run_setup) THEN ${alias}.run_setup END, '$.mock') = 1`;

/** True when the run finished, is not a demo or a test try and has a cost: its own total, or any step's (a row with no total yet). */
export const REAL_RUN_SQL = (alias = 'p') =>
  `(${alias}.status = 'done' AND ${alias}.is_test IS NULL AND NOT COALESCE(${DEMO_RUN_SQL(alias)}, 0) AND (${alias}.total_cost_usd > 0 OR EXISTS (SELECT 1 FROM pipeline_steps rs WHERE rs.pipeline_id = ${alias}.id AND rs.cost_usd > 0)))`;

/** Is this run a real run? A guarded read: false for an unknown id or any error. */
export function isRealRun(id) {
  if (!id) return false;
  try {
    return !!prepare(`SELECT 1 AS ok FROM pipelines p WHERE p.id = ? AND ${REAL_RUN_SQL('p')}`).get(String(id));
  } catch {
    return false;
  }
}
