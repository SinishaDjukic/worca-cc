// src/core/engine-select.mjs
// Which engine runs a pipeline is decided by DATA — the template's `version`,
// or (on a resume) the frozen resume point's — never by a flag. There is no
// feature flag anywhere in worca's engine selection.
//
// The SELECTOR is final: `selectEngine` already answers 'graph' for version-2
// inputs. The FACTORY is not: no graph engine exists yet, so
// createOrchestratorFor still builds the v1 orchestrator for every input.

import { createOrchestrator } from './orchestrator.mjs';
import { readWorkflow } from './workflows.mjs';

/**
 * @param {{templateVersion?: number|string, resumePointVersion?: number|string}} args
 *   resumePointVersion WINS when present: a resume must run on the engine that
 *   froze the point (the v1 point freezes `plan`, the v2 point freezes the graph
 *   snapshot), whatever the workflow row says today.
 * @returns {'v1'|'graph'}
 */
export function selectEngine({ templateVersion, resumePointVersion } = {}) {
  const raw = resumePointVersion === undefined || resumePointVersion === null
    ? templateVersion
    : resumePointVersion;
  return Number(raw) === 2 ? 'graph' : 'v1';
}

/**
 * Build the orchestrator for `opts`. Reads the resume point's version first,
 * else the workflow row's. Async because the row read is async — every call
 * site awaits it.
 * @param {object} opts createOrchestrator options (+ optional opts.resume)
 * @returns {Promise<object>} an orchestrator instance; its `.engine` is the
 *   selector's answer for the data that was read.
 */
export async function createOrchestratorFor(opts = {}) {
  const resumePointVersion = opts.resume?.resumePoint?.version;
  // `== null`, not `=== undefined`: a stored point carrying `version: null` is
  // "no point" to selectEngine, so the template row must be read for it too.
  const templateVersion = resumePointVersion == null && opts.workflowId
    ? (await readWorkflow(opts.workflowId))?.version
    : undefined;
  const engine = selectEngine({ templateVersion, resumePointVersion });
  // P4 routes 'graph' to createGraphOrchestrator(opts); until then every run is v1.
  const orch = createOrchestrator(opts);
  orch.engine = engine; // the decision the data made, observable by callers and tests
  return orch;
}
