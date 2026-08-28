// src/core/engine-select.mjs
// One engine remains. The only decision left is refusing a run/resume that was
// pinned to the retired v1 engine.

import { createOrchestrator } from './orchestrator.mjs';
import { V1_RUN_RETIRED } from './db.mjs';

export class EngineRetiredError extends Error {
  constructor() { super(V1_RUN_RETIRED); this.code = 'ENGINE_RETIRED'; this.status = 409; }
}

/**
 * Build the orchestrator this run needs. Still ASYNC (every call site awaits it)
 * and still accepts `opts.template` as a routing HINT that is never forwarded as
 * an orchestrator option.
 * @param {object} opts createOrchestrator options (+ optional opts.resume / opts.template)
 * @returns {Promise<object>} a graph orchestrator, `.engine === 'graph'`
 * @throws {EngineRetiredError} when the resume point is not a graph point
 */
export async function createOrchestratorFor(opts = {}) {
  const { template, ...rest } = opts;
  const rpVersion = rest?.resume?.resumePoint?.version;
  // A resume must run on the engine that FROZE the point. Only `version: 2` is
  // resumable now; `undefined` means "no point at all" (a fresh run) and falls
  // through, but a point that carries any OTHER version — including an
  // unversioned `null` blob the v1 engine wrote — is refused rather than
  // silently re-planned on the graph engine.
  if (rpVersion !== undefined && Number(rpVersion) !== 2) throw new EngineRetiredError();
  const orch = createOrchestrator(rest);
  orch.engine = 'graph';   // the only answer there is; kept observable for callers and tests
  return orch;
}
