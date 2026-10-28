// ui/public/marketplace/page.mjs — the Marketplace page controller (marketplace P3, CONTRACT §3.5, §4, §5): the tab
// strip with counts, one coalesced loader, the action registry. Tab specs paint the panels; the page owns the state,
// the address (SM63) and focus through re-renders (data-focus-key).
import { buildCatalog } from './catalog.mjs';
import { chip } from './kinds.mjs';
import { LAYER_CLOSED } from './layers.mjs';
import { dialogOpen } from '../modal-guard.mjs';

export const TABS = ['browse', 'installed', 'marketplaces'];
const LABELS = { browse: 'Browse', installed: 'Installed', marketplaces: 'Marketplaces' };
const list = (v) => (Array.isArray(v) ? v : []);

/** The tab a `#marketplace/<param>` address names: its first path segment; anything else is Browse. */
export function tabFromParam(param) {
  const first = String(param ?? '').split('/')[0];
  return TABS.includes(first) ? first : 'browse';
}

/** A tab's address: Browse is the bare #marketplace. */
export function tabHash(tab) {
  return TABS.includes(tab) && tab !== 'browse' ? `#marketplace/${tab}` : '#marketplace';
}

/** The Installed tab's blue chip: "1 update" / "{n} updates"; null below one. */
export function updatesChip(doc, n) {
  if (!(n >= 1)) return null;
  const c = chip(doc, 'upd', n === 1 ? '1 update' : `${n} updates`);
  c.classList.add('mk-upd-chip');
  return c;
}

async function quiet(fn) {
  try { return await fn(); } catch { return null; }
}

/**
 * The Marketplace page on `host` (CONTRACT §3.5): the tab strip, the state, one coalesced loader, the tab and action registries.
 * deps  = { api(method, url, body) -> Promise<{ ok, status, data }>, notify, confirmModal, promptModal, openMenu, navigate(hash), gitOn(),
 *           setMsg(text, kind?), loadPolicy?() -> Promise<scopes>, invalidateAgentCaches?(), openSetupChecklist?(),
 *           fallbacks: { openInstallConsent(entry) } }
 * Page  = { state, load({ refresh = false, background = false } = {}) -> Promise<void>, setTab(tab), registerTab(key, spec),
 *           provide(action, fn), act(action, ...args) -> provider's return, onChange(fn) -> unsubscribe, setFilters(patch),
 *           render({ background = false } = {}), destroy() }
 * state = { tab, loaded, refreshing, plugins, orphans, marketplaces, channelStatus, policy, catalog,
 *           filters: { q: '', adds: null, from: null, hideInstalled: false } }
 * spec  = { label?, count(state) -> number, chip?(state) -> Node | null, header?(state, el, page), render(state, el, page) }
 * @param {{ doc: Document, win: Window, host: HTMLElement, deps: object }} o
 * @returns {object} the Page
 */
export function createMarketplacePage({ doc, win, host, deps }) {
  const state = {
    tab: 'browse', loaded: false, refreshing: false, plugins: [], orphans: [], marketplaces: [], channelStatus: [],
    policy: null, catalog: [], filters: { q: '', adds: null, from: null, hideInstalled: false },
  };
  const specs = new Map();
  const providers = new Map();
  const listeners = new Set();
  const make = (tag, cls) => { const n = doc.createElement(tag); n.className = cls; return n; };

  const head = make('div', 'mk-head');
  const nav = make('nav', 'tabs mk-tabs');
  nav.setAttribute('aria-label', 'Marketplace sections');
  const actions = make('div', 'mk-head-actions');
  actions.dataset.tab = state.tab;
  const links = {};
  const counts = {};
  const chips = {};
  const panels = {};
  for (const tab of TABS) {
    const a = make('a', 'tab mk-tab');
    a.dataset.tab = tab;
    a.setAttribute('href', tabHash(tab));
    counts[tab] = make('span', 'mk-count');
    counts[tab].hidden = true;
    a.append(doc.createTextNode(LABELS[tab]), counts[tab]);
    nav.append(a);
    links[tab] = a;
    const panel = make('div', 'mk-panel');
    panel.dataset.tab = tab;
    panel.hidden = tab !== state.tab;
    panel.setAttribute('aria-busy', 'true');
    panels[tab] = panel;
  }
  head.append(nav, actions);
  host.replaceChildren(head, ...TABS.map((t) => panels[t]));

  // The tab the address names: the first segment after #marketplace/; null while the address names another view.
  function addressTab() {
    const raw = String(win.location?.hash ?? '').replace(/^#/, '');
    const i = raw.indexOf('/');
    if ((i === -1 ? raw : raw.slice(0, i)) !== 'marketplace') return null;
    return tabFromParam(i === -1 ? '' : raw.slice(i + 1));
  }

  // Run a repaint; if it took the focused control away, focus its rebuilt twin (same data-focus-key). With no twin
  // (the first marketplace replaced the empty state's form, a card left with a reload), focus the header's Add
  // marketplace, else the selected tab: never <body> (marketplace P7). Focus the paint moved elsewhere stays there.
  // A control left in a panel the paint hid (a tab switch) is lost too: a browser drops that focus to <body>.
  function keepFocus(paint) {
    const before = doc.activeElement;
    const inside = !!before && host.contains(before);
    const key = inside ? before.dataset?.focusKey : undefined;
    paint();
    const shown = (n) => !!n && host.contains(n) && !n.closest('[hidden]');
    if (!inside || shown(doc.activeElement)) return;
    if (key !== undefined) {
      for (const n of host.querySelectorAll('[data-focus-key]')) {
        if (n.dataset.focusKey === key && shown(n)) { n.focus(); if (doc.activeElement === n) return; }   // a disabled twin takes no focus
      }
    }
    const a = doc.activeElement;
    if (a && a !== doc.body && !host.contains(a)) return;
    (host.querySelector('.mk-head-actions .mk-add-mkt') || host.querySelector('a.mk-tab[aria-current="page"]'))?.focus();
  }

  function paintSelection() {
    for (const tab of TABS) {
      const on = tab === state.tab;
      links[tab].classList.toggle('on', on);
      if (on) links[tab].setAttribute('aria-current', 'page'); else links[tab].removeAttribute('aria-current');
      panels[tab].hidden = !on;
    }
  }

  function paintHeader() {
    actions.dataset.tab = state.tab;
    actions.replaceChildren();
    specs.get(state.tab)?.header?.(state, actions, page);
  }

  function paintTab(tab) {
    const spec = specs.get(tab);
    links[tab].firstChild.textContent = spec?.label ?? LABELS[tab];
    chips[tab]?.remove();
    chips[tab] = null;
    counts[tab].hidden = !state.loaded || !spec;
    if (state.loaded) panels[tab].removeAttribute('aria-busy');
    if (!spec || !state.loaded) return;
    counts[tab].textContent = String(spec.count(state));
    chips[tab] = spec.chip?.(state) ?? null;
    if (chips[tab]) links[tab].append(chips[tab]);
  }

  let pending = false;
  function render({ background = false } = {}) {
    if (background && dialogOpen(doc)) { pending = true; return; }
    pending = false;
    keepFocus(() => {
      for (const tab of TABS) paintTab(tab);
      paintSelection();
      paintHeader();
      // Each tab paints on its own: one renderer tripping over third-party data never blanks the others.
      for (const [tab, spec] of specs) {
        try { spec.render(state, panels[tab], page); } catch (e) { deps.setMsg(e.message, 'err-inline'); }
      }
    });
  }

  function changed() {
    for (const fn of [...listeners]) fn(state);
  }

  // One POST /api/marketplaces/refresh at a time; the header shows it busy meanwhile.
  async function refreshNow() {
    if (state.refreshing) return;
    state.refreshing = true;
    keepFocus(paintHeader);
    let fresh = null;
    try {
      const r = await deps.api('POST', '/api/marketplaces/refresh');
      if (r?.ok && Array.isArray(r.data?.marketplaces)) fresh = r.data.marketplaces;
    } catch { /* a failed refresh keeps the snapshots we have */ }
    state.refreshing = false;
    try {
      if (fresh) {
        state.marketplaces = [...fresh].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));   // GET's name order
        state.catalog = buildCatalog(state.marketplaces, state.plugins);
        changed();
        render({ background: true });
      }
      if (!fresh || pending) keepFocus(paintHeader);
    } catch (e) { deps.setMsg(e.message, 'err-inline'); }
  }

  let loadErr = false;   // #plugins-msg shows this loader's own error
  async function read({ refresh, background }) {
    try {
      if (!background) { deps.setMsg(''); loadErr = false; }
      const [p, m] = await Promise.all([deps.api('GET', '/api/plugins'), deps.api('GET', '/api/marketplaces')]);
      if (!p?.ok) { deps.setMsg(p?.data?.error || `HTTP ${p?.status}`, 'err-inline'); loadErr = true; return; }
      if (loadErr) { deps.setMsg(''); loadErr = false; }   // a background read that worked takes the loader's old error away
      const chat = await quiet(() => deps.api('GET', '/api/chat/status'));
      const policy = await quiet(() => deps.loadPolicy?.());
      state.plugins = list(p.data?.plugins);
      state.orphans = list(p.data?.orphans);
      if (m?.ok) state.marketplaces = list(m.data?.marketplaces);
      state.channelStatus = chat?.ok ? list(chat.data?.channels) : [];
      state.policy = policy ?? null;
      state.catalog = buildCatalog(state.marketplaces, state.plugins);
      state.loaded = true;
      changed();
      render({ background });
      if (refresh) void refreshNow();
    } catch (e) { deps.setMsg(e.message, 'err-inline'); loadErr = true; }
  }

  // Overlapping loads coalesce into one trailing load: refresh if any asked, background only if all did.
  let running = null;
  let next = null;
  function start(opts) {
    running = read(opts).finally(() => { running = null; });
    return running;
  }
  function load({ refresh = false, background = false } = {}) {
    if (next) {
      next.refresh ||= refresh;
      next.background &&= background;
      return next.promise;
    }
    if (!running) return start({ refresh, background });
    const queued = { refresh, background };
    queued.promise = running.then(() => { next = null; return start(queued); });
    next = queued;
    return queued.promise;
  }

  function setTab(tab) {
    state.tab = TABS.includes(tab) ? tab : 'browse';
    keepFocus(() => { paintSelection(); paintHeader(); });
    if (addressTab() !== state.tab) deps.navigate(tabHash(state.tab));
  }

  function onTabClick(ev) {
    const a = ev.target.closest?.('a.mk-tab');
    if (!a || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    setTab(a.dataset.tab);
  }
  nav.addEventListener('click', onTabClick);

  // A background render held back under a layer lands once the last .viewer-modal closes: on its LAYER_CLOSED, or,
  // for a layer that closes without one (#confirm-modal), when focus comes back into the page. Never in the middle of
  // a press: mousedown focuses the pressed button, and a render then would rebuild it before its click — the release
  // lands it right after the click instead.
  function flushHeld() {
    if (pending && !dialogOpen(doc)) render();
  }
  let pressing = false;
  const onPress = () => { pressing = true; };
  const onRelease = () => { pressing = false; win.setTimeout(flushHeld, 0); };
  const onFocusIn = () => { if (!pressing) flushHeld(); };
  doc.addEventListener(LAYER_CLOSED, flushHeld);
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('pointerup', onRelease, true);
  doc.addEventListener('pointercancel', onRelease, true);
  doc.addEventListener('contextmenu', onRelease, true);   // a context menu takes the pointerup
  host.addEventListener('focusin', onFocusIn);

  const page = {
    state,
    load,
    render,
    setTab,
    registerTab(key, spec) { specs.set(key, spec); },
    provide(name, fn) { providers.set(name, fn); },
    act(name, ...args) {
      const fn = providers.get(name);
      if (!fn) throw new Error(`no provider for ${name}`);
      return fn(...args);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    setFilters(patch) {
      state.filters = { ...state.filters, ...patch };
      const spec = specs.get('browse');
      if (spec && state.loaded) keepFocus(() => spec.render(state, panels.browse, page));
    },
    destroy() {
      doc.removeEventListener(LAYER_CLOSED, flushHeld);
      doc.removeEventListener('pointerdown', onPress, true);
      doc.removeEventListener('pointerup', onRelease, true);
      doc.removeEventListener('pointercancel', onRelease, true);
      doc.removeEventListener('contextmenu', onRelease, true);
      host.removeEventListener('focusin', onFocusIn);
      nav.removeEventListener('click', onTabClick);
      listeners.clear();
      host.replaceChildren();
    },
  };
  return page;
}
