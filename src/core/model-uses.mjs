// src/core/model-uses.mjs — who uses a model (U2b, PAN-6) and the clear a delete runs (PAN-7). A "use" is a job
// whose stored pick names the model: a role, a step, a helper job, a Design job (user level, settings.json) or a
// project's step or workflow node (config.mjs projectModelPicks). Not sources (L21): askModels,
// workspaces.scan.scanModel, nightMode.deciderModel. config.mjs never imports this module.
import { prepare } from './db.mjs';
import { agentSteps, engineOfModel, projectModelPicks } from './config.mjs';
import { assertTestSettingsAccess, readSettings, writeSettingsKeys } from './settings.mjs';
import { HELPER_JOBS, DESIGN_JOBS } from '../shared/model-jobs.mjs';
import { ROLE_LABELS } from '../shared/model-roles.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (v) => (typeof v === 'string' ? v.trim() : '');
// A { model?, effort? } pair names a model only through `model` (an effort alone names none).
const pairModel = (pair) => (isObj(pair) ? idOf(pair.model) : '');
// Engine, role and job keys come from settings.json as written: one named after an Object.prototype member
// (`constructor`, `toString`) is a plain key, never the prototype's.
const helperLabel = (engine, key) => (Object.hasOwn(HELPER_JOBS, engine) ? HELPER_JOBS[engine].find((j) => j.key === key)?.label : '') || key;
const designLabel = (key) => DESIGN_JOBS.find((j) => j.key === key)?.label || key;
const roleLabel = (key) => (Object.hasOwn(ROLE_LABELS, key) ? ROLE_LABELS[key] : '') || key;

// Claude's helper jobs keep their picks in top-level keys: a bare id, or a { model, effort } pair.
const CLAUDE_ID_KEYS = Object.freeze({ title: 'titleModel', classifier: 'autoWorkflowModel', prDescription: 'prDescriptionModel' });
const CLAUDE_PAIR_KEYS = Object.freeze({
  agentGen: 'agentGenModel', naming: 'namingModel', commandSummary: 'commandSummaryModel', guide: 'guideModel',
  secondOpinion: 'secondOpinionModel', requirementsInterview: 'requirementsInterview',
});

// A pick that names a model goes whole (model and effort); the entry's other keys stay, and the entry goes once empty.
function dropPair(owner, key) {
  const { model: _model, effort: _effort, ...rest } = owner[key];
  if (Object.keys(rest).length) owner[key] = rest; else delete owner[key];
}
// `<top>.<engine>.<key>`: an engine block or top-level map left empty goes too.
const clearNested = (top, engine, key) => (next) => {
  dropPair(next[top][engine], key);
  if (!Object.keys(next[top][engine]).length) delete next[top][engine];
  if (!Object.keys(next[top]).length) delete next[top];
};
// memory.defrag also holds the defragment thresholds (writes, files, bytesPct, alwaysOnBytes): only the pick goes,
// and defrag / memory only when left empty (as settings.mjs setMemoryDefragModel).
const clearDefrag = (next) => {
  delete next.memory.defrag.model;
  delete next.memory.defrag.effort;
  if (!Object.keys(next.memory.defrag).length) delete next.memory.defrag;
  if (!Object.keys(next.memory).length) delete next.memory;
};

/** Every user-level pick in `s` that names a model: { top, model, use, clear(next) }. `top` is the settings key the
 *  clear rewrites; `stepLabel(key)` names a step. */
function userPicks(s, stepLabel) {
  const picks = [];
  const nested = (top, kind, labelOf) => {
    if (!isObj(s[top])) return;
    for (const [engine, block] of Object.entries(s[top])) {
      if (!isObj(block)) continue;
      for (const [key, pair] of Object.entries(block)) {
        const model = pairModel(pair);
        if (model) picks.push({ top, model, use: { kind, engine, key, label: labelOf(key, engine) }, clear: clearNested(top, engine, key) });
      }
    }
  };
  nested('modelRoles', 'role', roleLabel);
  nested('stepModels', 'step', (key) => stepLabel(key));
  nested('utilityModels', 'helper', (key, engine) => helperLabel(engine, key));
  const claudeHelper = (top, key, model, clear) => {
    if (model) picks.push({ top, model, use: { kind: 'helper', engine: 'claude', key, label: helperLabel('claude', key) }, clear });
  };
  for (const [key, top] of Object.entries(CLAUDE_ID_KEYS)) claudeHelper(top, key, idOf(s[top]), (next) => { delete next[top]; });
  if (isObj(s.memory) && isObj(s.memory.defrag)) claudeHelper('memory', 'memoryDefrag', idOf(s.memory.defrag.model), clearDefrag);
  for (const [key, top] of Object.entries(CLAUDE_PAIR_KEYS)) claudeHelper(top, key, pairModel(s[top]), (next) => dropPair(next, top));
  nested('designModels', 'design', (key) => designLabel(key));
  return picks;
}

const homeGuarded = () => !!process.env.NODE_TEST_CONTEXT && !process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;

/** Use = { kind: 'role'|'step'|'helper'|'design'|'project-step'|'project-node', engine, key, label, project? } */
/** Every model id some job names → its uses, keyed by the LOWER-CASED id. `projects:false` = user level only. */
export function modelUses({ projects = true } = {}) {
  // The settings readers' node:test home guard (settings.mjs keeps its own private): never the real ~/.worca-cc.
  if (homeGuarded()) return {};
  const steps = new Map(agentSteps().map((st) => [st.key, st.label]));
  const stepLabel = (key) => steps.get(key) || key;
  // A Map, so an id named `constructor` or `__proto__` is a key like any other (the result has own keys only).
  const uses = new Map();
  const add = (model, use) => {
    const lc = model.toLowerCase();
    if (!uses.has(lc)) uses.set(lc, []);
    uses.get(lc).push(use);
  };
  for (const p of userPicks(readSettings(), stepLabel)) add(p.model, p.use);
  if (!projects) return Object.fromEntries(uses);
  const names = new Map();
  const projectName = (key) => {
    if (!names.has(key)) names.set(key, prepare('SELECT name FROM projects WHERE key = ?').get(key)?.name ?? key);
    return names.get(key);
  };
  const engines = new Map();
  const engineOf = (model) => {
    if (!engines.has(model)) engines.set(model, engineOfModel(model) || 'claude');
    return engines.get(model);
  };
  for (const p of projectModelPicks()) {
    add(p.model, p.kind === 'project-step'
      ? { kind: p.kind, engine: 'claude', key: p.step, label: stepLabel(p.step), project: projectName(p.projectKey) }
      // A node may name a Codex or Copilot model: its engine is the model's.
      : { kind: p.kind, engine: engineOf(p.model), key: p.nodeId, label: `${p.workflowId} › ${p.nodeId}`, project: projectName(p.projectKey) });
  }
  return Object.fromEntries(uses);
}

/** Clears every USER-level pick naming `id` (case-insensitive); returns how many it cleared. */
export async function clearModelUses(id) {
  assertTestSettingsAccess();
  const lc = idOf(id).toLowerCase();
  const settings = readSettings();
  const hits = lc ? userPicks(settings, (key) => key).filter((p) => p.model.toLowerCase() === lc) : [];
  if (!hits.length) return 0;
  const next = structuredClone(settings);
  for (const p of hits) p.clear(next);
  // ONE write of the touched top-level keys; `undefined` deletes a key left empty.
  await writeSettingsKeys(Object.fromEntries([...new Set(hits.map((p) => p.top))].map((top) => [top, next[top]])));
  return hits.length;
}
