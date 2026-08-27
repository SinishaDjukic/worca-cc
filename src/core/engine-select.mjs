// src/core/engine-select.mjs
// Which engine runs a pipeline is decided by DATA — the template's `version`,
// or (on a resume) the frozen resume point's — never by a flag. There is no
// feature flag anywhere in worca's engine selection.

import { createOrchestrator } from './orchestrator.mjs';
import { createGraphOrchestrator } from './graph/orchestrator.mjs';
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
 * Build the orchestrator this run needs. Reads the resume point's version first
 * (a resume must run on the engine that froze the point), else the workflow
 * row's. Async because the row read is async — every call site awaits it. Pass
 * `opts.template` when the caller already read the row (POST /api/run does, via
 * assertRunnableWorkflow) to skip the second read; it is a routing hint, never
 * an orchestrator option.
 * @param {object} opts createOrchestrator options (+ optional opts.resume / opts.template)
 * @returns {Promise<object>} an orchestrator instance; its `.engine` is the
 *   selector's answer for the data that was read.
 */
export async function createOrchestratorFor(opts = {}) {
  const { template, ...rest } = opts;
  const resumePointVersion = rest.resume?.resumePoint?.version;
  // `== null`, not `=== undefined`: a stored point carrying `version: null` is
  // "no point" to selectEngine, so the template row must be read for it too.
  let templateVersion;
  if (resumePointVersion == null) {
    const tpl = template || (rest.workflowId ? await readWorkflow(rest.workflowId) : null);
    templateVersion = tpl?.version;
  }
  const engine = selectEngine({ templateVersion, resumePointVersion });
  const orch = engine === 'graph' ? createGraphOrchestrator(rest) : createOrchestrator(rest);
  orch.engine = engine; // the decision the data made, observable by callers and tests
  return orch;
}
