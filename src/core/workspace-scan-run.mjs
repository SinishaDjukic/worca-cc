// src/core/workspace-scan-run.mjs
// The Workspace scan as a pipeline run (wf_workspace_scan). Helpers shared by the server
// (launch + POST /api/workspaces) and run-harness (the done-time save), so a scan resumed
// by the CLI saves its workspace exactly like one the server ran:
//   scanRunTitle / scanRunPrompt   the run's title and request text
//   resolveScanModels              the models ONE scan runs with (+ describeScanModels)
//   createWorkspaceWithHomes       createWorkspace + the metrics/policy home adoption
//                                  POST /api/workspaces has always done
//   finalizeWorkspaceScan          read the scanner's output, create or update, never throw

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { checkNewWorkspace, createWorkspace, readWorkspace, updateWorkspaceDescription } from './workspaces.mjs';
import { autoMetricsHome } from './metrics/sync.mjs';
import { resolveProjectPolicy, autoPolicyHome } from './policy/sync.mjs';
import { assertWorkspaceScanInput } from './settings.mjs';
import { WORKSPACE_SCAN_DEFAULT_MODELS } from './graph/builtin-workflows.mjs';
import { scanDescriptionBudget } from '../shared/workspace-size.mjs';

/** The scanner node's output file (agents/workspaceScanner.meta.json outputs[0].filename).
 *  Not workspace-description.md: createPipeline writes the run's frozen snapshot there. */
export const WORKSPACE_SCAN_OUTPUT_FILE = 'workspace-scan.md';

/** @param {string} name */
export function scanRunTitle(name) {
  return `Workspace scan: ${name}`;
}

/**
 * The scan run's request (the task node's prompt → the scanner's "## Original request").
 * @param {{name:string, projectNames?:string[], rescan?:boolean}} opts
 */
export function scanRunPrompt({ name, projectNames = [], rescan = false } = {}) {
  const n = projectNames.length;
  const lines = [
    `Scan the interconnections of the workspace "${name}".`,
    `Member projects (${n}): ${projectNames.join(', ')}.`,
    `Head the description \`# Workspace: ${name}\`.`,
    // D23: the description's soft ceiling grows with the member count (src/shared/workspace-size.mjs).
    `Length budget: up to ~${scanDescriptionBudget(n)} lines (${n} member projects) — an upper guideline, not a target: never pad to reach it, and never drop a real relation to stay under it.`,
  ];
  if (rescan) lines.push('This is a re-scan: describe the code as it is now.');
  return lines.join('\n\n');
}

/** `scan agent claude-sonnet-5 · medium, project agents sonnet · medium` */
export function describeScanModels(m) {
  return `scan agent ${m.scanModel}${m.scanEffort ? ` · ${m.scanEffort}` : ''}, project agents ${m.agentModel} · ${m.agentEffort}`;
}

/**
 * The models ONE scan runs with (D18): the pick sent with the scan (checked strictly — a bad one is
 * the caller's 400), else Settings › General › Workspaces (a pick that no longer fits this catalog
 * degrades to the defaults with a warning, never a refused scan), else Sonnet · medium for both.
 * `models` = the catalog of the scan's primary member (what the run resolves against).
 * @returns {{scanModel:string, scanEffort:(string|null), agentModel:string, agentEffort:string,
 *   source:'explicit'|'settings'|'default', warning:(string|null)}}
 * @throws {Error} on a malformed or unknown explicit pick
 */
export function resolveScanModels({ explicit, stored = null, models = null } = {}) {
  const picked = assertWorkspaceScanInput(explicit, models);
  if (picked) return { ...picked, source: 'explicit', warning: null };
  if (stored) {
    try {
      return { ...assertWorkspaceScanInput(stored, models), source: 'settings', warning: null };
    } catch (err) {
      return {
        ...WORKSPACE_SCAN_DEFAULT_MODELS, source: 'default',
        warning: `Workspace scan models (Settings › General › Workspaces) no longer fit: ${err.message} — this scan uses ${describeScanModels(WORKSPACE_SCAN_DEFAULT_MODELS)}`,
      };
    }
  }
  return { ...WORKSPACE_SCAN_DEFAULT_MODELS, source: 'default', warning: null };
}

/**
 * Create a workspace and adopt its homes the way POST /api/workspaces does: an explicit
 * metrics home wins, else the one member that already records; the policy home follows the
 * metrics home when that member's policy resolves, else the one member whose policy does.
 * Throws createWorkspace's coded errors — validated FIRST (checkNewWorkspace), so a refused
 * request never pays for the per-member home scans (~0.2 s a member).
 * @returns {Promise<{workspace:object, metricsHomeAuto:boolean}>}
 */
export async function createWorkspaceWithHomes({ name, projectPaths, description = '', metricsProject = null, policyProject = null } = {}) {
  checkNewWorkspace({ name, projectPaths });   // createWorkspace re-checks inside its tx
  const explicit = typeof metricsProject === 'string' && metricsProject ? metricsProject : null;
  const metrics = explicit ?? await autoMetricsHome(projectPaths);
  let policy = typeof policyProject === 'string' && policyProject ? policyProject : null;
  if (!policy) {
    const viaMetrics = metrics ? await resolveProjectPolicy(metrics, { discover: false }).catch(() => null) : null;
    policy = viaMetrics?.ok ? metrics : await autoPolicyHome({ projectPaths }).catch(() => null);
  }
  const workspace = await createWorkspace({ name, projectPaths, description, metricsProject: metrics, policyProject: policy });
  return { workspace, metricsHomeAuto: !explicit && !!metrics };
}

/**
 * Save a finished scan: read the scanner's output from the run folder, then UPDATE the
 * workspace when one with this id exists (a re-scan — or one created under the same name and
 * project set while the scan ran) or CREATE it. Never throws.
 * @param {{workspaceId:string, name:string, projectPaths:string[], pipelineDir:string}} opts
 * @returns {Promise<{outcome:'created'|'updated'|'failed', workspaceId:string, error?:string, code?:string|null}>}
 */
export async function finalizeWorkspaceScan({ workspaceId, name, projectPaths, pipelineDir }) {
  let description = '';
  try {
    description = (await readFile(join(pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8')).trim();
  } catch { /* missing output reads as empty */ }
  if (!description) return { outcome: 'failed', workspaceId, error: 'the scan wrote no description', code: null };
  try {
    if (await readWorkspace(workspaceId)) {
      await updateWorkspaceDescription(workspaceId, description);
      return { outcome: 'updated', workspaceId };
    }
    const { workspace } = await createWorkspaceWithHomes({ name, projectPaths, description });
    return { outcome: 'created', workspaceId: workspace.id };
  } catch (err) {
    return { outcome: 'failed', workspaceId, error: (err && err.message) || String(err), code: (err && err.code) || null };
  }
}
