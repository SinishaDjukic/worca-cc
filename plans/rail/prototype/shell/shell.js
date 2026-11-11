// The one Worca's shell: today's sidebar and top bar (today/, captured from the app), with Wave 1's decisions applied,
// and a router over the pages. A place opens from the sidebar; today's pages show as captured, in the Rail colours; a
// run opens as a full page (the Rail run page); Settings opens from the profile menu (the Rail Settings).
//   #runs              the Rail Runs list
//   #chat[/<id>]       the Rail Chats column, beside today's Chat page
//   #<view>            a place: schedules, stats, team-metrics, workflows, requirements, projects (workspaces inside it: projects/ws:<id>),
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
  // places Rail redesigns (plans/rail/implementation-prompt.md): until then, what each will hold, said plainly
  const SOON = {
    workflows: ['Workflows: being redesigned with Rail', 'Your workflows, agents and scripts as one list beside the chat; building one happens in Chat today (Build workflow).'],
    projects: ['Projects: being redesigned with Rail', 'Your projects as one list, each with its settings and memory; add one from Chat today (Add project).'],
    workspaces: ['Workspaces: being redesigned with Rail', 'Sets of projects that ship together, and the map of how they connect.'],
    requirements: ['Requirements: being redesigned with Rail', 'Feature specs by perspective, before a task starts; Shaper writes them in Chat today.'],
  };
  const TITLES = { chat: 'Chat', runs: 'Tasks', schedules: 'Schedules', stats: 'Statistics', 'team-metrics': 'Team metrics', workflows: 'Workflows',
    requirements: 'Requirements', projects: 'Projects', workspaces: 'Workspaces', marketplace: 'Marketplace', insights: 'Insights', lost: 'Not found' };
  // A place built on Rail (projects/, workflows/, …) registers here: its list in the one bar and its page, from the library.
  // { title, min, newLabel, newAct(), show({ bar, page, arg }) } — the shell owns the routing, the bar and the frame.
  window.RailPlaces = window.RailPlaces || {};
  const placeMod = (v) => window.RailPlaces[v];
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ---- the sidebar: places only (a setting or a place, docs/rail/settings.md) ----
  // The one bar: Settings' behaviour for every feature. The house opens the places; a place with a list holds its list.
  const PLACES = [['Work', [['chat', 'Chat', 'simple'], ['runs', 'Tasks', 'simple'], ['schedules', 'Schedules', 'advanced']]], ['Build', [['workflows', 'Workflows', 'simple'], ['requirements', 'Requirements', 'simple', 'requirements'], ['marketplace', 'Marketplace', 'advanced']]], ['Manage', [['projects', 'Projects', 'simple'], ['settings', 'Settings', 'simple']]], ['Insight', [['insights', 'Insights', 'advanced']]]];
  function sidebar() {
    const side = el(T.sidebar);
    const nav = side.querySelector('nav.nav');
    const NEW = { chat: ['New chat', 'ask'] };   // the home's rows; Tasks and Schedules have their + in their own bar (rail.chat-first)
    const place = ([id, label, min, flag]) => { const item = R.navItem({ label, icon: R.icon('nav-' + id, 14), lab: !!flag, attrs: { 'data-nav': id, 'data-min-level': min, 'data-flag': flag || null, 'aria-label': label } }); return NEW[id] ? `<div class="place-row" data-place="${id}">${item}${R.button({ label: NEW[id][0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 13), attrs: { 'data-bar-new': NEW[id][1], title: NEW[id][0] } })}</div>` : item; };
    nav.insertAdjacentHTML('beforebegin', '<div id="bar-back" class="bar-back pz-app rail-page"></div>');
    nav.innerHTML = PLACES.map(([g, list]) => `<p class="nav-sect side-g">${g}</p>${list.map(place).join('')}`).join('');
    const close = side.querySelector('#side-close');
    side.querySelector('.brand').innerHTML = '<div id="bar-head"></div>'; side.querySelector('.brand').append(close);
    side.querySelector('#acct-menu')?.remove();   // the Rail profile menu takes its place (pulse.js)
    side.querySelector('#side-foot').innerHTML = '';   // the avatar: pulse.js draws it
    side.insertAdjacentHTML('beforeend', '<div id="bar-mini" class="bar-mini"></div>');
    nav.insertAdjacentHTML('afterend', '<div id="bar-chat" class="bar-list pz-app rail-page" hidden></div><div id="bar-tasks" class="bar-list pz-app rail-page" hidden><div id="runs-root"></div></div><div id="bar-schedules" class="bar-list pz-app rail-page" hidden></div><div id="bar-place" class="bar-list pz-app rail-page" hidden></div>');
    side.insertAdjacentHTML('beforeend', '<div class="bar-grip" role="separator" aria-orientation="vertical" aria-label="Resize the bar" aria-valuemin="264" aria-valuemax="420" tabindex="0" title="Drag to resize; past the edge it hides. Double-click for the default width"></div>');
    return side;
  }
  // What a place needs: the sidebar's own data-min-level and data-flag, as the app's sidebar.html has them.
  const needsOf = (view0) => { const view = view0 === 'schedule' ? 'schedules' : view0; const b = document.querySelector(`#side-rail nav.nav [data-nav="${view}"]`); return b ? { min: b.dataset.minLevel || '', flag: b.dataset.flag || '' } : {}; };
  const lockOf = (view) => { const n = needsOf(view); return !R.shows(n.min) ? { min: n.min } : n.flag && !R.prefs.flag(n.flag) ? { flag: n.flag } : null; };
  // A page inside a place may need more than the place (nav.locked); a schedule made in a chat opens in any mode, with its chat.
  const lockHere = (view, arg) => (view === 'schedule' && window.RailSchedules?.find(arg)?.chat ? null : lockOf(view) || placeMod(view)?.needs?.(arg) || null);
  // The sidebar draws again when the interface mode or a Labs flag changes; a group with no place left goes, with its head.
  function applyPrefs() {
    const nav = document.querySelector('#side-rail nav.nav');
    for (const b of nav.querySelectorAll('[data-nav]')) { b.hidden = !!lockOf(b.dataset.nav) || (!!SOON[b.dataset.nav] && !placeMod(b.dataset.nav) && !R.shows('expert')); const w = b.closest('.place-row'); if (w) w.hidden = b.hidden; }
    let sect = null, any = 0;
    const close = () => { if (sect) sect.hidden = any < 1; };   // a group keeps its head while it shows a place: Work over Chat alone still says where you are
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
    top.querySelector('#rail-pulse-slot')?.insertAdjacentHTML('afterend', R.designSwitch({ on: false }));   /* nav.design-switch: drawn on every route; here it flips its own state only */
    top.querySelector('#topnav-ask')?.insertAdjacentHTML('beforebegin', '<span id="in-view-slot"></span>');
    top.querySelector('#topnav-new')?.remove();   // starting anything is the composer's now
    top.querySelector('#side-toggle')?.insertAdjacentHTML('afterend', R.button({ label: 'Show the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-show', 16), cls: 'bar-show', attrs: { id: 'bar-show' } }));
    const kbd = top.querySelector('.tsearch-kbd'); if (kbd) kbd.textContent = R.keyHint(['mod', 'K'], R.isMac(window));
    const input = top.querySelector('#tsearch-input');
    if (input) { input.setAttribute('data-search', ''); input.removeAttribute('role'); input.closest('.tsearch-field')?.insertAdjacentHTML('beforeend', '<div data-search-res></div>'); }
    top.querySelector('#tsearch-pop')?.remove();
    top.querySelector('#topnav-ask')?.removeAttribute('hidden');
    top.querySelector('#topnav-ask')?.insertAdjacentHTML('afterbegin', `<span class="ask-ic" aria-hidden="true">${R.askWorcaMark()}</span>`);
    top.querySelector('.topnav-r')?.insertAdjacentHTML('beforeend', '<span id="rail-conn"></span>');
    return top;
  }

  // ---- the sidebar's three widths: the column above 1080px (it may be collapsed, and that is kept), the 60px rail from
  // 761 to 1080px, a drawer at 760px and below ----
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: a remembered choice is a nicety */ } } };
  const KEY_RAIL = 'worca-rail.sidebar.collapsed', KEY_ASK = 'worca-rail.ask.width';
  let collapsed = store.get(KEY_RAIL) === '1', tabletOpen = false;   // narrow.nav: 761 to 1080px starts as the strip; opened there, it stays open until reload, and a wide screen's choice is kept apart
  const inTablet = () => innerWidth > 760 && innerWidth <= 1080;
  const isStrip = () => (innerWidth <= 760 ? false : inTablet() ? !tabletOpen : collapsed);
  const setStrip = (on) => { if (inTablet()) tabletOpen = !on; else { collapsed = on; store.set(KEY_RAIL, on ? '1' : '0'); } };
  // nav.strip-inert: while the bar is the strip, what it hides is out of the tab order; the pointer on it, or a menu open in it, brings it back
  function barInert() {
    const s = document.getElementById('side-rail'), open = !s.classList.contains('is-strip') || (!s.classList.contains('is-resting') && s.matches(':hover, :has(.rc-pop > .menu, .pz-pick .menu, .viewer-modal, .list-pop)'));
    s.querySelectorAll('.side-scroll, .bar-title, .bar-head .btn').forEach((x) => x.toggleAttribute('inert', !open));
  }
  function syncRail() {
    const w = innerWidth, side = document.getElementById('side-rail'), rail = isStrip();
    side.classList.toggle('is-strip', rail);   // not the app's own `collapsed`: its 60px rail rules would fight the strip
    document.body.classList.toggle('bar-hidden', rail);
    barInert();
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
  function pageContext() {
    const v = routed.view, name = [...document.querySelectorAll('#main-row main .place-title, #main-row main [data-title], #card .rc-title')].find((x) => x.getClientRects().length)?.textContent?.trim() || TITLES[v === 'schedule' ? 'schedules' : v] || 'this page';   /* what shows: the task page waits hidden behind every other page */
    const SUG = {
      run: ['Why did it stop?', 'What does it need from me?', 'What did it change?'],
      projects: [`Why is ${name} behind, and is it safe to sync?`, 'What ran here this week, and what did it cost?', 'What needs me here?'],
      schedule: ['What did it do last night?', 'Why did the last run fail?', 'Should it run less often?'],
      schedules: ['What runs tonight?', 'Which schedule fails most?', 'What needs me?'],
      insights: ['Why did spend jump this week?', 'Which project costs the most per task?', 'Where could we save?'],
      settings: ['What changed in my settings this week?', 'What would you change here?', 'What does this setting do?'],
      workflows: [`When should I use ${name}?`, 'How could this workflow cost less?', 'What does each step do?'],
      marketplace: [`What would ${name} add for me?`, 'Which plugins fit how I work?', 'What does it ask for, and why?'],
    };
    const kind = v === 'run' ? 'task' : ({ projects: 'project', schedule: 'schedule', insights: 'question', workflows: 'workflow', marketplace: 'plugin', workspaces: 'workspace', requirements: 'feature' })[v] || 'page';
    return { view: v, kind, name, project: v === 'projects' ? name : '', suggest: SUG[v] || ['What needs me?', 'What is ready to ship?', 'What happened while I was away?'] };
  }
  function drawAsk(side) {
    side.innerHTML = R.sideColumn({ title: 'Ask worca', width: askW, close: R.icon('x', 14), body: '<div class="rail-ask-body side-col-convo" id="ask-convo"></div>', hooks: { close: { 'data-ask-close': '' } } });
    window.RailConversation?.mount(document.getElementById('ask-convo'));
  }
  // Ask worca's icon says what it does: three dots while Worca writes in its column, filled while the column is open
  let askBusy = false;
  function drawAskMark() { const ic = document.querySelector('#topnav-ask .ask-ic'); if (ic) ic.innerHTML = R.askWorcaMark({ answering: askBusy, open: askOpen }); }
  document.addEventListener('rail:replying', (e) => { if (!e.target.closest?.('#ask-side')) return; askBusy = !!e.detail?.busy; drawAskMark(); });
  function syncAsk(view) {
    const side = document.getElementById('ask-side'), btn = document.getElementById('topnav-ask');
    // on Chat the page is the chat: Ask worca stays in its place, off, and says why (the top bar never shifts)
    const here = view === 'chat'; if (here) askOpen = false;
    if (btn) { btn.hidden = false; btn.setAttribute('aria-expanded', String(askOpen)); btn.setAttribute('aria-disabled', String(here)); btn.title = here ? 'You are in Chat: the box below asks Worca' : `Ask worca, beside any page (${R.keyHint(['mod', 'J'], R.isMac(window))})`; }
    if (askOpen && !here) window.RailConversation?.sideRefresh?.();   /* a new page: its own questions */
    drawAskMark();
    const show = askOpen;
    if (show && side.hidden) { if (!side.firstChild) drawAsk(side); side.classList.add('is-in'); setTimeout(() => side.classList.remove('is-in'), 300); }
    side.hidden = !show;
    document.body.classList.toggle('ask-side-open', show);
  }

  function build() {
    const app = document.getElementById('worca');
    app.innerHTML = '';
    const col = el('<div class="main-col"></div>');
    col.append(topBar(), el('<div id="rail-strip"></div>'), el('<div id="main-row" class="main-row"><main class="main"><div class="page-bg" aria-hidden="true"><div class="chat-home-bg"></div></div><div id="route-today"></div><div id="route-chat" hidden></div><div id="route-schedule" hidden></div><div id="route-place" hidden></div><div id="route-runs" class="pz-app rail-page" hidden></div><div id="route-run" class="rc-board" hidden><div id="card"></div><div id="task-dock" class="convo-dock"></div><div id="task-timeline"></div></div><div id="route-settings" class="pz-app rail-page" hidden></div></main><aside id="ask-side" class="ask-side" aria-label="Ask worca" hidden></aside></div>'));
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
  let inviteBack = false;   // Esc took the Invitation back: closed for this load, asked again on the next
  let quickNav = false;   // nav.quick: the ▾ beside a bar's name
  const quickItems = () => [...document.querySelectorAll('#side-rail nav.nav [data-nav]')].filter((b) => !b.hidden && !b.closest('[hidden]') && b.style.display !== 'none').map((b) => ({ id: `bar-go|${b.dataset.nav}`, text: b.querySelector('.nav-label, span')?.textContent.trim() || b.textContent.trim(), checked: b.dataset.nav === routed.view, hint: b.dataset.flag ? 'Labs' : undefined, mark: R.icon(`nav-${b.dataset.nav}`, 14) }));   /* nav.labs: the word follows the row */
  let barMenu = false;   // the + as a menu, where a place makes things more than one way (list.bar-model)
  let homeNext = false, homeOpen = false, taskChat = '', lastThing = null, visited = [], pinsAll = false;
  const barOf = (view) => (routed.locked ? 'home' : placeMod(view) ? 'place' : view === 'chat' ? 'chat' : view === 'runs' ? 'tasks' : view === 'run' ? (taskChat ? 'chat' : 'tasks') : view === 'schedules' || view === 'schedule' ? 'schedules' : view === 'settings' ? 'settings' : 'home');
  // who makes things from this bar's +: a place, or Tasks and Schedules from Advanced up (rail.chat-first)
  const makerOf = (which) => (which === 'place' ? placeMod(routed.view) : which === 'tasks' || which === 'schedules' ? window.RailCenters?.maker(which) : null);
  function drawBar() {
    const side = document.getElementById('side-rail'), own = barOf(routed.view), which = homeOpen ? 'home' : own;
    side.dataset.bar = which;
    const maker = makerOf(which), act = maker?.newLabel ? [maker.newLabel, 'place'] : { chat: ['New chat', 'ask'] }[which];
    document.getElementById('bar-head').innerHTML = R.barHead({ title: which === 'place' ? TITLES[routed.view] : BAR_TITLE[which], center: which === 'place' ? routed.view : { chat: 'chat', tasks: 'runs', schedules: 'schedules' }[which] || '', atCenter: location.hash.slice(1) === (which === 'place' ? routed.view : { chat: 'chat', tasks: 'runs', schedules: 'schedules' }[which]), home: quickNav, menu: quickNav ? R.compactMenu({ items: quickItems() }) : '', logo: R.icon('worca-w', 20), action: act ? `<span class="rc-pop">${R.button({ label: act[0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-bar-new': act[1], ...(act[1] === 'place' && maker?.newMenu ? { 'aria-haspopup': 'menu', 'aria-expanded': String(barMenu) } : {}) } })}${barMenu && act[1] === 'place' && maker?.newMenu ? R.compactMenu({ label: act[0], items: maker.newMenu() }) : ''}</span>` : '', hide: isStrip() ? R.button({ label: 'Keep the bar open', kind: 'quiet', iconOnly: true, icon: R.icon('bar-show', 15), attrs: { 'data-bar-pin': '', title: `Keep the bar open (${R.keyHint(['mod', '\\'], R.isMac(window))})` } }) : R.button({ label: 'Hide the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-hide', 15), attrs: { 'data-bar-hide': '', title: `Hide the bar: it opens under the pointer (${R.keyHint(['mod', '\\'], R.isMac(window))})` } }) });
    barInert();
    // the bar switching places cross-fades: the list that comes in fades in (nav.bar-switch)
    for (const [id, b] of [['bar-chat', 'chat'], ['bar-tasks', 'tasks'], ['bar-schedules', 'schedules'], ['bar-place', 'place'], ['bar-back', 'home']]) {
      const list = document.getElementById(id); if (!list) continue;
      const show = which === b, came = show && !!side.dataset.was && side.dataset.was !== which;
      if (b !== 'home') list.hidden = !show;
      if (came) { list.classList.remove('is-in'); void list.offsetWidth; list.classList.add('is-in'); }
    }
    if (which === 'home' && side.dataset.was && side.dataset.was !== 'home') { const nav = side.querySelector('nav.nav'); nav.classList.remove('is-in'); void nav.offsetWidth; nav.classList.add('is-in'); }
    side.dataset.was = which;
    // Pinned first: what you pinned in any list; then the one thing you came from.
    const pins = (window.RailChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => R.listRow({ title: c.title, mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), open: { 'data-back-to': `chat/${c.id}`, title: `Opens ${c.title}` } }));
    // One section, Recent: what you pinned (a pin at its end), then where you were, newest first, never twice.
    const pinRows = (window.RailChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => ({ hash: `chat/${c.id}`, title: c.title, mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), end: R.icon('pin', 13), tip: 'Pinned' }));
    const seenRows = visited.filter((v) => !pinRows.some((p) => p.hash === v.hash)).slice(0, 1);
    const PINS = 5, morePins = pinRows.length - PINS;
    if (!pinsAll && morePins > 0) pinRows.length = PINS;
    const rows = [...pinRows, ...seenRows].map((x) => R.listRow({ title: x.title, meta: x.meta, mark: x.mark, end: x.end ? `<span class="lr-fig" title="${x.tip}">${x.end}</span>` : '', endText: x.end ? '' : x.when || '', open: { 'data-back-to': x.hash, title: `Opens ${x.title}` } }));
    drawMini();
    drawInView();
    document.getElementById('bar-back').innerHTML = R.list({ groups: [...(rows.length ? [{ title: pinRows.length ? 'Pinned and recent' : 'Recent', rows, more: !pinsAll && morePins > 0 ? { n: morePins, attrs: { 'data-pins-all': '' } } : null }] : [])] });
  }

  // ---- In view: what you keep an eye on, from any ⋯ or a task's head; its marks live in the top bar only, named like tabs, five at
  // most (marks only below 1100px; one on a phone), then +N opens the rest; its marks are the top bar's 20px ----
  const inViewMax = () => (innerWidth <= 760 ? 1 : 5);   // five at most, named like tabs above 1100px; one on a phone
  let inViewMenu = false, inViewCur = '';
  addEventListener('resize', () => drawInView());
  let inViewList = window.RailFirstRun ? [] : [{ type: 'task', id: 't4', chat: 'c4', title: 'Fix flaky login test' }];
  const allTasksOf = (c) => { const out = []; const walk = (t) => { out.push(t); (t.after || []).forEach(walk); }; (c?.tasks || []).forEach(walk); return out; };
  function inViewNow(x) {
    const chats = window.RailChats?.data().chats || [];
    if (x.type === 'chat') { const c = chats.find((y) => y.id === x.id); if (!c) return null; const st = R.chatState(c.state); return { label: `${c.title}\n${st.word}`, mark: R.kindMark({ kind: 'chat', tone: c.state === 'needs-you' ? 'ask' : c.state === 'idle' ? 'idle' : 'run', size: 20, title: '' }), hash: `chat/${c.id}` }; }
    if (x.type === 'schedule') return { label: `${x.title}\nSchedule`, mark: R.kindMark({ kind: 'schedule', size: 20 }), hash: `schedule/${x.id}` };
    const t = x.chat ? allTasksOf(chats.find((c) => c.id === x.chat)).find((y) => y.id === x.id) : null, cs = t?.case || x.case;
    if (!cs) return null;
    const st = R.runState(RM.stateOf(cs));
    return { label: `${x.title}\n${st.word}${t?.detail ? ` · ${t.detail}` : ''}`, mark: R.kindMark({ kind: 'task', tone: R.markTone(st), stage: t?.stage ?? RM.stageOf(cs).stage ?? -1, size: 20 }), hash: `run/${cs}`, task: { cs, chat: x.chat || '', title: x.title } };
  }
  // many tasks share a case: its tab is current on that very task's page (case and name), or in the chat its tab opens
  const isOnTask = ({ cs, chat, title }) => location.hash === `#run/${cs}` ? RM?.titles?.[cs] === title : location.hash === `#chat/${chat || window.RailConversation?.chatOfTask({ title })}`;
  function drawInView() {
    const live = inViewList.map((x) => ({ x, now: inViewNow(x) })).filter((y) => y.now);
    const max = inViewMax(), shown = live.slice(0, max), hidden = live.slice(max), key = (x) => `${x.type}:${x.id}`;
    if (!hidden.length) inViewMenu = false;
    const slot = document.getElementById('in-view-slot');
    if (slot) slot.innerHTML = R.inView({
      items: shown.map(({ x, now }) => { const [title, line] = now.label.split('\n'); return { title, line, icon: now.mark, current: now.task ? isOnTask(now.task) : location.hash === `#${now.hash}`, attrs: { 'data-in-view': key(x) }, drop: { 'data-in-view-drop': key(x) } }; }),
      more: hidden.length ? { n: hidden.length, open: inViewMenu, attrs: { 'data-in-view-more': '' }, items: hidden.map(({ x, now }) => ({ id: key(x), text: now.label.split('\n')[0], mark: now.mark.replace('--km:20px', '--km:18px') })) } : null });
    // a tab that just became the one you are on grows its line from the centre: drawn without it, then given it
    const cur = slot?.querySelector('.in-view-i.is-current'), curKey = cur?.dataset.inView || '';
    if (cur && curKey !== inViewCur) { cur.classList.remove('is-current'); requestAnimationFrame(() => requestAnimationFrame(() => cur.classList.add('is-current'))); }
    inViewCur = curKey;
    syncEye(live);
    return live;
  }
  // the eye on a task's head says whether it is kept in view; set only when it changes, so the page's observer stays quiet
  function syncEye(live = inViewList.map((x) => ({ x, now: inViewNow(x) })).filter((y) => y.now)) {
    const eye = document.querySelector('[data-keep-view]'); if (!eye) return;
    const named = document.querySelector('#card [data-title]')?.textContent, on = String(live.some(({ now }) => now.task?.cs === eye.dataset.keepView && now.task.title === named));   // many tasks share a case: this one, by its name
    if (eye.getAttribute('aria-pressed') === on) return;
    eye.setAttribute('aria-pressed', on); eye.setAttribute('aria-label', on === 'true' ? 'Out of view' : 'Keep in view');
    eye.title = on === 'true' ? 'Out of view: its mark leaves the top bar' : 'Keep in view: its mark stays in the top bar, on every page';
  }
  const isInView = (type, id) => inViewList.some((x) => x.type === type && x.id === id);
  // a task's own page keeps it in view by its case: the one already kept from its chat counts, never twice
  function toggleCaseInView(cs, title) {
    const name = title || RM?.titles?.[cs] || 'This task', had = inViewList.find((x) => { const t = inViewNow(x)?.task; return t?.cs === cs && t.title === name; });
    toggleInView(had || { type: 'task', id: `case-${cs}-${name.replace(/:/g, ' ')}`, case: cs, chat: '', title: name });
  }
  function toggleInView(item) {
    const had = isInView(item.type, item.id);
    inViewList = had ? inViewList.filter((x) => !(x.type === item.type && x.id === item.id)) : [item, ...inViewList];
    drawInView(); drawBar();
    window.RailPulse?.say(had ? `${item.title}: out of view` : `${item.title}: in view, in the top bar`);
  }

  // Hidden, the bar is a strip: the W, then one icon per kind of work with how many are open; each opens its place.
  function drawMini() {
    const kinds = [['chat', 'chat', 'Chats', window.RailChats?.summary()], ['runs', 'task', 'Tasks', window.RailRunsList?.summary()], ['schedules', 'schedule', 'Schedules', window.RailSchedules?.summary()]];
    document.getElementById('bar-mini').innerHTML = R.barStrip({ items: kinds.filter(([place]) => !lockOf(place)).map(([place, kind, word, c]) => {
      const n = c?.n || 0, needs = c?.needs || 0;
      return { label: [`${word}: ${n} open`, needs ? `${needs} need you` : ''].filter(Boolean).join(' · '), icon: R.kindMark({ kind, stage: -1, keepType: true, size: 20 }), n, tone: needs ? 'need' : '', attrs: { 'data-mini': place } };
    }) });
  }

  // ---- the router ----
  let reopen = false, lastPlace = '', openedAgain = false;   // a run opened from a row draws again, even on the same case: two rows can share one
  const pageTitle = (view, arg) => {
    if (view === 'chat') return (arg && window.RailConversation?.chatTitle(arg)) || 'Chat';
    if (view === 'run') return taskChat ? window.RailConversation?.chatTitle(taskChat) || 'Chat' : 'Tasks';
    if (view === 'settings') return 'Settings';
    if (view === 'schedule') return 'Schedules';
    return TITLES[view];
  };
  // nav.not-found: an address that names nothing here. null when it names something, or nothing in particular.
  const NOUNS = { projects: 'project', workflows: 'workflow', requirements: 'feature', marketplace: 'plugin', insights: 'view' };
  function goneOf(kind, arg0) {
    let arg = arg0 || ''; try { arg = decodeURIComponent(arg); } catch { /* a stray % stays as typed */ }
    if (!TITLES[kind] && !['run', 'settings', 'schedule'].includes(kind)) return { lost: true, what: 'page', name: kind, back: 'Chat', to: 'chat' };
    if (!arg) return null;
    if (kind === 'chat') return (window.RailChats?.data().chats || []).some((c) => c.id === arg) ? null : { what: 'chat', name: arg, back: 'Chat', to: 'chat' };
    if (kind === 'schedule') return window.RailSchedules?.find(arg) ? null : { what: 'schedule', name: arg, back: 'Chat', to: 'chat' };
    if (kind === 'run') { try { RM.stateOf(arg); return null; } catch { return { lost: true, what: 'task', name: arg, back: 'Chat', to: 'chat' }; } }
    if (kind === 'settings') return window.RailPulse?.hasSection?.(arg) !== false ? null : { lost: true, what: 'setting', name: arg, back: 'Settings', to: 'settings' };
    const has = placeMod(kind)?.has; return !has || has(arg) ? null : { what: arg.startsWith('ws:') ? 'workspace' : NOUNS[kind] || 'page', name: arg.replace(/^[a-z]+:/, ''), back: TITLES[kind], to: kind };
  }
  function route() {
    const OLD = { stats: 'insights/spend', 'team-metrics': 'insights/team' };   /* Statistics and Team metrics are Insights now: an old link lands there */
    if (OLD[location.hash.slice(1)]) { location.replace(`#${OLD[location.hash.slice(1)]}`); return; }
    if (/^#workspaces(\/|$)/.test(location.hash)) { const w = location.hash.split('/')[1]; location.replace(w ? `#projects/ws:${w}` : '#projects'); return; }   // workspaces live in Projects now: an old link lands there
    const [kind, arg0] = (location.hash.slice(1) || 'chat').split('/');
    const gone = goneOf(kind, arg0), arg = gone ? '' : arg0;
    const view = gone?.lost ? 'lost' : TITLES[kind] ? kind : kind === 'run' || kind === 'settings' || kind === 'schedule' ? kind : 'chat';
    drawer(false);
    homeOpen = homeNext; homeNext = false;
    const pane = { today: document.getElementById('route-today'), chat: document.getElementById('route-chat'), schedule: document.getElementById('route-schedule'), place: document.getElementById('route-place'), run: document.getElementById('route-run'), settings: document.getElementById('route-settings'), runs: document.getElementById('route-runs') };
    const lock = !gone && (view === 'schedule' || !!TITLES[view] && view !== 'chat') && lockHere(view, arg);   // nav.locked: every place, by the bar's own data
    const ownPage = !!placeMod(view) || view === 'run' || view === 'settings' || view === 'runs' || view === 'chat' || view === 'schedules' || view === 'schedule';
    pane.today.hidden = ownPage && !lock; pane.run.hidden = view !== 'run'; pane.settings.hidden = view !== 'settings';
    pane.runs.hidden = view !== 'runs' || !!lock; pane.chat.hidden = view !== 'chat'; pane.schedule.hidden = !(view === 'schedule' || view === 'schedules') || !!lock; pane.place.hidden = !placeMod(view) || !!lock;
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : view === 'runs' ? 'view-runs' : view === 'chat' ? 'view-rail-chat' : view === 'schedule' || view === 'schedules' || placeMod(view) ? 'view-rail-chat' : (T.pages[view]?.body || '');
    if (gone) { for (const p of Object.values(pane)) p.hidden = p !== pane.today; document.body.className = ''; }
    if (view !== 'run') taskChat = view === 'chat' ? taskChat : '';
    routed = { view, arg, locked: !!lock };
    document.getElementById('topnav-title').textContent = pageTitle(view, arg);
    window.RailPulse?.show(view === 'settings' ? 'settings' : 'page', view === 'settings' ? arg || '' : '', view);   // first: it may give the sidebar back
    markNav(view);
    syncAsk(view);
    if (gone) {
      pane.today.innerHTML = `<div class="rail-locked">${R.notFound({ what: gone.what, name: gone.name, back: gone.back, attrs: { 'data-nav': gone.to } })}</div>`;
      scrollTo(0, 0);
    } else if (lock) {   // a deep link above the mode, or a place whose Labs feature is off: one line, and its one way on
      document.body.className = '';
      const name = lock.name || TITLES[view] || 'Schedules', need = lock.min ? lock.min[0].toUpperCase() + lock.min.slice(1) : '';
      pane.today.innerHTML = `<div class="rail-locked">${R.emptyState({ title: lock.min ? `${name} needs ${need}` : `${name} is in Labs`, actions: R.button({ label: lock.min ? `Switch to ${need}` : 'Turn on Labs', kind: 'quiet', attrs: { 'data-unlock': lock.min ? 'mode:' + lock.min : 'flag:' + lock.flag, 'data-to': view } }) })}</div>`;
      scrollTo(0, 0);
    } else if (!pane.today.hidden && SOON[view]) {   // nav.locked: a place not yet in Rail draws a true page, never a blank one, and the bar stays
      document.body.className = 'view-place';
      pane.today.innerHTML = `<div class="rail-locked">${R.emptyState({ title: SOON[view][0], text: SOON[view][1], actions: R.button({ label: 'Back to Chat', kind: 'quiet', attrs: { 'data-nav': 'chat' } }) })}</div>`;
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
    if (view === 'runs') { window.RailRunsList?.show(); window.RailCenters?.tasks(pane.runs); }
    if (view === 'schedules' || view === 'schedule') window.RailSchedules?.show(view === 'schedule' ? arg : '');
    if (placeMod(view) && !lock) { const again = openedAgain && lastPlace === location.hash; placeMod(view).show({ bar: document.getElementById('bar-place'), page: pane.place, arg: decodeURIComponent(arg || '') }); if (again) R.land(pane.place.querySelector('.place-head')); }   /* the row you are on, opened again by you: its page's head lands; a flag or a redraw on the same address never flashes */
    lastPlace = placeMod(view) && !lock ? location.hash : ''; openedAgain = false;
    if (view === 'run') {
      window.RailShell.unembedRun();
      const pick = document.getElementById('case');
      if (pick && arg && (pick.value !== arg || reopen)) { reopen = false; pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      if (taskChat) window.RailChats?.show(taskChat); else window.RailRunsList?.show();
      window.RailConversation?.dock(document.getElementById('task-dock'), { kind: 'task', title: RM?.titles?.[arg] || 'this task', chat: taskChat, warning: R.alertLevel(R.markTone(R.runState(RM.stateOf(arg)))) === 3 });
      drawTaskParts();
      scrollTo(0, 0);
    }
    drawBar();
    document.body.classList.toggle('bar-hidden', document.getElementById('side-rail').classList.contains('is-strip'));
  }

  // ---- a task's page: its trail goes back through its chat; its timeline is its stages ----
  function drawTaskParts() {
    syncEye();
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
  const WORDS = [[/\bNew run\b/g, 'New task'], [/\bStart run\b/g, 'Start task'], [/\bRuns\b(?=\s*(?:$|[·:(),.]))/g, 'Tasks'], [/\b(all|All|these|the|The|Your|your|paused|Paused|manual|Manual|other|many|\d+|their|its|two|three|mock|Mock) runs\b/g, '$1 tasks'], [/\b(a|A|an|An|the|The|this|This|one|One|each|Each|every|Every|your|Your|its|Its|paused|Paused|that|That|mock|Mock|1|new|New|next|Next|last|Last|Following a|following a) run\b(?! (?:the|it|on|now|once|a\b))/g, '$1 task'], [/\bRun (needs|asks|is|was|has|\d)/g, 'Task $1'], [/\bbuilds?\b(?= (?:across|in conversations))/g, 'tasks']];
  const reword = (t) => WORDS.reduce((x, [re, to]) => x.replace(re, to), t);
  const SKIP = 'code, pre, textarea, input, script, style, .mk-tools, .tr-body, .rc-mid-a, .is-center';   // a center says a schedule's runs (panel.run-outcomes)
  function rewordIn(rootEl) {
    const walk = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!/\b[Rr]uns?\b|builds?/.test(n.nodeValue) || n.parentElement?.closest(SKIP)) continue; const v = reword(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    for (const e of rootEl.querySelectorAll?.('[title], [aria-label]') || []) for (const k of ['title', 'aria-label']) { const v = e.getAttribute(k); if (v && /\b[Rr]uns?\b/.test(v) && !e.closest('.is-center')) { const w = reword(v); if (w !== v) e.setAttribute(k, w); } }
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
    if ((hit = on('[data-in-view-drop]'))) { const [type, id] = hit.dataset.inViewDrop.split(':'), x = inViewList.find((y) => y.type === type && y.id === id); if (x) toggleInView(x); return; }
    if ((hit = on('[data-keep-view]'))) { toggleCaseInView(hit.dataset.keepView, document.querySelector('#card [data-title]')?.textContent); return; }
    if ((hit = on('[data-in-view]'))) { inViewMenu = false; const [type, id] = hit.dataset.inView.split(':'), x = inViewList.find((y) => y.type === type && y.id === id), now = x && inViewNow(x); if (now?.task) window.RailShell.openTask(now.task.cs, now.task.chat, now.task.title); else if (x?.type === 'schedule') window.RailShell.openSchedule(x.id); else if (now) window.RailShell.go(now.hash); return; }
    if (on('[data-in-view-more]')) { inViewMenu = !inViewMenu; drawInView(); return; }
    if ((hit = on('[data-mini]'))) { window.RailShell.go(hit.dataset.mini); return; }
    if (on('[data-pins-all]')) { pinsAll = true; drawBar(); return; }
    if (on('[data-bar-hide]')) { hideBar(); return; }
    if (on('[data-bar-pin]')) { setStrip(false); syncRail(); drawBar(); return; }
    if (on('#bar-show')) { setStrip(false); syncRail(); drawBar(); return; }
    if (on('[data-bar-home]')) { quickNav = false; window.RailChats?.home(); homeNext = true; window.RailShell.go('chat'); return; }   /* nav.one-bar: the W opens the features menu, with Chat's home behind it */
    if ((hit = on('[data-menu-pick^="bar-go|"]'))) { quickNav = false; location.hash = hit.dataset.menuPick.split('|')[1]; drawBar(); return; }
    if (on('[data-bar-house]')) { quickNav = !quickNav; drawBar(); return; }
    if ((hit = on('[data-center-go]'))) { e.preventDefault(); drawer(false); homeOpen = false; quickNav = false; if (location.hash.slice(1) !== hit.dataset.centerGo) location.hash = hit.dataset.centerGo; else drawBar(); return; }   // nav.center-home
    if (quickNav) { quickNav = false; drawBar(); }   /* a page with no list of its own (a locked place): closing the places goes back to Chat */
    if ((hit = on('[data-menu-pick^="bar-new|"]'))) { barMenu = false; drawBar(); makerOf(document.getElementById('side-rail').dataset.bar)?.newPick?.(hit.dataset.menuPick.split('|')[1]); return; }
    if (barMenu && !on('[data-bar-new]')) { barMenu = false; drawBar(); }
    if ((hit = on('[data-bar-new]'))) { const maker = makerOf(document.getElementById('side-rail').dataset.bar); if (hit.dataset.barNew === 'place' && maker?.newMenu) { barMenu = !barMenu; drawBar(); return; } if (hit.dataset.barNew === 'place') maker?.newAct?.(); else window.RailConversation?.start(hit.dataset.barNew); return; }
    if ((hit = on('[data-back-to]'))) { drawer(false); window.RailShell.go(hit.dataset.backTo); return; }
    if ((hit = on('#task-timeline [data-tick]'))) { document.querySelector(`#card .sc-stage[data-stage="${CSS.escape(hit.dataset.tick)}"]`)?.click(); return; }
    if ((hit = on('#side-rail nav.nav [data-nav]'))) { e.preventDefault(); drawer(false); if (location.hash.slice(1) === hit.dataset.nav) { homeOpen = false; drawBar(); } else location.hash = hit.dataset.nav; return; }
    if ((hit = on('[data-unlock]')) && on('#route-today')) { window.RailPulse?.unlock(hit.dataset.unlock, hit.dataset.to); return; }
    if (on('#side-toggle')) { setStrip(!isStrip()); syncRail(); return; }
    if (on('#mbar-menu')) { drawer(!document.body.classList.contains('nav-open')); return; }
    if (on('#side-close')) { drawer(false); return; }
    if (on('#tsearch-open')) { searchFold(true); return; }
    if (on('#tsearch-close')) { searchFold(false); return; }
    if (on('#topnav-ask')) { if (routed.view === 'chat') { document.querySelector('#route-chat [data-composer-t]')?.focus(); return; } askOpen = !askOpen; syncAsk(routed.view); return; }   // on Chat it points to the box that asks
    if (on('[data-ask-close]')) { askOpen = false; syncAsk(routed.view); document.getElementById('topnav-ask')?.focus(); return; }
    // a control on a captured page says where it goes
    if ((hit = on('#route-today [data-nav]'))) { e.preventDefault(); location.hash = hit.dataset.nav; return; }   // a not-yet place's way on
    if ((hit = on('#route-today a[href], #route-today button'))) {
      e.preventDefault();
      const name = (hit.getAttribute('aria-label') || hit.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
      window.RailPulse?.say(`${name ? name + ': ' : ''}on today's page, as captured; it does not act here`);
    }
  });
  // From a chat, the trail goes back to it.
  document.addEventListener('click', (e) => { if (taskChat && routed.view === 'run' && e.target.closest('#card .rc-crumbs .rc-crumb')) { e.preventDefault(); e.stopPropagation(); window.RailShell.back(); } }, true);
  // The bar's grip: a drag or the arrow keys, 240 to 420px, kept; a double-click goes back to the default.
  const BAR_W = 280, BAR_MIN = 264, BAR_SNAP = 200, KEY_BAR = 'worca-rail.bar.width', clampBar = (px) => Math.min(420, Math.max(BAR_MIN, Math.round(+px) || BAR_W));
  function hideBar() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    setStrip(true); syncRail(); document.activeElement?.blur(); drawMini(); drawBar();
    // just hidden, it stays a strip until the pointer has left it once, so the click that hid it is seen to work
    const side = document.getElementById('side-rail'); side.classList.add('is-resting'); barInert();
    const away = (e) => { if (side.contains(e.target)) return; side.classList.remove('is-resting'); document.removeEventListener('pointermove', away); };
    document.addEventListener('pointermove', away);
  }
  let barW = clampBar(store.get(KEY_BAR)), barDrag = false;
  const setBarW = (px) => { barW = clampBar(px); document.documentElement.style.setProperty('--bar-w', `${barW}px`); store.set(KEY_BAR, barW); document.querySelector('.bar-grip')?.setAttribute('aria-valuenow', barW); };
  document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.bar-grip')) { barDrag = true; e.preventDefault(); document.body.classList.add('is-resizing-bar'); } });
  document.addEventListener('pointermove', (e) => { if (!barDrag) return; if (e.clientX < BAR_SNAP) { barDrag = false; document.body.classList.remove('is-resizing-bar'); hideBar(); return; } setBarW(e.clientX); });
  document.addEventListener('pointerup', () => { if (barDrag) { barDrag = false; document.body.classList.remove('is-resizing-bar'); } });
  document.addEventListener('dblclick', (e) => { if (e.target.closest?.('.bar-grip')) setBarW(BAR_W); });
  document.addEventListener('keydown', (e) => { if (e.target.closest?.('.bar-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setBarW(barW + (e.key === 'ArrowRight' ? 20 : -20)); } });
  // The column's grip: a drag, or the arrow keys, 20px a step.
  let drag = false;
  document.addEventListener('pointerdown', (e) => { const g = e.target.closest?.('#ask-side .ask-side-grip'); if (g) { drag = true; e.preventDefault(); document.getElementById('ask-side').classList.add('is-resizing'); } });
  document.addEventListener('pointermove', (e) => { if (drag) setAskW(innerWidth - e.clientX); });
  document.addEventListener('pointerup', () => { if (drag) { drag = false; document.getElementById('ask-side').classList.remove('is-resizing'); } });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\' && innerWidth > 760) { e.preventDefault(); if (isStrip()) { setStrip(false); syncRail(); drawBar(); } else hideBar(); return; }
    if (e.target.closest?.('#ask-side .ask-side-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setAskW(askW + (e.key === 'ArrowLeft' ? 20 : -20)); return; }
  });
  // a disabled menu item says why (comp.menu-off); on a strip's icon the strip stays, so the icon can be clicked: anywhere else on it, it opens
  document.addEventListener('rail:disabled', (e) => { if (e.detail?.why) window.RailPulse?.say(e.detail.why); });
  let iconRest = false;
  document.addEventListener('pointerover', (e) => {
    const side = document.getElementById('side-rail'), on = !!e.target.closest?.('.bar-strip-i');
    if (on && side.classList.contains('is-strip') && !side.classList.contains('is-resting')) { iconRest = true; side.classList.add('is-resting'); }
    else if (!on && iconRest) { iconRest = false; side.classList.remove('is-resting'); }
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
    // nav.stillhet-ask: the Invitation under the top bar while the address says ?invite=stillhet and the demo has not answered
    inviteStrip: () => (new URLSearchParams(location.search).get('invite') === 'stillhet' && !store.get('worca-rail.stillhetAsked') && !inviteBack ? R.stillhetInvitation({ bugsUrl: 'https://github.com/' }) : ''),
    answerInvite: (answer) => { if (answer === 'yes' || answer === 'no') store.set('worca-rail.stillhetAsked', '1'); else inviteBack = true; },
    // which script answers a click or a key: the run page owns #card and its tools; Pulse owns the rest of the Rail pieces
    owns: (who, target) => {
      if (!target?.isConnected) return false;   // a list page already answered it, and drew again
      const inRun = !!target?.closest?.('#card, [data-run-tools]');
      // today's pages and the sidebar's places are the shell's own: neither the run page nor Pulse answers there
      const inShell = !!target?.closest?.('#in-view-slot, #bar-back, #route-today, #route-runs, #route-chat, #route-schedule, #route-place, #bar-place, #task-dock, #task-timeline, #side-rail nav.nav, #bar-head, #bar-chat, #bar-tasks, #bar-schedules, #ask-side');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    taskGone: (cs, title) => { const r = window.RailWorld.rows().find((x) => x.case === cs && x.title === title); if (r) window.RailWorld.remove(r.id); },
    pageContext: () => pageContext(),
    needs: (view) => needsOf(view),
    locked: (view) => !!lockOf(view),
    go: (hash) => { if (location.hash.slice(1) === hash) { openedAgain = true; route(); } else location.hash = hash; },
    // a run opened from Pulse or the search carries its own title
    openRun: (hash, title, run) => window.RailShell.openTask(hash.split('/')[1], '', title, run),   // Pulse and search: its card in its chat
    closeSearch: () => searchFold(false),
    connReset: () => { const sel = document.getElementById('conn'); if (sel) sel.value = 'ok'; conn = 'ok'; document.getElementById('rail-conn').innerHTML = ''; },
    closeDrawer: () => drawer(false),
    inView: { toggle: toggleInView, has: isInView, draw: () => drawInView() },
    // Everything leads to its card in its chat (plans/rail/chat-cards.md): a task's link opens its chat at its card; a task with no
    // chat gets one, named after it. The page stays as openTaskPage, only until the card holds everything it does.
    openTask: (cs, chat, title, run) => {
      if (RM && title) RM.titles[cs] = title;
      const w = run && window.RailWorld?.find(run);
      // the chat a row names wins; else the chat that holds this very task (by its run, else its name); a case alone is shared by many
      let cid = chat || window.RailConversation?.chatOfTask({ run, title }) || (!title && !run ? window.RailConversation?.chatOfCase(cs) : '') || '';
      if (!cid && window.RailChats) {
        const name = title || RM?.titles?.[cs] || 'A task', st = RM?.stageOf?.(cs) || {};
        cid = window.RailChats.newChat(name, w?.project || '', { fromTask: true, tasks: [{ id: `t-${run || cs}`, run: run || '', title: name, case: cs, stage: st.stage ?? 0, detail: w?.detail || st.label || '', branch: '' }] });
        window.RailChats.refresh();
        window.RailPulse?.say(`Opened in a new chat: ${name}`);   // a chat that appears by itself says so
      }
      if (!cid) { window.RailShell.openTaskPage(cs, chat, title); return; }
      window.RailShell.go(`chat/${cid}`);
      requestAnimationFrame(() => requestAnimationFrame(() => window.RailConversation?.focus({ cs, title })));
    },
    // A card opened in place borrows the task page itself (#card), so every stage, part and control works as on the page.
    embedRun: (slot, cs, ask) => {
      const card = document.getElementById('card'), pick = document.getElementById('case'); if (!card || !slot) return;
      if (RM) { RM.asks = RM.asks || {}; RM.branches = RM.branches || {}; if (ask) { RM.asks[cs] = ask; RM.titles[cs] = ask; } const t = ask && findTask(ask); if (t?.branch) RM.branches[cs] = t.branch; if (t) { RM.asks[cs] = t.ask || t.title; RM.whys = RM.whys || {}; RM.whys[cs] = t.why || null; } }   // the lent page is this task's: its name and what it was asked   // the lent page says what this task was asked, not its mock's words
      if (!runAnchor) { runAnchor = document.createComment('the task page lives here'); card.before(runAnchor); }
      const lent = `${cs}|${ask || ''}`, again = lent !== lastLent; lastLent = lent;
      if (pick && (pick.value !== cs || again)) { /* drawn again for this task even when another task shares its case */ const at = location.hash; pick.value = cs; pick.dispatchEvent(new Event('change', { bubbles: true })); if (location.hash !== at) history.replaceState(null, '', at); }
      slot.append(card); card.classList.add('is-lent');
    },
    unembedRun: (from) => { const card = document.getElementById('card'); if (card && runAnchor && (!from || from.contains(card))) { runAnchor.after(card); card.classList.remove('is-lent'); } },
    openTaskPage: (cs, chat, title) => { const t = title && findTask(title); if (RM && t?.branch) { RM.branches = RM.branches || {}; RM.branches[cs] = t.branch; } if (RM && t) { RM.asks = RM.asks || {}; RM.asks[cs] = t.ask || t.title; RM.whys = RM.whys || {}; RM.whys[cs] = t.why || null; }   /* the page says what this task was asked and what broke in it, never its mock's */ taskChat = chat || ''; if (RM && title) RM.titles[cs] = title; reopen = true; window.RailShell.go(`run/${cs}`); },
    openSchedule: (sid) => {
      const s = window.RailSchedules?.find?.(sid), cid = s?.chat || '';
      if (!cid) { window.RailShell.go(`schedule/${sid}`); return; }
      window.RailShell.go(`chat/${cid}`);
      requestAnimationFrame(() => requestAnimationFrame(() => window.RailConversation?.focus({ id: sid })));
    },
    back: () => window.RailShell.go(taskChat ? `chat/${taskChat}` : 'runs'),
    // the list pages take their own `?`, with their own actions in the sheet
    listKeys: () => routed.view === 'runs' || routed.view === 'chat' || routed.view === 'schedule' || routed.view === 'schedules',
  };
  const RM = window.RunCardModel;
  // a task by its name, in the chats' store copy: its branch for its page (the page shows this task, not its case's fixture)
  const findTask = (title) => { for (const c of window.RailChats?.data().chats || []) { const w = (l) => { for (const t of l || []) { if (t.title === title) return t; const f = w(t.after); if (f) return f; } return null; }; const t = w(c.tasks); if (t) return t; } return null; };
  let lastLent = '';
  let runAnchor = null;
  let routed = { view: '', locked: false };
  R.neverOutside(document, '.mk-tools');   // the prototype's own corner closes nothing
  // the drawer and the narrow search close on a click outside or Esc (docs/rail/panels.md)
  R.dismissOnOutside(document, { open: () => quickNav, inside: '#bar-head', back: () => '[data-bar-house]', close: () => { quickNav = false; }, paint: () => drawBar() });
  R.dismissOnOutside(document, { open: () => barMenu, inside: '#bar-head', back: () => '[data-bar-new]', close: () => { barMenu = false; }, paint: () => drawBar() });
  R.dismissOnOutside(document, { open: () => inViewMenu, inside: '#in-view-slot', back: () => '[data-in-view-more]', close: () => { inViewMenu = false; }, paint: () => drawInView() });
  R.dismissOnOutside(document, { open: () => document.body.classList.contains('nav-open'), inside: '#side-rail, #mbar-menu', back: () => '#mbar-menu', close: () => drawer(false), paint: () => {} });
  R.dismissOnOutside(document, { open: () => !!document.querySelector('#topnav .tsearch.is-open'), inside: '.tsearch, #tsearch-open', back: () => '#tsearch-open', close: () => searchFold(false), paint: () => {} });
  build();
  setAskW(askW); setBarW(barW);
  for (const t of ['pointerenter', 'pointerleave']) document.getElementById('side-rail').addEventListener(t, barInert);
  R.watchClickGuard(document); R.watchOrbs(document); R.watchTooltips(document); R.watchMenus(document); R.watchStrips(document); R.watchScrollFades(document); R.watchFolds(document); R.watchStageAdvance(document);
  // a new person starts in Simple; the mode they pick is remembered (docs/ui-levels.md)
  try { const m = localStorage.getItem('worca-rail.mode'); R.prefs.setMode(R.MODES.includes(m) ? m : 'simple'); } catch { R.prefs.setMode('simple'); }
  applyPrefs(); drawMini();   /* the sidebar drew before the mode was read: it shows only the places this mode has */
  R.prefs.onChange(() => { try { localStorage.setItem('worca-rail.mode', R.prefs.mode()); } catch { /* remembering is a nicety */ } });
  let wasStrip = isStrip();
  addEventListener('resize', () => { syncRail(); if (isStrip() !== wasStrip) { wasStrip = isStrip(); drawMini(); drawBar(); } });
  // A change of mode or a Labs flag: the sidebar follows, and the page if that changes whether it is locked.
  R.prefs.onChange(() => { applyPrefs(); drawMini(); if (routed.view && (TITLES[routed.view] || routed.view === 'schedule') && !!lockHere(routed.view, routed.arg) !== routed.locked) route(); else if (routed.view) drawBar(); });
  addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); if (routed.view === 'chat') { document.querySelector('#route-chat [data-composer-t]')?.focus(); return; } askOpen = !askOpen; syncAsk(routed.view); if (askOpen) setTimeout(() => document.querySelector('#ask-side [data-composer-t]')?.focus(), 50); } });   // ⌘J: Ask worca beside this page
  // another Pulse case: the run page in view takes its title from it
  window.RailWorld.onChange(() => { drawInView(); if (routed.view === 'run') { reopen = true; route(); } });
  // a step taken on a task's page moves the task everywhere: its row, the bar's and Pulse's counts, In view
  document.addEventListener('rail:task-moved', (e) => {
    const { from, to, title } = e.detail || {}; if (!title) return;
    const r = window.RailWorld.rows().find((x) => x.case === from && x.title === title);
    if (r) window.RailWorld.move(r.id, to, R.runState(RM.stateOf(to)).word);
    if (routed.view === 'run') { for (const c of window.RailChats?.data().chats || []) for (const t of allTasksOf(c)) if (t.case === from && t.title === title) { t.case = to; t.detail = ''; const st = RM.stageOf?.(to); if (st?.stage >= 0) t.stage = st.stage; } window.RailChats?.refresh(); }   /* lent to a card, its chat does this itself */
    for (const x of inViewList) if (x.case === from && x.title === title) x.case = to;
    RM.titles[to] = title;   // the store names a state after its first task: this page stays this task
    drawBar();
  });
  window.RailShell.start = () => { applyPrefs(); drawMini(); route(); };   /* the places have registered by now: the first bar shows them */
})();
