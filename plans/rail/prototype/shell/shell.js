// The one Worca's shell: today's sidebar and top bar (today/, captured from the app), with Wave 1's decisions applied,
// and a router over the pages. A place opens from the sidebar; today's pages show as captured, in the Rail colours; a
// run opens as a full page (the Rail run page); Settings opens from the profile menu (the Rail Settings).
//   #runs              the Rail Runs list
//   #chat[/<id>]       the Rail Chats column, beside today's Chat page
//   #<view>            a place: schedules, stats, team-metrics, workflows, requirements, projects, workspaces,
//                      marketplace (today's pages)
//   #run/<case>        the Rail run or group page, on one of its cases
//   #settings[/<id>]   the Rail Settings, on one of its sections
// pulse/pulse.js mounts Pulse, the profile menu, New run, the search and Settings into it; runs/run-page.js draws the
// run page into #card. Each owns its own clicks (window.RailShell.owns).
// The shell itself holds the sidebar's three widths (docs/rail/narrow.md), the Ask worca side column (docs/rail/panels.md)
// and what a place needs of the interface mode and Labs (the sidebar follows; a deep link above them gets one line).
(function () {
  const T = window.Today;
  const R = window.RailUI;
  const TITLES = { chat: 'Chat', runs: 'Tasks', schedules: 'Schedules', stats: 'Statistics', 'team-metrics': 'Team metrics', workflows: 'Workflows',
    requirements: 'Requirements', projects: 'Projects', workspaces: 'Workspaces', marketplace: 'Marketplace' };
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ---- the sidebar: places only (a setting or a place, docs/rail/settings.md) ----
  // The one bar: Settings' behaviour for every feature. The house opens the places; a place with a list holds its list.
  const PLACES = [['Work', [['chat', 'Chat', 'simple'], ['runs', 'Tasks', 'expert'], ['schedules', 'Schedules', 'expert']]], ['Build', [['workflows', 'Workflows', 'simple'], ['requirements', 'Requirements', 'simple', 'requirements'], ['marketplace', 'Marketplace', 'advanced']]], ['Manage', [['projects', 'Projects', 'simple'], ['workspaces', 'Workspaces', 'advanced']]], ['Insight', [['stats', 'Statistics', 'advanced'], ['team-metrics', 'Team metrics', 'expert']]]];
  function sidebar() {
    const side = el(T.sidebar);
    const nav = side.querySelector('nav.nav');
    const NEW = { chat: ['New chat', 'ask'], runs: ['New task', 'task'], schedules: ['New schedule', 'schedule'] };
    const place = ([id, label, min, flag]) => { const item = R.navItem({ label, icon: R.icon('nav-' + id, 14), attrs: { 'data-nav': id, 'data-min-level': min, 'data-flag': flag || null, 'aria-label': label } }); return NEW[id] ? `<div class="place-row" data-place="${id}">${item}${R.button({ label: NEW[id][0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 13), attrs: { 'data-bar-new': NEW[id][1], title: NEW[id][0] } })}</div>` : item; };
    nav.insertAdjacentHTML('beforebegin', '<div id="bar-back" class="bar-back pz-app rail-page"></div>');
    nav.innerHTML = PLACES.map(([g, list]) => `<p class="nav-sect side-g">${g}</p>${list.map(place).join('')}`).join('');
    const close = side.querySelector('#side-close');
    side.querySelector('.brand').innerHTML = '<div id="bar-head"></div>'; side.querySelector('.brand').append(close);
    side.querySelector('#acct-menu')?.remove();   // the Rail profile menu takes its place (pulse.js)
    side.querySelector('#side-foot').innerHTML = '';   // the avatar: pulse.js draws it
    nav.insertAdjacentHTML('afterend', '<div id="bar-chat" class="bar-list pz-app rail-page" hidden></div><div id="bar-tasks" class="bar-list pz-app rail-page" hidden><div id="runs-root"></div></div><div id="bar-schedules" class="bar-list pz-app rail-page" hidden></div>');
    side.insertAdjacentHTML('beforeend', '<div class="bar-grip" role="separator" aria-orientation="vertical" aria-label="Resize the bar" aria-valuemin="240" aria-valuemax="420" tabindex="0" title="Drag to resize; double-click for the default width"></div>');
    return side;
  }
  // What a place needs: the sidebar's own data-min-level and data-flag, as the app's sidebar.html has them.
  const needsOf = (view0) => { const view = view0 === 'schedule' ? 'schedules' : view0; const b = document.querySelector(`#side-rail nav.nav [data-nav="${view}"]`); return b ? { min: b.dataset.minLevel || '', flag: b.dataset.flag || '' } : {}; };
  const lockOf = (view) => { const n = needsOf(view); return !R.shows(n.min) ? { min: n.min } : n.flag && !R.prefs.flag(n.flag) ? { flag: n.flag } : null; };
  // The sidebar draws again when the interface mode or a Labs flag changes; a section with nothing left goes too.
  function applyPrefs() {
    const nav = document.querySelector('#side-rail nav.nav');
    for (const b of nav.querySelectorAll('[data-nav]')) { b.hidden = !!lockOf(b.dataset.nav); const w = b.closest('.place-row'); if (w) w.hidden = b.hidden; }
    let sect = null, any = 0;
    const close = () => { if (sect) sect.hidden = any < 2; };   // a head over one row says nothing: it goes, the row stays
    for (const x of nav.children) {
      if (x.matches('.nav-sect')) { close(); sect = x; any = 0; } else if (x.matches('button, .place-row') && !x.hidden) any++;
    }
    close();
  }
  // ---- the top bar: Pulse in Activity's place; the search, New run and the profile open the Rail pieces ----
  function topBar() {
    const top = el(T.topBar);
    top.querySelector('#activity-pop')?.remove();
    const act = top.querySelector('#topnav-activity');
    if (act) act.replaceWith(el('<span id="rail-pulse-slot"></span>'));
    top.querySelector('#topnav-new')?.remove();   // starting anything is the composer's now
    top.querySelector('#side-toggle')?.insertAdjacentHTML('afterend', R.button({ label: 'Show the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-show', 16), cls: 'bar-show', attrs: { id: 'bar-show' } }));
    const kbd = top.querySelector('.tsearch-kbd'); if (kbd) kbd.textContent = R.keyHint(['mod', 'K'], R.isMac(window));
    const input = top.querySelector('#tsearch-input');
    if (input) { input.setAttribute('data-search', ''); input.removeAttribute('role'); input.closest('.tsearch-field')?.insertAdjacentHTML('beforeend', '<div data-search-res></div>'); }
    top.querySelector('#tsearch-pop')?.remove();
    top.querySelector('#topnav-ask')?.removeAttribute('hidden');
    top.querySelector('.topnav-r')?.insertAdjacentHTML('beforeend', '<span id="rail-conn"></span>');
    return top;
  }

  // ---- the sidebar's three widths: the column above 1080px (it may be collapsed, and that is kept), the 60px rail from
  // 761 to 1080px, a drawer at 760px and below ----
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: a remembered choice is a nicety */ } } };
  const KEY_RAIL = 'worca-rail.sidebar.collapsed', KEY_ASK = 'worca-rail.ask.width';
  let collapsed = store.get(KEY_RAIL) === '1';
  function syncRail() {
    const w = innerWidth, side = document.getElementById('side-rail'), rail = w <= 760 ? false : collapsed;
    side.classList.toggle('collapsed', rail);
    document.getElementById('worca').classList.toggle('has-rail', rail);
    const t = document.getElementById('side-toggle');
    if (t) { t.setAttribute('aria-expanded', String(!rail)); const word = rail ? 'Expand menu' : 'Collapse menu'; t.title = word; t.setAttribute('aria-label', word); }
    if (w > 760) drawer(false);
  }
  function drawer(on) {
    document.body.classList.toggle('nav-open', on);
    const scrim = document.getElementById('nav-scrim'); if (scrim) scrim.hidden = !on;
    document.getElementById('mbar-menu')?.setAttribute('aria-expanded', String(on));
    document.querySelector('.main-col')?.toggleAttribute('inert', on);
  }

  // ---- Ask worca: the side column, with today's Chat capture inside. Pushes above 1080px, covers to 761px, takes the
  // window below (shell.css); dragged between 360 and 680px and kept; fades in, closes at once. ----
  const clampAsk = (px) => Math.min(680, Math.max(360, Math.round(+px) || 440));
  let askW = clampAsk(store.get(KEY_ASK)), askOpen = false;
  const setAskW = (px) => {
    askW = clampAsk(px); document.documentElement.style.setProperty('--ask-side-w', askW + 'px'); store.set(KEY_ASK, askW);
    document.querySelector('#ask-side .ask-side-grip')?.setAttribute('aria-valuenow', askW);
  };
  function drawAsk(side) {
    side.innerHTML = R.sideColumn({ title: 'Ask worca', width: askW, close: R.icon('x', 14), body: '<div class="rail-ask-body side-col-convo" id="ask-convo"></div>', hooks: { close: { 'data-ask-close': '' } } });
    window.RailConversation?.mount(document.getElementById('ask-convo'));
  }
  function syncAsk(view) {
    const side = document.getElementById('ask-side'), btn = document.getElementById('topnav-ask');
    if (btn) { btn.hidden = false; btn.setAttribute('aria-expanded', String(askOpen)); }
    const show = askOpen;
    if (show && side.hidden) { if (!side.firstChild) drawAsk(side); side.classList.add('is-in'); setTimeout(() => side.classList.remove('is-in'), 300); }
    side.hidden = !show;
    document.body.classList.toggle('ask-side-open', show);
  }

  function build() {
    const app = document.getElementById('worca');
    app.innerHTML = '';
    const col = el('<div class="main-col"></div>');
    col.append(topBar(), el('<div id="rail-strip"></div>'), el('<div id="main-row" class="main-row"><main class="main"><div class="page-bg" aria-hidden="true"><div class="chat-home-bg"></div></div><div id="route-today"></div><div id="route-chat" hidden></div><div id="route-schedule" hidden></div><div id="route-runs" class="pz-app rail-page" hidden></div><div id="route-run" class="rc-board" hidden><div id="card"></div><div id="task-dock" class="convo-dock"></div><div id="task-timeline"></div></div><div id="route-settings" class="pz-app rail-page" hidden></div></main><aside id="ask-side" class="ask-side" aria-label="Ask worca" hidden></aside></div>'));
    app.append(el('<div class="nav-scrim" id="nav-scrim" hidden></div>'), sidebar(), col);
    syncRail(); applyPrefs();
  }

  // the current place, marked in the bar
  function markNav(view) {
    const place = view === 'run' ? 'runs' : view === 'schedule' ? 'schedules' : view;
    for (const b of document.querySelectorAll('#side-rail nav.nav [data-nav]')) {
      const on = b.dataset.nav === place;
      b.classList.toggle('active', on); b.classList.toggle('is-on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  // ---- the bar: what it holds now; the house opens the places over it ----
  const BAR_TITLE = { home: 'Worca', chat: 'Chat', tasks: 'Tasks', schedules: 'Schedules', settings: 'Settings' };
  let homeOpen = false, taskChat = '', lastThing = null, visited = [], taskHome = null, pinsAll = false;
  const barOf = (view) => (view === 'chat' ? 'chat' : view === 'runs' ? 'tasks' : view === 'run' ? (taskChat ? 'chat' : 'tasks') : view === 'schedules' || view === 'schedule' ? 'schedules' : view === 'settings' ? 'settings' : 'home');
  function drawBar() {
    const side = document.getElementById('side-rail'), own = barOf(routed.view), which = homeOpen ? 'home' : own;
    side.dataset.bar = which;
    const act = { chat: ['New chat', 'ask'], tasks: ['New task', 'task'], schedules: ['New schedule', 'schedule'] }[which];
    document.getElementById('bar-head').innerHTML = R.barHead({ title: BAR_TITLE[which], home: which === 'home', logo: '<span class="logo-mark" aria-hidden="true"></span>', action: act ? R.button({ label: act[0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-bar-new': act[1] } }) : '', hide: R.button({ label: 'Hide the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-hide', 15), attrs: { 'data-bar-hide': '', title: `Hide the bar (${R.keyHint(['mod', '\\'], R.isMac(window))})` } }) });
    for (const [id, b] of [['bar-chat', 'chat'], ['bar-tasks', 'tasks'], ['bar-schedules', 'schedules']]) document.getElementById(id).hidden = which !== b;
    // Pinned first: what you pinned in any list; then the one thing you came from.
    const pins = (window.RailChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => R.listRow({ title: c.title, meta: c.project || 'No project', mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), open: { 'data-back-to': `chat/${c.id}`, title: `Opens ${c.title}` } }));
    // One section, Recent: what you pinned (a pin at its end), then where you were, newest first, never twice.
    const pinRows = (window.RailChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => ({ hash: `chat/${c.id}`, title: c.title, meta: c.project || 'No project', mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), end: R.icon('pin', 13), tip: 'Pinned' }));
    const seenRows = visited.filter((v) => !pinRows.some((p) => p.hash === v.hash)).slice(0, 1);
    const PINS = 5, morePins = pinRows.length - PINS;
    if (!pinsAll && morePins > 0) pinRows.length = PINS;
    const rows = [...pinRows, ...seenRows].map((x) => R.listRow({ title: x.title, meta: x.meta, mark: x.mark, end: x.end ? `<span class="lr-fig" title="${x.tip}">${x.end}</span>` : '', endText: x.end ? '' : x.when || '', open: { 'data-back-to': x.hash, title: `Opens ${x.title}` } }));
    document.getElementById('bar-back').innerHTML = rows.length ? R.list({ groups: [{ title: 'Recent', rows, more: !pinsAll && morePins > 0 ? { n: morePins, attrs: { 'data-pins-all': '' } } : null }] }) : '';
  }

  // ---- the router ----
  let reopen = false;   // a run opened from a row draws again, even on the same case: two rows can share one
  const pageTitle = (view, arg) => {
    if (view === 'chat') return (arg && window.RailConversation?.chatTitle(arg)) || 'Chat';
    if (view === 'run') return taskChat ? window.RailConversation?.chatTitle(taskChat) || 'Chat' : 'Tasks';
    if (view === 'settings') return 'Settings';
    if (view === 'schedule') return 'Schedules';
    return TITLES[view];
  };
  function route() {
    const [kind, arg] = (location.hash.slice(1) || 'chat').split('/');
    const view = TITLES[kind] ? kind : kind === 'run' || kind === 'settings' || kind === 'schedule' ? kind : 'chat';
    drawer(false);
    homeOpen = false;
    const pane = { today: document.getElementById('route-today'), chat: document.getElementById('route-chat'), schedule: document.getElementById('route-schedule'), run: document.getElementById('route-run'), settings: document.getElementById('route-settings'), runs: document.getElementById('route-runs') };
    const lock = (view === 'runs' || view === 'schedules' || view === 'schedule' || !!T.pages[view] && view !== 'chat') && lockOf(view);
    const ownPage = view === 'run' || view === 'settings' || view === 'runs' || view === 'chat' || view === 'schedules' || view === 'schedule';
    pane.today.hidden = ownPage && !lock; pane.run.hidden = view !== 'run'; pane.settings.hidden = view !== 'settings';
    pane.runs.hidden = view !== 'runs' || !!lock; pane.chat.hidden = view !== 'chat'; pane.schedule.hidden = !(view === 'schedule' || view === 'schedules') || !!lock;
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : view === 'runs' ? 'view-runs' : view === 'chat' ? 'view-rail-chat' : view === 'schedule' || view === 'schedules' ? 'view-rail-chat' : (T.pages[view]?.body || '');
    if (view !== 'run') taskChat = view === 'chat' ? taskChat : '';
    routed = { view, locked: !!lock };
    document.getElementById('topnav-title').textContent = pageTitle(view, arg);
    window.RailPulse?.show(view === 'settings' ? 'settings' : 'page', view === 'settings' ? arg || '' : '', view);   // first: it may give the sidebar back
    markNav(view);
    syncAsk(view);
    if (lock) {   // a deep link above the mode, or a place whose Labs feature is off: one line, and its one way on
      document.body.className = '';
      const name = TITLES[view] || 'Schedules', need = lock.min ? lock.min[0].toUpperCase() + lock.min.slice(1) : '';
      pane.today.innerHTML = `<div class="rail-locked">${R.emptyState({ title: lock.min ? `${name} needs ${need}` : `${name} is in Labs`, actions: R.button({ label: lock.min ? `Switch to ${need}` : 'Turn on Labs', kind: 'quiet', attrs: { 'data-unlock': lock.min ? 'mode:' + lock.min : 'flag:' + lock.flag, 'data-to': view } }) })}</div>`;
      scrollTo(0, 0);
    } else if (!pane.today.hidden) {
      pane.today.innerHTML = T.pages[view].html;
      scrollTo(0, 0);
    } else pane.today.innerHTML = '';
    if (view === 'chat') {
      window.RailChats?.show(arg || '');
      window.RailConversation?.show(arg || '');
      if (arg) { lastThing = { hash: `chat/${arg}`, title: window.RailConversation?.chatTitle(arg) || 'Chat', meta: 'Chat', when: 'now', mark: R.kindMark({ kind: 'chat' }) }; visited = [lastThing, ...visited.filter((v) => v.hash !== lastThing.hash).map((v) => ({ ...v, when: v.when === 'now' ? 'earlier' : v.when }))].slice(0, 6); }
    }
    if (view === 'runs') { window.RailRunsList?.show(); taskHome ||= window.RailConversation?.mount(pane.runs, { mode: 'task', where: '#route-runs', title: 'Start a task', note: 'Every task you start is in the list beside, with its chat.' }); taskHome?.show(''); }
    if (view === 'schedules' || view === 'schedule') window.RailSchedules?.show(view === 'schedule' ? arg : '');
    if (view === 'run') {
      const pick = document.getElementById('case');
      if (pick && arg && (pick.value !== arg || reopen)) { reopen = false; pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      if (taskChat) window.RailChats?.show(taskChat); else window.RailRunsList?.show();
      window.RailConversation?.dock(document.getElementById('task-dock'), { kind: 'task', title: RM?.titles?.[arg] || 'this task', chat: taskChat });
      drawTaskParts();
      scrollTo(0, 0);
    }
    drawBar();
  }

  // ---- a task's page: its trail goes back through its chat; its timeline is its stages ----
  function drawTaskParts() {
    const crumbs = [...document.querySelectorAll('#card .rc-crumbs .rc-crumb')];
    if (crumbs.length) { const first = taskChat ? 'Chat' : 'Tasks'; if (crumbs[0].textContent !== first) crumbs[0].textContent = first; }
    if (taskChat && crumbs.length > 1) { const word = window.RailConversation?.chatTitle(taskChat) || 'Chat', last = crumbs[crumbs.length - 1]; if (last.textContent !== word) { last.textContent = word; last.title = word; } }
    const host = document.getElementById('task-timeline'), stages = [...document.querySelectorAll('#card .sc-stage')];
    if (!host) return;
    const sig = stages.map((b) => b.dataset.stage + b.getAttribute('aria-selected')).join();
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    host.innerHTML = stages.length > 1 ? R.timeline({ ticks: stages.map((b, i) => ({ id: b.dataset.stage, at: (i + 0.5) / stages.length, kind: 'work', tone: b.getAttribute('aria-selected') === 'true' ? 'run' : '', title: b.textContent.trim().replace(/\s+/g, ' ') })), view: [0, 0], label: 'Move through this task' }) : '';
  }
  // ---- builds and runs read as tasks on screen. A stand-in for the prototype only: the rename itself is a build step, and
  // the library keeps its words until then. Verbs stay ("Run now", "it runs"); code, branches and what you type stay. ----
  const WORDS = [[/\bNew run\b/g, 'New task'], [/\bStart run\b/g, 'Start task'], [/\bRuns\b(?! (?:every|on|at|daily|weekly|\[))/g, 'Tasks'], [/\b(all|All|these|the|The|Your|your|paused|Paused|manual|Manual|other|many|\d+|their|its|two|three|mock|Mock) runs\b/g, '$1 tasks'], [/\b(a|A|an|An|the|The|this|This|one|One|each|Each|every|Every|your|Your|its|Its|paused|Paused|that|That|mock|Mock|1|new|New|next|Next|last|Last|Following a|following a) run\b(?! (?:the|it|on|now|once|a\b))/g, '$1 task'], [/\bRun (needs|asks|is|was|has|\d)/g, 'Task $1'], [/\bbuilds?\b(?= (?:across|in conversations))/g, 'tasks']];
  const reword = (t) => WORDS.reduce((x, [re, to]) => x.replace(re, to), t);
  const SKIP = 'code, pre, textarea, input, script, style, .mk-tools, .tr-body, .rc-mid-a';
  function rewordIn(rootEl) {
    const walk = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!/\b[Rr]uns?\b|builds?/.test(n.nodeValue) || n.parentElement?.closest(SKIP)) continue; const v = reword(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    for (const e of rootEl.querySelectorAll?.('[title], [aria-label]') || []) for (const k of ['title', 'aria-label']) { const v = e.getAttribute(k); if (v && /\b[Rr]uns?\b/.test(v)) { const w = reword(v); if (w !== v) e.setAttribute(k, w); } }
  }
  // A tick's hover says what is there: a stage's name, its time and its steps.
  function stageCard(id) {
    const host = document.getElementById('task-timeline'); host?.querySelector('.tl-hover')?.remove();
    const tab = id && document.querySelector(`#card .sc-stage[data-stage="${CSS.escape(id)}"]`); if (!tab) return;
    const tabs = [...document.querySelectorAll('#card .sc-stage')], i = tabs.indexOf(tab);
    const [name, ...rest] = tab.innerText.trim().split(/\n+/);
    const on = tab.getAttribute('aria-selected') === 'true', line = [rest.join(' · '), on ? 'Open now' : 'Opens this stage'].filter(Boolean).join(' · ');
    host.querySelector('.timeline')?.insertAdjacentHTML('beforeend', `<div class="tl-hover">${R.timelineCard({ mark: R.kindMark({ kind: 'task', tone: on ? 'run' : 'idle', size: 18 }), title: name, line, at: (i + 0.5) / tabs.length })}</div>`);
  }
  document.addEventListener('pointerover', (e) => { if (!e.target.closest) return; const t = e.target.closest('#task-timeline [data-tick]'); if (t) stageCard(t.dataset.tick); else if (document.querySelector('#task-timeline .tl-hover')) stageCard(''); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('#task-timeline [data-tick]'); if (t) stageCard(t.dataset.tick); });
  new MutationObserver((list) => { if (routed.view === 'run') drawTaskParts(); for (const m of list) for (const n of m.addedNodes) { if (n.nodeType === 1) rewordIn(n); else if (n.nodeType === 3 && n.parentElement && !n.parentElement.closest(SKIP)) { const v = reword(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } } }).observe(document.documentElement, { subtree: true, childList: true });

  // ---- clicks the shell owns: the sidebar's places, today's pages, a run row, the top bar's narrow controls, Ask worca ----
  const searchFold = (on) => { document.querySelector('#topnav .tsearch')?.classList.toggle('is-open', on); if (on) document.getElementById('tsearch-input')?.focus(); };
  document.addEventListener('click', (e) => {
    const on = (sel) => e.target.closest(sel);
    let hit;
    if (on('[data-pins-all]')) { pinsAll = true; drawBar(); return; }
    if (on('[data-bar-hide]')) { collapsed = true; store.set(KEY_RAIL, '1'); syncRail(); document.activeElement?.blur(); return; }
    if (on('#bar-show')) { collapsed = false; store.set(KEY_RAIL, '0'); syncRail(); return; }
    if (on('[data-bar-house]')) { homeOpen = !homeOpen && barOf(routed.view) !== 'home'; drawBar(); return; }
    if ((hit = on('[data-bar-new]'))) { window.RailConversation?.start(hit.dataset.barNew); return; }
    if ((hit = on('[data-back-to]'))) { drawer(false); window.RailShell.go(hit.dataset.backTo); return; }
    if ((hit = on('#task-timeline [data-tick]'))) { document.querySelector(`#card .sc-stage[data-stage="${CSS.escape(hit.dataset.tick)}"]`)?.click(); return; }
    if ((hit = on('#side-rail nav.nav [data-nav]'))) { e.preventDefault(); drawer(false); if (location.hash.slice(1) === hit.dataset.nav) { homeOpen = false; drawBar(); } else location.hash = hit.dataset.nav; return; }
    if ((hit = on('[data-unlock]')) && on('#route-today')) { window.RailPulse?.unlock(hit.dataset.unlock, hit.dataset.to); return; }
    if (on('#side-toggle')) { collapsed = !collapsed; store.set(KEY_RAIL, collapsed ? '1' : '0'); syncRail(); return; }
    if (on('#mbar-menu')) { drawer(!document.body.classList.contains('nav-open')); return; }
    if (on('#side-close')) { drawer(false); return; }
    if (on('#tsearch-open')) { searchFold(true); return; }
    if (on('#tsearch-close')) { searchFold(false); return; }
    if (on('#topnav-ask')) { askOpen = !askOpen; syncAsk(routed.view); return; }
    if (on('[data-ask-close]')) { askOpen = false; syncAsk(routed.view); document.getElementById('topnav-ask')?.focus(); return; }
    // a control on a captured page says where it goes
    if ((hit = on('#route-today a[href], #route-today button'))) {
      e.preventDefault();
      const name = (hit.getAttribute('aria-label') || hit.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
      window.RailPulse?.say(`${name ? name + ': ' : ''}on today's page, as captured; it does not act here`);
    }
  });
  // From a chat, the trail goes back to it.
  document.addEventListener('click', (e) => { if (taskChat && routed.view === 'run' && e.target.closest('#card .rc-crumbs .rc-crumb')) { e.preventDefault(); e.stopPropagation(); window.RailShell.back(); } }, true);
  // The bar's grip: a drag or the arrow keys, 240 to 420px, kept; a double-click goes back to the default.
  const BAR_W = 280, KEY_BAR = 'worca-rail.bar.width', clampBar = (px) => Math.min(420, Math.max(240, Math.round(+px) || BAR_W));
  let barW = clampBar(store.get(KEY_BAR)), barDrag = false;
  const setBarW = (px) => { barW = clampBar(px); document.documentElement.style.setProperty('--bar-w', `${barW}px`); store.set(KEY_BAR, barW); document.querySelector('.bar-grip')?.setAttribute('aria-valuenow', barW); };
  document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.bar-grip')) { barDrag = true; e.preventDefault(); document.body.classList.add('is-resizing-bar'); } });
  document.addEventListener('pointermove', (e) => { if (barDrag) setBarW(e.clientX); });
  document.addEventListener('pointerup', () => { if (barDrag) { barDrag = false; document.body.classList.remove('is-resizing-bar'); } });
  document.addEventListener('dblclick', (e) => { if (e.target.closest?.('.bar-grip')) setBarW(BAR_W); });
  document.addEventListener('keydown', (e) => { if (e.target.closest?.('.bar-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setBarW(barW + (e.key === 'ArrowRight' ? 20 : -20)); } });
  // The column's grip: a drag, or the arrow keys, 20px a step.
  let drag = false;
  document.addEventListener('pointerdown', (e) => { const g = e.target.closest?.('#ask-side .ask-side-grip'); if (g) { drag = true; e.preventDefault(); document.getElementById('ask-side').classList.add('is-resizing'); } });
  document.addEventListener('pointermove', (e) => { if (drag) setAskW(innerWidth - e.clientX); });
  document.addEventListener('pointerup', () => { if (drag) { drag = false; document.getElementById('ask-side').classList.remove('is-resizing'); } });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\' && innerWidth > 760) { e.preventDefault(); collapsed = !collapsed; store.set(KEY_RAIL, collapsed ? '1' : '0'); syncRail(); return; }
    if (e.target.closest?.('#ask-side .ask-side-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setAskW(askW + (e.key === 'ArrowLeft' ? 20 : -20)); return; }
  });
  // The prototype's corner: what the connection does, and the screensaver.
  let conn = 'ok';
  document.getElementById('conn')?.addEventListener('change', (e) => {
    const was = conn; conn = e.target.value;
    document.getElementById('rail-conn').innerHTML = conn === 'offline' ? R.offlineLine() : '';
    window.RailPulse?.session(conn === 'session');
    if (was === 'offline' && conn !== 'offline') window.RailPulse?.say('Back online');
  });
  document.getElementById('play-away')?.addEventListener('click', () => window.RailPulse?.playAway());
  document.getElementById('person')?.addEventListener('change', (e) => window.RailPulse?.person(e.target.value));

  window.RailShell = {
    // which script answers a click or a key: the run page owns #card and its tools; Pulse owns the rest of the Rail pieces
    owns: (who, target) => {
      if (!target?.isConnected) return false;   // a list page already answered it, and drew again
      const inRun = !!target?.closest?.('#card, [data-run-tools]');
      // today's pages and the sidebar's places are the shell's own: neither the run page nor Pulse answers there
      const inShell = !!target?.closest?.('#bar-back, #route-today, #route-runs, #route-chat, #route-schedule, #task-dock, #task-timeline, #side-rail nav.nav, #bar-head, #bar-chat, #bar-tasks, #bar-schedules, #ask-side');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    go: (hash) => { if (location.hash.slice(1) === hash) route(); else location.hash = hash; },
    // a run opened from Pulse or the search carries its own title
    openRun: (hash, title) => { const c = hash.split('/')[1]; if (RM && title) RM.titles[c] = title; reopen = true; window.RailShell.go(hash); },
    closeSearch: () => searchFold(false),
    connReset: () => { const sel = document.getElementById('conn'); if (sel) sel.value = 'ok'; conn = 'ok'; document.getElementById('rail-conn').innerHTML = ''; },
    closeDrawer: () => drawer(false),
    openTask: (cs, chat, title) => { taskChat = chat || ''; if (RM && title) RM.titles[cs] = title; reopen = true; window.RailShell.go(`run/${cs}`); },
    back: () => window.RailShell.go(taskChat ? `chat/${taskChat}` : 'runs'),
    // the list pages take their own `?`, with their own actions in the sheet
    listKeys: () => routed.view === 'runs' || routed.view === 'chat' || routed.view === 'schedule' || routed.view === 'schedules',
  };
  const RM = window.RunCardModel;
  let routed = { view: '', locked: false };
  R.neverOutside(document, '.mk-tools');   // the prototype's own corner closes nothing
  // the drawer and the narrow search close on a click outside or Esc (docs/rail/panels.md)
  R.dismissOnOutside(document, { open: () => document.body.classList.contains('nav-open'), inside: '#side-rail, #mbar-menu', back: () => '#mbar-menu', close: () => drawer(false), paint: () => {} });
  R.dismissOnOutside(document, { open: () => !!document.querySelector('#topnav .tsearch.is-open'), inside: '.tsearch, #tsearch-open', back: () => '#tsearch-open', close: () => searchFold(false), paint: () => {} });
  build();
  setAskW(askW); setBarW(barW);
  R.watchTooltips(document);
  addEventListener('resize', () => { syncRail(); });
  // A change of mode or a Labs flag: the sidebar follows, and the page if that changes whether it is locked.
  R.prefs.onChange(() => { applyPrefs(); if (routed.view && (TITLES[routed.view] || routed.view === 'schedule') && !!lockOf(routed.view) !== routed.locked) route(); });
  addEventListener('hashchange', route);
  // another Pulse case: the run page in view takes its title from it
  window.RailWorld.onChange(() => { if (routed.view === 'run') { reopen = true; route(); } });
  window.RailShell.start = route;
})();
