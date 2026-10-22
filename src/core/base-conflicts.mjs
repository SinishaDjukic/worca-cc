// Base-branch conflicts after a run (#620): check each kept feature branch against its fetched base, record the
// result on the branch record (br.baseCheck, like br.published / br.checkout), Update branch (a merge commit), and
// settle a resolution (re-check, then a fast-forward push when the branch is published). DB-aware like
// checkout.mjs; the git work is git-sync.mjs's. Nothing here force-pushes, rebases or resets.
import { findPipelineRowById, appendAuditById } from './artifacts.mjs';
import { membersOfRow, updateBranchRecords, withRunLock } from './checkout.mjs';
import { checkBaseMerge, mergeBaseInto, scrubGitText, INTERACTIVE_TTL_MS } from './git-sync.mjs';
import { branchPushedTo, branchTips, pushBranch, leftoverMarkers } from './git-info.mjs';
import { conflictBrief } from './pr-watch.mjs';
import { effectiveSyncSettings } from './project-sync.mjs';
import { gitAvailable } from './git-available.mjs';

const FINISHED = new Set(['done', 'stopped', 'error']);
const SETTLED = new Set(['up-to-date', 'clean']);
const cerr = (msg, code, extra = {}) => Object.assign(new Error(msg), { code, ...extra });
const short = (sha) => String(sha || '').slice(0, 7);

/** The stored form: the merge-tree tree id is a transient object, never persisted. */
export function toRecord(check, by = null) {
  const { tree, ...rest } = check || {};
  return { ...rest, ...(by ? { by } : {}) };
}

/** A run's members whose branch can be checked: a kept feature branch with a known source, in a repo on disk. */
export function baseMembersOfRow(row) {
  return membersOfRow(row)
    .filter((m) => m.projectDir && m.br?.feature && m.br?.source && m.br.branchKept !== false && !m.br.branchDeleted)
    .map((m) => ({ ...m, remote: effectiveSyncSettings(m.projectKey).remote || 'origin' }));
}

/** One member by key; a single-member run needs none (MEMBER_REQUIRED otherwise). */
export function pickBaseMember(row, member) {
  const all = baseMembersOfRow(row);
  const m = member ? all.find((x) => x.projectKey === member) : (all.length === 1 ? all[0] : null);
  if (!m) throw cerr(member ? 'That project is not part of this run.' : 'Pick a project: this run has more than one.', 'MEMBER_REQUIRED');
  return m;
}

export function assertFinishedRow(row, { isLive = () => false, isFinishing = () => false } = {}) {
  if (!row || row.archived_at) throw cerr('pipeline not found', 'NOT_FOUND');
  if (!FINISHED.has(row.status) || isLive(row.id) || isFinishing(row.id)) throw cerr('Available once the run has finished.', 'NOT_FINISHED');
}

/** D18: a resolve run that is still active owns the branch (its worktree holds it). `isActive(runUuid)`. */
export function assertNotResolving(m, isActive = () => false) {
  const r = m.br.baseResolve;
  if (r && r.via === 'pipeline' && r.runId && isActive(r.runId)) {
    throw cerr(`A run is resolving the conflicts on \`${m.br.feature}\`. Wait for it to finish.`, 'RESOLVING', { runId: r.runId });
  }
}

/** The mark a resolution leaves on the member (D12, D13): the branch head it started from and the
 *  conflicting files travel with it, for the marker check when it settles. */
export function resolveMark(via, check, { runId = null, by = null } = {}) {
  return { via, ...(runId ? { runId } : {}), at: new Date().toISOString(), by, from: check.headSha || null,
    files: (check.files || []).slice(), fileCount: check.fileCount | 0 };
}

/** Check (all or `members`) and record each result. → { row, members:[{ projectKey, name, branch, baseCheck, tree }] } */
export async function checkRunBase(rowId, { members = null, by = null, maxAgeMs = 0 } = {}) {
  const row = findPipelineRowById(rowId);
  if (!row || row.archived_at) throw cerr('pipeline not found', 'NOT_FOUND');
  const out = [];
  // Sequential: members may share one repository (and its fetch).
  for (const m of baseMembersOfRow(row).filter((x) => !members || members.includes(x.projectKey))) {
    const c = await checkBaseMerge(m.projectDir, { base: m.br.source, feature: m.br.feature, remote: m.remote, maxAgeMs });
    const fresh = toRecord(c, by);
    // This check runs outside the run lock: a record written after it started (Update branch, a settled
    // resolution) describes a newer branch and stays. `at` is when a check started.
    let rec = fresh;
    updateBranchRecords(row.id, [m.projectKey], (br) => {
      if (Date.parse(br.baseCheck?.at || '') > Date.parse(fresh.at || '')) rec = br.baseCheck;
      else br.baseCheck = fresh;
    });
    out.push({ projectKey: m.projectKey, name: m.projectName || null, branch: m.br.feature, baseCheck: rec,
      tree: rec === fresh ? c.tree || null : null });
  }
  return { row, members: out };
}

/** Fast-forward push when the branch is already on a remote (published, Ship it, a PR). Never forces. */
export async function pushIfPublished(rowId, m, { by = null } = {}) {
  const feature = m.br.feature;
  const remote = m.br.published?.remote || (await branchPushedTo(m.projectDir, feature))?.remote || null;
  if (!remote) return { pushed: false, reason: 'unpublished' };
  const tips = await branchTips(m.projectDir, feature, remote);
  if (!tips?.local) return { pushed: false, reason: 'no-branch', remote };
  if (tips.local === tips.remote) return { pushed: false, reason: 'up-to-date', remote };
  const r = await pushBranch(m.projectDir, feature, remote);      // git push -u: a non-fast-forward is rejected
  if (!r.ok) return { pushed: false, remote, error: scrubGitText(r.stderr, 300) };
  updateBranchRecords(rowId, [m.projectKey], (br) => { br.published = { remote, sha: tips.local, at: new Date().toISOString(), by }; });
  return { pushed: true, remote, sha: tips.local };
}

const whereOf = (row, m) => (row.target === 'workspace' && m.projectName ? ` in \`${m.projectName}\`` : '');
const pushNote = (p) => (p.pushed ? `; pushed to \`${p.remote}\`` : p.error ? `; the push to \`${p.remote}\` failed: ${p.error}` : '');

/**
 * Members marked as being resolved (br.baseResolve) whose fresh check is settled (up-to-date / clean):
 * - a pipeline mark whose run is still active is skipped (D18): that run settles it when it ends;
 * - leftover conflict markers on lines the resolution added (D13; the check Watch PR runs before its push,
 *   narrowed to the conflicting files when all are known) record `conflicts/markers`, keep the mark and push nothing;
 * - otherwise push when published, drop the mark, write one audit line.
 * → { [projectKey]: { baseCheck, push } }   (push null when nothing was pushed because of markers)
 */
export async function settleResolutions(rowId, checked, { by = null, isActive = () => false } = {}) {
  const row = findPipelineRowById(rowId);
  if (!row) return {};
  const byKey = new Map(baseMembersOfRow(row).map((m) => [m.projectKey, m]));
  const out = {};
  for (const c of checked) {
    const m = byKey.get(c.projectKey);
    const mark = m?.br?.baseResolve;
    if (!mark || !SETTLED.has(c.baseCheck?.status)) continue;
    if (mark.via === 'pipeline' && mark.runId && isActive(mark.runId)) continue;
    // A mark from before `from` was recorded: every line on the branch that the base lacks.
    const files = (mark.files || []).length >= (mark.fileCount | 0) ? mark.files : [];
    const v = await leftoverMarkers(m.projectDir, { from: mark.from || c.baseCheck.baseSha, to: c.baseCheck.headSha, files });
    if (!v.ok) {
      out[m.projectKey] = { baseCheck: c.baseCheck, push: null, verification: v };
      continue;
    }
    const left = [...new Set(v.markers.map((x) => x.replace(/:\d+$/, '')))];
    if (left.length) {
      const rec = { ...c.baseCheck, status: 'conflicts', kind: 'markers', files: left, fileCount: left.length };
      updateBranchRecords(row.id, [m.projectKey], (br) => { br.baseCheck = rec; });
      out[m.projectKey] = { baseCheck: rec, push: null };
      continue;
    }
    const push = await pushIfPublished(row.id, m, { by });
    updateBranchRecords(row.id, [m.projectKey], (br) => { delete br.baseResolve; });
    appendAuditById(row.id, `Conflicts with \`${c.baseCheck.base}\` resolved on \`${m.br.feature}\`${whereOf(row, m)}${pushNote(push)}.`, { actor: by });
    out[m.projectKey] = { baseCheck: c.baseCheck, push };
  }
  return out;
}

/** Update branch: re-check (a fetch younger than the TTL is reused), require clean, merge, record, push.
 *  `assertFree(row, m)` throws while something else owns the branch (a Watch PR fix run, PR_FIXING). */
export function updateRunBranch({ id, member = null, by = null, isLive, isFinishing, isActive = () => false, assertFree = () => {} } = {}) {
  return withRunLock(id, async () => {
    const row = findPipelineRowById(id);
    assertFinishedRow(row, { isLive, isFinishing });
    const m = pickBaseMember(row, member);
    assertNotResolving(m, isActive);
    assertFree(row, m);
    const c = await checkBaseMerge(m.projectDir, { base: m.br.source, feature: m.br.feature, remote: m.remote, maxAgeMs: INTERACTIVE_TTL_MS });
    const rec = toRecord(c, by);
    if (c.status !== 'clean') {
      updateBranchRecords(row.id, [m.projectKey], (br) => { br.baseCheck = rec; });
      if (c.status === 'up-to-date') throw cerr(`\`${m.br.feature}\` already contains \`${c.baseRef}\`.`, 'UP_TO_DATE', { baseCheck: rec });
      if (c.status === 'conflicts') throw cerr(`Merging \`${c.baseRef}\` conflicts in ${c.fileCount} file(s). Resolve it in a pipeline or a terminal.`, 'CONFLICTS', { baseCheck: rec });
      if (c.status === 'no-branch') throw cerr(`The branch \`${m.br.feature}\` is no longer in the repository.`, 'NO_BRANCH', { baseCheck: rec });
      throw cerr(c.error || 'The conflict check failed.', 'CHECK_FAILED', { baseCheck: rec });
    }
    const merged = await mergeBaseInto(m.projectDir, { feature: m.br.feature, baseSha: c.baseSha, headSha: c.headSha,
      baseRef: c.baseRef, tree: c.tree, remote: c.remote });
    if (!merged.ok) {
      const code = { dirty: 'DIRTY', 'in-use': 'IN_USE', moved: 'MOVED', identity: 'IDENTITY', 'not-clean': 'CONFLICTS' }[merged.kind] || 'MERGE_FAILED';
      const msg = merged.kind === 'dirty' ? `The checkout at ${merged.path} has uncommitted changes. Commit or discard them, then try again.`
        : merged.kind === 'identity' ? 'git has no user.name / user.email for this repository, so it cannot write the merge commit.'
        : merged.error;
      throw cerr(msg, code);
    }
    const after = { ...rec, status: 'up-to-date', behind: 0, headSha: merged.to, files: [], fileCount: 0, at: new Date().toISOString() };
    updateBranchRecords(row.id, [m.projectKey], (br) => { br.baseCheck = after; delete br.baseResolve; });
    const push = await pushIfPublished(row.id, m, { by });
    appendAuditById(row.id, `Merged \`${c.baseRef}\` into \`${m.br.feature}\`${whereOf(row, m)} (${short(merged.to)})${pushNote(push)}.`, { actor: by });
    return { member: m.projectKey, branch: m.br.feature, from: merged.from, to: merged.to, via: merged.via, baseCheck: after, push };
  });
}

const TASK_CAP = 20_000;
/** The resolve run's task (D5): the conflict brief Watch PR's fix runs get, the files, and the original task
 *  as context. It runs as wf_pr_fix (Implement ⇄ Review, no planner), like every conflict fix run. */
export function resolveTaskText({ check, feature, title, prompt }) {
  const files = check.files || [];
  const more = check.fileCount > files.length ? `- …and ${check.fileCount - files.length} more` : '';
  const original = String(prompt || title || '').slice(0, TASK_CAP);
  return [
    conflictBrief({ subject: `The branch \`${feature}\``, base: check.base, ref: check.baseRef }),
    '',
    `Conflicting files (${check.fileCount}):`,
    ...files.map((f) => `- ${f}`),
    ...(more ? [more] : []),
    '',
    '## The original task (context only: it is already done on this branch)',
    '',
    original,
  ].join('\n');
}

/**
 * Harness post-run step (D9). Checks every kept branch of the finished run. A resolve run (br.resolves) also
 * copies its result onto the run it resolves (they share the branch) and settles it there: the marker check
 * (D13) and the fast-forward push live in settleResolutions. Never throws.
 */
export async function afterRunBaseCheck(rowId, { log = () => {} } = {}) {
  if (!gitAvailable()) return;   // a check without git finds no branch tip and would store "no-branch" on a branch that exists
  try {
    const { row, members } = await checkRunBase(rowId);
    for (const m of members) log(`base check \`${m.branch}\`: ${m.baseCheck.status}${m.baseCheck.fileCount ? ` (${m.baseCheck.fileCount} file(s))` : ''}`);
    for (const own of baseMembersOfRow(row)) {
      const link = own.br.resolves;
      if (!link?.runId) continue;
      const orig = findPipelineRowById(link.runId);
      if (!orig || orig.archived_at) continue;
      const om = baseMembersOfRow(orig).find((x) => (!link.member || x.projectKey === link.member) && x.br.feature === own.br.feature);
      const mine = members.find((x) => x.projectKey === own.projectKey)?.baseCheck;
      if (!om || !mine) continue;
      const rec = { ...mine, via: { runId: row.id } };
      updateBranchRecords(orig.id, [om.projectKey], (br) => { br.baseCheck = rec; });
      // isActive is the default (false): this IS the resolve run ending, so its own mark settles now.
      const s = (await settleResolutions(orig.id, [{ projectKey: om.projectKey, baseCheck: rec }]))[om.projectKey];
      if (s?.baseCheck?.kind === 'markers') {
        const { via, ...markers } = s.baseCheck;
        updateBranchRecords(row.id, [own.projectKey], (br) => { br.baseCheck = markers; });
      }
    }
  } catch (e) { log(`base check skipped: ${e?.message || e}`); }
}
