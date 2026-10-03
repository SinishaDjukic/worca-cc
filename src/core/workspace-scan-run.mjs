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

import { copyFile, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkNewWorkspace, createWorkspace, readWorkspace, saveWorkspaceScanResult, isWorkspaceMap, rootsHash,
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

/**
 * The models ONE scan runs with (D18): the pick sent with the scan (checked strictly — a bad one is
 * the caller's 400), else Settings › Runs › Workspaces (a pick that no longer fits this catalog
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
        warning: `Workspace scan models (Settings › Runs › Workspaces) no longer fit: ${err.message} — this scan uses ${describeScanModels(WORKSPACE_SCAN_DEFAULT_MODELS)}`,
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

/** Parsed JSON of a file, or null (missing, unreadable, invalid). */
async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/**
 * A file this run produced, by BARE NAME, wherever the run's layout puts it.
 *
 * A scan's outputs used to sit at the run root. Run-folder artifacts (D1) allocate
 * every execution's outputs into its own steps/<node>-c<N>/ folder, so the join's map
 * and the synth's synthesis land there now. The root is tried FIRST, so a scan
 * recorded under the older layout still resolves, then the step folders — the most
 * recently written match wins, which is the last execution that produced it (a
 * re-scan's later cycle over an earlier one).
 *
 * lstat, never stat: the name can come from the map's own `graph.file`, and
 * adoptGraphFile refuses a symlink on purpose (it could point anywhere on the
 * machine). A symlink is not `isFile()`, so it is refused here too.
 *
 * @param {string} pipelineDir
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function runFilePath(pipelineDir, name) {
  const asFile = async (p) => { try { return (await lstat(p)).isFile() ? p : null; } catch { return null; } };
  const atRoot = await asFile(join(pipelineDir, name));
  if (atRoot) return atRoot;
  let entries = [];
  try { entries = await readdir(join(pipelineDir, 'steps'), { withFileTypes: true }); } catch { return null; }
  let best = null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(pipelineDir, 'steps', e.name, name);
    try {
      const st = await lstat(p);
      if (st.isFile() && (!best || st.mtimeMs > best.at)) best = { path: p, at: st.mtimeMs };
    } catch { /* this execution wrote no such file */ }
  }
  return best ? best.path : null;
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
  const mapPath = await runFilePath(pipelineDir, WORKSPACE_MAP_FILE);
  const map = mapPath ? await readJsonFile(mapPath) : null;
  if (!isWorkspaceMap(map)) return null;
  const synthPath = await runFilePath(pipelineDir, WORKSPACE_SYNTHESIS_FILE);
  const raw = synthPath ? await readJsonFile(synthPath) : null;
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
      const src = await runFilePath(pipelineDir, name);
      if (src) {
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
 * @param {{workspaceId:string, name:string, projectPaths:string[], pipelineDir:string}} opts
 * @returns {Promise<{outcome:'created'|'updated'|'failed', workspaceId:string, error?:string, code?:string|null}>}
 */
export async function finalizeWorkspaceScan({ workspaceId, name, projectPaths, pipelineDir }) {
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
    if (!existing) {
      // The run is filed under the id the launch froze (scan D3): a workspace created under any
      // other id — a member's repository root moved while the scan ran — would never list it.
      const fresh = checkNewWorkspace({ name, projectPaths }).id;
      if (fresh !== workspaceId) {
        return { outcome: 'failed', workspaceId, error: `the project set now keys as ${fresh}, not ${workspaceId}: a member's repository root changed during the scan; nothing saved`, code: 'ID_MISMATCH' };
      }
      const { workspace } = await createWorkspaceWithHomes({ name, projectPaths, description });
      id = workspace.id;
      outcome = 'created';
    }
    const map = scan ? await adoptGraphFile(scan.map, { pipelineDir, storeDir: workspaceStorePath(id) }) : null;
    await saveWorkspaceScanResult(id, { description, map, synthesis: scan ? scan.synthesis : null });
    return { outcome, workspaceId: id };
  } catch (err) {
    return { outcome: 'failed', workspaceId, error: (err && err.message) || String(err), code: (err && err.code) || null };
  }
}
