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

// The effort worca's own auxiliary calls run at (title generation, the Models
// view Test button). Deliberately BELOW the pipeline list: the CLI accepts
// `--effort low` (claude --help, 2.1.259) and a one-line summary needs nothing
// more, so the cheapest tier is the right one. EFFORTS omits it on purpose —
// pipeline nodes are not offered `low` — which is why it lives here as its own
// constant instead of being clamped into that list (#422).
export const AUX_EFFORT = 'low';

// Claude Code resolves its OWN internal calls — session titles, the alias tiers
// a Task `model: haiku|sonnet|opus|fable` expands to, quota probes — through
// these keys. A catalog entry that routes to a custom endpoint (ANTHROPIC_BASE_URL)
// routinely sets ANTHROPIC_MODEL and nothing else, so the CLI falls back to
// first-party ids against an endpoint that does not serve them (the
// `unrecognized_model` noise in run logs). withTierModelEnv fills every one the
// entry left unset with the entry's own wire id (#422). ANTHROPIC_SMALL_FAST_MODEL
// is the pre-DEFAULT_HAIKU spelling older CLIs still read.
export const TIER_MODEL_ENV_KEYS = Object.freeze([
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
]);

/**
 * The tier keys an endpoint-routed model env should carry, synthesized from
 * the env's wire id. Pure: a non-routed env (no ANTHROPIC_BASE_URL) comes back
 * untouched, an explicit key in the env is never overwritten, and with no wire
 * id to point at (no ANTHROPIC_MODEL and no model id) nothing is added.
 * @param {Record<string,string>|undefined} env  a PREPARED model env
 * @param {string} [modelId]  the catalog id — the wire id when ANTHROPIC_MODEL is unset (#374)
 * @returns {Record<string,string>|undefined}
 */
export function withTierModelEnv(env, modelId) {
  if (!env || typeof env !== 'object' || !('ANTHROPIC_BASE_URL' in env)) return env;
  const wire = (typeof env.ANTHROPIC_MODEL === 'string' && env.ANTHROPIC_MODEL.trim())
    || (typeof modelId === 'string' ? modelId.trim() : '');
  if (!wire) return env;
  const out = { ...env };
  for (const k of TIER_MODEL_ENV_KEYS) if (!(k in out)) out[k] = wire;
  return out;
}

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
 * not survive. The user catalog rejects reserved keys at write time and plugin
 * manifests strip them at normalize time, so a drop here means a hand-edited
 * settings file — the caller owns warning about `dropped`.
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

// ── env flags + masking (shared by claude-runner.mjs, plugin-shim.mjs, ui/server.mjs)

/**
 * The ONE "is this env flag on" rule for worca's own knobs (WORCA_MOCK,
 * WORCA_SUBAGENT_HOOKS, WORCA_DEBUG_SPAWN, …): a denylist — anything but unset,
 * "", "0" and "false" (any case) is on. Several names may be given; the first
 * one that is set wins (WORCA_MOCK ?? ORCH_MOCK). Lives in this zero-import leaf
 * so every gate shares it instead of hand-copying the comparison.
 * @param {...string} names
 */
export function envFlag(...names) {
  let v;
  for (const n of names) { v = process.env[n]; if (v !== undefined) break; }
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Mask a model-env VALUE for an operator-facing display (the Models editor):
 * six bullets + the last 4 chars when longer than 8, else six bullets. The
 * `••` prefix is what ui/server.mjs#isMaskedEcho keys on to treat an echoed
 * value as "keep", so the shape is a contract — change both together. For LOG
 * lines use describeModelEnvEntry: a per-spawn log must not carry a suffix.
 */
export function maskModelEnvValue(v) {
  const s = String(v ?? '');
  return s.length > 8 ? `••••••${s.slice(-4)}` : '••••••';
}

// Keys whose value is routing configuration, not a credential, and therefore
// SAFE to print in a spawn log: which endpoint / which wire id a spawn used is
// exactly the diagnostic question, and masking them makes two gateway cards
// indistinguishable. Everything else (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY,
// ANTHROPIC_CUSTOM_HEADERS, plugin {secret} values, …) is treated as a secret.
const READABLE_MODEL_ENV_KEYS = new Set([
  'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_SMALL_FAST_MODEL',
]);
const READABLE_MODEL_ENV_KEY_RES = [/^ANTHROPIC_DEFAULT_[A-Z0-9]+_MODEL$/, /^CLAUDE_CODE_USE_[A-Z0-9]+$/];

/** Whether a model-env key's value may be printed verbatim in a log line. */
export function isReadableModelEnvKey(key) {
  return typeof key === 'string'
    && (READABLE_MODEL_ENV_KEYS.has(key) || READABLE_MODEL_ENV_KEY_RES.some((re) => re.test(key)));
}

/**
 * One `KEY=value` fragment for a log line. Readable keys print their value
 * (a URL with userinfo has the credentials stripped; an unparsable URL is
 * treated as a secret); every other key prints `<set, N chars>` — presence and
 * length prove the env reached the spawn without leaking any part of it.
 */
export function describeModelEnvEntry(key, value) {
  const s = String(value ?? '');
  const secret = `<set, ${s.length} chars>`;
  if (!isReadableModelEnvKey(key)) return `${key}=${secret}`;
  if (key === 'ANTHROPIC_BASE_URL') {
    let u;
    try { u = new URL(s); } catch { return `${key}=${secret}`; }
    if (u.username || u.password) { u.username = ''; u.password = ''; }
    return `${key}=${u.href}`;
  }
  return `${key}=${s}`;
}

/** The sorted, log-safe `KEY=value, …` rendering of a whole model env. */
export function describeModelEnv(env) {
  return Object.keys(env || {}).sort().map((k) => describeModelEnvEntry(k, env[k])).join(', ');
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

// ── model bridge: `upstream` on a catalog entry (model-bridge-design.md §6.1) ──
// Lives in this zero-import leaf for the same reason `cost` does: the user
// catalog (settings.mjs) and a plugin manifest (plugin-manifest.mjs) validate
// the same shape against one rule, and neither may import the other.
//
//   { provider: 'copilot'|'openai'|'anthropic', api: 'anthropic'|'openai-chat'|'openai-responses',
//     model: '<upstream id>', baseUrl?, apiKey?, headers?, capabilities? }
//
// A bridged entry is dispatched through worca's in-process loopback bridge
// (src/core/bridge/): resolveModelEnv synthesizes ANTHROPIC_BASE_URL /
// ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL itself, so those keys — and
// ANTHROPIC_API_KEY, which would make the CLI prefer a first-party key — may
// not also appear in the entry's own `env` map.

export const UPSTREAM_PROVIDERS = Object.freeze(['copilot', 'openai', 'anthropic']);
export const UPSTREAM_APIS = Object.freeze(['anthropic', 'openai-chat', 'openai-responses']);
/** Which wire protocols each provider can be driven through. */
export const PROVIDER_APIS = Object.freeze({
  copilot: Object.freeze(['anthropic', 'openai-chat', 'openai-responses']),
  openai: Object.freeze(['openai-chat', 'openai-responses']),
  anthropic: Object.freeze(['anthropic']),
});
/** The wire protocols the bridge TRANSLATES to — everything but the Anthropic passthrough. */
export const TRANSLATED_APIS = Object.freeze(['openai-chat', 'openai-responses']);
/** Whether `api` is translated by the bridge (no server tools, no thinking passthrough). */
export function isTranslatedApi(api) { return TRANSLATED_APIS.includes(api); }
/** Env keys the bridge owns; rejected in an `env` map beside `upstream`. */
export const BRIDGE_ROUTING_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
]);
/** Boolean capability flags an entry may pin (model-bridge-design.md §5.6). */
export const CAPABILITY_FLAGS = Object.freeze(['toolCalls', 'vision', 'reasoning']);
/** Numeric capability limits an entry may pin. */
export const CAPABILITY_LIMITS = Object.freeze(['maxPromptTokens', 'maxOutputTokens']);
/** Reasoning-effort levels an upstream may list, lowest first (capabilities.reasoningEfforts). */
export const REASONING_EFFORT_LEVELS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
/** List-valued capabilities an entry may pin. */
export const CAPABILITY_LISTS = Object.freeze(['reasoningEfforts']);
const FORBIDDEN_UPSTREAM_HEADERS = new Set(['authorization', 'host', 'content-length', 'content-type', 'transfer-encoding']);
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,80}$/;

/** Validate a `capabilities` map; returns the normalized map or undefined. Throws. */
export function assertModelCapabilities(caps) {
  if (caps === undefined || caps === null) return undefined;
  if (typeof caps !== 'object' || Array.isArray(caps)) throw new Error('upstream.capabilities must be an object');
  const out = {};
  for (const [k, v] of Object.entries(caps)) {
    if (CAPABILITY_FLAGS.includes(k)) {
      if (v === null || v === undefined) continue;
      if (typeof v !== 'boolean') throw new Error(`upstream.capabilities.${k} must be true or false`);
      out[k] = v;
    } else if (CAPABILITY_LIMITS.includes(k)) {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`upstream.capabilities.${k} must be a positive integer`);
      out[k] = n;
    } else if (CAPABILITY_LISTS.includes(k)) {
      if (v === null || v === undefined) continue;
      if (!Array.isArray(v)) throw new Error(`upstream.capabilities.${k} must be an array of effort levels`);
      for (const e of v) {
        if (!REASONING_EFFORT_LEVELS.includes(e)) throw new Error(`upstream.capabilities.${k}: unknown level ${JSON.stringify(e)} — allowed: ${REASONING_EFFORT_LEVELS.join(', ')}`);
      }
      const levels = REASONING_EFFORT_LEVELS.filter((e) => v.includes(e));
      if (levels.length) out[k] = levels;
    } else {
      throw new Error(`unknown upstream.capabilities key ${JSON.stringify(k)} — allowed: ${[...CAPABILITY_FLAGS, ...CAPABILITY_LIMITS, ...CAPABILITY_LISTS].join(', ')}`);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Whether `v` is an acceptable http(s) base URL with no query or fragment. */
export function isUpstreamBaseUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  let u;
  try { u = new URL(v.trim()); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && !u.search && !u.hash;
}

/**
 * Whether an OpenAI-compatible base URL points at this machine or a private
 * network — llama.cpp, Ollama, LM Studio, a LAN vLLM — which typically take no
 * API key. The bridge then treats the key as optional instead of refusing the
 * model as "needs API key".
 */
export function isLocalBaseUrl(v) {
  if (!isUpstreamBaseUrl(v)) return false;
  const host = new URL(v.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Validate a model `upstream` block. Returns the normalized shape or undefined
 * (for null/undefined); THROWS on malformed input with a message naming the
 * field. Secrets (`apiKey`) are literal strings or whole-value `${VAR}` refs.
 * @param {*} upstream
 * @returns {{provider:string, api:string, model:string, baseUrl?:string, apiKey?:string, headers?:Record<string,string>, capabilities?:object}|undefined}
 * @throws {Error}
 */
export function assertModelUpstream(upstream) {
  if (upstream === undefined || upstream === null) return undefined;
  if (typeof upstream !== 'object' || Array.isArray(upstream)) throw new Error('upstream must be an object');
  const provider = typeof upstream.provider === 'string' ? upstream.provider.trim() : '';
  if (!UPSTREAM_PROVIDERS.includes(provider)) {
    throw new Error(`upstream.provider must be one of ${UPSTREAM_PROVIDERS.join(' | ')}`);
  }
  const api = typeof upstream.api === 'string' ? upstream.api.trim() : '';
  if (!UPSTREAM_APIS.includes(api)) throw new Error(`upstream.api must be one of ${UPSTREAM_APIS.join(' | ')}`);
  if (!PROVIDER_APIS[provider].includes(api)) {
    throw new Error(`provider ${provider} cannot be driven through api ${api} — allowed: ${PROVIDER_APIS[provider].join(' | ')}`);
  }
  const model = typeof upstream.model === 'string' ? upstream.model.trim() : '';
  if (!model) throw new Error('upstream.model must be a non-empty string (the id the endpoint expects)');
  const out = { provider, api, model };
  if (upstream.baseUrl !== undefined && upstream.baseUrl !== null && upstream.baseUrl !== '') {
    if (provider === 'copilot') throw new Error('upstream.baseUrl cannot be set for the copilot provider (the host follows the account type)');
    if (!isUpstreamBaseUrl(upstream.baseUrl)) throw new Error('upstream.baseUrl must be an http(s) URL with no query or fragment');
    out.baseUrl = upstream.baseUrl.trim().replace(/\/+$/, '');
  }
  if (upstream.apiKey !== undefined && upstream.apiKey !== null && upstream.apiKey !== '') {
    if (provider === 'copilot') throw new Error('upstream.apiKey cannot be set for the copilot provider (sign in instead)');
    if (typeof upstream.apiKey !== 'string' || !upstream.apiKey.trim()) throw new Error('upstream.apiKey must be a non-empty string or ${VAR}');
    out.apiKey = upstream.apiKey.trim();
  }
  if (upstream.headers !== undefined && upstream.headers !== null) {
    const h = upstream.headers;
    if (typeof h !== 'object' || Array.isArray(h)) throw new Error('upstream.headers must be an object of string values');
    const headers = {};
    for (const [k, v] of Object.entries(h)) {
      if (!HEADER_NAME_RE.test(k)) throw new Error(`upstream.headers: invalid header name ${JSON.stringify(k)}`);
      if (FORBIDDEN_UPSTREAM_HEADERS.has(k.toLowerCase())) throw new Error(`upstream.headers: ${k} is set by the bridge and cannot be overridden`);
      if (typeof v !== 'string' || !v.trim()) throw new Error(`upstream.headers: value for ${JSON.stringify(k)} must be a non-empty string`);
      headers[k] = v.trim();
    }
    if (Object.keys(headers).length) out.headers = headers;
  }
  const caps = assertModelCapabilities(upstream.capabilities);
  if (caps) out.capabilities = caps;
  return out;
}

/** The first env key an `upstream` entry may not also carry, or null. */
export function upstreamEnvConflict(env) {
  for (const k of Object.keys(env || {})) if (BRIDGE_ROUTING_KEYS.includes(k)) return k;
  return null;
}

/** The CLI's web tools a translated (openai-chat / openai-responses) upstream withholds (§5.3). */
export function bridgeExcludedTools(upstream) {
  return upstream && isTranslatedApi(upstream.api) ? ['WebSearch', 'WebFetch'] : [];
}

// ── providers: account-level state shared by bridged entries (§6.2) ─────────
export const COPILOT_ACCOUNT_TYPES = Object.freeze(['individual', 'business', 'enterprise']);
export const DEFAULT_PROVIDER_CONCURRENCY = Object.freeze({ copilot: 4, openai: 8, anthropic: 8 });
export const MAX_PROVIDER_CONCURRENCY = 64;
/** Bump when the Copilot terms notice wording changes materially — a stored
 *  acknowledgement of an older version is shown again (§8.2). */
export const COPILOT_TERMS_VERSION = 1;
