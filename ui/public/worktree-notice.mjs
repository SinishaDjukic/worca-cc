// ui/public/worktree-notice.mjs — the summary card's live-worktree notice, on the run page's `.rd-glance` and
// History's `.hd-glance`, at every interface level. A finished run's branch is held by a live worktree in
// two cases:
//   - retained work: the end-of-run commit failed, so the work exists only in the worktree. This is the notice;
//   - a checkout: Actions › Check out, or a linked folder of the person's own. No notice: the Results › Actions
//     row says where the local copy stands (checkoutRowValue) and the Actions tab owns its controls.
// Pure: a model from the run's facts, and a renderer that takes `doc` and returns detached DOM. Git stderr
// and paths are data: textContent only, never innerHTML. app.js owns the calls and the host
// (paintWorktreeNotice).

const h = (doc, tag, cls, text) => {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
/** A notice button. `onClick(button)` receives the node, so a flow can show its busy state on it. */
const button = (doc, label, cls, onClick, tip) => {
  const b = h(doc, 'button', `btn btn-sm ${cls}`, label);
  b.type = 'button';
  if (tip) b.title = tip;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
  return b;
};
/** app.js shellSingleQuote: a path pasted into a POSIX shell. */
const sq = (v) => `'${String(v == null ? '' : v).replaceAll("'", "'\"'\"'")}'`;

export const NOTICE_TITLES = Object.freeze({
  retained: 'Commit failed: uncommitted work retained',
  linked: 'Linked to your folder',
});
const WHY = 'git keeps a branch in one folder at a time.';

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

/**
 * The notice's content (the host element, its role and its look belong to the caller). Retained work only: a
 * checkout has no glance notice (the Results › Actions row says it and the Actions tab owns its controls).
 * @param {object|null} model worktreeNoticeModel(…)
 * @param {{ doc: Document, handlers?: { onApply?, onDiscardRetained? },
 *   recovery?: { kind:'retained'|'diff', href:string, download?:string }|null, when?: (iso:string)=>string }} opts
 * @returns {DocumentFragment}
 */
export function renderWorktreeNotice(model, { doc, handlers = {}, recovery = null, when = (iso) => String(iso || '') } = {}) {
  const frag = doc.createDocumentFragment();
  // A checkout has no glance notice: the Results › Actions row says it and the Actions tab owns its controls.
  if (!model || model.kind !== 'retained') return frag;
  renderRetained(doc, frag, model, { handlers, recovery, when });
  return frag;
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

function renderRetained(doc, frag, model, { handlers, recovery, when }) {
  const one = model.members.length === 1 ? model.members[0] : null;
  frag.append(h(doc, 'h4', null, NOTICE_TITLES.retained));
  frag.append(h(doc, 'p', 'wt-lead', `The run's last changes could not be committed, so they exist only in ${one ? 'its worktree' : 'the worktrees below'}, not on ${one && one.branch ? one.branch : 'the run\'s branches'}. A pull request opened now would not include them.`));
  frag.append(h(doc, 'p', 'wt-refused', `Until you apply or discard the work, Check out, Archive and a new run on this branch are refused: ${WHY}`));
  const list = h(doc, 'ul', 'wt-members');
  for (const m of model.members) {
    const li = h(doc, 'li');
    if (m.label) li.append(h(doc, 'strong', null, m.label), doc.createTextNode(' · '));
    li.append(h(doc, 'span', 'wt-git', `git ${m.step}: ${m.message || 'failed'}`));
    li.append(h(doc, 'div', 'wt-path', `Worktree: ${m.dir || '(unknown)'}`));
    if (m.branch) li.append(h(doc, 'div', null, `Branch: ${m.branch} (the uncommitted work is not on it yet)`));
    if (m.at) li.append(h(doc, 'div', 'wt-since', `Since ${when(m.at)}`));
    list.append(li);
  }
  frag.append(list);
  const row = h(doc, 'div', 'wt-actions');
  if (!model.provisional && handlers.onApply) {
    row.append(button(doc, 'Apply to branch', 'btn-primary wt-apply', handlers.onApply,
      'Commit the retained work onto the branch in its worktree, where it is staged, then remove the worktree'));
  }
  if (recovery && recovery.href) {
    const span = h(doc, 'span', 'retained-patch-link');
    const a = h(doc, 'a', null, recovery.kind === 'diff' ? 'Download the run\'s diff patch' : 'Download the recovery patch');
    a.href = recovery.href;
    if (recovery.download) a.setAttribute('download', recovery.download);
    a.title = recovery.kind === 'diff' ? 'The diff the run recorded when it ended' : 'The snapshot taken when the work was retained';
    a.addEventListener('click', (e) => e.stopPropagation());
    span.append(a);
    row.append(span);
  }
  if (!model.provisional && handlers.onDiscardRetained) {
    row.append(button(doc, 'Discard worktree', 'btn hist-discard', handlers.onDiscardRetained,
      'Save a patch of anything uncommitted, then remove the worktree. The branch is kept.'));
  }
  if (row.childNodes.length) frag.append(row);
  const manual = h(doc, 'details', 'wt-manual');
  manual.append(h(doc, 'summary', null, 'Commit it yourself'));
  manual.append(h(doc, 'code', null, model.members
    .map((m) => `git -C ${sq(m.dir)} status\ngit -C ${sq(m.dir)} add -A\ngit -C ${sq(m.dir)} commit`).join('\n\n')));
  manual.append(h(doc, 'p', null, 'The changes are already staged in the worktree, so git status lists them under "Changes to be committed". After committing, Discard worktree removes the redundant worktree and clears this notice. A patch of anything still uncommitted is saved first.'));
  frag.append(manual);
}
