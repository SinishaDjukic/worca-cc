// ui/public/run-head.mjs — slice 3: the run page card's status head (the page's status words, the head buttons, the
// View PR ▾ items) and its read-only route of where the work is (s2), for both run pages. Pure: headModel / routeModel
// read the facts app.js builds (headFactsOf); renderHeadButtons / renderRoute draw over the host's ownerDocument, never
// fetch.
import { icon } from './icons.mjs';
import { copyButton } from './copy-button.mjs';
import { CREATE_PR_LABEL, VIEW_PRS_LABEL, viewPrLabel } from './ship-words.mjs';

// Watch PR (#619), moved from app.js: the route and the Overview's PR rows read one wording.
export const HD_PR_WATCH_ACTIVE = new Set(['starting', 'fixing', 'publishing']);
// Words only while the watch is doing something: the switch already says on or off.
export function hdPrWatchLabel(state) {
  if (HD_PR_WATCH_ACTIVE.has(state.status) && state.resolving) return 'Resolving conflicts';
  if (HD_PR_WATCH_ACTIVE.has(state.status) && state.mergingBase) return `Merging ${state.mergingBase} in`;
  if (!state.watching) return HD_PR_WATCH_ACTIVE.has(state.status) ? 'Disabled (finishing)' : '';
  if (HD_PR_WATCH_ACTIVE.has(state.status)) return 'Fixing';
  return state.status === 'needs-person' ? 'Needs a person' : '';
}

// Push (a run on its source branch): the label stays short (a long branch would widen the button past the card), the
// tooltip names the branch. `push` is the record's push state ({ state, remote }, refs only) or null.
export function pushLabel(push) { return push?.state === 'pushed' ? `Pushed to ${push.remote}` : 'Push'; }
export function pushTip(branch, push = null) {
  if (push?.state === 'pushed') return `${branch} is on ${push.remote}`;
  if (push?.state === 'diverged') return `${branch} and ${push.remote}/${branch} have diverged: pull or rebase ${branch}, then push`;
  return `Push to ${branch}`;
}

export const WATCH_HELP = 'Start a fix run when checks fail or a reviewer asks for changes';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const AMBER = Object.freeze({ state: 'needs-you', word: 'Needs you', dot: 'amber', symbol: null, pulse: false });
const GREEN = Object.freeze({ state: 'ready', word: 'Ready', dot: 'green', symbol: null, pulse: false });
const LIVE = new Set(['starting', 'working', 'paused', 'waiting']);
const btn = (id, label, extra = {}) => ({ id, label, ...extra });
const NONE = Object.freeze({ key: 'none', status: null, before: [], cta: null, after: [] });
const upper = (pr) => (pr ? String(pr.state || '').toUpperCase() : '');
const ADV = new Set(['advanced', 'expert']);
/** Today's Resolve rule, shared by the head and the ▾ menu: the watch answer is read, and no watch is fixing the
 *  conflict on its own (off, or waiting for a person). While the answer loads: false. */
export function canResolvePr(w) {
  return !!w && (!w.watching || w.status === 'needs-person');
}
/** A live run, or a run asking a question (needs-you with no PR reason): no head, a working Changes node. Teardown has
 *  not run yet, so no kept work or folder copy can exist here. */
const isLive = (m) => LIVE.has(m.state) || (m.state === 'needs-you' && !m.prNeeds);
/** The model's Watch-stopped state (runModel gives it `ask-changes`): the head shows Ask for changes, not Fix conflicts. */
const watchStopped = (m) => (m.actions || []).includes('ask-changes');
export const ASK_IN_CHAT = "Ask for changes from the run's chat";
/** The ONE Fix conflicts rule (R-ux-4): the head's conflicts button and the single-PR ▾ item both read it, so the menu
 *  offers Fix conflicts exactly when the head does. */
export function showsFixConflicts(m, w) {
  return !!m && !watchStopped(m) && !!(m.pr && m.pr.id === 'conflicts') && canResolvePr(w);
}

// GitHub's verdicts that are not the checks line (git-info.mjs prMergeStatus): with one of them as the label, the checks
// line is the `detail`; otherwise the label IS the checks line.
const VERDICTS = new Set(['Draft', 'Merge conflicts', 'Changes requested', 'Review required', 'Out of date with the base branch',
  'Blocked by branch rules', 'Ready to merge']);

/** GitHub's verdict (GET /api/pr/checks `status.label`) as the In review detail: "Review required" reads as a wait. A
 *  label that is the checks line ("Checks running · 7 of 12 done") is the route's, never the head's: ''. */
export function verdictWords(status) {
  const label = status && typeof status.label === 'string' ? status.label : '';
  if (!VERDICTS.has(label)) return '';
  return label === 'Review required' ? 'waiting for a review' : label[0].toLowerCase() + label.slice(1);
}
/** "Build · failed · Implementation" (the model) → "Failed · Build · Implementation" (the request's page line). */
const failedLine = (line) => {
  const m = /^(.*?) · failed(?: · (.*))?$/.exec(String(line || ''));
  return m ? ['Failed', m[1], m[2]].filter(Boolean).join(' · ') : '';
};

/**
 * The card head for one run: `status` overrides the page model's dot / word / line (null keeps the model's),
 * `before` and `after` are head buttons around the PR control `cta` (paintPrCta's state, or null).
 * @param {object} f headFactsOf(…) in app.js
 */
export function headModel(f) {
  const m = f.m || {};
  // Only a truly live run (or one asking a question) comes before the kept work: kept work and a pending folder copy
  // are recovery the glance has no other home for (the banners are gone), and teardown leaves them on a run whose
  // state is failed, stopped or done alike, so they are tested before the failed and stopped heads.
  if (isLive(m)) return { ...NONE, key: 'live' };
  const report = m.state === 'failed' ? [btn('report', 'Report', { title: 'Report this run' })] : [];
  const failed = m.state === 'failed' ? failedLine(m.line) : '';
  if (f.kept) {
    const act = !f.kept.provisional;
    // A failed run keeps its failure line (the bigger news) and its Report; any other run reads the amber kept line.
    const status = m.state === 'failed' ? (failed ? { line: failed } : null) : { ...AMBER, line: 'Needs you · the changes could not be committed' };
    return { key: 'kept', status, cta: null,
      before: act ? [btn('discard-kept', 'Discard', { title: 'Save a patch of anything uncommitted, then remove the local copy. The branch is kept.' })] : [],
      after: [...(act ? [btn('apply-kept', 'Apply to branch', { primary: true, title: 'Commit the kept work onto the branch, then remove the local copy' })] : []), ...report] };
  }
  if (f.folder && f.folder.state === 'pending') {
    // A pending copy is offered on a failed or stopped run too (the old .rd-apply-slot showed whenever applyBarModel did).
    return { key: 'folder', status: m.state === 'failed' ? (failed ? { line: failed } : null) : { ...GREEN, line: `Ready · ${plural(f.folder.total, 'file')} changed in a copy` }, cta: null,
      before: [btn('discard-folder', 'Discard')], after: [btn('apply-folder', 'Apply to folder', { primary: true }), ...report] };
  }
  if (m.state === 'failed') return { ...NONE, key: 'failed', status: failed ? { line: failed } : null, after: report };
  if (m.state === 'stopped') return { ...NONE, key: 'stopped' };
  if (!f.gitChrome) return NONE;
  if (f.workspace) return workspaceHead(f);
  // D2: the merged / ready / closed lines say where the work lands; conflicts are with the PR's real base.
  const base = landingOf(f) || 'the base branch';
  const prBase = f.base || base;
  const tryIt = f.canTry ? [btn('try', 'Try it', { title: 'Check out the branch on this machine' })] : [];
  const pr = f.pr && f.pr.url ? f.pr : null;
  const s = upper(pr);
  // The base branch is the route's: the head says only the state.
  if (s === 'MERGED') return { ...NONE, key: 'merged', status: { line: 'Merged' }, cta: { state: 'merged', href: pr.url, menu: true } };
  if (s === 'OPEN') {
    const cta = { state: 'view', href: pr.url, menu: true };
    const w = f.prStatus && f.prStatus.watch;
    if (watchStopped(m)) {
      // "Watch stopped" is the route's pull request row (with the disabled button's reason, visible text, not only its
      // title): the head says only Needs you. The Runs list and the chat card keep the model's full line.
      return { ...NONE, key: 'watch-stopped', status: { line: 'Needs you' }, cta,
        after: [btn('ask-changes', 'Ask for changes', { primary: true, disabled: true, title: ASK_IN_CHAT })] };
    }
    if (m.pr && m.pr.id === 'conflicts') {
      return { ...NONE, key: 'conflicts', status: { ...AMBER, line: `Needs you · conflicts with ${prBase}` }, cta,
        after: showsFixConflicts(m, w) ? [btn('fix-conflicts', 'Fix conflicts', { primary: true, title: 'Merge the base branch into this pull request in a fix run, then push' })] : [] };
    }
    const words = verdictWords(f.prStatus && f.prStatus.status);
    return { ...NONE, key: 'in-review', status: m.state === 'in-review' ? { line: words ? `In review · ${words}` : 'In review' } : null, cta };
  }
  if (f.notMergedBack) {
    return { ...NONE, key: 'not-merged-back', status: { ...AMBER, line: `Needs you · not merged back into ${f.source}` },
      before: [btn('how-to-merge', 'How to merge')], cta: f.canCreatePr ? { state: 'create' } : null };
  }
  // The tracker's Push labels ("In {source} here", "On the remote") say where the work is.
  if (f.push) return { ...NONE, key: 'push', status: { line: 'Ready to ship' }, before: tryIt, cta: { state: 'push', label: pushLabel(f.pushState), title: pushTip(f.source, f.pushState),
    disabled: f.pushState?.state === 'pushed' || f.pushState?.state === 'diverged' } };
  if (m.state !== 'ready') return { ...NONE, key: m.state };             // merged into its base without a PR (inBase)
  const cta = f.prInput === 'PENDING' ? { state: 'pending' } : f.canCreatePr ? { state: 'create' } : null;
  if (s === 'CLOSED') return { ...NONE, key: 'pr-closed', status: { line: 'Ready to ship · the PR was closed' }, before: tryIt, cta };
  return { ...NONE, key: 'ready', status: { line: `Ready to ship · not in ${base} yet` }, before: tryIt, cta };
}

function workspaceHead(f) {
  const prs = f.workspace.members.filter((x) => x.pr && x.pr.url);
  const ship = f.canCreatePr ? { state: 'create' } : null;
  if (!prs.length) return { ...NONE, key: 'workspace', cta: f.prInput === 'PENDING' ? { state: 'pending' } : ship };
  const merged = prs.filter((x) => upper(x.pr) === 'MERGED').length;
  const open = prs.some((x) => upper(x.pr) === 'OPEN');
  return { ...NONE, key: 'workspace', status: open && f.m.state === 'in-review' ? { line: `In review · ${merged} of ${prs.length} merged` } : null,
    cta: { state: 'view', label: VIEW_PRS_LABEL, menu: true, ws: true },
    after: f.canCreatePr ? [btn('ship', CREATE_PR_LABEL, { primary: true, icon: 'pr-create' })] : [] };
}

/** One ship flow (slice 2): a feature's or a chain's head, in workspaceHead's shape. `state`: groupModel's; `prs`:
 *  groupPrList(row). Create PR while no run has a PR; View PR ▾ for one PR, View PRs ▾ for several; while the group
 *  is still ready (a partly shipped chain) Create PR stays as a head button beside them. */
export function groupHead({ state, prs }) {
  const ready = state === 'ready';
  if (!prs.length) return { ...NONE, key: 'group', cta: ready ? { state: 'create' } : null };
  const cta = prs.length === 1
    ? { state: prs[0].merged ? 'merged' : 'view', href: prs[0].url, menu: true }
    : { state: 'view', label: VIEW_PRS_LABEL, menu: true, ws: true };
  return { ...NONE, key: 'group', cta, after: ready ? [btn('ship', CREATE_PR_LABEL, { primary: true, icon: 'pr-create' })] : [] };
}

/** The route's Watch words (D16): status only; the ▾ menu edits Watch. */
export function trackerWatchWords(w, { idle = true } = {}) {
  if (!w) return null;
  if (w.status === 'needs-person') return { text: 'Watch stopped', tone: 'bad' };
  const doing = hdPrWatchLabel(w);
  if (doing) return { text: doing, tone: 'run' };
  return w.watching && idle ? { text: 'Watching', tone: '' } : null;   // idle words only where the switch lives (D16)
}

const CHECKS_TONE = Object.freeze({ failing: 'bad', pending: 'run', passing: 'ok' });
/** The route's Watch parts for one PR status: its words (a ▾ opener at Advanced and up), the fix run's link. */
function watchParts(s, adv) {
  if (!s) return [];
  const out = [];
  const ww = trackerWatchWords(s.watch, { idle: adv });
  if (ww) out.push(adv ? { kind: 'watch', ...ww } : { kind: 'text', text: ww.text, tone: ww.tone });
  if (s.watch && HD_PR_WATCH_ACTIVE.has(s.watch.status) && s.watch.activePipelineId) out.push({ kind: 'fix-run', text: 'View fix run', pid: s.watch.activePipelineId });
  return out;
}

const NODE_WORD = Object.freeze({ done: 'Done', working: 'In progress', ready: 'Current', merged: 'Merged', problem: 'Needs you',
  review: 'With reviewers', failed: 'Failed', closed: 'Closed', future: 'Not yet' });

// "Where the work is" (s2): the places the run's work passes through, in order, each with its state and one quiet line.
const KIND_ICON = Object.freeze({ branch: 'git', pr: 'pull-request', target: 'merge', remote: 'remote', folder: 'folder' });
const SEP = Object.freeze({ kind: 'sep', text: ' · ' });
const txt = (text, tone = '') => [{ kind: 'text', text, ...(tone ? { tone } : {}) }];
const mono = (text) => [{ kind: 'mono', text }];
/** Part groups joined by " · "; a group whose first part starts its own line (`line`) takes no separator. */
const sep = (...groups) => groups.filter((g) => g && g.length).flatMap((g, i) => (i && !g[0].line ? [SEP, ...g] : g));
const row = (kind, state, place, second, extra = {}) => ({ kind, state, place, second, ...extra });
const DONEISH = new Set(['done', 'merged']);
const CURRENT = new Set(['working', 'problem', 'review', 'failed']);
const OWN = "This run's branch";
const repos = (n) => `${n} ${n === 1 ? 'repository' : 'repositories'}`;

/** "owner/repo#N" from a GitHub pull request URL; "#N" for any other host. */
export function prRef(pr) {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(String((pr && pr.url) || ''));
  return m ? `${m[1]}#${m[2]}` : `#${(pr && pr.number) || ''}`;
}

/** Where the run's work lands (D2): a run that builds on the run before it lands in its feature's or chain's base
 *  (the first run's source), never in that run's branch; otherwise the group's base, else the PR's real base, else the
 *  source. '' when unknown, while builds-on is unknown (null), and while the group lists are still loading: f.base may
 *  then be the previous run's branch. */
export function landingOf(f) {
  const g = f && f.group;
  if (g && (g.buildsOn || g.buildsOn === null)) return g.root || '';
  if (!g && f && f.groupPending) return '';
  return (g && g.root) || (f && f.base) || '';
}

/**
 * The run's place in its feature or chain (D3), from app.js groupHomeOf(pid) and the History rows (`histOf`), or
 * null outside one (a user group's runs are independent). Pure.
 * @param {{ row:{groupKind:string,members:object[]}, member:object, position:number, total:number }|null} home
 */
export function routeGroupOf(home, { sourceBranch = '', histOf = () => null } = {}) {
  const grp = home && home.row;
  if (!grp || !home.member || (grp.groupKind !== 'feature' && grp.groupKind !== 'chain')) return null;
  const members = grp.members;
  const i = members.indexOf(home.member);
  const prev = i > 0 ? members[i - 1] : null;
  const ph = prev ? histOf(prev.pipelineId) : null;
  const prevBranch = (ph && ph.branch) || '';
  // Started from the previous run's branch: compare the branches when History knows them, else the chain's own flag;
  // null (unknown) when neither is there (an archived or not yet loaded previous row, a feature member has no flag).
  const flag = home.member.stacks;
  const buildsOn = !prev ? false : prevBranch ? prevBranch === sourceBranch : typeof flag === 'boolean' ? flag : null;
  const first = i > 0 ? histOf(members[0].pipelineId) : null;
  const root = i > 0 ? (first && first.sourceBranch) || '' : sourceBranch;
  const urlOf = (x) => { const h = histOf(x.pipelineId); return (h && h.pr && h.pr.url) || ''; };
  const own = urlOf(home.member);
  // D4: the one PR is stored on every member; a stacked PR is the member's own.
  const shipMode = !own ? null : members.filter((x) => urlOf(x) === own).length > 1 ? 'one' : 'stacked';
  return { kind: grp.groupKind, position: home.position, total: home.total,
    prev: prev ? { label: `Run ${prev.position}`, href: prev.href || '' } : null,
    buildsOn, root, shipMode, prevPrMerged: !!(ph && ph.pr && upper(ph.pr) === 'MERGED') };
}

/** The run's own branch row: where the agents work, then what is left on it. */
function branchRow(f) {
  const m = f.m || {};
  const g = f.group;
  const name = f.branch || '';
  const place = name ? mono(name) : txt(OWN);
  const copy = { copy: name || null };
  const builds = g && g.buildsOn && g.prev ? [{ kind: 'text', text: 'builds on ' }, { kind: 'run', text: g.prev.label, href: g.prev.href }] : [];
  const own = sep(name ? txt(OWN) : [], builds);
  if (isLive(m)) {
    if (!name) return row('branch', 'future', place, txt('Created when the agents start building'));
    return row('branch', 'working', place, sep(own, txt('the agents are working here')), { ...copy, pulse: !!m.pulse });
  }
  if (f.kept) {
    const patch = f.kept.recovery && f.kept.recovery.href
      ? [{ kind: 'patch', text: 'Download patch', href: f.kept.recovery.href, download: f.kept.recovery.download || '' }] : [];
    return row('branch', m.state === 'failed' ? 'failed' : 'problem', place,
      sep(txt('Changes not committed', 'bad'), patch, [{ kind: 'commit', text: 'Commit it yourself' }]), copy);
  }
  if (m.state === 'failed') return row('branch', 'failed', place, own.length ? own : txt('The run stopped here'), copy);
  return row('branch', 'done', place, builds.length ? own : sep(own, txt('changes done')), copy);
}

/** The PR row's second line (today's prSecond): the checks line in its colour (GitHub's verdict stays in the status
 *  line), `note`, the Watch words (a ▾ opener at Advanced and up), View fix run, then the Watch-stopped hint and a
 *  failed Resolve's error, each on its own line. */
function prSecond(f, st, note = []) {
  const v = st.status;
  const text = v && v.label ? (v.detail || (VERDICTS.has(v.label) ? '' : v.label)) : '';
  const tone = CHECKS_TONE[st.checks && st.checks.state] || (v && ['bad', 'run', 'ok'].includes(v.tone) ? v.tone : '');
  return sep(text ? txt(text, tone) : [], note, ...watchParts(st, ADV.has(f.level)).map((p) => [p]),
    watchStopped(f.m) ? [{ kind: 'text', text: ASK_IN_CHAT, line: true }] : [],
    st.resolveError ? [{ kind: 'text', text: st.resolveError, tone: 'bad', line: true }] : []);
}

function prRoute(f) {
  const m = f.m || {};
  const g = f.group;
  const live = isLive(m);
  const ended = !live && (m.state === 'failed' || m.state === 'stopped' || !!f.kept);   // the work goes no further
  const pr = !live && f.pr && f.pr.url ? f.pr : null;
  const s = upper(pr);
  const landing = landingOf(f);
  const target = landing ? mono(landing) : txt(g ? `The ${g.kind}'s base branch` : 'The base branch');
  // In its base without a PR of its own: never for a run that builds on another run's branch, nor while that is not
  // known yet (D2).
  const merged = s === 'MERGED' || (!pr && m.state === 'merged' && !(g && g.buildsOn !== false) && !(!g && f.groupPending));
  const stackedOn = !!pr && !!g && g.shipMode === 'stacked' && g.buildsOn && !!g.prev && !g.prevPrMerged;
  const rows = [branchRow(f)];
  if (pr) {
    const one = !!g && g.shipMode === 'one';
    const note = one ? txt(`carries all ${g.total} runs`) : stackedOn ? txt(`stacked on ${g.prev.label}'s pull request`) : [];
    const st = f.prStatus || {};
    const second = s === 'OPEN' ? prSecond(f, st, note)
      : sep(txt(s === 'MERGED' ? 'Merged' : 'Closed without merging'), note,
        st.resolveError ? [{ kind: 'text', text: st.resolveError, tone: 'bad', line: true }] : []);
    rows.push(row('pr', s === 'MERGED' ? 'done' : s === 'CLOSED' ? 'closed' : m.prNeeds || watchStopped(m) ? 'problem' : 'review',
      [{ kind: 'text', text: one ? `The ${g.kind}'s pull request` : 'Pull request' }, { kind: 'link', text: prRef(pr), href: pr.url }], second));
  } else {
    const line = ended || merged ? 'Not opened'
      : g ? `Opens from the ${g.kind}'s Ship card once all ${g.total} runs are done`
        : live ? 'Opens when the changes are done'
          : f.prInput === 'PENDING' ? 'Opening' : f.canCreatePr ? `Not opened yet · ${CREATE_PR_LABEL} from the button above` : 'Not opened';
    rows.push(row('pr', 'future', txt('Pull request'), txt(line)));
  }
  const tLine = merged ? 'Merged here'
    : ended || s === 'CLOSED' ? 'Not merged'
      : g && !pr ? `Lands here when the ${g.kind} ships`
        : stackedOn ? `Lands here after ${g.prev.label}'s pull request merges`
          : 'Lands here when the pull request is merged';
  rows.push(row('target', merged ? 'merged' : 'future', target, txt(tLine)));
  const link = pr ? [{ kind: 'link', text: prRef(pr), href: pr.url }] : [];
  const fold = merged ? { state: 'merged', kind: 'target', parts: sep([{ kind: 'text', text: 'Merged into ' }, ...(landing ? mono(landing) : txt('the base branch'))], link) }
    : s === 'CLOSED' && !ended ? { state: 'closed', kind: 'pr', parts: [...link, { kind: 'text', text: ' closed without merging' }] }
      : null;
  return finish(rows, fold);
}

function pushRoute(f) {
  const src = f.source || '';
  const ps = (f.pushState && f.pushState.state) || '';
  const remote = (f.pushState && f.pushState.remote) || 'origin';
  const here = src ? mono(src) : txt('The source branch');
  const rows = f.notMergedBack
    ? [branchRow(f), row('branch', 'problem', here, txt('Not merged back yet · How to merge from the button above'))]
    : [row('branch', 'done', here, txt('Committed here on this machine'), { copy: src || null })];
  const there = src ? mono(`${remote}/${src}`) : txt(`On ${remote}`);
  rows.push(row('remote', ps === 'pushed' ? 'done' : ps === 'diverged' ? 'problem' : 'future', there,
    txt(ps === 'pushed' ? 'Pushed' : ps === 'diverged' ? pushTip(src, f.pushState)
      : f.notMergedBack ? 'Not pushed yet' : 'Not pushed yet · Push from the button above')));
  const fold = ps === 'pushed' && !f.notMergedBack ? { state: 'done', kind: 'remote', parts: [{ kind: 'text', text: 'Pushed to ' }, ...there] } : null;
  return finish(rows, fold);
}

function folderRoute(f) {
  const m = f.m || {};
  const live = isLive(m);
  const st = (f.folder && f.folder.state) || 'pending';
  const total = (f.folder && f.folder.total) || 0;
  const dir = (f.folder && f.folder.dir) || '';
  const copy = row('folder', live ? 'working' : m.state === 'failed' ? 'failed' : 'done', txt("The run's copy"),
    txt(live ? 'The agents are working here' : total ? `${plural(total, 'file')} changed` : 'No files changed'), live ? { pulse: !!m.pulse } : {});
  const target = row('folder', st === 'applied' && !live ? 'done' : st === 'discarded' && !live ? 'closed' : 'future', dir ? mono(dir) : txt('Your folder'),
    live ? txt('Apply or Discard once the run is done') : st === 'applied' ? txt('Applied')
      : st === 'discarded' ? txt('Discarded, your folder was not changed')
        : sep(txt('Ready to apply', 'ok'), txt('Apply or Discard from the button above')));
  const fold = live ? null : st === 'applied' ? { state: 'done', kind: 'folder', parts: [{ kind: 'text', text: 'Applied to ' }, ...(dir ? mono(dir) : txt('your folder'))] }
    : st === 'discarded' ? { state: 'closed', kind: 'folder', parts: txt('Discarded, your folder was not changed') } : null;
  return finish([copy, target], fold);
}

function memberRow(f, x, live) {
  const name = { kind: 'text', text: x.name, strong: true };
  if (live) return row('branch', 'working', [name, ...(x.branch ? mono(x.branch) : [])], txt('The agents are working here'));
  if (x.affected === false) return row('branch', 'future', [name], txt('No changes in this repository'));   // its branch was dropped
  const place = [name, ...(x.branch ? mono(x.target ? `${x.branch} → ${x.target}` : x.branch) : [])];
  const pr = x.pr && x.pr.url ? x.pr : null;
  if (!pr) return row('branch', 'done', place, txt('Changes done · pull request not opened'));
  const s = upper(pr);
  const st = x.prStatus || {};
  const conflicts = st.mergeable === 'CONFLICTING';
  const needs = conflicts || !!(st.watch && st.watch.status === 'needs-person');   // each member reads its OWN status
  const word = s === 'MERGED' ? txt('merged', 'merged') : s === 'CLOSED' ? txt('closed without merging')
    : conflicts ? txt(`conflicts with ${x.target || 'the base branch'}`, 'bad') : [];
  return row('pr', s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : needs ? 'problem' : 'review', place,
    sep([{ kind: 'text', text: 'Pull request ' }, { kind: 'link', text: prRef(pr), href: pr.url }], word,
      ...(s === 'OPEN' ? watchParts(st, ADV.has(f.level)).map((p) => [p]) : [])));
}

function workspaceRoute(f) {
  const live = isLive(f.m);
  const members = f.workspace.members;
  if (!members.length) return null;
  const changed = members.filter((x) => x.affected !== false);
  const merged = changed.filter((x) => upper(x.pr) === 'MERGED');
  const fold = !live && changed.length && merged.length === changed.length
    ? { state: 'merged', kind: 'target', parts: sep(txt(`Merged in ${repos(merged.length)}`), ...merged.map((x) => [{ kind: 'link', text: prRef(x.pr), href: x.pr.url }])) }
    : null;
  return finish(members.map((x) => memberRow(f, x, live)), fold);
}

/** D12: the current row is the first that is in progress, needs someone or failed, else the last that is not future. */
function finish(rows, fold = null) {
  let current = rows.findIndex((r) => CURRENT.has(r.state));
  if (current < 0) for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].state !== 'future') { current = i; break; }
  return { rows, fold, current };
}

/**
 * The route under the card head, or null when it does not show (a run that never started, a stopped run with no kept
 * work, a project without git or folder mode). `fold` is the one-line summary at an end state, else null.
 * @param {object} f headFactsOf(…) in app.js
 */
export function routeModel(f) {
  const st = f && f.m && f.m.state;
  if (!st || st === 'waiting' || (st === 'stopped' && !f.kept)) return null;
  if (f.mode === 'folder') return folderRoute(f);
  if (f.mode === 'none' || !f.gitChrome) return null;
  if (f.workspace) return workspaceRoute(f);
  if (f.push || f.notMergedBack) return pushRoute(f);
  return prRoute(f);
}

export const ROUTE_OPEN_KEY = 'worca-cc.run.showRoute';
let routeOpenMemo = null;
/** D14: Show route is remembered once for every run (app.js liveViewWanted's pattern); default folded. */
export function routeOpenWanted(store = globalThis.localStorage) {
  try { return store.getItem(ROUTE_OPEN_KEY) === '1'; } catch { return routeOpenMemo === '1'; }
}
export function setRouteOpen(on, store = globalThis.localStorage) {
  const v = on ? '1' : '0';
  // The memo is the private-mode fallback only: a working store never sets it, so it cannot leak between tests.
  try { store.setItem(ROUTE_OPEN_KEY, v); } catch { routeOpenMemo = v; }
}
let routeLabelIds = 0;

/**
 * Paint routeModel's route into `host` (.rd-route), idempotent through a signature. `h`: { onCopy(btn, name),
 * onWatch(anchor), onCommit(), fixRunHref(pid), onFixRun(event, pid), storage? }. A rebuild refocuses the control that
 * had focus (its `data-route` key).
 */
export function renderRoute(host, model, h = {}) {
  if (!host) return;
  host.hidden = !model;
  const open = !!model && !!model.fold && routeOpenWanted(h.storage);
  const sig = model ? JSON.stringify([model, open]) : '';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  if (!model) { host.replaceChildren(); return; }
  const doc = host.ownerDocument;
  const had = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement.dataset.route || '' : '';
  const head = doc.createElement('div');
  head.className = 'rd-route-head';
  const label = doc.createElement('span');
  label.className = 'rd-route-label';
  // One id per host (both page templates carry a route), kept across rebuilds; the list is aria-labelledby it.
  if (!host.dataset.labelId) host.dataset.labelId = `rd-route-label-${(routeLabelIds += 1)}`;
  label.id = host.dataset.labelId;
  label.textContent = 'Where the work is';
  head.append(label);
  if (model.fold) {
    const t = doc.createElement('button');
    t.type = 'button';
    t.className = 'btn btn-sm btn-quiet rd-route-toggle';
    t.dataset.route = 'toggle';
    t.setAttribute('aria-expanded', String(open));
    const tx = doc.createElement('span');
    tx.textContent = open ? 'Hide route' : 'Show route';
    t.append(tx, icon(doc, open ? 'chevron-up' : 'chevron-down', 12));
    t.addEventListener('click', () => { setRouteOpen(!open, h.storage); renderRoute(host, model, h); });
    head.append(t);
  }
  host.replaceChildren(head, model.fold && !open ? foldLine(doc, model.fold, h) : routeList(doc, model, h, label.id));
  if (had) { const back = host.querySelector(`[data-route="${had}"]`); if (back) back.focus(); }
}

function routeDot(doc, kind, state, pulse = false) {
  const dot = doc.createElement('span');
  dot.className = `rd-route-dot is-${state}${pulse ? ' is-pulse' : ''}`;
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', NODE_WORD[state]);
  dot.append(icon(doc, KIND_ICON[kind], 11, 'ic rd-route-ic'));
  return dot;
}
function routeList(doc, model, h, labelId) {
  const ol = doc.createElement('ol');
  ol.className = 'rd-route-list';
  ol.setAttribute('aria-labelledby', labelId);   // the visible "Where the work is" label
  model.rows.forEach((r, i) => {
    const li = doc.createElement('li');
    li.className = `rd-route-row is-${r.state}`;
    const next = model.rows[i + 1];
    if (next && DONEISH.has(r.state) && DONEISH.has(next.state)) li.classList.add('is-linked');   // D13
    if (i === model.current) li.setAttribute('aria-current', 'step');
    const main = doc.createElement('div');
    main.className = 'rd-route-main';
    const place = doc.createElement('div');
    place.className = 'rd-route-place';
    r.place.forEach((p, j) => { if (j) place.append(' '); place.append(routePart(doc, p, h)); });
    if (r.copy) place.append(routeCopyButton(doc, r.copy, h));
    const second = doc.createElement('div');
    second.className = 'rd-route-second';
    for (const p of r.second) second.append(routePart(doc, p, h, i));   // focus keys watch-N / commit-N
    main.append(place, second);
    li.append(routeDot(doc, r.kind, r.state, r.pulse), main);
    ol.append(li);
  });
  return ol;
}
function foldLine(doc, fold, h) {
  const p = doc.createElement('p');
  p.className = `rd-route-fold is-${fold.state}`;
  const tx = doc.createElement('span');
  tx.className = 'rd-route-fold-tx';
  for (const x of fold.parts) tx.append(routePart(doc, x, h, 'fold'));
  p.append(routeDot(doc, fold.kind, fold.state), tx);
  return p;
}
/** D15: the one copy button (copy-button.mjs); the host's onCopy copies through copyFromButton (the tick, "Copied"). */
function routeCopyButton(doc, name, h) {
  const b = copyButton(doc, { name: `Copy branch name ${name}`, title: name, cls: 'rd-route-copy' });
  b.dataset.route = 'copy';
  b.addEventListener('click', () => { if (h.onCopy) h.onCopy(b, name); });
  return b;
}
/** One part: separators and words as text, a mono place (full text in title), links (a PR in a new tab, a run in the
 *  app), Download patch, View fix run, Watching ▾ and Commit it yourself. All text is set as text, never HTML.
 *  `at`: the row index, which makes a button's `data-route` focus key unique in the route. */
function routePart(doc, p, h, at = 0) {
  if (p.kind === 'sep') return doc.createTextNode(p.text);
  let el;
  if (p.kind === 'mono') {
    el = doc.createElement('span');
    el.className = 'rd-route-name';
    el.title = p.text;
  } else if (p.kind === 'link' || p.kind === 'run' || p.kind === 'patch' || p.kind === 'fix-run') {
    el = doc.createElement('a');
    el.className = 'rd-fact-link';
    el.href = p.kind === 'fix-run' ? (h.fixRunHref ? h.fixRunHref(p.pid) : '#') : p.href || '#';
    if (p.kind === 'link') { el.target = '_blank'; el.rel = 'noopener'; }
    if (p.kind === 'patch' && p.download) el.setAttribute('download', p.download);
    if (p.kind === 'fix-run') el.addEventListener('click', (e) => h.onFixRun && h.onFixRun(e, p.pid));
  } else if (p.kind === 'watch' || p.kind === 'commit') {
    el = doc.createElement('button');
    el.type = 'button';
    el.className = `rd-fact-act${p.kind === 'watch' ? ' rd-fact-watch' : ''}${p.tone ? ` is-${p.tone}` : ''}`;
    el.dataset.route = `${p.kind}-${at}`;
    if (p.kind === 'watch' && !p.tone) el.prepend(icon(doc, 'eye', 12, 'ic'));
    el.addEventListener('click', () => (p.kind === 'watch' ? h.onWatch && h.onWatch(el) : h.onCommit && h.onCommit()));
  } else {
    el = doc.createElement('span');
    el.className = `rd-fact-tx${p.tone ? ` is-${p.tone}` : ''}${p.strong ? ' is-strong' : ''}`;
  }
  if (p.line) el.classList.add('is-line');
  el.append(p.text);
  return el;
}

/** Paint head.before, the PR slot (kept: paintPrCta owns it) and head.after into `host` (.rd-head-acts). `h.onHead(id, button)`
 *  runs a button's flow. Rebuilt only when the buttons change; a rebuilt button that had focus gets it back. */
export function renderHeadButtons(host, head, slot, h = {}) {
  if (!host) return;
  const doc = host.ownerDocument;
  const all = [...head.before, ...head.after];
  const sig = JSON.stringify(all);
  host.hidden = !all.length && !head.cta;
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  const had = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement.dataset.head || '' : '';
  const make = (b) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = b.primary ? 'btn btn-primary rd-head-btn' : 'btn rd-head-btn';
    el.dataset.head = b.id;
    if (b.icon) el.append(icon(doc, b.icon, 16));
    const tx = doc.createElement('span');
    tx.textContent = b.label;
    el.append(tx);
    if (b.title) el.title = b.title;
    if (b.disabled) el.disabled = true;
    el.addEventListener('click', () => { if (!el.disabled && h.onHead) h.onHead(b.id, el); });
    return el;
  };
  if (slot && slot.parentNode === host) {
    // The slot stays in place (an open View PR ▾ menu inside it keeps its focus): only its siblings are swapped.
    for (const c of [...host.children]) if (c !== slot) c.remove();
    slot.before(...head.before.map(make));
    slot.after(...head.after.map(make));
  } else host.replaceChildren(...head.before.map(make), ...(slot ? [slot] : []), ...head.after.map(make));
  if (had) { const back = host.querySelector(`[data-head="${had}"]`); if (back) back.focus(); }
}

/**
 * The View PR ▾ items (openMenu's shape). `prs`: [{ key, name, number, url, open, conflicts, watch, watchFailed }]
 * (watch: the PR's /api/pr/checks `watch`, or null; watchFailed: the read gave no answer at all); one PR has no name
 * and no Open item (the split's main half opens it). `onWatchAll(openPrs)` / `onCopyAll(prs)`: a group's Watch PRs and
 * Copy PR links after several PRs.
 */
export function prMenuItems(prs, { level, onWatch, onCopy, onOpen, onResolve, onWatchAll = null, onCopyAll = null }) {
  const adv = level === 'advanced' || level === 'expert';
  const many = prs.length > 1;
  const items = [];
  for (const p of prs) {
    if (items.length) items.push({ sep: true });
    items.push({ header: many ? `${p.name} · Pull request #${p.number}` : `Pull request #${p.number}` });
    if (many) items.push({ label: viewPrLabel(p.number), icon: 'external', onSelect: () => onOpen(p) });
    if (adv && p.open && p.watch) items.push({ switch: true, label: 'Watch', icon: 'eye', help: WATCH_HELP, checked: !!p.watch.watching, key: p.key, onToggle: (b) => onWatch(p, b) });
    // A read that failed outright (D9): say so instead of leaving Watch silently absent. Disabled items are skipped by
    // openMenu's arrow keys (its `enabled()` filter).
    else if (adv && p.open && p.watchFailed) items.push({ label: 'Watch unavailable', icon: 'eye', disabled: true, title: "Could not read this pull request's status" });
    items.push({ label: 'Copy PR link', icon: 'link', onSelect: () => onCopy(p) });
    if (p.conflicts) items.push({ label: 'Fix conflicts', icon: 'git', onSelect: () => onResolve(p) });
  }
  // A group's several PRs (D12): Watch every open one (Advanced and up) and copy every link. The workspace menu passes
  // neither, so it is unchanged.
  if (many && (onWatchAll || onCopyAll)) {
    items.push({ sep: true });
    const open = prs.filter((p) => p.open);
    if (adv && onWatchAll && open.length) items.push({ label: 'Watch PRs', icon: 'eye', onSelect: () => onWatchAll(open) });
    if (onCopyAll) items.push({ label: 'Copy PR links', icon: 'link', onSelect: () => onCopyAll(prs) });
  }
  return items;
}
