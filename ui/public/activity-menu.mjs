// ui/public/activity-menu.mjs — the top bar's Activity button and its popover (Lite: a list, no
// actions). The button carries one badge (activity-model.mjs badgeState); the popover has three tabs,
// Needs you · Running · Scheduled, whose rows are links: a click or Enter opens the run or the
// Schedules tab and closes the popover. side-flyout.mjs places it ('down', under the button) and
// closes it (the shared Escape stack, an outside click, focus leaving), keeping aria-expanded.
//
//   const menu = createActivityMenu({ doc, win, button, badge, pop, getCounts, getRuns, loadSchedules, placeOf, tz, navigate });
//   menu.refresh()            the badge (every updateNavCounts) and, while open, the list
//   menu.schedulesChanged()   while open, refetch the schedules; closed, forget them (WS schedules-changed)
//
// getCounts() → { needs, running } (activityCounts over the light run items: cheap, every frame);
// getRuns() → { live, history, active } (the full items, read only while open); loadSchedules() → a
// Promise of GET /api/schedules' { schedules, tickets }; navigate(hash) routes.
import { createFlyout } from './side-flyout.mjs';
import { activityModel, badgeState, firstTab, ACTIVITY_TABS, TAB_LABELS, TAB_EMPTY } from './activity-model.mjs';

export function createActivityMenu({
  doc = globalThis.document, win = globalThis.window, button, badge, pop,
  getCounts, getRuns, loadSchedules, placeOf = undefined, tz = undefined, navigate, now = () => Date.now(),
}) {
  // pick: the popover still opens on the first tab with rows (until the user picks one or the schedules land).
  // sched: the last loaded { tickets, schedules }, null until loaded. failed: the newest fetch settled with nothing.
  // seq: the newest fetch. sig: the painted rows.
  const ui = { tab: 'needs', pick: false, sched: null, failed: false, seq: 0, sig: '' };
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const tablist = make('div', 'activity-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Activity');
  const tabs = {};
  for (const id of ACTIVITY_TABS) {
    const b = make('button', 'activity-tab');
    b.type = 'button';
    b.id = `activity-tab-${id}`;
    b.dataset.tab = id;
    b.dataset.minLevel = 'simple';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'activity-panel');
    tabs[id] = b;
    tablist.appendChild(b);
  }
  const panel = make('div', 'activity-panel');
  panel.id = 'activity-panel';
  panel.setAttribute('role', 'tabpanel');
  const all = make('a', 'activity-foot-link', 'Open Schedules');
  all.setAttribute('href', '#schedules');
  const plan = make('button', 'btn btn-mini activity-foot-new', 'Schedule…');
  plan.type = 'button';
  plan.dataset.href = '#new/schedule';
  const foot = make('div', 'activity-foot');
  foot.append(all, plan);
  pop.replaceChildren(tablist, panel, foot);

  const fly = createFlyout({ doc, win, trigger: button, menu: pop, mode: 'down', onOpen: opened });

  function rowEl(r) {
    const a = make('a', 'activity-row');
    a.setAttribute('href', r.href);
    a.dataset.key = r.key;
    const dot = make('i', 'activity-dot');
    dot.dataset.tone = r.tone;
    dot.setAttribute('aria-hidden', 'true');
    const top = make('span', 'activity-row-top');
    top.append(make('span', 'activity-row-title', r.title), make('span', 'activity-row-time', r.time));
    const main = make('span', 'activity-row-main');
    main.append(top, make('span', 'activity-row-sub', r.sub));
    a.append(dot, main);
    return a;
  }

  /** Paint the tab labels and the open tab's rows; `pick` opens the first tab with rows. A repaint
   *  that changes no row leaves the list alone, and a focused row keeps focus across one that does. */
  function render({ pick = false } = {}) {
    const s = ui.sched;
    const m = activityModel({ ...getRuns(), tickets: s ? s.tickets : null, schedules: s ? s.schedules : null, now: now(), tz, placeOf });
    if (pick) ui.tab = firstTab(m.counts);
    for (const id of ACTIVITY_TABS) {
      const b = tabs[id];
      const n = m.counts[id];
      b.replaceChildren(TAB_LABELS[id]);
      if (n) b.append(' ', make('span', 'activity-tab-n', String(n)));
      b.setAttribute('aria-selected', id === ui.tab ? 'true' : 'false');
      b.tabIndex = id === ui.tab ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', tabs[ui.tab].id);
    const busy = ui.tab === 'scheduled' && !m.scheduled.loaded && !ui.failed;
    const groups = ui.tab === 'scheduled' ? m.scheduled.groups : [{ label: '', rows: m[ui.tab] }];
    const sig = JSON.stringify([ui.tab, busy, groups.map((g) => [g.label, g.rows.map((r) => [r.key, r.href, r.title, r.time, r.sub, r.tone])])]);
    if (sig === ui.sig) return;
    ui.sig = sig;
    const a = doc.activeElement;
    const focused = a && panel.contains(a) ? a.dataset.key : '';
    const out = [];
    for (const g of groups) {
      if (g.label) out.push(make('div', 'activity-glabel', g.label));
      for (const r of g.rows) out.push(rowEl(r));
    }
    if (!out.length && !busy) out.push(make('p', 'activity-empty', TAB_EMPTY[ui.tab]));
    panel.replaceChildren(...out);
    panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (focused) ([...panel.querySelectorAll('.activity-row')].find((x) => x.dataset.key === focused) || tabs[ui.tab]).focus();
  }

  async function fetchSchedules() {
    const seq = ++ui.seq;
    let data = null;
    try { data = await loadSchedules(); } catch { data = null; }
    if (seq !== ui.seq) return;   // a newer fetch is on its way
    // A failed load (not OK, or offline) drops what was kept: Scheduled settles on its empty text, never on a list
    // it could not confirm.
    ui.sched = data ? { tickets: Array.isArray(data.tickets) ? data.tickets : [], schedules: Array.isArray(data.schedules) ? data.schedules : [] } : null;
    ui.failed = !data;
    if (!fly.isOpen()) return;
    const keyed = tablist.contains(doc.activeElement);
    render({ pick: ui.pick && !ui.failed });   // a failed load picks nothing: the open tab stays
    ui.pick = false;
    if (keyed) tabs[ui.tab].focus();   // the pick moved the selection: focus follows it (the arrows start there)
    fly.reposition();
  }

  function opened() {
    ui.sig = '';
    ui.failed = false;
    ui.pick = true;
    render({ pick: true });
    fly.reposition();
    void fetchSchedules();
  }

  function select(id, { focus = false } = {}) {
    ui.tab = id;
    ui.pick = false;
    render();
    if (focus) tabs[id].focus();
  }
  tablist.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) select(b.dataset.tab);
  });
  tablist.addEventListener('keydown', (e) => {
    const i = ACTIVITY_TABS.indexOf(ui.tab);
    const n = ACTIVITY_TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(ACTIVITY_TABS[to], { focus: true });
  });
  // A row, Open Schedules or Schedule…: close, then route. A pointer close lets go of focus, a
  // keyboard one (Enter: e.detail 0) hands it back to the button. A modified click is the browser's.
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('.activity-row, .activity-foot-link, .activity-foot-new');
    if (!t || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    fly.close(e.detail === 0 ? {} : { blur: true });
    navigate(t.dataset.href || t.getAttribute('href'));
  });
  // A keyboard open lands on the open tab (createFlyout focuses menu items; this popover has tabs).
  button.addEventListener('click', (e) => {
    if (e.detail === 0 && fly.isOpen()) tabs[ui.tab].focus();
  });

  function refresh() {
    const b = badgeState(getCounts());
    badge.textContent = String(b.n);
    badge.hidden = !b.n;
    if (b.tone) badge.dataset.tone = b.tone; else delete badge.dataset.tone;
    if (b.title) button.title = b.title; else button.removeAttribute('title');
    if (fly.isOpen()) render();
  }

  function schedulesChanged() {
    if (fly.isOpen()) { void fetchSchedules(); return; }
    ui.sched = null;   // closed: the next open shows no Scheduled number until it loads afresh
    ui.seq += 1;
  }

  return {
    refresh, schedulesChanged,
    open: (o) => fly.open(o), close: (o) => fly.close(o), isOpen: () => fly.isOpen(),
    get tab() { return ui.tab; },
  };
}
