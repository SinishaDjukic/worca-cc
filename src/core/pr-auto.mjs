// src/core/pr-auto.mjs
// "Open a PR when a run finishes": the run's body check, the resolution (run > project/workspace setting > team policy >
// none), the decision a run saves at start (pipelines.pr_auto) and the outcome the finisher writes back
// (src/core/pr-auto-finish.mjs). A Shaper feature keeps its own copy (shape_features.pr_*), which every slice reads.

import { getDb, prepare } from './db.mjs';
import { PR_OPEN, PR_SLICES } from '../shared/pr-auto.mjs';
import { resolveMany } from './settings-cascade.mjs';
import { readWorkspace } from './workspaces.mjs';
import { readWorkspaceSettings } from './workspace-settings.mjs';
import { resolveWorkspacePolicy } from './policy/sync.mjs';
import { fieldsForRun } from './policy/effective.mjs';
import { findPipelineRowById, runDirForRow } from './artifacts.mjs';
import { appendRunLog } from './run-log.mjs';
import { featureOfPipeline } from './shape/features.mjs';

/** @typedef {'run'|'project'|'workspace'|'team'|'default'|'feature'} PrSource */
/** @typedef {{ status:'opened'|'skipped'|'failed'|'waiting'|'held'|'blocked', final:boolean, reason?:string, urls?:string[],
 *   draft?:boolean, fellBack?:boolean, at:string }} Outcome */
/** @typedef {{ open:'none'|'draft'|'ready', slices:'each'|'one'|null, source:{open:PrSource, slices:PrSource|null},
 *   scope:'project'|'workspace'|'none', featureId?:string, exempt?:string, outcome?:Outcome }} PrAuto */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const parse = (text) => { try { const v = JSON.parse(text); return isObj(v) ? v : null; } catch { return null; } };

/** Validate the `pr` member of a run body. `raw` undefined/null is "no choice". */
export function checkRunPrBody(raw) {
  if (raw === undefined || raw === null) return { ok: true, pr: null };
  if (!isObj(raw)) return { ok: false, error: 'pr must be an object like { "open": "draft" }' };
  for (const key of Object.keys(raw)) if (key !== 'open' && key !== 'slices') return { ok: false, error: `pr: unknown key "${key}"` };
  if (raw.open !== undefined && !PR_OPEN.includes(raw.open)) return { ok: false, error: 'pr.open must be one of none | draft | ready' };
  if (raw.slices !== undefined && !PR_SLICES.includes(raw.slices)) return { ok: false, error: 'pr.slices must be one of each | one' };
  const pr = {};
  if (raw.open !== undefined) pr.open = raw.open;
  if (raw.slices !== undefined) pr.slices = raw.slices;
  return { ok: true, pr: Object.keys(pr).length ? pr : null };
}

/** The team policy's pr.open for a workspace run (`workspaceRuns` over `fields`), or undefined. An unreadable home is "no team layer". */
async function workspaceTeamOpen(ws) {
  try {
    const r = await resolveWorkspacePolicy(ws, { discover: false });
    if (!r.ok) return undefined;
    const entry = fieldsForRun(r.doc, { workspaceRun: true })['pr.open'];
    return entry && entry.kind === 'default' && PR_OPEN.includes(entry.value) ? entry.value : undefined;
  } catch { return undefined; }
}

/** The value a run starts from without choosing: the project or workspace setting, then team policy, then none. Never throws. */
export async function scopePrSetting({ projectDir = null, workspaceId = null } = {}) {
  try {
    if (workspaceId) {
      const own = readWorkspaceSettings(workspaceId)?.['pr.open'];
      if (PR_OPEN.includes(own)) return { scope: 'workspace', open: { value: own, source: 'workspace' }, slices: null };
      const team = await workspaceTeamOpen(await readWorkspace(workspaceId));
      return { scope: 'workspace', open: team ? { value: team, source: 'team' } : { value: 'none', source: 'default' }, slices: null };
    }
    if (projectDir) {
      const r = resolveMany(['pr.open', 'pr.slices'], { projectDir });
      return { scope: 'project', open: { value: r['pr.open'].value, source: r['pr.open'].source },
        slices: { value: r['pr.slices'].value, source: r['pr.slices'].source } };
    }
  } catch { /* fall through to the built-in default */ }
  return { scope: 'none', open: { value: 'none', source: 'default' }, slices: null };
}

/** The workspace's pr.open for its settings row: what it stores, what the team says, and what applies. null for an unknown workspace. */
export async function workspacePrView(id) {
  const settings = readWorkspaceSettings(id);
  if (!settings) return null;
  const own = PR_OPEN.includes(settings['pr.open']) ? settings['pr.open'] : null;
  const team = (await workspaceTeamOpen(await readWorkspace(id))) ?? null;
  const effective = own ? { value: own, source: 'workspace' } : team ? { value: team, source: 'team' } : { value: 'none', source: 'default' };
  return { own: own ? { 'pr.open': own } : {}, effective: { 'pr.open': effective }, team: { 'pr.open': team } };
}

const LEGACY_SOURCE = Object.freeze({ open: 'default', slices: 'default' });

/** A feature's saved values (with who started it and its project): null for an unknown feature; a feature from before v86 reads as none / each. */
export function featurePrSetting(featureId) {
  getDb();
  const row = prepare('SELECT pr_open, pr_slices, pr_source, pr_outcome, created_by, project_dir FROM shape_features WHERE id = ?').get(String(featureId));
  if (!row) return null;
  const source = parse(row.pr_source) || LEGACY_SOURCE;
  return { open: PR_OPEN.includes(row.pr_open) ? row.pr_open : 'none', slices: PR_SLICES.includes(row.pr_slices) ? row.pr_slices : 'each',
    source: { open: source.open || 'default', slices: source.slices || 'default' }, outcome: parse(row.pr_outcome),
    createdBy: row.created_by || null, projectDir: row.project_dir || null };
}

/** Decide a run's setting at its start. `pr` is checkRunPrBody(...).pr. @returns {Promise<PrAuto>} */
export async function resolveRunPr({ pr = null, shape = null, projectDir = null, workspaceId = null, noProject = false, exempt = null } = {}) {
  const scope = workspaceId ? 'workspace' : projectDir && !noProject ? 'project' : 'none';
  const kind = noProject ? 'no-project' : exempt;
  if (kind) return { open: 'none', slices: null, exempt: kind, scope, source: { open: 'default', slices: null } };
  const featureId = shape?.slice?.feature || shape?.replaces || null;
  if (featureId) {
    const f = featurePrSetting(featureId) || { open: 'none', slices: 'each' };
    return { open: f.open, slices: f.slices, scope, featureId, source: { open: 'feature', slices: 'feature' } };
  }
  const base = await scopePrSetting({ projectDir, workspaceId });
  const out = { open: base.open.value, slices: base.slices ? base.slices.value : null, scope: base.scope,
    source: { open: base.open.source, slices: base.slices ? base.slices.source : null } };
  if (pr?.open) { out.open = pr.open; out.source.open = 'run'; }
  if (pr?.slices && out.scope === 'project') { out.slices = pr.slices; out.source.slices = 'run'; }
  return out;
}

/** The run's saved decision (+ outcome), or null before v86 / for a CLI start. */
export function readRunPrAuto(pipelineId) {
  getDb();
  const row = prepare('SELECT pr_auto FROM pipelines WHERE id = ?').get(String(pipelineId));
  return row?.pr_auto ? parse(row.pr_auto) : null;
}

/** Record the run's outcome. A final outcome is written once; a non-final one can be replaced. @returns {boolean} written */
export function setRunPrOutcome(pipelineId, outcome) {
  getDb();
  return prepare(`UPDATE pipelines SET pr_auto = json_set(pr_auto, '$.outcome', json(?)) WHERE id = ? AND pr_auto IS NOT NULL
    AND COALESCE(json_extract(pr_auto, '$.outcome.final'), 0) = 0`).run(JSON.stringify(outcome), String(pipelineId)).changes > 0;
}

/** Record the feature's automatic one-PR attempt: only when none is recorded yet, or the last one is `held`. */
export function setFeaturePrOutcome(featureId, outcome) {
  getDb();
  return prepare(`UPDATE shape_features SET pr_outcome = ? WHERE id = ?
    AND (pr_outcome IS NULL OR json_extract(pr_outcome, '$.status') = 'held')`).run(JSON.stringify(outcome), String(featureId)).changes > 0;
}

/** What the run's header shows: the saved decision, read-only; a slice run shows the feature's values. null before v86. */
export function prAutoView(pipelineId) {
  const pa = readRunPrAuto(pipelineId);
  if (!pa) return null;
  const at = featureOfPipeline(pipelineId);
  const f = at ? featurePrSetting(at.featureId) : null;
  if (!f) return { ...pa, readOnly: true };
  return { ...pa, open: f.open, slices: f.slices, source: { open: 'feature', slices: 'feature' }, scope: 'project', readOnly: true,
    feature: { id: at.featureId, source: f.source, ...(f.outcome ? { outcome: f.outcome } : {}) } };
}

/** Append a line to the run's live log (History › Log). Never throws. */
export async function logToRun(pipelineId, level, text) {
  try {
    const row = findPipelineRowById(pipelineId);
    if (row) await appendRunLog(await runDirForRow(row), { source: 'pr', level, text, ts: new Date().toISOString() });
  } catch { /* best effort */ }
}
