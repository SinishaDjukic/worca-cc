// src/core/repo-readiness/evaluate.mjs
// Main entrypoint of the agent-readiness evaluation: collect facts, run every engine's
// checks, and package one report. Never throws — failures land in the report.
import { collectFacts } from './facts.mjs';
import { evaluateEngines, DECLARED_ENGINES } from './engines.mjs';
import { CATALOG_VERSION } from './checks.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';

/** The feature is on unless WORCA_READINESS is `0` / `false`. */
export function readinessEnabled(env = process.env) {
  const v = env.WORCA_READINESS;
  return !(v === '0' || String(v ?? '').toLowerCase() === 'false');
}

function logError(projectKey, id, err) {
  console.error(`[worca-ui] readiness ${id}: ${projectKey ? `${projectKey}: ` : ''}${err?.message || err}`);
}

/** Report used when evaluation itself fails: every declared engine is `unknown`. */
function unknownReport() {
  const engines = {};
  for (const name of DECLARED_ENGINES) engines[name] = { level: 'unknown', failing: [] };
  return { catalogVersion: CATALOG_VERSION, engines, checks: [] };
}

/**
 * Evaluate agent readiness of `dir`. `primaryEngine` is accepted for the snapshot layer
 * and unused here. Always resolves with `{catalogVersion, engines, checks}`.
 */
export async function evaluateReadiness({
  dir,
  projectKey,
  ignore = [],
  primaryEngine = 'claude',
  timeoutMs = INTERACTIVE_TIMEOUT_MS,
} = {}) {
  try {
    const facts = collectFacts(dir, { timeoutMs });
    if (facts.error) logError(projectKey, 'facts', facts.error);
    const { engines, checks } = evaluateEngines(facts, { ignore });
    return { catalogVersion: CATALOG_VERSION, engines, checks };
  } catch (e) {
    logError(projectKey, 'evaluate', e);
    return unknownReport();
  }
}
