// src/core/workspace-scan-run.mjs
// The Workspace scan as a pipeline run (wf_workspace_scan). Helpers shared by the server
// (launch + POST /api/workspaces) and run-harness (the done-time save), so a scan resumed
// by the CLI saves its workspace exactly like one the server ran:
//   scanRunTitle / scanRunPrompt   the run's title and request text
//   resolveScanModels              the models ONE scan runs with (+ describeScanModels)
//   createWorkspaceWithHomes       createWorkspace + the metrics/policy home adoption
//                                  POST /api/workspaces has always done
//   finalizeWorkspaceScan          save a finished scan from the pipeline's outputs (the render
//                                  card's description, the join's map, the synth's synthesis,
//                                  the merged graph): create or update, never throw

import { copyFile, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkNewWorkspace, createWorkspace, memberHasTeamRepo, readWorkspace, saveWorkspaceScanResult, isWorkspaceMap, rootsHash, scanModelsPick,
} from './workspaces.mjs';
import { workspaceStorePath } from './store.mjs';
import { autoMetricsHome } from './metrics/sync.mjs';
import { resolveProjectPolicy, autoPolicyHome } from './policy/sync.mjs';
import { assertWorkspaceScanInput } from './settings.mjs';
import { WORKSPACE_SCAN_DEFAULT_MODELS } from './graph/builtin-workflows.mjs';
import { scanDescriptionBudget } from '../shared/workspace-size.mjs';

/** The render card's output file (scripts/workspaceMapRender.meta.json outputs[0].filename): the
 *  description the pipeline rendered with the overrides the run froze at start (wsmap M15; none on a
 *  first scan). The finalize saves it as-is only when the scan wrote no map; with a map it re-renders
 *  (the overrides stored at that moment applied). Not workspace-description.md: createPipeline writes
 *  the run's frozen snapshot there. */
export const WORKSPACE_SCAN_OUTPUT_FILE = 'workspace-scan.md';

/** The join's map, the synth's synthesis (run folder) and the merged graph's copy (workspace store). */
export const WORKSPACE_MAP_FILE = 'workspace-map.json';
export const WORKSPACE_SYNTHESIS_FILE = 'synthesis.json';
export const WORKSPACE_GRAPH_FILE = 'workspace-graph.json';

/** @param {string} name */
export function scanRunTitle(name) {
  return `Workspace scan: ${name}`;
}

/**
 * The scan run's request: the task node's prompt, kept in the run's History and bound to the extract
 * card's `task` input (no card reads its text). Its `Length budget:` line names the ceiling the render
 * card enforces (scanDescriptionBudget).
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

/** The scan models EVERY scan with no usable stored pick falls to: WORKSPACE_SCAN_DEFAULT_MODELS,
 *  or — when a KNOWN catalog (the primary member's) lacks the default SCAN agent model — a THROWN
 *  Error (the caller's 400, or the automatic re-scan's skip reason). An absent or empty catalog
 *  ("no info", e.g. a failed catalog GET) keeps today's look-the-other-way default. Never silently
 *  pick a model this deployment demonstrably does not have (the reported bug). */
function defaultScanModelsOrThrow(models, warning) {
  const d = WORKSPACE_SCAN_DEFAULT_MODELS;
  if (!Array.isArray(models) || models.length === 0) return { ...d, source: 'default', warning: warning ?? null };
  if (!models.some((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === d.scanModel.toLowerCase())) {
    const available = models.map((m) => m.id).join(', ');
    throw new Error(
      `no workspace scan model is available: the default "${d.scanModel}" is not in this deployment's model catalog (available: ${available}) — configure a scan model in Settings › Runs › Workspaces before scanning`
    );
  }
  return { ...d, source: 'default', warning: warning ?? null };
}

/**
 * The models ONE scan runs with (D18, D19): the pick sent with the scan (checked strictly — a bad
 * one is the caller's 400), else the workspace's OWN stored pick (captured at creation: source
 * 'workspace'), else Settings › Runs › Workspaces (source 'settings') — a stored pick that no longer
 * fits this catalog degrades to the next source with a warning, never a refused scan — else the
 * defaults; the defaults are only used when a known catalog actually offers the default scan agent
 * model, otherwise resolveScanModels THROWS so the caller blocks with clear guidance (D19).
 * `models` = the catalog of the scan's primary member (what the run resolves against).
 * @param {{explicit?:object, stored?:object|null, workspacePick?:object|null, models?:Array|null}} opts
 * @returns {{scanModel:string, scanEffort:(string|null), agentModel:string, agentEffort:string,
 *   source:'explicit'|'workspace'|'settings'|'default', warning:(string|null)}}
 * @throws {Error} on a malformed/unknown explicit pick, or when the last resort has no usable model
 */
export function resolveScanModels({ explicit, stored = null, workspacePick = null, models = null } = {}) {
  const picked = assertWorkspaceScanInput(explicit, models);
  if (picked) return { ...picked, source: 'explicit', warning: null };

  let degraded = null;
  for (const [source, label, pick] of [
    ['workspace', 'the workspace\'s create-time scan pick', workspacePick],
    ['settings', 'Settings › Runs › Workspaces', stored],
  ]) {
    if (!pick) continue;
    try {
      return { ...assertWorkspaceScanInput(pick, models), source, warning: null };
    } catch (err) {
      // A stored pick that no longer fits this catalog degrades (never refuses)…
      degraded = `${source === 'settings' ? 'Workspace scan models' : 'The workspace\'s scan pick'} (${label}) no longer fit: ${err.message} — this scan uses ${describeScanModels(WORKSPACE_SCAN_DEFAULT_MODELS)}`;
      // …and falls through to the next source; the last resort blocks when the default is absent.
    }
  }
  return defaultScanModelsOrThrow(models, degraded);
}

/**
 * Create a workspace and adopt its homes the way POST /api/workspaces does: an explicit
 * metrics home wins, else the one member that already records; the policy home follows the
 * metrics home when that member's policy resolves, else the one member whose policy does.
 * Throws createWorkspace's coded errors — validated FIRST (checkNewWorkspace), so a refused
 * request never pays for the per-member home scans (~0.2 s a member).
 * @returns {Promise<{workspace:object, metricsHomeAuto:boolean}>}
 */
export async function createWorkspaceWithHomes({ name, projectPaths, description = '', metricsProject = null, policyProject = null, scanModels = null } = {}) {
  checkNewWorkspace({ name, projectPaths });   // createWorkspace re-checks inside its tx
  const explicit = typeof metricsProject === 'string' && metricsProject ? metricsProject : null;
  // P5: a Folder member has no origin to record on — the home scans read git members only (no git in a Folder's folder).
  // P6 (S75): and the members whose team repository is known over HTTPS (without git every member is a Folder).
  const gitPaths = (Array.isArray(projectPaths) ? projectPaths : []).filter((p) => memberHasTeamRepo(p));
  const metrics = explicit ?? await autoMetricsHome(gitPaths);
  let policy = typeof policyProject === 'string' && policyProject ? policyProject : null;
  if (!policy) {
    const viaMetrics = metrics ? await resolveProjectPolicy(metrics, { discover: false }).catch(() => null) : null;
    policy = viaMetrics?.ok ? metrics : await autoPolicyHome({ projectPaths: gitPaths }).catch(() => null);
  }
  const workspace = await createWorkspace({ name, projectPaths, description, metricsProject: metrics, policyProject: policy, scanModels });
  return { workspace, metricsHomeAuto: !explicit && !!metrics };
}

/** Parsed JSON of a file, or null (missing, unreadable, invalid). */
async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/**
 * The join's map + the synth's synthesis from a finished scan's run folder. null when there is
 * no run folder or no usable map (a scan from before the map, or a join that wrote nothing). A
 * missing or unreadable synthesis is null; a present one is returned as read —
 * saveWorkspaceScanResult checks it (checkSynthesis: invalid items dropped, every kept string
 * redacted) before anything is stored. Never throws.
 * @param {string} pipelineDir
 * @returns {Promise<{map:object, synthesis:object|null}|null>}
 */
export async function readScanMap(pipelineDir) {
  if (typeof pipelineDir !== 'string' || !pipelineDir) return null;
  const map = await readJsonFile(join(pipelineDir, WORKSPACE_MAP_FILE));
  if (!isWorkspaceMap(map)) return null;
  const raw = await readJsonFile(join(pipelineDir, WORKSPACE_SYNTHESIS_FILE));
  const synthesis = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  return { map, synthesis };
}

/** map.graph.file as the join writes it: a bare file name inside the run folder, never a path. */
const GRAPH_FILE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Keep the merged cross-project graph (P7) past the run: copy <pipelineDir>/<map.graph.file> to
 * <storeDir>/workspace-graph.json and point map.graph.file at the copy (absolute). The copy is
 * written beside the old one (<dest>.tmp) and renamed over it, so an agent reading the graph
 * sees the old file or the new one, never half of one; when the rename is refused (Windows: a
 * reader holds the old copy open — EPERM / EBUSY / EACCES) it falls back to a direct copy. A
 * missing file, a symlink (never followed: it could point anywhere on the machine), a name that
 * is not a bare file name, or a copy that fails leaves no graph (file: null; mode kept) and
 * removes a previous scan's copy. The temp file never outlives the call. Never throws.
 * @param {object} map
 * @param {{pipelineDir:string, storeDir:string, renameFile?:(from:string, to:string) => Promise<void>}} dirs
 *   renameFile: a test seam for a refused rename (default: fs rename)
 * @returns {Promise<object>} the map to store
 */
export async function adoptGraphFile(map, { pipelineDir, storeDir, renameFile = rename }) {
  const graph = map.graph && typeof map.graph === 'object' && !Array.isArray(map.graph) ? map.graph : null;
  const name = graph && typeof graph.file === 'string' ? graph.file : '';
  const dest = join(storeDir, WORKSPACE_GRAPH_FILE);
  const tmp = `${dest}.tmp`;
  let copied = false;
  if (GRAPH_FILE_NAME_RE.test(name)) {
    try {
      const src = join(pipelineDir, name);
      if ((await lstat(src)).isFile()) {
        await mkdir(storeDir, { recursive: true });
        await copyFile(src, tmp);
        try { await renameFile(tmp, dest); } catch { await copyFile(src, dest); }
        copied = true;
      }
    } catch { /* missing, unreadable or not writable: no graph */ }
  }
  // `recursive` only so that Node honours maxRetries (it retries nothing without it): on Windows an
  // antivirus scanner may hold the fresh temp file for a moment. `dest` stays non-recursive — a
  // directory at that path is never ours to remove.
  await rm(tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  if (!copied) await rm(dest, { force: true }).catch(() => {});
  return graph ? { ...map, graph: { ...graph, file: copied ? dest : null } } : map;
}

/**
 * Save a finished scan from the scan pipeline's outputs in the run folder, then UPDATE the
 * workspace when one with this id exists (a re-scan — or one created under the same name and
 * project set while the scan ran; never one whose members changed since: 'SET_CHANGED') or CREATE it — under this id only: a project set that keys
 * differently now (a member's repository root moved) fails with code 'ID_MISMATCH' and creates
 * nothing. With a map (the join card's workspace-map.json)
 * the map + synthesis are stored and the description is RE-RENDERED from them with the
 * workspace's stored overrides (saveWorkspaceScanResult), so confirm / reject / manual edges
 * survive the re-scan; the merged graph is copied into the workspace store. Without a map the
 * render card's markdown (workspace-scan.md) is saved as before. Either way the description is
 * marked 'generated'. Never throws.
 * @param {{workspaceId:string, name:string, projectPaths:string[], pipelineDir:string, models?:object|null}} opts
 * @returns {Promise<{outcome:'created'|'updated'|'failed', workspaceId:string, error?:string, code?:string|null}>}
 */
export async function finalizeWorkspaceScan({ workspaceId, name, projectPaths, pipelineDir, models = null }) {
  let description = '';
  try {
    description = (await readFile(join(pipelineDir, WORKSPACE_SCAN_OUTPUT_FILE), 'utf8')).trim();
  } catch { /* missing output reads as empty */ }
  const scan = await readScanMap(pipelineDir);
  if (!description && !scan) return { outcome: 'failed', workspaceId, error: 'the scan wrote no description', code: null };
  try {
    let id = workspaceId;
    let outcome = 'updated';
    const existing = await readWorkspace(workspaceId);
    // Members can change after the scan started (addWorkspaceMembers / removeWorkspaceMember): a map
    // of the old set is never saved over the new one — the change started a re-scan of its own.
    if (existing && rootsHash(existing.projectPaths) !== rootsHash(projectPaths)) {
      return { outcome: 'failed', workspaceId, error: 'the workspace\'s members changed while the scan ran; nothing saved (a re-scan of the new set replaces it)', code: 'SET_CHANGED' };
    }
    // An EXISTING workspace pick is persisted lazily ONLY for a scan that ran on a deliberately
    // chosen model (source 'explicit' — the create wizard's pick or the pick-a-model window a rescan
    // opens for a pick-less/stale workspace). A scan that fell through to Settings › Runs › Workspaces
    // or the default must NOT bake that snapshot into the workspace: the pick-a-model flow is the
    // only thing that establishes a legacy (pre-v57) workspace's pick, and a never-chosen default
    // must not silently stick. The persisting is lazy in saveWorkspaceScanResult (nothing stored on
    // a pick the workspace already has; nothing storable on a resume, models null).
    const resolvedPick = existing && models && models.source === 'explicit' ? scanModelsPick(models) : null;
    if (!existing) {
      // The run is filed under the id the launch froze (scan D3): a workspace created under any
      // other id — a member's repository root moved while the scan ran — would never list it.
      const fresh = checkNewWorkspace({ name, projectPaths }).id;
      if (fresh !== workspaceId) {
        return { outcome: 'failed', workspaceId, error: `the project set now keys as ${fresh}, not ${workspaceId}: a member's repository root changed during the scan; nothing saved`, code: 'ID_MISMATCH' };
      }
      // Persist the wizard's deliberate pick (explicit only) on creation — a scan that fell through
      // to settings/defaults must not bake those into the workspace. Re-scans keep the stored pick.
      const scanModels = models && models.source === 'explicit'
        ? scanModelsPick(models)
        : null;
      const { workspace } = await createWorkspaceWithHomes({ name, projectPaths, description, scanModels });
      id = workspace.id;
      outcome = 'created';
    }
    const map = scan ? await adoptGraphFile(scan.map, { pipelineDir, storeDir: workspaceStorePath(id) }) : null;
    await saveWorkspaceScanResult(id, { description, map, synthesis: scan ? scan.synthesis : null, scanModels: resolvedPick });
    return { outcome, workspaceId: id };
  } catch (err) {
    return { outcome: 'failed', workspaceId, error: (err && err.message) || String(err), code: (err && err.code) || null };
  }
}
