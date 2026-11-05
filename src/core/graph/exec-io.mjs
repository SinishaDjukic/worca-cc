// src/core/graph/exec-io.mjs
//
// Execution I/O shared by every executor that publishes ports and reads a verdict:
// the agent executor (executor.mjs) and the script runner (script-runner.mjs). Moved
// out of executor.mjs so the script runner needs no executor import and no cycle;
// executor.mjs re-exports `readVerdict` and `publishable` for its existing importers.
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { relative, basename } from 'node:path';

import { normalizeReview } from '../protocol.mjs';
import { isKnownSeverity } from '../../shared/graph/verdict.mjs';
import { firedOutputs } from '../../shared/graph/ports.mjs';

// ── verdicts ──────────────────────────────────────────────────────────────────

/** The text every unparseable verdict file fails with. */
const BAD_VERDICT_TAIL = 'expected { "issues": [ \u2026 ] }';

/**
 * Parse a verdict file's text strictly: the whole text as JSON, or exactly ONE fenced block.
 * The tolerant `safeParseJson` takes the first balanced object anywhere, so a schema example
 * written before the real verdict would win (and pass the run). Returns undefined on failure.
 */
function parseVerdictText(text) {
  const raw = String(text ?? '').trim();
  try { return JSON.parse(raw); } catch { /* try one fence */ }
  const fences = [...raw.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)];
  if (fences.length !== 1) return undefined;
  try { return JSON.parse(fences[0][1].trim()); } catch { return undefined; }
}

/**
 * Read a node's verdict JSON back through the protocol normalizer.
 *
 * Two degenerate cases, deliberately split:
 *  - the file was NEVER WRITTEN -> `{issues: [], summary: '', missing: true}`. The caller
 *    decides: an agent or script execution throws `VERDICT_MISSING` (missingVerdictError),
 *    so the node pauses instead of taking the clean path to End — silence is not approval.
 *    A node with `config.verdictOptional: true` keeps the old pass with a warning.
 *  - the file EXISTS but does not parse strictly, or carries no `issues` array -> THROW
 *    `BAD_VERDICT`.
 *
 * Severities outside the vocabulary read as major (normalizeSeverity); the raw values come
 * back in `unknownSeverities` so the caller can warn once per value.
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
  const data = parseVerdictText(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.issues)) {
    throw Object.assign(new Error(`verdict file is not a review JSON: ${verdictPath} — ${BAD_VERDICT_TAIL}`),
      { code: 'BAD_VERDICT' });
  }
  const unknown = [...new Set(data.issues
    .filter((i) => i && typeof i === 'object' && !isKnownSeverity(i.severity))
    .map((i) => (typeof i.severity === 'string' ? i.severity : JSON.stringify(i.severity ?? null))))];
  const review = normalizeReview(data);
  return unknown.length ? { ...review, unknownSeverities: unknown } : review;
}

/** The warning line a verdict with unrecognised severities raises. */
export function unknownSeverityWarning(ctx, review) {
  const vals = review?.unknownSeverities || [];
  return vals.length
    ? `${ctx?.nodeId || ctx?.node?.id || '?'}: verdict severity ${vals.map((v) => JSON.stringify(v)).join(', ')} is not one of critical/major/minor/suggestion — read as major`
    : null;
}

/** The warning line a missing verdict raises on a `verdictOptional` node, relative to the
 *  pipeline dir so the run log stays readable. */
export function missingVerdictWarning(ctx, verdictPath) {
  const rel = ctx?.pipelineDir ? relative(ctx.pipelineDir, verdictPath) : basename(verdictPath);
  return `verdict file missing: ${ctx?.nodeId || ctx?.node?.id || '?'} ${rel} — treated as clean`;
}

/** Whether a node opted out of the missing-verdict pause (graphs built on the v1 "no file = pass"). */
export const verdictOptional = (ctx) => ctx?.node?.config?.verdictOptional === true;

/** The error a missing verdict raises. `errorClass: null` keeps classifyError from sniffing the
 *  text: it is an unclassified node error, which the failure policy pauses (resume re-runs it). */
export function missingVerdictError(ctx, verdictPath) {
  const rel = ctx?.pipelineDir ? relative(ctx.pipelineDir, verdictPath) : basename(verdictPath);
  return Object.assign(new Error(`verdict file missing: ${ctx?.nodeId || ctx?.node?.id || '?'} never wrote ${rel} ` +
    '(turn cap, API error or a wrong path) — not read as approval'), { code: 'VERDICT_MISSING', errorClass: null });
}

/** Fold a read verdict into the execution's warnings, or throw when it is missing and required. */
export function checkVerdict(ctx, verdictPath, review, warnings) {
  if (!review) return;
  if (review.missing) {
    if (!verdictOptional(ctx)) throw missingVerdictError(ctx, verdictPath);
    warnings.push(missingVerdictWarning(ctx, verdictPath));
  }
  const unknown = unknownSeverityWarning(ctx, review);
  if (unknown) warnings.push(unknown);
}

// ── attempts ──────────────────────────────────────────────────────────────────

/**
 * Remove this execution's allocated output and verdict files before an attempt, so a retry
 * or a resume never publishes the failed attempt's files as its own (the script runner's
 * D22 rule, for agents). A path that is also a bound INPUT is never touched.
 */
export async function clearAllocated({ outputs = {}, verdict = null, bindings = {} } = {}) {
  const inputs = new Set(Object.values(bindings || {}).map((b) => b?.path).filter(Boolean));
  const paths = new Set(Object.values(outputs || {}).map((o) => o?.path).filter(Boolean));
  if (verdict?.path) paths.add(verdict.path);
  for (const p of paths) if (!inputs.has(p)) await rm(p, { force: true }).catch(() => {});
}

/**
 * Every output the verdict fires must exist and be non-empty before it publishes: a
 * never-written file would route a token naming nothing (the script runner already refuses).
 * Throws `OUTPUT_MISSING` (unclassified, so the node pauses).
 */
export async function assertOutputsWritten(ctx, ports, outputs, review) {
  const missing = [];
  for (const port of firedOutputs(ports?.outputs || [], review)) {
    const path = outputs?.[port?.id]?.path;
    if (!path) continue;
    const st = await stat(path).catch(() => null);
    if (!st || !st.isFile() || st.size === 0) {
      missing.push(`${port.id} (${ctx?.pipelineDir ? relative(ctx.pipelineDir, path) : basename(path)})`);
    }
  }
  if (missing.length) {
    throw Object.assign(new Error(`${ctx?.nodeId || ctx?.node?.id || '?'} did not write output ${missing.join(', ')} — ` +
      'nothing to publish downstream'), { code: 'OUTPUT_MISSING', errorClass: null });
  }
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
