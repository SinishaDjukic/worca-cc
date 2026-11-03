// Pulse mock: renders PulseModel (pulse-model.js) in a small Worca shell with Worca's own classes: the sidebar foot's
// avatar with its usage rings and menu, the top bar's Pulse button and its panel (Pulse has no page of its own),
// New run, and Settings › Notifications.
// The viewer's choices live in `ui`; every click repaints #app, and a repaint never scrolls the page.
const M = window.PulseModel;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const P = (d) => `<path d="${d}"></path>`;
const ICON = {
  signal: '<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle>' + P('M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8'),
  runs: P('M4 6h16M4 12h16M4 18h10'),
  chat: P('M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  clock: '<circle cx="12" cy="12" r="8"></circle>' + P('M12 8v4l3 2'),
  folder: P('M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z'),
  gear: '<circle cx="12" cy="12" r="3"></circle>' + P('M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8'),
  plus: P('M12 5v14M5 12h14'),
  chevron: P('M6 9.5l6 6 6-6'),
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"></circle>',
  x: P('M7 7l10 10M17 7 7 17'),
  updown: P('M8 10l4-4 4 4M8 14l4 4 4-4'),
  chevR: P('M9 6l6 6-6 6'), chevL: P('M15 6l-6 6 6 6'),
  sliders: P('M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9') + '<circle cx="15" cy="7.5" r="2"></circle><circle cx="9" cy="16.5" r="2"></circle>',
  away: P('M14 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z') + P('M13 8l-1.5 5.5') + P('M8.5 12l2-3.2 2.5-.8 2.5 2.5 2.5 1') + P('M11.5 13.5l2.5 3 1 4.5') + P('M11.5 13.5l-1.5 3.5-3 3.5'),
  cup: P('M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z') + P('M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16') + P('M9 3.5v2.5M12.5 3.5v2.5'),
  monitor: P('M4 4.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z') + P('M8.5 19.5h7M12 15.5v4'),
  sun: '<circle cx="12" cy="12" r="4"></circle>' + P('M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'),
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'),
  contrast: '<circle cx="12" cy="12" r="8"></circle>' + '<path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"></path>',
};
const svg = (name, size, cls) => `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const caseOf = (id) => M.CASES.find((c) => c.id === id);
const groupOf = (id) => M.GROUPS.find((g) => g.id === id);
function freshSettings(c) {
  return { desktop: c.desktop, badge: 'needs', warnAt: 80, mine: 'suggest', auto: 'move', resume: 'auto', groups: Object.fromEntries(M.GROUPS.map((g) => [g.id, { level: g.level, where: g.where, ex: {} }])) };
}
// a case starts fresh: nothing from the case before it carries over
const fresh = (caseId) => ({ caseId, page: 'runs', pop: false, popTab: 'now', acct: false, sub: '', nr: null, menu: '', show: 'unread', from: 'all',
  sel: [], read: [], cleared: [], custom: '', confirm: '', toast: '', flash: '', level: 'expert', away: false, keep: true, s: freshSettings(caseOf(caseId)) });
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

const C = () => caseOf(ui.caseId);
const isUnread = (u) => u.unread && !ui.read.includes(u.id);
const live = () => C().updates.filter((u) => !ui.cleared.includes(u.id));
const unread = () => live().filter(isUnread);
const limitsNow = () => M.limits(C(), ui.s.warnAt);
const nowCount = () => C().needs.length + limitsNow().length + C().running.length + C().scheduled.length;
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
  return `<span class="pz-ava-wrap" title="${esc(tip)}">${rs.map((r, i) => gring(r.pct, 'pz-ring-' + i, r.tone)).join('')}<span class="pz-ava">EA</span></span>`;
}
const mini = (pct, t) => gring(pct, 'pz-mini', t);
const pname = (p) => M.PROVIDER[p].name;

// ---- shell ----
const NAV = [['runs', 'Runs'], ['chat', 'Chats'], ['clock', 'Schedules'], ['folder', 'Projects']];
const navGo = (id, ic, t, tip) => `<button type="button" class="pz-nav-i${ui.page === id ? ' is-on" aria-current="page' : ''}" data-go="${id}" title="${tip}">${svg(ic, 16)}<span class="pz-nav-l">${t}</span></button>`;
function sidebar() {
  const rs = M.rings(C(), ui.s.warnAt);
  return `<aside class="pz-side">
    <div class="pz-brand"><span class="pz-word">Worca</span></div>
    <nav class="pz-nav">${NAV.map(([ic, t]) => ic === 'runs' ? navGo('runs', ic, t, 'Runs: the page behind Pulse in this prototype') : `<button type="button" class="pz-nav-i" aria-disabled="true" title="${t} is not in this prototype">${svg(ic, 16)}<span class="pz-nav-l">${t}</span></button>`).join('')}
      ${navGo('settings', 'gear', 'Settings', 'Settings › Notifications')}</nav>
    <div class="pz-foot"><button type="button" class="pz-acct${ui.acct ? ' is-open' : ''}" data-acct aria-haspopup="menu" aria-expanded="${ui.acct}" aria-label="Account and usage: ${esc(rs.map((r) => r.line).join('; ') || 'no usage reported yet')}">${avatar()}<span class="pz-acct-name">Emil Angelov</span>${svg('updown', 14, 'pz-updown')}</button></div>
  </aside>`;
}
function topbar() {
  const needs = C().needs.length, un = unread().length, run = C().running.length;
  const badge = needs ? `<span class="topnav-badge" data-tone="need">${needs}</span>` : un ? `<span class="topnav-badge" data-tone="run">${un}</span>` : '';
  const words = [needs && plural(needs, 'needs you', 'need you'), un && plural(un, 'unread'), run && `${run} running`].filter(Boolean).join(' · ') || 'Nothing new';
  return `<header class="pz-top"><div class="pz-top-l"></div><div class="pz-top-r">
    <button type="button" class="btn btn-sm btn-quiet topnav-act pz-pulse-b" data-pop aria-haspopup="dialog" aria-expanded="${ui.pop}" title="Pulse: ${esc(words)}">${svg('signal', 16)}<span class="pz-pulse-l">Pulse</span>${badge}</button>
    <button type="button" class="btn btn-sm btn-primary" data-newrun title="Start a run">${svg('plus', 14)}<span class="pz-new-l">New run</span></button>
  </div></header>`;
}

// ---- rows ----
// One row on the 20px rail: the dot, the title line, the meta line, the time at the right.
// In Updates the rail holds the mark (amber: still waits for you, blue: unread, nothing once read) and, on hover, focus
// or while selecting, the tick box in its place: one text edge for every list.
function row({ dot, title, meta, time, tip, key, check, unreadDot, resolved, flash }) {
  const mark = dot ? `<span class="status-dot ${dot}" aria-hidden="true"></span>` : unreadDot ? '<span class="pz-unread" title="Unread"></span>' : '';
  return `<div class="pz-row${check !== undefined ? ' has-check' : ''}${check ? ' is-sel' : ''}${unreadDot ? ' is-unread' : ''}${flash ? ' is-flash' : ''}" data-row="${esc(key)}">
    <span class="pz-rail">${mark}${check !== undefined ? `<label class="pz-check" title="Select"><input type="checkbox" data-sel="${esc(key)}"${check ? ' checked' : ''} aria-label="Select ${esc(title)}"></label>` : ''}</span>
    <button type="button" class="pz-row-main row-btn" data-open="${esc(key)}" title="${esc(`${title}\n${meta}\n${tip}`)}">
      <span class="pz-row-t${unreadDot ? ' is-unread' : ''}">${esc(title)}${resolved ? '<span class="pz-resolved">Resolved</span>' : ''}</span>
      <span class="pz-row-m">${esc(meta)}</span></button>
    <span class="pz-row-time">${esc(time)}</span></div>`;
}
const dotOf = (u) => (u.sev === 'needs' && u.open ? 'is-amber' : '');
function updateRow(u, withCheck) {
  return row({ dot: dotOf(u), title: u.title, meta: `${groupOf(u.g).name} · ${u.meta}`, time: u.time, key: u.id, check: withCheck ? ui.sel.includes(u.id) : undefined,
    unreadDot: isUnread(u), resolved: u.resolved, flash: ui.flash === u.id, tip: `Opens ${u.to}${isUnread(u) ? ' and marks it read' : ''}` });
}
function nowSections() {
  const c = C(), lim = limitsNow();
  const sec = (h, n, rows) => (n ? `<section class="pz-sec"><h3 class="pz-h">${h} <span class="n">${n}</span></h3><div class="pz-list">${rows}</div></section>` : '');
  const out = sec('Needs you', c.needs.length, c.needs.map((r, i) => row({ dot: 'is-amber', title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key: 'need' + i, tip: 'Opens the run page at what it asks' })).join(''))
    + sec('Limits', lim.length, lim.map((l, i) => row({ dot: l.tone === 'over' ? 'is-red' : 'is-amber', title: l.title, meta: l.detail, time: l.time, key: 'lim' + i, tip: `${l.tip} · opens the usage card` })).join(''))
    + sec('Running', c.running.length, c.running.map((r, i) => row({ dot: 'is-peach', title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key: 'run' + i, tip: 'Opens the live run' })).join(''))
    + sec('Scheduled', c.scheduled.length, c.scheduled.map((r, i) => row({ dot: 'is-grey-ring', title: r.title, meta: `${r.project} · ${r.on ? startDetail(r) : r.detail}`, time: r.time, key: 'sch' + i, tip: r.slice ? 'Opens the feature: its slices and where each runs' : r.queued ? 'Opens the run: it waits for a free slot' : 'Opens Schedules with its sheet open' })).join(''));
  return out || '<p class="pz-empty">Nothing needs you. Nothing is running.</p>';
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
  const pl = startPlan(r), i = C().scheduled.indexOf(r);
  if (pl.go === 'asis') return `Starts on ${pl.lim.name} and may pause: ${pl.why}`;
  if (pl.go === 'move') return `Will start on ${pname(pl.to)}: ${pl.why}`;
  if (pl.go === 'wait') return `Waits for ${pl.lim.resets}: ${pl.why}`;
  const held = C().scheduled.slice(0, i).find((x) => x.on && startPlan(x).go === 'wait');
  if (held) return `Goes ahead of ${held.slice ? held.title.split(' · ')[1] : held.title} on ${pname(r.on)}: it fits, ${share(r.on, r.size)}`;
  return r.slice ? `Starts on ${pname(r.on)} when slice 2 is done · ${share(r.on, r.size)}` : `Starts on ${pname(r.on)} when a slot is free · ${share(r.on, r.size)}`;
}

// ---- Pulse: the panel under the Pulse button is the whole hub (Now, every update, select and clear); no page ----
function popover() {
  if (!ui.pop) return '';
  const un = unread();
  const more = `<span class="pz-pick">${`<button type="button" class="btn btn-sm btn-quiet btn-icon" data-menu="more" aria-haspopup="menu" aria-expanded="${ui.menu === 'more'}" aria-label="More" title="More">${svg('more', 16)}</button>`}${menu('more', [
    { id: 'allread', text: 'Mark all read', help: un.length ? 'Marks every unread update read; nothing is cleared' : 'Nothing is unread' },
    { id: 'clearread', text: 'Clear read', help: 'Moves every read update in this view to Cleared' }, { sep: true },
    { id: 'settings', text: 'Notification settings', help: 'Settings › Notifications: what reaches you and what a start does near a limit' }], 'right')}</span>`;
  return `<div class="pz-popover${inCls('pop')}" role="dialog" aria-label="Pulse">
    <div class="pz-phead"><div class="tabs pz-ptabs" role="tablist">${[['now', 'Now', nowCount()], ['updates', 'Updates', un.length]].map(([id, t, n]) => `<button type="button" class="tab" role="tab" aria-selected="${ui.popTab === id}" data-ptab="${id}" title="${id === 'now' ? 'What is true right now: it changes by itself and cannot be cleared' : 'What happened: read, select and clear, like runs'}">${t}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>${more}</div>
    <div class="pz-pbody">${ui.popTab === 'now' ? nowSections() : updatesPanel()}</div>
  </div>`;
}

// ---- the account menu: Worca's own menu (index.html #acct-menu); its spend card is now Usage and costs, the last row ----
const LEVELS_UI = [['simple', 'Simple', 'The essentials: start runs, answer them, see what shipped'], ['standard', 'Standard', 'Also workflows, schedules and costs'], ['expert', 'Expert', 'Everything: agents, engines, Labs']];
const cap = (w) => w[0].toUpperCase() + w.slice(1);
function acctMenu() {
  if (!ui.acct) return '';
  const c = C(), top = M.rings(c, ui.s.warnAt).sort((a, b) => b.pct - a.pct)[0];
  const val = top ? (top.pct >= 100 ? 'Reached' : `${top.pct}%`) : c.budget ? M.usd(c.budget.spent) : '';
  const lvl = LEVELS_UI.find((l) => l[0] === ui.level);
  const sub = (id) => `data-sub="${id}" aria-haspopup="menu" aria-expanded="${ui.sub === id}"`;
  // Top to bottom, rarest to most used, since the menu opens up from the avatar: how Worca looks and the door to
  // Settings; you today (Away, Keep awake); what the rings say, right above the avatar that wears them.
  return `<div class="menu nav-fly acct-menu${ui.sub ? ' has-sub' : ''}${inCls('acct')}" role="menu" aria-label="Account">
    <div class="msect" role="group" aria-label="Worca">
      <button type="button" class="mi menu-item" role="menuitem" ${sub('lvl')} title="How much of Worca you see">${svg('sliders', 16, 'mi-ic')}<span class="mi-lbl">Interface mode</span><span class="mi-val">${lvl[1]}</span>${svg('chevR', 14, 'mi-chev')}</button>
      <div class="theme-sect" role="group" aria-labelledby="pz-theme-k">${svg('contrast', 16, 'mi-ic')}<span class="theme-k" id="pz-theme-k">Appearance</span><div class="theme-seg">${[['system', 'monitor'], ['light', 'sun'], ['dark', 'moon']].map(([m, ic]) => `<button type="button" class="theme-ic${appearance === m ? ' on' : ''}" role="menuitemradio" aria-checked="${appearance === m}" data-appearance="${m}" aria-label="${cap(m)}" title="${cap(m)}">${svg(ic, 14, 'mi-ic')}</button>`).join('')}</div></div>
      <button type="button" class="mi menu-item" role="menuitem" data-go="settings" title="Settings › Notifications (the only settings page in this prototype)">${svg('gear', 16, 'mi-ic')}<span class="mi-lbl">Settings</span></button>
    </div>
    <div class="msect" role="group" aria-label="You">
      <button type="button" class="mi menu-item away-item sw-item" role="menuitemcheckbox" aria-checked="${ui.away}" data-state="${ui.away ? 'away' : 'here'}" data-sw="away" title="worca answers waiting run questions for you while you're away.">${svg('away', 16, 'mi-ic')}<span class="mi-lbl">Away</span><span class="switch" aria-hidden="true"></span></button>
      <button type="button" class="mi menu-item sw-item" role="menuitemcheckbox" aria-checked="${ui.keep}" data-sw="keep" title="Keeps the computer awake while runs are working. The display may still turn off.">${svg('cup', 16, 'mi-ic')}<span class="mi-lbl">Keep awake</span><span class="switch" aria-hidden="true"></span></button>
    </div>
    <div class="msect" role="group" aria-label="Usage">
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
    }).join('') : '<p class="pz-unote" title="An API key is billed per token: the spend below is its limit">Billed per token: no session or weekly limit</p>';
    const noSession = u.note ? `<p class="pz-unote" title="${esc(u.note.tip)}">${esc(u.note.text)}</p>` : '';
    return `<div class="pz-ublock"><div class="pz-uhead"><span class="pz-uname">${esc(pr.name)}</span><span class="pz-uplan" title="${esc(`${pr.vendor} · ${u.plan}`)}">${esc(pr.vendor)} · ${esc(u.plan)}</span><span class="pz-uas" title="As fresh as the last turn that used ${esc(pr.name)}">as of ${esc(u.asOf)}</span></div>${rows}${noSession}</div>`;
  };
  return `<div class="menu nav-fly pz-fly${inCls('sub')}" role="menu" aria-label="Usage and costs">${back}
    <span class="nav-fly-k" title="What can stop a run, per harness: the rings around your avatar show the closest of each">Limits</span>
    <div class="pz-ublocks">${c.usage.map(block).join('')}</div>${spendCard(c)}
    <div class="msect" role="group"><button type="button" class="mi menu-item" role="menuitem" data-go="settings" title="The warning line, what reaches you, and what Worca does when a limit is near">${svg('gear', 16, 'mi-ic')}<span class="mi-lbl">Limit settings</span></button></div>
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
  return `<div class="menu nav-fly lvl-menu pz-fly${inCls('sub')}" role="menu" aria-label="Interface mode">${back}<span class="nav-fly-k">Interface mode</span>${LEVELS_UI.map(([id, t, h]) => `<button type="button" class="menu-item" role="menuitemradio" aria-checked="${ui.level === id}" data-level="${id}" title="${esc(h)}"><span class="mi-l">${t}</span></button>`).join('')}</div>`;
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
  const hint = (p) => { const u = c.usage.find((x) => x.p === p), e = M.est(p, sz); return u.win.length ? u.win.map((x) => `${M.winWord(x.k).toLowerCase()} ${x.pct}%${e && e[x.k] != null ? ` +${e[x.k]}` : ''}`).join(', ') : 'billed per token'; };
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
function shown() {
  const all = C().updates;
  const by = ui.show === 'cleared' ? all.filter((u) => ui.cleared.includes(u.id)) : live().filter((u) => ui.show === 'all' || (ui.show === 'unread' && isUnread(u)) || (ui.show === 'needs' && u.sev === 'needs') || (ui.show === 'problems' && u.sev === 'problem'));
  return by.filter((u) => ui.from === 'all' || u.g === ui.from);
}
function updatesPanel() {
  const list = shown();
  const sel = ui.sel.filter((id) => list.some((u) => u.id === id));
  const openNeeds = sel.filter((id) => { const u = C().updates.find((x) => x.id === id); return u.sev === 'needs' && u.open; }).length;
  const allOn = list.length && sel.length === list.length;
  const bar = sel.length
    ? `<div class="pz-bar is-sel"><span class="pz-rail"><label class="pz-check" title="${allOn ? 'Select none' : 'Select all shown'}"><input type="checkbox" data-selall${allOn ? ' checked' : ''} aria-label="Select all shown"></label></span><span class="pz-bar-n">${sel.length} selected</span>
       <span class="pz-bar-acts">${ui.show === 'cleared' ? '<button type="button" class="btn btn-sm" data-bulk="restore" title="Puts them back in All">Restore</button>'
        : `<button type="button" class="btn btn-sm" data-bulk="read" title="Marks them read; they stay in All">Mark read</button><button type="button" class="btn btn-sm" data-bulk="clear" title="${openNeeds ? `${plural(openNeeds, 'run')} still ${openNeeds === 1 ? 'waits' : 'wait'} for you in Now: clearing does not answer it` : 'Moves them to Cleared; Undo in the notice'}">Clear</button>`}
       <button type="button" class="btn btn-sm btn-quiet btn-icon" data-bulk="none" aria-label="Select none" title="Select none · Esc">${svg('x', 14)}</button></span></div>`
    : `<div class="pz-bar"><span class="pz-rail">${list.length ? `<label class="pz-check" title="Select all shown"><input type="checkbox" data-selall aria-label="Select all shown"></label>` : ''}</span><span class="pz-sentence">Showing ${picker('show', SHOWS.find((s) => s.id === ui.show).text, SHOWS.map((s) => ({ ...s, checked: s.id === ui.show })), 'Which updates the list shows')} from ${picker('from', ui.from === 'all' ? 'all groups' : groupOf(ui.from).name, [{ id: 'all', text: 'all groups', checked: ui.from === 'all' }, { sep: true }].concat(M.GROUPS.map((g) => ({ id: g.id, text: g.name, checked: ui.from === g.id }))), 'Which group the updates come from')}</span></div>`;
  if (!list.length) return bar + `<p class="pz-empty">${ui.show === 'unread' ? 'You are up to date.' : ui.show === 'cleared' ? 'Nothing cleared.' : 'No updates here.'}</p>`;
  const days = [...new Set(list.map((u) => u.day))];
  return bar + days.map((d) => `<section class="pz-sec"><h3 class="pz-h pz-day">${d}</h3><div class="pz-list${sel.length ? ' is-selecting' : ''}">${list.filter((u) => u.day === d).map((u) => updateRow(u, true)).join('')}</div></section>`).join('');
}
// The page behind Pulse: Runs is not in this prototype; Pulse opens over any page.
function runsPage() {
  return `<div class="pz-head"><h1 class="pz-title">Runs</h1></div>
    <p class="pz-meta"><span>Runs is not in this prototype. Pulse opens from the top bar over any page.</span></p>`;
}

// ---- Settings › Notifications ----
const levelText = (id) => M.LEVELS.find((l) => l.id === id).text;
const whereText = (id) => M.WHERE.find((w) => w.id === id).text;
const effWhere = (g, ev) => { const gs = ui.s.groups[g.id]; return gs.ex[ev[0]] || (M.qualifies(gs.level, ev[2]) ? gs.where : 'pulse'); };
// Worca's own Settings tabs (index.html #settings-tabs), with Notifications after General.
const STABS = [['general', 'General'], ['notifications', 'Notifications'], ['tags', 'Labels & cost tags'], ['runs', 'Runs'], ['experimental', 'Labs'], ['ask', 'Chat'], ['guardrails', 'Guardrails'], ['memory', 'Memory']];
function settingsPage() {
  const s = ui.s;
  const desk = s.desktop === 'blocked'
    ? `<span class="pz-sentence">Desktop notifications are <b class="pz-strong">blocked in this browser</b></span><button type="button" class="btn btn-sm" data-how title="Allow notifications for this site in the browser's site settings, then come back">How to allow</button>`
    : `<span class="pz-swline"><button type="button" class="switch" role="switch" aria-checked="${s.desktop === 'on'}" data-desk aria-label="Desktop notifications in this browser" title="${s.desktop === 'on' ? 'On: what a group sends to desktop shows as a notification' : 'Off: no desktop notifications from any group'}"></button><span class="pz-sentence">Desktop notifications in this browser</span></span><button type="button" class="btn btn-sm" data-test${s.desktop === 'on' ? '' : ' disabled'} title="${s.desktop === 'on' ? 'Sends one test notification' : 'Turn desktop notifications on to send a test'}">Send test</button>`;
  const BADGE = [{ id: 'needs', text: 'what needs you', help: 'The tab title reads (2) Worca while 2 runs wait for you' }, { id: 'problems', text: 'what needs you and problems', help: 'Also unread problems: a failed run, a missed start, a limit' }, { id: 'none', text: 'nothing', help: 'The tab title never shows a count' }];
  const channels = `<div class="pz-srow"><span class="pz-sk">Desktop</span><span class="pz-sv">${desk}</span></div>
    <div class="pz-srow"><span class="pz-sk">Badge</span><span class="pz-sv"><span class="pz-sentence">The tab title counts ${picker('badge', BADGE.find((b) => b.id === s.badge).text, BADGE.map((b) => ({ ...b, checked: b.id === s.badge })), 'What the count in the tab title counts')}</span></span></div>
    <div class="pz-srow"><span class="pz-sk">Chat</span><span class="pz-sv"><span class="pz-sentence">Sent to 2 channels: Telegram, Slack</span><button type="button" class="btn btn-sm btn-quiet" data-manage title="Channels, mute and allow-lists are in Settings › Chat">Manage</button></span></div>`;
  const groups = M.GROUPS.map((g) => {
    const gs = s.groups[g.id], open = ui.custom === g.id, nEx = Object.keys(gs.ex).length;
    const warn = g.id === 'usage' ? ` · warn at ${picker('warn', s.warnAt + '%', [70, 80, 90].map((v) => ({ id: String(v), text: v + '%', checked: s.warnAt === v, help: `Rings turn amber, Now shows the limit and an update is sent at ${v}%` })), 'The warning line for usage and spend')}` : '';
    const events = open ? `<div class="pz-events">${g.events.map((ev) => {
      const w = effWhere(g, ev), changed = !!gs.ex[ev[0]];
      return `<div class="pz-erow"><span class="pz-ek" title="${esc(ev[0])} · ${ev[2] === 'needs' ? 'needs you' : ev[2]}">${esc(ev[1])}</span><span class="pz-sentence">on ${picker('ev:' + ev[0], whereText(w), M.WHERE.map((x) => ({ ...x, checked: x.id === w })), `Where ${ev[1]} goes`)}</span>${changed ? `<span class="pz-changed" title="Differs from the group: ${esc(levelText(gs.level))} on ${esc(whereText(gs.where))}">Changed</span>` : ''}</div>`;
    }).join('')}${nEx ? `<div class="pz-erow pz-eback"><button type="button" class="btn btn-sm btn-quiet" data-backgroup="${g.id}" title="Every event follows the group again">Back to the group</button></div>` : ''}</div>` : '';
    return `<div class="pz-grow${open ? ' is-open' : ''}"><div class="pz-srow"><span class="pz-sk">${esc(g.name)}</span><span class="pz-sv"><span class="pz-sentence">Tell me about ${picker('lvl:' + g.id, levelText(gs.level), M.LEVELS.map((l) => ({ ...l, checked: l.id === gs.level })), `How much of ${g.name} reaches you`)} on ${picker('whr:' + g.id, whereText(gs.where), M.WHERE.map((x) => ({ ...x, checked: x.id === gs.where })), `Where ${g.name} goes beyond Pulse`)}${warn}</span>
      <button type="button" class="btn btn-sm btn-quiet" data-custom="${g.id}" aria-expanded="${open}" title="${open ? 'Close the events' : 'Choose per event: ' + g.events.map((e) => e[1]).join(', ')}">${open ? 'Done' : nEx ? `Customise · ${nEx}` : 'Customise'}</button></span></div>${events}</div>`;
  }).join('');
  const RESUME = [{ id: 'auto', text: 'resumes after the reset', help: 'Worca schedules its resume for 5 minutes after the limit resets' }, { id: 'me', text: 'waits for you', help: 'It stays paused until you resume it' }];
  const limitSec = `<section class="pz-sec"><h3 class="pz-h" title="Near: the run's estimate does not fit in what is left of a window. With no estimate (too few runs like it), at or over the warning line (${s.warnAt}%)">When a limit is near</h3><div class="pz-list">
    <div class="pz-srow"><span class="pz-sk">You start it</span><span class="pz-sv"><span class="pz-sentence">New run and Resume near a limit ${picker('mine', MINE.find((m) => m.id === s.mine).text, MINE.map((m) => ({ ...m, checked: m.id === s.mine })), 'What New run and Resume do when the harness is near its limit')}</span></span></div>
    <div class="pz-srow"><span class="pz-sk">Worca starts it</span><span class="pz-sv"><span class="pz-sentence">A slice or scheduled run near a limit ${picker('auto', AUTO.find((m) => m.id === s.auto).text, AUTO.map((m) => ({ ...m, checked: m.id === s.auto })), 'What a start with nobody there to ask does near a limit. One that waits never holds up the line: the next start that fits goes ahead')}</span></span></div>
    <div class="pz-srow"><span class="pz-sk">After a pause</span><span class="pz-sv"><span class="pz-sentence">A run paused at a limit ${picker('resume', RESUME.find((m) => m.id === s.resume).text, RESUME.map((m) => ({ ...m, checked: m.id === s.resume })), 'What a run paused at a usage limit does when the limit resets')}</span></span></div>
  </div></section>`;
  const confirm = ui.confirm === 'reset' ? `<div class="rc-confirm pz-strip"><span class="rc-confirm-t">Reset every group to its defaults? Your channels stay as they are.</span><span class="rc-confirm-acts"><button type="button" class="btn btn-sm btn-quiet" data-confirm="no">Cancel</button><button type="button" class="btn btn-sm btn-primary" data-confirm="yes">Reset</button></span></div>` : '';
  return `<div class="pz-head"><h1 class="pz-title">Settings</h1></div>
    <div class="tabs pz-tabs" role="group" aria-label="Settings section">${STABS.map(([id, t]) => id === 'notifications' ? `<button type="button" class="tab on" aria-pressed="true" aria-current="page">${t}</button>` : `<button type="button" class="tab" aria-pressed="false" aria-disabled="true" title="${t} is not in this prototype">${esc(t)}</button>`).join('')}</div>
    <p class="pz-meta pz-tabmeta"><span>Pulse keeps everything; these choices say what else reaches you, and what a start does near a limit.</span></p>
    ${confirm}
    <section class="pz-sec"><h3 class="pz-h">How Worca reaches you</h3><div class="pz-list">${channels}</div></section>
    <section class="pz-sec"><div class="pz-h-row"><h3 class="pz-h">What reaches you</h3><button type="button" class="btn btn-sm btn-quiet" data-reset title="Every group back to its defaults; asks first">Reset to defaults</button></div><div class="pz-list">${groups}</div></section>
    ${limitSec}`;
}

// ---- render ----
function render() {
  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  document.getElementById('app').innerHTML = `<div class="pz-app">${sidebar()}<div class="pz-main">${topbar()}<main class="pz-page">${ui.page === 'settings' ? settingsPage() : runsPage()}</main></div>${popover()}${newRun()}${acctMenu()}</div>`;
  const t = document.querySelector('.rc-toast'); t.innerHTML = ui.toast ? esc(ui.toast) + (undoIds ? '<button type="button" class="pz-undo" data-undo title="Puts them back in the list">Undo</button>' : '') : ''; t.classList.toggle('is-on', !!ui.toast);
  fitMenus();
  opening = '';
  if (scroller.scrollTop !== keepY) scroller.scrollTop = keepY;   // nothing moves by itself: a repaint never scrolls the page
}
// A menu opens under its picker; one that would leave the window opens to the left instead.
function fitMenus() {
  const vw = document.documentElement.clientWidth;
  for (const m of document.querySelectorAll('.pz-menu')) {
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
  else if (id === 'from') { ui.from = v; ui.sel = []; }
  else if (id === 'more') {
    if (v === 'settings') { ui.page = 'settings'; ui.pop = false; }
    else if (v === 'allread') { const n = unread().length; ui.read = ui.read.concat(unread().map((u) => u.id)); toast(n ? `Marked ${plural(n, 'update')} read` : 'Nothing is unread'); }
    else { const ids = shown().filter((u) => !isUnread(u)).map((u) => u.id); ui.cleared = ui.cleared.concat(ids); ui.sel = []; toast(ids.length ? `Cleared ${plural(ids.length, 'read update')}` : 'Nothing read to clear', ids); }
  }
  else if (id === 'badge') s.badge = v;
  else if (id === 'mine') s.mine = v;
  else if (id === 'auto') s.auto = v;
  else if (id === 'nr-on') ui.nr = { ...ui.nr, on: v, wait: false, moved: '' };
  else if (id === 'nr-size') openNewRun(v);
  else if (id === 'resume') s.resume = v;
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
  const tg = (sel) => e.target.closest(sel);
  const hadMenu = ui.menu;
  let el;
  if ((el = tg('[aria-disabled="true"]'))) { toast(el.title); render(); return; }
  if ((el = tg('[data-pick]'))) { const [id, v] = el.dataset.pick.split('|'); pick(id, v); render(); return; }
  if ((el = tg('[data-menu]'))) { ui.menu = ui.menu === el.dataset.menu ? '' : el.dataset.menu; if (ui.menu) opening = 'menu'; render(); return; }
  if (!tg('.pz-pick')) ui.menu = '';
  // an open popover or account menu closes on a click outside it, and that click does nothing else
  if ((ui.pop || ui.acct || ui.nr) && !tg('.pz-popover, .nav-fly, .pz-newrun, [data-pop], [data-acct], [data-newrun]')) { ui.pop = false; ui.acct = false; ui.sub = ''; ui.nr = null; render(); return; }
  if ((el = tg('[data-pop]'))) { ui.pop = !ui.pop; ui.acct = false; ui.nr = null; if (ui.pop) opening = 'pop'; render(); return; }
  if ((el = tg('[data-acct]'))) { ui.acct = !ui.acct; ui.sub = ''; ui.pop = false; ui.nr = null; if (ui.acct) opening = 'acct'; render(); return; }
  if ((el = tg('[data-sub]'))) { const v = el.dataset.sub; ui.sub = v && ui.sub !== v ? v : ''; if (ui.sub) opening = 'sub'; render(); return; }
  if ((el = tg('[data-desk]'))) { ui.s.desktop = ui.s.desktop === 'on' ? 'off' : 'on'; toast(ui.s.desktop === 'on' ? 'Desktop notifications on' : 'Desktop notifications off'); render(); return; }
  if ((el = tg('[data-level]'))) { ui.level = el.dataset.level; ui.sub = ''; toast(`Interface mode: ${cap(ui.level)}`); render(); return; }
  if ((el = tg('[data-sw]'))) { const k = el.dataset.sw; ui[k] = !ui[k]; render(); return; }
  if ((el = tg('[data-appearance]'))) { applyAppearance(el.dataset.appearance); render(); return; }
  if ((el = tg('[data-details]'))) { toast('Opens Statistics (not in this prototype)'); render(); return; }
  if ((el = tg('[data-newrun]'))) { if (ui.nr) ui.nr = null; else { openNewRun(); opening = 'nr'; } ui.pop = false; ui.acct = false; render(); return; }
  if ((el = tg('[data-nr-use]'))) { ui.nr = { ...ui.nr, on: el.dataset.nrUse, wait: false, moved: '' }; render(); return; }
  if ((el = tg('[data-nr-wait]'))) { ui.nr.wait = true; render(); return; }
  if ((el = tg('[data-nr-now]'))) { ui.nr.wait = false; render(); return; }
  if ((el = tg('[data-nr-cancel]'))) { ui.nr = null; render(); return; }
  if ((el = tg('[data-nr-start]'))) { toast(`${el.textContent === 'Start run' ? `Started on ${pname(ui.nr.on)}` : `Scheduled: ${el.textContent.replace('Start at', 'starts at')}`} (not in this prototype)`); ui.nr = null; render(); return; }
  if ((el = tg('[data-ptab]'))) { ui.popTab = el.dataset.ptab; ui.sel = []; render(); return; }
  if ((el = tg('[data-go]'))) { ui.page = el.dataset.go; ui.pop = false; ui.acct = false; ui.sub = ''; render(); return; }
  if ((el = tg('[data-selall]'))) { const ids = shown().map((u) => u.id); ui.sel = el.checked ? ids : []; render(); return; }
  if ((el = tg('[data-sel]'))) { const id = el.dataset.sel; ui.sel = el.checked ? ui.sel.concat(id) : ui.sel.filter((x) => x !== id); render(); return; }
  if ((el = tg('[data-bulk]'))) {
    const ids = ui.sel, a = el.dataset.bulk; ui.sel = [];
    if (a === 'read') { ui.read = ui.read.concat(ids); toast(`Marked ${plural(ids.length, 'update')} read`); }
    if (a === 'clear') { ui.cleared = ui.cleared.concat(ids); ui.read = ui.read.concat(ids); toast(`Cleared ${plural(ids.length, 'update')}`, ids); }
    if (a === 'restore') { ui.cleared = ui.cleared.filter((x) => !ids.includes(x)); toast(`Restored ${plural(ids.length, 'update')}`); }
    render(); return;
  }
  if ((el = tg('[data-undo]'))) { if (undoIds) { const ids = undoIds; ui.cleared = ui.cleared.filter((x) => !ids.includes(x)); toast('Back in the list'); } render(); return; }
  if ((el = tg('[data-open]'))) {
    const key = el.dataset.open, u = C().updates.find((x) => x.id === key);
    if (u) { if (!ui.read.includes(u.id)) ui.read = ui.read.concat(u.id); toast(`Opens ${u.to} (not in this prototype)`); }
    else if (key.startsWith('lim')) { ui.pop = false; ui.acct = true; ui.sub = 'usage'; }
    else toast(`${el.title} (not in this prototype)`);
    render(); return;
  }
  if ((el = tg('[data-custom]'))) { ui.custom = ui.custom === el.dataset.custom ? '' : el.dataset.custom; render(); return; }
  if ((el = tg('[data-backgroup]'))) { ui.s.groups[el.dataset.backgroup].ex = {}; toast('Every event follows the group again'); render(); return; }
  if ((el = tg('[data-reset]'))) { ui.confirm = 'reset'; render(); return; }
  if ((el = tg('[data-confirm]'))) { if (el.dataset.confirm === 'yes') { const d = ui.s.desktop; ui.s = freshSettings(C()); ui.s.desktop = d; ui.custom = ''; toast('Every group is back to its defaults'); } ui.confirm = ''; render(); return; }
  if ((el = tg('[data-test]'))) { toast('Test notification sent'); render(); return; }
  if ((el = tg('[data-how]'))) { toast(el.title); render(); return; }
  if ((el = tg('[data-manage]'))) { toast('Opens Settings › Chat (not in this prototype)'); render(); return; }
  if (hadMenu && !ui.menu) render();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.menu) ui.menu = ''; else if (ui.sub) ui.sub = ''; else if (ui.pop || ui.acct || ui.nr) { ui.pop = false; ui.acct = false; ui.nr = null; } else if (ui.confirm) ui.confirm = ''; else if (ui.sel.length) ui.sel = []; else return;
  render();
});
const caseSel = document.getElementById('case');
caseSel.innerHTML = M.CASES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
caseSel.addEventListener('change', () => { ui = fresh(caseSel.value); render(); });
document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => { applyAppearance(b.dataset.themePick); render(); }));
render();
