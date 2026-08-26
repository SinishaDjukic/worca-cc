// src/core/workflows.mjs
// node:sqlite migration: now persisted in the `workflows` table; path helpers vestigial.
// Global workflow-template store + the built-in DEFAULT_WORKFLOW + resolveWorkflow.
//
// Templates are TOPOLOGY + PER-NODE DEFAULTS (steps + feedbacks by node-instance
// id; each node may carry an optional `defaults` block — newpipeline-ux-design.md
// §4.4). Per-project model/effort/cycle data is the run-config in config.mjs and
// OVERRIDES those defaults; resolveWorkflow merges both.
//
// Reads never throw: a missing/corrupt store yields []/null.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDb, prepare, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { resolveRunConfig, readConfig, EFFORTS } from './config.mjs';
import { slugify } from './artifacts.mjs';
import { DEFAULT_AGENTS_DIR } from './agent-registry.mjs'; // fileURLToPath-based (Windows-safe)

/**
 * Default feedback cycle count when run-config does not override it. Matches the
 * Composer's per-loop input default (app.js), so an unset loop runs 3 cycles.
 */
const DEFAULT_MAX_CYCLES = 3;

/** Local domain guard (mirrors agent-registry DOMAIN_RE). workflows.mjs deliberately
 *  does not import the registry, so a one-line constant is cheaper than a new coupling.
 *  Unlike the registry's normalizeDomain, this .trim()s — store input may carry
 *  whitespace from a prompt. Absent/malformed → the VISIBLE 'general' default. */
const DOMAIN_RE = /^[a-z][a-z0-9-]{0,31}$/;
function normDomain(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return DOMAIN_RE.test(v) ? v : 'general';
}

/**
 * Read an agent prompt file and pull its declared tools from YAML frontmatter.
 * Returns { prompt, tools }. A missing file => { prompt:'', tools:[] } (fails
 * safe; the orchestrator already tolerates an empty agent body). The frontmatter
 * `tools:` line is a comma-separated list (matches agents/*.md convention).
 * @param {string} agentsDir
 * @param {string|null} agentFile
 * @param {string|null} [agentPath]
 * @returns {Promise<{prompt:string, tools:string[]}>}
 */
async function loadAgentFile(agentsDir, agentFile, agentPath = null) {
  if (!agentFile && !agentPath) return { prompt: '', tools: [] };
  let text = '';
  try {
    // Layered registry: the meta's stamped absolute agentPath (built-in OR user
    // layer) wins; the classic agentsDir+agentFile join is the fallback for
    // hand-built registries (tests) and a vanished user .md.
    text = await readFile(agentPath || join(agentsDir, agentFile), 'utf8');
  } catch {
    if (agentPath && agentFile) {
      try { text = await readFile(join(agentsDir, agentFile), 'utf8'); } catch { return { prompt: '', tools: [] }; }
    } else {
      return { prompt: '', tools: [] };
    }
  }
  return { prompt: text, tools: parseFrontmatterTools(text) };
}

/** Extract a comma-separated `tools:` list from leading --- YAML frontmatter. */
function parseFrontmatterTools(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!m) return [];
  const line = m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l));
  if (!line) return [];
  return line
    .replace(/^tools\s*:/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The built-in default workflow: the CURRENT pipeline Plan -> Refine -> Implement
 * -> Review, with the two feedback loops that reproduce today's _refineLoop and
 * _reviewLoop (orchestrator.mjs:331-459):
 *   - refiner self-loop  (s1_0 -> s1_0): re-run the refine step on blocking issues.
 *   - review -> implement (s3_0 -> s2_0): on blocking review issues, run an
 *     implementer fix pass (the 'to' step) then re-review.
 * Default cycle counts come from run-config resolution (resolveRunConfig falls
 * back to DEFAULT_MAX_CYCLES = 3).
 * NOT persisted to the user store; always present; readWorkflow('wf_default')
 * returns it.
 * @type {{id:string,name:string,version:number,steps:Array<Array<{id:string,key:string}>>,feedbacks:Array<{id:string,from:string,to:string}>,createdAt:string,updatedAt:string}}
 */
export const DEFAULT_WORKFLOW = Object.freeze({
  id: 'wf_default',
  name: 'Default',
  version: 1,
  domain: 'coding',                         // built-in coding flow
  steps: [
    [{ id: 's_clarify', key: 'clarify' }],
    [{ id: 's0_0', key: 'planner' }],
    [{ id: 's1_0', key: 'refiner' }],
    [{ id: 's2_0', key: 'implementer' }],
    [{ id: 's3_0', key: 'reviewer' }],
  ],
  feedbacks: [
    { id: 'fb_refine', from: 's1_0', to: 's1_0' },
    { id: 'fb_review', from: 's3_0', to: 's2_0' },
  ],
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
});

/**
 * Sanitize one node's `defaults` block (newpipeline-ux-design.md §4.4). Loud and
 * lenient, matching the module's house style: a malformed FIELD is dropped with a
 * console.warn naming it, the rest of the block survives. An empty/absent block
 * (or one left empty after dropping) yields undefined so callers omit the key.
 * Structural only — that `model` names a catalog entry is validated at the API
 * boundary (where the effective per-project catalog is reachable), exactly like
 * setStep/setNodeModel.
 * @param {unknown} raw
 * @param {string} [nodeId] for the warning message
 * @returns {{model?:string,effort?:string,fanOut?:boolean,askQuestions?:boolean}|undefined}
 */
export function sanitizeNodeDefaults(raw, nodeId = '?') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  const warn = (field, why) =>
    console.warn(`workflow node "${nodeId}": dropping defaults.${field} (${why})`);

  if (raw.model !== undefined) {
    const model = typeof raw.model === 'string' ? raw.model.trim() : '';
    if (model) out.model = model;
    else if (raw.model !== '' && raw.model !== null) warn('model', 'not a non-empty string');
  }
  if (raw.effort !== undefined) {
    const effort = typeof raw.effort === 'string' ? raw.effort.trim() : '';
    if (EFFORTS.includes(effort)) out.effort = effort;
    else if (effort) warn('effort', `unknown effort "${effort}"`);
  }
  // An effort without a model is meaningless (it is filtered by the model's
  // advertised effort list), so it never survives on its own.
  if (out.effort && !out.model) {
    warn('effort', 'no model to interpret it');
    delete out.effort;
  }
  for (const field of ['fanOut', 'askQuestions']) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] === 'boolean') out[field] = raw[field];
    else warn(field, 'not a boolean');
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Normalize a steps matrix for persistence: pass every node through untouched
 * EXCEPT its `defaults` block, which is sanitized (and dropped when empty).
 * Unknown node fields are preserved verbatim — plugin-shipped templates may carry
 * their own, and this function must not be the thing that silently eats them.
 * Pure: returns new arrays/objects, never mutates the input.
 * @param {unknown} steps
 * @returns {Array<Array<object>>}
 */
export function sanitizeWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((group) => (Array.isArray(group) ? group.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const { defaults, ...rest } = node;
    const clean = sanitizeNodeDefaults(defaults, node.id);
    return clean ? { ...rest, defaults: clean } : rest;
  }) : group));
}

/**
 * Flatten a template's per-node defaults to { [nodeId]: defaults }. Nodes without
 * a defaults block are absent from the map. Used by the UI/API to answer "what is
 * this workflow's default for node X" without re-walking steps.
 * @param {object|null} tpl
 * @returns {Record<string,object>}
 */
export function workflowNodeDefaults(tpl) {
  const out = {};
  for (const group of Array.isArray(tpl?.steps) ? tpl.steps : []) {
    for (const node of Array.isArray(group) ? group : []) {
      if (node && node.id && node.defaults && typeof node.defaults === 'object') out[node.id] = node.defaults;
    }
  }
  return out;
}

/** Absolute path to ~/.worca-cc/workflows (honors WORCA_HOME via projects.mjs). */
export function workflowsDir() {
  return join(worcaHome(), 'workflows');
}

/** A workflow id is a stem; reject anything that could escape a path-built store
 *  (path separators, "..", dots, spaces). Valid ids are wf_<slug> / wf_default. */
const SAFE_WORKFLOW_ID = /^[A-Za-z0-9_-]+$/;
function isSafeWorkflowId(id) { return typeof id === 'string' && SAFE_WORKFLOW_ID.test(id); }

/** Fail-safe JSON.parse to an array; returns [] on any error. */
function parseArr(text) {
  if (typeof text !== 'string' || !text) return [];
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Map a workflows row to the template object shape. */
function rowToTpl(r) {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    domain: r.domain || 'general',          // pre-migration NULL → 'general'
    origin: r.origin || null,               // 'plugin:<name>' provenance; NULL = user-created
    steps: parseArr(r.steps),
    feedbacks: parseArr(r.feedbacks),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Read + shallow-validate one stored template row. Unsafe id / missing => null. */
function readRaw(id) {
  if (!isSafeWorkflowId(id)) return null; // SECURITY: reject path-traversal / unsafe ids
  getDb();
  const r = prepare(
    'SELECT id, name, version, domain, steps, feedbacks, created_at, updated_at, origin FROM workflows WHERE id = ?'
  ).get(id);
  if (!r) return null;
  const tpl = rowToTpl(r);
  return Array.isArray(tpl.steps) ? tpl : null; // mirror the legacy steps-array check
}

/**
 * Persist a template. Stamps a wf_<slug> id (from the name) when missing, version 1,
 * createdAt (preserved across re-saves), and a fresh updatedAt. steps/feedbacks are
 * stored as JSON. Returns the stored object. Never mutates the input.
 * @param {object} tpl { id?, name, steps, feedbacks, createdAt? }
 * @returns {Promise<object>}
 */
export async function writeWorkflow(tpl) {
  const now = new Date().toISOString();
  const name = (tpl && typeof tpl.name === 'string' && tpl.name.trim()) || 'Untitled';
  const id = (tpl && typeof tpl.id === 'string' && tpl.id.trim()) || `wf_${slugify(name)}`;
  const steps = sanitizeWorkflowSteps(tpl?.steps);
  const feedbacks = Array.isArray(tpl?.feedbacks) ? tpl.feedbacks : [];
  const domain = normDomain(tpl && tpl.domain);

  getDb();
  // Preserve the original createdAt if this id already exists (re-save).
  const existing = isSafeWorkflowId(id)
    ? prepare('SELECT created_at FROM workflows WHERE id = ?').get(id)
    : null;
  const createdAt =
    (tpl && typeof tpl.createdAt === 'string' && tpl.createdAt) ||
    (existing && existing.created_at) ||
    now;

  const stored = { id, name, version: 1, domain, steps, feedbacks, createdAt, updatedAt: now };
  tx(() => {
    prepare(`
      INSERT INTO workflows (id, name, version, domain, steps, feedbacks, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, version = 1, domain = excluded.domain,
        steps = excluded.steps, feedbacks = excluded.feedbacks,
        updated_at = excluded.updated_at
    `).run(id, name, domain, JSON.stringify(steps), JSON.stringify(feedbacks), createdAt, now);
  });
  return stored;
}

/**
 * Read a template by id. Returns the built-in DEFAULT_WORKFLOW for "wf_default";
 * otherwise the stored row, or null when absent/corrupt/unsafe-id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function readWorkflow(id) {
  if (id === DEFAULT_WORKFLOW.id) return DEFAULT_WORKFLOW;
  return readRaw(id);
}

/**
 * List user templates (NOT DEFAULT_WORKFLOW — callers prepend it), newest first by
 * createdAt. Empty store => []. Never throws.
 * @returns {Promise<object[]>}
 */
export async function listWorkflows() {
  getDb();
  const rows = prepare(
    'SELECT id, name, version, domain, steps, feedbacks, created_at, updated_at, origin FROM workflows ORDER BY created_at DESC, id'
  ).all();
  return rows.filter((r) => r.id !== DEFAULT_WORKFLOW.id).map(rowToTpl);
}

/**
 * Replace the per-node `defaults` of a SAVED template (newpipeline-ux-design.md
 * §4.4). `map` is { [nodeId]: defaults|null }: a sanitized block sets that node's
 * defaults, null/empty clears them, and a node absent from the map keeps what it
 * has. Node ids unknown to the template are ignored (a stale UI must not
 * resurrect deleted nodes). Topology is untouched.
 *
 * Refuses wf_default: the built-in is frozen and never persisted, so it has no row
 * to carry defaults — its sensible defaults come from the agent registry instead
 * (design D6). Duplicating it in Composer yields a saved workflow that can.
 *
 * @param {string} id
 * @param {Record<string,object|null>} map
 * @returns {Promise<object>} the updated template
 * @throws {Error} unknown/unsafe id, or the built-in default
 */
export async function setWorkflowNodeDefaults(id, map) {
  if (id === DEFAULT_WORKFLOW.id) {
    throw new Error('the built-in Default workflow cannot store defaults — save a copy in Composer first');
  }
  const tpl = readRaw(id);
  if (!tpl) throw new Error(`workflow not found: ${id}`);
  const patch = map && typeof map === 'object' ? map : {};

  const steps = tpl.steps.map((group) => (Array.isArray(group) ? group.map((node) => {
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(patch, node.id)) return node;
    const { defaults, ...rest } = node;
    const clean = sanitizeNodeDefaults(patch[node.id], node.id);
    return clean ? { ...rest, defaults: clean } : rest;
  }) : group));

  const now = new Date().toISOString();
  tx(() => {
    prepare('UPDATE workflows SET steps = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(steps), now, id);
  });
  return { ...tpl, steps, updatedAt: now };
}

/**
 * Delete a saved template by id. Refuses the built-in DEFAULT_WORKFLOW (false) and
 * unsafe ids (false). Returns false when no row exists; true on removal.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteWorkflow(id) {
  if (id === DEFAULT_WORKFLOW.id) return false; // built-in default is undeletable
  if (!isSafeWorkflowId(id)) return false;      // SECURITY: reject unsafe ids
  getDb();
  let changed = 0;
  tx(() => {
    changed = prepare('DELETE FROM workflows WHERE id = ?').run(id).changes;
  });
  return changed > 0;
}
/**
 * Merge a workflow template + the project's run-config + the agent registry into
 * an ExecutablePlan the dispatcher runs:
 *   { id, name, steps:[[Node]], feedbacks:[{id,from,to,maxCycles,gate}] }
 *   Node = { nodeId, key, uiPhase, runnerType, agentFile, agentPrompt, model, effort, tools, loopSource }
 * model/effort come from run-config (undefined when unset; the orchestrator folds
 * in the global fallback at dispatch). maxCycles defaults to DEFAULT_MAX_CYCLES.
 * [v2/C5] When `opts.isWorkspace` is set, the review node is substituted at resolve
 * time: any `reviewer` node key becomes `workspaceReviewer` (the fan-out synthesizer
 * that diffs each member's checkpoint and folds one merged verdict). This is the ONE
 * topology change a workspace run makes here; the orchestrator then forces fanOut on
 * the eligible nodes (which now includes `workspaceReviewer`). Absent `isWorkspace`,
 * the resolved plan is BYTE-IDENTICAL to today's single-project path.
 * @param {string} projectDir
 * @param {string} workflowId
 * @param {Record<string,object>} registry  loadAgentRegistry() output
 * @param {string} [agentsDir]  override for tests; defaults to ../../agents
 * @param {{ isWorkspace?: boolean }} [opts]  workspace-mode resolve options
 * @returns {Promise<object>} ExecutablePlan
 * @throws {Error} when the workflow id is unknown, or a node resolves the off-pipeline scanner
 */
export async function resolveWorkflow(projectDir, workflowId, registry, agentsDir = DEFAULT_AGENTS_DIR, opts = {}) {
  const tpl = await readWorkflow(workflowId);
  if (!tpl) throw new Error(`workflow not found: ${workflowId}`);
  const reg = registry && typeof registry === 'object' ? registry : {};
  const isWorkspace = !!(opts && opts.isWorkspace);
  const { nodes: nodeCfg, feedbacks: fbCfg } = await resolveRunConfig(projectDir, workflowId);
  // Legacy per-role config (what the Default-workflow UI writes) applies ONLY to
  // the default workflow's nodes — this is what makes its per-agent model/effort/
  // fanOut actually reach the main runs (saved workflows use nodeCfg only).
  const stepsCfg = workflowId === DEFAULT_WORKFLOW.id ? (await readConfig(projectDir)).steps : {};
  const firstDefined = (...vals) => vals.find((v) => v !== undefined);
  // CONV-4: map each agent key to the UI stepper bucket the live view understands,
  // so the dispatcher can emit a real `'phase'` per node (every node gets its own
  // stepper cell via the snapshotted manifest; see buildStepperManifest).
  const UI_PHASE = {
    clarify: 'clarify',
    planner: 'plan', refiner: 'refine', decomposer: 'decompose', implementer: 'implement', reviewer: 'review',
    manualTestsChecklist: 'manual-checklist', manualWebUiTesting: 'manual-web', planReviewer: 'plan-review',
    workspaceReviewer: 'review', // shares the single-project review stepper bucket
  };

  const steps = [];
  for (const group of tpl.steps) {
    const resolvedGroup = [];
    for (const node of group) {
      // [C5] Workspace substitution: the review node becomes the fan-out synthesizer.
      // Applied to the resolved node key (and its nodeId-stable stepper bucket) so the
      // dispatcher routes it to runWorkspaceReviewer; single-project keys are untouched.
      const key = isWorkspace && node.key === 'reviewer' ? 'workspaceReviewer' : node.key;
      // [§6.6] Defensive guard: the off-pipeline scanner is never a workflow node.
      // Reject it if hand-authored into a saved workflow so it can't be dispatched.
      if (key === 'workspaceScanner') {
        throw new Error('workspaceScanner is an off-pipeline producer and cannot be a workflow node');
      }
      const meta = reg[key] || {};
      const { prompt, tools } = await loadAgentFile(agentsDir, meta.agentFile ?? null, meta.agentPath ?? null);
      const sel = nodeCfg[node.id] || {};
      // Legacy per-role config is keyed by the ORIGINAL UI step key (e.g. `reviewer`),
      // so a substituted workspaceReviewer still inherits the user's review model/effort.
      const legacy = stepsCfg[node.key] || {};
      // Workflow-level per-node defaults sit BELOW both run-config layers and ABOVE
      // the registry sidecar (newpipeline-ux-design.md §4.3): a project override
      // still wins, but an untouched project inherits the workflow author's tuning.
      const wfDef = (node.defaults && typeof node.defaults === 'object') ? node.defaults : {};
      resolvedGroup.push({
        nodeId: node.id,
        key,
        uiPhase: UI_PHASE[key] || meta.uiPhase || key,   // CONV-4 map > meta.uiPhase (v2) > key
        runnerType: meta.runnerType || 'producer',
        agentFile: meta.agentFile ?? null,
        agentPrompt: prompt,
        promptHints: typeof meta.promptHints === 'string' ? meta.promptHints : '',
        model: firstDefined(sel.model, legacy.model, wfDef.model),     // undefined unless configured (folded later)
        // An effort only travels with the model that advertises it, so a project
        // override that names its own model must not inherit the workflow default's
        // effort — otherwise "Opus/max" silently becomes "Haiku/max".
        effort: firstDefined(sel.effort, legacy.effort, (sel.model || legacy.model) ? undefined : wfDef.effort),
        fanOut: !!firstDefined(sel.fanOut, legacy.fanOut, wfDef.fanOut, meta.fanOut, false), // node > role > workflow > sidecar > false
        // Per-agent user questions (spec 2026-07-11): unsupported is ALWAYS off;
        // locked ignores every override; else node > role > workflow > sidecar default.
        askQuestions: !meta.asksQuestions
          ? false
          : (meta.questionsLocked
              ? !!meta.questionsDefault
              : !!firstDefined(sel.askQuestions, legacy.askQuestions, wfDef.askQuestions, meta.questionsDefault, false)),
        tools,
        loopSource: !!meta.loopSource,
        consumes: meta.consumes || [],
        optionalConsumes: meta.optionalConsumes || [],
        produces: meta.produces || [],
        connectsTo: meta.connectsTo || '*',
      });
    }
    steps.push(resolvedGroup);
  }

  const feedbacks = (Array.isArray(tpl.feedbacks) ? tpl.feedbacks : []).map((fb) => ({
    id: fb.id,
    from: fb.from,
    to: fb.to,
    maxCycles: Number(fbCfg[fb.id]?.maxCycles) > 0 ? Number(fbCfg[fb.id].maxCycles) : DEFAULT_MAX_CYCLES,
    gate: 'hasBlocking',
  }));

  return { id: tpl.id, name: tpl.name, steps, feedbacks };
}

/**
 * Build the UI stepper manifest from a resolved ExecutablePlan + agent registry.
 * The manifest is the snapshot the Running/History views render from, so it is
 * persisted into state.json (and flows through every 'state' event). It brackets
 * the workflow's step-cells with the framework's real Preflight and Done phases.
 *
 * @param {object} plan  resolveWorkflow() output: { id, name, steps, feedbacks }
 * @param {Record<string,object>} registry  loadAgentRegistry() output
 * @returns {{version:1, steps:Array<{kind:string, nodes:object[]}>, feedbacks:Array<{id:string,from:string,to:string,maxCycles:number}>}}  node shape includes model, effort
 */
export function buildStepperManifest(plan, registry) {
  const reg = registry && typeof registry === 'object' ? registry : {};
  const fbs = Array.isArray(plan?.feedbacks) ? plan.feedbacks : [];
  const isCycleTarget = (nodeId) => fbs.some((fb) => fb && fb.to === nodeId);

  const agentCells = (Array.isArray(plan?.steps) ? plan.steps : []).map((group) => ({
    kind: 'agents',
    nodes: group.map((node) => {
      const meta = reg[node.key] || {};
      return {
        id: node.nodeId,
        key: node.key,
        uiPhase: node.uiPhase || node.key,
        label: meta.displayName || node.key,
        color: meta.color || '',
        sub: meta.description || '',
        cycles: isCycleTarget(node.nodeId),
        model: node.model || '',
        effort: node.effort || '',
      };
    }),
  }));

  return {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      ...agentCells,
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    // Loop edges for the graph renderer (self-cycle = from===to, cross-loop = from!==to).
    // Projected to the UI-facing shape; `gate` is intentionally dropped (UI never reads it).
    feedbacks: fbs.map(({ id, from, to, maxCycles }) => ({ id, from, to, maxCycles })),
  };
}

/**
 * Rewrite a UI stepper manifest for a decomposed run: replace the single implementer
 * agent cell with one cell PER PHASE, each holding one implementer node PER TASK
 * (node id = task.nodeId, label = task title). Feedback edges whose `to` was the
 * implementer node are retargeted to the first task node so the review->implement
 * loop wire still lands. Pure: returns a NEW manifest; the input is untouched. If no
 * implementer cell exists, the manifest is returned unchanged. IDEMPOTENT: when the
 * manifest already carries the decomposed task cells (a resumed run re-enters the
 * decomposed implement stage and re-applies this rewrite to the persisted, already-
 * rewritten manifest), it is returned unchanged instead of duplicating the cells.
 * @param {object} manifest buildStepperManifest() output
 * @param {Array<{ordinal:number, tasks:Array<{id:string,title?:string,nodeId:string}>}>} phases
 * @returns {object} the rewritten manifest
 */
export function rewriteStepperForDecomposition(manifest, phases) {
  const steps = Array.isArray(manifest?.steps) ? manifest.steps : [];
  const phaseList = Array.isArray(phases) ? phases : [];

  // Idempotency guard: the rewrite emits one node per task with id = task.nodeId
  // (stamped `s_impl_p<ordinal>_t<n>` by _persistDecomposition). If any cell already
  // holds one of those ids, this decomposition has been applied — return unchanged.
  const taskIds = new Set(
    phaseList.flatMap((ph) => (Array.isArray(ph.tasks) ? ph.tasks : []))
      .map((t) => t.nodeId)
      .filter(Boolean),
  );
  if (steps.some((cell) => (cell.nodes || []).some((n) => taskIds.has(n.id)))) return manifest;

  const implCellIdx = steps.findIndex(
    (cell) => cell.kind === 'agents' && cell.nodes.some((n) => n.key === 'implementer'),
  );
  if (implCellIdx < 0) return manifest;

  const implNode = steps[implCellIdx].nodes.find((n) => n.key === 'implementer');
  const implNodeId = implNode.id;

  const phaseCells = phaseList.map((ph) => ({
    kind: 'agents',
    label: `Phase ${ph.ordinal}`,
    nodes: (Array.isArray(ph.tasks) ? ph.tasks : []).map((t) => ({
      id: t.nodeId,
      key: 'implementer',
      uiPhase: 'implement',
      label: t.title || t.id,
      color: implNode.color || '',
      sub: implNode.sub || '',
      cycles: false,
      model: implNode.model || '',
      effort: implNode.effort || '',
    })),
  }));

  const firstTaskId = phaseCells[0]?.nodes[0]?.id || implNodeId;
  const newSteps = [
    ...steps.slice(0, implCellIdx),
    ...phaseCells,
    ...steps.slice(implCellIdx + 1),
  ];
  const newFeedbacks = (Array.isArray(manifest.feedbacks) ? manifest.feedbacks : []).map((fb) =>
    fb.to === implNodeId ? { ...fb, to: firstTaskId } : { ...fb },
  );
  return { ...manifest, steps: newSteps, feedbacks: newFeedbacks };
}
