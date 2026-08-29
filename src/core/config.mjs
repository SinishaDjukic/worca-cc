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
import { loadAgentRegistry, registryToSteps } from './agent-registry.mjs';
import { EFFORTS, prepareModelEnv } from './model-env.mjs';
import { listGlobalModels, addGlobalModel, removeGlobalModel } from './settings.mjs';
import { listPluginModels, allPluginModels, flattenPluginModelEnv } from './plugin-models.mjs';

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
 * available for this subscription"). Fable 5 needs no `[1m]` suffix: its context
 * window is 1M by default (verified to resolve via `claude --model`). Opus 5
 * (`claude-opus-5`) and Sonnet 5 (`claude-sonnet-5`) are likewise 1M-only and
 * carry no `[1m]` twin.
 */
export const PREDEFINED_MODELS = [
  { id: 'claude-opus-5',          label: 'Opus 5',          efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-fable-5',         label: 'Fable 5 (1M)',    efforts: ['medium', 'high', 'xhigh', 'max'] },
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

/** Keep only known step keys carrying a non-empty model/effort and/or a fanOut/askQuestions boolean. */
function sanitizeSteps(steps) {
  const out = {};
  const keys = stepKeys();
  for (const [k, v] of Object.entries(steps || {})) {
    if (!keys.has(k) || !v || typeof v !== 'object') continue;
    const model = typeof v.model === 'string' ? v.model.trim() : '';
    const effort = typeof v.effort === 'string' ? v.effort.trim() : '';
    const fanOut = typeof v.fanOut === 'boolean' ? v.fanOut : undefined;
    const askQuestions = typeof v.askQuestions === 'boolean' ? v.askQuestions : undefined;
    if (model || effort || fanOut !== undefined || askQuestions !== undefined) {
      out[k] = {
        ...(model && { model }),
        ...(effort && { effort }),
        ...(fanOut !== undefined && { fanOut }),
        ...(askQuestions !== undefined && { askQuestions }),
      };
    }
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
function readConfigRow(key) {
  getDb();
  return prepare(
    'SELECT steps, custom_models, active_workflow_id, extra FROM project_config WHERE project_key = ?'
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
 * (this shape feeds UI dropdowns).
 */
function composeCatalog(projectCustom = []) {
  const globals = listGlobalModels();
  const globalByIdLc = new Map(globals.map((m) => [m.id.toLowerCase(), m]));
  const plugins = listPluginModels();
  const pluginByIdLc = new Map(plugins.map((m) => [m.id.toLowerCase(), m]));
  const flagged = costUnreliableModelIds();
  const out = [];
  const seen = new Set();
  const unreliable = (lc) => (flagged.has(lc) ? { costUnreliable: true } : {});
  const pluginShape = (id, m, lc) => ({
    id, label: m.label, efforts: [...m.efforts], custom: 'plugin', plugin: m.plugin,
    hasEnv: !!m.env, ...unreliable(lc),
  });
  for (const m of PREDEFINED_MODELS) {
    const lc = m.id.toLowerCase();
    const shadow = globalByIdLc.get(lc);
    const pshadow = pluginByIdLc.get(lc);
    out.push(shadow
      ? { id: m.id, label: shadow.label, efforts: [...shadow.efforts], custom: 'global', hasEnv: !!shadow.env, ...unreliable(lc) }
      : pshadow
        ? pluginShape(m.id, pshadow, lc)
        : { ...m, custom: false, hasEnv: false });
    seen.add(lc);
  }
  for (const m of globals) {
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) continue; // predefined shadow, already emitted
    seen.add(lc);
    out.push({ id: m.id, label: m.label, efforts: [...m.efforts], custom: 'global', hasEnv: !!m.env, ...unreliable(lc) });
  }
  for (const m of plugins) {
    const lc = m.id.toLowerCase();
    if (seen.has(lc)) continue; // predefined/global shadow wins
    seen.add(lc);
    out.push(pluginShape(m.id, m, lc));
  }
  for (const m of projectCustom) {
    if (seen.has(m.id.toLowerCase())) continue; // predefined/global/plugin wins
    seen.add(m.id.toLowerCase());
    out.push({ id: m.id, label: m.label, efforts: [...EFFORTS], custom: 'project', hasEnv: false });
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
  if (entry) return !!(entry.env && 'ANTHROPIC_BASE_URL' in entry.env);
  const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
  return !!(pm && pm.env && 'ANTHROPIC_BASE_URL' in pm.env);
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
 * @returns {'flagged'|'cleared'|null} what changed — 'flagged' asks the caller
 *   to surface its one-per-run warning; null = no observation recorded
 */
export function observeModelCost(modelId, costUsd, usage) {
  if (!modelHasBaseUrlRouting(modelId)) return null;
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

/**
 * All selectable models for a project = the effective catalog (predefined ⊕
 * global ⊕ this project's legacy custom models). Legacy custom models
 * advertise the full effort set (their support is unknown — the user owns the
 * raw id); global entries advertise their configured subset.
 */
export async function listModels(projectDir) {
  if (!projectDir) return composeCatalog([]); // project-less: predefined ⊕ global only
  const { customModels } = readRaw(projectDir);
  return composeCatalog(customModels);
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
export function resolveModelEnv(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return undefined;
  const lc = id.toLowerCase();
  let rawEnv;
  let who;
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === lc);
  if (entry && entry.env) {
    rawEnv = entry.env;
    who = JSON.stringify(entry.id);
  } else if (!entry) {
    const pm = listPluginModels().find((m) => m.id.toLowerCase() === lc);
    if (pm && pm.env) {
      const { env, droppedSecrets } = flattenPluginModelEnv(pm);
      for (const d of droppedSecrets) {
        console.warn(`[worca] plugin "${pm.plugin}" model ${JSON.stringify(pm.id)}: dropping env ${d} — set it in the plugin's Model secrets`);
      }
      rawEnv = env;
      who = `${JSON.stringify(pm.id)} (plugin "${pm.plugin}")`;
    }
  }
  if (!rawEnv) return undefined;
  const { env, dropped } = prepareModelEnv(rawEnv);
  for (const k of dropped) {
    console.warn(`[worca] model ${who}: dropping env key ${JSON.stringify(k)} (reserved or unresolvable \${VAR} ref)`);
  }
  return Object.keys(env).length ? env : undefined;
}

/**
 * Resolve the effective per-role { model, effort } for a run. A role with no
 * configured model inherits `fallbackModel` (the global --model). Effort has no
 * global fallback, so it is undefined when unset.
 * @returns {Promise<Record<string,{model:(string|undefined),effort:(string|undefined)}>>}
 */
export async function resolveStepModels(projectDir, fallbackModel) {
  const cfg = readRaw(projectDir);
  const out = {};
  for (const { key } of agentSteps()) {
    const sel = cfg.steps[key] || {};
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

  const steps = { ...cfg.steps };
  if (!model && !effort && fanOut === undefined && askQuestions === undefined) delete steps[step];
  else steps[step] = {
    ...(model && { model }),
    ...(effort && { effort }),
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

/** Coerce a per-node selection to a clean {model?,effort?,fanOut?,askQuestions?} or null (all empty). */
function cleanNodeSel(selection) {
  const model = typeof selection?.model === 'string' ? selection.model.trim() : '';
  const effort = typeof selection?.effort === 'string' ? selection.effort.trim() : '';
  const fanOut = typeof selection?.fanOut === 'boolean' ? selection.fanOut : undefined;
  const askQuestions = typeof selection?.askQuestions === 'boolean' ? selection.askQuestions : undefined;
  if (!model && !effort && fanOut === undefined && askQuestions === undefined) return null;
  return {
    ...(model && { model }),
    ...(effort && { effort }),
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
    'SELECT workflow_id, node_id, model, effort, fan_out, ask_questions FROM config_workflow_nodes WHERE project_key = ?'
  ).all(key)) {
    const sel = {};
    if (r.model) sel.model = r.model;
    if (r.effort) sel.effort = r.effort;
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
  for (const [k, v] of Object.entries(extra)) {
    if (k !== 'webUiTesting' && !(k in out)) out[k] = v;
  }
  const active = row && typeof row.active_workflow_id === 'string' ? row.active_workflow_id.trim() : '';
  if (active) out.activeWorkflowId = active;
  return out;
}

/**
 * Set (or clear) the model+effort+fanOut+askQuestions for one node instance of a
 * workflow. A cleaned selection of null (all blank) deletes the row. fanOut and
 * askQuestions are preserved when the caller omits them (read from the existing
 * row), set when a boolean, and cleared on an explicit null. Writes only the config_workflow_nodes table
 * (legacy view + extra untouched). Model/effort validate against the effective
 * catalog exactly like setStep (design §4.5 — the two write paths must not
 * disagree); rows persisted before this hardening are validated only when
 * next written.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {string} nodeId
 * @param {{model?:string,effort?:string,fanOut?:boolean,askQuestions?:boolean}} selection
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

  const key = projectKey(projectDir);
  getDb();
  const prev = prepare(
    'SELECT fan_out, ask_questions FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
  ).get(key, workflowId, nodeId);
  const prevFanOut = prev && prev.fan_out !== null && prev.fan_out !== undefined ? !!prev.fan_out : undefined;
  const fanOut = inheritOr(selection.fanOut, prevFanOut);
  const prevAsk = prev && prev.ask_questions !== null && prev.ask_questions !== undefined ? !!prev.ask_questions : undefined;
  const askQuestions = inheritOr(selection.askQuestions, prevAsk);
  const sel = cleanNodeSel({ model: selection.model, effort: selection.effort, fanOut, askQuestions });

  tx(() => {
    if (!sel) {
      prepare(
        'DELETE FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
      ).run(key, workflowId, nodeId);
      return;
    }
    prepare(`
      INSERT INTO config_workflow_nodes (project_key, workflow_id, node_id, model, effort, fan_out, ask_questions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_key, workflow_id, node_id)
      DO UPDATE SET model = excluded.model, effort = excluded.effort,
                    fan_out = excluded.fan_out, ask_questions = excluded.ask_questions
    `).run(
      key, workflowId, nodeId,
      sel.model ?? null,
      sel.effort ?? null,
      sel.fanOut === undefined ? null : (sel.fanOut ? 1 : 0),
      sel.askQuestions === undefined ? null : (sel.askQuestions ? 1 : 0),
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

/**
 * Resolve just the run-config for one workflow into { nodes, feedbacks } maps
 * (the inputs resolveWorkflow overlays on the template). Unconfigured => empties.
 * @param {string} projectDir
 * @param {string} workflowId
 * @returns {Promise<{nodes:Record<string,object>,feedbacks:Record<string,{maxCycles:number}>}>}
 */
export async function resolveRunConfig(projectDir, workflowId) {
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
 * an override and clears nothing. Synchronous; never throws.
 * @param {string} id
 * @returns {{predefinedShadow: boolean,
 *            steps: Array<{projectKey:string, step:string}>,
 *            nodes: Array<{projectKey:string, workflowId:string, nodeId:string}>}}
 */
export function globalModelRefs(id) {
  const lc = (typeof id === 'string' ? id : '').trim().toLowerCase();
  if (PREDEFINED_MODELS.some((m) => m.id.toLowerCase() === lc)) {
    return { predefinedShadow: true, steps: [], nodes: [] };
  }
  return { predefinedShadow: false, ...refsForModelId(lc, allProjectConfigRows()) };
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
 * @param {string} id
 * @returns {Promise<{clearedSteps:number, clearedNodes:number, predefinedShadow:boolean}>}
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
          if (v?.model && v.model.toLowerCase() === lc) { clearedSteps += 1; continue; }
          filtered[k] = v;
        }
        prepare('UPDATE project_config SET steps = ? WHERE project_key = ?')
          .run(JSON.stringify(filtered), r.projectKey);
      }
      for (const n of refs.nodes) {
        clearedNodes += prepare(
          'DELETE FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
        ).run(n.projectKey, n.workflowId, n.nodeId).changes;
      }
    });
  }
  await removeGlobalModel(id); // throws on unknown id — AFTER the idempotent purge
  return { clearedSteps, clearedNodes, predefinedShadow: refs.predefinedShadow };
}
