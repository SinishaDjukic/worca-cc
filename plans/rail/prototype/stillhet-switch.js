// The Stillhet switch as one top-bar icon, the owner's approved mock (plans/rail/stillhet-switch.md): the icon beside Ask worca
// and Pulse, its tip, its 2-row menu, and before/after panels for the toothed Settings gear and the Pulse row's mark.
// Everything is drawn by window.RailUI: the icon and its menu are the library's StillhetSwitch with its shared watch, the gear
// and the Stillhet glyph its icons. The mock's own drawings are only today's two Settings marks, for the "before" panel.
// A pick here moves the check and writes the controls bar's note, never a real flag.
(function () {
  const R = window.RailUI;
  const TIP = R.STILLHET_TIP;
  const LOCKED = R.STILLHET_LOCKED;
  const ITEMS = R.STILLHET_ITEMS.map((it) => it.text);
  const ROW_TONES = ['ask', 'idle', 'fail', 'act'];
  const CASES = ['closed', 'tip', 'menu', 'locked', 'icons'];
  // Today's Settings marks before the build (icons.mjs `gear` and `nav-settings`): rays around a hub, which read as `sun`.
  const BEFORE_GEAR = '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"></path>';
  const BEFORE_NAV_SETTINGS = '<circle cx="12" cy="12" r="3"></circle><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"></path>';
  const beforeSvg = (inner, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  const ICON = '[data-stillhet="ui-icon"]';
  const NOTE = '[data-mock-note]';
  const NOTES = {
    closed: 'At rest: one grey icon after Pulse. Hover or focus it for its tip; click it for the menu.',
    tip: 'Its tip names it: the new UI, in beta.',
    menu: 'Its menu: one way in, one way out; the current UI carries the check.',
    locked: 'WORCA_FLAGS fixes the flag: both rows are disabled and the tip says why.',
    icons: 'Before and after: the Settings gear, and the mark on Pulse\'s Updates and Limits rows.',
  };
  const states = new WeakMap();   // host → { case, on }

  function topBar(s) {
    const pulse = R.topBarAction({ label: 'Pulse', icon: R.icon('signal', 16), labelCls: 'pz-pulse-l', kind: 'quiet', cls: 'topnav-act pz-pulse-b', badge: null, title: 'Pulse: Nothing new', attrs: { 'data-pop': true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } });
    return R.topBarFrame({
      title: 'Chat',
      left: R.sideToggle(),
      centre: R.search({ label: 'Search or ask', bar: { kbd: R.keyHint(['mod', 'K'], R.isMac(window)) } }),
      right: `${R.askButton({ mark: R.askWorcaMark() })}${pulse}<span data-stillhet="ui-slot">${R.stillhetSwitch({ on: s.on, locked: s.case === 'locked', open: s.case === 'menu' })}</span>`,
    });
  }

  // One labelled glyph in a panel.
  const sample = (svgHtml, label) => `<span class="mk-sample">${svgHtml}<span class="mk-cap">${R.esc(label)}</span></span>`;
  const pulseHead = (svgHtml) => R.button({ label: 'Notification settings', kind: 'quiet', iconOnly: true, icon: svgHtml, attrs: { 'data-context': 'pulse-head', title: 'Settings › Notifications: what reaches you' } });
  const half = (side, head, body) => `<div class="mk-half" data-side="${side}"><p class="mk-h">${head}</p>${body}</div>`;

  function gearPanel() {
    const before = sample(beforeSvg(BEFORE_GEAR, 20), 'gear') + sample(beforeSvg(BEFORE_NAV_SETTINGS, 20), 'nav-settings') + sample(pulseHead(beforeSvg(BEFORE_GEAR, 16)), 'Pulse head');
    const after = sample(R.icon('gear', 20), 'gear, toothed') + sample(R.icon('sun', 20), 'sun') + sample(R.icon('stillhet-ui', 20), 'Stillhet') + sample(pulseHead(R.icon('gear', 16)), 'Pulse head');
    return `<section class="mk-panel" data-panel="gear"><h2 class="mk-title">Settings gear</h2>${half('before', 'Today', before)}${half('after', 'After', after)}</section>`;
  }

  // Updates (ask, idle) and Limits (fail, act), as pulse.js draws their rows.
  const ROWS = [['Plan ready for review', 'Updates · checkout-flow'], ['PR merged', 'Updates · billing'], ['Claude weekly limit used up', 'Limits · resets Monday'], ['Claude 5-hour window at 85%', 'Limits · resets in 1 h']];
  function rowPanel() {
    const rows = (withSignal) => ROW_TONES.map((tone, i) => R.pulseRow({ mark: R.kindMark({ kind: 'event', tone, size: 16, ...(withSignal ? { icon: 'signal' } : {}) }), title: ROWS[i][0], meta: `${ROWS[i][1]} · ${tone}`, time: `${i + 2}m`, tip: 'Opens it', id: `${withSignal ? 'a' : 'b'}${i}` })).join('');
    return `<section class="mk-panel" data-panel="pulse-row"><h2 class="mk-title">Pulse row mark</h2>${half('before', 'Today: the event bolt', `<div class="pz-list">${rows(false)}</div>`)}${half('after', 'After: the Pulse mark, smaller, in the row\'s tone', `<div class="pz-list">${rows(true)}</div>`)}</section>`;
  }

  function paint(host) {
    const s = states.get(host);
    host.innerHTML = topBar(s) + (s.case === 'icons' ? `<div class="mk-panels">${gearPanel()}${rowPanel()}</div>` : '');
    // Only the Stillhet icon and its menu act here. The bar around it (search, Ask worca, Pulse) and the panels' samples
    // are a picture of the app: marked as one, so the click walk (gates/click-check.mjs `[data-capture]`) leaves them out
    for (const c of host.querySelectorAll('button, a[href], input')) if (!c.closest('[data-stillhet="design-switch"]')) c.setAttribute('data-capture', '');
  }

  const note = (doc, text) => { const n = doc.querySelector(NOTE); if (n) n.textContent = text; };

  /** @param {Element} host @param {{case:string, on?:boolean}} o */
  function draw(host, { case: c, on = true } = {}) {
    if (!CASES.includes(c)) throw new Error(`stillhet-switch mock: unknown case "${c}"`);
    const doc = host.ownerDocument;
    // the library's watch opens the menu and runs a pick; the mock's pick only moves the check and writes the note
    R.watchStillhetSwitch(doc, {
      pick: (choice) => {
        const s = states.get(host), text = R.STILLHET_ITEMS.find((it) => it.id === choice).text;
        s.on = choice === 'on';
        note(doc, `Picked: ${text}${s.on ? '' : ' · the build reloads into today\'s app'}`);
        return { ok: true };
      },
    });
    states.set(host, { case: c, on });
    R.watchMenus(doc);
    R.watchTooltips(doc);
    paint(host);
    note(doc, NOTES[c]);
    if (c === 'tip') host.querySelector(ICON).focus();
  }

  /** The page's controls bar: ?case=, ?on=0, ?theme=light|dark, ?w=360, and ?open=1 opens the menu once drawn. */
  function boot(doc) {
    const q = new URLSearchParams(doc.defaultView.location.search), host = doc.getElementById('mock'), pickCase = doc.getElementById('case');
    const theme = (t) => { doc.documentElement.dataset.theme = t; doc.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === t))); };
    const show = (c) => { draw(host, { case: c, on: q.get('on') !== '0' }); if (q.get('open') === '1' && c !== 'menu') host.querySelector(ICON).click(); };
    if (q.get('w') === '360') doc.documentElement.classList.add('mk-360');
    pickCase.innerHTML = CASES.map((c) => `<option value="${c}">${c}</option>`).join('');
    pickCase.value = CASES.includes(q.get('case')) ? q.get('case') : 'menu';
    pickCase.addEventListener('change', () => show(pickCase.value));
    doc.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => theme(b.dataset.themePick)));
    theme(q.get('theme') === 'dark' ? 'dark' : 'light');
    show(pickCase.value);
  }

  window.StillhetSwitchMock = { draw, boot, TIP, LOCKED, ITEMS, BEFORE_GEAR, BEFORE_NAV_SETTINGS, ROW_TONES };
})();
