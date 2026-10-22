// ui/public/group-page.mjs — the group page (runs redesign spec §3.4, §3.5): today's Feature page as the group page,
// and the page for user groups and Run-after chains. Same head as the run page (run 3): the bar (crumbs, the one
// primary action, Stop, ⋯) · title + kind · the card (status block, facts block, inline question) · tabs Runs ·
// Overview · Decisions · Logs. Pure DOM; app.js owns the data (runs-list.mjs groupRow) and binds every dep. Classes
// use `gpage-`: group-picker.mjs owns `gp-`.
import { paintRunStatus, syncActions, renderMemberRows, groupShipLine } from './run-status-card.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { groupKindWord, pageModel, paintCrumbs, buildFacts, setFactText, factRow, syncFacts, GROUP_FACTS } from './run-page-head.mjs';
import { icon } from './icons.mjs';

export const GROUP_TABS = Object.freeze([['runs', 'Runs'], ['overview', 'Overview'], ['decisions', 'Decisions'], ['logs', 'Logs']]);
const el = (doc, tag, cls, text = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** The page skeleton, built once per host. */
export function buildGroupPage(doc) {
  const root = el(doc, 'div', 'gpage');
  // Run 3 (D13): the run page's bar — Back (slide layout) or the crumbs (split), then the primary action, Stop, ⋯.
  const bar = el(doc, 'div', 'gpage-bar rd-bar');
  const back = el(doc, 'a', 'btn btn-sm btn-quiet btn-icon gpage-back');
  back.append(icon(doc, 'chevron-left', 16));            // slice 2: the run page's 28px Back
  back.setAttribute('href', '#runs');
  back.setAttribute('aria-label', 'Back to Runs');
  back.title = 'Back to Runs';
  const crumbs = el(doc, 'nav', 'rd-crumbs');
  crumbs.setAttribute('aria-label', 'Breadcrumb');
  crumbs.hidden = true;
  const stop = el(doc, 'button', 'btn btn-danger gpage-stop', 'Stop');
  stop.type = 'button';
  stop.hidden = true;
  stop.addEventListener('click', () => { if (root.__onAction) root.__onAction('stop', stop); });
  const more = el(doc, 'button', 'btn btn-quiet btn-icon gpage-more');
  more.type = 'button';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', 'More for this group');
  more.title = 'More for this group';
  more.append(icon(doc, 'more', 16));
  more.addEventListener('click', () => { if (root.__onMore) root.__onMore(more); });
  bar.append(back, crumbs, el(doc, 'span', 'gpage-spacer'), el(doc, 'span', 'gpage-actions'), stop, more);
  const head = el(doc, 'header', 'gpage-head');
  const titleRow = el(doc, 'div', 'rd-title-row');
  titleRow.append(el(doc, 'h1', 'gpage-title rd-page-title'), el(doc, 'span', 'kind-chip'));
  head.append(titleRow);
  const card = el(doc, 'section', 'gpage-card rd-sheet');
  const q = el(doc, 'div', 'gpage-question');
  q.hidden = true;
  card.append(el(doc, 'div', 'run-status'), buildFacts(doc, GROUP_FACTS), q);
  const tabs = el(doc, 'nav', 'gpage-tabs rd-tabs tabs');
  tabs.setAttribute('role', 'tablist');
  const panels = [];
  for (const [id, label] of GROUP_TABS) {
    const t = el(doc, 'button', 'rd-tab tab', label);
    t.type = 'button';
    t.setAttribute('role', 'tab');
    t.dataset.tab = id;
    tabs.append(t);
    const p = el(doc, 'div', 'gpage-panel');
    p.dataset.tab = id;
    p.setAttribute('role', 'tabpanel');
    panels.push(p);
  }
  panels[0].append(el(doc, 'div', 'gpage-runs'), el(doc, 'p', 'gpage-ship'));
  panels[1].append(el(doc, 'div', 'gpage-overview'));
  panels[2].append(el(doc, 'div', 'gpage-decisions'));
  panels[3].append(el(doc, 'ul', 'gpage-logs'));
  root.append(bar, head, card, tabs, ...panels);
  tabs.addEventListener('click', (e) => { const t = e.target.closest('.rd-tab'); if (t && root.__onTab) root.__onTab(t.dataset.tab); });
  return root;
}

/** QA 7: with several PRs a header "View PR" is ambiguous; each row's chip opens its own. */
export function headerActions(m) {
  return m.prCount === 1 ? m : { ...m, actions: m.actions.filter((a) => a !== 'open-pr') };
}

/**
 * Paint (idempotent). `view`: { row (groupRow output), project, tab, overview:boolean, logs:boolean, labels: [] (the
 * members' labels) }.
 * `deps`: { onAction(id, btn), onTab(tab), onMore(anchor), mountQuestion(slot, member|null), answerLabel?(), mountOverview(host),
 * mountDecisions(host, row), logsHref(member), labelChip(doc, label) }.
 */
export function paintGroupPage(root, view, deps) {
  const doc = root.ownerDocument;
  const { row } = view;
  const m = row.model;
  root.__onTab = deps.onTab;
  root.__onAction = deps.onAction;
  root.__onMore = deps.onMore || null;
  const title = root.querySelector('.gpage-title');
  title.textContent = row.title;
  title.title = row.title;   // D13: the heading clamps at 2 lines
  root.querySelector('.gpage-head .kind-chip').textContent = groupKindWord(row);   // run 3 (D7): the group's kind
  paintCrumbs(root.querySelector('.gpage-bar .rd-crumbs'), [{ label: 'Runs', href: '#runs' }, { label: row.title }]);
  paintRunStatus(root.querySelector('.gpage-card .run-status'), pageModel(m));   // run 3 (D10)
  // Run 3 (D15): the facts block — Project, Runs, Total cost, Labels (the read-only union of the members' labels).
  const kv = root.querySelector('.gpage-card > .rd-kv');
  const { done, total } = m.count;
  setFactText(kv, 'project', view.project || '');
  setFactText(kv, 'runs', `${total} run${total === 1 ? '' : 's'} · ${done} done`);
  // groupRow's costUsd is always a number: a group with no cost yet says nothing, never "$0.00".
  setFactText(kv, 'cost', row.costUsd > 0 ? fmtUsd(row.costUsd) : '');
  const labelsHost = factRow(kv, 'labels').querySelector('.rd-kv-v');
  const labels = view.labels || [];
  if (labelsHost.dataset.sig !== labels.join('\n')) {
    labelsHost.dataset.sig = labels.join('\n');
    labelsHost.replaceChildren(...labels.map((l) => (deps.labelChip ? deps.labelChip(doc, l) : el(doc, 'span', 'label-chip', l))));
  }
  syncFacts(kv);
  const all = [...(row.planning ? [{ ...row.planning, isPlanning: true }] : []), ...row.members];
  const current = all.find((mb) => mb.model === m.current) || null;
  // Stop acts on the member the status block names (the row ⋯ Stop's call); its title says which.
  const stop = root.querySelector('.gpage-stop');
  stop.title = current ? `Stop ${current.isPlanning ? 'Planning' : `Run ${current.position}`}` : 'Stop';
  // Run 4 (D2): the question is mounted first, so the bar's Answer can name the card's own primary.
  deps.mountQuestion(root.querySelector('.gpage-question'), current);
  syncActions(root.querySelector('.gpage-actions'), headerActions(m), { own: { stop }, pool: [stop], onAction: deps.onAction,
    disable: { 'ask-changes': "Ask for changes from the run's chat" }, labels: { answer: deps.answerLabel ? deps.answerLabel() : '' } });
  const offered = (id) => (id !== 'overview' || !!view.overview) && (id !== 'logs' || !!view.logs);
  const tab = GROUP_TABS.some(([id]) => id === view.tab) && offered(view.tab) ? view.tab : 'runs';
  for (const t of root.querySelectorAll('.gpage-tabs .rd-tab')) {
    t.hidden = !offered(t.dataset.tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const p of root.querySelectorAll('.gpage-panel')) p.hidden = p.dataset.tab !== tab;
  root.querySelector('.gpage-runs').replaceChildren(renderMemberRows(doc, row));
  const line = groupShipLine(row);
  const ship = root.querySelector('.gpage-ship');
  ship.textContent = line;
  ship.hidden = !line;
  if (tab === 'overview') deps.mountOverview(root.querySelector('.gpage-overview'));
  if (tab === 'decisions') deps.mountDecisions(root.querySelector('.gpage-decisions'), row);
  const numbered = (mb) => !mb.isPlanning && !mb.adhoc && row.groupKind !== 'user';
  root.querySelector('.gpage-logs').replaceChildren(...all.map((mb) => {
    const li = el(doc, 'li', 'gpage-log');
    const a = el(doc, 'a', 'btn btn-sm btn-quiet', 'Open logs');
    a.setAttribute('href', deps.logsHref(mb));
    li.append(el(doc, 'span', 'gpage-log-title', mb.isPlanning ? 'Planning' : `${numbered(mb) ? `${mb.position} · ` : ''}${mb.title || '(untitled)'}`), a);
    return li;
  }));
}

/** D15: the plan / gate receipts a run already carries client-side (its ledger rows, progressFacts.reviews and its
 *  manifest's labels). No fetch. A finished member whose raw run is only its History row has none. */
export function runReceipts(run) {
  const r = run || {};
  const nodes = (r.stepper && r.stepper.graph && r.stepper.graph.nodes) || [];
  const node = (id) => nodes.find((n) => n && n.id === id) || null;
  const out = [];
  const planned = (r.steps || []).some((s) => s && s.status === 'done' && (node(s.nodeId) || {}).key === 'planner');
  if (planned) out.push('Plan accepted');
  const reviews = (r.progressFacts && r.progressFacts.reviews) || {};
  for (const [id, f] of Object.entries(reviews)) {
    const n = node(id);
    if (!n || !f) continue;
    const b = Number(f.blocking) || 0;
    out.push(`${n.label || n.key || id} · pass ${Number(f.pass) || 1} · ${b ? `${b} blocking, sent back` : 'passed'}`);
  }
  return out;
}
