// The one Worca's shell: today's sidebar and top bar (today/, captured from the app), with Wave 1's decisions applied,
// and a router over the pages. A place opens from the sidebar; today's pages show as captured, in the Rail colours; a
// run opens as a full page (the Rail run page); Settings opens from the profile menu (the Rail Settings).
//   #<view>            a place: chat, runs, schedules, stats, team-metrics, workflows, requirements, projects,
//                      workspaces, marketplace (today's pages)
//   #run/<case>        the Rail run or group page, on one of its cases
//   #settings[/<id>]   the Rail Settings, on one of its sections
// pulse/pulse.js mounts Pulse, the profile menu, New run, the search and Settings into it; runs/run-page.js draws the
// run page into #card. Each owns its own clicks (window.RailShell.owns).
(function () {
  const T = window.Today;
  const TITLES = { chat: 'Chat', runs: 'Runs', schedules: 'Schedules', stats: 'Statistics', 'team-metrics': 'Team metrics', workflows: 'Workflows',
    requirements: 'Requirements', projects: 'Projects', workspaces: 'Workspaces', marketplace: 'Marketplace' };
  // Today's runs, opened as the Rail run page on the case that shows them best.
  const RUN_CASE = { 'Add CSV export to billing': 'question', 'Migrate cron parser': 'gate', 'Fix flaky login test': 'working', 'Rename settings keys': 'checks', 'Unified page navigation': 'ready' };
  const RUN_DOT = { question: 'is-amber', gate: 'is-amber', working: 'is-peach is-pulse', checks: 'is-peach', ready: 'is-green' };
  const RUN_LINE = { question: 'Needs you · Plan asks 2 questions', gate: 'Needs you · Review gate', working: 'Working · Build', checks: 'In review · checks running', ready: 'Ready · checks pass' };
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
    side.querySelector('#side-acct')?.setAttribute('data-acct', '');
    return side;
  }
  // ---- the top bar: Pulse in Activity's place; the search, New run and the profile open the Rail pieces ----
  function topBar() {
    const top = el(T.topBar);
    top.querySelector('#activity-pop')?.remove();
    const act = top.querySelector('#topnav-activity');
    if (act) act.replaceWith(el('<span id="rail-pulse-slot"></span>'));
    top.querySelector('#topnav-new')?.setAttribute('data-newrun', '');
    const input = top.querySelector('#tsearch-input');
    if (input) { input.setAttribute('data-search', ''); input.removeAttribute('role'); input.closest('.tsearch-field')?.insertAdjacentHTML('beforeend', '<div data-search-res></div>'); }
    top.querySelector('#tsearch-pop')?.remove();
    return top;
  }

  function build() {
    const app = document.getElementById('worca');
    app.innerHTML = '';
    const col = el('<div class="main-col"></div>');
    col.append(topBar(), el('<div id="main-row" class="main-row"><main class="main"><div id="route-today"></div><div id="route-run" class="rc-board" hidden><div id="card"></div></div><div id="route-settings" class="pz-app rail-page" hidden></div></main></div>'));
    app.append(sidebar(), col);
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
    const today = document.getElementById('route-today'), run = document.getElementById('route-run'), settings = document.getElementById('route-settings');
    today.hidden = view === 'run' || view === 'settings'; run.hidden = view !== 'run'; settings.hidden = view !== 'settings';
    document.body.className = view === 'run' ? 'view-run' : view === 'settings' ? 'view-settings' : (T.pages[view]?.body || '');
    document.getElementById('topnav-title').textContent = view === 'run' ? 'Runs' : view === 'settings' ? 'Settings' : TITLES[view];
    window.RailPulse?.show(view === 'settings' ? 'settings' : 'page', view === 'settings' ? arg || '' : '');   // first: it may give the sidebar back
    markNav(view);
    if (!today.hidden) {
      today.innerHTML = T.pages[view].html;
      // today's run rows open the Rail run page; each shows the state of the case it opens
      if (view === 'runs') for (const row of today.querySelectorAll('.runs-item')) {
        const c = RUN_CASE[row.querySelector('.runs-row-title')?.textContent.trim()];
        if (!c) continue;
        row.dataset.railRun = c;
        const sub = row.querySelector('.runs-row-sub'); if (sub) sub.textContent = RUN_LINE[c];
        const dot = row.querySelector('.status-dot'); if (dot) dot.className = 'status-dot ' + RUN_DOT[c];
      }
      scrollTo(0, 0);
    }
    if (view === 'run') {
      const pick = document.getElementById('case');
      if (pick && arg && pick.value !== arg) { pick.value = arg; pick.dispatchEvent(new Event('change', { bubbles: true })); }
      scrollTo(0, 0);
    }
  }

  // ---- clicks the shell owns: the sidebar's places, today's pages, a run row ----
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('#side-rail nav.nav [data-nav]');
    if (nav) { e.preventDefault(); location.hash = nav.dataset.nav; return; }
    const run = e.target.closest('#route-today [data-rail-run]');
    if (run) { e.preventDefault(); location.hash = 'run/' + run.dataset.railRun; return; }
    const logo = e.target.closest('#side-rail .logo, #side-rail .logo-mark');
    if (logo) { e.preventDefault(); location.hash = 'chat'; return; }
    if (e.target.closest('#route-today a[href], #route-today button')) { e.preventDefault(); window.RailPulse?.say('Today\'s page, as captured: it keeps its design in Wave 1'); }
  });

  window.RailShell = {
    // which script answers a click or a key: the run page owns #card and its tools; Pulse owns the rest of the Rail pieces
    owns: (who, target) => {
      const inRun = !!target?.closest?.('#card, [data-run-tools]');
      // today's pages and the sidebar's places are the shell's own: neither the run page nor Pulse answers there
      const inShell = !!target?.closest?.('#route-today, #side-rail nav.nav');
      return who === 'run' ? inRun : !inRun && !inShell;
    },
    runActive: () => !document.getElementById('route-run')?.hidden,
    go: (hash) => { location.hash = hash; },
  };
  // In the one Worca a run's page carries the title its row shows (the run page's own cases keep theirs on run-page.html).
  const RM = window.RunCardModel;
  for (const [title, id] of Object.entries(RUN_CASE)) if (RM) RM.titles[id] = title;
  build();
  addEventListener('hashchange', route);
  window.RailShell.start = route;
})();
