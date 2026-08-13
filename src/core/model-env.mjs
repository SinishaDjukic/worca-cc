// src/core/model-env.mjs
// Shared, dependency-free definitions for configurable models
// (configurable-models-design.md §4.1/§4.4): the effort vocabulary, the
// reserved-key policy for per-model routing env, whole-value ${VAR}
// indirection, and the defensive spawn-time filter.
//
// This module imports NOTHING. settings.mjs — whose import contract forbids
// core-graph modules (it would cycle via projects.mjs) — validates catalog
// writes against this policy, and claude-runner.mjs applies the same policy
// defensively at spawn time. Keeping the single source of truth in a
// zero-import leaf lets both sides share it without bending either module's
// import contract; that is why the constant does NOT live next to
// SPAWN_ENV_BASE in claude-runner.mjs.

/** Reasoning-effort vocabulary. Canonical home is HERE (not config.mjs, which
 *  re-exports it) so settings.mjs can validate a catalog entry's `efforts`
 *  without importing the core graph. */
export const EFFORTS = ['medium', 'high', 'xhigh', 'max'];

// Env keys a model entry may NOT set (§4.4): process fundamentals and worca's
// own runtime knobs, any of which injection could otherwise subvert (mock
// mode, the claude binary path, the effort flag name). Everything else —
// including all ANTHROPIC_* / CLAUDE_* — is allowed: routing them is the
// point. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is the CLI-2.1.220 permission-mode
// landmine documented at claude-runner.mjs#buildSpawnEnv.
export const RESERVED_MODEL_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS',
  'CLAUDECODE', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
];
export const RESERVED_MODEL_ENV_PREFIXES = ['WORCA_'];

/** Whether a model-env key is reserved (exact match or reserved prefix). */
export function isReservedModelEnvKey(key) {
  return RESERVED_MODEL_ENV_KEYS.includes(key)
    || RESERVED_MODEL_ENV_PREFIXES.some((p) => typeof key === 'string' && key.startsWith(p));
}

// Whole-value indirection only (§4.1): `${VARNAME}` and nothing else. Embedded
// refs ("prefix-${X}") are deliberately literals — no templating language.
const ENV_REF_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** The var name a whole-value `${VARNAME}` env value points at, or null for a literal. */
export function modelEnvRef(value) {
  const m = typeof value === 'string' ? value.match(ENV_REF_RE) : null;
  return m ? m[1] : null;
}

/**
 * Defensive spawn-time pass over a model entry's env (§4.4): drops reserved
 * keys and non-string values, and expands whole-value ${VAR} refs from
 * `sourceEnv` (an unset or empty var drops the key). Write-time validation
 * already rejects reserved keys, so a drop here means a hand-edited settings
 * file — the caller owns warning about `dropped`.
 * @param {Record<string,*>|undefined} modelEnv
 * @param {Record<string,string|undefined>} [sourceEnv]
 * @returns {{env: Record<string,string>, dropped: string[]}}
 */
export function prepareModelEnv(modelEnv, sourceEnv = process.env) {
  const env = {};
  const dropped = [];
  for (const [k, v] of Object.entries(modelEnv || {})) {
    if (isReservedModelEnvKey(k) || typeof v !== 'string') { dropped.push(k); continue; }
    const ref = modelEnvRef(v);
    if (ref !== null) {
      const resolved = sourceEnv ? sourceEnv[ref] : undefined;
      if (resolved === undefined || resolved === '') { dropped.push(k); continue; }
      env[k] = resolved;
    } else {
      env[k] = v;
    }
  }
  return { env, dropped };
}
