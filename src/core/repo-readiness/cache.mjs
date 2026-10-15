// src/core/repo-readiness/cache.mjs
// In-memory readiness cache: one base report per projectKey, re-evaluated only when the project
// fingerprint (HEAD + instruction-file porcelain) or the ignore list changes. The final report
// (which tools are judged) is built from the base report and usage on every read (report.mjs).
import { EventEmitter } from 'node:events';
import { collectFacts, fingerprintOf } from './facts.mjs';
import { evaluateReadiness as realEvaluate } from './evaluate.mjs';
import { buildReport, summaryOf } from './report.mjs';
import { usedEngines, HISTORY_DAYS } from './used.mjs';
import { runEngineCounts } from '../artifacts.mjs';
import { readinessTools } from '../settings.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';

/** Emits `changed` ({projectKey}) when a read moves the project's result: its summary or any engine's level or failing set. */
export const cache = new EventEmitter();

let evaluate = realEvaluate;
/** Test seam: count or replace evaluations. null restores the real one. */
export function _setEvaluateForTest(fn) { evaluate = fn || realEvaluate; }

const entries = new Map();    // projectKey → {fingerprint, base, evaluatedAt, report}
const inflight = new Map();   // projectKey → Promise<base>

function cacheKey(dir, ignore, facts) {
  return `${fingerprintOf(facts)}\n${dir}\n${[...ignore].sort().join(',')}`;
}

// No usage given: judge the default run engine only.
const DEFAULT_USAGE = () => ({ runEngine: 'claude', history: {}, settings: {} });

/** Inputs usedEngines needs that are not in the base report. Never throws. */
export function usageInputs({ projectKey, projectDir, runEngine, now = Date.now() }) {
  const since = new Date(now - HISTORY_DAYS * 86_400_000).toISOString();
  let settings = {};
  try { settings = readinessTools({ projectDir, projectKey }); } catch { settings = {}; }
  return { runEngine, history: runEngineCounts(projectKey, since), settings };
}

const signature = (r) => JSON.stringify([
  summaryOf(r),
  Object.entries(r.engines).map(([n, e]) => [n, e.level, [...(e.failing || [])].sort()]).sort(),
]);

/** Build the final report from `base`; remember it on the entry and emit `changed` when the result moved. */
function finish(projectKey, base, evaluatedAt, usage, previous) {
  const u = (usage || DEFAULT_USAGE)();
  const report = {
    ...buildReport(base, usedEngines({ engines: Object.keys(base.engines || {}), files: base.files || {}, ...u })),
    checkedAt: new Date(evaluatedAt).toISOString(),
  };
  const entry = entries.get(projectKey);
  if (entry && entry.base === base) entry.report = report;
  if (previous && signature(previous) !== signature(report)) cache.emit('changed', { projectKey });
  return report;
}

/**
 * The final agent-readiness report for a project. Concurrent evaluations for one key share the same
 * promise; a call whose fingerprint matches the cached entry reuses its base report. `force`
 * re-evaluates past a matching fingerprint (the Recheck button) and refreshes the entry.
 * `usage` returns {runEngine, history, settings} (usageInputs); it is read on every call.
 */
export async function getCachedOrEvaluate({
  dir,
  projectKey,
  ignore = [],
  usage,
  timeoutMs = INTERACTIVE_TIMEOUT_MS,
  force = false,
} = {}) {
  const previous = entries.get(projectKey)?.report ?? null;
  let pending = inflight.get(projectKey);
  if (!pending) {
    const facts = collectFacts(dir, { timeoutMs });
    const fingerprint = cacheKey(dir, ignore, facts);
    const hit = entries.get(projectKey);
    if (hit && !force && hit.fingerprint === fingerprint) {
      return finish(projectKey, hit.base, hit.evaluatedAt, usage, previous);
    }
    pending = evaluate({ dir, projectKey, ignore, timeoutMs })
      .then((base) => {
        const evaluatedAt = Date.now();
        // A partial fact collection must not pin a degraded report to a fingerprint.
        if (facts.timedOut || facts.error) entries.delete(projectKey);
        else entries.set(projectKey, { fingerprint, base, evaluatedAt, report: entries.get(projectKey)?.report ?? null });
        return { base, evaluatedAt };
      })
      .finally(() => { inflight.delete(projectKey); });
    inflight.set(projectKey, pending);
  }
  const { base, evaluatedAt } = await pending;
  return finish(projectKey, base, evaluatedAt, usage, previous);
}

/** Cache-only peek: summaryOf(the last built report) or null. No I/O. */
export function readinessSummary(projectKey) {
  const report = entries.get(projectKey)?.report;
  return report ? summaryOf(report) : null;
}
