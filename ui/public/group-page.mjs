// ui/public/group-page.mjs — the group page (runs redesign spec §3.4, §3.5): today's Feature page as the group page,
// and the page for user groups and Run-after chains. Same layout as the run page: header actions · title + kind ·
// meta · status card (status block, inline question) · tabs Runs · Overview · Decisions · Logs. Pure DOM; app.js
// owns the data (runs-list.mjs groupRow) and binds every dep. Classes use `gpage-`: group-picker.mjs owns `gp-`.
import { paintRunStatus, kindLabel, syncActions, renderMemberRows, groupShipLine } from './run-status-card.mjs';
import { fmtUsd } from './graph/run-decor.mjs';

export const GROUP_TABS = Object.freeze([['runs', 'Runs'], ['overview', 'Overview'], ['decisions', 'Decisions'], ['logs', 'Logs']]);
const el = (doc, tag, cls, text = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** The page skeleton, built once per host. */
export function buildGroupPage(doc) {
  const root = el(doc, 'div', 'gpage');
  const bar = el(doc, 'div', 'gpage-bar');
  const back = el(doc, 'a', 'btn btn-quiet gpage-back', 'Runs');
  back.setAttribute('href', '#runs');
  bar.append(back, el(doc, 'span', 'gpage-spacer'), el(doc, 'span', 'gpage-actions'));
  const head = el(doc, 'header', 'gpage-head');
  const titleRow = el(doc, 'div', 'rd-title-row');
  titleRow.append(el(doc, 'h1', 'gpage-title rd-page-title'), el(doc, 'span', 'kind-chip'));
  head.append(titleRow, el(doc, 'p', 'gpage-meta rd-page-meta'));
  const card = el(doc, 'section', 'gpage-card rd-sheet');
  const q = el(doc, 'div', 'gpage-question');
  q.hidden = true;
  card.append(el(doc, 'div', 'run-status'), q);
  const tabs = el(doc, 'nav', 'gpage-tabs rd-tabs');
  tabs.setAttribute('role', 'tablist');
  const panels = [];
  for (const [id, label] of GROUP_TABS) {
    const t = el(doc, 'button', 'rd-tab', label);
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

/**
 * Paint (idempotent). `view`: { row (groupRow output), project, tab, overview:boolean, logs:boolean }.
 * `deps`: { onAction(id, btn), onTab(tab), mountQuestion(slot, member|null), mountOverview(host), mountDecisions(host, row), logsHref(member) }.
 */
export function paintGroupPage(root, view, deps) {
  const doc = root.ownerDocument;
  const { row } = view;
  const m = row.model;
  root.__onTab = deps.onTab;
  root.querySelector('.gpage-title').textContent = row.title;
  root.querySelector('.gpage-head .kind-chip').textContent = kindLabel(row);
  // groupRow's costUsd is always a number: a group with no cost yet says nothing, never "Cost $0.00 total".
  root.querySelector('.gpage-meta').textContent = [view.project, row.costUsd > 0 ? `Cost ${fmtUsd(row.costUsd)} total` : ''].filter(Boolean).join(' · ');
  paintRunStatus(root.querySelector('.gpage-card .run-status'), m);
  syncActions(root.querySelector('.gpage-actions'), m, { onAction: deps.onAction, disable: { 'ask-changes': "Ask for changes from the run's chat" } });
  const all = [...(row.planning ? [{ ...row.planning, isPlanning: true }] : []), ...row.members];
  const current = all.find((mb) => mb.model === m.current) || null;
  deps.mountQuestion(root.querySelector('.gpage-question'), current);
  const offered = (id) => (id !== 'overview' || !!view.overview) && (id !== 'logs' || !!view.logs);
  const tab = GROUP_TABS.some(([id]) => id === view.tab) && offered(view.tab) ? view.tab : 'runs';
  for (const t of root.querySelectorAll('.gpage-tabs .rd-tab')) {
    t.hidden = !offered(t.dataset.tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const p of root.querySelectorAll('.gpage-panel')) p.hidden = p.dataset.tab !== tab;
  root.querySelector('.gpage-runs').replaceChildren(renderMemberRows(doc, row, { openButtons: true }));
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
