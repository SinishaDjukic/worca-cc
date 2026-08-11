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
import { loadAgentRegistry } from './agent-registry.mjs';

/**
 * The agent step list, recomputed FRESH from the layered registry (repo agents/ +
 * ~/.worca-cc/agents) on every call, so a user-added agent appears without a
 * process restart. Each agent labels itself with its `displayName` — there is no
 * key->label table.
 *
 * §6.6/C9: `scope:'workspace-only'` agents are EXCLUDED — they are not part of the
 * single-project per-step config keyspace this list drives.
 * @returns {Array<{key:string,label:string,fanOut:boolean,asksQuestions:boolean,questionsLocked:boolean,questionsDefault:boolean}>}
 */
export function agentSteps() {
  return Object.values(loadAgentRegistry())
    .filter((m) => m.scope !== 'workspace-only')
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      key: m.key,
      label: m.displayName,
      fanOut: !!m.fanOut,
      asksQuestions: !!m.asksQuestions,
      questionsLocked: !!m.questionsLocked,
      questionsDefault: !!m.questionsDefault,
    }));
}

/** Live key set (recomputed per call so runtime-added user agents validate). */
const stepKeys = () => new Set(agentSteps().map((s) => s.key));

/** All effort levels the UI can offer (ordering is not a ranking). */
export const EFFORTS = ['medium', 'high', 'xhigh', 'max'];

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
 * (`claude-opus-5`) is likewise 1M-only and carries no `[1m]` twin.
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
 * All selectable models = predefined + this project's custom models. Custom models
 * advertise the full effort set (their support is unknown — the user owns the raw id).
 */
export async function listModels(projectDir) {
  const { customModels } = readRaw(projectDir);
  const predefined = PREDEFINED_MODELS.map((m) => ({ ...m, custom: false }));
  const custom = customModels.map((m) => ({ id: m.id, label: m.label, efforts: [...EFFORTS], custom: true }));
  return [...predefined, ...custom];
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
  // when the caller omits it (only the toggle sends it), and set when a boolean.
  const fanOut = typeof selection.fanOut === 'boolean'
    ? selection.fanOut
    : (typeof prev.fanOut === 'boolean' ? prev.fanOut : undefined);
  // askQuestions mirrors fanOut: preserved when omitted (only the toggle sends
  // it), set when a boolean (spec 2026-07-11 §4).
  const askQuestions = typeof selection.askQuestions === 'boolean'
    ? selection.askQuestions
    : (typeof prev.askQuestions === 'boolean' ? prev.askQuestions : undefined);

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
 * Rebuild the nested workflows map { [workflowId]: { nodes, feedbacks, wires } }
 * from the normalized config_workflow_nodes + config_workflow_feedbacks +
 * config_workflow_wires rows for a project. `wires` is the v2 per-WIRE loop
 * budget overlay resolveGraph reads; `feedbacks` is the v1 shape it succeeds,
 * kept so a project configured before the graph engine still round-trips.
 * Synchronous; never throws.
 * @param {string} key projectKey
 * @returns {Record<string,{nodes:object,feedbacks:object,wires:object}>}
 */
function readWorkflowsMap(key) {
  getDb();
  const workflows = {};
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
  for (const r of prepare(
    'SELECT workflow_id, wire_id, max_cycles FROM config_workflow_wires WHERE project_key = ?'
  ).all(key)) {
    ensure(r.workflow_id).wires[r.wire_id] = { maxCycles: r.max_cycles };
  }
  return workflows;
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
 * row) and set when a boolean. Writes only the config_workflow_nodes table
 * (legacy view + extra untouched).
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {string} nodeId
 * @param {{model?:string,effort?:string,fanOut?:boolean,askQuestions?:boolean}} selection
 * @returns {Promise<void>}
 */
export async function setNodeModel(projectDir, workflowId, nodeId, selection = {}) {
  const key = projectKey(projectDir);
  getDb();
  const prev = prepare(
    'SELECT fan_out, ask_questions FROM config_workflow_nodes WHERE project_key = ? AND workflow_id = ? AND node_id = ?'
  ).get(key, workflowId, nodeId);
  const prevFanOut = prev && prev.fan_out !== null && prev.fan_out !== undefined ? !!prev.fan_out : undefined;
  const fanOut = typeof selection.fanOut === 'boolean' ? selection.fanOut : prevFanOut;
  const prevAsk = prev && prev.ask_questions !== null && prev.ask_questions !== undefined ? !!prev.ask_questions : undefined;
  const askQuestions = typeof selection.askQuestions === 'boolean' ? selection.askQuestions : prevAsk;
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
 * Set the loop budget for one WIRE of a graph template — the v2 successor to
 * setFeedbackCycles, keyed by v2 wire id. Coerced to an integer >= 1 (a loop
 * runs at least once). Writes only config_workflow_wires, the overlay
 * resolveGraph reads at precedence overlay > wire.config.maxCycles > 3.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {string} wireId
 * @param {number} maxCycles
 * @returns {Promise<void>}
 */
export async function setWireCycles(projectDir, workflowId, wireId, maxCycles) {
  const n = Math.max(1, Math.floor(Number(maxCycles) || 0) || 1);
  const key = projectKey(projectDir);
  tx(() => {
    prepare(`
      INSERT INTO config_workflow_wires (workflow_id, project_key, wire_id, max_cycles)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workflow_id, project_key, wire_id) DO UPDATE SET max_cycles = excluded.max_cycles
    `).run(workflowId, key, wireId, n);
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
 * (the inputs resolveGraph overlays on the template). Unconfigured => empties.
 * @param {string} projectDir
 * @param {string} workflowId
 * @returns {Promise<{nodes:Record<string,object>,feedbacks:Record<string,{maxCycles:number}>}>}
 */
export async function resolveRunConfig(projectDir, workflowId) {
  const wf = readWorkflowsMap(projectKey(projectDir))[workflowId] || {};
  return {
    nodes: wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : {},
    feedbacks: wf.feedbacks && typeof wf.feedbacks === 'object' ? wf.feedbacks : {},
  };
}
