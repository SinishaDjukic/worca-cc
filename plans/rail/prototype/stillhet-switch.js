// The Stillhet switch as one top-bar icon, for the owner's review (plans/rail/stillhet-switch.md): the icon beside Ask worca
// and Pulse, its tip, its 2-row menu, and before/after panels for the toothed Settings gear and the Pulse row's mark.
// Everything is drawn by window.RailUI; the mock's own drawings are the Stillhet glyph and the toothed gear, which move into
// icons.mjs only after approval. A pick here moves the mock's check and writes the controls bar's note, never a real flag.
(function () {
  const R = window.RailUI;
  const TIP = 'Stillhet, Worca\'s new calmer UI · beta';
  const NAME = 'Stillhet UI · beta';
  const LOCKED = 'Locked by WORCA_FLAGS';
  const ITEMS = ['Try Stillhet', 'Back to today\'s UI'];
  const ROW_TONES = ['ask', 'idle', 'fail', 'act'];
  const CASES = ['closed', 'tip', 'menu', 'locked', 'icons'];
  // An 8-toothed gear around a hub ring, in R.icon's frame (24 viewBox): it reads as Settings, apart from `sun`'s rays.
  const GEAR = '<path d="M10.34 4.79L10.66 2.49L13.34 2.49L13.66 4.79A7.4 7.4 0 0 1 15.92 5.72L17.78 4.33L19.67 6.22L18.28 8.08A7.4 7.4 0 0 1 19.21 10.34L21.51 10.66L21.51 13.34L19.21 13.66A7.4 7.4 0 0 1 18.28 15.92L19.67 17.78L17.78 19.67L15.92 18.28A7.4 7.4 0 0 1 13.66 19.21L13.34 21.51L10.66 21.51L10.34 19.21A7.4 7.4 0 0 1 8.08 18.28L6.22 19.67L4.33 17.78L5.72 15.92A7.4 7.4 0 0 1 4.79 13.66L2.49 13.34L2.49 10.66L4.79 10.34A7.4 7.4 0 0 1 5.72 8.08L4.33 6.22L6.22 4.33L8.08 5.72A7.4 7.4 0 0 1 10.34 4.79Z"></path><circle cx="12" cy="12" r="3"></circle>';
  // A still sun resting on water: a circle on the horizon, its reflection broken on the water under it, so it never reads as a person.
  const GLYPH = '<circle cx="12" cy="10" r="3.5"></circle><path d="M2.5 16h19M6 19.5h4M14 19.5h4"></path>';
  const gearSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GEAR}</svg>`;
  const glyphSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH}</svg>`;

  const ICON = '[data-stillhet="ui-icon"]';
  const NOTE = '[data-mock-note]';
  const NOTES = {
    closed: 'At rest: one grey icon after Pulse. Hover or focus it for its tip; click it for the menu.',
    tip: 'Its tip names it: the new UI, in beta.',
    menu: 'Its menu: one way in, one way out; the current UI carries the check.',
    locked: 'WORCA_FLAGS fixes the flag: both rows are disabled and the tip says why.',
    icons: 'Before and after: the Settings gear, and the mark on Pulse\'s Updates and Limits rows.',
  };
  const states = new WeakMap();   // host → { case, on, open }

  function menuHtml(s) {
    const locked = s.case === 'locked';
    return R.compactMenu({ items: ITEMS.map((text, i) => ({ id: text, text, checked: (i === 0) === s.on, off: locked, help: locked ? LOCKED : undefined })), label: NAME });
  }

  function topBar(s) {
    const icon = R.button({ label: NAME, kind: 'quiet', iconOnly: true, icon: glyphSvg(20), cls: 'topnav-act', title: s.case === 'locked' ? `${TIP} · ${LOCKED}` : TIP,
      attrs: { 'data-stillhet': 'ui-icon', 'aria-haspopup': 'menu', 'aria-expanded': String(s.open) } });
    const pulse = R.topBarAction({ label: 'Pulse', icon: R.icon('signal', 16), labelCls: 'pz-pulse-l', kind: 'quiet', cls: 'topnav-act pz-pulse-b', badge: null, title: 'Pulse: Nothing new', attrs: { 'data-pop': true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } });
    return R.topBarFrame({
      title: 'Chat',
      left: R.sideToggle(),
      centre: R.search({ label: 'Search or ask', bar: { kbd: R.keyHint(['mod', 'K'], R.isMac(window)) } }),
      right: `${R.askButton({ mark: R.askWorcaMark() })}${pulse}<span data-stillhet="ui-slot"><span class="rc-pop is-right">${icon}${s.open ? menuHtml(s) : ''}</span></span>`,
    });
  }

  // One labelled glyph in a panel.
  const sample = (svgHtml, label) => `<span class="mk-sample">${svgHtml}<span class="mk-cap">${R.esc(label)}</span></span>`;
  const pulseHead = (svgHtml) => R.button({ label: 'Notification settings', kind: 'quiet', iconOnly: true, icon: svgHtml, attrs: { 'data-context': 'pulse-head', title: 'Settings › Notifications: what reaches you' } });
  const half = (side, head, body) => `<div class="mk-half" data-side="${side}"><p class="mk-h">${head}</p>${body}</div>`;

  function gearPanel() {
    const before = sample(R.icon('gear', 20), 'gear') + sample(R.icon('nav-settings', 20), 'nav-settings') + sample(pulseHead(R.icon('gear', 16)), 'Pulse head');
    const after = sample(gearSvg(20), 'gear, toothed') + sample(R.icon('sun', 20), 'sun') + sample(glyphSvg(20), 'Stillhet') + sample(pulseHead(gearSvg(16)), 'Pulse head');
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
  }

  const note = (doc, text) => { const n = doc.querySelector(NOTE); if (n) n.textContent = text; };

  function onClick(e) {
    const host = e.currentTarget, s = states.get(host);
    const pick = e.target.closest('[data-menu-pick]');
    if (pick) {
      const was = s.on;
      s.on = pick.dataset.menuPick === ITEMS[0];
      s.open = false;
      paint(host);
      if (s.on !== was) note(host.ownerDocument, `Picked: ${pick.dataset.menuPick}${s.on ? '' : ' · the build reloads into today\'s app'}`);
      host.querySelector(ICON).focus({ preventScroll: true });
      return;
    }
    if (e.target.closest(ICON)) { s.open = !s.open; paint(host); }
  }

  /** @param {Element} host @param {{case:string, on?:boolean}} o */
  function draw(host, { case: c, on = true } = {}) {
    if (!CASES.includes(c)) throw new Error(`stillhet-switch mock: unknown case "${c}"`);
    const doc = host.ownerDocument, first = !states.has(host), s = { case: c, on, open: c === 'menu' };
    if (first) {
      host.addEventListener('click', onClick);
      R.dismissOnOutside(doc, { rank: 3, open: () => states.get(host).open, inside: '[data-stillhet="ui-slot"]', close: () => { states.get(host).open = false; }, paint: () => paint(host), back: () => ICON });
    }
    states.set(host, s);
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

  window.StillhetSwitchMock = { draw, boot, TIP, LOCKED, ITEMS, GEAR, ROW_TONES };
})();
