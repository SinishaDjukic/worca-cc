// Pulse mock: renders PulseModel (pulse-model.js) in a small Worca shell with Worca's own classes: the sidebar foot's
// avatar with its usage rings and menu, the top bar's Pulse button and popover, the Pulse page, Settings › Notifications.
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
};
const svg = (name, size, cls) => `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const caseOf = (id) => M.CASES.find((c) => c.id === id);
const groupOf = (id) => M.GROUPS.find((g) => g.id === id);
function freshSettings(c) {
  return { desktop: c.desktop, badge: 'needs', warnAt: 80, groups: Object.fromEntries(M.GROUPS.map((g) => [g.id, { level: g.level, where: g.where, ex: {} }])) };
}
// a case starts fresh: nothing from the case before it carries over
const fresh = (caseId) => ({ caseId, page: 'pulse', tab: 'now', pop: false, popTab: 'now', acct: false, menu: '', show: 'unread', from: 'all',
  sel: [], read: [], cleared: [], custom: '', confirm: '', toast: '', flash: '', s: freshSettings(caseOf(caseId)) });
let ui = fresh('afternoon');

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
  return `<div class="menu pz-menu${align === 'right' ? ' is-right' : ''}" role="menu">${items.map((it) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    const role = it.checked === undefined ? 'menuitem' : 'menuitemradio';
    return `<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}" role="${role}"${it.checked === undefined ? '' : ` aria-checked="${!!it.checked}"`} data-pick="${esc(id)}|${esc(it.id)}"${it.help ? ` title="${esc(it.help)}"` : ''}><span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`;
  }).join('')}</div>`;
}
// A picker in the sentence it changes: the chosen words, a chevron, the menu under it.
function picker(id, text, items, tip) {
  return `<span class="pz-pick"><button type="button" class="pd-base is-words" data-menu="${esc(id)}" aria-haspopup="menu" aria-expanded="${ui.menu === id}" title="${esc(tip)}">${esc(text)}${svg('chevron', 12)}</button>${menu(id, items)}</span>`;
}
// A ring: a track and an arc filling `pct`; full and square-ended when used up.
function ringSvg(r, pct, t, size, view) {
  const c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, pct / 100));
  return `<circle class="trk" cx="${view / 2}" cy="${view / 2}" r="${r}"></circle><circle class="arc${t ? ' is-' + t : ''}" cx="${view / 2}" cy="${view / 2}" r="${r}" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}"></circle>`;
}
const RADII = [20.5, 17, 13.5];
function avatar() {
  const rs = M.rings(C(), ui.s.warnAt);
  const tip = rs.length ? rs.map((r) => r.line).join('\n') : 'No usage reported yet';
  return `<span class="pz-ava-wrap" title="${esc(tip)}"><svg class="pz-rings" viewBox="0 0 44 44" aria-hidden="true">${rs.map((r, i) => ringSvg(RADII[i], r.pct, r.tone, 44, 44)).join('')}</svg><span class="pz-ava">EA</span></span>`;
}
const mini = (pct, t) => `<svg class="pz-mini" viewBox="0 0 20 20" aria-hidden="true">${ringSvg(7.5, pct, t, 20, 20)}</svg>`;

// ---- shell ----
const NAV = [['runs', 'Runs'], ['chat', 'Chats'], ['clock', 'Schedules'], ['folder', 'Projects']];
function sidebar() {
  const rs = M.rings(C(), ui.s.warnAt);
  return `<aside class="pz-side">
    <div class="pz-brand"><span class="pz-word">Worca</span></div>
    <nav class="pz-nav">${NAV.map(([ic, t]) => `<button type="button" class="pz-nav-i" aria-disabled="true" title="${t} is not in this prototype">${svg(ic, 16)}<span class="pz-nav-l">${t}</span></button>`).join('')}
      <button type="button" class="pz-nav-i${ui.page === 'settings' ? ' is-on" aria-current="page' : ''}" data-go="settings" title="Settings › Notifications">${svg('gear', 16)}<span class="pz-nav-l">Settings</span></button></nav>
    <div class="pz-foot"><button type="button" class="pz-acct${ui.acct ? ' is-open' : ''}" data-acct aria-haspopup="menu" aria-expanded="${ui.acct}" aria-label="Account and usage: ${esc(rs.map((r) => r.line).join('; ') || 'no usage reported yet')}">${avatar()}<span class="pz-acct-name">Emil Angelov</span>${svg('updown', 14, 'pz-updown')}</button></div>
  </aside>`;
}
function topbar() {
  const needs = C().needs.length, un = unread().length, run = C().running.length;
  const badge = needs ? `<span class="topnav-badge" data-tone="need">${needs}</span>` : un ? `<span class="topnav-badge" data-tone="run">${un}</span>` : '';
  const words = [needs && plural(needs, 'needs you', 'need you'), un && plural(un, 'unread'), run && `${run} running`].filter(Boolean).join(' · ') || 'Nothing new';
  // the trail names where the page sits, never the page itself (its title is on the page)
  const title = ui.page === 'settings' ? '<span class="pz-crumb"><span class="pz-crumb-p" title="Settings: only Notifications is in this prototype">Settings</span><span class="pz-sep">›</span></span>' : '';
  return `<header class="pz-top"><div class="pz-top-l">${title}</div><div class="pz-top-r">
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
function nowSections(compact) {
  const c = C(), lim = limitsNow();
  const sec = (h, n, rows) => (n ? `<section class="pz-sec"><h3 class="pz-h">${h} <span class="n">${n}</span></h3><div class="pz-list">${rows}</div></section>` : '');
  const out = sec('Needs you', c.needs.length, c.needs.map((r, i) => row({ dot: 'is-amber', title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key: 'need' + i, tip: 'Opens the run page at what it asks' })).join(''))
    + sec('Limits', lim.length, lim.map((l, i) => row({ dot: l.tone === 'over' ? 'is-red' : 'is-amber', title: l.title, meta: l.detail, time: l.time, key: 'lim' + i, tip: `${l.tip} · opens the usage card` })).join(''))
    + sec('Running', c.running.length, c.running.map((r, i) => row({ dot: 'is-peach', title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key: 'run' + i, tip: 'Opens the live run' })).join(''))
    + (compact ? '' : sec('Scheduled', c.scheduled.length, c.scheduled.map((r, i) => row({ dot: 'is-grey-ring', title: r.title, meta: `${r.project} · ${r.detail}`, time: r.time, key: 'sch' + i, tip: 'Opens Schedules with its sheet open' })).join('')));
  return out || '<p class="pz-empty">Nothing needs you. Nothing is running.</p>';
}

// ---- the popover: a glance at Now and the latest unread updates ----
function popover() {
  if (!ui.pop) return '';
  const un = unread();
  const body = ui.popTab === 'now' ? nowSections(true)
    : un.length ? `<div class="pz-list">${un.slice(0, 6).map((u) => updateRow(u, false)).join('')}</div>` : '<p class="pz-empty">You are up to date.</p>';
  return `<div class="pz-popover" role="dialog" aria-label="Pulse">
    <div class="tabs pz-ptabs" role="tablist">${[['now', 'Now', nowCount()], ['updates', 'Updates', un.length]].map(([id, t, n]) => `<button type="button" class="tab" role="tab" aria-selected="${ui.popTab === id}" data-ptab="${id}" title="${id === 'now' ? 'What is true right now: it changes by itself' : 'What happened: read and clear it'}">${t}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>
    <div class="pz-pbody">${body}</div>
    <div class="pz-pfoot"><button type="button" class="btn btn-sm btn-quiet" data-go="pulse" title="The full hub: Now, every update, select and clear">Open Pulse</button>${ui.popTab === 'updates' && un.length ? '<button type="button" class="btn btn-sm btn-quiet" data-allread title="Marks every unread update read; nothing is cleared">Mark all read</button>' : ''}</div>
  </div>`;
}

// ---- the account menu: usage first ----
function acctMenu() {
  if (!ui.acct) return '';
  const c = C(), w = ui.s.warnAt;
  const block = (u) => {
    const pr = M.PROVIDER[u.p];
    const rows = u.win.length ? u.win.map((x) => {
      const t = M.tone(x.pct, w);
      const fig = x.k === 'day' ? `${x.used.toLocaleString('en')} of ${x.of.toLocaleString('en')}` : `${x.pct}%`;
      const src = x.k === 'day' ? `${x.pct}% · requests Worca counted today against the ${u.plan} plan's daily quota` : `Reported by ${pr.harness} at ${u.asOf}`;
      return `<div class="pz-urow" title="${esc(src)}">${mini(x.pct, t)}<span class="pz-uk">${M.winWord(x.k)}</span><span class="pz-uv${t ? ' is-' + t : ''}">${x.pct >= 100 ? 'Reached' : fig}</span><span class="pz-ur">resets ${esc(x.resets)}</span></div>`;
    }).join('') + (u.p === 'gemini' ? `<p class="pz-unote" title="Gemini's limit is per day; there is no session window">No session window</p>` : '')
      : `<p class="pz-unote" title="An API key is billed per token; the budget below is the limit">No session or weekly limit: billed per token</p>`;
    return `<div class="pz-ublock"><div class="pz-uhead"><span class="pz-uname">${pr.name}</span><span class="pz-uplan">${esc(pr.harness)} · ${esc(u.plan)}</span><span class="pz-uas" title="Figures are as fresh as the last turn that used ${pr.name}">as of ${esc(u.asOf)}</span></div>${rows}</div>`;
  };
  const spend = c.budget ? (() => { const pct = Math.round((c.budget.spent / c.budget.limit) * 100), t = M.tone(pct, w);
    return `<div class="pz-ublock"><div class="pz-urow" title="Worca's own budget, set in Costs">${mini(pct, t)}<span class="pz-uk">Spend</span><span class="pz-uv${t ? ' is-' + t : ''}">$${c.budget.spent} of $${c.budget.limit}</span><span class="pz-ur">this month</span></div></div>`; })() : '';
  return `<div class="menu pz-acct-menu" role="menu">
    <div class="pz-ucard"><p class="pz-ucap" title="Rings around your avatar, outside in: session, week, spend">Usage</p>${c.usage.map(block).join('')}${spend}</div>
    <div class="menu-sep" role="separator"></div>
    <button type="button" class="menu-item" data-go="settings" title="Choose what reaches you and where, and the warning line">Notification settings</button>
    <button type="button" class="menu-item" aria-disabled="true" title="Away mode is not in this prototype">Away mode</button>
    <button type="button" class="menu-item" aria-disabled="true" title="Signing out is not in this prototype">Sign out</button>
  </div>`;
}

// ---- the Pulse page ----
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
function pulsePage() {
  const c = C(), lim = limitsNow(), un = unread().length;
  const meta = [c.needs.length && plural(c.needs.length, 'needs you', 'need you'), (() => { const over = lim.filter((l) => l.tone === 'over').length, near = lim.length - over; return [over && plural(over, 'limit reached', 'limits reached'), near && plural(near, 'limit near', 'limits near')].filter(Boolean).join(' · '); })(),
    c.running.length && `${c.running.length} running`, `${un} unread`].filter(Boolean);
  return `<div class="pz-head"><h1 class="pz-title" title="Pulse: what is happening and what happened">Pulse</h1>
      <div class="pz-acts"><button type="button" class="btn btn-sm" data-allread${un ? '' : ' disabled'} title="${un ? 'Marks every unread update read; nothing is cleared' : 'Nothing is unread'}">Mark all read</button>
      <span class="pz-pick">${`<button type="button" class="btn btn-sm btn-quiet btn-icon" data-menu="more" aria-haspopup="menu" aria-expanded="${ui.menu === 'more'}" aria-label="More" title="More">${svg('more', 16)}</button>`}${menu('more', [
        { id: 'clearread', text: 'Clear read', help: 'Moves every read update in this view to Cleared' }, { id: 'settings', text: 'Notification settings', help: 'What reaches you and where' }], 'right')}</span></div></div>
    <p class="pz-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('<span class="pz-dotsep">·</span>')}</p>
    <div class="tabs pz-tabs" role="tablist">${[['now', 'Now', nowCount()], ['updates', 'Updates', un]].map(([id, t, n]) => `<button type="button" class="tab" role="tab" aria-selected="${ui.tab === id}" data-tab="${id}" title="${id === 'now' ? 'What is true right now: it changes by itself and cannot be cleared' : 'What happened: read, select and clear, like runs'}">${t}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>
    <div class="pz-panel">${ui.tab === 'now' ? nowSections(false) : updatesPanel()}</div>`;
}

// ---- Settings › Notifications ----
const levelText = (id) => M.LEVELS.find((l) => l.id === id).text;
const whereText = (id) => M.WHERE.find((w) => w.id === id).text;
const effWhere = (g, ev) => { const gs = ui.s.groups[g.id]; return gs.ex[ev[0]] || (M.qualifies(gs.level, ev[2]) ? gs.where : 'pulse'); };
function settingsPage() {
  const s = ui.s;
  const desk = s.desktop === 'blocked'
    ? `<span class="pz-sentence">Desktop notifications are <b class="pz-strong">blocked in this browser</b></span><button type="button" class="btn btn-sm" data-how title="Allow notifications for this site in the browser's site settings, then come back">How to allow</button>`
    : `<span class="pz-sentence">Desktop notifications are ${picker('desktop', s.desktop, [{ id: 'on', text: 'on', checked: s.desktop === 'on', help: 'What a group sends to desktop shows as a notification' }, { id: 'off', text: 'off', checked: s.desktop === 'off', help: 'No desktop notifications from any group' }], 'Desktop notifications in this browser')} in this browser</span><button type="button" class="btn btn-sm" data-test${s.desktop === 'on' ? '' : ' disabled'} title="${s.desktop === 'on' ? 'Sends one test notification' : 'Turn desktop notifications on to send a test'}">Send test</button>`;
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
  const confirm = ui.confirm === 'reset' ? `<div class="rc-confirm pz-strip"><span class="rc-confirm-t">Reset every group to its defaults? Your channels stay as they are.</span><span class="rc-confirm-acts"><button type="button" class="btn btn-sm btn-quiet" data-confirm="no">Cancel</button><button type="button" class="btn btn-sm btn-primary" data-confirm="yes">Reset</button></span></div>` : '';
  return `<div class="pz-head"><h1 class="pz-title">Notifications</h1></div>
    <p class="pz-meta"><span>Pulse keeps everything; these choices say what else reaches you.</span></p>
    ${confirm}
    <section class="pz-sec"><h3 class="pz-h">How Worca reaches you</h3><div class="pz-list">${channels}</div></section>
    <section class="pz-sec"><div class="pz-h-row"><h3 class="pz-h">What reaches you</h3><button type="button" class="btn btn-sm btn-quiet" data-reset title="Every group back to its defaults; asks first">Reset to defaults</button></div><div class="pz-list">${groups}</div></section>`;
}

// ---- render ----
function render() {
  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  document.getElementById('app').innerHTML = `<div class="pz-app">${sidebar()}<div class="pz-main">${topbar()}<main class="pz-page">${ui.page === 'settings' ? settingsPage() : pulsePage()}</main></div>${popover()}${acctMenu()}</div>`;
  const t = document.querySelector('.rc-toast'); t.innerHTML = ui.toast ? esc(ui.toast) + (undoIds ? '<button type="button" class="pz-undo" data-undo title="Puts them back in the list">Undo</button>' : '') : ''; t.classList.toggle('is-on', !!ui.toast);
  fitMenus();
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
  else if (id === 'more') { if (v === 'settings') { ui.page = 'settings'; } else { const ids = shown().filter((u) => !isUnread(u)).map((u) => u.id); ui.cleared = ui.cleared.concat(ids); ui.sel = []; toast(ids.length ? `Cleared ${plural(ids.length, 'read update')}` : 'Nothing read to clear', ids); } }
  else if (id === 'desktop') { s.desktop = v; toast(v === 'on' ? 'Desktop notifications on' : 'Desktop notifications off'); }
  else if (id === 'badge') s.badge = v;
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
  if ((el = tg('[data-menu]'))) { ui.menu = ui.menu === el.dataset.menu ? '' : el.dataset.menu; render(); return; }
  if (!tg('.pz-pick')) ui.menu = '';
  // an open popover or account menu closes on a click outside it, and that click does nothing else
  if ((ui.pop || ui.acct) && !tg('.pz-popover, .pz-acct-menu, [data-pop], [data-acct]')) { ui.pop = false; ui.acct = false; render(); return; }
  if ((el = tg('[data-pop]'))) { ui.pop = !ui.pop; ui.acct = false; render(); return; }
  if ((el = tg('[data-acct]'))) { ui.acct = !ui.acct; ui.pop = false; render(); return; }
  if ((el = tg('[data-ptab]'))) { ui.popTab = el.dataset.ptab; render(); return; }
  if ((el = tg('[data-tab]'))) { ui.tab = el.dataset.tab; ui.sel = []; render(); return; }
  if ((el = tg('[data-go]'))) { ui.page = el.dataset.go; ui.pop = false; ui.acct = false; if (el.dataset.go === 'pulse') ui.tab = ui.popTab; render(); return; }
  if ((el = tg('[data-allread]'))) { const n = unread().length; ui.read = ui.read.concat(unread().map((u) => u.id)); toast(`Marked ${plural(n, 'update')} read`); render(); return; }
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
    else if (key.startsWith('lim')) { ui.pop = false; ui.acct = true; }
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
  if ((el = tg('[data-newrun]'))) {
    const lim = limitsNow().find((l) => !/^Spend/.test(l.title));
    toast(lim ? `New run would note: ${lim.title}. ${lim.tone === 'over' ? 'Runs on it pause until it resets.' : 'This run may pause and resume after.'}` : 'Opens New run (not in this prototype)'); render(); return;
  }
  if (hadMenu && !ui.menu) render();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.menu) ui.menu = ''; else if (ui.pop || ui.acct) { ui.pop = false; ui.acct = false; } else if (ui.confirm) ui.confirm = ''; else if (ui.sel.length) ui.sel = []; else return;
  render();
});
const caseSel = document.getElementById('case');
caseSel.innerHTML = M.CASES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
caseSel.addEventListener('change', () => { ui = fresh(caseSel.value); render(); });
document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => {
  document.documentElement.dataset.theme = b.dataset.themePick;
  document.querySelectorAll('[data-theme-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
render();
