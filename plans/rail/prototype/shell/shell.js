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
  const TITLES = { chat: 'Chat', runs: 'Runs', schedules: 'Schedules', stats: 'Statistics', 'team-metrics': 'Team metrics', workflows: 'Workflows',
    requirements: 'Requirements', projects: 'Projects', workspaces: 'Workspaces', marketplace: 'Marketplace' };
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ---- the sidebar: places only (a setting or a place, docs/rail/settings.md) ----
  function sidebar() {
    const side = el(T.sidebar);
    const nav = side.querySelector('nav.nav');
    // Connectors, Models, Providers and Team policy are Settings now; the Marketplace store stays a place, under Build.
    for (const v of ['connectors', 'models', 'providers', 'team-policy']) nav.querySelector(`[data-nav="${v}"]`)?.remove();
    const market = nav.querySelector('[data-nav="marketplace"]'), req = nav.querySelector('[data-nav="requirements"]');
    if (market && req) req.after(market);
    for (const s of nav.querySelectorAll('.nav-sect')) if (/Add-ons/.test(s.textContent)) s.remove();
    // a place's icon is the library's, at the set's one line weight
    for (const b of nav.querySelectorAll('button[data-nav]')) { const i = R.icon('nav-' + b.dataset.nav, 16); if (i) b.querySelector('svg')?.replaceWith(el(i)); }
    side.querySelector('#acct-menu')?.remove();   // the Rail profile menu takes its place (pulse.js)
    // the needs-you count lives only on Pulse's badge
    nav.querySelector('#nav-needs-count')?.remove(); nav.querySelector('#nav-running-count')?.remove();
    side.querySelector('#side-foot').innerHTML = '';   // the avatar: pulse.js draws it
    return side;
  }
  // What a place needs: the sidebar's own data-min-level and data-flag, as the app's sidebar.html has them.
  const needsOf = (view) => { const b = document.querySelector(`#side-rail nav.nav > button[data-nav="${view}"]`); return b ? { min: b.dataset.minLevel || '', flag: b.dataset.flag || '' } : {}; };
  const lockOf = (view) => { const n = needsOf(view); return !R.shows(n.min) ? { min: n.min } : n.flag && !R.prefs.flag(n.flag) ? { flag: n.flag } : null; };
  // The sidebar draws again when the interface mode or a Labs flag changes; a section with nothing left goes too.
  function applyPrefs() {
    const nav = document.querySelector('#side-rail nav.nav');
    for (const b of nav.querySelectorAll(':scope > button[data-nav]')) b.hidden = !!lockOf(b.dataset.nav);
    let sect = null, any = 0;
    const close = () => { if (sect) sect.hidden = any < 2; };   // a head over one row says nothing: it goes, the row stays
    for (const x of nav.children) {
      if (x.matches('.nav-sect')) { close(); sect = x; any = 0; } else if (x.matches('button') && !x.hidden) any++;
    }
    close();
  }
  // ---- the top bar: Pulse in Activity's place; the search, New run and the profile open the Rail pieces ----
  function topBar() {
    const top = el(T.topBar);
    top.querySelector('#activity-pop')?.remove();
    const act = top.querySelector('#topnav-activity');
    if (act) act.replaceWith(el('<span id="rail-pulse-slot"></span>'));
    top.querySelector('#topnav-new')?.setAttribute('data-newrun', '');
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
    const w = innerWidth, side = document.getElementById('side-rail'), rail = w <= 760 ? false : w <= 1080 ? true : collapsed;
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
    side.innerHTML = R.sideColumn({ title: 'Ask worca', width: askW, close: R.icon('x', 14), body: `<div class="rail-ask-body">${T.pages.chat.html}</div>`, hooks: { close: { 'data-ask-close': '' } } });
    side.querySelector('section.view')?.classList.add('active');
    side.querySelector('.chat-page')?.setAttribute('data-host', 'dock');
    // as the app does: the composer sits in the dock, and the column's own Close replaces the capture's
    const dock = side.querySelector('[data-chat-dock]'), composer = side.querySelector('.ask-composer');
    if (dock && composer) dock.append(composer);
    // the column's head already says Ask worca: the capture's empty state does not say it again
    side.querySelectorAll('.rl-side-body h1, .rl-side-body h2, .rl-side-body h3').forEach((h) => { if (h.textContent.trim() === 'Ask worca') h.remove(); });
    side.querySelectorAll('.ask-side-btn').forEach((b) => { if (/hide|close/i.test(b.getAttribute('aria-label') || b.title || '')) b.remove(); });
  }
  function syncAsk(view) {
    const side = document.getElementById('ask-side'), btn = document.getElementById('topnav-ask');
    if (btn) { btn.hidden = view === 'chat'; btn.setAttribute('aria-expanded', String(askOpen)); }
    const show = askOpen && view !== 'chat';
    if (show && side.hidden) { if (!side.firstChild) drawAsk(side); side.classList.add('is-in'); setTimeout(() => side.classList.remove('is-in'), 300); }
    side.hidden = !show;
    document.body.classList.toggle('ask-side-open', show);
  }

  function build() {
    const app = document.getElementById('worca');
    app.innerHTML = '';
    const col = el('<div class="main-col"></div>');
    col.append(topBar(), el('<div id="rail-strip"></div>'), el('<div id="main-row" class="main-row"><aside id="chats-col" class="ask-side chats-side" aria-label="Chats" hidden></aside><main class="main"><div id="route-today"></div><div id="route-runs" class="pz-app rail-page" hidden><div id="runs-root"></div></div><div id="route-run" class="rc-board" hidden><div id="card"></div></div><div id="route-settings" class="pz-app rail-page" hidden></div></main><aside id="ask-side" class="ask-side" aria-label="Ask worca" hidden></aside></div>'));
    app.append(el('<div class="nav-scrim" id="nav-scrim" hidden></div>'), sidebar(), col);
    syncRail(); applyPrefs();
  }

  // the current place, marked in the sidebar
  function markNav(view) {
    for (const b of document.querySelectorAll('#side-rail nav.nav [data-nav]')) {
      const on = b.dataset.nav === (view === 'run' ? 'runs' : view);
      b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  // ---- the Chats column: beside the conversation; narrow, it takes the window until a chat opens ----
  let chatArg = '', runsY = 0;
  function chats(onChat = routed.view === 'chat' && !routed.locked) {
    const col = document.getElementById('chats-col'); if (!col) return;
    const opened = onChat && window.RailChats ? window.RailChats.show(chatArg) : false;
    const narrow = innerWidth <= 760;
    col.hidden = !onChat || !opened || (narrow && !!chatArg);
    document.body.classList.toggle('chats-window', onChat && !col.hidden && narrow);
  }

  // ---- the router ----
  let reopen = false;   // a run opened from a row draws again, even on the same case: two rows can share one
  function route() {
    const [kind, arg] = (location.hash.slice(1) || 'runs').split('/');
    const view = TITLES[kind] ? kind : kind === 'run' || kind === 'settings' ? kind : 'runs';
    drawer(false);
    const today = document.getElementById('route-today'), run = document.getElementById('route-run'), settings = document.getElementById('route-settings');
    const main = document.querySelector('.main'), list = document.getElementById('route-runs');
    if (routed.view === 'runs') runsY = main.scrollTop;   // coming back restores the scroll
    today.hidden = view === 'run' || view === 'settings' || view === 'runs'; run.hidden = view !== 'run'; settings.hidden = view !== 'settings'; list.hidden = view !== 'runs';
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : view === 'runs' ? 'view-runs' : (T.pages[view]?.body || '');
    document.getElementById('topnav-title').textContent = view === 'run' ? 'Runs' : view === 'settings' ? 'Settings' : TITLES[view];
    window.RailPulse?.show(view === 'settings' ? 'settings' : 'page', view === 'settings' ? arg || '' : '', view);   // first: it may give the sidebar back
    markNav(view);
    syncAsk(view);
    const lock = !today.hidden && lockOf(view);
    routed = { view, locked: !!lock };
    if (lock) {   // a deep link above the mode, or a place whose Labs feature is off: one line, and its one way on
      document.body.className = '';
      const name = TITLES[view], need = lock.min ? lock.min[0].toUpperCase() + lock.min.slice(1) : '';
      today.innerHTML = `<div class="rail-locked">${R.emptyState({ title: lock.min ? `${name} needs ${need}` : `${name} is in Labs`, actions: R.button({ label: lock.min ? `Switch to ${need}` : 'Turn on Labs', kind: 'quiet', attrs: { 'data-unlock': lock.min ? 'mode:' + lock.min : 'flag:' + lock.flag, 'data-to': view } }) })}</div>`;
      scrollTo(0, 0);
    } else if (!today.hidden) {
      today.innerHTML = T.pages[view].html;
      scrollTo(0, 0);
    }
    chatArg = view === 'chat' ? arg || '' : '';
    chats(view === 'chat' && !lock);
    if (view === 'runs') { window.RailRunsList?.show(); main.scrollTop = runsY; window.RailRunsList?.focus(); }
    if (view === 'run') {
      const pick = document.getElementById('case');
      if (pick && arg && (pick.value !== arg || reopen)) { reopen = false; pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      scrollTo(0, 0);
    }
  }

  // ---- clicks the shell owns: the sidebar's places, today's pages, a run row, the top bar's narrow controls, Ask worca ----
  const searchFold = (on) => { document.querySelector('#topnav .tsearch')?.classList.toggle('is-open', on); if (on) document.getElementById('tsearch-input')?.focus(); };
  document.addEventListener('click', (e) => {
    const on = (sel) => e.target.closest(sel);
    let hit;
    if ((hit = on('#side-rail nav.nav [data-nav]'))) { e.preventDefault(); drawer(false); location.hash = hit.dataset.nav; return; }
    // Chat's own head, on the capture: the list's toggle and New chat are real
    if (on('#route-today .chat-history-toggle')) { e.preventDefault(); if (innerWidth <= 760) location.hash = 'chat'; else window.RailChats?.toggle(); return; }
    if (on('#route-today [data-ask-new-btn], #route-today .chat-new-plus')) { e.preventDefault(); window.RailChats?.newChat(); return; }
    if ((hit = on('#side-rail .logo, #side-rail .logo-mark'))) { e.preventDefault(); drawer(false); location.hash = 'chat'; return; }
    if ((hit = on('[data-unlock]')) && on('#route-today')) { window.RailPulse?.unlock(hit.dataset.unlock, hit.dataset.to); return; }
    if (on('#side-toggle')) { collapsed = !collapsed; store.set(KEY_RAIL, collapsed ? '1' : '0'); syncRail(); return; }
    if (on('#mbar-menu')) { drawer(!document.body.classList.contains('nav-open')); return; }
    if (on('#side-close')) { drawer(false); return; }
    if (on('#tsearch-open')) { searchFold(true); return; }
    if (on('#tsearch-close')) { searchFold(false); return; }
    if (on('#topnav-ask')) { askOpen = !askOpen; syncAsk(routed.view); return; }
    if (on('[data-ask-close]')) { askOpen = false; syncAsk(routed.view); document.getElementById('topnav-ask')?.focus(); return; }
    // a control on a captured page says where it goes
    if ((hit = on('#route-today a[href], #route-today button, #ask-side a[href], #ask-side button'))) {
      e.preventDefault();
      const name = (hit.getAttribute('aria-label') || hit.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
      window.RailPulse?.say(`${name ? name + ': ' : ''}on today's page, as captured; it does not act here`);
    }
  });
  // The column's grip: a drag, or the arrow keys, 20px a step.
  let drag = false;
  document.addEventListener('pointerdown', (e) => { const g = e.target.closest?.('#ask-side .ask-side-grip'); if (g) { drag = true; e.preventDefault(); document.getElementById('ask-side').classList.add('is-resizing'); } });
  document.addEventListener('pointermove', (e) => { if (drag) setAskW(innerWidth - e.clientX); });
  document.addEventListener('pointerup', () => { if (drag) { drag = false; document.getElementById('ask-side').classList.remove('is-resizing'); } });
  document.addEventListener('keydown', (e) => {
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
      const inShell = !!target?.closest?.('#route-today, #route-runs, #chats-col, #side-rail nav.nav, #ask-side');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    go: (hash) => { if (location.hash.slice(1) === hash) route(); else location.hash = hash; },
    // a run opened from Pulse or the search carries its own title
    openRun: (hash, title) => { const c = hash.split('/')[1]; if (RM && title) RM.titles[c] = title; reopen = true; window.RailShell.go(hash); },
    closeSearch: () => searchFold(false),
    connReset: () => { const sel = document.getElementById('conn'); if (sel) sel.value = 'ok'; conn = 'ok'; document.getElementById('rail-conn').innerHTML = ''; },
    closeDrawer: () => drawer(false),
    chats: () => chats(),
    // the list pages take their own `?`, with their own actions in the sheet
    listKeys: () => routed.view === 'runs' || routed.view === 'chat',
  };
  const RM = window.RunCardModel;
  let routed = { view: '', locked: false };
  R.neverOutside(document, '.mk-tools');   // the prototype's own corner closes nothing
  // the drawer and the narrow search close on a click outside or Esc (docs/rail/panels.md)
  R.dismissOnOutside(document, { open: () => document.body.classList.contains('nav-open'), inside: '#side-rail, #mbar-menu', back: () => '#mbar-menu', close: () => drawer(false), paint: () => {} });
  R.dismissOnOutside(document, { open: () => !!document.querySelector('#topnav .tsearch.is-open'), inside: '.tsearch, #tsearch-open', back: () => '#tsearch-open', close: () => searchFold(false), paint: () => {} });
  build();
  setAskW(askW);
  addEventListener('resize', () => { syncRail(); chats(); });
  // A change of mode or a Labs flag: the sidebar follows, and the page if that changes whether it is locked.
  R.prefs.onChange(() => { applyPrefs(); if (routed.view && TITLES[routed.view] && !!lockOf(routed.view) !== routed.locked) route(); });
  addEventListener('hashchange', route);
  // another Pulse case: the run page in view takes its title from it
  window.RailWorld.onChange(() => { if (routed.view === 'run') { reopen = true; route(); } });
  window.RailShell.start = route;
})();
