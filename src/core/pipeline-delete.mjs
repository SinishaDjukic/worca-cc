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
  listArtifacts, readPipelineByKey, persistPrState, retainedWorkFor, checkoutRecordsFor, branchRecordsOf,
  recordArtifact, appendAudit, appendAuditById, findRunDir, readMemberPrStates, persistMemberPrState, folderApplyRetainFor,
  execEnvOfRow,
} from './artifacts.mjs';
import { workspaceMembers } from './workspace-prs.mjs';
import { worcaHome } from './projects.mjs';
import { getDb, tx } from './db.mjs';
import { removeWorktree, snapshotWorktreePatch, commitStagedWork, commitOf, indexTracks } from './worktree.mjs';
import { fastForwardTo } from './git-sync.mjs';
import { updateBranchRecords, withRunLock } from './checkout.mjs';
import { MEMORY_RULES_REL } from './memory-sync.mjs';
import { staleGitLockNote } from './git-lock.mjs';
import {
  rmGuarded, readRunManifest, updateRunManifest, rescueModifiedMounts, scanStrayEntries, copyRunManifestTo, RETAIN_REASONS,
} from './run-manifest.mjs';
import { branchExists, anyPrHost, findPrForBranch } from './git-info.mjs';
import { retainedWorkPatchName } from './results.mjs';
import { deleteCommentsForRun } from './diff-comments.mjs';
import { byActor } from './identity.mjs';
import { workModeOfRow } from './project-kind.mjs';
import { writeChangesRecordInTx } from './folder-apply.mjs';
import { removeRunSessions } from './engines/index.mjs';

/**
 * Final PR observation while the branches still exist (spec §6.8.3). A workspace run
 * is observed PER MEMBER into pipeline_member_prs (whose write refreshes the row's
 * pr_* rollup) — never through persistPrState with the primary member's branch,
 * which would let the row and the member table diverge. Exported for tests.
 */
export async function refreshFinalPrs(row, state) {
  if (state?.target === 'workspace') {
    const members = workspaceMembers(state).filter((m) => m.projectDir && m.feature);
    if (members.length && (await anyPrHost())) {
      const known = readMemberPrStates(row.id);
      for (const m of members) {
        const pr = await findPrForBranch({ projectDir: m.projectDir, head: m.feature, prUrl: known[m.memberKey]?.url || null });
        if (pr) persistMemberPrState(row.id, m.memberKey, pr);
      }
      return;
    }
    if (members.length) return;                 // members known but no gh: nothing to observe
    // A legacy workspace row with no member facts falls through to the primary-only arm (today's behaviour).
  }
  const branch = state?.branch?.feature;
  if (branch && state?.projectDir && await anyPrHost()) {   // unchanged condition order
    const pr = await findPrForBranch({ projectDir: state.projectDir, head: branch, prUrl: row.pr_url || null });
    if (pr) persistPrState(row.id, pr);
  }
}

// Statuses for which deletion is refused (the entry is or may be live).
// Run on the source branch (branch.sameAsSource): archive never `git branch -D`s
//  (a) a same-branch run's own source, whatever its record says (D1: its `feature` is its hidden branch), nor
//  (b) a branch ANOTHER live (non-archived) same-branch run in the same project committed onto — a chain
//      after a normal run, or a "Run branches" source pick: after its merge back that run's work lives ONLY there.
const keepsSource = (br, name) => !!br && br.sameAsSource === true && name === br.source;
// ponytail: a LIKE prefilter + JS check per archive; index a sameAsSource column if archives ever get hot.
function heldBySameSourceRun(rowId, pk, name) {
  const rows = getDb().prepare(`SELECT id, target, project_key, branch, workspace_meta FROM pipelines
    WHERE archived_at IS NULL AND id != ? AND (branch LIKE '%sameAsSource%' OR workspace_meta LIKE '%sameAsSource%')`).all(rowId);
  const holder = rows.find((r) => branchRecordsOf(r).some(([k, b]) => k === pk && keepsSource(b, name)));
  return holder ? holder.id : null;
}

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
  // Rows are indexed with '/' (see _recordArtifact); rows written by earlier
  // Windows builds carry '\\' — normalise before the layout check so those
  // shared plan/review files are still re-rooted (and unlinked) correctly.
  const rel = relPath.replace(/\\/g, '/');
  if (rel.startsWith('plans/') || rel.startsWith('reviews/')) return join(storeRootDir, rel);
  return join(pipelineDir, rel);
}

/** P5: archivePipeline refuses this row for retained work — the DB records, or run.json's retain block (written before
 *  teardown's last-chance DB stamp). The DELETE route closes a run's terminals only when the archive will go ahead. */
export async function archiveKeepsWork(row) {
  if (!row) return false;
  if (retainedWorkFor(row) || checkoutRecordsFor(row)) return true;
  const runRoot = join(worcaHome(), 'runs', row.id);
  if (!existsSync(runRoot)) return false;
  const members = (await readRunManifest(runRoot))?.retain?.members;
  return Array.isArray(members) && members.some((m) => m?.worktreeDir && existsSync(m.worktreeDir));
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
export async function archivePipeline({ projectDir = null, key = null, workspaceKey = null, id, by = null } = {}) {
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
  if (checkoutRecordsFor(row)) throw err('cannot archive while the run is checked out; discard the checkout first', 'RETAINED_WORKTREE');
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
      if (guardManifest.retain.reason === RETAIN_REASONS.CHECKOUT) {
        throw err('cannot archive while the run is checked out; discard the checkout first', 'RETAINED_WORKTREE');
      }
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

  // Final PR observation (spec §6.8.3); workspace runs per member — see refreshFinalPrs.
  // A merge after archive is never observed — accepted.
  try {
    await refreshFinalPrs(row, state);
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
      const heldBy = feature && !keepsSource(br, feature) ? heldBySameSourceRun(row.id, pk, feature) : null;
      if (heldBy) report.warnings.push(`${pk}: kept ${feature}: run ${heldBy} committed onto it (run on the source branch)`);
      const liveBranch = feature && !keepsSource(br, feature) && !heldBy && (await branchExists(repoDir, feature)) ? feature : null;
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
      const heldBy = feature && !keepsSource(state?.branch, feature) ? heldBySameSourceRun(row.id, row.project_key, feature) : null;
      if (heldBy) report.warnings.push(`kept ${feature}: run ${heldBy} committed onto it (run on the source branch)`);
      const liveBranch = feature && !keepsSource(state?.branch, feature) && !heldBy && (await branchExists(repoDir, feature)) ? feature : null; // skip merged/deleted
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

  // 2c) The run's engine sessions (the catalog's `sessions`): its steps' Claude Code transcripts, codex rollouts,
  //     Copilot session state and Cursor chats. Only the ids this run stored; never a sign-in file. A removal that
  //     fails is a warning: the archive goes on.
  try {
    const sessionIds = getDb().prepare('SELECT DISTINCT session_id FROM pipeline_steps WHERE pipeline_id = ? AND session_id IS NOT NULL')
      .all(row.id).map((r) => r.session_id);
    for (const r of await removeRunSessions({ sessionIds })) report.warnings.push(...r.warnings);
  } catch (e) { report.warnings.push(`engine sessions: ${e?.message || e}`); }

  // 3) The run folder itself (prompt.md, pipeline.md header, extras/, any
  //    pipeline-local md). Everything else lives inside it.
  if (runDir) await rm(runDir, { recursive: true, force: true });

  // 4) Soft delete: the run's statistical record is permanent (spec §6.7). The
  //    FS was reclaimed above; the row now only carries history. The artifacts
  //    INDEX rows are deleted explicitly — their files were just unlinked, and
  //    the CASCADE that used to clear them no longer fires (no row DELETE).
  //    pipeline_steps and the other children stay: stats fallback sums need them.
  // P1 (P1b S17, P5 S8): archiving a PENDING Folder run is Discard + archive — its copy went with the run root above,
  // the folder is never touched. The audit lands after the tx: appendAuditById opens its own tx(), and a nested one
  // throws (swallowed), so inside this tx it would silently never land.
  const folderDiscarded = [];
  tx(() => {
    if (row.target === 'workspace') {
      // P5: every pending Folder member (workspace_meta.projects[i].workMode), whatever the run's own mode
      const wm = parseJson(getDb().prepare('SELECT workspace_meta FROM pipelines WHERE id = ?').get(row.id)?.workspace_meta);
      const discardedAt = new Date().toISOString();
      for (const p of Array.isArray(wm?.projects) ? wm.projects : []) {
        const rec = p?.workMode === 'folder' ? wm.branches?.[p.projectKey] : null;
        if (rec?.changes?.state !== 'pending') continue;
        writeChangesRecordInTx(row.id, { state: 'discarded', discardedAt }, { memberKey: p.projectKey });
        folderDiscarded.push(rec.realDir || p.projectDir || '');
      }
    } else if (workModeOfRow(row) === 'folder') {
      const cur = parseJson(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(row.id)?.branch);
      if (cur?.changes?.state === 'pending') {
        getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?')
          .run(JSON.stringify({ ...cur, changes: { ...cur.changes, state: 'discarded', discardedAt: new Date().toISOString() } }), row.id);
        folderDiscarded.push(cur.realDir || state?.projectDir || '');
      }
    }
    getDb().prepare('DELETE FROM artifacts WHERE pipeline_id = ?').run(row.id);
    // The run dir (and with it diff-patch.patch) was just removed, so nothing could
    // re-anchor these comments and creation is refused from here on. They die with
    // the artifacts index rather than lingering as unreachable rows — the declared
    // pipelines cascade cannot do it, because the pipelines row is never DELETEd
    // (see this file's header).
    deleteCommentsForRun(row.id);
    getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.id);
  });
  for (const dir of folderDiscarded) appendAuditById(row.id, `Discarded the run's changes (archived)${byActor(by)}; \`${dir}\` was not touched.`, { actor: by });

  return report;
}

/**
 * The inverse of archivePipeline: clear a soft-deleted row's `archived_at` so the run
 * is listed (and chain-gated) again. Nothing on disk comes back — the archive contract
 * reclaimed the run dir, the branch and the artifacts, so a restored run is a read-only
 * record with a working PR link and its audit timeline — never resumable (its resume
 * point is cleared; a paused row comes back interrupted). Mirrors the archive preamble
 * (same store-key resolution, same lookupRow, same guards) so the two routes stay
 * symmetrical.
 * @param {{ projectDir?:string, key?:string, workspaceKey?:string, id:string }} args
 * @returns {Promise<null | { ok, id, restored, warnings } | { ok, id, alreadyActive, warnings }>}
 *          null => no pipeline with that id (404). Throws err(code:'RUNNING') for the
 *          defensive active-status guard (an archived run cannot be live, so this only
 *          fires on a corrupt row — the HTTP route refuses live runs earlier anyway).
 *          An active (never-archived, or already restored) row short-circuits to
 *          { alreadyActive: true } — idempotent, like archive's alreadyArchived.
 */
export async function restorePipeline({ projectDir = null, key = null, workspaceKey = null, id } = {}) {
  if (!id || typeof id !== 'string') throw err('id is required', 'BAD_REQUEST');

  const storeKey = workspaceKey
    ? `workspaces/${workspaceKey}`
    : (key || (projectDir ? projectKey(projectDir) : null));
  if (!storeKey) throw err('projectKey, projectDir or workspaceKey is required', 'BAD_REQUEST');

  const row = lookupRow(storeKey, id);
  if (!row) return null;
  if (ACTIVE.has(String(row.status || '').toLowerCase())) {
    throw err('cannot restore a running pipeline', 'RUNNING');
  }
  if (row.deleted_at) throw err('pipeline was deleted', 'DELETED');
  if (!row.archived_at) {
    return { ok: true, id: row.id, alreadyActive: true, warnings: [] };
  }
  // Archive reclaimed the run dir a resume runs out of, so the resume point is dead
  // weight: drop it, and a PAUSED row becomes interrupted (the db.mjs v2-upgrade idiom;
  // Statistics buckets the two together). Left paused it would sit in Needs you for
  // good, offering a Resume that can only fail.
  const wasPaused = String(row.status || '').toLowerCase() === 'paused';
  tx(() => {
    getDb().prepare(`UPDATE pipelines SET archived_at = NULL, resume_point = NULL${wasPaused ? ", status = 'interrupted'" : ''} WHERE id = ?`).run(row.id);
  });
  return { ok: true, id: row.id, restored: true, ...(wasPaused ? { wasPaused: true } : {}), warnings: [] };
}

/** The retained members, each with its repository: a workspace member's from state.projects, else the run's. */
function retainedTargets(state, retained, projectDir = null) {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const dirByKey = new Map(projects.map((p) => [p.projectKey, p.projectDir]));
  return retained.members.map((member) => ({
    ...member,
    projectDir: state.target === 'workspace'
      ? (dirByKey.get(member.projectKey) || null)
      : (state.projectDir || projectDir || null),
  }));
}

/**
 * The release half shared by Discard worktree and Apply to branch. It does four things in order:
 *   - rescues edited mounts and stray files out of the run root and copies its run.json (while it exists);
 *   - removes each target's worktree, plus `target.dropBranch`: the hidden branch of a run merged back into its source;
 *   - stamps each removed member's record through `stamp(br, projectKey)` in ONE targeted UPDATE;
 *   - removes the run root once nothing is retained (`report.remaining === 0`).
 * It fills `report.worktrees`, `report.remaining`, `report.warnings` and `report.runRoot` in place.
 */
async function releaseRetainedTargets({ row, state, targets, runDir, report, stamp }) {
  const runRoot = join(worcaHome(), 'runs', row.id);
  if (existsSync(runRoot) && runDir) {
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
      projectDir: target.projectDir, worktreeDir: target.worktreeDir, branch: target.dropBranch || null, force: true,
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

  // Targeted update: stamp ONLY the released members. A full writeState would
  // restamp updated_at (the stats terminal-write proxy), NULL resume_point, and
  // rewrite pipeline_steps — none of which a checkout reclaim may touch.
  if (clearedKeys.length) {
    const parse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
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
        for (const k of clearedKeys) { const br = wm.branches[k]; if (br) { stamp(br, k); touched = true; } }
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
        stamp(br, clearedKeys[0]);
        getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(br), row.id);
      }
    });
  }
  // The run root goes only once nothing is retained AND the rescue above ran. Discard refuses a missing
  // pipeline directory before getting here; Apply tolerates one, so it keeps the run root and says why.
  // P5: a mixed workspace's pending Folder member lives in the same run root: keep it until that member is applied or discarded
  const folderPending = !!folderApplyRetainFor(row);
  if (existsSync(runRoot) && report.remaining === 0 && runDir && !folderPending) {
    const removal = await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId: row.id });
    if (removal.removed) report.runRoot = runRoot;
    else report.warnings.push(`run-root: ${removal.reason || 'removal refused'}`);
  } else if (existsSync(runRoot) && report.remaining === 0 && !folderPending) {
    report.warnings.push('run-root kept: the pipeline directory to rescue it into is missing');
  }
}

/**
 * Explicitly reclaim worktrees retained after a teardown commit failure while
 * preserving the pipeline row and artifact directory. Every live checkout is
 * snapshotted first; any snapshot failure aborts before removal.
 */
export async function discardRetainedWorktrees({ projectDir = null, key = null, workspaceKey = null, id, by = null } = {}) {
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

  const targets = retainedTargets(state, retained, projectDir);
  if (targets.some((t) => !t.projectDir)) {
    throw err('cannot discard retained work: a member repository could not be resolved', 'SNAPSHOT_FAILED');
  }

  // Snapshot ALL members before deleting ANY member, straight to their final
  // files. This prevents a later snapshot failure from leaving a half-discarded
  // workspace, without ever holding a whole patch in memory.
  await mkdir(runDir, { recursive: true });
  const patches = [];
  const lockNotes = [];
  for (const target of targets) {
    const name = retainedWorkPatchName(state.target === 'workspace' ? (target.projectKey || 'member') : null);
    const snap = await snapshotWorktreePatch(target.worktreeDir, join(runDir, name));
    for (const lock of snap.clearedLocks || []) lockNotes.push(staleGitLockNote(lock));
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
    runRoot: null, warnings: lockNotes,
  };
  await releaseRetainedTargets({ row, state, targets, runDir, report,
    stamp: (br) => { delete br.commitFailed; br.worktreeRemoved = true; br.branchKept = true; } });
  report.discarded = report.remaining === 0;
  await appendAudit(runDir,
    `Discarded ${report.worktrees.length} retained worktree(s)${byActor(by)} after saving recovery patch(es): ` +
    patches.map((p) => `\`${p}\``).join(', '), { actor: by }).catch(() => {});
  return report;
}

/** JSON column or already-parsed value → object, else null. */
const parseJson = (t) => {
  if (t && typeof t === 'object') return t;
  try { return JSON.parse(t); } catch { return null; }
};

/**
 * The merge back teardown would have done (run-harness `_mergeBack`) for a run on its source branch whose
 * retained work was just committed: fast-forward the source to the hidden branch, only for a run that
 * ended `done`. Returns the record to store on `branch.mergeBack`. Never throws.
 */
async function finishMergeBack({ row, projectDir, br, branch }) {
  const at = new Date().toISOString();
  const notMerged = (kind, reason, paths = null) => ({ merged: false, kind, reason, at,
    ...(Array.isArray(paths) && paths.length ? { paths } : {}) });
  if (row.status !== 'done') return notMerged('not-done', `the run ended ${row.status || 'early'}`);
  try {
    const to = await commitOf(projectDir, `refs/heads/${branch}`);
    if (!to) return notMerged('failed', `could not read ${branch}`);
    const r = await fastForwardTo(projectDir, { base: br.source, to, message: `worca: fast-forward ${br.source} to run ${row.id}` });
    if (!r.ok) return notMerged(r.kind, r.error, r.paths);
    return { merged: true, sha: r.to, commits: r.commits, at };
  } catch (e) {
    return notMerged('failed', e?.message || String(e));
  }
}

/**
 * Apply to branch (the summary card's worktree notice). It retries the end-of-run commit that failed in each
 * retained worktree (worktree.mjs commitStagedWork: the teardown commit, its hook bypass for detached runs
 * only). Then it does what teardown does after a good commit:
 *   - records the commit;
 *   - finishes the merge back of a run on its source branch;
 *   - releases the worktree, and the run root once nothing is retained, through Discard's own tail.
 * A member whose commit fails again keeps its worktree and its stamp, refreshed with git's new message.
 * results.json is not touched: its counts were frozen before teardown and already include this work.
 * The work runs under the run lock (checkout.mjs), so it never races a Check out, a Discard of the checkout,
 * an Update branch or a Discard worktree (its route takes the same lock, Task 4). The post-run base check
 * runs after the lock is released.
 * @returns {Promise<null | { ok, id, applied:[{projectKey, branch, sha, committed, hooksBypassed, mergeBack?}],
 *   failed:[{projectKey, branch, step, message}], remaining, worktrees, runRoot, warnings }>}
 *   null => no pipeline with that id (404). Throws err(code: 'BAD_REQUEST'|'RUNNING').
 */
export async function applyRetainedWork({ projectDir = null, key = null, workspaceKey = null, id, by = null } = {}) {
  if (!id || typeof id !== 'string') throw err('id is required', 'BAD_REQUEST');
  const storeKey = workspaceKey
    ? `workspaces/${workspaceKey}`
    : (key || (projectDir ? projectKey(projectDir) : null));
  if (!storeKey) throw err('projectKey, projectDir or workspaceKey is required', 'BAD_REQUEST');
  const found = lookupRow(storeKey, id);
  if (!found) return null;
  const report = await withRunLock(found.id, () => applyRetainedUnderLock({ storeKey, id: found.id, projectDir, by }));
  if (report && report.applied.length) {
    // Teardown's post-run base check (D9) on the branch's new tip, outside the lock (it may fetch). Lazy import, as the harness does.
    const { afterRunBaseCheck } = await import('./base-conflicts.mjs');
    await afterRunBaseCheck(report.id).catch(() => {});
  }
  return report;
}

async function applyRetainedUnderLock({ storeKey, id, projectDir, by }) {
  const row = lookupRow(storeKey, id);          // re-read under the lock: a Discard may have won the race
  if (!row) return null;
  if (ACTIVE.has(String(row.status || '').toLowerCase())) {
    throw err('cannot apply the work of a running pipeline', 'RUNNING');
  }
  const report = { ok: true, id: row.id, applied: [], failed: [], remaining: 0, worktrees: [], runRoot: null, warnings: [] };
  const retained = retainedWorkFor(row);
  if (!retained) return report;                 // nothing (left) to apply: idempotent
  const { state } = (await readPipelineByKey(storeKey, row.id)) || { state: null };
  if (!state) throw err('pipeline state is unavailable', 'BAD_REQUEST');
  const runDir = await findRunDir(join(projectStorePath(storeKey), 'pipelines'), row.id);
  const targets = retainedTargets(state, retained, projectDir);
  if (targets.some((t) => !t.projectDir)) {
    throw err('cannot apply retained work: a member repository could not be resolved', 'BAD_REQUEST');
  }
  const records = new Map(branchRecordsOf(row));
  const modeOf = (br) => br?.runRootMode || parseJson(row.workspace_meta)?.runRootMode || 'legacy';
  const message = `worca: ${row.title || row.base_name || 'changes'}\n\nPipeline ${row.id}`;   // teardown: title || baseName || 'changes'
  const at = new Date().toISOString();
  const outcome = new Map();                     // projectKey -> { sha, hooksBypassed, mergeBack }
  const released = [];
  for (const t of targets) {
    const br = records.get(t.projectKey) || {};
    // Teardown excludes the memory mount only when the run mounted it, and the mount is refused on a checkout
    // that tracks the path: there, `rm --cached` of the exclude would commit the deletion of the project's own files.
    const exclude = (await indexTracks(t.worktreeDir, MEMORY_RULES_REL)) === false ? [MEMORY_RULES_REL] : [];
    // A sandbox run's retained work came from an untrusted machine: commit it with no repo hook, as teardown does.
    const remote = !!execEnvOfRow(row) && execEnvOfRow(row) !== 'local';
    const c = await commitStagedWork(t.worktreeDir, { message, exclude, bypassHooks: modeOf(br) === 'detached', hooksOff: remote, branch: t.branch });
    if (!c.ok) {
      report.failed.push({ projectKey: t.projectKey, branch: t.branch, step: c.step, message: c.message });
      continue;
    }
    const mergeBack = br.sameAsSource === true ? await finishMergeBack({ row, projectDir: t.projectDir, br, branch: t.branch }) : null;
    outcome.set(t.projectKey, { sha: c.sha, hooksBypassed: c.hooksBypassed, mergeBack });
    report.applied.push({ projectKey: t.projectKey, branch: t.branch, sha: c.sha, committed: c.committed,
      hooksBypassed: c.hooksBypassed, ...(mergeBack ? { mergeBack: { ...mergeBack, source: br.source || null } } : {}) });
    released.push({ ...t, dropBranch: mergeBack?.merged === true ? t.branch : null });
  }
  // What teardown records after a good commit. This happens even when the worktree removal below fails:
  // the work is safely on the branch now. A member that failed again gets git's newest message.
  updateBranchRecords(row.id, [...outcome.keys()], (br, k) => {
    const o = outcome.get(k);
    delete br.commitFailed;
    if (o.sha) br.commit = o.sha;
    if (o.mergeBack) br.mergeBack = o.mergeBack;
    br.retainedApplied = { at, ...(o.sha ? { sha: o.sha } : {}), ...(o.hooksBypassed ? { hooksBypassed: true } : {}) };
  });
  updateBranchRecords(row.id, report.failed.map((f) => f.projectKey), (br, k) => {
    const f = report.failed.find((x) => x.projectKey === k) || report.failed[0];
    br.commitFailed = { ...(br.commitFailed || {}), code: br.commitFailed?.code || RETAIN_REASONS.COMMIT_FAILED,
      step: f.step, message: f.message, at };
  });
  report.remaining = report.failed.length;      // a member that failed again keeps the run root alive
  if (released.length) {
    await releaseRetainedTargets({ row, state, targets: released, runDir, report,
      stamp: (br, k) => { br.worktreeRemoved = true; br.branchKept = outcome.get(k)?.mergeBack?.merged !== true; } });
  }
  // The run.json retain ledger must forget the applied members too: Archive's guard and the boot sweep trust
  // it as much as the DB stamp. Their work is on the branch now, even when a worktree removal failed and kept
  // the folder (and with it the run root). A member that failed again stays listed. `retain: null` is what
  // teardown writes when nothing is retained.
  const runRoot = join(worcaHome(), 'runs', row.id);
  if (released.length && existsSync(runRoot)) {
    const cur = await readRunManifest(runRoot);
    if (Array.isArray(cur?.retain?.members)) {
      const appliedDirs = new Set(released.map((t) => t.worktreeDir));
      const left = cur.retain.members.filter((m) => !appliedDirs.has(m?.worktreeDir));
      await updateRunManifest(runRoot, { retain: left.length ? { ...cur.retain, members: left } : null });
    }
  }
  for (const a of report.applied) {
    appendAuditById(row.id, `Applied the retained work${byActor(by)}: ${a.committed && a.sha ? `committed \`${a.sha.slice(0, 10)}\` on` : 'nothing new to commit on'} \`${a.branch}\``
      + `${a.hooksBypassed ? ' (commit hooks bypassed, as at the end of a detached run)' : ''}`
      + `${a.mergeBack ? (a.mergeBack.merged ? `; merged back into \`${a.mergeBack.source}\`` : `; not merged back into \`${a.mergeBack.source}\`: ${a.mergeBack.reason}`) : ''}.`, { actor: by });
  }
  for (const f of report.failed) {
    appendAuditById(row.id, `Apply to branch failed for \`${f.branch}\`${byActor(by)} at git ${f.step}: ${f.message}. The worktree stays.`, { actor: by });
  }
  return report;
}

// Compat alias. The server now calls `archivePipeline` directly; this name is
// kept for the pre-existing suites (test/pipeline-delete.test.mjs,
// test/persist-roundtrip.test.mjs) that assert the FS/branch reclamation half
// under the old name — which archive still performs in full.
/** Delete (runs redesign §3.2): permanent. archivePipeline removes the run's files, worktree and local branch (remote
 *  branches and PRs are never touched); then the row is anonymised in place and stamped deleted_at. The row itself
 *  stays so its cost stays in Statistics, which sums every pipelines row. */
export async function purgePipeline({ projectDir = null, key = null, workspaceKey = null, id } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT archived_at, deleted_at FROM pipelines WHERE id = ?').get(String(id));
  if (!row) throw Object.assign(new Error('pipeline not found'), { code: 'NOT_FOUND' });
  if (row.deleted_at) return { ok: true, id, alreadyDeleted: true, deleted: true, warnings: [] };
  const report = row.archived_at ? { ok: true, id, warnings: [] } : await archivePipeline({ projectDir, key, workspaceKey, id });
  if (!report) return null;            // archivePipeline found no row for this scope: the bulk wrapper reports "run not found"
  const ts = new Date().toISOString();
  tx(() => {
    db.prepare(`UPDATE pipelines SET title = 'deleted run', prompt = NULL, started_by = NULL,
      archived_at = COALESCE(archived_at, ?), deleted_at = ? WHERE id = ?`).run(ts, ts, String(id));
    db.prepare('DELETE FROM run_tags WHERE pipeline_id = ?').run(String(id));
    db.prepare('DELETE FROM run_labels WHERE pipeline_id = ?').run(String(id));
    db.prepare('DELETE FROM run_tag_events WHERE pipeline_id = ?').run(String(id));   // tag history is part of the record
    db.prepare('DELETE FROM run_group_members WHERE pipeline_id = ?').run(String(id));
  });
  return { ...report, deleted: true };
}

export { archivePipeline as deletePipeline };
