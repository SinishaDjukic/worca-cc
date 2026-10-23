// ui/public/run-head.mjs — slice 3: the run page card's status head (the page's status words, the head buttons, the
// View PR ▾ items) and its read-only three-step tracker, for both run pages. Pure: headModel / trackerModel read the
// facts app.js builds (headFactsOf); renderHeadButtons / renderTracker draw over the host's ownerDocument, never fetch.
import { icon } from './icons.mjs';
import { CREATE_PR_LABEL } from './ship-words.mjs';

// Watch PR (#619), moved from app.js: the tracker and the Overview's PR rows read one wording.
export const HD_PR_WATCH_ACTIVE = new Set(['starting', 'fixing', 'publishing']);
// Words only while the watch is doing something: the switch already says on or off.
export function hdPrWatchLabel(state) {
  if (HD_PR_WATCH_ACTIVE.has(state.status) && state.resolving) return 'Resolving conflicts';
  if (HD_PR_WATCH_ACTIVE.has(state.status) && state.mergingBase) return `Merging ${state.mergingBase} in`;
  if (!state.watching) return HD_PR_WATCH_ACTIVE.has(state.status) ? 'Disabled (finishing)' : '';
  if (HD_PR_WATCH_ACTIVE.has(state.status)) return 'Fixing';
  return state.status === 'needs-person' ? 'Needs a person' : '';
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

/** GitHub's verdict (GET /api/pr/checks `status.label`) as the In review detail: "Review required" reads as a wait. */
export function verdictWords(status) {
  const label = status && typeof status.label === 'string' ? status.label : '';
  if (!label) return '';
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
  const base = f.base || 'the base branch';
  const tryIt = f.canTry ? [btn('try', 'Try it', { title: 'Check out the branch on this machine' })] : [];
  const pr = f.pr && f.pr.url ? f.pr : null;
  const s = upper(pr);
  if (s === 'MERGED') return { ...NONE, key: 'merged', status: { line: `Merged · your changes are in ${base}` }, cta: { state: 'merged', href: pr.url, menu: true } };
  if (s === 'OPEN') {
    const cta = { state: 'view', href: pr.url, menu: true };
    const w = f.prStatus && f.prStatus.watch;
    if (watchStopped(m)) {
      // The model's own line (`Needs you · Watch stopped · 3 fix runs, …`), the Runs list's words: status null keeps it.
      // The disabled button's reason is also visible text on the tracker's PR step (prSecond), not only its title.
      return { ...NONE, key: 'watch-stopped', status: null, cta,
        after: [btn('ask-changes', 'Ask for changes', { primary: true, disabled: true, title: ASK_IN_CHAT })] };
    }
    if (m.pr && m.pr.id === 'conflicts') {
      return { ...NONE, key: 'conflicts', status: { ...AMBER, line: `Needs you · conflicts with ${base}` }, cta,
        after: showsFixConflicts(m, w) ? [btn('fix-conflicts', 'Fix conflicts', { primary: true, title: 'Merge the base branch into this pull request in a fix run, then push' })] : [] };
    }
    const words = verdictWords(f.prStatus && f.prStatus.status);
    return { ...NONE, key: 'in-review', status: m.state === 'in-review' ? { line: words ? `In review · ${words}` : 'In review' } : null, cta };
  }
  if (f.notMergedBack) {
    return { ...NONE, key: 'not-merged-back', status: { ...AMBER, line: `Needs you · not merged back into ${f.source}` },
      before: [btn('how-to-merge', 'How to merge')], cta: f.canCreatePr ? { state: 'create' } : null };
  }
  if (f.push) return { ...NONE, key: 'push', status: { line: `Ready to ship · in ${f.source} here, not on the remote` }, before: tryIt, cta: { state: 'push', label: `Push ${f.source}` } };
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
    cta: { state: 'view', label: 'View PRs', menu: true, ws: true },
    after: f.canCreatePr ? [btn('ship', CREATE_PR_LABEL, { primary: true, icon: 'pr-create' })] : [] };
}

const N = (node, label, second) => ({ node, label, ...(second && second.length ? { second } : {}) });
/** The tracker's Watch words (D16): status only; the ▾ menu edits Watch. */
export function trackerWatchWords(w, { idle = true } = {}) {
  if (!w) return null;
  if (w.status === 'needs-person') return { text: 'Watch stopped', tone: 'bad' };
  const doing = hdPrWatchLabel(w);
  if (doing) return { text: doing, tone: 'run' };
  return w.watching && idle ? { text: 'Watching', tone: '' } : null;   // idle words only where the switch lives (D16)
}
function changesStep(f) {
  const m = f.m;
  // Same order as headModel: live first, then kept work (its links are the only Download patch / Commit it yourself),
  // then failed. A failed run with kept work keeps its red failed node and still carries the kept links.
  // A workspace member row passes `live` read once from the run-level model (its own prNeeds is only its PR step's).
  if (f.live !== undefined ? f.live : isLive(m)) return { ...N('working', 'Changes'), pulse: !!m.pulse };
  if (f.kept) return N(m.state === 'failed' ? 'failed' : 'problem', 'Changes', [
    ...(f.kept.recovery && f.kept.recovery.href ? [{ kind: 'patch', text: 'Download patch', href: f.kept.recovery.href, download: f.kept.recovery.download || '' }] : []),
    { kind: 'commit', text: 'Commit it yourself' }]);
  if (m.state === 'failed') return N('failed', 'Changes');
  return null;
}
function prSecond(f, pr) {
  const out = [{ kind: 'pr', text: `#${pr.number}`, href: pr.url }];
  const s = f.prStatus || {};
  const v = s.status;
  if (v && v.label) out.push({ kind: 'text', text: v.label, tone: v.tone === 'bad' ? 'bad' : v.tone === 'run' ? 'run' : '' });
  if (v && v.label && v.detail) out.push({ kind: 'text', text: v.detail, tone: '' });
  const adv = ADV.has(f.level);
  const ww = trackerWatchWords(s.watch, { idle: adv });
  // At Advanced the words open the ▾ menu (its Watch switch); below it they are plain text (no Watch item there).
  if (ww) out.push(adv ? { kind: 'watch', ...ww } : { kind: 'text', text: ww.text, tone: ww.tone });
  // Watch stopped: the head's disabled Ask for changes explains itself here in visible text (touch and keyboard too).
  if (!f.workspace && f.m && watchStopped(f.m)) out.push({ kind: 'text', text: ASK_IN_CHAT, tone: '' });
  if (s.watch && HD_PR_WATCH_ACTIVE.has(s.watch.status) && s.watch.activePipelineId) out.push({ kind: 'fix-run', text: 'View fix run', pid: s.watch.activePipelineId });
  if (s.resolveError) out.push({ kind: 'text', text: s.resolveError, tone: 'bad' });
  return out;
}
function prPath(f, pr = f.pr && f.pr.url ? f.pr : null) {
  const merged = `Merged into ${f.base || 'the base branch'}`;
  const first = changesStep(f);
  if (first) return [first, N('future', 'Pull request'), N('future', merged)];
  const s = upper(pr);
  if (s === 'MERGED') return [N('done', 'Changes done'), N('done', 'Pull request', prSecond(f, pr)), N('merged', merged)];
  if (s === 'CLOSED') return [N('done', 'Changes done'), N('closed', 'Pull request', prSecond(f, pr)), N('future', merged)];
  if (s === 'OPEN') return [N('done', 'Changes done'), N(f.m.prNeeds ? 'problem' : 'ready', 'Pull request', prSecond(f, pr)), N('future', merged)];
  if (f.m.state === 'merged') return [N('done', 'Changes done'), N('future', 'Pull request'), N('merged', merged)];   // in its base, no PR of its own
  return [N('ready', 'Changes done'), N('future', 'Pull request'), N('future', merged)];
}
function pushPath(f) {
  const here = `In ${f.source || 'the source branch'} here`;
  const first = changesStep(f);
  if (first) return [first, N('future', here), N('future', 'On the remote')];
  return [N('done', 'Changes done'), N(f.notMergedBack ? 'problem' : 'ready', here), N('future', 'On the remote')];
}
function folderPath(f) {
  const label = 'Applied to your folder';
  const first = changesStep(f);
  if (first) return [first, N('future', label)];
  const st = f.folder ? f.folder.state : 'pending';
  return [N('done', 'Changes done'), N(st === 'applied' ? 'done' : st === 'discarded' ? 'closed' : 'ready', label)];
}
/** The tracker's rows, or null when it does not show (D15). */
export function trackerModel(f) {
  const st = f.m && f.m.state;
  if (st === 'waiting' || (st === 'stopped' && !f.kept)) return null;   // a stopped run's kept-work links stay reachable
  if (f.mode === 'folder') return { rows: [{ steps: folderPath(f) }] };
  if (f.mode === 'none' || !f.gitChrome) return null;
  if (f.workspace) {
    // Each member reads its OWN PR status: one member's conflicts or stopped watch marks only its row (prNeeds per member).
    const live = isLive(f.m);
    const rows = f.workspace.members.map((x) => {
      const st = x.prStatus || null;
      const needs = !!st && (st.mergeable === 'CONFLICTING' || !!(st.watch && st.watch.status === 'needs-person'));
      return { name: x.name, steps: prPath({ ...f, live, m:{ ...f.m, prNeeds: needs }, prStatus: st, watch: null }, x.pr && x.pr.url ? x.pr : null) };
    });
    return rows.length ? { rows } : null;
  }
  return { rows: [{ steps: f.push || f.notMergedBack ? pushPath(f) : prPath(f) }] };
}

const NODE_CLASS = Object.freeze({ done: 'is-done', working: 'is-current is-working', ready: 'is-current is-ready',
  merged: 'is-current is-merged', problem: 'is-problem', failed: 'is-failed', closed: 'is-closed', future: 'is-future' });
const NODE_GLYPH = Object.freeze({ done: 'check', merged: 'check', problem: 'alert', failed: 'alert', closed: 'x' });
const NODE_WORD = Object.freeze({ done: 'Done', working: 'In progress', ready: 'Current', merged: 'Merged', problem: 'Needs you',
  failed: 'Failed', closed: 'Closed', future: 'Not yet' });

/**
 * Paint the tracker into `host` (idempotent through a signature). Read-only: the only controls are its links and the
 * Watching / Commit it yourself buttons, whose calls come from `h` ({ onWatch(anchor), onFixRun(event, pid), onCommit() }).
 */
export function renderTracker(host, model, h = {}) {
  if (!host) return;
  host.hidden = !model;
  const sig = model ? JSON.stringify(model) : '';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  const doc = host.ownerDocument;
  host.replaceChildren(...(model ? model.rows.map((row) => trackerRow(doc, row, h)) : []));
}
function trackerRow(doc, row, h) {
  const wrap = doc.createElement('div');
  wrap.className = row.name ? 'rd-track-row has-name' : 'rd-track-row';
  if (row.name) { const n = doc.createElement('span'); n.className = 'rd-track-name'; n.textContent = row.name; n.title = row.name; wrap.append(n); }
  const ol = doc.createElement('ol');
  ol.className = 'rd-track-steps';
  row.steps.forEach((s, i) => {
    const li = doc.createElement('li');
    li.className = `rd-track-step ${NODE_CLASS[s.node]}`;
    if (s.node === 'working' || s.node === 'ready' || s.node === 'merged') li.setAttribute('aria-current', 'step');
    const dot = doc.createElement('span');
    dot.className = `rd-track-dot ${NODE_CLASS[s.node]}${s.pulse ? ' is-pulse' : ''}`;
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', NODE_WORD[s.node]);
    if (NODE_GLYPH[s.node]) dot.append(icon(doc, NODE_GLYPH[s.node], 10, 'ic rd-track-glyph'));
    const label = doc.createElement('span');
    label.className = 'rd-track-label';
    label.textContent = s.label;
    const head = doc.createElement('span');
    head.className = 'rd-track-head';
    head.append(dot, label);
    if (i < row.steps.length - 1) {
      const line = doc.createElement('span');
      line.className = s.node === 'done' ? 'rd-track-line is-done' : 'rd-track-line';
      line.setAttribute('aria-hidden', 'true');
      head.append(line);
    }
    li.append(head);
    if (s.second) li.append(trackerSecond(doc, s.second, h));
    ol.append(li);
  });
  wrap.append(ol);
  return wrap;
}
function trackerSecond(doc, parts, h) {
  const sub = doc.createElement('span');
  sub.className = 'rd-track-sub';
  for (const p of parts) {
    let el;
    if (p.kind === 'pr' || p.kind === 'patch' || p.kind === 'fix-run') {
      el = doc.createElement('a');
      el.className = p.kind === 'pr' ? 'rd-track-pr' : 'rd-track-link';
      el.href = p.kind === 'fix-run' ? (h.fixRunHref ? h.fixRunHref(p.pid) : '#') : p.href;
      if (p.kind === 'pr') { el.target = '_blank'; el.rel = 'noopener'; }
      if (p.kind === 'patch' && p.download) el.setAttribute('download', p.download);
      if (p.kind === 'fix-run') el.addEventListener('click', (e) => h.onFixRun && h.onFixRun(e, p.pid));
    } else if (p.kind === 'watch' || p.kind === 'commit') {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = `rd-track-act${p.kind === 'watch' ? ' rd-track-watch' : ''}${p.tone ? ` is-${p.tone}` : ''}`;
      if (p.kind === 'watch' && !p.tone) el.prepend(icon(doc, 'eye', 12, 'ic'));
      el.addEventListener('click', () => (p.kind === 'watch' ? h.onWatch && h.onWatch(el) : h.onCommit && h.onCommit()));
    } else {
      el = doc.createElement('span');
      el.className = p.tone ? `rd-track-tx is-${p.tone}` : 'rd-track-tx';
    }
    el.append(p.text);
    sub.append(el);
  }
  return sub;
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
 * and no Open item (the split's main half opens it).
 */
export function prMenuItems(prs, { level, onWatch, onCopy, onOpen, onResolve }) {
  const adv = level === 'advanced' || level === 'expert';
  const many = prs.length > 1;
  const items = [];
  for (const p of prs) {
    if (items.length) items.push({ sep: true });
    items.push({ header: many ? `${p.name} · Pull request #${p.number}` : `Pull request #${p.number}` });
    if (many) items.push({ label: `Open PR #${p.number}`, icon: 'external', onSelect: () => onOpen(p) });
    if (adv && p.open && p.watch) items.push({ switch: true, label: 'Watch', icon: 'eye', help: WATCH_HELP, checked: !!p.watch.watching, key: p.key, onToggle: (b) => onWatch(p, b) });
    // A read that failed outright (D9): say so instead of leaving Watch silently absent. Disabled items are skipped by
    // openMenu's arrow keys (its `enabled()` filter).
    else if (adv && p.open && p.watchFailed) items.push({ label: 'Watch unavailable', icon: 'eye', disabled: true, title: "Could not read this pull request's status" });
    items.push({ label: 'Copy PR link', icon: 'link', onSelect: () => onCopy(p) });
    if (p.conflicts) items.push({ label: 'Fix conflicts', icon: 'git', onSelect: () => onResolve(p) });
  }
  return items;
}
