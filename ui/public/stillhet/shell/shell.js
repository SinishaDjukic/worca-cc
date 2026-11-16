// The one Worca's shell: the sidebar and top bar (frame.js, from the library's frame parts),
// and a router over the pages. A place opens from the sidebar; today's pages show as captured, in the Stillhet colours; a
// task opens as a full page (the Stillhet task page); Settings opens from the profile menu (the Stillhet Settings).
//   #runs              the Stillhet Tasks list
//   #chat[/<id>]       the Stillhet Chats column, beside today's Chat page
//   #<view>            a place: schedules, stats, team-metrics, workflows, requirements, projects (workspaces inside it: projects/ws:<id>),
//                      marketplace (today's pages)
//   #run/<case>        the Stillhet run or group page, on one of its cases
//   #settings[/<id>]   the Stillhet Settings, on one of its sections
// pulse/pulse.js mounts Pulse, the profile menu, the search's results and Settings into it; runs/run-page.js draws the
// run page into #card. Each owns its own clicks (window.StillhetShell.owns).
// The shell itself holds the sidebar's three widths (docs/stillhet/narrow.md), Ask worca's hand-over to Chat (chat-first: Chat is
// the only place to type) and what a place needs of the interface mode and Labs (the sidebar follows; a deep link above them gets one line).
(function () {
  const R = window.StillhetUI;
  // places Stillhet redesigns (plans/stillhet/README.md): until then, what each will hold, said plainly
  const SOON = {
    workflows: ['Workflows: being redesigned with Stillhet', 'Your workflows, agents and scripts as one list beside the chat; building one happens in Chat today (Build workflow).'],
    projects: ['Projects: being redesigned with Stillhet', 'Your projects as one list, each with its settings and memory; add one from Chat today (Add project).'],
    workspaces: ['Workspaces: being redesigned with Stillhet', 'Sets of projects that ship together, and the map of how they connect.'],
    requirements: ['Requirements: being redesigned with Stillhet', 'Feature specs by perspective, before a task starts; Shaper writes them in Chat today.'],
  };
  const TITLES = { chat: 'Chat', runs: 'Tasks', schedules: 'Schedules', stats: 'Statistics', 'team-metrics': 'Team metrics', workflows: 'Workflows',
    requirements: 'Requirements', projects: 'Projects', workspaces: 'Workspaces', marketplace: 'Marketplace', insights: 'Insights', lost: 'Not found' };
  // A place built on Stillhet (projects/, workflows/, …) registers here: its list in the one bar and its page, from the library.
  // { title, min, newLabel, newAct(), show({ bar, page, arg }) } — the shell owns the routing, the bar and the frame.
  window.StillhetPlaces = window.StillhetPlaces || {};
  const placeMod = (v) => window.StillhetPlaces[v];
  // The live kind (D23): a place not yet on live data draws its empty look, never seeded rows, until its slice wires it.
  const LIVE = !!window.StillhetWorld?.live;
  const NOT_LIVE = { requirements: 'Requirements, under Build' };   // where each lives with Stillhet off (nav.not-live); Workflows is live since slice 7, Marketplace since slice 8, Insights since slice 10
  const notLiveOf = (view) => LIVE && !!NOT_LIVE[view];
  let liveTask = { title: '' };   // the live task a row opened: its page shows its title and no task details yet
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ---- the sidebar: places only (a setting or a place, docs/stillhet/settings.md) ----
  // The one bar: Settings' behaviour for every feature. The house opens the places; a place with a list holds its list.
  const PLACES = [['Work', [['chat', 'Chat', 'simple'], ['runs', 'Tasks', 'simple'], ['schedules', 'Schedules', 'advanced']]], ['Build', [['workflows', 'Workflows', 'simple'], ['requirements', 'Requirements', 'simple', 'requirements'], ['marketplace', 'Marketplace', 'advanced']]], ['Manage', [['projects', 'Projects', 'simple'], ['settings', 'Settings', 'simple']]], ['Insight', [['insights', 'Insights', 'advanced']]]];
  const sidebar = () => window.StillhetFrame.sidebar(PLACES);   // shell/frame.js composes it from the library's frame parts
  // What a place needs: the sidebar's own data-min-level and data-flag, as the app's sidebar.html has them.
  const needsOf = (view0) => { const view = view0 === 'schedule' ? 'schedules' : view0; const b = document.querySelector(`#side-rail nav.nav [data-nav="${view}"]`); return b ? { min: b.dataset.minLevel || '', flag: b.dataset.flag || '' } : {}; };
  const lockOf = (view) => { const n = needsOf(view); return !R.shows(n.min) ? { min: n.min } : n.flag && !R.prefs.flag(n.flag) ? { flag: n.flag } : null; };
  // A page inside a place may need more than the place (nav.locked); a schedule made in a chat opens in any mode, with its chat.
  // One table for what a mode offers (levels.offers): a schedule's own page opens in every mode (nav.row-opens-page), so a
  // schedule made in Simple, from a chat or the form, is shown; the Schedules list stays Advanced, and in Simple the page
  // keeps Chat's bar, where its schedule lives.
  const lockHere = (view, arg) => (view === 'schedule' && window.StillhetSchedules?.find(arg) ? null : lockOf(view) || placeMod(view)?.needs?.(arg) || null);
  const inChatBar = (view) => view === 'schedule' && !!lockOf('schedules');
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
  // ---- the top bar: Pulse in Activity's place; the search, New run and the profile open the Stillhet pieces ----
  const topBar = () => window.StillhetFrame.topBar();

  // ---- the sidebar's three widths: the column above 1080px (it may be collapsed, and that is kept), the 60px rail from
  // 761 to 1080px, a drawer at 760px and below ----
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: a remembered choice is a nicety */ } } };
  const KEY_RAIL = 'worca-stillhet.sidebar.collapsed';
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
    // the drawer is a dialog (key.drawer): it has the role and a name, the page behind it is inert, the focus goes into it and
    // Tab stays in it; Esc and the scrim close it and the focus is back on Menu (dismissOnOutside, below)
    const rail = document.getElementById('side-rail'), was = rail?.getAttribute('role') === 'dialog';
    for (const el of document.querySelectorAll('.main-col, #topnav, #main-content')) el.toggleAttribute('inert', on);
    if (!rail || was === on) return;
    if (on) { rail.setAttribute('role', 'dialog'); rail.setAttribute('aria-modal', 'true'); rail.setAttribute('aria-label', 'Menu'); (rail.querySelector('[data-bar-house], .place-btn') || R.focusables(rail).find((x) => x.getClientRects().length))?.focus(); }
    else { rail.removeAttribute('role'); rail.removeAttribute('aria-modal'); rail.removeAttribute('aria-label'); }
  }
  // Tab stays inside the open drawer
  addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !document.body.classList.contains('nav-open')) return;
    const rail = document.getElementById('side-rail'); if (!rail || document.querySelector('.viewer-modal')) return;
    const stops = R.focusables(rail).filter((x) => x.getClientRects().length), a = document.activeElement;
    const open = document.querySelector('.menu'); if (open && open.contains(a)) return;   // a menu the drawer opened has its own Tab
    if (!stops.length) return;
    if (!rail.contains(a)) { e.preventDefault(); stops[0].focus(); return; }
    if (e.shiftKey && a === stops[0]) { e.preventDefault(); stops[stops.length - 1].focus(); } else if (!e.shiftKey && a === stops[stops.length - 1]) { e.preventDefault(); stops[0].focus(); }
  }, true);

  // ---- Ask worca (chat-first): Chat is the only place to type. The top bar's Ask and ⌘J hand the page you are on to Chat
  // as a chip (stillhet.hand-to-chat); Back returns to the page. On Chat they point to the box that asks. ----
  const LIST_SUG = {
    marketplace: ['Which plugins fit how I work?', 'What does a plugin ask for, and why?', 'Which of my plugins have an update?'],
    workflows: ['Which workflow fits my task?', 'How could my workflows cost less?', 'Which workflow ran most this week?'],
    projects: ['Which project is behind, and is it safe to sync?', 'What ran this week, and what did it cost?', 'What needs me here?'],
  };
  function pageContext() {
    const v = routed.view, list = ['marketplace', 'workflows', 'projects', 'requirements'].includes(v) && (!routed.arg || routed.arg.startsWith('~'));   // F-G-G5-05, F-7a-08: a place's list is no one thing
    if (list) return { view: v, kind: 'list', name: TITLES[v], project: '', suggest: LIST_SUG[v] || ['What needs me?', 'What is ready to ship?', 'What happened while I was away?'] };
    const name = [...document.querySelectorAll('#main-row main .place-title, #main-row main [data-title], #card .rc-title')].find((x) => x.getClientRects().length)?.textContent?.trim() || TITLES[v === 'schedule' ? 'schedules' : v] || 'this page';   /* what shows: the task page waits hidden behind every other page */
    const SUG = {
      run: ['Why did it stop?', 'What does it need from me?', 'What did it change?'],
      projects: [`Why is ${name} behind, and is it safe to sync?`, 'What ran here this week, and what did it cost?', 'What needs me here?'],
      schedule: ['What did it do last night?', 'Why did the last task fail?', 'Should it run less often?'],
      schedules: ['What runs tonight?', 'Which schedule fails most?', 'What needs me?'],
      insights: ['Why did spend jump this week?', 'Which project costs the most per task?', 'Where could we save?'],
      settings: ['What changed in my settings this week?', 'What would you change here?', 'What does this setting do?'],
      workflows: [`When should I use ${name}?`, 'How could this workflow cost less?', 'What does each step do?'],
      marketplace: [`What would ${name} add for me?`, 'Which plugins fit how I work?', 'What does it ask for, and why?'],
    };
    const kind = v === 'run' ? 'task' : ({ projects: 'project', schedule: 'schedule', insights: 'question', workflows: 'workflow', marketplace: 'plugin', workspaces: 'workspace', requirements: 'feature' })[v] || 'page';
    return { view: v, kind, name, project: v === 'projects' ? name : '', suggest: SUG[v] || ['What needs me?', 'What is ready to ship?', 'What happened while I was away?'] };
  }
  function syncAsk(view) {
    const btn = document.getElementById('topnav-ask'), here = view === 'chat'; if (!btn) return;
    btn.hidden = false; btn.removeAttribute('aria-expanded'); btn.removeAttribute('aria-controls'); btn.removeAttribute('aria-disabled');
    btn.title = here ? 'You are in Chat: the box below asks Worca' : `Ask worca about this page, in Chat (${R.keyHint(['mod', 'J'], R.isMac(window))})`;
    const ic = btn.querySelector('.ask-ic'); if (ic && !ic.firstChild) ic.innerHTML = R.askWorcaMark({});
  }
  function askHere() {
    if (routed.view === 'chat') { document.querySelector('#route-chat [data-composer-t]')?.focus(); return; }
    const c = pageContext(), kind = c.kind === 'list' || c.kind === 'page' ? 'Page' : c.kind[0].toUpperCase() + c.kind.slice(1);
    window.StillhetConversation?.handOver({ about: { kind, name: c.name }, ph: `Ask about ${c.name}`, ...(c.project ? { project: c.project } : {}) });
  }

  function build() {
    const app = document.getElementById('worca');
    app.innerHTML = '';
    const col = el('<div class="main-col"></div>');
    col.append(topBar(), el('<div id="stillhet-strip"></div>'), el('<div id="main-row" class="main-row"><main class="main" id="main-content" tabindex="-1"><div class="page-bg" aria-hidden="true"><div class="chat-home-bg"></div></div><div id="route-today"></div><div id="route-chat" hidden></div><div id="route-schedule" hidden></div><div id="route-place" hidden></div><div id="route-runs" class="pz-app stillhet-page" hidden></div><div id="route-run" class="rc-board" hidden><div id="card"></div><div id="task-timeline"></div></div><div id="route-settings" class="pz-app stillhet-page" hidden></div></main></div>'));
    app.append(el(R.skipLink()), el('<div class="nav-scrim" id="nav-scrim" hidden></div>'), sidebar(), col);   // key.skip-link: the first Tab stop
    syncRail(); applyPrefs();
  }

  // the current place, marked in the bar
  function markNav(view) {
    const place = view === 'run' ? 'runs' : view === 'schedule' ? (inChatBar(view) ? 'chat' : 'schedules') : view;
    for (const b of document.querySelectorAll('#side-rail nav.nav [data-nav]')) {
      const on = b.dataset.nav === place;
      b.classList.toggle('active', on); b.classList.toggle('is-on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  // ---- the bar: what it holds now; the house opens the places over it ----
  const BAR_TITLE = { home: 'Worca', chat: 'Chat', tasks: 'Tasks', schedules: 'Schedules', settings: 'Settings' };
  let inviteBack = false;   // Esc took the Invitation back: closed for this load, asked again on the next
  let quickNav = false;   // nav.place-button: the place's name and its chevron are one button; this is its menu
  // the places this mode has, each with how many of its things are open, the current one checked
  // what needs you there, from the one count (StillhetWorld.countOf): the bar, its tab, this menu and Pulse never disagree
  const NEED_KINDS = { chat: ['task'], runs: ['task', 'schedule'], schedules: ['schedule'], projects: ['project', 'proposal'] };
  const countOf = (place) => (NEED_KINDS[place] && window.StillhetWorld?.countOf ? window.StillhetWorld.countOf(NEED_KINDS[place]) || '' : '');
  // list.news: any chat with something you have not seen ('need' when one of them needs you)
  const chatNews = () => { const cs = (window.StillhetChats?.data().chats || []).filter((c) => c.unread && !c.archived); return !cs.length ? false : cs.some((c) => c.state === 'needs-you') ? 'need' : true; };
  const placeOf = (view) => (view === 'run' ? (taskChat ? 'chat' : 'runs') : view === 'schedule' ? (inChatBar(view) ? 'chat' : 'schedules') : view);
  const placeList = () => [...document.querySelectorAll('#side-rail nav.nav [data-nav]')].filter((b) => !b.hidden && !b.closest('[hidden]') && b.style.display !== 'none').map((b) => ({ id: b.dataset.nav, label: b.querySelector('.nav-label, .pz-nav-l, span')?.textContent.trim() || b.textContent.trim(), count: countOf(b.dataset.nav), news: b.dataset.nav === 'chat' && chatNews(), current: b.dataset.nav === placeOf(routed.view), lab: !!b.dataset.flag, icon: R.icon(`nav-${b.dataset.nav}`, 14) }));   /* nav.labs: the word follows the row */
  let barMenu = false;   // the + as a menu, where a place makes things more than one way (list.bar-model)
  let homeNext = false, homeOpen = false, taskChat = '', lastThing = null, visited = [], pinsAll = false;
  const barOf = (view) => (routed.locked || notLiveOf(view) ? 'home' : placeMod(view) ? 'place' : view === 'chat' ? 'chat' : view === 'runs' ? 'tasks' : view === 'run' ? (taskChat ? 'chat' : 'tasks') : inChatBar(view) ? 'chat' : view === 'schedules' || view === 'schedule' ? 'schedules' : view === 'settings' ? 'settings' : 'home');
  // who makes things from this bar's +: a place (Workflows, Projects, Marketplace) and Chat. Tasks and Schedules are for
  // looking at what exists: they have no +; a task or a schedule starts in Chat (nav.start-in-chat)
  const plainMenu = (items) => items.filter((it) => !(it.header && /legacy/i.test(it.header)));   // a place's own menu never says which way is the old one
  const makerOf = (which) => { const m = which === 'place' ? placeMod(routed.view) : null; return m?.newMenu ? { ...m, newMenu: () => plainMenu(m.newMenu()) } : m; };
  function drawBar() {
    const side = document.getElementById('side-rail'), own = barOf(routed.view), which = homeOpen ? 'home' : own;
    side.dataset.bar = which;
    const maker = makerOf(which), act = maker?.newLabel ? [maker.newLabel, 'place'] : { chat: ['New chat', 'ask'] }[which];
    const title = which === 'place' ? TITLES[routed.view] : BAR_TITLE[which], homeId = which === 'place' ? routed.view : { chat: 'chat', tasks: 'runs', schedules: 'schedules', settings: 'settings' }[which] || '';
    const plus = act ? `<span class="rc-pop">${R.button({ label: act[0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-bar-new': act[1], ...(act[1] === 'place' && maker?.newMenu ? { 'aria-haspopup': 'menu', 'aria-expanded': String(barMenu) } : {}) } })}${barMenu && act[1] === 'place' && maker?.newMenu ? R.compactMenu({ label: act[0], items: maker.newMenu() }) : ''}</span>` : '';
    const hide = isStrip() ? R.button({ label: 'Keep the bar open', kind: 'quiet', iconOnly: true, icon: R.icon('bar-show', 15), attrs: { 'data-bar-pin': '', title: `Keep the bar open (${R.keyHint(['mod', '\\'], R.isMac(window))})` } }) : R.button({ label: 'Hide the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-hide', 15), attrs: { 'data-bar-hide': '', title: `Hide the bar: it opens under the pointer (${R.keyHint(['mod', '\\'], R.isMac(window))})` } });
    // nav.place-button: the W alone goes home; the place's name and its chevron are one button that opens the places
    document.getElementById('bar-head').innerHTML = R.barPlaceHead({ title, logo: R.icon('worca-w', 20), places: which !== 'home', open: quickNav,
      menu: quickNav ? R.compactMenu({ label: 'Places', items: R.placeItems({ home: homeId ? { id: homeId, label: `${title} home` } : null, places: placeList() }) }) : '', action: plus, hide });
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
    const pins = (window.StillhetChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => R.listRow({ title: c.title, mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), open: { 'data-back-to': `chat/${c.id}`, title: `Opens ${c.title}` } }));
    // One section, Recent: what you pinned (a pin at its end), then where you were, newest first, never twice.
    const pinRows = (window.StillhetChats?.data().chats || []).filter((c) => c.pinned && !c.archived).map((c) => ({ hash: `chat/${c.id}`, title: c.title, mark: R.kindMark({ kind: c.kind === 'workflow' ? 'workflow' : 'chat' }), end: R.icon('pin', 13), tip: 'Pinned' }));
    const seenRows = visited.filter((v) => !pinRows.some((p) => p.hash === v.hash)).slice(0, 1);
    const PINS = 5, morePins = pinRows.length - PINS;
    if (!pinsAll && morePins > 0) pinRows.length = PINS;
    const rows = [...pinRows, ...seenRows].map((x) => R.listRow({ title: x.title, meta: x.meta, mark: x.mark, end: x.end ? `<span class="lr-fig" title="${R.esc(x.tip)}">${x.end}</span>` : '', endText: x.end ? '' : x.when || '', open: { 'data-back-to': x.hash, title: `Opens ${x.title}` } }));
    drawMini();
    drawInView();
    document.getElementById('bar-back').innerHTML = R.list({ groups: [...(rows.length ? [{ title: pinRows.length ? 'Pinned and recent' : 'Recent', rows, more: !pinsAll && morePins > 0 ? { n: morePins, attrs: { 'data-pins-all': '' } } : null }] : [])] });
  }

  // ---- In view: what you keep an eye on, from any ⋯ or a task's head; its marks live in the top bar only, named like tabs, five at
  // most (marks only below 1100px; one on a phone), then +N opens the rest; its marks are the top bar's 20px ----
  const inViewMax = () => (innerWidth <= 760 ? 1 : 5);   // five at most, named like tabs above 1100px; one on a phone
  let inViewMenu = false, inViewCur = '';
  addEventListener('resize', () => drawInView());
  let inViewList = window.StillhetFirstRun || LIVE ? [] : [{ type: 'task', id: 't4', chat: 'c4', title: 'Fix flaky login test' }];
  const allTasksOf = (c) => { const out = []; const walk = (t) => { out.push(t); (t.after || []).forEach(walk); }; (c?.tasks || []).forEach(walk); return out; };
  function inViewNow(x) {
    const chats = window.StillhetChats?.data().chats || [];
    if (x.type === 'chat') { const c = chats.find((y) => y.id === x.id); if (!c) return null; const st = R.chatState(c.state); return { label: `${c.title}\n${st.word}`, mark: R.kindMark({ kind: 'chat', tone: c.state === 'needs-you' ? 'ask' : c.state === 'idle' ? 'idle' : 'run', size: 20, title: '' }), hash: `chat/${c.id}` }; }
    if (x.type === 'schedule') return { label: `${x.title}\nSchedule`, mark: R.kindMark({ kind: 'schedule', size: 20 }), hash: `schedule/${x.id}` };
    const t = x.chat ? allTasksOf(chats.find((c) => c.id === x.chat)).find((y) => y.id === x.id) : null, cs = t?.case || x.case;
    if (!cs) return null;
    const st = R.runState(RM.stateOf(cs)), run = LIVE ? t?.pid || t?.run || x.run || '' : t?.run || '';   // the live kind opens it by its own id
    return { label: `${x.title}\n${st.word}${t?.detail ? ` · ${t.detail}` : ''}`, mark: R.kindMark({ kind: 'task', tone: R.markTone(st), stage: t?.stage ?? RM.stageOf(cs).stage ?? -1, size: 20 }), hash: `run/${LIVE && run ? run : cs}`, task: { cs, chat: x.chat || '', title: x.title, run } };
  }
  // many tasks share a case: its tab is current on that very task's page (case and name), or in the chat its tab opens
  const isOnTask = ({ cs, chat, title, run }) => LIVE && run && location.hash === `#run/${run}` ? true : location.hash === `#run/${cs}` ? RM?.titles?.[cs] === title : location.hash === `#chat/${chat || window.StillhetConversation?.chatOfTask({ run, title })}`;
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
    const run = LIVE && routed.view === 'run' ? routed.arg || '' : '';   // F-G-G5-03: the live kind reopens it by its own id
    toggleInView(had || { type: 'task', id: `case-${cs}-${name.replace(/:/g, ' ')}`, case: cs, chat: '', title: name, run });
  }
  function toggleInView(item) {
    const had = isInView(item.type, item.id);
    inViewList = had ? inViewList.filter((x) => !(x.type === item.type && x.id === item.id)) : [item, ...inViewList];
    drawInView(); drawBar();
    window.StillhetPulse?.say(had ? `${item.title}: out of view` : `${item.title}: in view, in the top bar`);
  }

  // Hidden, the bar is a strip: the W, then one icon per kind of work with how many are open; each opens its place.
  function drawMini() {
    const kinds = [['chat', 'chat', 'Chats', window.StillhetChats?.summary()], ['runs', 'task', 'Tasks', window.StillhetRunsList?.summary()], ['schedules', 'schedule', 'Schedules', window.StillhetSchedules?.summary()]];
    document.getElementById('bar-mini').innerHTML = R.barStrip({ items: kinds.filter(([place]) => !lockOf(place)).map(([place, kind, word, c]) => {
      const n = c?.n || 0, needs = c?.needs || 0;
      return { label: [`${word}: ${n} open`, needs ? `${needs} need you` : ''].filter(Boolean).join(' · '), icon: R.kindMark({ kind, stage: -1, keepType: true, size: 20 }), n, news: place === 'chat' && chatNews(), tone: needs ? 'need' : '', attrs: { 'data-mini': place } };
    }) });
  }

  // ---- the router ----
  let reopen = false, lastPlace = '', openedAgain = false;   // a run opened from a row draws again, even on the same case: two rows can share one
  const pageTitle = (view, arg) => {
    if (view === 'chat') return (arg && window.StillhetConversation?.chatTitle(arg)) || 'Chat';
    if (view === 'run') return taskChat ? window.StillhetConversation?.chatTitle(taskChat) || 'Chat' : 'Tasks';
    if (view === 'settings') return 'Settings';
    if (view === 'schedule') return 'Schedules';
    return TITLES[view];
  };
  // nav.not-found: an address that names nothing here. null when it names something, or nothing in particular.
  const NOUNS = { projects: 'project', workflows: 'workflow', requirements: 'feature', marketplace: 'plugin', insights: 'view' };
  let schedWaits = false;   // a #schedule/ID routed before the first list read landed
  function goneOf(kind, arg0) {
    let arg = arg0 || ''; try { arg = decodeURIComponent(arg); } catch { /* a stray % stays as typed */ }
    if (!TITLES[kind] && !['run', 'settings', 'schedule'].includes(kind)) return { lost: true, what: 'page', name: kind, back: 'Chat', to: 'chat' };
    if (!arg) return null;
    // live: a chat the bar has not listed (just made, or past its first page) is read by the conversation, which says when it is gone
    if (kind === 'chat') return window.StillhetWorld?.live || (window.StillhetChats?.data().chats || []).some((c) => c.id === arg) ? null : { what: 'chat', name: arg, back: 'Chat', to: 'chat' };
    // F-G-fid-01: live, a fresh load or a shared link waits for the first list read (the page says Loading), then routes again
    if (kind === 'schedule') { if (window.StillhetSchedules?.find(arg)) return null; if (LIVE && window.StillhetDemoState?.list === 'loading') { schedWaits = true; return null; } return { what: 'schedule', name: arg, back: 'Chat', to: 'chat' }; }
    if (kind === 'run') { if (LIVE) return null; try { RM.stateOf(arg); return null; } catch { return { lost: true, what: 'task', name: arg, back: 'Chat', to: 'chat' }; } }   // live: StillhetTaskLive says when a task is gone (D15)
    if (kind === 'settings') return window.StillhetPulse?.hasSection?.(arg) !== false ? null : { lost: true, what: 'setting', name: arg, back: 'Settings', to: 'settings' };
    const has = placeMod(kind)?.has; return !has || has(arg) ? null : { what: arg.startsWith('ws:') ? 'workspace' : NOUNS[kind] || 'page', name: arg.replace(/^[a-z]+:/, ''), back: TITLES[kind], to: kind };
  }
  // The live task page's look (D15): StillhetTaskLive's state for the id, opening it the first time it is asked for.
  let shownTask = '', openedTask = '', taskWired = false, retryFocus = '';   // retryFocus: the task whose Try again was pressed
  function liveTaskState(id) {
    const T = window.StillhetTaskLive;
    if (!T || !id) return 'loading';
    if (!taskWired) { taskWired = true; T.onChange((x) => { if (routed.view === 'run' && (!x || x === routed.arg) && T.state(routed.arg) !== taskLook) route(); }); }
    const st = T.state(id);
    // opened once per visit, and again while it waits on the list's first load; a failed or gone look stays until Try again
    // the look is recorded first: a listener told synchronously by open() of the same state does not route again
    taskLook = st;
    if (id !== openedTask || st === 'loading') { openedTask = id; T.open(id); }
    if (st !== 'ready') shownTask = '';
    return st;
  }
  let taskLook = '';
  function route() {
    // dev's old addresses land on their places (old-addresses.js); in place, so Back does not loop
    const moved = window.StillhetOldAddresses?.resolve(location.hash);
    if (moved) { location.replace(moved.hash); if (moved.pulse) window.StillhetPulse?.open(moved.pulse); return; }
    const [kind, arg0] = (location.hash.slice(1) || 'chat').split('/');
    const gone = goneOf(kind, arg0), arg = gone ? '' : arg0;
    const view = gone?.lost ? 'lost' : TITLES[kind] ? kind : kind === 'run' || kind === 'settings' || kind === 'schedule' ? kind : 'chat';
    drawer(false);
    homeOpen = homeNext; homeNext = false;
    const pane = { today: document.getElementById('route-today'), chat: document.getElementById('route-chat'), schedule: document.getElementById('route-schedule'), place: document.getElementById('route-place'), run: document.getElementById('route-run'), settings: document.getElementById('route-settings'), runs: document.getElementById('route-runs') };
    const lock = !gone && (view === 'schedule' || !!TITLES[view] && view !== 'chat') && lockHere(view, arg);   // nav.locked: every place, by the bar's own data
    const notLive = !gone && !lock && notLiveOf(view);
    // the live task page (D1, D15): loading until the list and the task's detail are in, failed with Try again, gone with Tasks
    const taskState = view === 'run' && !gone && !lock ? (LIVE ? liveTaskState(arg) : window.StillhetDemoState?.task || 'ready') : 'ready';   // the prototype's ?state=task-… shows the same looks
    const ownPage = !notLive && (!!placeMod(view) || view === 'run' || view === 'settings' || view === 'runs' || view === 'chat' || view === 'schedules' || view === 'schedule');
    pane.today.hidden = ownPage && !lock && taskState === 'ready'; pane.run.hidden = view !== 'run' || notLive || taskState !== 'ready'; pane.settings.hidden = view !== 'settings';
    pane.runs.hidden = view !== 'runs' || !!lock; pane.chat.hidden = view !== 'chat'; pane.schedule.hidden = !(view === 'schedule' || view === 'schedules') || !!lock; pane.place.hidden = !placeMod(view) || !!lock || notLive;
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : view === 'runs' ? 'view-runs' : view === 'chat' ? 'view-stillhet-chat' : view === 'schedule' || view === 'schedules' || placeMod(view) ? 'view-stillhet-chat' : '';
    if (gone) { for (const p of Object.values(pane)) p.hidden = p !== pane.today; document.body.className = ''; }
    if (view !== 'run') { taskChat = view === 'chat' ? taskChat : ''; openedTask = ''; shownTask = ''; }
    if (view !== 'run' || arg !== retryFocus || taskState === 'gone') retryFocus = '';
    routed = { view, arg, locked: !!lock };
    document.getElementById('topnav-title').textContent = pageTitle(view, arg);
    window.StillhetPulse?.show(view === 'settings' ? 'settings' : 'page', view === 'settings' ? arg || '' : '', view);   // first: it may give the sidebar back
    markNav(view);
    syncAsk(view);
    if (gone) {
      pane.today.innerHTML = `<div class="stillhet-locked">${R.notFound({ what: gone.what, name: gone.name, back: gone.back, attrs: { 'data-nav': gone.to } })}</div>`;
      scrollTo(0, 0);
    } else if (lock) {   // a deep link above the mode, or a place whose Labs feature is off: one line, and its one way on
      document.body.className = '';
      const name = lock.name || TITLES[view] || 'Schedules', need = lock.min ? lock.min[0].toUpperCase() + lock.min.slice(1) : '';
      pane.today.innerHTML = `<div class="stillhet-locked">${R.emptyState({ page: true, title: lock.min ? `${name} needs ${need}` : `${name} is in Labs`, actions: R.button({ label: lock.min ? `Switch to ${need}` : 'Turn on Labs', kind: 'quiet', attrs: { 'data-unlock': lock.min ? 'mode:' + lock.min : 'flag:' + lock.flag, 'data-to': view } }) })}</div>`;
      scrollTo(0, 0);
    } else if (taskState !== 'ready') {   // D15: the task page's loading, failed and gone looks (listState)
      document.body.className = 'view-place';
      const look = taskState === 'failed' ? R.listState({ state: 'failed', noun: 'task', title: 'Could not load this task', brief: true, retry: { 'data-task-retry': arg, 'data-key': 'task-retry' } })
        : taskState === 'gone' ? R.listState({ state: 'empty', noun: 'task', text: 'This task no longer exists', action: R.button({ label: 'Tasks', kind: 'quiet', attrs: { 'data-nav': 'runs', 'data-key': 'task-gone-tasks' } }) })
        : R.listState({ state: 'loading', noun: 'this task' });
      pane.today.innerHTML = `<div class="stillhet-locked">${R.placeHead({ title: liveTask.title || 'Task' })}${look}</div>`;
      if (retryFocus === arg && taskState === 'failed') pane.today.querySelector('[data-task-retry]')?.focus({ preventScroll: true });   // still failing: the new Try again
      scrollTo(0, 0);
    } else if (notLive) {   // nav.not-live: it says so and where it lives today, never an empty look; a task opened from a row keeps its live title
      document.body.className = 'view-place';
      const title = view === 'run' ? liveTask.title || 'Task' : TITLES[view];
      pane.today.innerHTML = `<div class="stillhet-locked">${R.placeHead({ title })}${R.notInStillhet({ place: TITLES[view], today: NOT_LIVE[view], attrs: { 'data-nav': 'chat' } })}</div>`;
      scrollTo(0, 0);
    } else if (!pane.today.hidden && SOON[view]) {   // nav.locked: a place not yet in Stillhet draws a true page, never a blank one, and the bar stays
      document.body.className = 'view-place';
      pane.today.innerHTML = `<div class="stillhet-locked">${R.emptyState({ title: SOON[view][0], text: SOON[view][1], actions: R.button({ label: 'Back to Chat', kind: 'quiet', attrs: { 'data-nav': 'chat' } }) })}</div>`;
      scrollTo(0, 0);
    } else if (!pane.today.hidden) {
      pane.today.innerHTML = `<div class="stillhet-locked">${R.notInStillhet({ place: TITLES[view] || 'This page', attrs: { 'data-nav': 'chat' } })}</div>`;
      scrollTo(0, 0);
    } else pane.today.innerHTML = '';
    if (view === 'chat') {
      window.StillhetChats?.show(arg || '');
      window.StillhetConversation?.show(arg || '');
      if (arg) { lastThing = { hash: `chat/${arg}`, title: window.StillhetConversation?.chatTitle(arg) || 'Chat', meta: 'Chat', when: 'now', mark: R.kindMark({ kind: 'chat' }) }; visited = [lastThing, ...visited.filter((v) => v.hash !== lastThing.hash).map((v) => ({ ...v, when: v.when === 'now' ? 'earlier' : v.when }))].slice(0, 6); }
    }
    if (view === 'runs') { window.StillhetRunsList?.show(); window.StillhetCenters?.tasks(pane.runs); }
    if (view === 'schedules' || view === 'schedule') window.StillhetSchedules?.show(view === 'schedule' ? arg : '');
    if (inChatBar(view) && !lock) window.StillhetChats?.show('');   // Simple: a schedule's page keeps Chat's bar
    if (placeMod(view) && !lock && !notLive) { const again = openedAgain && lastPlace === location.hash; placeMod(view).show({ bar: document.getElementById('bar-place'), page: pane.place, arg: decodeURIComponent(arg || '') }); if (again) R.land(pane.place.querySelector('.place-head')); }   /* the row you are on, opened again by you: its page's head lands; a flag or a redraw on the same address never flashes */
    lastPlace = placeMod(view) && !lock ? location.hash : ''; openedAgain = false;
    if (view === 'run' && !notLive) {
      window.StillhetShell.unembedRun();
      const pick = window.StillhetRunPage?.pick;
      // live: a store change on the task already shown redraws it keeping its own state (an open dialog, a confirm strip)
      if (LIVE && arg) { if (taskState === 'ready' && (reopen || shownTask !== arg)) { const same = shownTask === arg; reopen = false; shownTask = arg; window.StillhetRunPage?.openLive(arg, same); }
        if (taskState === 'ready' && retryFocus === arg) { retryFocus = ''; document.querySelector('#card [data-title]')?.focus({ preventScroll: true }); } }
      else if (pick && arg && (pick.value !== arg || reopen)) { reopen = false; pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      if (taskChat) window.StillhetChats?.show(taskChat); else window.StillhetRunsList?.show();
      // a task is the work, a chat is where you talk about it: the task page has no chat box
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
    if (taskChat && crumbs.length > 1) { const word = window.StillhetConversation?.chatTitle(taskChat) || 'Chat', last = crumbs[crumbs.length - 1]; if (last.textContent !== word) { last.textContent = word; last.title = word; } }
    const host = document.getElementById('task-timeline'), stages = [...document.querySelectorAll('#card .sc-stage')];
    if (!host) return;
    const sig = stages.map((b) => b.dataset.stage + b.getAttribute('aria-selected')).join();
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    host.innerHTML = stages.length > 1 ? R.timeline({ ticks: stages.map((b, i) => ({ id: b.dataset.stage, at: (i + 0.5) / stages.length, kind: 'work', tone: b.getAttribute('aria-selected') === 'true' ? 'run' : '', title: b.textContent.trim().replace(/\s+/g, ' ') })), view: [0, 0], label: 'Move through this task' }) : '';
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
  // small.words-at-source: nothing rewords drawn text; every word is written once, where it is drawn
  new MutationObserver(() => { if (routed.view === 'run') drawTaskParts(); }).observe(document.documentElement, { subtree: true, childList: true });

  // ---- clicks the shell owns: the sidebar's places, today's pages, a run row, the top bar's narrow controls, Ask worca ----
  const searchFold = (on) => { document.querySelector('#topnav .tsearch')?.classList.toggle('is-open', on); if (on) document.getElementById('tsearch-input')?.focus(); };
  document.addEventListener('click', (e) => {
    const on = (sel) => e.target.closest(sel);
    let hit;
    // D15: Try again on a task page that could not load; once it draws, focus goes to its heading
    if ((hit = on('[data-task-retry]')) && !LIVE) { window.StillhetDemoState.task = ''; route(); document.querySelector('#card [data-title]')?.focus({ preventScroll: true }); return; }
    // the page or the failed look may be drawn later, by the task's own change (a list read first): route() places the focus
    if ((hit = on('[data-task-retry]'))) { const id = hit.dataset.taskRetry; retryFocus = id; window.StillhetTaskLive?.open(id, { force: true }).then(() => { if (retryFocus === id) route(); }); return; }
    if ((hit = on('[data-in-view-drop]'))) { const [type, id] = hit.dataset.inViewDrop.split(':'), x = inViewList.find((y) => y.type === type && y.id === id); if (x) toggleInView(x); return; }
    if ((hit = on('[data-keep-view]'))) { toggleCaseInView(hit.dataset.keepView, document.querySelector('#card [data-title]')?.textContent); return; }
    if ((hit = on('[data-in-view]'))) { inViewMenu = false; const [type, ...ids] = hit.dataset.inView.split(':'), id = ids.join(':'), x = inViewList.find((y) => y.type === type && y.id === id), now = x && inViewNow(x); if (now?.task) window.StillhetShell.openTaskPage(now.task.cs, now.task.chat, now.task.title, now.task.run); else if (x?.type === 'schedule') window.StillhetShell.openSchedule(x.id); else if (now) window.StillhetShell.go(now.hash); return; }
    if (on('[data-in-view-more]')) { inViewMenu = !inViewMenu; drawInView(); return; }
    if ((hit = on('[data-mini]'))) { window.StillhetShell.go(hit.dataset.mini); return; }
    if (on('[data-pins-all]')) { pinsAll = true; drawBar(); return; }
    if (on('[data-bar-hide]')) { hideBar(); if (e.detail === 0) document.getElementById('bar-show')?.focus(); return; }   // by the keyboard: the focus goes to what brings the bar back
    if (on('[data-bar-pin]')) { setStrip(false); syncRail(); drawBar(); return; }
    if (on('#bar-show')) { setStrip(false); syncRail(); drawBar(); if (e.detail === 0) document.querySelector('[data-bar-hide]')?.focus(); return; }
    if ((hit = on('[data-skip]'))) { e.preventDefault(); focusHeading(); return; }   // key.skip-link
    if ((hit = on('.rl-search-res [data-menu-pick^="srch|"]')) && hit.dataset.menuPick !== 'srch|ask') { const at = location.hash; setTimeout(() => { if (location.hash !== at) focusHeading(); }, 80); }   // key.search: the page a result opened takes the focus, on its heading (pulse.js opens it)
    if (on('[data-bar-home]')) { quickNav = false; window.StillhetChats?.home(); homeNext = true; window.StillhetShell.go('chat'); return; }   /* nav.one-bar: the W alone goes home: the places, with Chat's home behind them */
    if ((hit = on('[data-menu-pick^="bar-go|"]'))) { const to = hit.dataset.menuPick.split('|')[1]; quickNav = false; drawer(false); homeOpen = false; if (location.hash.slice(1) !== to) location.hash = to; else drawBar(); document.querySelector('#bar-head [data-bar-house]')?.focus(); return; }
    if (on('[data-bar-house]')) { quickNav = !quickNav; drawBar(); const b = document.querySelector('#bar-head [data-bar-house]'); if (quickNav) (document.querySelector('#bar-head .bar-quick [aria-checked="true"]') || document.querySelector('#bar-head .bar-quick .menu-item'))?.focus(); else b?.focus(); return; }   // nav.place-button
    if (quickNav) { quickNav = false; drawBar(); }   /* a page with no list of its own (a locked place): closing the places goes back to Chat */
    if ((hit = on('[data-menu-pick^="bar-new|"]'))) { barMenu = false; drawBar(); makerOf(document.getElementById('side-rail').dataset.bar)?.newPick?.(hit.dataset.menuPick.split('|')[1]); return; }
    if (barMenu && !on('[data-bar-new]')) { barMenu = false; drawBar(); }
    if ((hit = on('[data-bar-new]'))) { const maker = makerOf(document.getElementById('side-rail').dataset.bar); if (hit.dataset.barNew === 'place' && maker?.newMenu) { barMenu = !barMenu; drawBar(); return; } if (hit.dataset.barNew === 'place') maker?.newAct?.(); else window.StillhetConversation?.start(hit.dataset.barNew); return; }
    if ((hit = on('[data-back-to]'))) { drawer(false); window.StillhetShell.go(hit.dataset.backTo); return; }
    if ((hit = on('#task-timeline [data-tick]'))) { document.querySelector(`#card .sc-stage[data-stage="${CSS.escape(hit.dataset.tick)}"]`)?.click(); return; }
    if ((hit = on('#side-rail nav.nav [data-nav]'))) { e.preventDefault(); drawer(false); if (location.hash.slice(1) === hit.dataset.nav) { homeOpen = false; drawBar(); } else location.hash = hit.dataset.nav; return; }
    if ((hit = on('[data-unlock]')) && on('#route-today')) { window.StillhetPulse?.unlock(hit.dataset.unlock, hit.dataset.to); return; }
    if (on('#side-toggle')) { setStrip(!isStrip()); syncRail(); return; }
    if (on('#mbar-menu')) { drawer(!document.body.classList.contains('nav-open')); return; }
    if (on('#side-close')) { drawer(false); return; }
    if (on('#tsearch-open')) { searchFold(true); return; }
    if (on('#tsearch-close')) { searchFold(false); return; }
    if (on('#topnav-ask')) { askHere(); return; }   // the page goes to Chat as a chip; on Chat it points to the box that asks
    // a control on a captured page says where it goes
    if ((hit = on('#route-today [data-nav]'))) {
      e.preventDefault();
      // §3: a gone task's Tasks button lands in the Tasks list (after the route has drawn it; the button itself is gone)
      if (hit.dataset.key === 'task-gone-tasks') addEventListener('hashchange', () => window.StillhetRunsList?.focusList(), { once: true });
      location.hash = hit.dataset.nav; return;
    }   // a not-yet place's way on
    if ((hit = on('#route-today a[href], #route-today button'))) {
      e.preventDefault();
      const name = (hit.getAttribute('aria-label') || hit.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
      window.StillhetPulse?.say(`${name ? name + ': ' : ''}on today's page, as captured; it does not act here`);
    }
  });
  // From a chat, the trail goes back to it.
  document.addEventListener('click', (e) => { if (taskChat && routed.view === 'run' && e.target.closest('#card .rc-crumbs .rc-crumb')) { e.preventDefault(); e.stopPropagation(); window.StillhetShell.back(); } }, true);
  // The bar's grip: a drag or the arrow keys, 240 to 420px, kept; a double-click goes back to the default.
  const BAR_W = 280, BAR_MIN = 264, BAR_SNAP = 200, KEY_BAR = 'worca-stillhet.bar.width', clampBar = (px) => Math.min(420, Math.max(BAR_MIN, Math.round(+px) || BAR_W));
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
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\' && innerWidth > 760) { e.preventDefault(); if (isStrip()) { setStrip(false); syncRail(); drawBar(); } else hideBar(); }
  });
  // a disabled menu item says why (comp.menu-off); on a strip's icon the strip stays, so the icon can be clicked: anywhere else on it, it opens
  document.addEventListener('stillhet:disabled', (e) => { if (e.detail?.why) window.StillhetPulse?.say(e.detail.why); });
  let iconRest = false;
  document.addEventListener('pointerover', (e) => {
    const side = document.getElementById('side-rail'), on = !!e.target.closest?.('.bar-strip-i');
    if (on && side.classList.contains('is-strip') && !side.classList.contains('is-resting')) { iconRest = true; side.classList.add('is-resting'); }
    else if (!on && iconRest) { iconRest = false; side.classList.remove('is-resting'); }
  });
  // The prototype's corner: what the connection does, and the screensaver.
  let conn = 'ok';
  const setConn = (v) => {
    const was = conn; conn = v;
    document.getElementById('stillhet-conn').innerHTML = conn === 'offline' ? R.offlineLine() : '';
    window.StillhetPulse?.session(conn === 'session');
    if (was === 'offline' && conn !== 'offline') window.StillhetPulse?.say('Back online');
  };
  document.getElementById('conn')?.addEventListener('change', (e) => setConn(e.target.value));
  document.getElementById('play-away')?.addEventListener('click', () => window.StillhetPulse?.playAway());
  document.getElementById('person')?.addEventListener('change', (e) => window.StillhetPulse?.person(e.target.value));

  window.StillhetShell = {
    // Every address the shell opens, from the code (tools/stillhet-compare.mjs reads it): the sidebar's places and Pulse, then
    // each task case, chat, schedule, Settings section and every item a place lists. Sorted, each once.
    routes: () => {
      const val = (x) => (typeof x === 'function' ? x() : x) || [];
      return [...new Set([
        ...PLACES.flatMap(([, items]) => items.map(([id]) => id)), 'pulse',
        ...(window.RunCardModel?.cases || []).map((c) => `run/${c.id}`),
        ...(val(window.StillhetChats?.data).chats || []).map((c) => `chat/${c.id}`),
        ...val(window.StillhetSchedules?.all).map((x) => `schedule/${x.id}`),
        ...Object.keys(window.SettingsModel?.SECTIONS || {}).map((k) => `settings/${k}`),
        ...Object.values(window.StillhetPlaces || {}).flatMap((m) => (m.search ? m.search('').map((x) => x.hash) : [])),
      ])].sort();
    },
    // nav.stillhet-ask: the Invitation under the top bar while the address says ?invite=stillhet and the demo has not answered
    // F-G-G5-01: live, `stillhet` is on, and the opt-in rule (ui/public/stillhet.mjs shouldAskStillhet) never asks while it is on:
    // the real question, its Labs flag write and its stillhetAsked answer, is today's app's (mountStillhetAsk), never this demo strip
    inviteStrip: () => (!LIVE && new URLSearchParams(location.search).get('invite') === 'stillhet' && !store.get('worca-stillhet.stillhetAsked') && !inviteBack ? R.stillhetInvitation({ bugsUrl: 'https://github.com/' }) : ''),
    answerInvite: (answer) => { if (LIVE) return; if (answer === 'yes' || answer === 'no') store.set('worca-stillhet.stillhetAsked', '1'); else inviteBack = true; },
    // which script answers a click or a key: the run page owns #card and its tools; Pulse owns the rest of the Stillhet pieces
    owns: (who, target) => {
      if (!target?.isConnected) return false;   // a list page already answered it, and drew again
      const inRun = !!target?.closest?.('#card, [data-run-tools]');
      // today's pages and the sidebar's places are the shell's own: neither the run page nor Pulse answers there
      const inShell = !!target?.closest?.('#in-view-slot, #bar-back, #route-today, #route-runs, #route-chat, #route-schedule, #route-place, #bar-place, #task-timeline, #side-rail nav.nav, #bar-head, #bar-chat, #bar-tasks, #bar-schedules');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    taskGone: (cs, title) => { const r = window.StillhetWorld.rows().find((x) => x.case === cs && x.title === title); if (r) window.StillhetWorld.remove(r.id); },
    pageContext: () => pageContext(),
    needs: (view) => needsOf(view),
    locked: (view) => !!lockOf(view),
    // levels.offers: may this mode be offered a way to this place or form? One table (the bar's own data-min-level and
    // Labs flags): 'schedules', 'insights', 'marketplace'…; a form that makes a thing is offered when its thing can be shown
    offers: (what) => (what === 'schedule' || what === 'schedule-form' || what === 'task' || what === 'task-form' ? true : !lockOf(what)),
    go: (hash) => { if (hash === NEW_TASK) { window.StillhetConversation?.handOver({ mode: 'task', ph: 'What should the task do?' }); return; } if (location.hash.slice(1) === hash) { openedAgain = true; route(); } else location.hash = hash; },
    // a task opened from Pulse or the search carries its own title
    openRun: (hash, title, run) => window.StillhetShell.openTaskPage(hash.split('/')[1], '', title, run),   // nav.row-opens-page: its own page
    taskChat: () => taskChat,   // the chat the open task page was reached from ('' from Tasks): the Chat bar marks that row
    closeSearch: () => searchFold(false),
    // D21: a mode a person picks is dev's uiLevel, posted first; a refusal stays on the level the server last confirmed
    pickMode: (to) => window.StillhetAdapter.post('/api/settings', { uiLevel: to }).then((r) => {
      if (r.ok) confirmedMode = R.MODES.includes(r.data?.uiLevel) ? r.data.uiLevel : to;
      R.prefs.setMode(confirmedMode);
      return r;
    }),
    connReset: () => { const sel = document.getElementById('conn'); if (sel) sel.value = 'ok'; conn = 'ok'; document.getElementById('stillhet-conn').innerHTML = ''; },
    closeDrawer: () => drawer(false),
    inView: { toggle: toggleInView, has: isInView, draw: () => drawInView() },
    // A task's own page is openTaskPage (nav.row-opens-page): every row, tab and link opens that. openTask is the way to its
    // chat ("Open its chat"): its chat at its card; in the demo a task with no chat gets one, named after it.
    openTask: (cs, chat, title, run) => {
      if (LIVE) {   // the live kind: no chat made up around it (D23); opening it acknowledges it, as dev's acknowledgeRun does from any path
        if (run) window.StillhetAdapter.seenRun(run);
        const cid = run ? chat || window.StillhetConversation?.chatOfTask({ run }) : '';   // a task with a starting chat opens there, at its card
        if (cid) { window.StillhetConversation.openTask(cid, run); return; }
        window.StillhetShell.openTaskPage(cs, chat, title, run); return;
      }
      if (RM && title) RM.titles[cs] = title;
      const w = run && window.StillhetWorld?.find(run);
      // the chat a row names wins; else the chat that holds this very task (by its run, else its name); a case alone is shared by many
      let cid = chat || window.StillhetConversation?.chatOfTask({ run, title }) || (!title && !run ? window.StillhetConversation?.chatOfCase(cs) : '') || '';
      if (!cid && window.StillhetChats) {
        const name = title || RM?.titles?.[cs] || 'A task', st = RM?.stageOf?.(cs) || {};
        cid = window.StillhetChats.newChat(name, w?.project || '', { fromTask: true, tasks: [{ id: `t-${run || cs}`, run: run || '', title: name, case: cs, stage: st.stage ?? 0, detail: w?.detail || st.label || '', branch: '' }] });
        window.StillhetChats.refresh();
        window.StillhetPulse?.say(`Opened in a new chat: ${name}`);   // a chat that appears by itself says so
      }
      if (!cid) { window.StillhetShell.openTaskPage(cs, chat, title); return; }
      window.StillhetShell.go(`chat/${cid}`);
      requestAnimationFrame(() => requestAnimationFrame(() => window.StillhetConversation?.focus({ cs, title })));
    },
    // A card opened in place borrows the task page itself (#card), so every stage, part and control works as on the page.
    embedRun: (slot, cs, ask) => {
      const card = document.getElementById('card'), pick = window.StillhetRunPage?.pick; if (!card || !slot) return;
      if (RM) { RM.asks = RM.asks || {}; RM.branches = RM.branches || {}; if (ask) { RM.asks[cs] = ask; RM.titles[cs] = ask; } const t = ask && findTask(ask); if (t?.branch) RM.branches[cs] = t.branch; if (t) { RM.asks[cs] = t.ask || t.title; RM.whys = RM.whys || {}; RM.whys[cs] = t.why || null; } }   // the lent page is this task's: its name and what it was asked   // the lent page says what this task was asked, not its mock's words
      if (!runAnchor) { runAnchor = document.createComment('the task page lives here'); card.before(runAnchor); }
      const lent = `${cs}|${ask || ''}`, again = lent !== lastLent; lastLent = lent;
      if (pick && (pick.value !== cs || again)) { /* drawn again for this task even when another task shares its case */ const at = location.hash; pick.value = cs; pick.dispatchEvent(new Event('change', { bubbles: true })); if (location.hash !== at) history.replaceState(null, '', at); }
      slot.append(card); card.classList.add('is-lent');
    },
    unembedRun: (from) => { const card = document.getElementById('card'); if (card && runAnchor && (!from || from.contains(card))) { runAnchor.after(card); card.classList.remove('is-lent'); } },
    // the live kind opens a task by its own id (pipeline or run id), never a case; a live call with no id has no page to open
    openTaskPage: (cs, chat, title, run) => { if (LIVE && /^group:/.test(cs)) run = cs;   /* a live group's page is its own id */ if (LIVE && !run) { window.StillhetShell.go('runs'); window.StillhetPulse?.say('This task has no page to open'); return; } liveTask = { title: title || '' }; const t = title && findTask(title); if (RM && t?.branch) { RM.branches = RM.branches || {}; RM.branches[cs] = t.branch; } if (RM && t) { RM.asks = RM.asks || {}; RM.asks[cs] = t.ask || t.title; RM.whys = RM.whys || {}; RM.whys[cs] = t.why || null; }   /* the page says what this task was asked and what broke in it, never its mock's */ taskChat = chat || ''; if (RM && title) RM.titles[cs] = title; reopen = true; window.StillhetShell.go(`run/${LIVE ? run : cs}`); },
    openSchedule: (sid) => window.StillhetShell.go(`schedule/${sid}`),   // nav.row-opens-page: a schedule opens its own page, in every mode
    back: () => window.StillhetShell.go(taskChat ? `chat/${taskChat}` : 'runs'),
    // the list pages take their own `?`, with their own actions in the sheet
    listKeys: () => routed.view === 'runs' || routed.view === 'chat' || routed.view === 'schedule' || routed.view === 'schedules',
  };
  const RM = window.RunCardModel;
  const NEW_TASK = '~new-task';   // an address-shaped name for starting a task in Chat: what a search result for classic's "New run" opens
  // key.skip-link, key.search: the focus lands on the page's heading (the first one showing), else on the page itself
  function focusHeading() {
    const main = document.getElementById('main-content');
    const h = [...(main?.querySelectorAll('h1, .place-title, [data-title], .rc-title, h2') || [])].find((x) => x.getClientRects().length && !x.closest('[hidden]')) || main;
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: h === main });
  }
  // a task by its name, in the chats' store copy: its branch for its page (the page shows this task, not its case's fixture)
  const findTask = (title) => { for (const c of window.StillhetChats?.data().chats || []) { const w = (l) => { for (const t of l || []) { if (t.title === title) return t; const f = w(t.after); if (f) return f; } return null; }; const t = w(c.tasks); if (t) return t; } return null; };
  let lastLent = '';
  let runAnchor = null;
  let routed = { view: '', locked: false };
  R.neverOutside(document, '.mk-tools');   // the prototype's own corner closes nothing
  // the drawer and the narrow search close on a click outside or Esc (docs/stillhet/panels.md)
  R.dismissOnOutside(document, { open: () => quickNav, inside: '#bar-head', back: () => '[data-bar-house]', close: () => { quickNav = false; }, paint: () => drawBar() });
  R.dismissOnOutside(document, { open: () => barMenu, inside: '#bar-head', back: () => '[data-bar-new]', close: () => { barMenu = false; }, paint: () => drawBar() });
  R.dismissOnOutside(document, { open: () => inViewMenu, inside: '#in-view-slot', back: () => '[data-in-view-more]', close: () => { inViewMenu = false; }, paint: () => drawInView() });
  R.dismissOnOutside(document, { open: () => document.body.classList.contains('nav-open'), inside: '#side-rail, #mbar-menu', back: () => '#mbar-menu', close: () => drawer(false), paint: () => {} });
  R.dismissOnOutside(document, { open: () => !!document.querySelector('#topnav .tsearch.is-open'), inside: '.tsearch, #tsearch-open', back: () => '#tsearch-open', close: () => searchFold(false), paint: () => {} });
  build();
  setBarW(barW);
  for (const t of ['pointerenter', 'pointerleave']) document.getElementById('side-rail').addEventListener(t, barInert);
  R.watchDiffFind(document);   // thing.diff-find: the Find field of a diff
  R.watchSearch(document);   // key.search: the arrows reach the results, the field says when they show
  R.watchClickGuard(document); R.watchOrbs(document); R.watchTooltips(document); R.watchMenus(document); R.watchStrips(document); R.watchScrollFades(document); R.watchFolds(document); R.watchStageAdvance(document);
  // The live kind: dev's uiLevel, as the server stamped it (data-level), and nothing posted at start (D21). The demo: a new
  // person starts in Simple; the mode they pick is remembered (docs/ui-levels.md)
  let confirmedMode = '';
  if (LIVE) { const m = document.documentElement.dataset.level; confirmedMode = R.MODES.includes(m) ? m : 'simple'; R.prefs.setMode(confirmedMode); }
  else try { const m = localStorage.getItem('worca-stillhet.mode'); R.prefs.setMode(R.MODES.includes(m) ? m : 'simple'); } catch { R.prefs.setMode('simple'); }
  applyPrefs(); drawMini();   /* the sidebar drew before the mode was read: it shows only the places this mode has */
  if (!LIVE) R.prefs.onChange(() => { try { localStorage.setItem('worca-stillhet.mode', R.prefs.mode()); } catch { /* remembering is a nicety */ } });
  let wasStrip = isStrip();
  addEventListener('resize', () => { syncRail(); if (isStrip() !== wasStrip) { wasStrip = isStrip(); drawMini(); drawBar(); } });
  // A change of mode or a Labs flag: the sidebar follows, and the page if that changes whether it is locked.
  R.prefs.onChange(() => { applyPrefs(); drawMini(); if (routed.view && (TITLES[routed.view] || routed.view === 'schedule') && !!lockHere(routed.view, routed.arg) !== routed.locked) route(); else if (routed.view) drawBar(); });
  addEventListener('hashchange', route);
  // key.search: Esc on the empty search field leaves it for the page (its heading), so the single-key shortcuts (? and the
  // rest) work again right after a search; Esc with words in it clears them first (the field's own answer)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !e.target.matches?.('[data-search]')) return;
    const field = e.target, was = field.value;
    setTimeout(() => { if (document.activeElement === field && !was && !field.value) focusHeading(); }, 0);
  });
  // key.page-heading: a page change never leaves the focus on nothing. Once the new page is drawn, the focus lands on its
  // heading, unless it is still somewhere that goes on (a bar's list you are walking, a field you are typing in, a dialog).
  let pageWas = location.hash.split('@')[0];
  addEventListener('hashchange', () => {
    const now = location.hash.split('@')[0]; if (now === pageWas) return; pageWas = now;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected && a.getClientRects().length && a.closest('.bar-list, textarea, input, select, [contenteditable="true"], .viewer-modal, [role="dialog"], .menu, #main-content')) return;
      focusHeading();
    }, 120);
  });
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); askHere(); } });   // ⌘J: this page, to Chat
  // another Pulse case: the run page in view takes its title from it
  window.StillhetWorld.onChange(() => { drawInView(); if (routed.view === 'run') { reopen = true; route(); } });
  // the live kind (D20): the connection and the strip follow every load and list change; a task frame repaints the strip
  if (LIVE) {
    // after the lists have read the store again (they listen later): the strip counts their rows
    const later = (fn) => setTimeout(fn, 0);
    window.StillhetWorld.onChange(() => { setConn(window.StillhetDemoState?.conn || 'ok'); later(() => { if (routed.view) drawBar(); else drawMini(); }); });
    window.StillhetWorld.onChange(() => { if (!schedWaits || window.StillhetDemoState?.list === 'loading') return; schedWaits = false; later(() => { if (routed.view === 'schedule') route(); }); });   // F-G-fid-01: the list is in: the page, or gone
    window.StillhetWorld.onMove(() => later(drawMini));
  }
  // a step taken on a task's page moves the task everywhere: its row, the bar's and Pulse's counts, In view
  document.addEventListener('stillhet:task-moved', (e) => {
    const { from, to, title } = e.detail || {}; if (!title) return;
    const r = window.StillhetWorld.rows().find((x) => x.case === from && x.title === title);
    if (r) window.StillhetWorld.move(r.id, to, R.runState(RM.stateOf(to)).word);
    if (routed.view === 'run') { for (const c of window.StillhetChats?.data().chats || []) for (const t of allTasksOf(c)) if (t.case === from && t.title === title) { t.case = to; t.detail = ''; const st = RM.stageOf?.(to); if (st?.stage >= 0) t.stage = st.stage; /* one store: answered on its page, its chat no longer waits on you */ const needs = (y) => { try { return R.sectionOf(R.runState(RM.stateOf(y.case)).word, RM.stateOf(y.case)) === 'needs'; } catch { return false; } }; if (c.state === 'needs-you' && !allTasksOf(c).some(needs)) c.state = 'idle'; } window.StillhetChats?.refresh(); }   /* lent to a card, its chat does this itself */
    for (const x of inViewList) if (x.case === from && x.title === title) x.case = to;
    RM.titles[to] = title;   // the store names a state after its first task: this page stays this task
    drawBar();
  });
  /* the places have registered by now: the first bar shows them; Pulse has loaded, so ?state=connection-lost or session-expired (world.js) can show */
  window.StillhetShell.start = () => { applyPrefs(); drawMini(); route(); if (window.StillhetDemoState?.conn) setConn(window.StillhetDemoState.conn); };
})();
