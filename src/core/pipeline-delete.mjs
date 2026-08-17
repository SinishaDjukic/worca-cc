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

import { rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

import { projectKey, projectStorePath } from './store.mjs';
import {
  listArtifacts, readPipelineByKey, persistPrState, retainedWorkFor,
  recordArtifact, appendAudit, findRunDir,
} from './artifacts.mjs';
import { worcaHome } from './projects.mjs';
import { getDb, tx } from './db.mjs';
import { removeWorktree, snapshotWorktreePatch } from './worktree.mjs';
import {
  rmGuarded, readRunManifest, rescueModifiedMounts, scanStrayEntries, copyRunManifestTo,
} from './run-manifest.mjs';
import { branchExists, hasGh, findPrForBranch } from './git-info.mjs';
import { retainedWorkPatchName } from './results.mjs';

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
  // The run root is the one thing archive destroys that can still hold retained
  // checkouts (detached members live at runs/<id>/repos/<key>). Resolve it ONCE,
  // here, for the guards below AND the 2b) removal further down.
  const runRoot = join(worcaHome(), 'runs', row.id);
  // Fail CLOSED on unreadable retention metadata — but ONLY while the run root
  // still exists. With it gone, archive's per-member cleanup is already a no-op
  // for an unparseable column (rowToState yields branches:{} / a null branch), so
  // refusing forever would only wedge the row: discard cannot clear it
  // (retainedWorkFor returns null) and the UI hides the Discard button. Naming
  // the path keeps the refusal hand-clearable.
  const unreadable = (col) => {
    if (typeof col !== 'string' || !col.trim()) return false;
    // A JSON *string* branch ("worca/foo") is a SUPPORTED legacy shape
    // (rowToHistoryEntry reads it) — it carries no retention, so it is readable.
    try { const p = JSON.parse(col); return p === null || (typeof p !== 'object' && typeof p !== 'string'); }
    catch { return true; }
  };
  const metaUnreadable = row.target === 'workspace' ? unreadable(row.workspace_meta) : unreadable(row.branch);
  if (metaUnreadable && existsSync(runRoot)) {
    throw err(
      `cannot archive: retention metadata is unreadable, so retained uncommitted work inside ${runRoot} cannot be ruled out — inspect and remove that run root, then archive again`,
      'RETAINED_WORKTREE',
    );
  }
  // The DB stamp is teardown's LAST best-effort write; the run.json retain block
  // is written earlier. Trust either representation (the sweep already does).
  if (existsSync(runRoot)) {
    const guardManifest = await readRunManifest(runRoot);
    const members = Array.isArray(guardManifest?.retain?.members) ? guardManifest.retain.members : [];
    if (members.some((m) => m?.worktreeDir && existsSync(m.worktreeDir))) {
      throw err('cannot archive while retained uncommitted work exists; recover it or discard the worktree first', 'RETAINED_WORKTREE');
    }
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
  if (metaUnreadable) {
    report.warnings.push('retention metadata was unreadable; per-member branch/worktree cleanup was skipped');
  }

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
  const runRoot = join(worcaHome(), 'runs', row.id);
  let retained = retainedWorkFor(row);
  if (!retained && existsSync(runRoot)) {
    // The DB stamp is teardown's LAST best-effort write and can be lost (F2's
    // crash window). The run.json retain ledger is written earlier — honor it so
    // manifest-only retention is still discardable instead of a permanent wedge
    // (archive refuses it; this is the only exit). existsSync keeps it
    // self-clearing, same contract as retainedWorkFor.
    const manifest = await readRunManifest(runRoot);
    const live = (Array.isArray(manifest?.retain?.members) ? manifest.retain.members : [])
      .filter((m) => m?.worktreeDir && existsSync(m.worktreeDir));
    if (live.length) retained = { reason: manifest.retain.reason || 'unknown', members: live };
  }
  if (!retained) {
    return { ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches: [], runRoot: null, warnings: [] };
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

  // Snapshot ALL members before deleting ANY member, straight to their final
  // files. This prevents a later snapshot failure from leaving a half-discarded
  // workspace, without ever holding a whole patch in memory.
  await mkdir(runDir, { recursive: true });
  const patches = [];
  for (const target of targets) {
    const name = retainedWorkPatchName(state.target === 'workspace' ? (target.projectKey || 'member') : null);
    const snap = await snapshotWorktreePatch(target.worktreeDir, join(runDir, name));
    if (!snap.ok) {
      throw err(
        `cannot save recovery patch for ${target.projectKey || target.worktreeDir}: git ${snap.step} failed: ${snap.message}`,
        'SNAPSHOT_FAILED',
      );
    }
    if (snap.file) { // a clean tree yields no patch — nothing to record
      recordArtifact(row.id, 'retained-work-patch', name);
      patches.push(snap.file);
    }
  }

  const report = {
    ok: true, id: row.id, discarded: false, remaining: 0, worktrees: [], patches,
    runRoot: null, warnings: [],
  };
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

  const clearedKeys = [];
  for (const target of targets) {
    const result = await removeWorktree({
      projectDir: target.projectDir, worktreeDir: target.worktreeDir, branch: null, force: true,
    });
    for (const step of result.steps.filter((s) => !s.ok)) {
      report.warnings.push(`${target.projectKey || 'project'}: ${step.step}: ${step.stderr || 'failed'}`);
    }
    if (!existsSync(target.worktreeDir)) {
      report.worktrees.push(target.worktreeDir);
      clearedKeys.push(target.projectKey ?? null);
    } else {
      report.remaining += 1;
      report.warnings.push(`${target.projectKey || 'project'}: worktree still exists at ${target.worktreeDir}`);
    }
  }
  report.discarded = report.remaining === 0;

  // Targeted update: clear ONLY the retention stamps. A full writeState would
  // restamp updated_at (the stats terminal-write proxy), NULL resume_point, and
  // rewrite pipeline_steps — none of which a checkout reclaim may touch.
  if (clearedKeys.length) {
    const parse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
    const clear = (br) => { delete br.commitFailed; br.worktreeRemoved = true; br.branchKept = true; };
    tx(() => {
      const fresh = getDb().prepare('SELECT branch, workspace_meta FROM pipelines WHERE id = ?').get(row.id);
      if (state.target === 'workspace') {
        const wm = typeof fresh?.workspace_meta === 'string' ? parse(fresh.workspace_meta) : fresh?.workspace_meta;
        // NEVER write a rebuilt {} here: workspace_meta carries the whole §5.2
        // superset (projects/projectKeys/checkpointRefs/runRootMode). Unreadable
        // or branch-less meta is reported, not overwritten.
        if (!wm || typeof wm !== 'object' || !wm.branches || typeof wm.branches !== 'object') {
          // A NULL column is the manifest-only case (Task 11) — nothing to clear,
          // nothing to warn about. Warn only when a non-null column is corrupt.
          if (fresh?.workspace_meta != null) {
            report.warnings.push('retention stamp not cleared: workspace metadata is unreadable');
          }
          return;
        }
        let touched = false;
        for (const k of clearedKeys) { const br = wm.branches[k]; if (br) { clear(br); touched = true; } }
        if (touched) {
          getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?')
            .run(JSON.stringify(wm), row.id);
        }
      } else {
        const br = typeof fresh?.branch === 'string' ? parse(fresh.branch) : fresh?.branch;
        if (!br || typeof br !== 'object') {
          if (fresh?.branch != null) { // NULL column = manifest-only discard: silent skip
            report.warnings.push('retention stamp not cleared: branch metadata is unreadable');
          }
          return;
        }
        clear(br);
        getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(br), row.id);
      }
    });
  }
  if (existsSync(runRoot) && report.remaining === 0) {
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
