// src/core/pipeline-delete.mjs
// ARCHIVE a finished pipeline: reclaim everything that costs disk — its store
// folder, its shared plan/review markdown (resolved EXACTLY via the artifacts
// index, no more baseName guessing), its detached run root, and its local branch
// + worktree — then SOFT-DELETE the DB row by stamping archived_at. The remote
// branch is never touched. Best-effort on git: filesystem store removal always
// proceeds; git failures are reported as warnings, not thrown.
//
// The pipelines row is PERMANENT: it is the run's statistical record (cost,
// duration, status), so it is never DELETEd and no FK ON DELETE CASCADE fires.
// Its steps/events/clarify/reviews children stay for the same reason. The only
// child rows removed are `artifacts` — that index points at the exact files this
// function just unlinked, so leaving it would strand dead pointers.
// List and count reads filter on `archived_at IS NULL`; by-id reads still resolve.

import { rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

import { projectKey, projectStorePath } from './store.mjs';
import {
  listArtifacts, readPipelineByKey, persistPrState, retainedWorkFor, writeState,
  recordArtifact, appendAudit,
} from './artifacts.mjs';
import { worcaHome } from './projects.mjs';
import { getDb, tx } from './db.mjs';
import { removeWorktree, snapshotWorktreePatch } from './worktree.mjs';
import {
  rmGuarded, readRunManifest, rescueModifiedMounts, scanStrayEntries, copyRunManifestTo,
} from './run-manifest.mjs';
import { branchExists, hasGh, findPrForBranch } from './git-info.mjs';

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
 * @returns {Promise<null | { ok, id, archived, pipelineDir, planFiles, reviewFiles, branch, worktree, warnings }
 *                        | { ok, id, alreadyArchived, warnings }>}
 *          null => no pipeline with that id (404). Throws err(code:'RUNNING'|'BAD_REQUEST') for guards.
 *          An already-archived row short-circuits to { alreadyArchived: true } — the FS was
 *          reclaimed by the first call, so a second pass has nothing to do (idempotent).
 *
 * When `workspaceKey` is set the pipeline lives in the workspace store
 * (store/workspaces/<workspaceKey>/); branch/worktree cleanup iterates the
 * per-project `state.branches` map (each entry {feature,worktreeDir} keyed by
 * projectKey) against the matching `state.projects[].projectDir`, instead of the
 * single scalar `state.branch`. The state is reconstructed from the DB row by the
 * same reader history uses. Result warnings[] aggregates per-project failures.
 */
export async function archivePipeline({ projectDir = null, key = null, workspaceKey = null, id } = {}) {
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
  // Idempotent: the first archive already reclaimed the FS. Re-running the unlink /
  // worktree / rm passes would only produce noise (and warnings) over gone paths.
  if (row.archived_at) {
    return { ok: true, id: row.id, alreadyArchived: true, warnings: [] };
  }
  // UI state is advisory. Enforce the no-data-loss rule here as well, because a
  // stale client or a direct API caller could otherwise force-remove the very
  // checkout that was retained after its commit failed.
  if (retainedWorkFor(row)) {
    throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
  }

  // Reconstruct state (branch/branches/projects) via the same reader history uses.
  const { state } = (await readPipelineByKey(storeKey, row.id)) || { state: null };

  // The real on-disk run dir (markdown + extras live here). Resolve by the -<id> suffix.
  const storeRootDir = projectStorePath(storeKey);
  const pipelinesDir = join(storeRootDir, 'pipelines');
  const runDir = await findRunDir(pipelinesDir, row.id);

  const report = {
    ok: true, id: row.id, archived: true, pipelineDir: runDir,
    planFiles: [], reviewFiles: [], branch: null, worktree: null, runRoot: null, warnings: [],
  };

  // Final PR observation while the branch still exists (spec §6.8.3). Single-
  // project runs only: workspace rows carry a branches MAP (state.branches) —
  // their per-project PR facts are left to prior enrichment passes (accepted
  // limitation). A merge after archive is never observed — also accepted.
  try {
    const branch = state?.branch?.feature;
    if (branch && state?.projectDir && await hasGh()) {
      const pr = await findPrForBranch({ projectDir: state.projectDir, head: branch });
      if (pr) persistPrState(row.id, pr);
    }
  } catch (e) {
    // Named `e`, not `err`: `err` is this module's error-factory helper and a catch
    // parameter would shadow it for the whole block.
    report.warnings.push(`pr refresh failed: ${e?.message || e}`);
  }

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
  //     this, archiving a paused or interrupted detached run from the UI would leave
  //     the generated CLAUDE.md, mcp.json, run.json, the workspace skill mount and
  //     the emptied repos/ shell on disk permanently. Archiving KEEPS the pipelines
  //     row, so the boot sweep can still resolve this id — but the run root is gone
  //     and unreclaimable-by-id later, so it must be removed here, not deferred.
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

  // 4) Soft delete: the run's statistical record is permanent (spec §6.7). The
  //    FS was reclaimed above; the row now only carries history. The artifacts
  //    INDEX rows are deleted explicitly — their files were just unlinked, and
  //    the CASCADE that used to clear them no longer fires (no row DELETE).
  //    pipeline_steps and the other children stay: stats fallback sums need them.
  tx(() => {
    getDb().prepare('DELETE FROM artifacts WHERE pipeline_id = ?').run(row.id);
    getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.id);
  });

  return report;
}

/**
 * Explicitly reclaim worktrees retained after a teardown commit failure while
 * preserving the pipeline row and artifact directory. Every live checkout is
 * snapshotted first; any snapshot failure aborts before removal.
 */
export async function discardRetainedWorktrees({ projectDir = null, key = null, workspaceKey = null, id } = {}) {
  if (!id || typeof id !== 'string') throw err('id is required', 'BAD_REQUEST');
  const storeKey = workspaceKey
    ? `workspaces/${workspaceKey}`
    : (key || (projectDir ? projectKey(projectDir) : null));
  if (!storeKey) throw err('projectKey, projectDir or workspaceKey is required', 'BAD_REQUEST');

  const row = lookupRow(storeKey, id);
  if (!row) return null;
  if (ACTIVE.has(String(row.status || '').toLowerCase())) {
    throw err('cannot discard a running pipeline worktree', 'RUNNING');
  }
  const retained = retainedWorkFor(row);
  if (!retained) {
    return { ok: true, id: row.id, discarded: false, worktrees: [], patches: [], runRoot: null, warnings: [] };
  }

  const { state } = (await readPipelineByKey(storeKey, row.id)) || { state: null };
  if (!state) throw err('pipeline state is unavailable', 'BAD_REQUEST');
  const storeRootDir = projectStorePath(storeKey);
  const runDir = await findRunDir(join(storeRootDir, 'pipelines'), row.id);
  if (!runDir) {
    throw err('cannot discard retained work: the pipeline directory needed for the recovery patch is missing', 'SNAPSHOT_FAILED');
  }

  const projects = Array.isArray(state.projects) ? state.projects : [];
  const dirByKey = new Map(projects.map((p) => [p.projectKey, p.projectDir]));
  const targets = retained.members.map((member) => ({
    ...member,
    projectDir: state.target === 'workspace'
      ? (dirByKey.get(member.projectKey) || null)
      : (state.projectDir || projectDir || null),
  }));
  if (targets.some((t) => !t.projectDir)) {
    throw err('cannot discard retained work: a member repository could not be resolved', 'SNAPSHOT_FAILED');
  }

  // Snapshot ALL members before deleting ANY member. This prevents a later
  // snapshot failure from leaving a half-discarded workspace.
  const snapshots = [];
  for (const target of targets) {
    const snap = await snapshotWorktreePatch(target.worktreeDir);
    if (!snap.ok) {
      throw err(
        `cannot save recovery patch for ${target.projectKey || target.worktreeDir}: git ${snap.step} failed: ${snap.message}`,
        'SNAPSHOT_FAILED',
      );
    }
    snapshots.push({ target, patch: snap.patch });
  }

  await mkdir(runDir, { recursive: true });
  const patches = [];
  for (const { target, patch } of snapshots) {
    const suffix = state.target === 'workspace'
      ? `-${String(target.projectKey || 'member').replace(/[^a-zA-Z0-9._-]+/g, '-')}`
      : '';
    const name = `retained-work${suffix}.patch`;
    const file = join(runDir, name);
    await writeFile(file, patch, 'utf8');
    recordArtifact(row.id, 'retained-work-patch', name);
    patches.push(file);
  }

  const report = {
    ok: true, id: row.id, discarded: true, worktrees: [], patches,
    runRoot: null, warnings: [],
  };
  const runRoot = join(worcaHome(), 'runs', row.id);
  if (existsSync(runRoot)) {
    const manifest = await readRunManifest(runRoot);
    for (const [scope, entries] of Object.entries(manifest?.injectedPaths || {})) {
      const baseDir = scope === 'runRoot'
        ? runRoot
        : targets.find((t) => t.projectKey === scope)?.worktreeDir || join(runRoot, 'repos', scope);
      const warnings = await rescueModifiedMounts({
        baseDir, entries, pipelineDir: runDir, scope, pipelineId: row.id,
      });
      report.warnings.push(...warnings);
    }
    report.warnings.push(...await scanStrayEntries({ runRoot, pipelineDir: runDir }));
    await copyRunManifestTo(runRoot, runDir);
  }

  for (const target of targets) {
    const result = await removeWorktree({
      projectDir: target.projectDir, worktreeDir: target.worktreeDir, branch: null, force: true,
    });
    for (const step of result.steps.filter((s) => !s.ok)) {
      report.warnings.push(`${target.projectKey || 'project'}: ${step.step}: ${step.stderr || 'failed'}`);
    }
    if (!existsSync(target.worktreeDir)) {
      report.worktrees.push(target.worktreeDir);
      const branchRecord = state.target === 'workspace'
        ? state.branches?.[target.projectKey]
        : state.branch;
      if (branchRecord) {
        delete branchRecord.commitFailed;
        branchRecord.worktreeRemoved = true;
        branchRecord.branchKept = true;
      }
    } else {
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
  }

  await writeState(runDir, state);
  if (existsSync(runRoot) && !retainedWorkFor(state)) {
    const removal = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId: row.id });
    if (removal.removed) report.runRoot = runRoot;
    else report.warnings.push(`run-root: ${removal.reason || 'removal refused'}`);
  }
  await appendAudit(runDir,
    `Discarded ${report.worktrees.length} retained worktree(s) after saving recovery patch(es): ` +
    patches.map((p) => `\`${p}\``).join(', ')).catch(() => {});
  return report;
}

// Compat alias. The server now calls `archivePipeline` directly; this name is
// kept for the pre-existing suites (test/pipeline-delete.test.mjs,
// test/persist-roundtrip.test.mjs) that assert the FS/branch reclamation half
// under the old name — which archive still performs in full.
export { archivePipeline as deletePipeline };

/** Find the on-disk run dir for an id under pipelinesDir (basename ends in -<id>). */
async function findRunDir(pipelinesDir, id) {
  let entries;
  try { entries = await readdir(pipelinesDir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isDirectory() && new RegExp(`-${id}$`, 'i').test(e.name)) return join(pipelinesDir, e.name);
  // exact-basename match (id passed as the full dir name)
  for (const e of entries) if (e.isDirectory() && e.name === id) return join(pipelinesDir, e.name);
  return null;
}
