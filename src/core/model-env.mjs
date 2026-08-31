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
// including all other ANTHROPIC_* / CLAUDE_* — is allowed: routing them is the
// point. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is the CLI-2.1.220 permission-mode
// landmine documented at claude-runner.mjs#buildSpawnEnv.
// CLAUDE_CODE_SUBAGENT_MODEL is reserved too: the per-node `subagentModel`
// prompt policy is the only sanctioned wire for a child's model, and a catalog
// entry silently flooring every fan-out child would contradict the per-node
// control the UI shows.
export const RESERVED_MODEL_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'TERM',
  'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS',
  'CLAUDECODE', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'CLAUDE_CODE_SUBAGENT_MODEL',
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
 * `sourceEnv` (an unset or empty var drops the key). Values are trimmed and a
 * value that is empty after trimming drops the key — an ANTHROPIC_MODEL wire id
 * (#374) reaches `--model` verbatim, so a stray-whitespace or empty value must
 * not survive. Write-time validation already rejects reserved keys, so a drop
 * here means a hand-edited settings file — the caller owns warning about
 * `dropped`.
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
      const t = typeof resolved === 'string' ? resolved.trim() : '';
      if (!t) { dropped.push(k); continue; }
      env[k] = t;
    } else {
      const t = v.trim();
      if (!t) { dropped.push(k); continue; }
      env[k] = t;
    }
  }
  return { env, dropped };
}

// ── per-model cost override (opt-in pricing, config.mjs resolveModelCost) ─────
// Lives HERE for the same reason the env policy does: BOTH catalog layers must
// validate it against one rule. settings.mjs owns the user's global catalog and
// plugin-manifest.mjs owns a plugin's models — neither may import the other, and
// this leaf imports nothing. A plugin that ships a model routed at its own
// endpoint is exactly the case that needs a price pinned, so its manifest
// carries `cost` with the same shape and the same validation as a global entry.

/** Allowed per-million-token rate keys for a model's `cost.perMtok` table. */
export const COST_RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'];

/**
 * Validate a model `cost` override. Returns the normalized shape or undefined;
 * THROWS on malformed input (callers that must not throw catch and drop).
 *   { free: true }                               → recorded spend is always $0
 *   { perMtok: { input, output, cacheRead, … } } → USD per million tokens, >= 0
 * `{ free: false }` / `{}` mean "no override" → undefined.
 * @param {*} cost
 * @returns {{free:true}|{perMtok:Record<string,number>}|undefined}
 * @throws {Error}
 */
export function assertModelCost(cost) {
  if (cost === undefined || cost === null) return undefined;
  if (typeof cost !== 'object' || Array.isArray(cost)) throw new Error('cost must be an object');
  if (cost.free !== undefined && typeof cost.free !== 'boolean') throw new Error('cost.free must be a boolean');
  if (cost.free === true) return { free: true };
  if (cost.perMtok !== undefined) {
    const p = cost.perMtok;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new Error('cost.perMtok must be an object of USD-per-million-token rates');
    }
    const rates = {};
    for (const [k, v] of Object.entries(p)) {
      if (!COST_RATE_KEYS.includes(k)) {
        throw new Error(`unknown cost.perMtok rate ${JSON.stringify(k)} — allowed: ${COST_RATE_KEYS.join(', ')}`);
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`cost.perMtok.${k} must be a finite number >= 0`);
      rates[k] = n;
    }
    if (!Object.keys(rates).length) throw new Error('cost.perMtok must define at least one rate');
    return { perMtok: rates };
  }
  return undefined; // { free: false } or {} — no override
}

// ── sub-agent model policy (per-node `subagentModel`) ─────────────────────────
// What a fan-out node's Task/Agent children run on. ONE wire — a prompt block
// (phases.mjs#subagentModelDirective) that tells the agent to pass `model` on
// every Task call — because the CLI resolves a child's model as Task-call
// `model` > the agent definition's own `model:` frontmatter > env default >
// parent: only the explicit Task-level value reliably binds every child. (The
// earlier CLAUDE_CODE_SUBAGENT_MODEL env floor was removed for exactly that
// reason — it bound only agents with no model key — and the key is reserved
// above so a catalog entry cannot resurrect it.)
//
// The vocabulary is deliberately NOT the worca catalog: the CLI's Task tool
// accepts an ALIAS enum, so a catalog id (or an ANTHROPIC_MODEL wire id) would
// be rejected at spawn time. Haiku is excluded by product decision.
export const SUBAGENT_MODELS = ['sonnet', 'opus', 'fable'];

/** "the agent picks per Task call" — a choice rubric in the prompt. */
export const SUBAGENT_AUTO = 'auto';

/** "children ride the CLI's own resolution" (an agent definition's frontmatter,
 *  else the parent's model) — the pre-feature prompt. Stored explicitly,
 *  because the DEFAULT for an unset node is `auto`, not this. */
export const SUBAGENT_INHERIT = 'inherit';

/** Every storable `subagentModel`. '' / absent are NOT storable — they mean
 *  "unset", which the runtime resolves to SUBAGENT_DEFAULT. */
export const SUBAGENT_MODEL_VALUES = [...SUBAGENT_MODELS, SUBAGENT_AUTO, SUBAGENT_INHERIT];

/** What an unset node resolves to at run time: agents choose BY DEFAULT. */
export const SUBAGENT_DEFAULT = SUBAGENT_AUTO;

/** Whether `v` is a storable subagentModel. */
export function isSubagentModelValue(v) {
  return typeof v === 'string' && SUBAGENT_MODEL_VALUES.includes(v);
}

/** The policy a raw stored value puts in force: a legal value is itself; '' /
 *  absent / anything that escaped validation is the auto default. */
export function effectiveSubagentModel(v) {
  return isSubagentModelValue(v) ? v : SUBAGENT_DEFAULT;
}

/** The one validation message every writer shares, '' when `v` is acceptable
 *  ('' and null/undefined mean clear/absent and are always fine). */
export function subagentModelIssue(v) {
  if (v == null || v === '' || isSubagentModelValue(v)) return '';
  return `unknown sub-agent model ${JSON.stringify(String(v))}`;
}
