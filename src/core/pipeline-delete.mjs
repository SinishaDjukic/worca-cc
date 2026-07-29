// src/core/pipeline-delete.mjs
// Delete a finished pipeline and everything that belongs to it: its store folder,
// its shared plan/review markdown (now resolved EXACTLY via the artifacts index,
// no more baseName guessing), and its local branch + worktree. The remote branch
// is never touched. Best-effort on git: filesystem store removal always proceeds;
// git failures are reported as warnings, not thrown. The DB row is DELETEd last;
// the FK ON DELETE CASCADE clears its steps/events/clarify/reviews/artifacts.

import { rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

import { projectKey, projectStorePath } from './store.mjs';
import { listArtifacts, readPipelineByKey } from './artifacts.mjs';
import { worcaHome } from './projects.mjs';
import { getDb, tx } from './db.mjs';
import { removeWorktree } from './worktree.mjs';
import { rmGuarded } from './run-manifest.mjs';
import { branchExists } from './git-info.mjs';

// Statuses for which deletion is refused (the entry is or may be live).
const ACTIVE = new Set(['running', 'starting', 'created', 'pausing']);
function err(message, code) { return Object.assign(new Error(message), { code }); }

/**
 * Resolve the pipelines row for a store key + (short id | run-dir basename). Mirrors
 * artifacts.lookupPipelineRow's WHERE logic: exact id first, then the 8-hex id parsed
 * from a run-dir basename. A workspace key ("workspaces/<wk>") filters on workspace_key.
 */
function lookupRow(storeKey, id) {
  const isWs = typeof storeKey === 'string' && storeKey.startsWith('workspaces/');
  const col = isWs ? 'workspace_key' : 'project_key';
  const val = isWs ? storeKey.slice('workspaces/'.length) : storeKey;
  let row = getDb().prepare(`SELECT * FROM pipelines WHERE ${col} = ? AND id = ?`).get(val, id);
  if (row) return row;
  const m = /-([0-9a-f]{8})$/i.exec(String(id));
  if (m) row = getDb().prepare(`SELECT * FROM pipelines WHERE ${col} = ? AND id = ?`).get(val, m[1].toLowerCase());
  return row || null;
}

/**
 * Resolve an indexed artifact's absolute path. The artifacts index encodes scope by
 * convention (recordArtifact / orchestrator._artifact): plans/ and reviews/ are
 * store-root-relative (the shared markdown, a sibling of pipelines/); everything else
 * (prompt.md, manual-tests-checklist.md, webui-review-cycleN.md, extras/*) is
 * pipeline-dir-relative.
 */
function artifactAbsPath(relPath, pipelineDir, storeRootDir) {
  if (isAbsolute(relPath)) return relPath;
  if (relPath.startsWith('plans/') || relPath.startsWith('reviews/')) return join(storeRootDir, relPath);
  return join(pipelineDir, relPath);
}

/**
 * @param {{ projectDir?:string, key?:string, workspaceKey?:string, id:string }} args
 * @returns {Promise<null | { ok, id, pipelineDir, planFiles, reviewFiles, branch, worktree, warnings }>}
 *          null => no pipeline with that id (404). Throws err(code:'RUNNING'|'BAD_REQUEST') for guards.
 *
 * When `workspaceKey` is set the pipeline lives in the workspace store
 * (store/workspaces/<workspaceKey>/); branch/worktree cleanup iterates the
 * per-project `state.branches` map (each entry {feature,worktreeDir} keyed by
 * projectKey) against the matching `state.projects[].projectDir`, instead of the
 * single scalar `state.branch`. The state is reconstructed from the DB row by the
 * same reader history uses. Result warnings[] aggregates per-project failures.
 */
export async function deletePipeline({ projectDir = null, key = null, workspaceKey = null, id } = {}) {
  if (!id || typeof id !== 'string') throw err('id is required', 'BAD_REQUEST');

  // Resolve the store key ONCE so the run dir and the shared plan/review files are
  // always read from the same store root. A workspace pipeline lives under the
  // literal "workspaces/<workspaceKey>" segment (projectStorePath joins it under
  // storeRoot()), so the dir/plan/review resolution below is reused as-is.
  const storeKey = workspaceKey
    ? `workspaces/${workspaceKey}`
    : (key || (projectDir ? projectKey(projectDir) : null));
  if (!storeKey) throw err('projectKey, projectDir or workspaceKey is required', 'BAD_REQUEST');

  const row = lookupRow(storeKey, id);
  if (!row) return null;
  if (ACTIVE.has(String(row.status || '').toLowerCase())) {
    throw err('cannot delete a running pipeline', 'RUNNING');
  }

  // Reconstruct state (branch/branches/projects) via the same reader history uses.
  const { state } = (await readPipelineByKey(storeKey, row.id)) || { state: null };

  // The real on-disk run dir (markdown + extras live here). Resolve by the -<id> suffix.
  const storeRootDir = projectStorePath(storeKey);
  const pipelinesDir = join(storeRootDir, 'pipelines');
  const runDir = await findRunDir(pipelinesDir, row.id);

  const report = {
    ok: true, id: row.id, pipelineDir: runDir,
    planFiles: [], reviewFiles: [], branch: null, worktree: null, runRoot: null, warnings: [],
  };

  // 1) Unlink the EXACT indexed markdown (no baseName-derivation). Pipeline-local
  //    artifacts (prompt/extras/checklist/webui) live INSIDE runDir and are cleared
  //    by the rm(runDir) below; only the shared store-rooted plan/review md need an
  //    explicit unlink here.
  const arts = await listArtifacts(row.id);
  for (const a of arts) {
    const abs = artifactAbsPath(a.relPath, runDir || join(pipelinesDir, row.id), storeRootDir);
    if (!abs || (runDir && abs.startsWith(runDir))) continue; // pipeline-local handled by rm(runDir)
    try {
      if (existsSync(abs)) { await rm(abs, { force: true }); }
      if (a.kind === 'plan') report.planFiles.push(abs);
      else if (a.kind === 'review') report.reviewFiles.push(abs);
    } catch { /* best-effort */ }
  }

  // 2) Local branch(es) + worktree(s) (remote untouched). Best-effort. Reads the
  //    reconstructed state (branch / branches / projects from the row's JSON columns).
  if (workspaceKey || state?.target === 'workspace') {
    // Per-project: iterate state.branches keyed by projectKey, cleaning each
    // member's worktree+branch in its OWN repo (state.projects[].projectDir).
    const branches = state?.branches && typeof state.branches === 'object' ? state.branches : {};
    const projects = Array.isArray(state?.projects) ? state.projects : [];
    const dirByKey = new Map(projects.map((p) => [p.projectKey, p.projectDir]));
    for (const [pk, br] of Object.entries(branches)) {
      const repoDir = dirByKey.get(pk) || null;
      const feature = br?.feature || null;
      const wt = br?.worktreeDir || null;
      if (!repoDir || (!feature && !wt)) continue;
      const liveWt = wt && existsSync(wt) ? wt : null;
      const liveBranch = feature && (await branchExists(repoDir, feature)) ? feature : null;
      if (!liveWt && !liveBranch) continue;
      const res = await removeWorktree({ projectDir: repoDir, worktreeDir: liveWt, branch: liveBranch, force: true });
      for (const stp of res.steps.filter((x) => !x.ok)) {
        report.warnings.push(`${pk}: ${stp.step}: ${stp.stderr || 'failed'}`);
      }
    }
  } else {
    const repoDir = state?.projectDir || projectDir || null;
    const feature = state?.branch?.feature || null;
    const wt = state?.branch?.worktreeDir || null;
    if (repoDir && (feature || wt)) {
      const liveWt = wt && existsSync(wt) ? wt : null;                 // skip already-removed worktrees
      const liveBranch = feature && (await branchExists(repoDir, feature)) ? feature : null; // skip merged/deleted
      if (liveWt || liveBranch) {
        const res = await removeWorktree({ projectDir: repoDir, worktreeDir: liveWt, branch: liveBranch, force: true });
        report.branch = liveBranch;
        report.worktree = liveWt;
        for (const stp of res.steps.filter((x) => !x.ok)) {
          report.warnings.push(`${stp.step}: ${stp.stderr || 'failed'}`);
        }
      }
    }
  }

  // 2b) The detached run root, under the same §8.13 assertions rmGuarded enforces
  //     everywhere (`<worcaHome>/runs/` prefix + basename === pipelineId). Without
  //     this, deleting a paused or interrupted detached run from the UI would leave
  //     the generated CLAUDE.md, mcp.json, run.json, the workspace skill mount and
  //     the emptied repos/ shell on disk permanently — and, because deletion DELETEs
  //     the pipelines row, the boot sweep would then see a row-less run root forever.
  //     A legacy run simply has no such dir, so this is a no-op there.
  const runRoot = join(worcaHome(), 'runs', row.id);
  if (existsSync(runRoot)) {
    const res = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId: row.id });
    if (res.removed) report.runRoot = runRoot;
    else report.warnings.push(`run-root: ${res.reason || 'removal refused'}`);
  }

  // 3) The run folder itself (prompt.md, pipeline.md header, extras/, any
  //    pipeline-local md). Everything else lives inside it.
  if (runDir) await rm(runDir, { recursive: true, force: true });

  // 4) The DB row — FK ON DELETE CASCADE clears steps/events/clarify/reviews/artifacts.
  //    A5: the cascade does every child table in this single DELETE; no nested tx().
  tx(() => { getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(row.id); });

  return report;
}

/** Find the on-disk run dir for an id under pipelinesDir (basename ends in -<id>). */
async function findRunDir(pipelinesDir, id) {
  let entries;
  try { entries = await readdir(pipelinesDir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isDirectory() && new RegExp(`-${id}$`, 'i').test(e.name)) return join(pipelinesDir, e.name);
  // exact-basename match (id passed as the full dir name)
  for (const e of entries) if (e.isDirectory() && e.name === id) return join(pipelinesDir, e.name);
  return null;
}
