// ui/public/worktree-notice.mjs — the summary card's live-worktree notice, on the run page's `.rd-glance` and
// History's `.hd-glance`, at every interface level. A finished run's branch is held by a live worktree in
// two cases:
//   - retained work: the end-of-run commit failed, so the work exists only in the worktree. This is the notice;
//   - a checkout: Actions › Check out, or a linked folder of the person's own. No notice: the Results › Actions
//     row says where the local copy stands (checkoutRowValue) and the Actions tab owns its controls.
// Pure: a model from the run's facts and the kept work's commands (slice 3: the run page's card head and tracker
// carry the actions; app.js owns the calls). Git stderr and paths are data, never markup.

/** app.js shellSingleQuote: a path pasted into a POSIX shell. */
const sq = (v) => `'${String(v == null ? '' : v).replaceAll("'", "'\"'\"'")}'`;

export const NOTICE_TITLES = Object.freeze({
  retained: 'Commit failed: uncommitted work retained',
  linked: 'Linked to your folder',
});

/** A workspace member's display name: History's member name, else its key without the `-<8 hex>` suffix. */
export function memberLabel(projectKey, names = {}) {
  const key = typeof projectKey === 'string' ? projectKey : '';
  const name = names && Object.prototype.hasOwnProperty.call(names, key) ? names[key] : '';
  return (typeof name === 'string' && name) || key.replace(/-[0-9a-f]{8}$/, '') || 'Project';
}

/** Which recovery patch the run's artifacts hold: the retained-work snapshot first, else the run's diff. */
export function recoveryPatchKind(artifacts) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  if (list.some((a) => a && a.kind === 'retained-work-patch')) return 'retained';
  if (list.some((a) => a && a.kind === 'diff-patch')) return 'diff';
  return null;
}

/** The download name of a checkout's uncommitted changes (GET …/checkout/diff names it the same way). */
export function uncommittedPatchName(branchOrId) {
  return `uncommitted-${String(branchOrId || 'checkout').replace(/[^a-zA-Z0-9._-]+/g, '-')}.patch`;
}

/**
 * The notice to show, or null when no live worktree holds the run's branch. Retained work wins over a
 * checkout: Check out is refused while work is retained, so both at once only happens on a stale row.
 * @param {{ retained?: {members:object[]}|null, checkout?: {members:object[]}|null, workspace?: boolean,
 *   names?: Record<string,string>, provisional?: boolean, recoveryPatch?: 'retained'|'diff'|null }} facts
 *   `retained` is retainedWorkFor's shape, `checkout` checkoutRecordsFor's. `provisional`: the facts were
 *   inferred, not read from History's row, so no action is offered.
 */
export function worktreeNoticeModel({ retained = null, checkout = null, workspace = false, names = {}, provisional = false, recoveryPatch = null } = {}) {
  const label = (pk) => (workspace && pk ? memberLabel(pk, names) : '');
  const rm = Array.isArray(retained?.members) ? retained.members : [];
  if (rm.length) {
    return {
      kind: 'retained', workspace: !!workspace, provisional: !!provisional, recoveryPatch: recoveryPatch || null,
      members: rm.map((m) => ({ projectKey: m.projectKey || null, label: label(m.projectKey), branch: m.branch || null,
        dir: m.worktreeDir || '', step: m.step || 'commit', message: m.message || '', at: m.at || null })),
    };
  }
  const cm = Array.isArray(checkout?.members) ? checkout.members : [];
  if (!cm.length) return null;
  return {
    kind: 'checkout', workspace: !!workspace, provisional: !!provisional,
    members: cm.map((m) => ({ projectKey: m.projectKey || null, label: label(m.projectKey), branch: m.branch || null,
      dir: m.worktreeDir || '', at: m.at || null, external: m.external === true })),
  };
}

/** The Overview WORKTREE row, from the same model the notice card paints (audit F-2).
 *  word: 'retained' | 'checked out' | 'active' | 'released'; dir: the path to show. */
export function worktreeRowState(model, { live = false, dir = '', removed = true } = {}) {
  if (model && model.kind === 'retained') return { word: 'retained', dir: dir || model.members[0]?.dir || '' };
  if (model && model.kind === 'checkout') {
    const m = model.members[0] || {};
    return { word: 'checked out', dir: m.dir || dir };
  }
  if (live && dir && removed !== true) return { word: 'active', dir };
  return { word: 'released', dir: '' };
}

/** The Apply to branch confirm. */
export function applyConfirmMessage(model) {
  const branches = [...new Set((model?.members || []).map((m) => m.branch).filter(Boolean))];
  const onto = branches.length === 1 ? branches[0] : 'each member\'s branch';
  return `Worca commits the retained work onto ${onto} in its worktree, where the changes are already staged, as the end of the run would have. Then it removes the worktree. A run on its source branch is then merged back into it when that is a fast-forward. If the commit fails again, nothing changes and git's message is shown.`;
}

/** The toast after an answered Apply to branch (200): { tone, title, detail }. */
export function applyOutcome(report = {}) {
  const applied = Array.isArray(report.applied) ? report.applied : [];
  const failed = Array.isArray(report.failed) ? report.failed : [];
  if (!applied.length && !failed.length) return { tone: 'info', title: 'Nothing left to apply', detail: 'The retained worktree is already gone.' };
  const many = applied.length + failed.length > 1;
  const who = (pk) => (many && pk ? `${memberLabel(pk)}: ` : '');
  const lines = applied.map((a) => {
    const branch = a.branch || 'the branch';
    const what = a.committed && a.sha ? `Committed ${a.sha.slice(0, 10)} on ${branch}` : `Nothing new to commit on ${branch}`;
    const hooks = a.hooksBypassed ? ' (commit hooks bypassed, as at the end of a run)' : '';
    const source = a.mergeBack?.source || 'the source branch';
    const mb = !a.mergeBack ? '' : a.mergeBack.merged ? `; ${source} fast-forwarded` : `; not merged back into ${source}: ${a.mergeBack.reason || a.mergeBack.kind}`;
    return `${who(a.projectKey)}${what}${hooks}${mb}.`;
  });
  for (const f of failed) lines.push(`${who(f.projectKey)}git ${f.step} failed: ${f.message}`);
  const warn = failed.length > 0 || applied.some((a) => a.mergeBack && !a.mergeBack.merged);
  return { tone: warn ? 'warn' : 'ok', title: failed.length ? 'Some of the work was applied' : 'Work applied to the branch', detail: lines.join(' ') };
}

/** Slice 3: the kept work's "Commit it yourself" text (the tracker's Changes step opens it in the viewer): each member's
 *  git failure, then the commands the notice's <details> showed. Paths are data, quoted for a POSIX shell. */
export function retainedCommands(model) {
  if (!model || model.kind !== 'retained') return '';
  const why = model.members.map((m) => `${m.label ? `${m.label} · ` : ''}git ${m.step}: ${m.message || 'failed'}`).join('\n');
  const cmds = model.members.map((m) => `git -C ${sq(m.dir)} status\ngit -C ${sq(m.dir)} add -A\ngit -C ${sq(m.dir)} commit`).join('\n\n');
  return `${why}\n\n${cmds}\n\nThe changes are already staged, so git status lists them under "Changes to be committed". After committing, Discard removes the leftover copy. A patch of anything still uncommitted is saved first.`;
}

/** The glance's Results › Actions row value before a checkout. */
export const TRY_IT_ROW = 'Try it on this machine';

/** "Local copy open · since 18:12", "Linked to your folder · since 18:12", "2 local copies open · since 18:12";
 *  no checkout: TRY_IT_ROW when the run can be tried, else ''. `checkout` is History's `{ members: [{ at, external }] }`. */
export function checkoutRowValue(checkout, { when = (iso) => String(iso || ''), canTry = true } = {}) {
  const ms = Array.isArray(checkout?.members) ? checkout.members : [];
  if (!ms.length) return canTry ? TRY_IT_ROW : '';
  const first = ms.map((m) => m.at).filter(Boolean).sort()[0] || null;
  const since = first ? ` · since ${when(first)}` : '';
  if (ms.every((m) => m.external === true)) return `${NOTICE_TITLES.linked}${since}`;
  return `${ms.length > 1 ? `${ms.length} local copies` : 'Local copy'} open${since}`;
}
