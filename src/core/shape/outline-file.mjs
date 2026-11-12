// src/core/shape/outline-file.mjs — what a slicing Planner left in the outline file (slices.json) after a spawn. The
// executor computes it and the orchestrator's outline loop reads only its result, so the two never disagree (D9, D10).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EMPTY_SHA = createHash('sha256').update('').digest('hex');

/** The Planner's plan output: the first allocated output path (the one the mock writes, executor markersFor MOCK_OUT). */
export function planOutputOf(outputs) {
  return Object.values(outputs || {}).map((o) => o && o.path).find(Boolean) || null;
}

/** sha256 hex of the file's bytes, or null when it cannot be read (missing). */
export async function fileSha(file) {
  if (typeof file !== 'string' || !file) return null;
  try { return createHash('sha256').update(await readFile(file)).digest('hex'); } catch { return null; }
}

/**
 * Classify the outline file after a spawn, in order:
 * missing → 'flat'; no baseline (the first round) → 'outline'; the outline changed since the asked round → 'outline';
 * a non-empty plan output that differs from the one present at ask time → 'flat' (the planner wrote the plan instead);
 * else 'unchanged' (re-ask the same outline). A plan left by an earlier spawn of the same execution is not fresh: it is
 * compared by `baseline.planSha`, never by existence.
 * @param {string} file the outline file
 * @param {{baseline?: {sha: string|null, planSha?: string|null}|null, planFile?: string|null}} [o]
 * @returns {Promise<'outline'|'unchanged'|'flat'>}
 */
export async function outlineFileState(file, { baseline = null, planFile = null } = {}) {
  const sha = await fileSha(file);
  if (sha == null) return 'flat';
  if (!baseline) return 'outline';
  if (sha !== baseline.sha) return 'outline';
  const plan = await fileSha(planFile);
  const empty = plan == null || plan === EMPTY_SHA;
  if (!empty && plan !== (baseline.planSha ?? null)) return 'flat';
  return 'unchanged';
}

