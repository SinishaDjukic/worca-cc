// ui/public/group-page.mjs — the group page (runs redesign spec §3.4, §3.5): today's Feature page as the group page,
// and the page for user groups and Run-after chains. Same head as the run page (run 3): the bar (crumbs, the one
// primary action, Stop, ⋯) · title + kind · the card (status block, facts block, inline question) · tabs Runs ·
// Overview · Decisions · Logs. Pure DOM; app.js owns the data (runs-list.mjs groupRow) and binds every dep. Classes
// use `gpage-`: group-picker.mjs owns `gp-`.
import { paintRunStatus, syncActions, renderMemberRows, groupShipLine, groupBarShows } from './run-status-card.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { groupKindWord, pageModel, paintCrumbs, buildFacts, setFactText, factRow, syncFacts, GROUP_FACTS, featureShipHref } from './run-page-head.mjs';
import { isNeedsYouHold } from '../../src/shared/shape/ship-ledger.mjs';
import { icon } from './icons.mjs';
import { groupHead } from './run-head.mjs';
import { answerFieldOpen } from './shape/step-card.mjs';
import { needYouText } from './shape/feature-card.mjs';
import { bindRunLinks } from './run-links.mjs';
import { showOrderOffered, renderRunOrderMap } from './shape/run-order-map.mjs';
import { renderFeatureCost } from './shape/feature-cost.mjs';

export const GROUP_TABS = Object.freeze([['runs', 'Runs'], ['overview', 'Overview'], ['decisions', 'Decisions'], ['logs', 'Logs']]);
const el = (doc, tag, cls, text = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
// Slice 3: replace a host's children only when their HTML changed. The last HTML is kept in a JS property, never in
// the DOM. Contract: the member table (renderMemberRows) and the Logs items carry no listeners, so a kept node acts
// as a new one would. A row that gains a listener or other non-HTML state breaks that contract: bind it on the host.
// A focused link in a replaced host moves to its successor: the link of the same class and href in the same row.
function keepUnchanged(host, kids) {
  const sig = kids.map((k) => k.outerHTML).join('');
  if (host.__sig === sig) return;
  host.__sig = sig;
  const a = host.ownerDocument.activeElement;
  const at = (n) => [n.className, n.getAttribute('href'), n.closest('[data-key]')?.dataset.key].join('\n');
  const was = a && a !== host && host.contains(a) && a.matches('a[href]') ? at(a) : null;
  host.replaceChildren(...kids);
  if (was) [...host.querySelectorAll('a[href]')].find((n) => at(n) === was)?.focus();
}

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
  // One ship flow (D11): the run page's head — the status line, then the head actions with the one PR slot.
  const sheetHead = el(doc, 'div', 'rd-sheet-head');
  const acts = el(doc, 'div', 'rd-head-acts');
  const slot = el(doc, 'span', 'rd-pr-slot');
  slot.hidden = true;
  slot.setAttribute('data-needs-git', '');
  acts.append(slot);
  sheetHead.append(el(doc, 'div', 'run-status'), acts);
  card.append(sheetHead, buildFacts(doc, GROUP_FACTS), q);
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
  const runsHost = el(doc, 'div', 'gpage-runs');
  runsHost.__links = bindRunLinks(runsHost);   // s8 (D5): the link marks listen on the host, never on the rows
  panels[0].append(runsHost, el(doc, 'p', 'gpage-ship'));
  panels[1].append(el(doc, 'div', 'gpage-overview'));
  panels[2].append(el(doc, 'div', 'gpage-decisions'));
  panels[3].append(el(doc, 'ul', 'gpage-logs'));
  root.append(bar, head, card, tabs, ...panels);
  tabs.addEventListener('click', (e) => { const t = e.target.closest('.rd-tab'); if (t && root.__onTab) root.__onTab(t.dataset.tab); });
  return root;
}

/** Shaper small runs D3 (D7): the Requirements tab, after Runs, only while it applies. It is created and removed in the
 *  DOM (never only hidden), so a page without it keeps dev's four tabs. GROUP_TABS stays dev's. */
export function syncRequirementsTab(root, on) {
  const tab = root.querySelector('.gpage-tabs .rd-tab[data-tab="requirements"]');
  const panel = root.querySelector('.gpage-panel[data-tab="requirements"]');
  if (!on) { tab?.remove(); panel?.remove(); return; }
  if (tab && panel) return;
  const doc = root.ownerDocument;
  const t = el(doc, 'button', 'rd-tab tab', 'Requirements');
  t.type = 'button';
  t.setAttribute('role', 'tab');
  t.dataset.tab = 'requirements';
  root.querySelector('.gpage-tabs .rd-tab[data-tab="runs"]').after(t);
  const p = el(doc, 'div', 'gpage-panel');
  p.dataset.tab = 'requirements';
  p.setAttribute('role', 'tabpanel');
  p.append(el(doc, 'div', 'gpage-requirements'));
  root.querySelector('.gpage-panel[data-tab="runs"]').after(p);
}

const tabButton = (doc, id, label) => {
  const t = el(doc, 'button', 'rd-tab tab', label);
  t.type = 'button';
  t.setAttribute('role', 'tab');
  t.dataset.tab = id;
  return t;
};
const tabPanel = (doc, id) => {
  const p = el(doc, 'div', 'gpage-panel');
  p.dataset.tab = id;
  p.setAttribute('role', 'tabpanel');
  return p;
};
const setLabel = (t, text) => { if (t && t.textContent !== text) t.textContent = text; };

/** Feature page slice 6 (D2, D3): a marked feature's tabs Runs · Requirements · Decisions · Cost · Log, only while it
 *  applies. Nodes are created and removed, never only hidden. On: the Overview tab goes, its `.gpage-overview` node
 *  (moved, never rebuilt) is the Requirements panel's first child, a Cost tab and panel follow Decisions, Logs reads
 *  "Log" and its panel gains the step-log part. Off restores the skeleton buildGroupPage draws. Idempotent. */
export function syncFeatureLayout(root, on) {
  const doc = root.ownerDocument;
  const q = (sel) => root.querySelector(sel);
  const overview = q('.gpage-overview');
  const logsTab = q('.gpage-tabs .rd-tab[data-tab="logs"]');
  const logsPanel = q('.gpage-panel[data-tab="logs"]');
  if (on) {
    syncRequirementsTab(root, true);
    const reqPanel = q('.gpage-panel[data-tab="requirements"]');
    if (reqPanel.firstElementChild !== overview) reqPanel.prepend(overview);
    q('.gpage-tabs .rd-tab[data-tab="overview"]')?.remove();
    q('.gpage-panel[data-tab="overview"]')?.remove();
    if (!q('.gpage-tabs .rd-tab[data-tab="cost"]')) q('.gpage-tabs .rd-tab[data-tab="decisions"]').after(tabButton(doc, 'cost', 'Cost'));
    if (!q('.gpage-panel[data-tab="cost"]')) q('.gpage-panel[data-tab="decisions"]').after(tabPanel(doc, 'cost'));
    setLabel(logsTab, 'Log');
    if (!logsPanel.querySelector(':scope > .gpage-steplog')) logsPanel.append(el(doc, 'div', 'gpage-steplog'));
    return;
  }
  if (!q('.gpage-panel[data-tab="overview"]')) {
    q('.gpage-tabs .rd-tab[data-tab="runs"]').after(tabButton(doc, 'overview', 'Overview'));
    const p = tabPanel(doc, 'overview');
    q('.gpage-panel[data-tab="runs"]').after(p);
    p.append(overview);
  }
  syncRequirementsTab(root, false);
  q('.gpage-tabs .rd-tab[data-tab="cost"]')?.remove();
  q('.gpage-panel[data-tab="cost"]')?.remove();
  logsPanel.querySelector(':scope > .gpage-steplog')?.remove();
  setLabel(logsTab, 'Logs');
  const list = logsPanel.querySelector(':scope > ul.gpage-logs');
  if (list.hidden) list.hidden = false;
}

/** Slice 6 (D13): "Mark and ship", the bar's primary while a mark is open, just before `.gpage-actions`. Created and
 *  removed, and the same node while on, so focus survives a repaint. Removing it while focused focuses the selected tab. */
export function syncMarkShip(root, on) {
  const bar = root.querySelector('.gpage-bar');
  const b = bar.querySelector(':scope > .gpage-markship');
  if (!on) {
    if (!b) return;
    const had = root.ownerDocument.activeElement === b;
    b.remove();
    if (had) root.querySelector('.gpage-tabs .rd-tab[aria-selected="true"]')?.focus();
    return;
  }
  if (b) return;
  const btn = el(root.ownerDocument, 'button', 'btn btn-primary gpage-markship', 'Mark and ship');
  btn.type = 'button';
  btn.addEventListener('click', () => { if (root.__onMarkShip) root.__onMarkShip(); });
  bar.querySelector(':scope > .gpage-actions').before(btn);
}

// Small runs slice 10 (D9): the one readable line under Show order; only the drawing itself is aria-hidden.
const ORDER_HINT = 'A run sits to the right of every run it builds on. A line joins a run that is not done to the runs waiting for it; links that are already met are not drawn.';
let orderIds = 0;

/** Slice 10 (D4, D6, D7): "Show order" on the Runs tab, the run order drawing behind a toggle. Idempotent: the node
 *  exists only while showOrderOffered(slices) (created and removed, never only hidden, so other pages keep dev's DOM).
 *  The open state lives on the root (`root.__order = { gid, open, slices }`); a missing state or another `gid` reads as
 *  closed. The button is built once and never replaced, so focus survives every repaint. */
export function syncShowOrder(root, slices, gid) {
  const panel = root.querySelector('.gpage-panel[data-tab="runs"]');
  const node = panel.querySelector(':scope > .gpage-order');
  if (!slices || !showOrderOffered(slices)) {
    delete root.__order;
    if (!node) return;
    const a = root.ownerDocument.activeElement;
    const had = !!a && node.contains(a);
    node.remove();
    if (had) root.querySelector('.gpage-tabs .rd-tab[data-tab="runs"]')?.focus();
    return;
  }
  if (!root.__order || root.__order.gid !== gid) root.__order = { gid, open: false, slices };
  root.__order.slices = slices;
  paintShowOrder(root, node || buildShowOrder(root, panel));
}

function buildShowOrder(root, panel) {
  const doc = root.ownerDocument;
  const node = el(doc, 'div', 'gpage-order');
  const bar = el(doc, 'div', 'gpage-order-bar');
  const body = el(doc, 'div', 'gpage-order-body');
  body.id = `gpage-order-${(orderIds += 1)}`;
  body.hidden = true;
  const t = el(doc, 'button', 'btn btn-sm btn-quiet gpage-order-toggle');   // the run page's Show route control
  t.type = 'button';
  t.setAttribute('aria-controls', body.id);
  t.append(el(doc, 'span'), icon(doc, 'chevron-down', 12));
  t.addEventListener('click', () => {
    if (!root.__order) return;
    root.__order.open = !root.__order.open;
    paintShowOrder(root, node);
  });
  bar.append(t);
  node.append(bar, body);
  panel.prepend(node);
  return node;
}

function paintShowOrder(root, node) {
  const doc = root.ownerDocument;
  const { open, slices } = root.__order;
  const t = node.querySelector('.gpage-order-toggle');
  t.setAttribute('aria-expanded', String(open));
  t.firstElementChild.textContent = open ? 'Hide order' : 'Show order';
  const chevron = icon(doc, open ? 'chevron-up' : 'chevron-down', 12);
  if (t.lastElementChild.outerHTML !== chevron.outerHTML) t.lastElementChild.replaceWith(chevron);
  const body = node.querySelector('.gpage-order-body');
  body.hidden = !open;
  keepUnchanged(body, [el(doc, 'p', 'gpage-order-hint', ORDER_HINT), ...(open ? [renderRunOrderMap(doc, slices)] : [])]);
}

/** One ship flow (D11): a group's Create PR and View PR(s) live on the status line (docs/design-system.md
 *  "Placement"), never in the bar, for features, chains and user groups alike. */
export function headerActions(m) {
  return { ...m, actions: m.actions.filter((a) => a !== 'open-pr' && a !== 'ship') };
}

/** The group's distinct PRs in merge order, closed ones left out (prMenuItems' item shape). The group's own PR (a
 *  feature shipped as one) comes last unless a member already carries it. A PR several members share (a chain's One PR)
 *  belongs to the last of them: its head is that run's branch, so Fix conflicts and Watch PR act on it. */
export function groupPrList(row) {
  const seen = new Map();
  const out = [];
  const add = (pr, mb) => {
    if (!pr || !pr.url || pr.id === 'closed' || pr.inBase) return;
    const owner = { key: (mb && mb.pipelineId) || '', name: mb ? `Run ${mb.position}` : '', position: mb ? mb.position : null,
      pipelineId: (mb && mb.pipelineId) || null };
    if (seen.has(pr.url)) { if (mb) Object.assign(seen.get(pr.url), owner); return; }
    const item = { ...owner, number: pr.number, url: pr.url, open: pr.id !== 'merged', merged: pr.id === 'merged',
      conflicts: pr.id === 'conflicts' };
    seen.set(pr.url, item);
    out.push(item);
  };
  for (const mb of row.members || []) add(mb.model && mb.model.pr, mb);
  add(row.model && row.model.pr, null);
  return out;
}

/** Slice 7 (D7): the need count, the neutral kind chip after the kind chip; created on a non-zero count, removed at zero. */
function paintNeed(kindEl, text) {
  let chip = kindEl.parentElement.querySelector(':scope > .kind-chip[data-need]');
  if (!text) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = kindEl.ownerDocument.createElement('span');
    chip.className = 'kind-chip';
    chip.dataset.need = '';
    kindEl.after(chip);
  }
  if (chip.textContent !== text) chip.textContent = text;
}

/**
 * Paint (idempotent). `view`: { row (groupRow output), project, tab, overview:boolean, logs:boolean, labels: [] (the
 * members' labels), unmarked?: number (a feature's unmarked requirements: its Create PR is locked), stackedOnly?: boolean (a small-runs
 * feature: the ship line never offers One), hasChat?: boolean (Shaper slice 7: false for a marked feature with no chat), requirements?: boolean (D3: a marked feature with the flag on), shortState?:
 * (member) → string|null (small runs: one-line member rows with the card's short words), status?: (member) →
 * {word, mark}|null (small runs s4: runStatus's word and mark for each row, renderMemberRows' `status`), ship?: {n, blocked, reason}|null
 * (small runs: the ledger the head's Create N PRs follows), stateLine?: string|null (small runs slice 7: the feature's state
 * line, featureStateLine, in place of the model's line), needCount?: number (slice 7: the stop lines, the head's chip),
 * order?: object[]|null (slice 10: a marked feature's featureView slices; the Runs tab offers Show order from them),
 * cost?: featureCostModel output, markOpen?: boolean, expert?: boolean (slice 6, in the feature layout only: the Cost
 * tab's table, the bar's Mark and ship, and whether the Log tab's Open logs rows show) }.
 * `deps`: { onAction(id, btn), onTab(tab), onMore(anchor), mountQuestion(slot, member|null), answerLabel?(), resumeLabel?() (slice 11: the footer
 * Resume's text, '' for the plain word), mountOverview(host),
 * mountDecisions(host, row), mountRequirements?(host, row) → Node|null (D3, while `view.requirements`), logsHref(member),
 * labelChip(doc, label), paintHead?(acts, slot, head), mountStepLog?(host, row) (slice 6: the Log tab's step log),
 * onMarkShip?() (slice 6: Mark and ship) } — mountOverview gets `{ shipFirst: true }` on the layout's Requirements tab.
 * paintHead paints
 * groupHead's head (Create PR, View PR ▾, View PRs ▾) into the card head; without it the slot stays hidden.
 */
export function paintGroupPage(root, view, deps) {
  const doc = root.ownerDocument;
  const { row } = view;
  const m = row.model;
  root.__onTab = deps.onTab;
  root.__onAction = deps.onAction;
  root.__onMore = deps.onMore || null;
  root.__onMarkShip = deps.onMarkShip || null;
  // Slice 6 (D6, D7): in the feature layout, Log is offered at every level, Cost exists, and the old Overview address
  // opens Requirements (it holds the Ship card). The tab is resolved first: the status line reads it (D15).
  const layout = !!view.requirements;
  const offered = (id) => (layout ? id !== 'overview'
    : (id !== 'overview' || !!view.overview) && (id !== 'logs' || !!view.logs) && id !== 'requirements' && id !== 'cost');
  const want = layout && view.tab === 'overview' ? 'requirements' : view.tab;
  const tab = (GROUP_TABS.some(([id]) => id === want) || want === 'requirements' || want === 'cost') && offered(want) ? want : 'runs';
  const title = root.querySelector('.gpage-title');
  title.textContent = row.title;
  title.title = row.title;   // D13: the heading is one line cut with "…"; the full title is the tooltip
  root.querySelector('.gpage-head .kind-chip').textContent = groupKindWord(row);   // run 3 (D7): the group's kind
  paintCrumbs(root.querySelector('.gpage-bar .rd-crumbs'), [{ label: 'Runs', href: '#runs' }, { label: row.title }]);
  // Small runs slice 7 (D9): a marked feature's state line says which runs work and which goes next. Shaper slice 7
  // (D7): a confirmation hold wins over it, and in the feature layout its reason links to the Ship card.
  const confirm = isNeedsYouHold(m.hold);   // slice 9: the notes hold links to the Ship card too
  const shown = view.stateLine && !confirm ? { ...pageModel(m), line: view.stateLine, lineSaysState: false } : pageModel(m);
  paintNeed(root.querySelector('.gpage-head .kind-chip'), needYouText(view.needCount || 0));
  // Small runs: a disabled Create N PRs says why on the page, not only in its tooltip. A held group's line already does,
  // and so does the tab with the Ship card (Requirements in the feature layout, else Overview).
  const why = view.ship && view.ship.blocked && m.state === 'ready' && !m.hold && tab !== (layout ? 'requirements' : 'overview') ? view.ship.reason : '';
  const pm = why ? { ...shown, line: `${shown.line} · ${why}` } : shown;
  paintRunStatus(root.querySelector('.gpage-card .run-status'), pm, { hold: true,   // run 3 (D10); slice 3: keep the last bar
    ...(confirm && layout ? { detailHref: featureShipHref(row.groupId) } : {}) });
  // Run 3 (D15): the facts block — Project, Runs, Total cost, Labels (the read-only union of the members' labels).
  const kv = root.querySelector('.gpage-card > .rd-kv');
  const { done, total } = m.count;
  setFactText(kv, 'project', view.project || '');
  // Said once: while the group bar shows, its label carries "{done} done"; the Runs fact then gives the total alone.
  const runs = `${total} run${total === 1 ? '' : 's'}`;
  setFactText(kv, 'runs', groupBarShows(pm) ? runs : `${runs} · ${done} done`);
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
  const question = root.querySelector('.gpage-question');
  deps.mountQuestion(question, current);
  // Small runs: an open stop's own primary is the page's one primary, as on the run page and the Chat card.
  const stopOpen = 'stop' in question.dataset && !question.hidden;
  syncActions(root.querySelector('.gpage-actions'), headerActions(m), { own: { stop }, pool: [stop], onAction: deps.onAction,
    disable: { 'ask-changes': "Ask for changes from the run's chat" }, labels: { answer: deps.answerLabel ? deps.answerLabel() : '', resume: deps.resumeLabel ? deps.resumeLabel() : '' },
    plain: answerFieldOpen(question) ? ['answer'] : [], ...(stopOpen ? { skip: ['answer'] } : {}) });
  if (deps.paintHead) {
    deps.paintHead(root.querySelector('.gpage-card .rd-head-acts'), root.querySelector('.gpage-card .rd-pr-slot'),
      groupHead({ state: m.state, prs: groupPrList(row), unmarked: view.unmarked || 0, ship: view.ship || null }));
  }
  // Small runs D3 (D7): the Requirements tab exists only while `view.requirements` (a marked feature, flag on); slice 6
  // (D2): so does the whole feature layout.
  syncFeatureLayout(root, layout);
  for (const t of root.querySelectorAll('.gpage-tabs .rd-tab')) {
    t.hidden = !offered(t.dataset.tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    t.classList.toggle('active', t.dataset.tab === tab);
  }
  for (const p of root.querySelectorAll('.gpage-panel')) p.hidden = p.dataset.tab !== tab;
  syncMarkShip(root, layout && !!view.markOpen);   // after the tabs: a removed, focused button focuses the selected one
  // Slice 3: a frame that changes nothing in the table keeps its nodes (a focused row, the scroll anchor).
  // s8 (D6, D14): the link marks, the kept run and a focused row survive the repaint; another feature drops the keep.
  syncShowOrder(root, view.order || null, row.groupId);   // slice 10 (D4): Show order, above the rows
  const runsHost = root.querySelector('.gpage-runs');
  runsHost.__links.repaint(row.groupId, () => keepUnchanged(runsHost, [view.shortState || view.status
    ? renderMemberRows(doc, row, { oneLine: true, shortState: view.shortState || null,
      ...(view.status ? { status: view.status, buildsOn: (mb) => mb.slice?.buildsOn ?? null } : {}) }) : renderMemberRows(doc, row)]));
  const line = groupShipLine(row, { stackedOnly: !!view.stackedOnly, ...(typeof view.hasChat === 'boolean' ? { hasChat: view.hasChat } : {}) });
  const ship = root.querySelector('.gpage-ship');
  ship.textContent = line;
  ship.hidden = !line;
  // D12: the rows carry no listeners, so keepUnchanged may keep or replace them (a focused run link moves to its successor).
  if (tab === 'requirements') {
    if (layout) deps.mountOverview(root.querySelector('.gpage-overview'), { shipFirst: true });   // slice 6 (D3): Ship card first
    const host = root.querySelector('.gpage-requirements');
    const node = deps.mountRequirements ? deps.mountRequirements(host, row) : null;
    if (node) keepUnchanged(host, [node]);
  }
  if (tab === 'overview') deps.mountOverview(root.querySelector('.gpage-overview'));
  if (tab === 'decisions') deps.mountDecisions(root.querySelector('.gpage-decisions'), row);
  if (layout && view.cost) keepUnchanged(root.querySelector('.gpage-panel[data-tab="cost"]'), [renderFeatureCost(doc, view.cost)]);
  if (layout && tab === 'logs' && deps.mountStepLog) deps.mountStepLog(root.querySelector('.gpage-steplog'), row);
  // Slice 6 (D7): the Open logs rows stay Expert-only in the layout, where Log itself is offered at every level.
  if (layout) root.querySelector('ul.gpage-logs').hidden = !view.expert;
  const numbered = (mb) => !mb.isPlanning && !mb.adhoc && row.groupKind !== 'user';
  keepUnchanged(root.querySelector('.gpage-logs'), all.map((mb) => {
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
    const fx = Number(f.fixed) || 0;   // blockers a refiner fixed in this pass
    out.push(`${n.label || n.key || id} · pass ${Number(f.pass) || 1} · ${b ? `${b} blocking, sent back` : 'passed'}${fx ? `, ${fx} fixed` : ''}`);
  }
  return out;
}
