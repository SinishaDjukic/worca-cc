// ui/public/run-status-card.mjs — the one status block (runs redesign spec §3.4, §5.3): the chat run card, the run
// page (live and finished) and the group page draw the dot or symbol, the status line, the group bar, the current
// run's bar, the kind chip, the actions and the member rows from runModel / groupModel through this module. Pure DOM
// over the host's ownerDocument; app.js and chat/run-card.mjs bind the handlers.
import { paintStatusDot } from './status-dot.mjs';
import { paintProgressBar, paintChainBar } from './run-progress-bar.mjs';
import { prChip } from './runs-list.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { ACTION_LABEL } from '../../src/shared/run-model.mjs';
import { icon } from './icons.mjs';
import { CREATE_PR_LABEL } from './ship-words.mjs';

const BAR_STATES = new Set(['starting', 'working', 'needs-you', 'paused']);       // D20: the states the list draws a bar for
const GROUP_ENDED = new Set(['ready', 'in-review', 'merged']);
// View PR is navigation, never the primary (design system, PR controls).
const PRIMARY = new Set(['answer', 'resume', 'retry', 'start-now', 'ship']);
// A PR bar button leads with its icons.mjs glyph, 14px on .btn-sm.
const ACTION_ICON = Object.freeze({ ship: 'pr-create', 'open-pr': 'pull-request' });
// D5, D24: actions the model lists that have no flow yet. Shown (one model on every surface), but disabled with the
// reason. Ask for changes has one now (Shaper): each host says when it is not available there (disable['ask-changes']).
const UNAVAILABLE = Object.freeze({ retry: 'Start a new run to try again' });
const isGroup = (m) => !!(m && m.count && Array.isArray(m.members));
const textEl = (doc, tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; e.textContent = text; return e; };

/** D2: the visible status text. The word leads only when the line does not already state it (the model marks a
 *  round line, whose "Running" stands for Working, with lineSaysState). */
export function statusText(m) {
  const line = String((m && m.line) || '');
  const word = String((m && m.word) || '');
  const said = !word || !!(m && m.lineSaysState) || line.toLowerCase().includes(word.toLowerCase());
  return { word, line, text: said ? line || word : line ? `${word} · ${line}` : word };
}

/** D10: the kind chip. `row` is runs-list.mjs groupRow's output, or null for a single run. */
export function kindLabel(row) {
  if (!row || row.kind !== 'chain' || !row.model) return 'Run';
  const n = row.model.count.total;
  const kind = row.groupKind === 'feature' ? 'Feature' : row.groupKind === 'user' ? 'Group' : 'Chain';
  return `${kind} · ${n} run${n === 1 ? '' : 's'}`;
}

/** Paint the status block into `host` (idempotent): dot or symbol, status text, group bar, current run bar. */
export function paintRunStatus(host, m) {
  if (!host || !m) return;
  const doc = host.ownerDocument;
  if (!host.__rs) {
    host.classList.add('run-status');
    const head = textEl(doc, 'div', 'run-status-head', '');
    const dot = doc.createElement('span');
    const text = textEl(doc, 'span', 'run-status-text', '');
    head.append(dot, text);
    const group = textEl(doc, 'div', 'run-prog-chain run-status-group', '');
    const bar = textEl(doc, 'div', 'run-prog run-status-bar', '');
    group.hidden = true;
    bar.hidden = true;
    const roles = textEl(doc, 'div', 'run-status-roles', '');
    roles.hidden = true;
    host.append(head, roles, group, bar);
    host.__rs = { dot, text, group, bar, roles };
  }
  const { dot, text, group, bar } = host.__rs;
  host.dataset.state = m.state;
  host.dataset.word = m.word;
  host.dataset.line = m.line;
  paintStatusDot(dot, m);
  text.textContent = statusText(m).text;
  const g = isGroup(m);
  if (g && !GROUP_ENDED.has(m.state) && m.progress) {
    paintChainBar(group, { total: m.progress.total, fraction: m.progress.fraction, text: `${m.count.done} done` });
  } else group.hidden = true;
  const cur = g ? m.current : m;
  // A12: one row per role while role reviews run, or the one Refine line (role-review.mjs liveRoleRows).
  const roles = cur ? cur.roles : null;
  host.__rs.roles.hidden = !roles;
  if (roles) {
    host.__rs.roles.replaceChildren(...(roles.refine ? [textEl(doc, 'div', 'run-role-refine', roles.refine)]
      : roles.rows.map((x) => {
        const row = textEl(doc, 'div', 'run-role-row', '');
        const rdot = doc.createElement('span');
        rdot.className = `status-dot run-role-dot${x.live ? ' is-live' : ''}`;
        row.append(rdot, textEl(doc, 'span', 'run-role-name', x.label), textEl(doc, 'span', 'run-role-state', x.state));
        row.dataset.role = x.key;
        return row;
      })));
  }
  // A run in Needs you only through its PR has finished its pipeline, so it has no bar (an empty one read as 0%).
  const show = !!(cur && cur.progress && BAR_STATES.has(cur.state) && !cur.prNeeds);
  bar.hidden = !show;
  if (show) paintProgressBar(bar, cur.progress, { pulse: !!cur.pulse });
}

/**
 * D4: the actions of `m.actions`, in model order. `own` maps an action id to an existing element that keeps its own
 * handler; one element may stand for two ids (Pause / Resume). Every other id gets a small button made here (kept in
 * `host.__made`, never confused with an own element), which calls `onAction(id, button)`. Every action shown carries
 * data-model-action. Own elements that live inside `host` (the chat card's Pause / Stop) are ordered with the made
 * ones; own elements elsewhere (the run page's bar) are only shown or hidden.
 */
export function syncActions(host, m, { own = {}, pool = [], covered = {}, disable = {}, labels = {}, skip = [], onAction = () => {} } = {}) {
  if (!host) return;
  const doc = host.ownerDocument;
  // `skip`: actions this host leaves to another control (the run page's ⋯ owns Archive and Report, slice 2).
  const want = ((m && m.actions) || []).filter((id) => !skip.includes(id));
  host.__onAction = onAction;
  const made = host.__made || (host.__made = new Map());
  // `pool`: every existing button this host manages. One the model does not own is hidden here, so no painter's
  // last `hidden` value (a "Pause" left over from a run that has ended) survives.
  for (const b of new Set([...pool, ...Object.values(own)].filter(Boolean))) {
    const hit = want.find((id) => own[id] === b);
    b.hidden = !hit;
    if (hit) b.dataset.modelAction = hit; else delete b.dataset.modelAction;
  }
  // `covered`: an action already drawn elsewhere on this host (the glance's PR call-to-action). It is tagged, never
  // shown or hidden here, and no second button is made for it.
  for (const [id, e] of Object.entries(covered)) if (e) { if (want.includes(id)) e.dataset.modelAction = id; else delete e.dataset.modelAction; }
  const drawn = (id) => !!own[id] || !!covered[id];
  // An own element inside the host (the chat card's Resume) is ranked like a made one; one elsewhere keeps its
  // painter's look.
  const inHost = (id) => !!own[id] && own[id].parentNode === host;
  const primary = want.find((id) => PRIMARY.has(id) && (!drawn(id) || inHost(id))) || null;
  for (const b of new Set(Object.values(own).filter((o) => o && o.parentNode === host))) {
    b.classList.toggle('btn-primary', !!primary && own[primary] === b);
  }
  const order = [];
  for (const id of want) {
    const o = own[id];
    if (o) { if (o.parentNode === host && !order.includes(o)) order.push(o); continue; }
    if (covered[id]) continue;
    let b = made.get(id);
    if (!b) {
      b = doc.createElement('button');
      b.type = 'button';
      b.dataset.modelAction = id;
      b.addEventListener('click', () => { if (!b.disabled) host.__onAction(b.dataset.modelAction, b); });
      made.set(id, b);
    }
    // Run 4 (D2): a host may name an action after what it does here ("Approve 2 runs" for answer); set on every sync.
    const label = labels[id] || ACTION_LABEL[id] || id;
    if (b.textContent !== label) b.replaceChildren(...(ACTION_ICON[id] ? [icon(doc, ACTION_ICON[id], 14)] : []), label);
    // Set on every sync, so a reason that no longer holds (a run that finished pausing) re-enables the button.
    const why = UNAVAILABLE[id] || disable[id] || '';
    b.disabled = !!why;
    b.title = why;
    b.className = `btn btn-sm${id === primary ? ' btn-primary' : ''}`;
    order.push(b);
  }
  for (const [id, b] of made) if (!want.includes(id) || drawn(id)) { b.remove(); made.delete(id); }
  // Re-append only when the order changed: moving a focused button would drop its focus (app-js-repaint-drops-focus).
  const now = [...host.children].filter((c) => order.includes(c));
  if (now.length !== order.length || now.some((b, i) => b !== order[i])) host.append(...order);
}

/**
 * D4: what an existing Pause / Resume element stands for. Its painter has already set `dataset.action` and the label
 * from the run's status, so it is owned as `resume` only when it reads Resume, and as `pause` only when it reads Pause
 * while running. An interrupted, pausing or stopped-resumable run keeps a "Pause" label there (isPaused is only
 * `paused`), so the model's `resume` gets a made button instead.
 */
export function pauseResumeOwn(btn, status) {
  if (!btn) return {};
  if (btn.dataset.action === 'resume') return { resume: btn };
  if (btn.dataset.action === 'pause' && status === 'running') return { pause: btn };
  return {};
}

/** QA 4: a member row's status text. The row's PR chip already shows the PR state, so the text never repeats it:
 *  merged reads "Done", and the chip's word and "PR #N" leave the line ("Needs you · Checks failing · PR #9" → "Needs you"). */
export function memberStatusText(m) {
  const text = statusText(m).text;
  if (!m || !m.pr) return text;
  if (m.state === 'merged') return 'Done';
  const said = [` · ${m.pr.word}`, m.pr.number != null ? ` · PR #${m.pr.number}` : ''].filter(Boolean);
  return said.reduce((t, s) => t.split(s).join(''), text) || m.word;
}

/** D11, D13: a group's member rows (Planning first, unnumbered), the same table on the group page and the chat card
 *  (A13, spec §3.4): each row is title over status, then PR, cost and a quiet chevron, with the title link stretched
 *  over the row. */
export function renderMemberRows(doc, row) {
  const ol = doc.createElement('ol');
  ol.className = 'run-members is-table';
  const items = [...(row.planning && row.planning.model ? [{ ...row.planning, isPlanning: true }] : []), ...(row.members || [])];
  for (const mb of items) {
    const m = mb.model;
    const li = doc.createElement('li');
    li.className = 'run-member';
    li.dataset.state = m.state;
    li.dataset.key = mb.isPlanning ? 'planning' : String(mb.pipelineId || mb.ticketId || mb.position || '');
    const unnumbered = mb.isPlanning || mb.adhoc || row.groupKind === 'user';
    const dot = doc.createElement('span');
    paintStatusDot(dot, m);
    const name = mb.isPlanning ? 'Planning' : (mb.title || '(untitled)');
    const title = textEl(doc, 'a', 'run-member-title', name);
    title.setAttribute('href', mb.href || '#runs');
    title.title = name;
    const line = textEl(doc, 'span', 'run-member-line', memberStatusText(m));
    const pr = textEl(doc, 'span', 'run-member-pr', '');
    if (mb.adhoc) pr.append(textEl(doc, 'span', 'runs-indep', 'Independent'));
    if (m.pr && !m.pr.pending) pr.append(prChip(doc, m.pr, { link: true }));
    const num = textEl(doc, 'span', 'run-member-num', unnumbered ? '' : String(mb.position));
    const main = textEl(doc, 'span', 'run-member-main', '');
    main.append(title, line);
    const go = doc.createElement('span');
    go.className = 'run-member-go';
    go.setAttribute('aria-hidden', 'true');
    go.append(icon(doc, 'chevron', 12));
    li.append(dot, num, main, pr, textEl(doc, 'span', 'run-member-cost mono', mb.cost == null ? '' : fmtUsd(mb.cost)), go);
    ol.append(li);
  }
  return ol;
}

/** D17: the group page's one ship line (a feature, or a chain in the one ship flow). */
export function groupShipLine(row) {
  if (!row || !['feature', 'chain'].includes(row.groupKind) || !row.model) return '';
  const { done, total } = row.model.count;
  const native = (row.members || []).filter((mb) => !mb.adhoc);
  const order = native.map((mb) => mb.position).join(' → ');
  const indep = (row.members || []).filter((mb) => mb.adhoc).map((mb) => mb.position);
  if (done < total) {
    return row.groupKind === 'feature' ? `Ship card comes when all ${total} runs are done, here and in the chat.`
      : `${CREATE_PR_LABEL} comes when all ${total} runs are done.`;
  }
  // A run that already has its own PR disables One in the dialog (groupShipChoice), so the line stops offering it.
  // A feature's legacy slice draft is not such a PR.
  const owned = (row.members || []).some((mb) => { const pr = mb.model && mb.model.pr;
    return !!(pr && pr.url && pr.id !== 'closed' && !(row.groupKind === 'feature' && pr.id === 'draft')); });
  const tail = `${owned ? '' : ', or ship as one PR'}${indep.length ? ` · ${indep.join(', ')} independent` : ''}`;
  if (row.model.state === 'ready' && native.length >= 2) return `Merge in order ${order}${tail}`;
  // Stacked PRs (2 or more) merge in order; one PR (a feature's, or a chain's recorded on every run) has no order.
  if (row.model.state === 'in-review' && row.model.prCount >= 2 && native.length >= 2) return `Merge in order ${order}`;
  return '';
}
