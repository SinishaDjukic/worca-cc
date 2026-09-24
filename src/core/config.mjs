// src/core/config.mjs
// Per-project model + effort selection for each AGENT step of the pipeline.
//
// node:sqlite migration: now persisted in the `project_config`/`config_workflow_*`
// tables; path helpers vestigial.
//
// Agent steps are keyed by their orchestrator role name:
//   planner | refiner | implementer | reviewer
// (preflight and done are not agents, so they carry no model/effort.)
//
// Reads never throw (missing/corrupt => safe defaults); writes validate then
// persist inside a single db.mjs tx(). All per-project config is keyed by
// projectKey(projectDir) (store.mjs), so every worktree of a repo maps to one row.

import { getDb, prepare, tx } from './db.mjs';
import { projectKey } from './store.mjs';
import { AUTO_WORKFLOW_ID } from './graph/builtin-workflows.mjs';
import { loadAgentRegistry, registryToSteps } from './agent-registry.mjs';
import { EFFORTS, prepareModelEnv, withTierModelEnv, withProviderModesOff, PROVIDER_MODE_ENV_KEYS, isSubagentModelValue, subagentModelIssue, BRIDGE_ROUTING_KEYS, bridgeExcludedTools, isTranslatedApi } from './model-env.mjs';
import { findBridgedEntry, providerReadiness } from './bridge/registry.mjs';
import { bridgeBaseUrl, bridgeSecret } from './bridge/server.mjs';
import { listGlobalModels, addGlobalModel, removeGlobalModel, hideBuiltinModels, readSettings, memoryDefragModel, setMemoryDefragModel } from './settings.mjs';
/** Whether the developer stored the hide-built-ins flag (a team default applies only when not). */
const readSettingsHideStored = () => { const s = readSettings(); return typeof s.hideBuiltinModels === 'boolean' || s.hideBuiltinModelsChosen === true; };
import { listPluginModels, allPluginModels, flattenPluginModelEnv } from './plugin-models.mjs';
// Team policy defaults (team-policy design §6, §8): read from the discovery CACHE only (a leaf module).
import { policyCatalogModels, teamDefault } from './policy/cache.mjs';

/**
 * Recompute the agent step list FRESH from the layered registry (repo agents/ +
 * ~/.worca-cc/agents). Use this instead of AGENT_STEPS anywhere a user-added agent
 * must appear without a process restart (the registry re-scans per call).
 * @returns {Array<{key:string,label:string,fanOut:boolean}>}
 */
export function agentSteps() {
  return registryToSteps(loadAgentRegistry());
}

/**
 * Boot-time snapshot of agentSteps(), kept for import-compat (UI boot payloads,
 * tests). PREFER agentSteps(): this constant goes stale when a user agent is
 * added/removed at runtime.
 */
export const AGENT_STEPS = agentSteps();

/** Live key set (recomputed per call so runtime-added user agents validate). */
const stepKeys = () => new Set(agentSteps().map((s) => s.key));

/** All effort levels the UI can offer (ordering is not a ranking). Canonical
 *  home is model-env.mjs (so settings.mjs can validate catalog entries without
 *  importing the core graph); re-exported here for import-compat. */
export { EFFORTS };

/**
 * Built-in models. `efforts` is the subset of EFFORTS each model supports.
 * `xhigh` is listed only on models that support it; medium/high/max are broad.
 *
 * IMPORTANT: these ids are the aliases the installed `claude` CLI is expected to
 * accept. Verify them against your CLI (see "How success is verified"). The
 * canonical dated id for Haiku 4.5 is `claude-haiku-4-5-20251001`; the bare
 * alias `claude-haiku-4-5` is used here and must be confirmed to resolve. Any id
 * that does not resolve can be replaced here or added as a custom model.
 *
 * The `[1m]` suffix selects the 1M-token long-context variant. Opus 4.6–4.8 and
 * Sonnet 4.6 1M ids were verified to resolve via `claude --model`; Haiku 4.5 1M
 * is intentionally omitted — the CLI rejects it ("long context beta is not yet
 * available for this subscription"). Fable 5.1 needs no `[1m]` suffix: its context
 * window is 1M by default (verified to resolve via `claude --model`, CLI 2.1.257).
 * It replaced Fable 5 (`claude-fable-5`) on 2026-09-01; db.mjs V26 moves every
 * stored pin on the retired id to the successor, so nothing keeps it here. Opus 5.5
 * (`claude-opus-5-5`) and Sonnet 5 (`claude-sonnet-5`) are likewise 1M-only and
 * carry no `[1m]` twin. Opus 5.5 replaced Opus 5 (`claude-opus-5`) on 2026-09-22
 * (verified to resolve via `claude --model`, CLI 2.1.280); db.mjs V35 moved the
 * stored pins the same way. Opus 5 came back beside it on 2026-09-23 so both can
 * be picked; V35 is shipped and stays, so pins it already moved stay on Opus 5.5.
 */
export const PREDEFINED_MODELS = [
  { id: 'claude-opus-5-5',        label: 'Opus 5.5',        efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5',          label: 'Opus 5',          efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5-1',       label: 'Fable 5.1 (1M)',  efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-8',        label: 'Opus 4.8',        efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-8[1m]',    label: 'Opus 4.8 (1M)',   efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-7',        label: 'Opus 4.7',        efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-7[1m]',    label: 'Opus 4.7 (1M)',   efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-4-6',        label: 'Opus 4.6',        efforts: ['medium', 'high', 'max'] },
  { id: 'claude-opus-4-6[1m]',    label: 'Opus 4.6 (1M)',   efforts: ['medium', 'high', 'max'] },
  { id: 'claude-sonnet-5',        label: 'Sonnet 5',        efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-4-6',      label: 'Sonnet 4.6',      efforts: ['medium', 'high', 'max'] },
  { id: 'claude-sonnet-4-6[1m]',  label: 'Sonnet 4.6 (1M)', efforts: ['medium', 'high', 'max'] },
  { id: 'claude-haiku-4-5',       label: 'Haiku 4.5',       efforts: ['medium', 'high'] },
];

/** @deprecated config moved to the DB (project_config). Kept for import-compat only. */
export function configDir(projectDir) { return String(projectDir ?? ''); }
/** @deprecated config moved to the DB (project_config). Kept for import-compat only. */
export function configFile(projectDir) { return String(projectDir ?? ''); }

function defaultConfig() {
  return { steps: {}, customModels: [] };
}

/** Keep only known step keys whose entry survives cleanNodeSel — ONE coercion
 *  rule for both scopes (a per-step entry IS a node selection; a second
 *  line-for-line copy here is how the two silently diverge). An unknown
 *  subagentModel is dropped, never stored. */
function sanitizeSteps(steps) {
  const out = {};
  const keys = stepKeys();
  for (const [k, v] of Object.entries(steps || {})) {
    if (!keys.has(k) || !v || typeof v !== 'object') continue;
    const sel = cleanNodeSel(v);   // hoisted declaration (defined below)
    if (sel) out[k] = sel;
  }
  return out;
}

/** Keep well-formed, de-duplicated custom models that don't shadow a predefined id. */
function sanitizeCustom(list) {
  const seen = new Set(PREDEFINED_MODELS.map((m) => m.id.toLowerCase()));
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue;
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    out.push({ id, label: (typeof e.label === 'string' && e.label.trim()) || id });
  }
  return out;
}

/** Fail-safe JSON parse: returns `fallback` on any error / non-matching shape. */
function parseJson(text, fallback) {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read the project_config row for a projectKey, or null when absent. Synchronous.
 * @param {string} key
 * @returns {{steps:string,custom_models:string,active_workflow_id:(string|null),extra:string}|null}
 */
export function readConfigRow(key) {
  getDb();
  return prepare(
    'SELECT steps, custom_models, active_workflow_id, extra, human_in_loop FROM project_config WHERE project_key = ?'
  ).get(key) || null;
}

/**
 * Read + sanitize the legacy {steps, customModels} view from the project_config
 * row. Missing/corrupt => { steps:{}, customModels:[] }. Never throws.
 * @param {string} projectDir
 * @returns {{steps:object, customModels:Array}}
 */
function readRaw(projectDir) {
  const row = readConfigRow(projectKey(projectDir));
  if (!row) return defaultConfig();
  return {
    steps: sanitizeSteps(parseJson(row.steps, {})),
    customModels: sanitizeCustom(parseJson(row.custom_models, [])),
  };
}

/** Public read of the sanitized legacy {steps, customModels} view. Never throws. */
export async function readConfig(projectDir) {
  return readRaw(projectDir);
}

/**
 * Compose the EFFECTIVE catalog (configurable-models-design.md §4.2, §9.2):
 * predefined ⊕ plugin models ⊕ global settings entries ⊕ legacy per-project
 * custom models. Precedence on an id collision: global (user) beats plugin
 * beats predefined; legacy ranks lowest and is dropped. A shadowing entry
 * keeps the shadowed id's casing so existing step/node refs stay stable.
 * `custom` is false | 'global' | 'plugin' | 'project' (strings truthy, so
 * existing `m.custom` checks keep working); plugin entries also carry
 * `plugin: '<name>'`; `hasEnv` advertises routing env WITHOUT the values
 * (this shape feeds UI dropdowns). `routed` advertises an ANTHROPIC_BASE_URL
 * override the same way (key presence, values never leaked) — computed from the
 * env objects already in scope here, NEVER by calling modelHasBaseUrlRouting per
 * entry (that re-reads settings + the plugins lock from disk on every row).
 */
function composeCatalog(projectCustom = [], { projectDir = null } = {}) {
  const globals = listGlobalModels();
  const globalByIdLc = new Map(globals.map((m) => [m.id.toLowerCase(), m]));
  const plugins = listPluginModels();
  const pluginByIdLc = new Map(plugins.map((m) => [m.id.toLowerCase(), m]));
  const flagged = costUnreliableModelIds();
  const out = [];
  const seen = new Set();
  const unreliable = (lc) => (flagged.has(lc) ? { costUnreliable: true } : {});
  const routedOf = (env) => !!(env && 'ANTHROPIC_BASE_URL' in env);
  // "Hide built-in models" (#422): a cosmetic flag on the UNSHADOWED built-ins,
  // read by every picker. The entry stays in the catalog — hiding an id must
  // never stop it resolving, or a stored run / plugin reference that names it
  // would break — so pickers skip `hidden`, validators ignore it.
  // A team-policy default applies only while the developer has not stored the flag themselves.
  const teamHide = projectDir ? teamDefault(projectDir, 'models.hideBuiltins') : undefined;
  const hideStored = readSettingsHideStored();
  const hidden = (hideStored ? hideBuiltinModels() : (teamHide === true || hideBuiltinModels())) ? { hidden: true } : {};
  // Bridged entries (model-bridge-design.md §8.5): `bridged` names the provider
  // (false otherwise), `upstreamApi` the wire protocol, `needsSignIn` whether
  // the provider is usable right now (pickers skip such entries unless they are
  // the current selection), `capabilities` what the editor pinned. `routed` is
  // true too: the CLI IS pointed at a custom endpoint (worca's own bridge).
  // provider + the entry's own key/base URL -> readiness (both can decide it)
  const readiness = new Map();
  const bridgeShape = (m) => {
    if (!m.upstream) return {};
    const p = m.upstream.provider;
    const key = `${p}\n${m.upstream.apiKey || ''}\n${m.upstream.baseUrl || ''}`;
    if (!readiness.has(key)) readiness.set(key, providerReadiness(m.upstream));
    const r = readiness.get(key);
    return {
      bridged: p, upstreamApi: m.upstream.api, upstreamModel: m.upstream.model,
      needsSignIn: !r.ok, ...(r.ok ? {} : { signInReason: r.reason }),
      ...(m.upstream.capabilities ? { capabilities: { ...m.upstream.capabilities } } : {}),
    };
  };
  const routedOrBridged = (m) => routedOf(m.env) || !!m.upstream;
  const pluginShape = (id, m, lc) => ({
    id, label: m.label, efforts: [...m.efforts], custom: 'plugin', plugin: m.plugin,
    hasEnv: !!m.env, routed: routedOrBridged(m), ...unreliable(lc), ...bridgeShape(m),
  });
  for (const m of PREDEFINED_MODELS) {
    const lc = m.id.toLowerCase();
    const shadow = globalByIdLc.get(lc);
    const pshadow = pluginByIdLc.get(lc);
    out.push(shadow
      ? { id: m.id, label: shadow.label, efforts: [...shadow.efforts], custom: 'global', hasEnv: !!shadow.env, routed: routedOrBridged(shadow), ...unreliable(lc), ...bridgeShape(shadow) }
      : pshadow
        ? pluginShape(m.id, pshadow, lc)
        : { ...m, custom: false, hasEnv: false, routed: false, ...hidden });
    seen.add(lc);
  }
  for (const m of globals) {
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) continue; // predefined shadow, already emitted
    seen.add(lc);
    out.push({ id: m.id, label: m.label, efforts: [...m.efforts], custom: 'global', hasEnv: !!m.env, routed: routedOrBridged(m), ...unreliable(lc), ...bridgeShape(m) });
  }
  for (const m of plugins) {
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) continue; // predefined/global shadow wins
    seen.add(lc);
    out.push(pluginShape(m.id, m, lc));
  }
  // Team-policy catalog entries (team-policy design §8): after global and plugin, before the
  // legacy per-project ones. Read-only rows with a policy badge; `home` names the policy.
  for (const m of policyCatalogModels()) {
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push({ id: m.id, label: m.label, efforts: [...m.efforts], custom: 'policy', policy: m.home,
      hasEnv: !!m.env, routed: routedOrBridged(m), ...unreliable(lc), ...bridgeShape(m) });
  }
  for (const m of projectCustom) {
    if (seen.has(m.id.toLowerCase())) continue; // predefined/global/plugin wins
    seen.add(m.id.toLowerCase());
    out.push({ id: m.id, label: m.label, efforts: [...EFFORTS], custom: 'project', hasEnv: false, routed: false });
  }
  return out;
}

// ── cost-reliability observations (design §4.6) ───────────────────────────────
// DERIVED state in the central DB (model_cost_flags): an env-routed endpoint
// that reports no cost while consuming tokens gets flagged; a later positive-
// cost run of the same model auto-clears it. Never assumed from config alone —
// a proxy that reports real costs is never badged.

/** Whether the model's env-carrying entry (user GLOBAL first, else the winning
 *  PLUGIN entry — design §9.3) declares an ANTHROPIC_BASE_URL override
 *  (directly, as a ${VAR} ref, or as a {secret} placeholder — key presence is
 *  the signal). Only such models are ever observed; the direct Anthropic path
 *  is never flagged. */
export function modelHasBaseUrlRouting(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return false;
  const lc = id.toLowerCase();
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === lc);
  if (entry) return !!entry.upstream || !!(entry.env && 'ANTHROPIC_BASE_URL' in entry.env);
  const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
  if (pm) return !!pm.upstream || !!(pm.env && 'ANTHROPIC_BASE_URL' in pm.env);
  return !!findBridgedEntry(id);   // a team-policy entry with an upstream
}

/**
 * The bridge facts for a model id (model-bridge-design.md §4.2/§8.5), or null
 * when it is not a bridged entry: `{id, provider, api, upstreamModel,
 * excludeTools, ready, reason?, message?}`. `excludeTools` are the CLI built-ins
 * the runner must withhold (web tools have no chat/completions or Responses API equivalent);
 * `ready` is the provider's sign-in state — a spawn fails fast on it instead
 * of with an opaque 401 mid-run. Synchronous; never throws.
 */
export function bridgedModelInfo(modelId) {
  const e = findBridgedEntry(modelId);
  if (!e) return null;
  const r = providerReadiness(e.upstream);
  return {
    id: e.id, provider: e.upstream.provider, api: e.upstream.api, upstreamModel: e.upstream.model,
    excludeTools: bridgeExcludedTools(e.upstream),
    ready: r.ok, ...(r.ok ? {} : { reason: r.reason, message: r.message }),
  };
}

/** Lowercased ids currently flagged cost-unreliable. Never throws ({} on any
 *  DB trouble) — reads feed catalog composition, which must never fail. */
export function costUnreliableModelIds() {
  try {
    getDb();
    return new Set(prepare('SELECT model_id FROM model_cost_flags').all()
      .map((r) => String(r.model_id).toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Evaluate one terminal result event for cost reliability (design §4.6).
 * Applies ONLY to models with base-URL routing; the caller must already have
 * excluded mock runs. `usage` is the raw result event's usage object.
 * @param {string} modelId
 * @param {number|null} costUsd  the reported cost (null when absent)
 * @param {object} [usage]
 * @param {object|null} [costCfg]  this model's already-looked-up cost override
 *   (modelCostConfig). Pass it when the caller has one in hand — every lookup is
 *   a fresh settings.json read (settings.mjs is deliberately uncached), and the
 *   result path needs the same answer for resolveModelCost. `undefined` = look
 *   it up here; `null` = "checked, there is none".
 * @returns {'flagged'|'cleared'|null} what changed — 'flagged' asks the caller
 *   to surface its one-per-run warning; null = no observation recorded
 */
export function observeModelCost(modelId, costUsd, usage, costCfg = undefined) {
  if (!modelHasBaseUrlRouting(modelId)) return null;
  // An explicit per-model cost override GOVERNS this model's spend (resolveModelCost
  // below) — the CLI's own figure is never trusted for it, so the "unreliable"
  // badge is meaningless. Never flag it, and lift any flag left from before the
  // override existed. Derived state: a DB hiccup here must never fail the run.
  if (costCfg !== undefined ? costCfg : modelCostConfig(modelId)) {
    try { prepare('DELETE FROM model_cost_flags WHERE model_id = ?').run(String(modelId).trim()); } catch { /* derived */ }
    return null;
  }
  const u = usage && typeof usage === 'object' ? usage : {};
  const tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((n, k) => n + (Number(u[k]) || 0), 0);
  const id = String(modelId).trim();
  getDb();
  if (Number.isFinite(costUsd) && costUsd > 0) {
    // Positive cost = the endpoint reports real spend — auto-clear.
    const cleared = prepare('DELETE FROM model_cost_flags WHERE model_id = ?').run(id).changes > 0;
    return cleared ? 'cleared' : null;
  }
  if (tokens > 0) {
    // Tokens consumed, cost absent/zero — the USD budget cannot see this spend.
    prepare(`
      INSERT INTO model_cost_flags (model_id, flagged_at) VALUES (?, ?)
      ON CONFLICT(model_id) DO NOTHING
    `).run(id, new Date().toISOString());
    return 'flagged';
  }
  return null; // no cost AND no tokens (e.g. an errored run) — no signal either way
}

// ── per-model cost override (opt-in) ──────────────────────────────────────────
// The Claude CLI computes total_cost_usd from its OWN per-model price table keyed
// on the model NAME — so an on-prem/proxied endpoint (even one that returns no
// cost) still gets a fabricated dollar figure, which observeModelCost cannot
// distinguish from a real one once it is positive. A user who KNOWS a model's
// real price (or that it is free) can pin it in the GLOBAL catalog; that override
// then wins over whatever the CLI reports. Inspired by worca 0.x's cost_alias /
// worca.pricing.models mechanism. Opt-in: with no override the CLI value stands.
//
// It governs EVERY surface that books spend, because they share one windowed
// budget (cost-budget.mjs combinedWindowedSpendUsd): the orchestrator's result
// intake and sub-agent telemetry (orchestrator.mjs), an Ask Worca turn (the
// `resolveCost` hook ask/turn.mjs injects into the reducer), and the overview
// agent's telemetry row. Re-pricing only some of them would leave the phantom
// spend this exists to remove still inflating the budget from the others.

/** The explicit cost override governing a model, or null. Shape: {free:true} |
 *  {perMtok:{input?,output?,cacheRead?,cacheWrite?,cacheWrite1h?}} (USD per
 *  million tokens). Resolved with the SAME precedence as the rest of a model's
 *  configuration (§9.3, mirroring modelHasBaseUrlRouting): the user's GLOBAL
 *  entry wins outright, else the winning PLUGIN entry's manifest price — a
 *  plugin shipping a model on its own endpoint is exactly the case that needs
 *  one. Note a global entry shadows the plugin's price even when it pins none:
 *  taking over a model id means owning its pricing too, so the two layers can
 *  never half-merge. Built-ins carry none. Never throws. */
export function modelCostConfig(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return null;
  const lc = id.toLowerCase();
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === lc);
  if (entry) return entry.cost ?? null;
  const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
  return pm?.cost ?? null;
}

/** The four token classes read off a usage object, accepting BOTH spellings in
 *  play here: the RAW Claude result usage (`input_tokens`, …) that the pipeline
 *  path carries, and Ask Worca's normalized persisted shape (`input`, `output`,
 *  `cacheRead`, `cacheCreation` — ask/events.mjs normalizeUsage). Same tokens,
 *  two names; a missing field counts as 0. Only the raw shape ever carries the
 *  ephemeral cache-creation breakdown. */
function usageTokens(u) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pick = (snake, camel) => (u[snake] != null ? num(u[snake]) : num(u[camel]));
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
  return {
    input: pick('input_tokens', 'input'),
    output: pick('output_tokens', 'output'),
    cacheRead: pick('cache_read_input_tokens', 'cacheRead'),
    cacheWrite: pick('cache_creation_input_tokens', 'cacheCreation'),
    eph1h: cc ? num(cc.ephemeral_1h_input_tokens) : 0,
    eph5m: cc ? num(cc.ephemeral_5m_input_tokens) : 0,
  };
}

/** True when `usage` is an object that actually reports token counts — i.e. it
 *  can be priced. A result event that carried NO usage at all is unpriceable and
 *  must not be silently booked at $0 (resolveModelCost returns NaN for it); an
 *  object whose counts are genuinely all zero IS priceable, at $0. */
export function isPriceableUsage(usage) {
  if (!usage || typeof usage !== 'object') return false;
  return ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
    'cache_creation', 'input', 'output', 'cacheRead', 'cacheCreation'].some((k) => usage[k] != null);
}

/** Estimate USD from a `usage` object (either spelling, see usageTokens) and a
 *  per-million-token rate table (mirrors worca 0.x estimate_cost). Absent rates/
 *  fields count as 0. When the CLI breaks cache-creation into ephemeral 1h/5m
 *  buckets they are priced separately (1h falls back to the cacheWrite rate);
 *  otherwise the flat cache_creation_input_tokens total is priced at cacheWrite. */
export function estimateCost(usage, perMtok) {
  if (!perMtok || typeof perMtok !== 'object') return 0;
  const u = usage && typeof usage === 'object' ? usage : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rate = (k) => num(perMtok[k]);
  const t = usageTokens(u);
  const cacheWriteCost = (t.eph1h || t.eph5m)
    ? (t.eph5m * rate('cacheWrite')
        + t.eph1h * (perMtok.cacheWrite1h != null ? rate('cacheWrite1h') : rate('cacheWrite'))) / 1e6
    : t.cacheWrite * rate('cacheWrite') / 1e6;
  return (
    t.input * rate('input')
    + t.output * rate('output')
    + t.cacheRead * rate('cacheRead')
  ) / 1e6 + cacheWriteCost;
}

/**
 * The AUTHORITATIVE cost for a dispatched model: the CLI's own figure unless the
 * model carries an explicit override, which then wins. {free} → $0; {perMtok} →
 * recomputed from `usage`. This is what stops a CLI that prices an on-prem model
 * by name from inflating the ledger. With no override, `cliCostUsd` is returned
 * verbatim (finite or not — the caller already gates on Number.isFinite).
 *
 * ONLY call this on a genuinely cost-bearing event. A {free} model answers 0 for
 * ANY input, so feeding it a non-result stream frame (whose `cliCostUsd` is NaN)
 * would turn "nothing to record" into a real $0 the caller then books.
 *
 * A {perMtok} model is priced from tokens ALONE, so a result that carried no
 * usage object at all is UNPRICEABLE: NaN comes back rather than a silent $0, so
 * the caller's existing "no cost estimate" branch reports it instead of the
 * operator quietly under-billing a model they explicitly asked to be priced.
 * @param {string} modelId  the dispatched model id
 * @param {number} cliCostUsd  the cost the CLI reported (may be NaN)
 * @param {object} [usage]  the result event's usage object (either spelling)
 * @param {object|null} [costCfg]  this model's already-looked-up cost override;
 *   `undefined` = look it up here (see observeModelCost's note on sharing it)
 * @returns {number}
 */
export function resolveModelCost(modelId, cliCostUsd, usage, costCfg = undefined) {
  const cost = costCfg !== undefined ? costCfg : modelCostConfig(modelId);
  if (!cost) return cliCostUsd;
  if (cost.free) return 0;
  if (cost.perMtok) return isPriceableUsage(usage) ? estimateCost(usage, cost.perMtok) : NaN;
  return cliCostUsd;
}

// ── display-only list prices ──────────────────────────────────────────────────
// USD per MILLION tokens for the built-in ids, from Anthropic's published
// pricing (platform.claude.com/docs/en/pricing — snapshot 2026-06-24; Opus 5.5
// added 2026-09-22). DISPLAY
// APPROXIMATION ONLY: it feeds the chat footer's live "≈" estimate while a turn
// streams (ask/events.mjs `estimatedCostUsd`). The CLI's result.total_cost_usd,
// re-priced by resolveModelCost, stays the ONLY figure any message row, thread
// total, ledger or budget ever books — nothing here is read by those paths.
// Ids missing here get no estimate (null), which is the pre-existing behaviour;
// `[1m]` twins and dated ids resolve to their base row (the long-context premium
// is not modelled). cacheWrite = 1.25× input (5-minute TTL), cacheWrite1h = 2×
// input, cacheRead = 0.1× input except Fable 5.1 (0.025×) and Opus 5.5 (0.05×). Refresh by hand when
// Anthropic moves a price. PREDEFINED_MODELS itself stays untouched — its entry
// shape is pinned (test/config-models-global.test.mjs:205).
export const PREDEFINED_LIST_PRICES = Object.freeze({
  'claude-fable-5-1':  { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, cacheWrite1h: 20 },
  'claude-opus-5-5':   { input: 4,  output: 20, cacheRead: 0.2,  cacheWrite: 5,    cacheWrite1h: 8 },
  'claude-opus-5':     { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-8':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-7':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-6':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-sonnet-5':   { input: 2,  output: 10, cacheRead: 0.2,  cacheWrite: 2.5,  cacheWrite1h: 4 },
  'claude-sonnet-4-6': { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75, cacheWrite1h: 6 },
  'claude-haiku-4-5':  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25, cacheWrite1h: 2 },
});

const FREE_RATES = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });

/** The per-Mtok rates a DISPLAY estimate may price `modelId` with: the operator's
 *  modelCostConfig override when one exists ({free} → all-zero rates, so a free
 *  model estimates $0 instead of a list price), else the built-in list price,
 *  else null (no estimate). Never throws. */
export function liveCostRates(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return null;
  let cfg = null;
  try { cfg = modelCostConfig(id); } catch { cfg = null; }
  if (cfg && cfg.free === true) return FREE_RATES;
  if (cfg && cfg.perMtok && typeof cfg.perMtok === 'object') return cfg.perMtok;
  const base = id.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
  return PREDEFINED_LIST_PRICES[base] ?? null;
}

/**
 * All selectable models for a project = the effective catalog (predefined ⊕
 * global ⊕ this project's legacy custom models). Legacy custom models
 * advertise the full effort set (their support is unknown — the user owns the
 * raw id); global entries advertise their configured subset.
 */
export async function listModels(projectDir) {
  if (!projectDir) return composeCatalog([]); // project-less: predefined ⊕ global ⊕ plugin ⊕ policy
  const { customModels } = readRaw(projectDir);
  return composeCatalog(customModels, { projectDir });
}

/**
 * The routing env for a model id (design §4.4, §9.3), or undefined when none
 * is configured. The user's GLOBAL entry wins; otherwise the winning enabled
 * PLUGIN entry applies, with {secret} placeholders resolved from that plugin's
 * secrets store (unset secrets dropped with a warning naming plugin and key).
 * Whole-value ${VAR} refs are expanded from worca's own process env HERE (the
 * resolution point); reserved or unresolvable keys are dropped with a warning —
 * write-time validation rejects reserved keys, so a drop means a hand-edited
 * file (or manifest). Synchronous; never throws.
 * @param {string} modelId
 * @returns {Record<string,string>|undefined}
 */
export function resolveModelEnv(modelId, { tag } = {}) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return undefined;
  const lc = id.toLowerCase();
  let rawEnv;
  let who;
  let canonicalId = id;
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === lc);
  // A BRIDGED entry (model-bridge-design.md §4.2): the CLI talks to worca's
  // own loopback bridge, which forwards to the entry's upstream. The routing
  // keys are synthesized here — never user-editable beside `upstream` — and
  // the entry's remaining env (a CLAUDE_CODE_* knob, say) still merges. Only
  // the user's global layer and a plugin layer may be bridged; policy entries
  // carry `upstream` too but ride the same lookup (registry.findBridgedEntry).
  const bridged = findBridgedEntry(id);
  if (bridged) {
    // Fail fast (§8.5): a provider that is not signed in / not acknowledged
    // would otherwise surface as an opaque 401 mid-run. This is the ONE case
    // in which this resolver throws; every dispatch site already routes a
    // runClaude failure to its error path, and the Test button's hint keys on
    // `bridgeReason`. The error class is `auth` so recovery policy treats it
    // like any credential failure (never retried blindly).
    const ready = providerReadiness(bridged.upstream);
    if (!ready.ok) {
      const err = new Error(ready.message);
      err.errorClass = 'auth';
      err.bridgeReason = ready.reason;
      err.bridgeProvider = bridged.upstream.provider;
      throw err;
    }
    const base = bridged.source === 'global' && entry ? entry : null;
    const { env: extra, dropped } = prepareModelEnv(base && base.env ? base.env : {});
    for (const k of dropped) {
      console.warn(`[worca] model ${JSON.stringify(bridged.id)}: dropping env key ${JSON.stringify(k)} (reserved or unresolvable \${VAR} ref)`);
    }
    // The bridge owns the CLI's transport too: an entry-level cloud switch would
    // send the CLI past the loopback bridge, so it is dropped and forced off below.
    for (const k of [...BRIDGE_ROUTING_KEYS, ...PROVIDER_MODE_ENV_KEYS]) delete extra[k];
    const env = {
      ...extra,
      ANTHROPIC_BASE_URL: bridgeBaseUrl(bridged.id, { tag }),
      ANTHROPIC_AUTH_TOKEN: bridgeSecret(),
      ANTHROPIC_MODEL: bridged.id,
    };
    // The CLI turns tool search off for a non-Anthropic base URL and then sends
    // every MCP tool schema in full — hundreds of KB with a few user MCP
    // servers, far past a translated model's prompt limit (a local 32k model
    // fails its first call). Its ToolSearch is client-side (schemas come back
    // as tool_result text), so it works through the translation layer; the
    // entry's own env may still turn it off.
    if (isTranslatedApi(bridged.upstream.api) && !('ENABLE_TOOL_SEARCH' in env)) env.ENABLE_TOOL_SEARCH = 'true';
    // A bridged id is never a model name the CLI knows, so it assumes a 200k
    // window and compacts only once the upstream rejects a request — on a 32k
    // local model that means turns whose reply is cut to a few hundred tokens
    // long before any overflow. The pinned limits are the real window.
    const caps = bridged.upstream.capabilities || {};
    if (caps.maxPromptTokens && !('CLAUDE_CODE_MAX_CONTEXT_TOKENS' in env)) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(caps.maxPromptTokens);
    if (caps.maxOutputTokens && !('CLAUDE_CODE_MAX_OUTPUT_TOKENS' in env)) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(caps.maxOutputTokens);
    return withProviderModesOff(withTierModelEnv(env, bridged.id));
  }
  if (entry && entry.env) {
    rawEnv = entry.env;
    who = JSON.stringify(entry.id);
    canonicalId = entry.id;
  } else if (!entry) {
    const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
    if (pm && pm.env) {
      const { env, droppedSecrets } = flattenPluginModelEnv(pm);
      for (const d of droppedSecrets) {
        console.warn(`[worca] plugin "${pm.plugin}" model ${JSON.stringify(pm.id)}: dropping env ${d} — set it in the plugin's Model secrets`);
      }
      rawEnv = env;
      who = `${JSON.stringify(pm.id)} (plugin "${pm.plugin}")`;
      canonicalId = pm.id;
    } else if (!pm) {
      // A team-policy catalog entry, reached only when neither the user nor a plugin defines the
      // id. Its env carries literals and ${VAR} refs only: the editor and the reader refuse secrets.
      const tm = policyCatalogModels().find((m) => m.id.toLowerCase() === lc);
      if (tm && tm.env) {
        rawEnv = tm.env;
        who = `${JSON.stringify(tm.id)} (team policy ${tm.home})`;
        canonicalId = tm.id;
      }
    }
  }
  if (!rawEnv) return undefined;
  const { env, dropped } = prepareModelEnv(rawEnv);
  for (const k of dropped) {
    console.warn(`[worca] model ${who}: dropping env key ${JSON.stringify(k)} (reserved or unresolvable \${VAR} ref)`);
  }
  if (!Object.keys(env).length) return undefined;
  // Endpoint-routed entries also carry the CLI's internal tier keys, pointed at
  // this entry's own wire id (#422, model-env.mjs#withTierModelEnv) — so the
  // CLI's session-title / alias / probe calls never fall back to a first-party
  // id the endpoint has never heard of. They also turn the CLI's cloud
  // transports off (withProviderModesOff), which would bypass the base URL.
  // Keys the entry sets itself win.
  return withProviderModesOff(withTierModelEnv(env, canonicalId));
}

/**
 * Whether `modelId` names a catalog member — built-in, global, or plugin —
 * regardless of the hide-built-ins flag (hidden entries still resolve).
 * Case-insensitive like every other id lookup here. Synchronous; never throws.
 * @param {string} modelId
 */
export function catalogHasModel(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return false;
  const lc = id.toLowerCase();
  return PREDEFINED_MODELS.some((m) => m.id.toLowerCase() === lc)
    || listGlobalModels().some((m) => m.id.toLowerCase() === lc)
    || listPluginModels().some((m) => m.id.toLowerCase() === lc)
    || policyCatalogModels().some((m) => m.id.toLowerCase() === lc);
}

/**
 * Resolve the effective per-role { model, effort } for a run. A role with no
 * configured model inherits `fallbackModel` (the global --model). Effort has no
 * global fallback, so it is undefined when unset.
 * @returns {Promise<Record<string,{model:(string|undefined),effort:(string|undefined)}>>}
 */
export async function resolveStepModels(projectDir, fallbackModel) {
  const cfg = readRaw(projectDir);
  // Team policy `models.steps` (a default): starts a role the project has NOT configured.
  const team = teamDefault(projectDir, 'models.steps') || {};
  const out = {};
  for (const { key } of agentSteps()) {
    const own = cfg.steps[key] || {};
    const sel = own.model || own.effort ? own : (team[key] || {});
    out[key] = { model: sel.model || fallbackModel || undefined, effort: sel.effort || undefined };
  }
  return out;
}

/**
 * Upsert the legacy {steps, customModels} columns of the project_config row,
 * leaving active_workflow_id + extra intact. JSON-encodes both columns. Runs in a
 * single transaction. Used by setStep/addCustomModel/removeCustomModel.
 * @param {string} key projectKey
 * @param {{steps:object, customModels:Array}} cfg sanitized legacy view
 */
function writeLegacy(key, cfg) {
  const stepsJson = JSON.stringify(cfg.steps || {});
  const customJson = JSON.stringify(cfg.customModels || []);
  tx(() => {
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, ?, ?, NULL, '{}')
      ON CONFLICT(project_key) DO UPDATE SET steps = excluded.steps, custom_models = excluded.custom_models
    `).run(key, stepsJson, customJson);
  });
}

/**
 * Tri-state resolution for the boolean toggles (fanOut / askQuestions), shared by
 * setStep and setNodeModel so the two write paths cannot drift:
 *   boolean  -> that value          (the toggle sent it)
 *   null     -> undefined = cleared (an explicit "inherit the default again")
 *   absent   -> the previous value  (a model/effort write must not wipe a toggle)
 * @param {unknown} next
 * @param {unknown} prev
 * @returns {boolean|undefined}
 */
function inheritOr(next, prev) {
  if (typeof next === 'boolean') return next;
  if (next === null) return undefined;
  return typeof prev === 'boolean' ? prev : undefined;
}

/**
 * Tri-state resolution for the STRING tunable (subagentModel), shared by setStep
 * and setNodeModel. It is preserve-on-absent rather than replace-like model/effort
 * on purpose: the field arrived after the write APIs shipped, so an older client
 * (or any caller that only means to change the model) POSTs without it and must
 * not silently wipe a configured sub-agent policy.
 *   a valid value -> that value
 *   '' or null    -> undefined = cleared (an explicit "inherit again")
 *   absent        -> the previous value
 * An unknown non-empty string is treated as absent: the enum is validated at the
 * API boundary, and a typo must not clear a working setting.
 * @param {unknown} next
 * @param {unknown} prev
 * @returns {string|undefined}
 */
function inheritOrSubagentModel(next, prev) {
  if (isSubagentModelValue(next)) return next;
  if (next === null || next === '') return undefined;
  return isSubagentModelValue(prev) ? prev : undefined;
}

/**
 * Set (or clear) the model + effort for one agent step. An empty model => inherit
 * the global/CLI default; an empty effort => model default. Effort must be supported
 * by the chosen model. fanOut is preserved when the caller omits it (only the toggle
 * sends it) and set when a boolean. Returns the updated legacy view.
 * @returns {Promise<{steps:object, customModels:Array}>}
 */
export async function setStep(projectDir, step, selection = {}) {
  if (!stepKeys().has(step)) throw new Error(`unknown step "${step}"`);
  const model = typeof selection.model === 'string' ? selection.model.trim() : '';
  const effort = typeof selection.effort === 'string' ? selection.effort.trim() : '';

  const models = await listModels(projectDir);
  const entry = model ? models.find((m) => m.id === model) : null;
  if (model && !entry) throw new Error(`unknown model "${model}"`);
  if (effort) {
    if (!EFFORTS.includes(effort)) throw new Error(`unknown effort "${effort}"`);
    if (!entry) throw new Error('select a model before choosing an effort');
    if (!entry.efforts.includes(effort)) {
      throw new Error(`model "${model}" does not support effort "${effort}"`);
    }
  }

  {
    const issue = subagentModelIssue(selection.subagentModel);
    if (issue) throw new Error(issue);
  }

  const key = projectKey(projectDir);
  const cfg = readRaw(projectDir);
  const prev = cfg.steps[step] || {};
  // model/effort keep replace semantics (undefined => cleared); fanOut is preserved
  // when the caller omits it (only the toggle sends it), set when a boolean, and
  // CLEARED on an explicit null — the New-Pipeline accordion prunes a toggle back
  // to "inherit" when it matches the resolved default (newpipeline-ux-design.md §4.5).
  const fanOut = inheritOr(selection.fanOut, prev.fanOut);
  // askQuestions mirrors fanOut: preserved when omitted (only the toggle sends
  // it), set when a boolean (spec 2026-07-11 §4), cleared on null.
  const askQuestions = inheritOr(selection.askQuestions, prev.askQuestions);
  // subagentModel: the sub-agent model policy for a fan-out node. Preserved when
  // omitted (see inheritOrSubagentModel), cleared on '' / null.
  const subagentModel = inheritOrSubagentModel(selection.subagentModel, prev.subagentModel);

  const steps = { ...cfg.steps };
  if (!model && !effort && !subagentModel && fanOut === undefined && askQuestions === undefined) delete steps[step];
  else steps[step] = {
    ...(model && { model }),
    ...(effort && { effort }),
    ...(subagentModel && { subagentModel }),
    ...(fanOut !== undefined && { fanOut }),
    ...(askQuestions !== undefined && { askQuestions }),
  };

  const updated = { ...cfg, steps };
  writeLegacy(key, updated);
  return updated;
}

/** Add a custom model by raw id (optional label). Rejects empties + duplicates. */
export async function addCustomModel(projectDir, input = {}) {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id) throw new Error('model id is required');
  if (PREDEFINED_MODELS.some((m) => m.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`"${id}" is already a predefined model`);
  }
  if (listGlobalModels().some((m) => m.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`"${id}" is already a global model`);
  }
  const key = projectKey(projectDir);
  const cfg = readRaw(projectDir);
  if (cfg.customModels.some((m) => m.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`a model with id "${id}" already exists`);
  }
  const label = (typeof input.label === 'string' && input.label.trim()) || id;
  const updated = { ...cfg, customModels: [...cfg.customModels, { id, label }] };
  writeLegacy(key, updated);
  return updated;
}

/**
 * Remove a custom model (case-insensitive). Also: (1) clears any legacy step that
 * referenced it, and (2) deletes any normalized config_workflow_nodes row that
 * referenced it (per the migration spec — no dangling node->model refs survive).
 * Returns the updated legacy view.
 */
export async function removeCustomModel(projectDir, id) {
  const target = (typeof id === 'string' ? id : '').trim();
  const lc = target.toLowerCase();
  const key = projectKey(projectDir);
  const cfg = readRaw(projectDir);

  const customModels = cfg.customModels.filter((m) => m.id.toLowerCase() !== lc);
  const steps = {};
  for (const [k, v] of Object.entries(cfg.steps)) {
    if (v?.model && v.model.toLowerCase() === lc) continue; // drop dangling legacy reference
    steps[k] = v;
  }
  const updated = { ...cfg, customModels, steps };

  // One transaction: rewrite the legacy columns AND purge normalized node refs.
  tx(() => {
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, ?, ?, NULL, '{}')
      ON CONFLICT(project_key) DO UPDATE SET steps = excluded.steps, custom_models = excluded.custom_models
    `).run(key, JSON.stringify(steps), JSON.stringify(customModels));
    // Spec: removing a custom model also clears any per-node override pointing at it.
    prepare(
      'DELETE FROM config_workflow_nodes WHERE project_key = ? AND model = ? COLLATE NOCASE'
    ).run(key, target);
  });
  return updated;
}

/**
 * Promote a legacy per-project custom model into the GLOBAL catalog (design
 * §4.9): create the global entry (skipped when one with that id already
 * exists) and drop only the project-local entry. Deliberately NOT
 * addGlobalModel + removeCustomModel — the latter purges node/step refs, and
 * promotion must be invisible to refs (the id keeps resolving, now globally).
 * @returns {Promise<{steps:object, customModels:Array}>} the updated legacy view
 * @throws {Error} when the project has no such custom model
 */
export async function promoteCustomModel(projectDir, id) {
  const target = (typeof id === 'string' ? id : '').trim();
  const lc = target.toLowerCase();
  const cfg = readRaw(projectDir);
  const entry = cfg.customModels.find((m) => m.id.toLowerCase() === lc);
  if (!entry) throw new Error(`unknown project model "${target}"`);
  if (!listGlobalModels().some((m) => m.id.toLowerCase() === lc)) {
    await addGlobalModel({ id: entry.id, label: entry.label });
  }
  const updated = { ...cfg, customModels: cfg.customModels.filter((m) => m !== entry) };
  writeLegacy(projectKey(projectDir), updated);
  return updated;
}

// ── run-config: per-project model/effort/cycles for composed workflows ─────────
// The legacy { steps, customModels } view lives in project_config.steps /
// project_config.custom_models. The nested run-config `workflows` map is NORMALIZED
// into config_workflow_nodes + config_workflow_feedbacks; readRunConfig rebuilds the
// nested shape from those rows. activeWorkflowId is project_config.active_workflow_id;
// unknown top-level keys (e.g. webUiTesting) round-trip via project_config.extra.

/** Coerce a per-node selection to a clean {model?,effort?,subagentModel?,fanOut?,askQuestions?}
 *  or null (all empty). */
function cleanNodeSel(selection) {
  const model = typeof selection?.model === 'string' ? selection.model.trim() : '';
  const effort = typeof selection?.effort === 'string' ? selection.effort.trim() : '';
  const subagentModel = isSubagentModelValue(selection?.subagentModel) ? selection.subagentModel : '';
  const fanOut = typeof selection?.fanOut === 'boolean' ? selection.fanOut : undefined;
  const askQuestions = typeof selection?.askQuestions === 'boolean' ? selection.askQuestions : undefined;
  if (!model && !effort && !subagentModel && fanOut === undefined && askQuestions === undefined) return null;
  return {
    ...(model && { model }),
    ...(effort && { effort }),
    ...(subagentModel && { subagentModel }),
    ...(fanOut !== undefined && { fanOut }),
    ...(askQuestions !== undefined && { askQuestions }),
  };
}

/**
 * Rebuild the nested workflows map { [workflowId]: { nodes, feedbacks } } from the
 * normalized config_workflow_nodes + config_workflow_feedbacks rows for a project.
 * Mirrors today's config.json `workflows` shape exactly. Synchronous; never throws.
 * @param {string} key projectKey
 * @returns {Record<string,{nodes:object,feedbacks:object}>}
 */
function readWorkflowsMap(key) {
  getDb();
  // NULL-prototype accumulator, deliberately: a stored workflow_id of
  // '__proto__' would resolve truthy to Object.prototype on a plain `{}` and the
  // next `.wires[id] =` would throw FOREVER for that project (MAJ-1). With no
  // prototype, `workflows['__proto__'] = ...` is an ordinary own property, so a
  // poisoned row degrades to a visible junk entry instead of a permanent 500.
  const workflows = Object.create(null);
  const ensure = (wf) => {
    if (!workflows[wf]) workflows[wf] = { nodes: {}, feedbacks: {}, wires: {} };
    return workflows[wf];
  };
  for (const r of prepare(
    'SELECT workflow_id, node_id, model, effort, fan_out, ask_questions, subagent_model FROM config_workflow_nodes WHERE project_key = ?'
  ).all(key)) {
    const sel = {};
    if (r.model) sel.model = r.model;
    if (r.effort) sel.effort = r.effort;
    if (isSubagentModelValue(r.subagent_model)) sel.subagentModel = r.subagent_model;
    if (r.fan_out !== null && r.fan_out !== undefined) sel.fanOut = !!r.fan_out;
    if (r.ask_questions !== null && r.ask_questions !== undefined) sel.askQuestions = !!r.ask_questions;
    // Only attach a node entry that carries something (matches cleanNodeSel output).
    if (Object.keys(sel).length) ensure(r.workflow_id).nodes[r.node_id] = sel;
  }
  for (const r of prepare(
    'SELECT workflow_id, fb_id, max_cycles FROM config_workflow_feedbacks WHERE project_key = ?'
  ).all(key)) {
    ensure(r.workflow_id).feedbacks[r.fb_id] = { maxCycles: r.max_cycles };
  }
  // v23: per-loop-wire budgets (the graph twin of config_workflow_feedbacks).
  for (const r of prepare(
    'SELECT workflow_id, wire_id, max_cycles FROM config_workflow_wires WHERE project_key = ?'
  ).all(key)) {
    ensure(r.workflow_id).wires[r.wire_id] = { maxCycles: r.max_cycles };
  }
  // Hand callers an ORDINARY object: spread copies with CreateDataProperty, so a
  // '__proto__' key stays an own enumerable property (a plain assignment would
  // have hit the setter and silently vanished) while the public shape — what
  // JSON.stringify and every deepEqual in the suite see — is unchanged.
  return { ...workflows };
}

/**
 * Read the full RunConfig: the sanitized legacy view (steps/customModels) plus the
 * run-config layer (workflows + activeWorkflowId) and any preserved unknown keys
 * (e.g. webUiTesting from project_config.extra). Missing => empty layers. Never throws.
 * @param {string} projectDir
 * @returns {Promise<{steps:object,customModels:Array,workflows:object,activeWorkflowId?:string,webUiTesting?:object}>}
 */
export async function readRunConfig(projectDir) {
  const key = projectKey(projectDir);
  const row = readConfigRow(key);
  const legacy = row
    ? { steps: sanitizeSteps(parseJson(row.steps, {})), customModels: sanitizeCustom(parseJson(row.custom_models, [])) }
    : defaultConfig();
  const out = { ...legacy, workflows: readWorkflowsMap(key) };
  // Preserve unknown top-level keys (today: webUiTesting) from project_config.extra.
  const extra = row ? parseJson(row.extra, {}) : {};
  if (extra.webUiTesting && typeof extra.webUiTesting === 'object') out.webUiTesting = extra.webUiTesting;
  // Forward any OTHER unknown keys verbatim too (future-proof, matches "preserve unknown").
  // prRemotes is the ship-it dialog's own preference (readPrRemotePrefs), not run config.
  for (const [k, v] of Object.entries(extra)) {
    if (k !== 'webUiTesting' && k !== PR_REMOTES_KEY && k !== TEAM_METRICS_KEY && k !== TEAM_POLICY_KEY && k !== 'humanInLoopSet' && !(k in out)) out[k] = v;
  }
  const active = row && typeof row.active_workflow_id === 'string' ? row.active_workflow_id.trim() : '';
  // Spec §6.1 / D16: a project with no remembered New-pipeline choice starts on Auto — unless a
  // team policy names a default workflow (team-policy design §8), which starts it there instead.
  const teamWf = active ? undefined : teamDefault(projectDir, 'workflows.default');
  out.activeWorkflowId = active || (typeof teamWf === 'string' && teamWf ? teamWf : AUTO_WORKFLOW_ID);
  if (!active && teamWf) out.activeWorkflowSource = 'team-policy';
  // Auto workflow (spec §6.1): the human-in-the-loop switch. ON is the default
  // and is NOT echoed — the key appears only when the project turned it off, so
  // every consumer reads `config.humanInLoop ?? true` and the config shape of a
  // project that never touched it stays otherwise byte-identical. A team default applies only
  // while the project has never set its own switch (setHumanInLoop stamps extra.humanInLoopSet).
  if (row && row.human_in_loop === 0) out.humanInLoop = false;
  else if (!extra.humanInLoopSet && teamDefault(projectDir, 'run.humanInLoop') === false) out.humanInLoop = false;
  delete out.humanInLoopSet;
  return out;
}

/**
 * Set (or clear) the model+effort+subagentModel+fanOut+askQuestions for one node
 * instance of a workflow. A cleaned selection of null (all blank) deletes the row. fanOut and
 * askQuestions are preserved when the caller omits them (read from the existing
 * row), set when a boolean, and cleared on an explicit null. Writes only the config_workflow_nodes table
 * (legacy view + extra untouched). Model/effort validate against the effective
 * catalog exactly like setStep (design §4.5 — the two write paths must not
 * disagree); rows persisted before this hardening are validated only when
 * next written.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {string} nodeId
 * @param {{model?:string,effort?:string,subagentModel?:string,fanOut?:boolean,askQuestions?:boolean}} selection
 * @returns {Promise<void>}
 */
export async function setNodeModel(projectDir, workflowId, nodeId, selection = {}) {
  const model = typeof selection.model === 'string' ? selection.model.trim() : '';
  const effort = typeof selection.effort === 'string' ? selection.effort.trim() : '';
  const models = await listModels(projectDir);
  const entry = model ? models.find((m) => m.id === model) : null;
  if (model && !entry) throw new Error(`unknown model "${model}"`);
  if (effort) {
    if (!EFFORTS.includes(effort)) throw new Error(`unknown effort "${effort}"`);
    if (!entry) throw new Error('select a model before choosing an effort');
    if (!entry.efforts.includes(effort)) {
      throw new Error(`model "${model}" does not support effort "${effort}"`);
    }
  }

  {
    const issue = subagentModelIssue(selection.subagentModel);
    if (issue) throw new Error(issue);
  }

  const key = projectKey(projectDir);
  getDb();
  const prev = prepare(
    'SELECT fan_out, ask_questions, subagent_model FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
  ).get(key, workflowId, nodeId);
  const prevFanOut = prev && prev.fan_out !== null && prev.fan_out !== undefined ? !!prev.fan_out : undefined;
  const fanOut = inheritOr(selection.fanOut, prevFanOut);
  const prevAsk = prev && prev.ask_questions !== null && prev.ask_questions !== undefined ? !!prev.ask_questions : undefined;
  const askQuestions = inheritOr(selection.askQuestions, prevAsk);
  const subagentModel = inheritOrSubagentModel(selection.subagentModel, prev && prev.subagent_model);
  const sel = cleanNodeSel({ model: selection.model, effort: selection.effort, subagentModel, fanOut, askQuestions });

  tx(() => {
    if (!sel) {
      prepare(
        'DELETE FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
      ).run(key, workflowId, nodeId);
      return;
    }
    prepare(`
      INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model, effort, fan_out, ask_questions, subagent_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_key, workflow_id, node_id)
      DO UPDATE SET model = excluded.model, effort = excluded.effort,
                    fan_out = excluded.fan_out, ask_questions = excluded.ask_questions,
                    subagent_model = excluded.subagent_model
    `).run(
      key, workflowId, nodeId,
      sel.model ?? null,
      sel.effort ?? null,
      sel.fanOut === undefined ? null : (sel.fanOut ? 1 : 0),
      sel.askQuestions === undefined ? null : (sel.askQuestions ? 1 : 0),
      sel.subagentModel ?? null,
    );
  });
}

/**
 * Set the cycle count for one feedback loop of a workflow. Coerced to an integer
 * >= 1 (a loop runs at least once). Writes only config_workflow_feedbacks.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {string} fbId
 * @param {number} maxCycles
 * @returns {Promise<void>}
 */
export async function setFeedbackCycles(projectDir, workflowId, fbId, maxCycles) {
  const n = Math.max(1, Math.floor(Number(maxCycles) || 0) || 1);
  const key = projectKey(projectDir);
  tx(() => {
    prepare(`
      INSERT INTO config_workflow_feedbacks (project_key, workflow_id, fb_id, max_cycles)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_key, workflow_id, fb_id) DO UPDATE SET max_cycles = excluded.max_cycles
    `).run(key, workflowId, fbId, n);
  });
}

/**
 * Set the cycle budget for ONE loop wire of a v2 workflow. Coerced to an integer
 * >= 1 (a loop runs at least once), exactly like setFeedbackCycles — this never
 * throws, so a stale UI value cannot 500 a save. Writes only config_workflow_wires.
 */
export async function setWireCycles(projectDir, workflowId, wireId, maxCycles) {
  const n = Math.max(1, Math.floor(Number(maxCycles) || 0) || 1);
  const key = projectKey(projectDir);
  tx(() => {
    prepare(`
      INSERT INTO config_workflow_wires (project_key, workflow_id, wire_id, max_cycles)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_key, workflow_id, wire_id) DO UPDATE SET max_cycles = excluded.max_cycles
    `).run(key, workflowId, wireId, n);
  });
}

/**
 * Drop every per-project override for one workflow — the New-Pipeline accordion's
 * "Reset to defaults" (newpipeline-ux-design.md §4.5). Deletes the workflow's
 * config_workflow_nodes + config_workflow_feedbacks rows, so each node falls back
 * to the workflow's own defaults and then the agent registry.
 *
 * For the built-in default workflow it ALSO clears the legacy per-role `steps`
 * blob: that is where the Default workflow's overrides actually live, so a reset
 * that skipped it would leave the page showing "all defaults" while the run still
 * used the old models. customModels / activeWorkflowId / extra are untouched.
 *
 * @param {string} projectDir
 * @param {string} workflowId
 * @returns {Promise<void>}
 */
export async function resetWorkflowConfig(projectDir, workflowId) {
  const id = String(workflowId || '').trim();
  if (!id) throw new Error('workflowId is required');
  const key = projectKey(projectDir);
  const clearLegacy = id === 'wf_default';
  const cfg = clearLegacy ? readRaw(projectDir) : null;
  getDb();
  tx(() => {
    prepare('DELETE FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ?').run(key, id);
    prepare('DELETE FROM config_workflow_feedbacks WHERE project_key = ? AND workflow_id = ?').run(key, id);
    prepare('DELETE FROM config_workflow_wires WHERE project_key = ? AND workflow_id = ?').run(key, id);
    if (clearLegacy) {
      prepare(`
        INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
        VALUES (?, '{}', ?, NULL, '{}')
        ON CONFLICT(project_key) DO UPDATE SET steps = '{}'
      `).run(key, JSON.stringify(cfg.customModels || []));
    }
  });
}

/**
 * Remember the last workflow selected in New Pipeline. Writes only
 * project_config.active_workflow_id; steps/custom_models/extra are preserved.
 * @param {string} projectDir
 * @param {string} workflowId
 * @returns {Promise<void>}
 */
export async function setActiveWorkflow(projectDir, workflowId) {
  const key = projectKey(projectDir);
  const active = String(workflowId || '').trim();
  tx(() => {
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, '{}', '[]', ?, '{}')
      ON CONFLICT(project_key) DO UPDATE SET active_workflow_id = excluded.active_workflow_id
    `).run(key, active);
  });
}

// ── PR remote preferences (project_config.extra.prRemotes) ──────────────────
// The History "Ship it?" dialog remembers which remote the branch was pushed to
// and which repo the PR was opened in. Stored inside the free-form `extra` JSON
// column — the FIRST runtime writer of that column: a read-modify-write of this
// ONE key inside a tx, leaving every other top-level key of `extra` byte-identical
// (test/config-db.test.mjs pins that for the sibling writers, which upsert only
// their own columns and never touch `extra` on conflict).
const PR_REMOTES_KEY = 'prRemotes';

function sanitizeRemoteName(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 ? s : null;
}

/**
 * Remembered push/base remote names for a project, or null when none.
 * @param {string} projectDir
 * @returns {{ pushRemote:(string|null), baseRemote:(string|null) }|null}
 */
export function readPrRemotePrefs(projectDir) {
  const row = readConfigRow(projectKey(projectDir));
  const extra = row ? parseJson(row.extra, {}) : {};
  const p = extra[PR_REMOTES_KEY];
  if (!p || typeof p !== 'object') return null;
  const pushRemote = sanitizeRemoteName(p.pushRemote);
  const baseRemote = sanitizeRemoteName(p.baseRemote);
  return pushRemote || baseRemote ? { pushRemote, baseRemote } : null;
}

/** Remember the dialog's choice. Only `extra.prRemotes` changes; every other column/key is preserved. */
export async function setPrRemotePrefs(projectDir, { pushRemote, baseRemote } = {}) {
  const key = projectKey(projectDir);
  const next = { pushRemote: sanitizeRemoteName(pushRemote), baseRemote: sanitizeRemoteName(baseRemote) };
  tx(() => {
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = row ? parseJson(row.extra, {}) : {};
    extra[PR_REMOTES_KEY] = next;
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, '{}', '[]', NULL, ?)
      ON CONFLICT(project_key) DO UPDATE SET extra = excluded.extra
    `).run(key, JSON.stringify(extra));
  });
}

// ── Team-metrics preferences (project_config.extra.teamMetrics) ────────────
// The discovery cache + local enable state for the team-metrics feature (§4.6).
// Same read-modify-write pattern as prRemotes above, one key of the same `extra` blob.
export const TEAM_METRICS_KEY = 'teamMetrics';

/**
 * NOTE THE PARAMETER. Unlike its siblings `readPrRemotePrefs(projectDir)` /
 * `setPrRemotePrefs(projectDir, …)` above, which take a DIRECTORY and call
 * `projectKey()` themselves, these two take the KEY. Passing a path is not a type error — it is a
 * valid SQL parameter that matches no row, so the call silently returns null, which reads as
 * "not enabled" and drops every record. `assertProjectKey` makes that a loud failure instead.
 */
function assertProjectKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(key)) {
    throw new TypeError(`team metrics prefs take a projectKey(), not ${JSON.stringify(key)} — did you pass a directory?`);
  }
  return key;
}

/** @returns {object|null} the cached team-metrics state for a project key */
export function readTeamMetricsPrefs(key) {
  assertProjectKey(key);
  const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
  const extra = row ? parseJson(row.extra, {}) : {};
  const v = extra[TEAM_METRICS_KEY];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** Shallow-merge `patch` into extra.teamMetrics; returns the merged object. */
export function writeTeamMetricsPrefs(key, patch) {
  assertProjectKey(key);
  let next = null;
  tx(() => {
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = row ? parseJson(row.extra, {}) : {};
    const cur = extra[TEAM_METRICS_KEY] && typeof extra[TEAM_METRICS_KEY] === 'object' ? extra[TEAM_METRICS_KEY] : {};
    next = { ...cur, ...patch };
    extra[TEAM_METRICS_KEY] = next;
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, '{}', '[]', NULL, ?)
      ON CONFLICT(project_key) DO UPDATE SET extra = excluded.extra
    `).run(key, JSON.stringify(extra));
  });
  return next;
}

// ── Team-policy preferences (project_config.extra.teamPolicy) ──────────────
// The discovery cache for the worca-policy branch (team-policy design §9): the last
// verdict, the document read from origin, the delegate marker, and the per-window
// total-cap acknowledgements. Same KEY-taking contract as the team-metrics pair.
export const TEAM_POLICY_KEY = 'teamPolicy';

/** @returns {object|null} the cached team-policy state for a project key */
export function readTeamPolicyPrefs(key) {
  assertProjectKey(key);
  const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
  const extra = row ? parseJson(row.extra, {}) : {};
  const v = extra[TEAM_POLICY_KEY];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** Shallow-merge `patch` into extra.teamPolicy; returns the merged object. */
export function writeTeamPolicyPrefs(key, patch) {
  assertProjectKey(key);
  let next = null;
  tx(() => {
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = row ? parseJson(row.extra, {}) : {};
    const cur = extra[TEAM_POLICY_KEY] && typeof extra[TEAM_POLICY_KEY] === 'object' ? extra[TEAM_POLICY_KEY] : {};
    next = { ...cur, ...patch };
    extra[TEAM_POLICY_KEY] = next;
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
      VALUES (?, '{}', '[]', NULL, ?)
      ON CONFLICT(project_key) DO UPDATE SET extra = excluded.extra
    `).run(key, JSON.stringify(extra));
  });
  return next;
}

/**
 * Set the project's human-in-the-loop switch for Auto runs (spec D15/D20).
 * @param {string} projectDir
 * @param {boolean} value
 */
export async function setHumanInLoop(projectDir, value) {
  const key = projectKey(projectDir);
  const v = value === false ? 0 : 1;
  tx(() => {
    prepare(`
      INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra, human_in_loop)
      VALUES (?, '{}', '[]', NULL, '{}', ?)
      ON CONFLICT(project_key) DO UPDATE SET human_in_loop = excluded.human_in_loop
    `).run(key, v);
    // The project now has its own switch: a team-policy default no longer applies (design §6).
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = row ? parseJson(row.extra, {}) : {};
    if (!extra.humanInLoopSet) {
      extra.humanInLoopSet = true;
      prepare('UPDATE project_config SET extra = ? WHERE project_key = ?').run(JSON.stringify(extra), key);
    }
  });
}

/**
 * Resolve just the run-config for one workflow into { nodes, feedbacks } maps
 * (the inputs resolveWorkflow overlays on the template). Unconfigured => empties.
 * @param {string} projectDir
 * @param {string} workflowId
 * @returns {Promise<{nodes:Record<string,object>,feedbacks:Record<string,{maxCycles:number}>}>}
 */
export async function resolveRunConfig(projectDir, workflowId) {
  if (!projectDir) return { nodes: {}, wires: {}, feedbacks: {} };   // defaults-only (global export); avoids projectKey(null). v2 shape incl. wires.
  const wf = readWorkflowsMap(projectKey(projectDir))[workflowId] || {};
  return {
    nodes: wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : {},
    wires: wf.wires && typeof wf.wires === 'object' ? wf.wires : {},
    feedbacks: wf.feedbacks && typeof wf.feedbacks === 'object' ? wf.feedbacks : {},
  };
}

// ── global catalog removal (design §4.5) ──────────────────────────────────────
// Removing a GLOBAL entry can dangle refs in EVERY project, unlike
// removeCustomModel's single-project scope. Two carve-outs keep refs that stay
// resolvable: (1) removing a predefined SHADOW merely reverts to the built-in
// entry, so nothing dangles; (2) a project whose legacy customModels carries
// the same id keeps its refs — the id still resolves there (composeCatalog
// ranks the legacy entry back in once the global one is gone).

/** All project_config rows with parsed steps/customModels (raw, all projects). */
function allProjectConfigRows() {
  getDb();
  return prepare('SELECT project_key, steps, custom_models FROM project_config').all().map((r) => ({
    projectKey: r.project_key,
    steps: sanitizeSteps(parseJson(r.steps, {})),
    customModels: sanitizeCustom(parseJson(r.custom_models, [])),
  }));
}

/**
 * Preview what removing a global catalog entry would clear, for the UI's
 * confirmation dialog. `predefinedShadow: true` means the removal only reverts
 * an override and clears nothing. `memoryDefrag: true` (present only then) —
 * Settings › Memory's defragment model is this id. Synchronous; never throws.
 * @param {string} id
 * @returns {{predefinedShadow: boolean,
 *            steps: Array<{projectKey:string, step:string}>,
 *            nodes: Array<{projectKey:string, workflowId:string, nodeId:string}>,
 *            memoryDefrag?: true}}
 */
export function globalModelRefs(id) {
  const lc = (typeof id === 'string' ? id : '').trim().toLowerCase();
  if (PREDEFINED_MODELS.some((m) => m.id.toLowerCase() === lc)) {
    return { predefinedShadow: true, steps: [], nodes: [] };
  }
  const defrag = memoryDefragModel().model;
  return {
    predefinedShadow: false,
    ...refsForModelId(lc, allProjectConfigRows()),
    ...(defrag && defrag.toLowerCase() === lc ? { memoryDefrag: true } : {}),
  };
}

/** Cross-project step/node refs to one lowercased model id, minus projects
 *  whose legacy customModels carry the same id (those keep resolving). */
function refsForModelId(lc, rows) {
  const keep = new Set(rows
    .filter((r) => r.customModels.some((m) => m.id.toLowerCase() === lc))
    .map((r) => r.projectKey));
  const steps = [];
  for (const r of rows) {
    if (keep.has(r.projectKey)) continue;
    for (const [step, v] of Object.entries(r.steps)) {
      if (v?.model && v.model.toLowerCase() === lc) steps.push({ projectKey: r.projectKey, step });
    }
  }
  const nodes = prepare(
    'SELECT project_key, workflow_id, node_id FROM config_workflow_nodes WHERE model = ? COLLATE NOCASE'
  ).all(lc)
    .filter((r) => !keep.has(r.project_key))
    .map((r) => ({ projectKey: r.project_key, workflowId: r.workflow_id, nodeId: r.node_id }));
  return { steps, nodes };
}

/**
 * Uninstall guard input (design §9.4, block-with-list): the plugin's model ids
 * that pipeline configuration still references AND that would stop resolving
 * once the plugin is gone. Carve-outs — the id keeps resolving, so it does not
 * block — mirror removeGlobalModelAndRefs: (1) a user GLOBAL entry shadows it;
 * (2) a PREDEFINED id (removal reverts to the built-in); (3) another enabled
 * plugin ships the same id; (4) per-project legacy customModels (inside
 * refsForModelId). Synchronous; never throws.
 * @param {string} pluginName
 * @returns {Array<{id:string, steps:Array, nodes:Array}>}
 */
export function referencedPluginModels(pluginName) {
  const all = allPluginModels();
  const mine = all.filter((m) => m.plugin === pluginName);
  if (!mine.length) return [];
  const globalIds = new Set(listGlobalModels().map((m) => m.id.toLowerCase()));
  const predefinedIds = new Set(PREDEFINED_MODELS.map((m) => m.id.toLowerCase()));
  const rows = allProjectConfigRows();
  const out = [];
  for (const m of mine) {
    const lc = m.id.toLowerCase();
    if (globalIds.has(lc) || predefinedIds.has(lc)) continue;
    if (all.some((o) => o.plugin !== pluginName && o.id.toLowerCase() === lc)) continue;
    const { steps, nodes } = refsForModelId(lc, rows);
    if (steps.length || nodes.length) out.push({ id: m.id, steps, nodes });
  }
  return out;
}

/**
 * Remove a global catalog entry AND every ref it would dangle (per-node rows
 * and legacy step selections, across all projects, minus the carve-outs
 * above). Ref purge and settings removal are not one transaction — a purge
 * that lands without the removal (or vice versa on a crash) is harmless, since
 * refs can be re-set and purging is idempotent.
 * Settings › Memory's defragment model is a ref too: it is cleared with the entry
 * (its effort with it) and the result says so with `clearedMemoryDefrag: true`.
 * @param {string} id
 * @returns {Promise<{clearedSteps:number, clearedNodes:number, predefinedShadow:boolean, clearedMemoryDefrag?:true}>}
 * @throws {Error} on an unknown id (from removeGlobalModel)
 */
export async function removeGlobalModelAndRefs(id) {
  const target = (typeof id === 'string' ? id : '').trim();
  if (!listGlobalModels().some((m) => m.id.toLowerCase() === target.toLowerCase())) {
    // Guard BEFORE the purge: an unknown id must throw without touching refs
    // (they may belong to a legacy per-project model with the same string).
    throw new Error(`unknown model id ${JSON.stringify(target)}`);
  }
  const refs = globalModelRefs(id);
  let clearedSteps = 0;
  let clearedNodes = 0;
  if (!refs.predefinedShadow && (refs.steps.length || refs.nodes.length)) {
    const lc = String(id).trim().toLowerCase();
    const rows = allProjectConfigRows();
    const stepKeysByProject = new Map(refs.steps.map((s) => [s.projectKey, true]));
    tx(() => {
      for (const r of rows) {
        if (!stepKeysByProject.has(r.projectKey)) continue;
        const filtered = {};
        for (const [k, v] of Object.entries(r.steps)) {
          if (v?.model && v.model.toLowerCase() === lc) {
            // Clear ONLY the dangling ref (and the effort that travels with its
            // model); fanOut/askQuestions/subagentModel are not the removed
            // model's business and must survive — mirroring cleanNodeSel's
            // emptiness rule, the entry itself goes only when nothing is left.
            clearedSteps += 1;
            const { model: _m, effort: _e, ...rest } = v;
            if (Object.keys(rest).length) filtered[k] = rest;
            continue;
          }
          filtered[k] = v;
        }
        prepare('UPDATE project_config SET steps = ? WHERE project_key = ?')
          .run(JSON.stringify(filtered), r.projectKey);
      }
      for (const n of refs.nodes) {
        // Same rule for node rows: NULL the model+effort, keep the other
        // tunables, and drop the row only once every column is NULL (matching
        // readWorkflowsMap, which would not surface an all-NULL row anyway).
        clearedNodes += prepare(`
          UPDATE config_workflow_nodes SET model = NULL, effort = NULL
          WHERE project_key = ? AND workflow_id = ? AND node_id = ?
        `).run(n.projectKey, n.workflowId, n.nodeId).changes;
        prepare(`
          DELETE FROM config_workflow_nodes
          WHERE project_key = ? AND workflow_id = ? AND node_id = ?
            AND fan_out IS NULL AND ask_questions IS NULL AND subagent_model IS NULL
        `).run(n.projectKey, n.workflowId, n.nodeId);
      }
    });
  }
  if (refs.memoryDefrag) await setMemoryDefragModel(null);   // idempotent, like the purge above
  await removeGlobalModel(id); // throws on unknown id — AFTER the idempotent purge
  return { clearedSteps, clearedNodes, predefinedShadow: refs.predefinedShadow, ...(refs.memoryDefrag ? { clearedMemoryDefrag: true } : {}) };
}
