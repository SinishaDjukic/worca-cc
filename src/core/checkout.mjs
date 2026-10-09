// Re-create a finished run's worktree from its branch on demand (issue #529).
// DB-aware orchestration like pipeline-delete.mjs; worktree.mjs stays DB-free.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dirname, basename, join, resolve, sep } from 'node:path';
import { getDb, tx } from './db.mjs';
import { worcaHome } from './projects.mjs';
import { createWorktree, removeWorktree, worktreePathForBranch, snapshotWorktreePatch } from './worktree.mjs';
import { staleIndexLockNote } from './git-lock.mjs';
import { readRunManifest, writeRunManifest, updateRunManifest, rmGuarded, RETAIN_REASONS } from './run-manifest.mjs';
import { findPipelineRowById, retainedWorkFor, checkoutRecordsFor, readPrState, appendAuditById,
  readStoreMeta, runRootSweepLookups } from './artifacts.mjs';
import { branchExists, branchPushedTo, restoreBranchFromRemote, prLifecycleState } from './git-info.mjs';
import { actionsSettings } from './settings.mjs';
import { busyRunIdsFromPidFile, actionsPidFile } from './actions/registry.mjs';
import { terminalPidFile } from './terminal/paths.mjs';

const execFileP = promisify(execFile);
const FINISHED = new Set(['done', 'stopped', 'error']);
const locks = new Map();                           // runId -> Promise (double-click safe, per process)
const withLock = (id, fn) => {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  // The stored tail swallows the rejection (the caller gets it from `next`), so a refusal is never unhandled.
  const tail = next.catch(() => {}).finally(() => { if (locks.get(id) === tail) locks.delete(id); });
  locks.set(id, tail);
  return next;
};
const cerr = (msg, code, extra = {}) => Object.assign(new Error(msg), { code, ...extra });
const parse = (t) => { if (t && typeof t === 'object') return t; try { return JSON.parse(t); } catch { return null; } };
/** D27: git prints realpaths; the Worca home or a temp dir may sit behind a symlink (/var → /private/var). */
export const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const isUnder = (child, parent) => { const c = canon(child); const p = canon(parent); return c === p || c.startsWith(p + sep); };
/** This process's code root and cwd: a checkout holding either is never removed, or the server deletes itself. */
const hostDirsOfThisProcess = () => [fileURLToPath(new URL('../../', import.meta.url)), process.cwd()];

/** Runs with a live action process or an open terminal (#573): the cap and until-pr never touch their checkout. */
export const busyRunIds = (extra = []) => new Set([
  ...busyRunIdsFromPidFile(actionsPidFile(worcaHome())), ...busyRunIdsFromPidFile(terminalPidFile(worcaHome())), ...extra]);

/** The project dir of a single-project row, exactly as rowToState derives it (artifacts.mjs:2249). */
const projectDirOfRow = (row) => readStoreMeta(row.project_key)?.path ?? null;

/** Members of a run as { projectKey, projectName, projectDir, br } (br = the live branch record). */
export function membersOfRow(row) {
  const wm = parse(row.workspace_meta);
  if (row.target === 'workspace' && wm?.branches) {
    const projects = Array.isArray(wm.projects) ? wm.projects : [];
    return projects.map((p) => ({ projectKey: p.projectKey, projectName: p.projectName, projectDir: p.projectDir, br: wm.branches[p.projectKey] || null }));
  }
  const dir = projectDirOfRow(row);
  return [{ projectKey: row.project_key, projectName: dir ? basename(dir) : null, projectDir: dir, br: parse(row.branch) }];
}

/** Where the checkout goes: the recorded worktreeDir, else derived from the recorded mode (D6). */
export function checkoutPathFor(row, member) {
  if (member.br?.worktreeDir) return resolve(member.br.worktreeDir);
  const mode = member.br?.runRootMode || parse(row.workspace_meta)?.runRootMode || 'legacy';
  return mode === 'detached'
    ? join(worcaHome(), 'runs', row.id, 'repos', member.projectKey)
    : join(member.projectDir, '.worca-cc', 'worktrees', row.id);
}

function assertEligible(row, isLive) {
  if (!row || row.archived_at) throw cerr('pipeline not found', 'NOT_FOUND');
  if (isLive(row.id) || !FINISHED.has(row.status)) throw cerr('Check out is available once the run has finished.', 'NOT_FINISHED');
  if (retainedWorkFor(row)) throw cerr('This run kept uncommitted work in its worktree. Recover or discard it first.', 'RETAINED');
}

/** Drop registrations whose folder is gone, so a hand-deleted checkout never reads as "checked out elsewhere". */
async function pruneWorktrees(projectDir) {
  await execFileP('git', ['worktree', 'prune'], { cwd: projectDir, windowsHide: true }).catch(() => {});
}

/**
 * Check out a finished run. Idempotent. `members` limits a workspace run to those keys.
 * Returns { members:[{projectKey, worktreeDir, branch, state, external?}], warnings }.
 * The setup command is NOT run here; the server runs it right after (it owns the registry, D25).
 * useExisting: when the branch is already checked out in another folder (the person's own clone), link
 * that folder instead of refusing. A linked folder is never Worca's: it is recorded as checkout.dir (never
 * br.worktreeDir, which teardown and the run-root sweep may delete), and Discard only unlinks it.
 */
export function checkoutRun({ id, members = null, by = null, policy = 'on-demand', isLive = () => false, isFinishing = () => false, useExisting = false }) {
  return withLock(id, async () => {
    const row = findPipelineRowById(id);
    assertEligible(row, isLive);
    const all = membersOfRow(row);
    const want = all.filter((m) => !members || members.includes(m.projectKey));
    if (!want.length) throw cerr('no such member in this run', 'BAD_REQUEST');
    // D30: the harness sets status 'done' (DB and runs-Map entry) BEFORE its `finally` teardown commits and
    // removes the worktree (run-harness.mjs:1366-1370 vs :1468-1478). isFinishing(id) is true while this
    // server's run()/resume() promise for the run has not settled (entry.settled, Step 10). Adopting the
    // worktree then would let teardown commit setup output (package-lock.json) into the branch and delete
    // the folder under a running `npm ci`. The worktreeRemoved stamp is NOT used: teardown can skip it.
    if (isFinishing(row.id)) throw cerr('The run is still finishing: its worktree is being cleaned up. Try again in a moment.', 'NOT_FINISHED');
    const out = []; const warnings = []; const kept = [];
    for (const m of want) {
      const feature = m.br?.feature;
      if (!feature || !m.projectDir) { out.push({ projectKey: m.projectKey, state: 'no-branch' }); continue; }
      const target = checkoutPathFor(row, m);
      await pruneWorktrees(m.projectDir);
      const holder = await worktreePathForBranch(m.projectDir, feature);
      if (holder && existsSync(target) && canon(holder) === canon(target)) {   // already checked out here (D27)
        kept.push({ m, target: canon(target), feature }); continue;
      }
      // Already linked to this folder (an earlier useExisting): the same link again, not a refusal.
      const linked = m.br?.checkout?.external && m.br.checkout.dir && holder && canon(m.br.checkout.dir) === canon(holder);
      if (holder && (useExisting || linked)) { kept.push({ m, target: canon(holder), feature, external: true }); continue; }
      if (holder) throw cerr(`Can't check out: ${feature} is already checked out in ${holder}. Use that folder, or switch it to another branch and check out again.`, 'BRANCH_CHECKED_OUT', { holder, projectKey: m.projectKey });
      if (existsSync(target)) throw cerr(`${target} already exists and is not this run's checkout. Move or delete it, then try again.`, 'TARGET_EXISTS');
      if (!(await branchExists(m.projectDir, feature))) {
        const pushed = await branchPushedTo(m.projectDir, feature);
        if (!pushed || !(await restoreBranchFromRemote(m.projectDir, feature, pushed.remote))) {
          throw cerr(`The branch ${feature} no longer exists locally or on a remote.`, 'BRANCH_MISSING');
        }
      }
      // The branch exists now, so createWorktree takes its `worktree add <dir> <branch>` path.
      // sourceBranch only has to be present and differ from the feature name (its :250 guard).
      // The reuse path does not rev-parse sourceBranch (worktree.mjs:273-286); it only has to be
      // non-empty and differ by sanitized name (:241, :250).
      const made = await createWorktree({ projectDir: m.projectDir, pipelineId: row.id,
        sourceBranch: m.br.source && m.br.source !== feature ? m.br.source : 'HEAD',
        featureBranch: feature, baseDir: dirname(target), checkoutName: basename(target) });
      const dir = made.worktreeDir;                                        // realpath'd base + name (D27)
      if (process.platform === 'win32' && dir.length > 120) {
        warnings.push(`The checkout path is ${dir.length} characters long; node_modules inside it may pass Windows' 260-character limit. Enable long paths or move the Worca home.`);
      }
      kept.push({ m, target: dir, feature, fresh: true });
    }
    if (kept.length) {
      // D27: the stamped worktreeDir is the path on disk, so a path derived for an old row becomes the record.
      const dirOf = Object.fromEntries(kept.map((k) => [k.m.projectKey, k.target]));
      stampCheckout(row, dirOf, { at: new Date().toISOString(), by, policy, fresh: kept.filter((k) => k.fresh).map((k) => k.m.projectKey),
        external: kept.filter((k) => k.external).map((k) => k.m.projectKey) });
      const own = kept.filter((k) => !k.external);
      if (own.some((k) => isUnder(k.target, join(worcaHome(), 'runs', row.id)))) await writeCheckoutManifest(row, own, policy);
      if (own.length) appendAuditById(row.id, `Checked out ${own.map((k) => `\`${k.feature}\``).join(', ')} (${policy}).`, { actor: by });
      for (const k of kept.filter((x) => x.external)) appendAuditById(row.id, `Linked ${k.target} as the checkout of \`${k.feature}\` (the branch was already checked out there).`, { actor: by });
    }
    for (const k of kept) out.push({ projectKey: k.m.projectKey, worktreeDir: k.target, branch: k.feature, state: 'checked-out', ...(k.external ? { external: true } : {}) });
    return { members: out, warnings };
  });
}

/** Targeted UPDATE (pipeline-delete.mjs:388 pattern): never writeState. mutate(br, projectKey). */
export function updateBranchRecords(rowId, keys, mutate) {
  if (!keys.length) return;
  tx(() => {
    const fresh = getDb().prepare('SELECT target, branch, workspace_meta FROM pipelines WHERE id = ?').get(rowId);
    if (!fresh) return;
    if (fresh.target === 'workspace') {
      const wm = parse(fresh.workspace_meta);
      if (!wm?.branches) return;
      for (const k of keys) if (wm.branches[k]) mutate(wm.branches[k], k);
      getDb().prepare('UPDATE pipelines SET workspace_meta = ? WHERE id = ?').run(JSON.stringify(wm), rowId);
    } else {
      const br = parse(fresh.branch);
      if (!br) return;
      mutate(br, keys[0]);
      getDb().prepare('UPDATE pipelines SET branch = ? WHERE id = ?').run(JSON.stringify(br), rowId);
    }
  });
}

/**
 * dirOf = { [projectKey]: worktreeDir actually on disk }. `fresh` = keys whose folder was just created:
 * a marker left over from a hand-deleted or half-discarded checkout must not carry `setup: ok` into it (D25).
 */
function stampCheckout(row, dirOf, { at, by, policy, fresh = [], external = [] }) {
  updateBranchRecords(row.id, Object.keys(dirOf), (br, k) => {
    if (external.includes(k)) {
      // A linked folder: its own field, and br.worktreeDir / worktreeRemoved stay as they were. Setup does not
      // run by itself in the person's own clone (status skipped; "Run setup" stays on the card).
      const prev = br.checkout?.external && br.checkout.dir === dirOf[k] ? br.checkout : {};
      br.checkout = { at: prev.at || at, by: prev.by || by, policy: 'external', external: true, dir: dirOf[k], setup: prev.setup || { status: 'skipped' } };
      return;
    }
    const prev = fresh.includes(k) ? {} : (br.checkout || {});
    br.checkout = { at: prev.at || at, by: prev.by || by, policy: prev.policy && prev.policy !== 'on-demand' ? prev.policy : policy,
      setup: prev.setup || { status: 'pending' } };
    br.worktreeDir = dirOf[k];                   // D27: record the real path (derived paths included)
    br.worktreeRemoved = false;
  });
}

export function setSetupState(runId, projectKey, setup) {
  updateBranchRecords(runId, [projectKey], (br) => { if (br.checkout) br.checkout.setup = setup; });
}

/** Boot (D25): a setup that was running when the server died can never finish; mark it re-runnable. */
export function markInterruptedSetups() {
  let n = 0;
  for (const { row, rec } of checkedOutRows()) {
    const stale = rec.members.filter((m) => m.setup?.status === 'running').map((m) => m.projectKey);
    if (!stale.length) continue;
    updateBranchRecords(row.id, stale, (br) => { if (br.checkout?.setup) br.checkout.setup = { ...br.checkout.setup, status: 'interrupted' }; });
    n += stale.length;
  }
  return n;
}

async function writeCheckoutManifest(row, kept, policy) {
  const runRoot = join(worcaHome(), 'runs', row.id);
  await mkdir(runRoot, { recursive: true });
  const cur = await readRunManifest(runRoot);
  const now = new Date().toISOString();
  const entries = kept.map((k) => ({ projectKey: k.m.projectKey, projectName: k.m.projectName, projectDir: k.m.projectDir, worktreeDir: k.target }));
  const retainMembers = kept.map((k) => ({ projectKey: k.m.projectKey, worktreeDir: k.target, branch: k.feature, policy, at: now }));
  const merge = (a = [], b) => [...a.filter((x) => !b.some((y) => y.projectKey === x.projectKey)), ...b];
  // updateRunManifest is a SHALLOW merge: `retain` is always written whole.
  if (!cur) {
    await writeRunManifest(runRoot, { pipelineId: row.id, runRootMode: 'detached', isWorkspace: row.target === 'workspace',
      members: entries, retain: { reason: RETAIN_REASONS.CHECKOUT, at: now, members: retainMembers } });
  } else {
    await updateRunManifest(runRoot, { members: merge(cur.members, entries),
      retain: { reason: cur.retain?.reason || RETAIN_REASONS.CHECKOUT, at: cur.retain?.at || now, members: merge(cur.retain?.members, retainMembers) } });
  }
}

/** D14: the pipeline's artifact dir; never the run root, which discard removes. */
async function patchDirFor(id) {
  const dir = await runRootSweepLookups().pipelineDirOf(id).catch(() => null);
  if (dir && existsSync(dir)) return dir;
  const fallback = join(worcaHome(), 'actions', 'patches', id);
  await mkdir(fallback, { recursive: true });
  return fallback;
}

/** Stop services (callback), snapshot dirty work, remove the checkout, clear the marker. Branch kept. */
export function discardCheckout({ id, members = null, force = false, stopServices = async () => {}, by = null, hostDirs = hostDirsOfThisProcess() }) {
  return withLock(id, async () => {
    const row = findPipelineRowById(id);
    if (!row) throw cerr('pipeline not found', 'NOT_FOUND');
    const recs = (checkoutRecordsFor(row)?.members || []).filter((m) => !members || members.includes(m.projectKey));
    // Checked before any service stops: a refusal leaves everything as it was.
    for (const rec of recs) {
      const host = !rec.external && hostDirs.find((d) => isUnder(d, rec.worktreeDir));
      if (host) throw cerr(`Can't remove the checkout at ${rec.worktreeDir}: the running Worca server is started from it. Restart Worca from another folder, then try again.`, 'HOSTS_SERVER', { worktreeDir: rec.worktreeDir });
    }
    const patches = []; const removed = []; let failure = null;
    const patchDir = recs.length ? await patchDirFor(row.id) : null;
    const unlinked = [];
    for (const rec of recs) {
      await stopServices(rec.projectKey, row.id);                           // FIRST (acceptance); the cap evicts other runs
      if (rec.external) { unlinked.push(rec.projectKey); continue; }       // a linked folder: never snapshot, never remove
      const out = join(patchDir, `checkout-discard-${rec.projectKey}-${Date.now()}.patch`);
      const snap = await snapshotWorktreePatch(rec.worktreeDir, out);        // {ok,file,bytes} | {ok:false,step,message}
      if (snap.clearedLock) appendAuditById(row.id, `${rec.projectKey}: ${staleIndexLockNote(snap.clearedLock)}`, { actor: by });
      if (!snap.ok && !force) throw cerr(`Could not save uncommitted changes (${snap.message || snap.step}). Discard anyway to lose them.`, 'SNAPSHOT_FAILED');
      if (snap.ok && snap.file) patches.push(snap.file);                    // clean tree → file:null, no patch
      const m = membersOfRow(row).find((x) => x.projectKey === rec.projectKey);
      // removeWorktree never throws (worktree.mjs:321-351): check ok, or the marker would be cleared
      // while the folder is still on disk and no longer protected from the sweep.
      const rm = await removeWorktree({ projectDir: m.projectDir, worktreeDir: rec.worktreeDir, branch: null, force: true });
      if (!rm.ok && existsSync(rec.worktreeDir)) {
        const why = rm.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${String(s.stderr || '').trim()}`).join('; ');
        // Record what was already removed (below) before reporting, so no marker points at a deleted folder.
        failure = cerr(`Could not remove the checkout at ${rec.worktreeDir} (${why}).${patches.length ? ` Saved patches: ${patches.join(', ')}` : ''}`, 'REMOVE_FAILED');
        break;
      }
      removed.push(rec.projectKey);
    }
    if (unlinked.length) {
      updateBranchRecords(row.id, unlinked, (br) => { if (br.checkout?.external) delete br.checkout; });
      appendAuditById(row.id, `Unlinked the folder used as the checkout (${unlinked.join(', ')}); it was left as it was.`, { actor: by });
    }
    if (removed.length) {
      updateBranchRecords(row.id, removed, (br) => { delete br.checkout; br.worktreeRemoved = true; br.branchKept = true; });
      const runRoot = join(worcaHome(), 'runs', row.id);
      if (existsSync(runRoot)) {
        const cur = await readRunManifest(runRoot);
        const left = (cur?.retain?.members || []).filter((x) => !removed.includes(x.projectKey) && existsSync(x.worktreeDir));
        if (left.length) await updateRunManifest(runRoot, { retain: { ...cur.retain, members: left } });
        else await rmGuarded(runRoot, { worcaHome: worcaHome(), pipelineId: row.id });
      }
      appendAuditById(row.id, `Discarded the checkout${patches.length ? ` (uncommitted changes saved as ${patches.map((p) => basename(p)).join(', ')})` : ''}.`, { actor: by });
    }
    if (failure) throw failure;
    return { removed, patches, unlinked };
  });
}

/** Keep policy right after teardown (D10). Called by the harness; never throws into it. */
export async function keepAfterRun({ pipelineId, log = () => {} }) {
  const { keep, maxCheckouts } = actionsSettings();
  if (keep === 'never') return null;
  const row = findPipelineRowById(pipelineId);
  if (!row || row.status !== 'done' || retainedWorkFor(row)) return null;
  const r = await checkoutRun({ id: pipelineId, by: 'keep-policy', policy: keep });
  log(`checkout kept by policy (${keep})`);
  // The cap never evicts a run with a live action (pid file) nor the run just kept (D12).
  if (maxCheckouts) await enforceCheckoutCap({ max: maxCheckouts, busy: busyRunIds([pipelineId]) });
  return r;
}

/** Non-archived rows with a live checkout: [{ row, rec }]. */
function checkedOutRows() {
  const rows = getDb().prepare(
    `SELECT * FROM pipelines WHERE archived_at IS NULL AND (branch LIKE '%"checkout"%' OR workspace_meta LIKE '%"checkout"%')`).all();
  return rows.map((row) => ({ row, rec: checkoutRecordsFor(row) })).filter((x) => x.rec);
}

/** All live checkouts, oldest first: [{ runId, at, policy }]. */
export function listCheckouts() {
  // A linked folder (useExisting) is the person's own: the cap and the keep policy never unlink it.
  return checkedOutRows()
    .filter(({ rec }) => rec.members.some((m) => !m.external))
    .map(({ row, rec }) => ({ runId: row.id, at: rec.members.map((m) => m.at || '').sort()[0] || '', policy: rec.members[0].policy }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export async function enforceCheckoutCap({ max, busy = busyRunIds(), stopServices = async () => {} }) {
  const all = listCheckouts();
  const evicted = [];
  let over = all.length - max;
  for (const c of all) {
    if (over <= 0) break;
    if (busy.has(c.runId)) continue;
    await discardCheckout({ id: c.runId, force: true, stopServices, by: 'checkout cap' })
      .then(() => { evicted.push(c.runId); over--; }).catch(() => {});
  }
  return { evicted };
}

/** until-pr (D11): release checkouts whose PR merged or closed. */
export async function releaseKeptCheckouts({ busy = busyRunIds(), stopServices = async () => {}, prState = prLifecycleState } = {}) {
  const released = [];
  for (const c of listCheckouts().filter((x) => x.policy === 'until-pr' && !busy.has(x.runId))) {
    const pr = readPrState(c.runId);                                     // { url, number, state } | null
    if (!pr?.url) continue;
    const row = findPipelineRowById(c.runId);
    const projectDir = membersOfRow(row).find((m) => m.projectDir)?.projectDir;
    if (!projectDir) continue;
    const state = await prState({ projectDir, prUrl: pr.url });
    if (state === 'MERGED' || state === 'CLOSED') {
      const ok = await discardCheckout({ id: c.runId, force: true, stopServices, by: `keep policy (PR ${state.toLowerCase()})` })
        .then(() => true, (e) => { if (e.code === 'HOSTS_SERVER') return false; throw e; });
      if (ok) released.push(c.runId);
    }
  }
  return { released };
}
