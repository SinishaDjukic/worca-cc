// The one Worca's shell: today's sidebar and top bar (today/, captured from the app), with Wave 1's decisions applied,
// and a router over the pages. A place opens from the sidebar; today's pages show as captured, in the Rail colours; a
// run opens as a full page (the Rail run page); Settings opens from the profile menu (the Rail Settings).
//   #<view>            a place: chat, runs, schedules, stats, team-metrics, workflows, requirements, projects,
//                      workspaces, marketplace (today's pages)
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
  // Today's runs, opened as the Rail run page on the case that shows them best.
  const RUN_CASE = { 'Add CSV export to billing': 'question', 'Migrate cron parser': 'gate', 'Fix flaky login test': 'working', 'Rename settings keys': 'checks', 'Unified page navigation': 'ready' };
  const RUN_DOT = { question: 'is-amber', gate: 'is-amber', working: 'is-peach is-pulse', checks: 'is-peach', ready: 'is-green' };
  const word = (id) => window.RailUI.runState(id).word;
  const RUN_LINE = { question: `${word('question')} · Plan asks 2 questions`, gate: `${word('gate')} · Review gate`, working: `${word('working')} · Build`, checks: `${word('checks')} · checks running`, ready: `${word('ready')} · checks pass` };
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
    side.querySelector('#acct-menu')?.remove();   // the Rail profile menu takes its place (pulse.js)
    // the needs-you count lives only on Pulse's badge
    nav.querySelector('#nav-needs-count')?.remove(); nav.querySelector('#nav-running-count')?.remove();
    side.querySelector('#side-foot').innerHTML = '';   // Running actions, Update available and the avatar: pulse.js draws them
    return side;
  }
  // What a place needs: the sidebar's own data-min-level and data-flag, as the app's sidebar.html has them.
  const needsOf = (view) => { const b = document.querySelector(`#side-rail nav.nav > button[data-nav="${view}"]`); return b ? { min: b.dataset.minLevel || '', flag: b.dataset.flag || '' } : {}; };
  const lockOf = (view) => { const n = needsOf(view); return !R.shows(n.min) ? { min: n.min } : n.flag && !R.prefs.flag(n.flag) ? { flag: n.flag } : null; };
  // The sidebar draws again when the interface mode or a Labs flag changes; a section with nothing left goes too.
  function applyPrefs() {
    const nav = document.querySelector('#side-rail nav.nav');
    for (const b of nav.querySelectorAll(':scope > button[data-nav]')) b.hidden = !!lockOf(b.dataset.nav);
    let sect = null, any = false;
    const close = () => { if (sect) sect.hidden = !any; };
    for (const x of nav.children) {
      if (x.matches('.nav-sect')) { close(); sect = x; any = false; } else if (x.matches('button') && !x.hidden) any = true;
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
    col.append(topBar(), el('<div id="rail-strip"></div>'), el('<div id="main-row" class="main-row"><main class="main"><div id="route-today"></div><div id="route-run" class="rc-board" hidden><div id="card"></div></div><div id="route-settings" class="pz-app rail-page" hidden></div></main><aside id="ask-side" class="ask-side" aria-label="Ask worca" hidden></aside></div>'));
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

  // ---- the router ----
  function route() {
    const [kind, arg] = (location.hash.slice(1) || 'runs').split('/');
    const view = TITLES[kind] ? kind : kind === 'run' || kind === 'settings' ? kind : 'runs';
    drawer(false);
    const today = document.getElementById('route-today'), run = document.getElementById('route-run'), settings = document.getElementById('route-settings');
    today.hidden = view === 'run' || view === 'settings'; run.hidden = view !== 'run'; settings.hidden = view !== 'settings';
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : (T.pages[view]?.body || '');
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
      // today's run rows open the Rail run page; each shows the state of the case it opens
      if (view === 'runs') for (const row of today.querySelectorAll('.runs-item')) {
        const c = RUN_CASE[row.querySelector('.runs-row-title')?.textContent.trim()];
        if (!c) continue;
        row.dataset.railRun = c;
        const sub = row.querySelector('.runs-row-sub'); if (sub) sub.textContent = RUN_LINE[c];
        const dot = row.querySelector('.status-dot'); if (dot) dot.className = R.statusDotClass(RUN_DOT[c]);
      }
      scrollTo(0, 0);
    }
    if (view === 'run') {
      const pick = document.getElementById('case');
      if (pick && arg && pick.value !== arg) { pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      scrollTo(0, 0);
    }
  }

  // ---- clicks the shell owns: the sidebar's places, today's pages, a run row, the top bar's narrow controls, Ask worca ----
  const searchFold = (on) => { document.querySelector('#topnav .tsearch')?.classList.toggle('is-open', on); if (on) document.getElementById('tsearch-input')?.focus(); };
  document.addEventListener('click', (e) => {
    const on = (sel) => e.target.closest(sel);
    let hit;
    if ((hit = on('#side-rail nav.nav [data-nav]'))) { e.preventDefault(); drawer(false); location.hash = hit.dataset.nav; return; }
    if ((hit = on('#route-today [data-rail-run]'))) { e.preventDefault(); const c = hit.dataset.railRun; if (RM) RM.titles[c] = Object.keys(RUN_CASE).find((t) => RUN_CASE[t] === c); location.hash = 'run/' + c; return; }
    if ((hit = on('#side-rail .logo, #side-rail .logo-mark'))) { e.preventDefault(); drawer(false); location.hash = 'chat'; return; }
    if ((hit = on('[data-unlock]')) && on('#route-today')) { window.RailPulse?.unlock(hit.dataset.unlock, hit.dataset.to); return; }
    if (on('#side-toggle')) { collapsed = !collapsed; store.set(KEY_RAIL, collapsed ? '1' : '0'); syncRail(); return; }
    if (on('#mbar-menu')) { drawer(!document.body.classList.contains('nav-open')); return; }
    if (on('#side-close, #nav-scrim')) { drawer(false); return; }
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
  document.addEventListener('pointerdown', (e) => { const g = e.target.closest?.('.ask-side-grip'); if (g) { drag = true; e.preventDefault(); document.getElementById('ask-side').classList.add('is-resizing'); } });
  document.addEventListener('pointermove', (e) => { if (drag) setAskW(innerWidth - e.clientX); });
  document.addEventListener('pointerup', () => { if (drag) { drag = false; document.getElementById('ask-side').classList.remove('is-resizing'); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('.ask-side-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setAskW(askW + (e.key === 'ArrowLeft' ? 20 : -20)); return; }
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { drawer(false); document.getElementById('mbar-menu')?.focus(); return; }
    if (e.key === 'Escape' && document.querySelector('#topnav .tsearch.is-open')) searchFold(false);
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
      const inRun = !!target?.closest?.('#card, [data-run-tools]');
      // today's pages and the sidebar's places are the shell's own: neither the run page nor Pulse answers there
      const inShell = !!target?.closest?.('#route-today, #side-rail nav.nav, #ask-side');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    go: (hash) => { if (location.hash.slice(1) === hash) route(); else location.hash = hash; },
    // a run opened from Pulse or the search carries its own title
    openRun: (hash, title) => { const c = hash.split('/')[1]; if (RM && title) RM.titles[c] = title; window.RailShell.go(hash); },
    closeSearch: () => searchFold(false),
    connReset: () => { const sel = document.getElementById('conn'); if (sel) sel.value = 'ok'; conn = 'ok'; document.getElementById('rail-conn').innerHTML = ''; },
    closeDrawer: () => drawer(false),
  };
  // In the one Worca a run's page carries the title its row shows (the run page's own cases keep theirs on run-page.html).
  const RM = window.RunCardModel;
  for (const [title, id] of Object.entries(RUN_CASE)) if (RM) RM.titles[id] = title;
  let routed = { view: '', locked: false };
  build();
  setAskW(askW);
  addEventListener('resize', syncRail);
  // A change of mode or a Labs flag: the sidebar follows, and the page if that changes whether it is locked.
  R.prefs.onChange(() => { applyPrefs(); if (routed.view && TITLES[routed.view] && !!lockOf(routed.view) !== routed.locked) route(); });
  addEventListener('hashchange', route);
  window.RailShell.start = route;
})();
