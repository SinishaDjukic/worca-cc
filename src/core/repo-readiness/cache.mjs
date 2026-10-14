// src/core/repo-readiness/cache.mjs
// In-memory readiness cache: one entry per projectKey, re-evaluated only when the project
// fingerprint (HEAD + instruction-file porcelain) or the ignore list changes.
import { EventEmitter } from 'node:events';
import { collectFacts, fingerprintOf } from './facts.mjs';
import { evaluateReadiness } from './evaluate.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';

/** Emits `changed` ({projectKey}) when a re-evaluation moves any engine's level or failing set. */
export const cache = new EventEmitter();

const entries = new Map();    // projectKey → {dir, report, fingerprint, primaryEngine}
const inflight = new Map();   // projectKey → Promise<report>

function cacheKey(dir, ignore, facts) {
  return `${fingerprintOf(facts)}\n${dir}\n${[...ignore].sort().join(',')}`;
}

function enginesSignature(report) {
  return JSON.stringify(
    Object.entries(report?.engines || {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, e]) => [name, e.level, [...(e.failing || [])].sort()]),
  );
}

/**
 * Cached agent-readiness report for a project. Concurrent calls for one key share the same
 * promise; a call whose fingerprint matches the cached entry resolves to the cached report object.
 * `force` re-evaluates past a matching fingerprint (the Recheck button) and refreshes the entry.
 */
export function getCachedOrEvaluate({
  dir,
  projectKey,
  ignore = [],
  primaryEngine = 'claude',
  timeoutMs = INTERACTIVE_TIMEOUT_MS,
  force = false,
} = {}) {
  const pending = inflight.get(projectKey);
  if (pending) return pending;

  const facts = collectFacts(dir, { timeoutMs });
  const fingerprint = cacheKey(dir, ignore, facts);
  const hit = entries.get(projectKey);
  if (hit && !force && hit.fingerprint === fingerprint) {
    hit.primaryEngine = primaryEngine;
    return Promise.resolve(hit.report);
  }

  const promise = evaluateReadiness({ dir, projectKey, ignore, primaryEngine, timeoutMs })
    .then((report) => {
      // A partial fact collection must not pin a degraded report to a fingerprint.
      if (facts.timedOut || facts.error) {
        entries.delete(projectKey);
        return report;
      }
      const previous = entries.get(projectKey);
      entries.set(projectKey, { dir, report, fingerprint, primaryEngine });
      if (previous && enginesSignature(previous.report) !== enginesSignature(report)) {
        cache.emit('changed', { projectKey });
      }
      return report;
    })
    .finally(() => { inflight.delete(projectKey); });
  inflight.set(projectKey, promise);
  return promise;
}

/** Cache-only peek: `{level, primaryEngine, failingCount}` or null. No I/O. */
export function readinessSummary(projectKey) {
  const entry = entries.get(projectKey);
  if (!entry) return null;
  const engine = entry.report?.engines?.[entry.primaryEngine];
  return {
    level: engine?.level ?? 'unknown',
    primaryEngine: entry.primaryEngine,
    failingCount: engine?.failing?.length ?? 0,
  };
}
