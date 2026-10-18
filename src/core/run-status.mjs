// src/core/run-status.mjs — the run model (src/shared/run-model.mjs) read from the DB, for the surfaces that have
// no live run map: the CLI's run detail and Ask Worca's run tools (spec §5a.7, one wording everywhere). The DB has no
// pendingQuestion (memory-only), so a run waiting for an answer reads its stage here.
import { readPipelineStateById, readPrState } from './artifacts.mjs';
import { runModel } from '../shared/run-model.mjs';

/** The model for one pipeline id, or null when there is no such run. */
export function runModelFor(pipelineId, opts = {}) {
  const state = pipelineId ? readPipelineStateById(pipelineId) : null;
  return state ? runModel({ ...state, pr: readPrState(pipelineId) }, opts) : null;
}

/** The status line for one pipeline id, or null. */
export function runStatusLine(pipelineId, opts = {}) {
  const m = runModelFor(pipelineId, opts);
  return m ? m.line : null;
}
