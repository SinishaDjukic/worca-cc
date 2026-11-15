// Stillhet's own frame: the sidebar and the top bar, composed from the library's parts (shell-frame.mjs, shell-parts.mjs,
// side-menu.mjs). shell.js calls RailFrame.sidebar(places) and RailFrame.topBar(); it fills the named slots (bar-head,
// bar-back, bar-chat, bar-tasks, bar-schedules, bar-place, bar-mini, the avatar in #side-foot, in-view-slot, rail-pulse-slot,
// rail-conn). Nothing here reads dev's DOM.
(function () {
  const R = window.RailUI;
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const NEW = { chat: ['New chat', 'ask'] };   // the home's rows; Tasks and Schedules have their + in their own bar (rail.chat-first)
  const LIST = (id, extra = '') => `<div id="${id}" class="bar-list pz-app rail-page" hidden>${extra}</div>`;

  function place([id, label, min, flag]) {
    const item = R.navItem({ label, icon: R.icon('nav-' + id, 14), lab: !!flag, attrs: { 'data-nav': id, 'data-min-level': min, 'data-flag': flag || null, 'aria-label': label } });
    return NEW[id] ? `<div class="place-row" data-place="${id}">${item}${R.button({ label: NEW[id][0], kind: 'quiet', iconOnly: true, icon: R.icon('plus', 13), attrs: { 'data-bar-new': NEW[id][1], title: NEW[id][0] } })}</div>` : item;
  }

  /** @param {Array} places [[group, [[id, label, minLevel, flag?]]]] */
  function sidebar(places) {
    return el(R.sidebarFrame({
      brand: R.brandRow({ slot: '<div id="bar-head"></div>' }),
      above: '<div id="bar-back" class="bar-back pz-app rail-page"></div>',
      nav: places.map(([g, list]) => R.navSection({ label: g }) + list.map(place).join('')).join(''),
      lists: LIST('bar-chat') + LIST('bar-tasks', '<div id="runs-root"></div>') + LIST('bar-schedules') + LIST('bar-place'),
      extras: '<div id="bar-mini" class="bar-mini"></div>',
      grip: R.barGrip(),
    }));
  }

  function topBar() {
    return el(R.topBarFrame({
      title: 'Runs',
      left: R.menuButton() + R.sideToggle() + R.button({ label: 'Show the bar', kind: 'quiet', iconOnly: true, icon: R.icon('bar-show', 16), cls: 'bar-show', attrs: { id: 'bar-show' } }),
      centre: R.search({ label: 'Search or ask', bar: { kbd: R.keyHint(['mod', 'K'], R.isMac(window)) } }),
      right: `<span id="in-view-slot"></span>${R.askButton({ mark: R.askWorcaMark() })}<span id="rail-pulse-slot"></span>${R.stillhetSwitch({ on: window.RailHost ? window.RailHost.stillhetOn() : false, locked: !!(window.RailHost && window.RailHost.railLocked && window.RailHost.railLocked()) })}<span id="rail-conn"></span>`,
    }));
  }

  // the Stillhet icon's menu, for both hosts: a pick lands in the host's setStillhet (the app's PATCH, toast and reload; the
  // prototype's moved check), and busy and restore are the library's (nav.design-switch). The host's live flag decides the
  // current UI at each click, not the slot's painted data-on
  R.watchStillhetSwitch(document, { pick: (c) => Promise.resolve(window.RailHost.setStillhet(c === 'on')), current: () => !!(window.RailHost && window.RailHost.stillhetOn()) });

  window.RailFrame = { sidebar, topBar };
})();
