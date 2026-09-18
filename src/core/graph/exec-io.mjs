// src/core/graph/exec-io.mjs
//
// Execution I/O shared by every executor that publishes ports and reads a verdict:
// the agent executor (executor.mjs) and the script runner (script-runner.mjs). Moved
// out of executor.mjs so the script runner needs no executor import and no cycle;
// executor.mjs re-exports `readVerdict` and `publishable` for its existing importers.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, basename } from 'node:path';

import { normalizeReview, safeParseJson } from '../protocol.mjs';

// ── verdicts ──────────────────────────────────────────────────────────────────

/** The text every unparseable verdict file fails with. */
const BAD_VERDICT_TAIL = 'expected { "issues": [ \u2026 ] }';

/**
 * Read a node's verdict JSON back through the protocol normalizer.
 *
 * Two degenerate cases, deliberately split (they are NOT the same failure):
 *  - the file was NEVER WRITTEN -> `{issues: [], summary: '', missing: true}`: a clean
 *    pass, v1 parity, because an agent that declares a verdict and writes none must not
 *    fail a run. `missing` is the flag the caller turns into a warning (and the reason
 *    the reviews table skips the row) instead of a phantom zero-issue review.
 *  - the file EXISTS but does not parse, or carries no `issues` array -> THROW. The
 *    verifier wrote garbage, and on every shipped seed the clean side is wired straight
 *    to End, so "no issues" there is indistinguishable from an approval. Fail-fast owns
 *    the rest.
 *
 * `readReview` is untouched for its other callers (it is v1 code with its own tolerant
 * contract); the existsSync + parse-failure branch lives here.
 */
export async function readVerdict(verdictPath) {
  if (!verdictPath) return { issues: [], summary: '' };
  if (!existsSync(verdictPath)) return { issues: [], summary: '', missing: true };
  let text;
  try {
    text = await readFile(verdictPath, 'utf8');
  } catch (err) {
    throw Object.assign(new Error(`verdict file unreadable: ${verdictPath} — ${err?.message || err}`),
      { code: 'BAD_VERDICT' });
  }
  const data = safeParseJson(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.issues)) {
    throw Object.assign(new Error(`verdict file is not a review JSON: ${verdictPath} — ${BAD_VERDICT_TAIL}`),
      { code: 'BAD_VERDICT' });
  }
  return normalizeReview(data);
}

/** The warning line a missing verdict raises, relative to the pipeline dir so the
 *  run log stays readable. */
export function missingVerdictWarning(ctx, verdictPath) {
  const rel = ctx?.pipelineDir ? relative(ctx.pipelineDir, verdictPath) : basename(verdictPath);
  return `verdict file missing: ${ctx?.nodeId || ctx?.node?.id || '?'} ${rel} — treated as clean`;
}

// ── publishing ────────────────────────────────────────────────────────────────

/** The output map the scheduler publishes from: an entry per declared port, with a
 *  path where one was allocated and an empty payload for void ports. Exported for
 *  P4's composite `finish` arm. */
export function publishable(ports, outputs) {
  const out = {};
  for (const port of ports?.outputs || []) {
    if (!port) continue;
    out[port.id] = outputs[port.id]?.path ? { path: outputs[port.id].path } : {};
  }
  return out;
}
