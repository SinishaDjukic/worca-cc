(function () {
// Pulse mock: renders PulseModel (pulse-model.js) in a small Worca shell with Worca's own classes: the sidebar foot's
// avatar with its usage rings and menu, the top bar's Pulse button and its panel (Pulse has no page of its own),
// New run, and Settings › Notifications.
// The viewer's choices live in `ui`; every click repaints #app, and a repaint never scrolls the page.
const M = window.PulseModel;
const R = window.RailUI;
const SHELL = window.RailShell || null;   // the one Worca: mount into today's shell instead of drawing a frame   // the Rail components (ui/public/design-system/components)
const SM = window.SettingsModel, SV = window.SettingsView;   // Settings: its menu and every section but Notifications
const esc = R.esc;
const svg = (name, size, cls) => R.icon(name, size, { cls, stroke: 1.8 });

const caseOf = (id) => M.CASES.find((c) => c.id === id);
const groupOf = (id) => M.GROUPS.find((g) => g.id === id);
function freshSettings(c) {
  return { desktop: c.desktop, badge: 'needs', warnAt: 80, mine: 'suggest', auto: 'move', groups: Object.fromEntries(M.GROUPS.map((g) => [g.id, { level: g.level, where: g.where, ex: {} }])) };
}
// a case starts fresh: nothing from the case before it carries over
const fresh = (caseId) => ({ caseId, page: 'runs', pop: false, popTab: 'now', acct: false, sub: '', nr: null, menu: '', show: 'unread', from: 'all', nowShow: 'all', nowFrom: 'all',
  sel: [], selecting: false, anchor: '', read: [], cleared: [], fixed: [], custom: '', confirm: '', toast: '', flash: '', awayStatus: caseOf(caseId).away.status, keep: true, s: freshSettings(caseOf(caseId)), sset: '', sv: { ...SV.fresh(), gemQuota: caseOf(caseId).gemQuota || '' },
  stopped: [], fly: false, teamSeen: false, chatSeen: false, unlock: null, session: false, person: 0, people: {} });
let ui = fresh('afternoon');
// What opened with this click: only that fades in (a repaint of what was already open does not fade again).
let opening = '';
const inCls = (k) => (opening === k ? ' is-in' : '');
// Appearance is the viewer's, not the case's: it outlives a case change.
let appearance = 'system';
function applyAppearance(m) {
  appearance = m;
  if (m === 'system') document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; else document.documentElement.dataset.theme = m;
  document.querySelectorAll('[data-theme-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.themePick === document.documentElement.dataset.theme)));
}

const C = () => M.withQuota(caseOf(ui.caseId), ui.sv.gemQuota, ui.sv.gemUsed);
// A row's read state is the person's own on a shared sign-in; a problem clears when it is acted on; info rows arrive read.
const isFixed = (u) => ui.fixed.includes(u.id);
const isUnread = (u) => u.unread && !isFixed(u) && !ui.read.includes(u.id);
// A group that follows a Labs feature keeps quiet while the feature is off.
const groupShows = (g) => !g.flag || R.prefs.flag(g.flag);
const groupsShown = () => M.GROUPS.filter(groupShows);
const inShownGroup = (u) => groupShows(groupOf(u.g));
const live = () => C().updates.filter((u) => inShownGroup(u) && !ui.cleared.includes(u.id));
const unread = () => live().filter(isUnread);
const limitsNow = () => M.limits(C(), ui.s.warnAt);
// Now's sections, and what its sentence keeps of them: a run by its project; a limit belongs to a harness, so it ignores
// the project and goes only with its own choice.
const NOW_SHOWS = [{ id: 'all', text: 'everything', help: 'Every section: what needs you, limits, what is running and what is scheduled' },
  { id: 'needs', text: 'needs you', help: 'Runs waiting on a person: questions, gates, cost caps, a pause, a failure, ready to ship' }, { id: 'running', text: 'running', help: 'Runs working now' },
  { id: 'scheduled', text: 'scheduled', help: 'Starts coming up: slices, queued and scheduled runs' }, { id: 'limits', text: 'limits', help: 'Usage and spend at or over the warning line, per harness' }];
const wordOf = (state) => R.runState(state).word;
const nowRuns = () => M.nowRuns(C(), R.sectionOf, wordOf);
function nowShown(show = ui.nowShow, from = ui.nowFrom) {
  const c = nowRuns(), runs = (k) => (show === 'all' || show === k ? c[k].filter((r) => from === 'all' || r.project === from) : []);
  return { needs: runs('needs'), limits: show === 'all' || show === 'limits' ? limitsNow() : [], running: runs('running'), scheduled: runs('scheduled') };
}
const nowN = (v) => v.needs.length + v.limits.length + v.running.length + v.scheduled.length;
const nowProjects = () => [...new Set(C().runs.map((r) => r.project))];
const nowCount = () => nowN(nowShown());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

// ---- shared pieces ----
// One compact menu (Rail › Menu): one line per item, a leading check for a choice, the help in the tooltip.
function menu(id, items, align) {
  if (ui.menu !== id) return '';
  return `<div class="menu pz-menu${align === 'right' ? ' is-right' : ''}${inCls('menu')}" role="menu">${items.map((it) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    const role = it.checked === undefined ? 'menuitem' : 'menuitemradio';
    return `<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}" role="${role}"${it.checked === undefined ? '' : ` aria-checked="${!!it.checked}"`} data-pick="${esc(id)}|${esc(it.id)}"${it.help ? ` title="${esc(it.help)}"` : ''}><span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`;
  }).join('')}</div>`;
}
// A picker in the sentence it changes: the chosen words, a chevron, the menu under it.
function picker(id, text, items, tip) {
  return `<span class="pz-pick"><button type="button" class="pd-base is-words" data-menu="${esc(id)}" aria-haspopup="menu" aria-expanded="${ui.menu === id}" title="${esc(tip)}">${esc(text)}${svg('chevron', 12)}</button>${menu(id, items)}</span>`;
}
// A ring that shades along its arc: neutral at the start, amber at the warning line, red at the limit, so how far it
// has filled shows which colours it has reached. Used up, it is full and solid red (a reached limit is never hidden).
const gring = (pct, cls, t) => `<span class="pz-gring${cls ? ' ' + cls : ''}${t === 'over' ? ' is-over' : ''}" style="--p:${Math.max(0, Math.min(100, pct))};--w:${ui.s.warnAt}" aria-hidden="true"></span>`;
function avatar() {
  const rs = M.rings(C(), ui.s.warnAt);
  const tip = rs.length ? rs.map((r) => r.line).join('\n') : 'No usage reported yet';
  return `<span class="pz-ava-wrap" title="${esc(tip)}">${rs.map((r, i) => gring(r.pct, 'pz-ring-' + i, r.tone)).join('')}<span class="pz-ava">${esc(initials())}</span><i class="acct-dot pz-ava-dot" aria-hidden="true">${R.icon('away', 8, { stroke: 3 })}</i></span>`;
}
const people = () => C().identity?.people || ['Emil Angelov'];
const personName = () => people()[ui.person] || people()[0];
const initials = () => personName().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const awayRow = () => M.awayRow({ ...C().away, status: ui.awayStatus });
const isAway = () => awayRow().state === 'away';
// The sidebar's foot: Running actions (only while one runs, at every mode: it must stay stoppable), Update available, the avatar.
const runningActions = () => C().actions.filter((a) => !ui.stopped.includes(a.id));
function actionRows(menu) {
  return runningActions().map((a) => R.actionRow({ text: `${a.run} · ${a.label}`, stop: `Stop ${a.label} and free its port`, stopIcon: svg('stop', 12), menu, stopAttrs: { 'data-act-stop': a.id },
    open: a.go ? { 'data-act-open': a.id, title: `Opens ${a.run}` } : null })).join('');
}
function sideFoot() {
  const rs = M.rings(C(), ui.s.warnAt), n = runningActions().length, label = plural(n, 'running action');
  const actions = n ? `<div class="side-actions" role="group" aria-label="Running actions"><div class="side-actions-rows"><div class="act-rows">${actionRows(false)}</div></div><button type="button" class="act-tile" data-act-tile aria-haspopup="menu" aria-expanded="${ui.fly}" aria-label="${esc(label)}" title="${esc(label)}"><span class="pdot" aria-hidden="true"></span><span class="act-tile-n">${n}</span></button></div>` : '';
  const update = C().update ? '<a class="side-update" href="#settings/general" data-land="general|Version" aria-label="Update available" title="Opens Settings › General, on the version"><span class="side-update-dot" aria-hidden="true"></span><span class="side-update-label">Update available</span></a>' : '';
  const acct = `<button type="button" class="pz-acct${ui.acct ? ' is-open' : ''}" data-acct data-presence="${isAway() ? 'away' : 'here'}" aria-haspopup="menu" aria-expanded="${ui.acct}" aria-label="Account and usage${isAway() ? ', away' : ''}: ${esc(rs.map((r) => r.line).join('; ') || 'no usage reported yet')}">${avatar()}<span class="pz-acct-name">${esc(personName())}</span>${svg('updown', 14, 'pz-updown')}</button>`;
  return actions + update + acct;
}
function actionsFly() {
  if (!ui.fly || !runningActions().length) return '';
  return `<div class="menu nav-fly act-fly pz-act-fly${inCls('sub')}" role="menu" aria-label="Running actions"><span class="nav-fly-k">Running actions</span><div class="act-fly-rows"><div class="act-rows">${actionRows(true)}</div></div></div>`;
}
const mini = (pct, t) => gring(pct, 'pz-mini', t);
const pname = (p) => M.PROVIDER[p].name;

// ---- shell ----
const NAV = [['runs', 'Runs'], ['chat', 'Chats'], ['clock', 'Schedules'], ['folder', 'Projects']];
const navGo = (id, ic, t, tip) => `<button type="button" class="pz-nav-i${ui.page === id ? ' is-on" aria-current="page' : ''}" data-go="${id}" title="${tip}">${svg(ic, 16)}<span class="pz-nav-l">${t}</span></button>`;
function sidebar() {
  return `<aside class="pz-side">
    <div class="pz-brand"><span class="pz-word${swapCls}">${ui.page === 'settings' ? 'Settings' : 'Worca'}</span></div>
    ${ui.page === 'settings' ? settingsMenu() : ''}
    <nav class="pz-nav${ui.page === 'settings' ? ' is-app' : ''}${swapCls}">${NAV.map(([ic, t]) => ic === 'runs' ? navGo('runs', ic, t, 'Runs: the page behind Pulse in this prototype') : `<button type="button" class="pz-nav-i" aria-disabled="true" title="${t} is not in this prototype">${svg(ic, 16)}<span class="pz-nav-l">${t}</span></button>`).join('')}</nav>
    <div class="pz-foot">${sideFoot()}</div>
  </aside>`;
}
function topbar() {
  const needs = nowRuns().needs.length, un = unread().length, run = nowRuns().running.length;
  const badge = needs ? `<span class="topnav-badge" data-tone="need">${needs}</span>` : un ? `<span class="topnav-badge" data-tone="run">${un}</span>` : '';
  const words = [needs && plural(needs, 'needs you', 'need you'), un && plural(un, 'unread'), run && `${run} running`].filter(Boolean).join(' · ') || 'Nothing new';
  return `<header class="pz-top"><div class="pz-top-l">${R.search({ value: ui.q || '', label: 'Search or ask', results: searchResults() })}</div><div class="pz-top-r">
    <button type="button" class="btn btn-sm btn-quiet topnav-act pz-pulse-b" data-pop aria-haspopup="dialog" aria-expanded="${ui.pop}" title="Pulse: ${esc(words)}">${svg('signal', 16)}<span class="pz-pulse-l">Pulse</span>${badge}</button>
    <button type="button" class="btn btn-sm btn-primary" data-newrun title="Start a run">${svg('plus', 14)}<span class="pz-new-l">New run</span></button>
  </div></header>`;
}

// ---- rows ----
// One row on the 20px rail: the dot, the title line, the meta line, the time at the right.
// In Updates the rail holds the mark (amber: still waits for you, blue: unread, nothing once read) and, while selecting,
// the tick box in its place: one text edge for every list.
function row({ dot, mark: own, title, meta, time, tip, key, check, unreadDot, resolved, flash, fix }) {
  const mark = own ? own : dot ? `<span class="status-dot ${dot}" aria-hidden="true"></span>` : unreadDot ? '<span class="pz-unread" title="Unread"></span>' : '';
  return R.row({ kind: 'pulse', cls: `${check !== undefined ? 'has-check' : ''}${check ? ' is-sel' : ''}${unreadDot ? ' is-unread' : ''}${flash ? ' is-flash' : ''}`, attrs: { 'data-row': key },
    rail: `${mark}${check !== undefined ? `<label class="pz-check" title="Select"><input type="checkbox" data-sel="${esc(key)}"${check ? ' checked' : ''} aria-label="Select ${esc(title)}"></label>` : ''}`,
    text: `<button type="button" class="pz-row-main row-btn" data-open="${esc(key)}" title="${esc(`${title}\n${meta}\n${tip}`)}"><span class="pz-row-t${unreadDot ? ' is-unread' : ''}">${esc(title)}${resolved ? '<span class="pz-resolved">Resolved</span>' : ''}</span><span class="pz-row-m">${esc(meta)}</span></button><span class="pz-row-end"><span class="pz-row-time">${esc(time)}</span>${fix ? R.button({ label: fix, kind: 'quiet', attrs: { 'data-fix': key, title: `${fix}: deals with it here, and the row reads Resolved` } }) : ''}</span>` });
}
const dotOf = (u) => (u.sev === 'needs' && u.open ? 'is-amber' : '');
const withCheckBusy = () => ui.selecting;
// A run's mark and word come from the library's state.
const runMark = (state) => { const st = R.runState(state); return R.statusDot({ tone: st.dot, sym: st.sym }); };
const runRow = (r, key, tip) => row({ mark: runMark(r.state), title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key, tip });
function updateRow(u, withCheck) {
  return row({ dot: dotOf(u), title: u.title, meta: `${groupOf(u.g).name} · ${u.meta}`, time: u.time, key: u.id, check: withCheck ? ui.sel.includes(u.id) : undefined,
    unreadDot: isUnread(u), resolved: u.resolved || isFixed(u), fix: !isFixed(u) && !withCheckBusy() ? u.fix : '', flash: ui.flash === u.id, tip: `Opens ${u.to}${isUnread(u) ? ' and marks it read' : ''}` });
}
function nowSections() {
  const c = nowShown(), lim = c.limits;
  const bar = `<div class="pz-bar"><span class="pz-rail"></span><span class="pz-sentence">Showing ${picker('nowShow', NOW_SHOWS.find((x) => x.id === ui.nowShow).text, NOW_SHOWS.map((x) => ({ ...x, checked: x.id === ui.nowShow, hint: String(nowN(nowShown(x.id, ui.nowFrom))) })), 'Which of Now\'s sections the panel shows')} from ${picker('nowFrom', ui.nowFrom === 'all' ? 'all projects' : ui.nowFrom, [{ id: 'all', text: 'all projects', checked: ui.nowFrom === 'all', hint: String(nowN(nowShown(ui.nowShow, 'all'))) }, { sep: true }].concat(nowProjects().map((p) => ({ id: p, text: p, checked: ui.nowFrom === p, hint: String(nowN(nowShown(ui.nowShow, p))) }))), 'Which project\'s runs it shows; limits belong to a harness and show for every project')}</span></div>`;
  const sec = (h, n, rows) => (n ? `<section class="pz-sec"><h3 class="pz-h">${h} <span class="n">${n}</span></h3><div class="pz-list">${rows}</div></section>` : '');
  const out = sec('Needs you', c.needs.length, c.needs.map((r, i) => runRow(r, 'need' + i, 'Opens the run page at what it asks')).join(''))
    + sec('Limits', lim.length, lim.map((l, i) => row({ dot: l.tone === 'over' ? 'is-red' : 'is-amber', title: l.title, meta: l.detail, time: l.time, key: 'lim' + i, tip: `${l.tip} · opens the usage card` })).join(''))
    + sec('Running', c.running.length, c.running.map((r, i) => runRow(r, 'run' + i, 'Opens the live run')).join(''))
    + scheduledSection(c.scheduled);
  const all = ui.nowShow === 'all' && ui.nowFrom === 'all';
  return bar + (out || `<p class="pz-empty">${all ? 'Nothing needs you. Nothing is running.' : 'Nothing here right now.'}</p>`);
}

// Scheduled, by when: Missed, Today, Tomorrow, This week, Later, After a run; a group with nothing has no head.
function scheduledSection(list) {
  if (!list.length) return '';
  const rowOf = (r) => row({ dot: r.when === 'missed' ? 'is-amber' : 'is-grey-ring', title: r.title, meta: `${r.project} · ${r.on ? startDetail(r) : r.detail}`, time: r.time, key: 'sch' + C().runs.indexOf(r), tip: r.slice ? 'Opens the feature: its slices and where each runs' : r.queued ? 'Opens the run: it waits for a free slot' : 'Opens Schedules with its sheet open' });
  const groups = M.SCHED.filter(([id]) => list.some((r) => r.when === id)).map(([id, name]) => `<h4 class="pz-h pz-day">${name}</h4><div class="pz-list">${list.filter((r) => r.when === id).map(rowOf).join('')}</div>`).join('');
  return `<section class="pz-sec"><h3 class="pz-h">Scheduled <span class="n">${list.length}</span></h3>${groups}</section>`;
}

// A start with nobody there to ask (a slice, a queued or scheduled run) is checked against its own estimate when its turn
// comes, and follows Settings › When a limit is near. One that waits does not hold up the line: the next start that fits
// goes ahead of it. A slice still waits for the slice before it.
function startPlan(r) {
  const c = C(), w = ui.s.warnAt, lim = M.near(c, r.on, w, r.size);
  if (!lim) return { go: 'start' };
  const rm = M.room(c, w, r.on, r.size);
  const why = lim.pct >= 100 ? `${lim.name}'s ${lim.what} is used up` : lim.need != null ? `it needs about ${lim.need}% of ${lim.name}'s ${lim.what}, ${lim.left}% is left` : `${lim.name}'s ${lim.what} is at ${lim.pct}%`;
  if (ui.s.auto === 'asis') return { go: 'asis', lim, why };
  if (ui.s.auto === 'move' && rm.length) return { go: 'move', to: rm[0], lim, why };
  return { go: 'wait', lim, why };
}
const share = (p, size) => { const e = M.est(p, size), u = C().usage.find((x) => x.p === p); const k = e && u && u.win.map((x) => x.k).find((x) => e[x] != null); return k ? `about ${e[k]}% of its ${M.WHAT[k]}` : ''; };
function startDetail(r) {
  const later = nowRuns().scheduled, pl = startPlan(r), i = later.indexOf(r);
  if (pl.go === 'asis') return `Starts on ${pl.lim.name} and may pause: ${pl.why}`;
  if (pl.go === 'move') return `Will start on ${pname(pl.to)}: ${pl.why}`;
  if (pl.go === 'wait') return `Waits for ${pl.lim.resets}: ${pl.why}`;
  const held = later.slice(0, i).find((x) => x.on && startPlan(x).go === 'wait');
  if (held) return `Goes ahead of ${held.slice ? held.title.split(' · ')[1] : held.title} on ${pname(r.on)}: it fits, ${share(r.on, r.size)}`;
  return r.slice ? `Starts on ${pname(r.on)} when slice 2 is done · ${share(r.on, r.size)}` : `Starts on ${pname(r.on)} when a slot is free · ${share(r.on, r.size)}`;
}

// ---- Pulse: the panel under the Pulse button is the whole hub (Now, every update, select and clear); no page ----
function popover() {
  if (!ui.pop) return '';
  const un = unread();
  const more = `<span class="pz-pick">${`<button type="button" class="btn btn-sm btn-quiet btn-icon" data-menu="more" aria-haspopup="menu" aria-expanded="${ui.menu === 'more'}" aria-label="More" title="More">${svg('more', 16)}</button>`}${menu('more', [
    { id: 'allread', text: 'Mark all read', help: un.length ? 'Marks every unread update read; nothing is cleared' : 'Nothing is unread' },
    { id: 'clearread', text: 'Clear read', help: 'Moves every read update in this view to Cleared' },
    ...(ui.popTab === 'updates' ? [{ id: 'select', text: 'Select', help: 'Tick updates to mark read or clear several at once' }] : []), { sep: true },
    { id: 'settings', text: 'Notification settings', help: 'Settings › Notifications: what reaches you and what a start does near a limit' }], 'right')}</span>`;
  return `<div class="pz-popover${inCls('pop')}" role="dialog" aria-label="Pulse">
    <div class="pz-phead"><div class="tabs pz-ptabs" role="tablist">${[['now', 'Now', nowCount()], ['updates', 'Updates', un.length]].map(([id, t, n]) => `<button type="button" class="tab" role="tab" aria-selected="${ui.popTab === id}" data-ptab="${id}" title="${id === 'now' ? 'What is true right now: it changes by itself and cannot be cleared' : `What happened: read, select and clear, like runs. Kept for 90 days${C().identity ? '. Read and cleared are yours; others on this sign-in keep their own' : ''}`}">${t}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>${more}</div>
    <div class="pz-pbody">${ui.popTab === 'now' ? nowSections() : updatesPanel()}</div>${bulkBar()}
  </div>`;
}

// ---- the account menu: Worca's own menu (index.html #acct-menu); its spend card is now Usage and costs, the last row ----
const LEVELS_UI = [['simple', 'Simple', 'The essentials: start runs, answer them, see what shipped'], ['advanced', 'Advanced', 'Also workflows, schedules and costs'], ['expert', 'Expert', 'Everything: agents, engines, Labs']];
const cap = (w) => w[0].toUpperCase() + w.slice(1);
function acctMenu() {
  if (!ui.acct) return '';
  const c = C(), top = M.rings(c, ui.s.warnAt).sort((a, b) => b.pct - a.pct)[0];
  const val = top ? (top.pct >= 100 ? 'Reached' : `${top.pct}%`) : c.budget ? M.usd(c.budget.spent) : '';
  const lvl = LEVELS_UI.find((l) => l[0] === R.prefs.mode()), away = awayRow();
  // Who is looking, only on a shared sign-in; your team's new setup, until you look at it; the way past a blocked budget.
  const id = c.identity ? `<div class="mcard id-card" role="group" aria-label="Signed in as"><span class="mc-k">Signed in as</span><b>${esc(personName())}</b><small>${esc(c.identity.via)}</small></div>` : '';
  const team = c.teamSetup && !ui.teamSeen ? `<button type="button" class="mi menu-item pz-team" role="menuitem" data-team title="Opens Settings › Team policy; the note goes once you have looked">${R.statusDot({ tone: 'is-amber' })}<span class="mi-lbl">Your team updated the recommended setup</span><span class="mi-val">Review</span></button>` : '';
  const raise = c.budget?.blocked ? `<button type="button" class="mi menu-item" role="menuitem" data-land="runs|Budget" title="Runs pause until the budget resets. Opens Settings › Runs, on Budget">${svg('up', 16, 'mi-ic')}<span class="mi-lbl">Raise limit</span><span class="mi-val">${M.usd(c.budget.limit)}</span></button>` : '';
  const sub = (id) => `data-sub="${id}" aria-haspopup="menu" aria-expanded="${ui.sub === id}"`;
  // Top to bottom, rarest to most used, since the menu opens up from the avatar: how Worca looks and the door to
  // Settings; you today (Away, Keep awake); what the rings say, right above the avatar that wears them.
  return `<div class="menu nav-fly acct-menu${ui.sub ? ' has-sub' : ''}${inCls('acct')}" role="menu" aria-label="Account">
    ${id}<div class="msect" role="group" aria-label="Worca">${team}
      <button type="button" class="mi menu-item" role="menuitem" ${sub('lvl')} title="How much of Worca you see">${svg('sliders', 16, 'mi-ic')}<span class="mi-lbl">Interface mode</span><span class="mi-val">${lvl[1]}</span>${svg('chevR', 14, 'mi-chev')}</button>
      <div class="theme-sect" role="group" aria-labelledby="pz-theme-k">${svg('contrast', 16, 'mi-ic')}<span class="theme-k" id="pz-theme-k">Appearance</span><div class="theme-seg">${[['system', 'monitor'], ['light', 'sun'], ['dark', 'moon']].map(([m, ic]) => `<button type="button" class="theme-ic${appearance === m ? ' on' : ''}" role="menuitemradio" aria-checked="${appearance === m}" data-appearance="${m}" aria-label="${cap(m)}" title="${cap(m)}">${svg(ic, 14, 'mi-ic')}</button>`).join('')}</div></div>
      <button type="button" class="mi menu-item" role="menuitem" data-go="settings" title="How Worca behaves everywhere">${svg('gear', 16, 'mi-ic')}<span class="mi-lbl">Settings</span></button>
    </div>
    <div class="msect" role="group" aria-label="You">
      <button type="button" class="mi menu-item away-item sw-item" role="menuitemcheckbox" aria-checked="${away.state === 'away'}" data-state="${away.state}"${away.disabled ? ' aria-disabled="true"' : ''} data-sw="away" title="${esc(away.tip)}">${svg('away', 16, 'mi-ic')}<span class="mi-lbl">Away</span>${away.hint ? `<span class="mi-hint">${esc(away.hint)}</span>` : ''}<span class="switch" aria-hidden="true"></span></button>
      <button type="button" class="mi menu-item sw-item" role="menuitemcheckbox" aria-checked="${ui.keep}" data-sw="keep" title="Keeps the computer awake while runs are working. The display may still turn off.">${svg('cup', 16, 'mi-ic')}<span class="mi-lbl">Keep awake</span><span class="switch" aria-hidden="true"></span></button>
    </div>
    <div class="msect" role="group" aria-label="Usage">${raise}
      <button type="button" class="mi menu-item" role="menuitem" ${sub('usage')} title="${esc(top ? `Closest to its limit: ${top.line}` : 'Limits per harness and the spend')}">${top ? gring(top.pct, 'pz-mi-ring', top.tone) : svg('signal', 16, 'mi-ic')}<span class="mi-lbl">Usage and costs</span><span class="mi-val">${esc(val)}</span>${svg('chevR', 14, 'mi-chev')}</button>
    </div>
  </div>${usageFly()}${lvlFly()}`;
}
// The side menus open beside the account menu (side-flyout.mjs 'beside'); on a narrow screen in its place, with a way back.
const back = `<button type="button" class="mi menu-item pz-subback" role="menuitem" data-sub="" title="Back to the account menu">${svg('chevL', 14, 'mi-chev')}<span class="mi-lbl">Account</span></button>`;
function usageFly() {
  if (ui.sub !== 'usage') return '';
  const c = C(), w = ui.s.warnAt;
  const block = (u) => {
    const pr = M.PROVIDER[u.p];
    const rows = u.win.length ? u.win.map((x) => {
      const t = M.tone(x.pct, w);
      return `<div class="pz-urow" title="${esc(`${M.winWord(x.k)} ${x.pct}% · ${pr.src} at ${u.asOf}`)}">${mini(x.pct, t)}<span class="pz-uk">${M.winWord(x.k)}</span><span class="pz-uv${t ? ' is-' + t : ''}">${x.pct >= 100 ? 'Reached' : M.fig(x)}</span><span class="pz-ur">resets ${esc(x.resets)}</span></div>`;
    }).join('') : u.noQuota ? `<p class="pz-unote" title="${esc(pr.name)} reports no figures: Worca counts its requests against the quota you set">No quota set. ${R.textLink({ label: 'Set in Providers', attrs: { 'data-land': 'providers|Gemini CLI|list', title: 'Opens Settings › Providers, on its quota' } })}</p>`
      : '<p class="pz-unote" title="An API key is billed per token: the spend below is its limit">Billed per token: no session or weekly limit</p>';
    const noSession = u.note ? `<p class="pz-unote" title="${esc(u.note.tip)}">${esc(u.note.text)}</p>` : '';
    return `<div class="pz-ublock"><div class="pz-uhead"><span class="pz-uname">${esc(pr.name)}</span><span class="pz-uplan" title="${esc(`${pr.vendor} · ${u.plan}`)}">${esc(pr.vendor)} · ${esc(u.plan)}</span><span class="pz-uas" title="As fresh as the last turn that used ${esc(pr.name)}">as of ${esc(u.asOf)}</span></div>${rows}${noSession}</div>`;
  };
  return `<div class="menu nav-fly pz-fly${inCls('sub')}" role="menu" aria-label="Usage and costs">${back}
    <span class="nav-fly-k" title="What can stop a run, per harness: the rings around your avatar show the closest of each">Limits</span>
    <div class="pz-ublocks">${c.usage.map(block).join('')}</div>${spendCard(c)}
    <div class="msect" role="group"><button type="button" class="mi menu-item" role="menuitem" data-go="settings" data-to="notifications" title="The warning line, what reaches you, and what Worca does when a limit is near">${svg('gear', 16, 'mi-ic')}<span class="mi-lbl">Limit settings</span></button></div>
  </div>`;
}
// The spend card as account-menu.mjs paints it today (renderSpendCard), with the gradient ring when a budget has a limit.
function spendCard(c) {
  const b = c.budget; if (!b) return '';
  const pct = M.spendPct(b), t = pct == null ? '' : M.tone(pct, ui.s.warnAt);
  const rows = b.limit ? `<dt>Limit</dt><dd>${M.usd(b.limit)}</dd><dt>Spent</dt><dd class="${t}">${M.usd(b.spent)}</dd>` : `<dt>Spent</dt><dd>${M.usd(b.spent)}</dd><dt>Saved</dt><dd class="pos">${M.usd(b.saved)}</dd>`;
  return `<div class="mcard spend-card" role="group" aria-label="Spend ${b.period}" title="Estimated spend ${b.period}: ${M.usd(b.spent)}${b.limit ? ` of ${M.usd(b.limit)}` : ''}. Claude Code client-side estimate, not authoritative billing"><div class="mc-head">${pct != null ? mini(pct, t) : ''}<button type="button" class="mc-title pz-mc-link" role="menuitem" data-details title="Opens Statistics: spend per run, model and day">Spend ${b.period}</button></div><dl class="mc-rows">${rows}</dl></div>`;
}
function lvlFly() {
  if (ui.sub !== 'lvl') return '';
  return `<div class="menu nav-fly lvl-menu pz-fly${inCls('sub')}" role="menu" aria-label="Interface mode">${back}<span class="nav-fly-k">Interface mode</span>${LEVELS_UI.map(([id, t, h]) => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${R.prefs.mode() === id}" data-level="${id}" title="${esc(h)}"><span class="mi-l">${t}</span></button>`).join('')}</div>`;
}

// ---- New run: where a limit is about to be spent, the one place it warns before starting ----
const MINE = [
  { id: 'suggest', text: 'suggest one with room', help: 'New run and Resume say which limit is near and offer a harness with room, or a start after the reset; you choose' },
  { id: 'move', text: 'pick one with room', help: 'Worca picks the harness with the most room and says why; you can change it back in the sentence' },
  { id: 'wait', text: 'start after the reset', help: 'The start button becomes Start at, the time the limit resets' },
  { id: 'asis', text: 'start as chosen', help: 'Only a line saying it may pause' }];
const AUTO = [
  { id: 'move', text: 'moves to one with room', help: 'It starts on the harness with the most room and keeps it to the end; with none, it waits for the reset. Each move or wait is an update in Pulse' },
  { id: 'wait', text: 'waits for the reset', help: 'It starts when the limit resets; an update in Pulse says so' },
  { id: 'asis', text: 'starts anyway', help: 'It starts as planned and may pause; it resumes by itself after the reset' }];
// New run checks the run's estimate (Shaper's size, history of runs like it) against what is left on the harness.
function openNewRun(size) {
  const c = C(), w = ui.s.warnAt, sz = size || c.task.size, first = c.usage.find((u) => M.PROVIDER[u.p].runs).p, lim = M.near(c, first, w, sz), rm = M.room(c, w, first, sz);
  ui.nr = { on: first, size: sz, wait: false, moved: '' };
  if (lim && ui.s.mine === 'move' && rm.length) ui.nr = { on: rm[0], size: sz, wait: false, moved: `Worca picked ${pname(rm[0])}: ${lim.need != null ? `this run needs about ${lim.need}% of ${lim.name}'s ${lim.what} and ${lim.left}% is left` : `${lim.name}'s ${lim.what} is at ${lim.pct}%`}` };
  else if (lim && ui.s.mine === 'wait') ui.nr.wait = true;
}
const SIZE_HELP = { small: 'A change in one or two files', medium: 'A change across a few files, with tests', large: 'A feature across modules; Shaper may offer slices' };
function newRun() {
  if (!ui.nr) return '';
  const c = C(), w = ui.s.warnAt, h = ui.nr.on, sz = ui.nr.size, lim = M.near(c, h, w, sz), rm = M.room(c, w, h, sz);
  const hint = (p) => { const u = c.usage.find((x) => x.p === p), e = M.est(p, sz); return u.win.length ? u.win.map((x) => `${M.winWord(x.k).toLowerCase()} ${x.pct}%${e && e[x.k] != null ? ` +${e[x.k]}` : ''}`).join(', ') : u.noQuota ? 'no quota set' : 'billed per token'; };
  const items = c.usage.filter((u) => M.PROVIDER[u.p].runs).map((u) => ({ id: u.p, text: pname(u.p), hint: hint(u.p), checked: u.p === h, help: `${M.PROVIDER[u.p].vendor} · ${u.plan}: used, and +what this run needs` }));
  const reached = !!lim && lim.pct >= 100, waits = !!lim && (ui.nr.wait || reached);
  const note = (dot, text, acts) => `<div class="pz-advice"><span class="pz-rail">${dot ? `<span class="status-dot ${dot}" aria-hidden="true"></span>` : ''}</span><div><p class="pz-advice-t">${esc(text)}</p>${acts ? `<div class="pz-advice-acts">${acts}</div>` : ''}</div></div>`;
  // the estimate in the size's sentence: what it needs of the tightest window, and what is left there; the advice says it
  // instead when the run does not fit (one place per fact)
  const e = M.est(h, sz), u = c.usage.find((x) => x.p === h);
  const tight = e && u.win.filter((x) => e[x.k] != null).sort((a, b) => b.pct + e[b.k] - (a.pct + e[a.k]))[0];
  const need = lim && !ui.nr.moved ? '' : tight ? ` · about ${e[tight.k]}% of its ${M.WHAT[tight.k]}, ${Math.max(0, 100 - tight.pct)}% left` : u.win.length ? ` · too few runs this size to estimate` : '';
  const sizeTip = tight ? `The median of ${M.N[sz]} done runs this size with the same agents, last 60 days. Shaper sized the task; change it if it is wrong` : 'Shaper sized the task; change it if it is wrong';
  let advice = '';
  if (ui.nr.moved) advice = note('', `${ui.nr.moved}.`);
  else if (lim) {
    const say = reached ? `${lim.name}'s ${lim.what} is used up until ${lim.resets}.`
      : lim.need != null ? `This run needs about ${lim.need}% of ${lim.name}'s ${lim.what}; ${lim.left}% is left until ${lim.resets}. It may pause before it finishes.`
      : `${lim.name}'s ${lim.what} is at ${lim.pct}% and resets ${lim.resets}. This run may pause before it finishes.`;
    const other = rm.length ? `<button type="button" class="btn btn-sm" data-nr-use="${rm[0]}" title="${esc(`${pname(rm[0])} has room: ${hint(rm[0])}. Each agent runs the same tier on it`)}">Run on ${esc(pname(rm[0]))}</button>` : '';
    if (waits) advice = note(reached ? 'is-red' : 'is-amber', `${say} It starts at ${lim.resets}, when that resets.${rm.length ? '' : ' No other harness has room.'}`,
      other + (reached ? '' : '<button type="button" class="btn btn-sm btn-quiet" data-nr-now title="Start now: it may pause and resume by itself after the reset">Start now instead</button>'));
    else if (ui.s.mine === 'asis') advice = note('is-amber', say);
    else advice = note('is-amber', say + (rm.length ? ` ${pname(rm[0])} has room.` : ' No other harness has room.'), other + `<button type="button" class="btn btn-sm btn-quiet" data-nr-wait title="Schedules it for when the limit resets">Start at ${esc(lim.resets)}</button>`);
  }
  const start = waits ? `Start at ${lim.resets}` : 'Start run';
  return `<div class="viewer-modal${inCls('nr')}"><div class="card pz-newrun" role="dialog" aria-modal="true" aria-label="New run">
    <div class="pz-nr"><h2 class="pz-nr-h">New run</h2>
      <p class="pz-sentence">A ${picker('nr-size', sz, M.SIZES.map((x) => ({ id: x, text: x, checked: x === sz, help: SIZE_HELP[x] })), sizeTip)} task on ${picker('nr-on', pname(h), items, 'Which harness runs it: each shows how much of its limits is used, and +what this run needs')} in web-app${esc(need)}</p>
      <div class="pz-nr-task" title="The task (filled in for this prototype)">${esc(c.task.title)}</div>
      ${advice}</div>
    <div class="pz-pfoot"><button type="button" class="btn btn-sm btn-quiet" data-nr-cancel title="Closes without starting">Cancel</button><button type="button" class="btn btn-sm btn-primary" data-nr-start title="${waits ? `Schedules it for ${esc(lim.resets)}` : `Starts it now on ${esc(pname(h))}`}">${esc(start)}</button></div>
  </div></div>`;
}

// ---- Updates in the Pulse panel ----
const SHOWS = [
  { id: 'unread', text: 'unread', help: 'Updates you have not opened or marked read' }, { id: 'all', text: 'all', help: 'Every update that is not cleared' },
  { id: 'needs', text: 'needs you', help: 'Questions, gates and cost caps, open or resolved' }, { id: 'problems', text: 'problems', help: 'What went wrong while nobody was waiting' },
  { id: 'cleared', text: 'cleared', help: 'Updates you cleared; kept for 90 days' }];
// What the list shows for a choice of the sentence; each choice in its menu carries its count (the list's sentence).
function shown(show = ui.show, from = ui.from) {
  const all = C().updates;
  const by = show === 'cleared' ? all.filter((u) => inShownGroup(u) && ui.cleared.includes(u.id)) : live().filter((u) => show === 'all' || (show === 'unread' && isUnread(u)) || (show === 'needs' && u.sev === 'needs') || (show === 'problems' && u.sev === 'problem'));
  return by.filter((u) => from === 'all' || u.g === from);
}
function updatesPanel() {
  const list = shown();
  const n = ui.sel.filter((id) => list.some((u) => u.id === id)).length;
  // While selecting, Select all sits at the sentence's right, as in the Runs list's head
  const all = ui.selecting && list.length ? `<label class="runs-all-wrap"><input type="checkbox" class="runs-check runs-all" data-selall${n === list.length ? ' checked' : n ? ' data-mixed' : ''} aria-label="Select all shown"> Select all</label>` : '';
  const bar = `<div class="pz-bar"><span class="pz-rail"></span><span class="pz-sentence">Showing ${picker('show', SHOWS.find((s) => s.id === ui.show).text, SHOWS.map((s) => ({ ...s, checked: s.id === ui.show, hint: String(shown(s.id, ui.from).length) })), 'Which updates the list shows')} from ${picker('from', ui.from === 'all' ? 'all groups' : groupOf(ui.from).name, [{ id: 'all', text: 'all groups', checked: ui.from === 'all', hint: String(shown(ui.show, 'all').length) }, { sep: true }].concat(groupsShown().map((g) => ({ id: g.id, text: g.name, checked: ui.from === g.id, hint: String(shown(ui.show, g.id).length) }))), 'Which group the updates come from')}</span>${all}</div>`;
  if (!list.length) return bar + `<p class="pz-empty">${ui.show === 'unread' ? 'You are up to date.' : ui.show === 'cleared' ? 'Nothing cleared.' : 'No updates here.'}</p>`;
  const days = [...new Set(list.map((u) => u.day))];
  return bar + days.map((d) => `<section class="pz-sec"><h3 class="pz-h pz-day">${d}</h3><div class="pz-list${ui.selecting ? ' is-selecting' : ''}">${list.filter((u) => u.day === d).map((u) => updateRow(u, true)).join('')}</div></section>`).join('');
}
// The selection's actions: the Runs list's bar (.runs-bulk) at the panel's foot, each action with how many it applies to.
function bulkBar() {
  if (ui.popTab !== 'updates' || !ui.selecting) return '';
  const ups = shown().filter((u) => ui.sel.includes(u.id)), unreadN = ups.filter(isUnread).length;
  const openNeeds = ups.filter((u) => u.sev === 'needs' && u.open).length;
  const btn = (k, word, n, tip) => `<button type="button" class="btn btn-sm" data-bulk="${k}"${n ? '' : ' disabled'} title="${esc(n ? tip : ups.length ? 'All of them are read already' : 'Nothing selected')}">${word} <span class="runs-bulk-c">${n}</span></button>`;
  const acts = ui.show === 'cleared' ? btn('restore', 'Restore', ups.length, 'Puts them back in All')
    : btn('read', 'Mark read', unreadN, unreadN < ups.length ? `Skips ${ups.length - unreadN} already read` : 'Marks them read; they stay in All')
      + btn('clear', 'Clear', ups.length, openNeeds ? `${plural(openNeeds, 'run')} still ${openNeeds === 1 ? 'waits' : 'wait'} for you in Now: clearing does not answer it` : 'Moves them to Cleared; Undo in the notice');
  return `<div class="runs-bulk" role="toolbar" aria-label="Selected updates"><span class="runs-bulk-n">${ups.length} selected</span>${acts}<button type="button" class="btn btn-sm btn-quiet" data-bulk="cancel" title="Stop selecting · Esc">Cancel</button></div>`;
}
// As the Runs list: ⌘ or Ctrl-click (or the tick box) ticks one update, Shift ticks every one from the last ticked;
// unticking the last one stops selecting.
function tick(id, range) {
  const ids = shown().map((u) => u.id), a = ids.indexOf(ui.anchor), b = ids.indexOf(id);
  ui.selecting = true;
  if (range && a >= 0 && b >= 0) { ui.sel = [...new Set(ui.sel.concat(ids.slice(Math.min(a, b), Math.max(a, b) + 1)))]; return; }
  ui.anchor = id;
  ui.sel = ui.sel.includes(id) ? ui.sel.filter((x) => x !== id) : ui.sel.concat(id);
  if (!ui.sel.length) ui.selecting = false;
}
// The page behind Pulse: Runs is not in this prototype; Pulse opens over any page.
function runsPage() {
  return `<div class="pz-head"><h1 class="pz-title">Runs</h1></div>
    <p class="pz-meta"><span>Runs is not in this prototype. Pulse opens from the top bar over any page.</span></p>`;
}

// ---- Settings ----
// The sidebar becomes Settings' menu (B: plans/rail/mocks/settings-menu-b-sidebar-*.png), ‹ Back to Worca at its top.
// On a narrow screen the sidebar stays Worca's, and Settings opens on its menu as a list; a section has ‹ Settings.
// Every section is SettingsSections of SettingsRows (the components own the alignment). Notifications is drawn here,
// from Pulse's model; every other section comes from settings-model.js through settings.js.
const sp = (id, text, items, tip, right) => R.sentencePicker({ id, text, items, open: ui.menu === id, tip, chevron: svg('chevron', 12), right });
const sectionId = () => ui.sset || SM.FIRST;
const menuGroups = () => SM.GROUPS.map((g) => ({ title: g.title, items: g.items.filter((id) => SM.visible(id, R.prefs.mode())).map((id) => ({ label: SM.title(id), current: id === sectionId(), attrs: { 'data-sset': id } })) }));
const settingsMenu = () => R.sideMenu({ label: 'Settings', cls: swapCls.trim(), back: { label: 'Back to Worca', icon: svg('chevL', 14), attrs: { 'data-go': 'runs', title: 'Back to the page you came from' } }, groups: menuGroups() });
// The narrow screen's first view: the same menu as a list in the page.
const settingsIndex = () => `<div class="cfg-index"><div class="pz-head"><h1 class="pz-title">Settings</h1></div>${R.sideMenu({ label: 'Settings', list: true, chevron: svg('chevR', 14), groups: menuGroups().map((g) => ({ ...g, items: g.items.map((x) => ({ ...x, current: false })) })) })}</div>`;

const levelText = (id) => M.LEVELS.find((l) => l.id === id).text;
const whereText = (id) => M.WHERE.find((w) => w.id === id).text;
const effWhere = (g, ev) => { const gs = ui.s.groups[g.id]; return gs.ex[ev[0]] || (M.qualifies(gs.level, ev[2]) ? gs.where : 'pulse'); };
const quiet = (label, a) => R.button({ label, kind: 'quiet', attrs: a });
function notifications() {
  const s = ui.s;
  const BADGE = [{ id: 'needs', text: 'what needs you', help: 'The tab title, the favicon\'s dot and the app icon show while 2 runs wait for you' }, { id: 'problems', text: 'what needs you and problems', help: 'Also unread problems: a failed run, a missed start, a limit' }, { id: 'none', text: 'nothing', help: 'The tab title never shows a count' }];
  const desk = s.desktop === 'blocked'
    ? R.settingsRow({ name: 'Desktop', sentence: 'Desktop notifications are <b>blocked in this browser</b>', end: R.button({ label: 'How to allow', kind: 'quiet', attrs: { 'data-how': '', title: 'Allow notifications for this site in the browser\'s site settings, then come back' } }) })
    : s.desktop === 'unsupported' ? R.settingsRow({ name: 'Desktop', sentence: 'This browser does not support desktop notifications' })
    : s.desktop === 'insecure' ? R.settingsRow({ name: 'Desktop', sentence: 'Desktop notifications need a secure address: open Worca on https:// or localhost' })
    : R.settingsRow({ name: 'Desktop', sentence: 'Desktop notifications in this browser', end: R.button({ label: 'Send test', kind: 'quiet', attrs: { 'data-test': '', disabled: s.desktop !== 'on', title: s.desktop === 'on' ? 'Sends one test notification' : 'Turn desktop notifications on to send a test' } })
      + R.switchButton({ on: s.desktop === 'on', label: 'Desktop notifications in this browser', why: s.desktop === 'on' ? 'On: what a group sends to desktop shows as a notification' : 'Off: no desktop notifications from any group', attrs: { 'data-desk': '' } }) });
  const channels = desk
    + R.settingsRow({ name: 'Badge', sentence: `The tab title counts ${sp('badge', BADGE.find((b) => b.id === s.badge).text, BADGE.map((b) => ({ ...b, checked: b.id === s.badge })), 'What the count in the tab title counts')}` })
    + R.settingsRow({ name: 'Chat', sentence: `Sent to ${M.CHANNELS.length} channels: ${M.CHANNELS.join(', ')}`, end: quiet('Manage', { 'data-sset': 'ask', title: 'Channels, mute and allow-lists are in Settings › Chat' }) });
  const groups = groupsShown().map((g) => {
    const gs = s.groups[g.id], open = ui.custom === g.id, nEx = Object.keys(gs.ex).length;
    const warn = g.id === 'usage' ? ` · warn at ${sp('warn', s.warnAt + '%', [70, 80, 90].map((v) => ({ id: String(v), text: v + '%', checked: s.warnAt === v, help: `Rings turn amber, Now shows the limit and an update is sent at ${v}%` })), 'The warning line for usage and spend')}` : '';
    const detailRows = open ? g.events.map((ev) => {
      const w = effWhere(g, ev);
      return R.settingsRow({ name: ev[1], help: `${ev[0]} · ${ev[2] === 'needs' ? 'needs you' : ev[2]}`, changed: !!gs.ex[ev[0]], sentence: `on ${sp('ev:' + ev[0], whereText(w), M.WHERE.map((x) => ({ ...x, checked: x.id === w })), `Where ${ev[1]} goes`)}` });
    }).join('') : '';
    const detailAction = open && nEx ? quiet('Back to the group', { 'data-backgroup': g.id, title: 'Every event follows the group again' }) : '';
    return R.settingsRow({ name: g.name, detailRows, detailAction, changed: nEx > 0,
      sentence: `Tell me about ${sp('lvl:' + g.id, levelText(gs.level), M.LEVELS.map((l) => ({ ...l, checked: l.id === gs.level })), `How much of ${g.name} reaches you`)} on ${sp('whr:' + g.id, whereText(gs.where), M.WHERE.map((x) => ({ ...x, checked: x.id === gs.where })), `Where ${g.name} goes beyond Pulse`, true)}${warn}`,
      fold: { open, attrs: { 'data-custom': g.id }, help: open ? 'Close the events' : 'Choose per event: ' + g.events.map((e) => e[1]).join(', ') } });
  }).join('');
  const limits = R.settingsRow({ name: 'Manual starts', sentence: `New run and Resume near a limit ${sp('mine', MINE.find((m) => m.id === s.mine).text, MINE.map((m) => ({ ...m, checked: m.id === s.mine })), 'What New run and Resume do when the harness is near its limit')}` })
    + R.settingsRow({ name: 'Automatic starts', sentence: `A slice or scheduled run near a limit ${sp('auto', AUTO.find((m) => m.id === s.auto).text, AUTO.map((m) => ({ ...m, checked: m.id === s.auto })), 'What a start with nobody there to ask does near a limit. One that waits never holds up the line: the next start that fits goes ahead')}` })
    + R.settingsRow({ name: 'Paused runs', sentence: 'Set in Runs', end: quiet('Open Runs', { 'data-land': 'runs|Paused runs', title: 'What a run paused at a limit does when it resets: Settings › Runs, on that row' }) });
  const confirm = ui.confirm === 'reset' ? R.confirmStrip({ text: 'Reset every group to its defaults? Your channels stay as they are.', yes: 'Reset' }) : '';
  return confirm
    + R.settingsSection({ title: 'Channels', rows: channels })
    + R.settingsSection({ title: 'Updates', meta: 'What each kind of update sends beyond Pulse. Pulse keeps everything for 90 days; a problem clears when you act on it.', rows: groups, action: quiet('Reset to defaults', { 'data-reset': '', title: 'Every group back to its defaults; asks first' }) })
    + R.settingsSection({ title: 'Limits', meta: `Near: the run's estimate does not fit in what is left of a window; with no estimate, at the warning line (${s.warnAt}%).`, rows: limits });
}
function settingsPage() {
  const id = sectionId();
  const min = SM.min(id), need = min ? cap(min) : '';
  const body = !SM.shows(min, R.prefs.mode()) ? R.emptyState({ title: `${SM.title(id)} needs ${need}`, actions: R.button({ label: `Switch to ${need}`, kind: 'quiet', attrs: { 'data-unlock': 'mode:' + min } }) })
    : id === 'notifications' ? notifications() : SV.section(id, ui.sv, { R, svg, open: ui.menu, esc, level: R.prefs.mode() });
  return `<div class="cfg-page${ui.sset ? '' : ' is-index'}">${settingsIndex()}
    <div class="cfg-section">${R.backLink({ label: 'Settings', icon: svg('chevL', 14), attrs: { 'data-sset': '', class: null } })}
    <div class="pz-head"><h1 class="pz-title">${esc(SM.title(id))}</h1></div>
    <p class="pz-meta pz-tabmeta"><span>${esc(SM.meta(id))}</span></p>
    <div class="cfg-body">${body}</div></div></div>`;
}

// ---- search: runs, projects, workspaces, workflows, schedules, tickets, labels (label:), settings, add-ons, plugins and
// chats, each with where it lives. What the mode or Labs hides is still found, with its lock note; picking it hands you to
// the unlock and then on to it. The last row asks Chat. ----
const NOTIF_ROWS = ['Desktop', 'Badge', 'Chat', 'Runs', 'Schedules', 'Automations', 'Pull requests', 'Usage', 'Away mode', 'Projects', 'Manual starts', 'Automatic starts', 'Paused runs'];
const strict = (...ms) => ms.filter(Boolean).sort((a, b) => R.MODES.indexOf(b) - R.MODES.indexOf(a))[0] || '';
function settingsFinds() {
  const out = [{ label: SM.title('notifications'), sset: 'notifications', where: 'Settings' }, ...NOTIF_ROWS.map((n) => ({ label: n, sset: 'notifications', where: 'Notifications' }))];
  for (const g of SM.GROUPS) for (const id of g.items) {
    const sec = SM.SECTIONS[id]; if (!sec) continue;
    out.push({ label: sec.title, sset: id, min: sec.min, flag: sec.flag, where: 'Settings › ' + g.title });
    for (const s of sec.sections) {
      for (const r of s.rows || []) {
        const min = strict(sec.min, s.min, r.min), flag = sec.flag || s.flag || r.flag;
        out.push({ label: r.name, words: r.say, sset: id, min, flag, where: `${sec.title} › ${s.title}` });
        const open = 'more:' + id + '/' + s.title + '/' + r.name;
        for (const m of r.more || []) out.push({ label: m.name, words: m.say, sset: id, open, min: strict(min, m.min), flag, where: `${sec.title} › ${r.name}` });
        for (const it of r.moreList || []) out.push({ label: it.title, words: it.meta, sset: id, open, list: true, min, flag, where: `${sec.title} › ${r.name}` });
      }
      for (const it of s.list || []) out.push({ label: it.title, words: it.meta, sset: id, list: true, min: strict(sec.min, s.min), flag: sec.flag || s.flag, where: `${sec.title} › ${s.title}` });
    }
  }
  return out;
}
const plain = (t) => String(t || '').replace(/[*`{}]/g, '').toLowerCase();
const locksOf = (e) => [...(e.min && !R.shows(e.min) ? [{ min: e.min }] : []), ...(e.flag && !R.prefs.flag(e.flag) ? [{ flag: e.flag }] : [])];
const lockNote = (e) => locksOf(e).map((l) => (l.min ? `Switch to ${cap(l.min)}` : 'Turn on Labs')).join(' · ');
let found = [];
function searchHits() {
  const q = plain(ui.q).trim(); if (!q) return [];
  if (q.startsWith('label:')) return M.find(q);
  const score = (e) => (plain(e.label).startsWith(q) ? 0 : plain(e.label).includes(q) ? 1 : 2);
  const set = settingsFinds().filter((e) => plain(e.label).includes(q) || plain(e.words).includes(q)).sort((a, b) => score(a) - score(b));
  return [...M.find(q).slice(0, 7), ...set.slice(0, 7)].sort((a, b) => score(a) - score(b)).slice(0, 8);
}
function searchResults() {
  if (!plain(ui.q).trim()) return '';
  found = searchHits();
  const rows = found.map((e, i) => ({ id: 'srch|' + i, text: e.label, where: [e.where, lockNote(e)].filter(Boolean).join(' · ') }));
  return R.searchResults([...rows, { id: 'srch|ask', text: `Ask Chat: ${ui.q.trim()}`, where: 'Chat' }]);
}
const closeOverlays = () => { ui.q = ''; ui.menu = ''; ui.pop = false; ui.acct = false; ui.sub = ''; ui.fly = false; SHELL?.closeSearch(); const i = document.querySelector('[data-search]'); if (i) i.value = ''; };
// Lands on a setting's row: goes to its section, and lights the row once it is drawn.
let landing = null;
function landRow(e) {
  const row = [...document.querySelectorAll(e.list ? '.list-row' : '.set-row')].find((x) => x.offsetParent && (x.querySelector(e.list ? '.lr-t' : '.set-name')?.textContent || '') === e.label);
  if (row) R.land(row); else scrollTo(0, 0);
}
function land(e) {
  if (!e) return;
  closeOverlays();
  ui.sv.__open = e.open || ''; ui.sv.__confirm = null; ui.sv.__dialog = null;
  if (SHELL) { landing = e; SHELL.closeDrawer(); SHELL.go('settings/' + e.sset); return; }
  ui.page = 'settings'; ui.sset = e.sset;
  render(); landRow(e);
}
// Goes to what a result names: a setting's row, or a place or a thing; on pulse.html only Settings is drawn.
function goTo(e) {
  if (e.sset) { land(e); return; }
  closeOverlays();
  if (SHELL) { if (e.kind === 'label') toast(`Runs with the label ${e.label}: the captured list shows them all`); if (e.go.startsWith('run/')) SHELL.openRun(e.go, e.label); else SHELL.go(e.go); render(); return; }
  toast(`Opens ${e.label} · ${e.where} (not in this prototype)`); render();
}
// The hand-off: a mode asks in the strip under the top bar; a flag goes to its row in Labs. Once nothing locks it, on to the result.
function stepUnlock() {
  const u = ui.unlock; if (!u) return;
  const lock = locksOf(u.e)[0];
  if (!lock) { ui.unlock = null; goTo(u.e); return; }
  u.strip = lock.min || '';
  if (lock.flag && u.flag !== lock.flag) { u.flag = lock.flag; land({ sset: 'experimental', label: flagName(lock.flag) }); toast(`Turn on ${flagName(lock.flag)} to go on to ${u.e.label}`); }
}
function pickResult(v) {
  if (v === 'ask') { const q = ui.q.trim(); closeOverlays(); if (SHELL) SHELL.go('chat'); toast(`Asks Chat: ${q}`); render(); return; }
  const e = found[+v]; if (!e) return;
  const locked = locksOf(e).length;
  closeOverlays();
  if (locked) { ui.unlock = { e }; stepUnlock(); render(); return; }
  goTo(e);
}
const flagName = (key) => (SM.FLAGS || []).find((f) => f.key === key)?.name || M.FLAG_ROW[key] || key;
const unlockStrip = () => (ui.unlock?.strip ? R.confirmStrip({ text: `${ui.unlock.e.label} needs ${cap(ui.unlock.strip)}. Switch to ${cap(ui.unlock.strip)}?`, yes: 'Switch' }) : '');
document.addEventListener('input', (e) => { if (e.target.matches?.('[data-search]')) { ui.q = e.target.value; document.querySelector('[data-search-res]').innerHTML = searchResults(); fitSearch(); } });
function fitSearch() { const m = document.querySelector('.rl-search-res'); if (!m) return; m.style.left = ''; const r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth; if (r.right > vw - 16) m.style.left = `${vw - 16 - r.right}px`; }

// ---- in the one Worca: Pulse in Activity's place, the overlays above the shell, Settings in the page, its menu in the sidebar ----
function pulseButton() {
  const needs = nowRuns().needs.length, un = unread().length, run = nowRuns().running.length;
  const badge = needs ? `<span class="topnav-badge" data-tone="need">${needs}</span>` : un ? `<span class="topnav-badge" data-tone="run">${un}</span>` : '';
  const words = [needs && plural(needs, 'needs you', 'need you'), un && plural(un, 'unread'), run && `${run} running`].filter(Boolean).join(' · ') || 'Nothing new';
  return `<button type="button" class="btn btn-quiet topnav-act pz-pulse-b" data-pop aria-haspopup="dialog" aria-expanded="${ui.pop}" title="Pulse: ${esc(words)}">${svg('signal', 16)}<span class="pz-pulse-l">Pulse</span>${badge}</button>`;
}
function renderInShell() {
  const sideNow = ui.page === 'settings'; swapCls = sideWas !== null && sideWas !== sideNow ? ' is-swap' : ''; sideWas = sideNow;
  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  const keepP = document.querySelector('.pz-pbody')?.scrollTop || 0;
  document.getElementById('rail-pulse-slot').innerHTML = pulseButton();
  document.querySelector('#topnav-new')?.setAttribute('aria-expanded', String(!!ui.nr));
  document.getElementById('side-foot').innerHTML = sideFoot();
  document.getElementById('rail-strip').innerHTML = unlockStrip();
  // a reply in a chat you left: the dot on the Chat row and on Ask worca, until you open Chat
  const chatDot = !!C().chatUnread && !ui.chatSeen;
  for (const id of ['nav-chat-unread', 'topnav-ask-dot']) { const d = document.getElementById(id); if (d) d.hidden = !chatDot; }
  document.title = tabTitle();
  // Settings' menu takes the sidebar's place beside today's nav (shown instead of it on a wide screen; below 760px the
  // sidebar stays Worca's, and Settings opens on its menu as a list in the page)
  const side = document.querySelector('#side-rail'), nav = side.querySelector('nav.nav');
  let sm = side.querySelector('.rail-side-settings');
  if (sideNow) { if (!sm) { sm = document.createElement('div'); sm.className = 'rail-side-settings'; nav.after(sm); } sm.innerHTML = settingsMenu(); side.classList.add('is-settings'); }
  else { sm?.remove(); side.classList.remove('is-settings'); }
  document.querySelector('#side-rail .brand')?.classList.toggle('is-settings', sideNow);
  if (sideNow) document.getElementById('route-settings').innerHTML = `<div class="pz-page">${settingsPage()}</div>`;
  const res = document.querySelector('[data-search-res]'); if (res) res.innerHTML = searchResults();
  document.getElementById('app').innerHTML = `${popover()}${newRun()}${acctMenu()}${actionsFly()}${sessionDialog()}`;
  const t = document.querySelector('.rc-toast'); t.innerHTML = ui.toast ? esc(ui.toast) + (undoIds ? '<button type="button" class="pz-undo" data-undo title="Puts them back in the list">Undo</button>' : '') : ''; t.classList.toggle('is-on', !!ui.toast);
  for (const b of document.querySelectorAll('[data-mixed]')) b.indeterminate = true;
  const pb = document.querySelector('.pz-pbody'); if (pb && !opening) pb.scrollTop = keepP;
  fitMenus();
  opening = '';
  if (scroller.scrollTop !== keepY) scroller.scrollTop = keepY;
}

// The tab title's count follows Settings › Notifications › Badge.
function tabTitle() {
  const needs = nowRuns().needs.length, problems = unread().filter((u) => u.sev === 'problem').length;
  const n = ui.s.badge === 'none' ? 0 : ui.s.badge === 'needs' ? needs : needs + problems;
  return n ? `(${n}) Worca` : 'Worca';
}
// Session expired, Rail's way: a Dialog with its one step.
const sessionDialog = () => (ui.session ? R.dialog({ title: 'Session expired', body: '<p class="pz-sess">Your sign-in has expired. Your runs keep going; this page catches up when you are back.</p>', yes: 'Sign in again', hooks: { cancel: { hidden: true } }, id: 'pz-sess-t' }) : '');

// ---- the away screensaver: Away, Keep awake, the window focused, 5 idle minutes; never under reduced motion (Motion's
// one exception). Any input hides it, and that input does not reach the page. ----
let awayEl = null, awayRaf = 0, lastInput = Date.now(), eatUntil = 0, lastPt = null;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function showAway() {
  if (awayEl) return;
  closeOverlays();
  const host = document.createElement('div');
  host.innerHTML = R.awayScreen({ line: M.awayLine(nowRuns().needs.length, nowRuns().running.length) });
  awayEl = host.firstElementChild; document.body.append(awayEl);
  const mark = awayEl.querySelector('.rl-away-mark'); let x = 40, y = 40, dx = 60, dy = 60, t0 = performance.now();
  const step = (t) => {
    if (!awayEl) return;
    const dt = Math.min(.1, (t - t0) / 1000); t0 = t;
    const maxX = innerWidth - mark.offsetWidth, maxY = innerHeight - mark.offsetHeight;
    x += dx * dt; y += dy * dt;
    if (x <= 0 || x >= maxX) { dx = -dx; x = Math.max(0, Math.min(maxX, x)); }
    if (y <= 0 || y >= maxY) { dy = -dy; y = Math.max(0, Math.min(maxY, y)); }
    mark.style.setProperty('--x', x + 'px'); mark.style.setProperty('--y', y + 'px');
    awayRaf = requestAnimationFrame(step);
  };
  awayRaf = requestAnimationFrame(step);
}
function hideAway() { cancelAnimationFrame(awayRaf); awayEl?.remove(); awayEl = null; eatUntil = Date.now() + 400; lastInput = Date.now(); }
for (const t of ['pointermove', 'pointerdown', 'mousedown', 'mouseup', 'click', 'keydown', 'wheel', 'touchstart']) addEventListener(t, (e) => {
  if (t === 'pointermove') { const moved = !lastPt || Math.abs(e.screenX - lastPt[0]) + Math.abs(e.screenY - lastPt[1]) > 2; lastPt = [e.screenX, e.screenY]; if (!moved) return; }
  lastInput = Date.now();
  if (awayEl) { hideAway(); e.stopPropagation(); e.preventDefault(); return; }
  if (Date.now() < eatUntil && t !== 'pointermove' && t !== 'keydown') { e.stopPropagation(); e.preventDefault(); }
}, { capture: true, passive: false });
setInterval(() => { if (!awayEl && R.awayShows({ away: isAway(), keepAwake: ui.keep, focused: document.hasFocus() && !document.hidden, idleMs: Date.now() - lastInput, reduced: reducedMotion() })) showAway(); }, 1000);

// ---- render ----
let sideWas = null, swapCls = '';   // the sidebar's content fades only when it changes between Worca's and Settings'
function render() {
  if (SHELL) return renderInShell();
  const sideNow = ui.page === 'settings'; swapCls = sideWas !== null && sideWas !== sideNow ? ' is-swap' : ''; sideWas = sideNow;
  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  const keepP = document.querySelector('.pz-pbody')?.scrollTop || 0;
  document.getElementById('app').innerHTML = `<div class="pz-app">${sidebar()}<div class="pz-main">${topbar()}<main class="pz-page">${unlockStrip()}${ui.page === 'settings' ? settingsPage() : runsPage()}</main></div>${popover()}${newRun()}${acctMenu()}${actionsFly()}</div>`;
  const t = document.querySelector('.rc-toast'); t.innerHTML = ui.toast ? esc(ui.toast) + (undoIds ? '<button type="button" class="pz-undo" data-undo title="Puts them back in the list">Undo</button>' : '') : ''; t.classList.toggle('is-on', !!ui.toast);
  for (const b of document.querySelectorAll('[data-mixed]')) b.indeterminate = true;
  const pb = document.querySelector('.pz-pbody'); if (pb && !opening) pb.scrollTop = keepP;
  fitMenus();
  opening = '';
  if (scroller.scrollTop !== keepY) scroller.scrollTop = keepY;   // nothing moves by itself: a repaint never scrolls the page
}
// A menu opens under its picker; one that would leave the window opens to the left instead.
function fitMenus() {
  const vw = document.documentElement.clientWidth;
  fitSearch();
  for (const m of document.querySelectorAll('.pz-menu, .spick-menu')) {
    const r = m.getBoundingClientRect();
    if (r.right > vw - 16) m.style.left = `${Math.min(0, vw - 16 - r.right)}px`;
    const r2 = m.getBoundingClientRect(); if (r2.left < 16) m.style.left = `${parseFloat(m.style.left || 0) + 16 - r2.left}px`;
  }
}
let toastTimer = 0, undoIds = null;
function toast(text, undo) {
  ui.toast = text; undoIds = undo || null; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ''; undoIds = null; const el = document.querySelector('.rc-toast'); if (el) { el.classList.remove('is-on'); el.textContent = ''; } }, 5000);
}

function pick(id, v) {
  const s = ui.s;
  if (id === 'show') { ui.show = v; ui.sel = []; }
  else if (id === 'nowShow') ui.nowShow = v;
  else if (id === 'nowFrom') ui.nowFrom = v;
  else if (id === 'from') { ui.from = v; ui.sel = []; }
  else if (id === 'more') {
    if (v === 'settings') { ui.pop = false; if (SHELL) { SHELL.go('settings/notifications'); return; } ui.page = 'settings'; ui.sset = 'notifications'; }
    else if (v === 'select') ui.selecting = true;
    else if (v === 'allread') { const n = unread().length; ui.read = ui.read.concat(unread().map((u) => u.id)); toast(n ? `Marked ${plural(n, 'update')} read` : 'Nothing is unread'); }
    else { const ids = shown().filter((u) => !isUnread(u)).map((u) => u.id); ui.cleared = ui.cleared.concat(ids); ui.sel = []; toast(ids.length ? `Cleared ${plural(ids.length, 'read update')}` : 'Nothing read to clear', ids); }
  }
  else if (id === 'badge') s.badge = v;
  else if (id === 'mine') s.mine = v;
  else if (id === 'auto') s.auto = v;
  else if (id === 'nr-on') ui.nr = { ...ui.nr, on: v, wait: false, moved: '' };
  else if (id === 'nr-size') openNewRun(v);
  else if (id === 'warn') { s.warnAt = +v; toast(`Warning line at ${v}%: rings, Now and updates follow it`); }
  else if (id.startsWith('lvl:')) s.groups[id.slice(4)].level = v;
  else if (id.startsWith('whr:')) s.groups[id.slice(4)].where = v;
  else if (id.startsWith('ev:')) {
    const evId = id.slice(3), g = M.GROUPS.find((x) => x.events.some((e) => e[0] === evId)), gs = s.groups[g.id], ev = g.events.find((e) => e[0] === evId);
    const base = M.qualifies(gs.level, ev[2]) ? gs.where : 'pulse';
    if (v === base) delete gs.ex[evId]; else gs.ex[evId] = v;
  }
  ui.menu = '';
}

document.addEventListener('click', (e) => {
  if (SHELL && !SHELL.owns('pulse', e.target)) return;
  const tg = (sel) => e.target.closest(sel);
  const hadMenu = ui.menu;
  let el;
  if ((el = tg('[aria-disabled="true"]'))) { toast(el.title); render(); return; }
  if ((el = tg('[data-pick]'))) { const [id, v] = el.dataset.pick.split('|'); pick(id, v); render(); return; }
  if ((el = tg('[data-menu-pick^="srch|"]'))) { pickResult(el.dataset.menuPick.slice(5)); return; }
  if ((el = tg('[data-menu-pick]'))) { const v = el.dataset.menuPick, i = v.indexOf('|'), id = v.slice(0, i); if (/^svm?:/.test(id)) { const say = SV.pick(ui.sv, id, v.slice(i + 1)); ui.menu = ''; if (say) toast(say); } else pick(id, v.slice(i + 1)); render(); return; }
  if ((el = tg('[data-dialog]')) && ui.session) { ui.session = false; SHELL?.connReset(); toast('Signed in'); render(); return; }
  if ((el = tg('[data-dialog]')) && ui.sv.__dialog) { const say = SV.dialog(ui.sv, el.dataset.dialog); if (say) toast(say); render(); return; }
  if ((el = tg('[data-svsw]'))) { const say = SV.toggle(ui.sv, el.dataset.svsw); if (say) toast(say); render(); return; }
  if ((el = tg('[data-svdo]'))) { const say = SV.act(ui.sv, el.dataset.svdo); if (say) toast(say); render(); return; }
  if ((el = tg('[data-menu]'))) { ui.menu = ui.menu === el.dataset.menu ? '' : el.dataset.menu; if (ui.menu) opening = 'menu'; render(); return; }
  if (!tg('.pz-pick, .spick')) ui.menu = '';
  if (ui.q && !tg('.rl-search, .tsearch-field, #tsearch-open')) { ui.q = ''; const r = document.querySelector('[data-search-res]'); if (r) r.innerHTML = ''; const i = document.querySelector('[data-search]'); if (i) i.value = ''; }
  if ((el = tg('[data-act-tile]'))) { ui.fly = !ui.fly; ui.acct = false; ui.pop = false; if (ui.fly) opening = 'sub'; render(); return; }
  if ((el = tg('[data-act-stop]'))) { const a = C().actions.find((x) => x.id === el.dataset.actStop); ui.stopped = ui.stopped.concat(a.id); if (!runningActions().length) ui.fly = false; toast(`Stopped ${a.label}`); render(); return; }
  if ((el = tg('[data-act-open]'))) { const a = C().actions.find((x) => x.id === el.dataset.actOpen); ui.fly = false; if (SHELL) { SHELL.closeDrawer(); SHELL.openRun(a.go, a.run); } else toast(`Opens ${a.run} (not in this prototype)`); render(); return; }
  if (ui.fly && !tg('.act-fly')) { ui.fly = false; render(); return; }
  if ((el = tg('[data-land]'))) { e.preventDefault(); const [sset, label, list] = el.dataset.land.split('|'); land({ sset, label, list: !!list }); return; }
  if ((el = tg('[data-unlock]'))) { window.RailPulse.unlock(el.dataset.unlock); return; }
  if ((el = tg('[data-fix]'))) { const u = C().updates.find((x) => x.id === el.dataset.fix); ui.fixed = ui.fixed.concat(u.id); toast(`${u.fix}: done, and the problem is resolved (mock)`); render(); return; }
  if ((el = tg('[data-team]'))) { ui.teamSeen = true; ui.acct = false; if (SHELL) { SHELL.closeDrawer(); SHELL.go('settings/team'); } else { ui.page = 'settings'; ui.sset = 'team'; } render(); return; }
  // an open popover or account menu closes on a click outside it, and that click does nothing else
  if ((ui.pop || ui.acct || ui.nr) && !tg('.pz-popover, .nav-fly, .pz-newrun, [data-pop], [data-acct], [data-newrun]')) { ui.pop = false; ui.acct = false; ui.sub = ''; ui.nr = null; render(); return; }
  if ((el = tg('[data-pop]'))) { ui.pop = !ui.pop; ui.acct = false; ui.nr = null; if (ui.pop) opening = 'pop'; render(); return; }
  if ((el = tg('[data-acct]'))) { ui.acct = !ui.acct; ui.sub = ''; ui.pop = false; ui.nr = null; if (ui.acct) opening = 'acct'; render(); return; }
  if ((el = tg('[data-sub]'))) { const v = el.dataset.sub; ui.sub = v && ui.sub !== v ? v : ''; if (ui.sub) opening = 'sub'; render(); return; }
  if ((el = tg('[data-desk]'))) { ui.s.desktop = ui.s.desktop === 'on' ? 'off' : 'on'; toast(ui.s.desktop === 'on' ? 'Desktop notifications on' : 'Desktop notifications off'); render(); return; }
  if ((el = tg('[data-level]'))) { ui.sub = ''; toast(`Interface mode: ${cap(el.dataset.level)}`); R.prefs.setMode(el.dataset.level); return; }
  if ((el = tg('[data-sw="away"]'))) { ui.awayStatus = isAway() ? (C().away.hours ? 'here' : 'no-hours') : 'away-now'; toast(isAway() ? 'Away: Worca answers waiting run questions for you' : 'Back: Worca waits for you'); render(); return; }
  if ((el = tg('[data-sw="keep"]'))) { ui.keep = !ui.keep; render(); return; }
  if ((el = tg('[data-appearance]'))) { applyAppearance(el.dataset.appearance); render(); return; }
  if ((el = tg('[data-details]'))) { ui.acct = false; ui.sub = ''; if (SHELL) { SHELL.closeDrawer(); SHELL.go('stats'); } else toast('Opens Statistics (not in this prototype)'); render(); return; }
  if ((el = tg('[data-newrun]'))) { if (ui.nr) ui.nr = null; else { openNewRun(); opening = 'nr'; } ui.pop = false; ui.acct = false; render(); return; }
  if ((el = tg('[data-nr-use]'))) { ui.nr = { ...ui.nr, on: el.dataset.nrUse, wait: false, moved: '' }; render(); return; }
  if ((el = tg('[data-nr-wait]'))) { ui.nr.wait = true; render(); return; }
  if ((el = tg('[data-nr-now]'))) { ui.nr.wait = false; render(); return; }
  if ((el = tg('[data-nr-cancel]'))) { ui.nr = null; render(); return; }
  if ((el = tg('[data-nr-start]'))) { toast(`${el.textContent === 'Start run' ? `Started on ${pname(ui.nr.on)}` : `Scheduled: ${el.textContent.replace('Start at', 'starts at')}`} (not in this prototype)`); ui.nr = null; render(); return; }
  if ((el = tg('[data-ptab]'))) { ui.popTab = el.dataset.ptab; ui.sel = []; ui.selecting = false; render(); return; }
  if (SHELL && (el = tg('[data-sset]'))) { SHELL.go('settings/' + el.dataset.sset); return; }
  if (SHELL && (el = tg('[data-go]'))) { ui.pop = false; ui.acct = false; ui.sub = ''; SHELL.closeDrawer(); SHELL.go(el.dataset.go === 'settings' ? 'settings/' + (el.dataset.to || '') : el.dataset.go); return; }
  if ((el = tg('[data-sset]'))) { ui.sset = el.dataset.sset; ui.sv.__confirm = null; ui.sv.__dialog = null; ui.sv.__open = ''; ui.menu = ''; ui.custom = ''; ui.confirm = ''; opening = 'section'; render(); scrollTo(0, 0); return; }
  if ((el = tg('[data-go]'))) { ui.page = el.dataset.go; ui.sset = el.dataset.to || ''; ui.pop = false; ui.acct = false; ui.sub = ''; render(); return; }
  if ((el = tg('[data-selall]'))) { const ids = shown().map((u) => u.id); ui.sel = el.checked ? ids : []; render(); return; }
  if ((el = tg('[data-sel]'))) { tick(el.dataset.sel, e.shiftKey); render(); return; }
  if ((el = tg('.pz-popover [data-open]')) && (e.metaKey || e.ctrlKey || e.shiftKey) && isUpdate(el.dataset.open)) { e.preventDefault(); tick(el.dataset.open, e.shiftKey); render(); return; }
  if ((el = tg('[data-bulk]'))) {
    const ids = shown().filter((u) => ui.sel.includes(u.id)).map((u) => u.id), a = el.dataset.bulk; ui.sel = []; ui.selecting = false;
    if (a === 'read') { const n = ids.filter((id) => isUnread(C().updates.find((u) => u.id === id))).length; ui.read = ui.read.concat(ids); toast(`Marked ${plural(n, 'update')} read`); }
    if (a === 'clear') { ui.cleared = ui.cleared.concat(ids); ui.read = ui.read.concat(ids); toast(`Cleared ${plural(ids.length, 'update')}`, ids); }
    if (a === 'restore') { ui.cleared = ui.cleared.filter((x) => !ids.includes(x)); toast(`Restored ${plural(ids.length, 'update')}`); }
    render(); return;
  }
  if ((el = tg('[data-undo]'))) { if (undoIds) { const ids = undoIds; ui.cleared = ui.cleared.filter((x) => !ids.includes(x)); toast('Back in the list'); } render(); return; }
  if ((el = tg('[data-open]'))) {
    const key = el.dataset.open, u = C().updates.find((x) => x.id === key);
    if (u) {
      if (!ui.read.includes(u.id)) ui.read = ui.read.concat(u.id);
      if (u.go === 'usage') { ui.pop = false; ui.acct = true; ui.sub = 'usage'; }
      else openTarget(u.go, u.title.split(' · ')[1] || u.title, `Opens ${u.to}`);
    }
    else if (key.startsWith('lim')) { ui.pop = false; ui.acct = true; ui.sub = 'usage'; }
    else {
      const all = nowRuns(), r = key.startsWith('need') ? all.needs[+key.slice(4)] : key.startsWith('run') ? all.running[+key.slice(3)] : C().runs[+key.slice(3)];
      openTarget(r.state === 'scheduled' && !r.on ? 'schedules' : r.state === 'scheduled' ? 'run/scheduled' : 'run/' + r.state, r.title, el.title.split('\n').pop());
    }
    render(); return;
  }
  if ((el = tg('[data-custom]'))) { ui.custom = ui.custom === el.dataset.custom ? '' : el.dataset.custom; render(); return; }
  if ((el = tg('[data-backgroup]'))) { ui.s.groups[el.dataset.backgroup].ex = {}; toast('Every event follows the group again'); render(); return; }
  if ((el = tg('[data-reset]'))) { ui.confirm = 'reset'; render(); return; }
  if ((el = tg('[data-confirm]')) && ui.unlock?.strip) { if (el.dataset.confirm === 'yes') R.prefs.setMode(ui.unlock.strip); else { ui.unlock = null; render(); } return; }
  if ((el = tg('[data-confirm]')) && ui.sv.__confirm) { const say = SV.confirm(ui.sv, el.dataset.confirm === 'yes'); if (say) toast(say); render(); return; }
  if ((el = tg('[data-confirm]'))) { if (el.dataset.confirm === 'yes') { const d = ui.s.desktop; ui.s = freshSettings(C()); ui.s.desktop = d; ui.custom = ''; toast('Every group is back to its defaults'); } ui.confirm = ''; render(); return; }
  if ((el = tg('[data-test]'))) { toast('Test notification sent'); render(); return; }
  if ((el = tg('[data-how]'))) { toast(el.title); render(); return; }
  if (hadMenu && !ui.menu) render();
});
const isUpdate = (id) => C().updates.some((u) => u.id === id);
// Opens what a Pulse row names: a page in the one Worca; on pulse.html a Toast says where it goes.
function openTarget(go, title, say) {
  ui.pop = false;
  if (!SHELL) { ui.pop = true; toast(`${say} (not in this prototype)`); return; }
  if (go.startsWith('run/')) SHELL.openRun(go, title); else SHELL.go(go);
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (SHELL && innerWidth <= 760) document.getElementById('tsearch-open')?.click(); document.querySelector('[data-search]')?.focus(); return; }
  if (e.key === 'Enter' && e.target.matches?.('[data-search]') && ui.q) { document.querySelector('.rl-search-res [data-menu-pick]')?.click(); return; }
  if (SHELL && SHELL.runActive() && !ui.pop && !ui.acct && !ui.nr && !ui.menu) return;   // the run page's keys
  // The Runs list's keys in Updates: ⌘A (Ctrl+A) ticks every update shown, Space ticks the focused one, Esc stops selecting.
  const inUpdates = ui.pop && ui.popTab === 'updates' && !ui.menu && !ui.acct && !ui.nr;
  if (inUpdates && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); ui.selecting = true; ui.sel = shown().map((u) => u.id); render(); return; }
  const rowBtn = inUpdates && e.key === ' ' && e.target.closest?.('.pz-popover [data-open]');
  if (rowBtn && isUpdate(rowBtn.dataset.open)) {
    e.preventDefault(); const id = rowBtn.dataset.open; tick(id, e.shiftKey); render();
    document.querySelector(`.pz-popover [data-open="${CSS.escape(id)}"]`)?.focus(); return;
  }
  if (e.key !== 'Escape') return;
  if (ui.q) { ui.q = ''; const i = document.querySelector('[data-search]'); if (i) i.value = ''; } else if (ui.unlock?.strip) ui.unlock = null; else if (ui.fly) ui.fly = false; else if (ui.menu) ui.menu = ''; else if (ui.sv.__dialog) ui.sv.__dialog = null; else if (ui.sv.__confirm) ui.sv.__confirm = null; else if (ui.sub) ui.sub = ''; else if (ui.pop && ui.selecting) { ui.sel = []; ui.selecting = false; } else if (ui.pop || ui.acct || ui.nr) { ui.pop = false; ui.acct = false; ui.nr = null; } else if (ui.confirm) ui.confirm = ''; else return;
  render();
});
// Touch: a long-press on an update starts selecting, as on the Runs list; the click that follows is swallowed.
let press = null, pressed = '';
document.addEventListener('pointerdown', (e) => {
  const r = e.pointerType === 'touch' && e.target.closest?.('.pz-popover [data-row]');
  if (r && isUpdate(r.dataset.row)) press = setTimeout(() => { pressed = r.dataset.row; tick(pressed); render(); }, 500);
});
for (const t of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(t, () => { clearTimeout(press); press = null; });
document.addEventListener('click', (e) => { if (pressed) { e.preventDefault(); e.stopPropagation(); pressed = ''; } }, true);
const caseSel = document.getElementById('pulse-case') || document.getElementById('case');
caseSel.innerHTML = M.CASES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
caseSel.addEventListener('change', () => {
  ui = fresh(caseSel.value);
  const who = document.getElementById('person'); if (who) who.value = people()[0];
  if (!SHELL) R.prefs.setMode('expert');   // the explorer: a case starts fresh, its mode too
  render();
});
if (!SHELL) R.prefs.setFlag('gitAutomations', true);   // the explorer shows every group
R.prefs.onChange(() => { stepUnlock(); render(); });
document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => { applyAppearance(b.dataset.themePick); render(); }));
window.RailPulse = {
  show: (page, sset, view) => {
    ui.page = page === 'settings' ? 'settings' : 'runs'; ui.sset = page === 'settings' ? sset : ui.sset; ui.sv.__confirm = null; ui.sv.__dialog = null; ui.menu = ''; opening = 'section';
    if (view === 'chat') ui.chatSeen = true;
    if (ui.unlock?.flag && !(page === 'settings' && sset === 'experimental')) ui.unlock = null;   // left Labs without turning it on: forgotten
    render();
    if (landing) { const e = landing; landing = null; landRow(e); }
  },
  say: (text) => { toast(text); render(); },
  // A place or a section above the mode or behind Labs: its one way on (the page's EmptyState).
  unlock: (lock, to) => {
    const [kind, v] = lock.split(':');
    if (kind === 'mode') { R.prefs.setMode(v); return; }
    ui.unlock = { e: { go: to || 'runs', label: flagName(v), flag: v, kind: 'place' } }; stepUnlock(); render();
  },
  session: (on) => { ui.session = on; render(); },
  playAway: () => { if (reducedMotion()) { toast('The screensaver is off under reduced motion'); render(); return; } showAway(); },
  // On a shared sign-in each person keeps their own read and cleared; a local install has one person.
  person: (name) => {
    if (!C().identity) { toast('A local install has one person: pick the Every kind case'); document.getElementById('person').value = people()[0]; render(); return; }
    ui.people[ui.person] = { read: ui.read, cleared: ui.cleared };
    ui.person = Math.max(0, people().indexOf(name));
    const saved = ui.people[ui.person] || { read: [], cleared: [] }; ui.read = saved.read; ui.cleared = saved.cleared;
    toast(`Signed in as ${name}: their own read and cleared`); render();
  },
};
if (SHELL) SHELL.start(); else render();
})();
