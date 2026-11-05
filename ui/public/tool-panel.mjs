// ui/public/tool-panel.mjs — the tool panel (issue 1064): the right-hand column of every page that had the terminal
// pane, now with mixed tabs (Terminal, Files, Changes; later kinds register in tool-kinds.mjs). It keeps the pane's
// element and layout contract (aside.term-pane, body.term-open, --term-w), so every page rule, Escape guard and the
// side column keep working. Built in JS and appended to <body>, like the pane was: index.html only holds icon hosts.
import { icon } from './icons.mjs';
import { openMenu } from './workflows/menu.mjs';
import { ICON_SLOTS } from './tool-kinds.mjs';
import { viewOf, viewKey, inView, scopeKey, DEFAULT_WIDTH, BLOCKED } from './tool-tabs.mjs';

const MIN_W = 320;
/** Below the Runs page's slide breakpoint (app.js RUNS_SPLIT_MIN, 880 px) the panel is a full-screen sheet. */
export const SHEET_QUERY = '(max-width: 879px)';
const NO_VIEW = Object.freeze({ project: null, side: null });

/**
 * `registry`: createToolRegistry(); `model`: createTabModel(); `getPageContext()`: app.js toolPageContext;
 * `refreshSessions()`: the terminal's server list (the first open loads it, D14); `suggest(view)`: the + page's Suggested
 * rows `[{ label, detail?, icon?, open() }]` (app.js toolSuggestions: running services, recent addresses, the repo);
 * `mirror`: createTabMirror() (tool-mirror.mjs): the assistant's tabs join when their chat or project comes into view.
 */
export function createToolPanel({ doc, win, registry, model, getPageContext, refreshSessions = null, suggest = null, mirror = null }) {
  const st = { open: false, view: null, page: 'tab', mounted: null, guest: null, note: '', drag: null, sessionsAsked: false,
    inerted: false, pendingTimer: null, destroyed: false };
  const drawn = { strip: '' };
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const iconButton = (name, label, cls, onClick) => {
    const b = make('button', `btn btn-sm btn-quiet btn-icon ${cls}`);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.append(icon(doc, name, 14));
    b.addEventListener('click', onClick);
    return b;
  };

  // ── DOM ──────────────────────────────────────────────────────────────────────────────────────────
  const root = make('aside', 'term-pane tool-panel');
  root.hidden = true;
  root.setAttribute('aria-label', 'Tools');
  const resizer = make('div', 'term-resize');
  const head = make('div', 'tool-head');
  const tabsEl = make('div', 'tool-tabs');
  tabsEl.setAttribute('role', 'tablist');
  tabsEl.setAttribute('aria-label', 'Open tools');
  const newBtn = iconButton('plus', 'New tab', 'tool-new', () => showNewPage());
  const maxBtn = iconButton('maximize', 'Maximize the tool panel', 'tool-max', () => setMax(!model.prefs().max));
  const hideBtn = iconButton('x', 'Hide the tool panel', 'term-icon term-hide', () => hide());
  hideBtn.title = 'Hide (shells keep running)';
  head.append(tabsEl, newBtn, make('span', 'tool-head-spacer'), maxBtn, hideBtn);
  const body = make('div', 'tool-body');
  root.append(resizer, head, body);

  // ── views ────────────────────────────────────────────────────────────────────────────────────────
  const currentView = () => st.view || NO_VIEW;
  const guestTab = () => { const t = st.guest && model.get(st.guest); return t && !inView(t, currentView()) ? t : null; };
  function visibleList() {
    const v = model.visible(currentView());
    const g = guestTab();
    return { project: v.project, side: g ? [...v.side, g] : v.side };
  }
  const visibleOrder = () => { const v = visibleList(); return [...v.project, ...v.side]; };
  const activeTab = () => (st.page === 'new' ? null : guestTab() || model.active(currentView()));
  const keepIds = () => new Set([st.mounted?.tab.id, model.active(currentView())?.id, st.guest].filter(Boolean));
  function unavailable(def, v) {
    if (v.blocked) return v.blocked;
    if (!v.side && !v.project) return 'Open a run, a chat or a project to use its tools.';
    return typeof def.unavailable === 'function' ? def.unavailable(v) : null;
  }
  /** A tab's scope plus the view's run lookup keys (a shell synced from the server carries only its run id). */
  function scopeFor(tab) {
    const side = currentView().side;
    return side && scopeKey(side) === scopeKey(tab.scope) ? { ...side, ...tab.scope } : tab.scope;
  }
  function follow() {
    win.clearTimeout(st.pendingTimer);
    const next = viewOf(getPageContext ? getPageContext() : {});
    // A live run gets its pipeline id a moment after it starts: look again until it has one (the pane's schedulePending).
    if (next && next.blocked === BLOCKED.pending) st.pendingTimer = win.setTimeout(() => { if (!st.destroyed) follow(); }, 1500);
    if (!next) { syncIcons(); return; }                    // a page about no project, run or chat keeps the last view
    const changed = viewKey(next) !== viewKey(st.view) || (next.blocked || '') !== (st.view?.blocked || '');
    st.view = next;
    if (!changed) { syncIcons(); return; }
    void pullView(next);
    st.guest = null;
    st.note = '';
    if (st.page === 'new' && model.active(next)) st.page = 'tab';
    show();
  }

  /** The assistant's new tabs of the view's chat and project (D9): into the strip; when the panel is open, the newest
   *  non-terminal one shows (a Terminal tab starts a shell when it mounts, so the user picks that one). */
  async function pullView(v) {
    if (!mirror || !v) return;
    const scopes = [v.side, v.project ? { type: 'project', id: v.project } : null].filter(Boolean);
    const added = (await Promise.all(scopes.map((s) => mirror.pull(s, { keep: keepIds() })))).flat();
    if (!added.length || st.destroyed) return;
    const pick = [...added].reverse().find((t) => t.kind !== 'terminal');
    if (st.open && pick && viewKey(currentView()) === viewKey(v)) await activate(pick);
    else show();
  }

  const kindApi = Object.freeze({
    tab: (id) => model.get(id),
    isMounted: (id) => st.mounted?.tab.id === id,
    scopeFor,
    setTabState: (id, patch) => { model.update(id, patch); renderStrip(); },
    openTab: (kind, scope, state = {}) => { const t = model.open(kind, scope, state, { keep: keepIds() }); if (t) activate(t, { focus: true }); return t; },
    close: (id) => closeTab(id),
    view: () => currentView(),
  });

  // ── showing ──────────────────────────────────────────────────────────────────────────────────────
  function unmountCurrent() {
    const m = st.mounted;
    st.mounted = null;
    if (m) { try { m.kind?.unmount?.(m.tab); } catch { /* a kind's own trouble */ } }
    body.replaceChildren();
    delete body.dataset.kind;
  }
  /** Draws the strip and the icons; when open, the active tab (mounted once) or the + page. */
  async function show() {
    renderStrip();
    syncIcons();
    const tab = st.open ? activeTab() : null;
    if (st.mounted && (!tab || tab.id !== st.mounted.tab.id)) unmountCurrent();
    if (!st.open) return;
    if (!tab) { renderNewPage(); return; }
    if (st.mounted) return;
    const kind = registry.get(tab.kind);
    body.replaceChildren();
    st.mounted = { tab, kind };
    body.dataset.kind = tab.kind;
    if (!kind) { body.append(make('p', 'tool-note', 'This tool is not available in this version of Worca.')); return; }
    try { await kind.mount(tab, body, kindApi); }
    catch (e) { if (st.mounted?.tab.id === tab.id) body.append(make('p', 'tool-note tool-error', e?.message || String(e))); }
  }
  function focusActive() {
    const m = st.mounted;
    if (!m) { body.querySelector('.tool-newtab-row:not(:disabled)')?.focus(); return; }
    if (typeof m.kind?.focus === 'function') m.kind.focus(m.tab);
    else body.querySelector('button:not(:disabled), select, pre[tabindex]')?.focus();
  }
  function setOpen(open) {
    st.open = open;
    root.hidden = !open;
    doc.body.classList.toggle('term-open', open);
    model.setPrefs({ open });
    syncSheet();
  }
  async function open({ focus = false } = {}) {
    if (!st.sessionsAsked && typeof refreshSessions === 'function') { st.sessionsAsked = true; await refreshSessions(); }
    setOpen(true);
    await show();
    if (focus) focusActive();
  }
  function hide() {
    setOpen(false);
    unmountCurrent();
    renderStrip();
    syncIcons();
  }
  async function activate(tab, { focus = false } = {}) {
    if (!tab) return;
    st.page = 'tab';
    st.note = '';
    if (inView(tab, currentView())) { st.guest = null; model.activate(currentView(), tab.id); } else st.guest = tab.id;
    await open({ focus });
  }
  async function showNewPage() {
    st.page = 'new';
    await open({ focus: true });
  }
  /** The icons' and shortcuts' action: the newest tab of `kind` in view, else a new one (fresh: always a new one). */
  async function showKind(kind, { fresh = false } = {}) {
    const def = registry.get(kind);
    if (!def) return null;
    follow();                                              // the page's context can arrive after its route (a project page's list)
    // The first open loads the server's shells first (D14), so a shell already running here is found in its tab, and the
    // terminal kind knows whether it is turned off, before this picks or opens a tab.
    if (!st.sessionsAsked && typeof refreshSessions === 'function') { st.sessionsAsked = true; await refreshSessions(); }
    const v = currentView();
    const tab = fresh ? null : model.newest(kind, v);
    if (!tab) return openNew(def, v, {}, null);
    await activate(tab, { focus: true });
    return tab;
  }
  /** A new tab of `def` holding `state`, in the view's run, chat or project. When the view opens none (a page about no
   *  run, chat or project; a run still starting) it goes to `fallback` instead and shows as a guest; with no fallback
   *  the + page says why. */
  async function openNew(def, v, state, fallback) {
    const why = unavailable(def, v);
    const scope = why ? fallback : (v.side || { type: 'project', id: v.project });
    if (!scope) { st.page = 'new'; st.note = why; await open(); return null; }
    const tab = model.open(def.kind, scope, state, { keep: keepIds() });
    if (!tab) { st.page = 'new'; st.note = 'Close a tab first: the panel holds at most 64.'; await open(); return null; }
    await activate(tab, { focus: true });
    return tab;
  }
  /** A new tab of `kind` holding `state` (the + page's Suggested rows, an Actions service's Open link). `scope`: where
   *  it goes when the page on screen has no run, chat or project of its own (the service's run). */
  async function openKind(kind, state = {}, { scope = null } = {}) {
    const def = registry.get(kind);
    if (!def) return null;
    follow();
    // follow() keeps the last view on a page about no run, chat or project (Settings): a tab that brings its own
    // scope (an Actions service's run) goes there as a guest, not into whatever project was open before.
    const onPage = !!viewOf(getPageContext ? getPageContext() : {});
    return openNew(def, scope && !onPage ? NO_VIEW : currentView(), state, scope);
  }
  /** The + page's Suggested rows changed (a service started or stopped): draw it again when it is on screen, keeping
   *  the focus on the row it was on. */
  function refreshNewPage() {
    if (!st.open || st.mounted || activeTab()) return;
    const had = body.contains(doc.activeElement) ? doc.activeElement.textContent : null;
    renderNewPage();
    if (had != null) [...body.querySelectorAll('button')].find((b) => b.textContent === had)?.focus();
  }
  /** Ctrl+` (and the project page's opener): hides the panel while that kind is on screen, or while the + page shows
   *  because that kind cannot open here (a page about no run, chat or project); else showKind. */
  function toggleKind(kind) {
    follow();
    const def = registry.get(kind);
    const v = currentView();
    const cannot = !!def && st.page === 'new' && !model.newest(kind, v) && !!unavailable(def, v);
    if (st.open && (activeTab()?.kind === kind || cannot)) { hide(); return; }
    showKind(kind);
  }
  async function closeTab(id) {
    const tab = model.get(id);
    if (!tab) return false;
    const def = registry.get(tab.kind);
    // Read before the kind's close: the server's closed frame can drop the tab from the model while it is answered.
    const shown = (st.open ? activeTab() : model.active(currentView()))?.id === id || st.mounted?.tab.id === id;
    const i = visibleOrder().findIndex((t) => t.id === id);
    if (typeof def?.close === 'function') {
      let ok = false;
      try { ok = await def.close(tab); } catch { ok = false; }
      if (!ok) return false;
    }
    if (st.mounted?.tab.id === id) unmountCurrent();
    if (st.guest === id) st.guest = null;
    model.close(id);
    let next = null;
    if (shown) {                                           // only the tab on screen hands over to its neighbour
      const rest = visibleOrder();
      const j = Math.min(Math.max(i, 0), rest.length - 1);
      // Never an assistant's undelivered Terminal tab: mounting it starts a shell the user never picked (D9, as active()).
      const startsShell = (t) => t.kind === 'terminal' && t.state?.openedBy === 'assistant' && !t.state?.sessionId;
      next = [...rest.slice(j), ...rest.slice(0, j).reverse()].find((t) => !startsShell(t)) || null;
      if (next && inView(next, currentView())) model.activate(currentView(), next.id);
    }
    await show();
    const focusId = next?.id || (st.open ? activeTab() : model.active(currentView()))?.id;
    if (focusId) focusStripTab(focusId);
    return true;
  }
  function setMax(on) {
    model.setPrefs({ max: on });
    doc.body.classList.toggle('tool-maxed', on);
    maxBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Restore the tool panel' : 'Maximize the tool panel';
    maxBtn.setAttribute('aria-label', label);
    maxBtn.title = label;
    maxBtn.replaceChildren(icon(doc, on ? 'restore' : 'maximize', 14));
  }
  function applyWidth(px) {
    const max = Math.round((win.innerWidth || 1600) * 0.6);
    const w = Math.max(MIN_W, Math.min(Number(px) || DEFAULT_WIDTH, max));
    doc.body.style.setProperty('--term-w', `${w}px`);
    return w;
  }
  const mq = typeof win.matchMedia === 'function' ? win.matchMedia(SHEET_QUERY) : null;
  /** D15: the narrow sheet covers the page, so the page behind it takes no focus or clicks (like the Chat run panel). */
  function syncSheet() {
    const sheet = !!(mq && mq.matches) && st.open;
    root.classList.toggle('is-sheet', sheet);
    const app = doc.querySelector('body > .app');
    if (app && sheet) { app.setAttribute('inert', ''); st.inerted = true; }
    else if (app && st.inerted) { app.removeAttribute('inert'); st.inerted = false; }
  }

  // ── the strip ────────────────────────────────────────────────────────────────────────────────────
  function titlesFor(list) {
    const seen = new Map();
    return list.map((t) => {
      const def = registry.get(t.kind);
      const base = def ? String(def.title(t) || def.label) : t.kind;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n > 1 ? `${base} ${n}` : base;
    });
  }
  function focusStripTab(id) {
    const b = id && tabsEl.querySelector(`.tool-tab-item[data-tab-id="${id}"] .tool-tab`);
    if (!b) return;
    for (const x of tabsEl.querySelectorAll('.tool-tab')) x.tabIndex = x === b ? 0 : -1;
    b.focus();
  }
  function renderStrip() {
    const { project, side } = visibleList();
    const act = st.open ? activeTab() : model.active(currentView());
    const all = [...project, ...side];
    const titles = titlesFor(all);
    const sig = JSON.stringify([act?.id || '', project.length, all.map((t, i) => [t.id, t.kind, t.scope.type, titles[i], t.state?.openedBy === 'assistant' ? 1 : 0])]);
    newBtn.setAttribute('aria-pressed', String(st.open && st.page === 'new'));
    if (sig === drawn.strip) return;
    drawn.strip = sig;
    const focused = tabsEl.contains(doc.activeElement) ? doc.activeElement.closest('.tool-tab-item')?.dataset.tabId : null;
    tabsEl.replaceChildren();
    all.forEach((t, i) => {
      if (i === project.length && project.length) { const d = make('span', 'tool-divider'); d.setAttribute('aria-hidden', 'true'); tabsEl.append(d); }
      tabsEl.append(tabItem(t, titles[i], t.id === act?.id));
    });
    if (!tabsEl.querySelector('.tool-tab[tabindex="0"]')) { const first = tabsEl.querySelector('.tool-tab'); if (first) first.tabIndex = 0; }
    if (focused) focusStripTab(focused);
  }
  function tabItem(tab, text, selected) {
    const def = registry.get(tab.kind);
    const item = make('span', `tool-tab-item${tab.scope.type === 'project' ? ' is-project' : ''}`);
    const byAssistant = tab.state?.openedBy === 'assistant';
    if (byAssistant) item.classList.add('is-assistant');
    item.dataset.tabId = tab.id;
    item.dataset.kind = tab.kind;   // chat links: rows and the live walk count tabs by kind
    const b = make('button', 'tool-tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(selected));
    b.setAttribute('aria-keyshortcuts', 'Delete Shift+ArrowLeft Shift+ArrowRight');
    b.tabIndex = selected ? 0 : -1;
    b.title = byAssistant ? `${text} · opened by the assistant` : text;
    b.append(icon(doc, def?.icon || 'none', 14), make('span', 'tool-tab-text', text));
    if (byAssistant) {
      const by = make('span', 'tool-tab-by');
      by.setAttribute('aria-label', 'opened by the assistant');
      by.append(icon(doc, 'skill', 10));
      b.append(by);
    }
    b.addEventListener('click', () => activate(tab, { focus: true }));
    b.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabMenu(tab, b); });
    b.addEventListener('keydown', (e) => onTabKey(e, tab, b));
    const x = make('button', 'tool-tab-close');
    x.type = 'button';
    x.tabIndex = -1;                                       // the keyboard closes with Delete or the tab menu
    x.setAttribute('aria-label', `Close ${text}`);
    x.title = 'Close this tab';
    x.append(icon(doc, 'x', 12));
    x.addEventListener('click', () => closeTab(tab.id));
    item.append(b, x);
    // Drag to reorder inside a group (the rank-list pattern in ask/widgets-input.mjs); the keyboard path is Shift+Arrow.
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      st.drag = tab.id;
      if (e.dataTransfer) { e.dataTransfer.setData('text/plain', tab.id); e.dataTransfer.effectAllowed = 'move'; }
      item.classList.add('is-dragging');
    });
    item.addEventListener('dragend', () => {
      st.drag = null;
      item.classList.remove('is-dragging');
      for (const n of tabsEl.querySelectorAll('.is-over')) n.classList.remove('is-over');
    });
    item.addEventListener('dragover', (e) => {
      const d = st.drag && model.get(st.drag);
      if (!d || d.id === tab.id || (d.scope.type === 'project') !== (tab.scope.type === 'project')) return;
      e.preventDefault();
      item.classList.add('is-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('is-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('is-over');
      const id = st.drag;
      st.drag = null;
      if (id && model.moveBefore(id, tab.id, currentView())) renderStrip();
    });
    return item;
  }
  function onTabKey(e, tab, b) {
    const tabs = [...tabsEl.querySelectorAll('.tool-tab')];
    const i = tabs.indexOf(b);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) { if (model.move(tab.id, d, currentView())) { renderStrip(); focusStripTab(tab.id); } return; }
      focusStripTab(tabs[(i + d + tabs.length) % tabs.length]?.closest('.tool-tab-item')?.dataset.tabId);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusStripTab((e.key === 'Home' ? tabs[0] : tabs.at(-1))?.closest('.tool-tab-item')?.dataset.tabId);
      return;
    }
    if (e.key === 'Delete') { e.preventDefault(); closeTab(tab.id); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openTabMenu(tab, b); }
  }
  function openTabMenu(tab, anchor) {
    const v = currentView();
    const pk = tab.scope.type === 'project' ? null : (tab.scope.projectKey || (inView(tab, v) ? v.project : null));
    const group = tab.scope.type === 'project' ? visibleList().project : visibleList().side;
    const i = group.findIndex((t) => t.id === tab.id);
    const moved = (fn) => () => { if (fn()) renderStrip(); focusStripTab(tab.id); };
    openMenu({ doc, anchor, label: 'Tab', items: [
      { label: 'Move to project', disabled: !pk,
        title: pk ? 'Keep this tab with the project: it shows beside every run and chat of it'
          : tab.scope.type === 'project' ? 'This tab is already with the project' : 'This run or chat has no single project',
        onSelect: () => { if (model.moveToProject(tab.id, pk)) { if (st.guest === tab.id) st.guest = null; show(); } } },
      { label: 'Move left', disabled: i <= 0, onSelect: moved(() => model.move(tab.id, -1, v)) },
      { label: 'Move right', disabled: i < 0 || i >= group.length - 1, onSelect: moved(() => model.move(tab.id, 1, v)) },
      { sep: true },
      { label: 'Close', onSelect: () => closeTab(tab.id) },
    ] });
  }

  // ── the + page ───────────────────────────────────────────────────────────────────────────────────
  function renderNewPage() {
    body.replaceChildren();
    body.dataset.kind = 'new';
    const v = currentView();
    const page = make('div', 'tool-newtab');
    page.append(make('h2', 'tool-newtab-title', 'Open a tool'));
    if (st.note) page.append(make('p', 'tool-note', st.note));
    const list = make('div', 'tool-newtab-list');
    for (const def of registry.list()) {
      const why = unavailable(def, v);
      const row = make('button', 'tool-newtab-row');
      row.type = 'button';
      row.dataset.toolKind = def.kind;
      row.disabled = !!why;
      if (why) row.title = why;
      row.append(icon(doc, def.icon, 16), make('span', 'tool-newtab-label', def.label));
      if (def.shortcut?.label) {
        const keys = make('span', 'tool-newtab-keys');
        for (const part of def.shortcut.label.split('+')) keys.append(make('kbd', 'kbd', part));
        row.append(keys);
      }
      row.addEventListener('click', () => showKind(def.kind, { fresh: true }));
      list.append(row);
    }
    page.append(list);
    // Running Actions services, recent addresses and the project's repo arrive through `suggest(view)`.
    const items = typeof suggest === 'function' ? (suggest(v) || []) : [];
    if (items.length) {
      const sec = make('section', 'tool-suggest');
      sec.append(make('h3', 'tool-newtab-sub', 'Suggested'));
      for (const it of items) {
        const row = make('button', 'tool-newtab-row');
        row.type = 'button';
        row.append(icon(doc, it.icon || 'external', 16), make('span', 'tool-newtab-label', it.label));
        if (it.detail) row.append(make('span', 'tool-newtab-detail', it.detail));
        row.addEventListener('click', () => it.open());
        sec.append(row);
      }
      page.append(sec);
    }
    const hidden = model.hidden(v).length;
    if (hidden) page.append(make('p', 'tool-newtab-hidden', `${hidden} ${hidden === 1 ? 'tab' : 'tabs'} in other chats and runs`));
    body.append(page);
  }

  // ── header icons (every empty [data-tool-icons] host) and the project page's opener ─────────────
  function fillIcons(hostEl) {
    const extra = registry.list().filter((d) => d.strip && !ICON_SLOTS.some((s) => s.kind === d.kind))
      .map((d) => ({ kind: d.kind, label: d.label, icon: d.icon }));
    for (const s of [...ICON_SLOTS, ...extra]) {
      const b = make('button', 'btn btn-sm btn-quiet btn-icon tool-icon');
      b.type = 'button';
      b.dataset.toolKind = s.kind;
      b.setAttribute('aria-label', s.label);
      b.append(icon(doc, s.icon, 16));
      hostEl.append(b);
    }
  }
  function syncIcons() {
    const v = currentView();
    const act = st.open ? activeTab() : null;
    for (const hostEl of doc.querySelectorAll('[data-tool-icons]')) {
      if (!hostEl.childElementCount) fillIcons(hostEl);
      for (const b of hostEl.querySelectorAll('.tool-icon')) {
        const k = b.dataset.toolKind;
        const def = registry.get(k);
        const slot = ICON_SLOTS.find((s) => s.kind === k);
        const label = def?.label || slot?.label || k;
        const why = def ? unavailable(def, v) : 'coming soon';
        b.disabled = !def || (!!why && !model.newest(k, v));
        b.title = b.disabled ? `${label}: ${why}`
          : `${label}${def.shortcut?.label ? ` (${def.shortcut.label})` : ''}. Shift-click opens another`;
        b.setAttribute('aria-pressed', String(!!act && act.kind === k));
      }
    }
    for (const b of doc.querySelectorAll('.term-opener')) b.setAttribute('aria-expanded', String(st.open));
  }

  // ── sessions, scopes, frames from app.js ─────────────────────────────────────────────────────────
  /** The terminal's server list changed: one tab per live shell (D3). */
  function syncSessions(list) {
    if (model.syncSessions(list, keepIds())) show(); else renderStrip();
  }
  /** A click on a command card's folder (and Resolve in a terminal): show that shell's tab, open the panel, focus it.
   *  Its tab may belong to another chat or run: it shows as a guest until the page changes. */
  async function showSession(id) {
    const find = () => model.tabs().find((t) => t.kind === 'terminal' && t.state.sessionId === id) || null;
    if (!find() && typeof refreshSessions === 'function') { st.sessionsAsked = true; await refreshSessions(); }
    const tab = find();
    if (!tab) return false;
    await activate(tab, { focus: true });
    return true;
  }
  /** Archiving a run or chat: its tabs go (their shells were closed by the server). */
  function closeScope(scope) {
    const gone = model.closeScope(scope);
    if (!gone.length) return 0;
    if (gone.some((t) => t.id === st.mounted?.tab.id)) unmountCurrent();
    if (gone.some((t) => t.id === st.guest)) st.guest = null;
    show();
    return gone.length;
  }
  const onContextChange = () => { win.setTimeout(() => { if (!st.destroyed) follow(); }, 0); };   // after showView syncs the hash

  // ── global listeners ─────────────────────────────────────────────────────────────────────────────
  // Capture phase (D16): inside the terminal xterm takes Ctrl+` as a keystroke and stops the event.
  const onDocKey = (e) => {
    const def = registry.matchShortcut(e);
    if (!def) return;
    e.preventDefault();
    e.stopPropagation();
    toggleKind(def.kind);
  };
  const onDocClick = (e) => {
    const b = e.target?.closest?.('.tool-icon[data-tool-kind]');
    if (!b || b.disabled) return;
    showKind(b.dataset.toolKind, { fresh: !!e.shiftKey });
  };
  const onHash = () => onContextChange();
  const onSheet = () => syncSheet();
  doc.addEventListener('keydown', onDocKey, true);
  doc.addEventListener('click', onDocClick);
  win.addEventListener('hashchange', onHash);
  mq?.addEventListener?.('change', onSheet);
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // A framed page (a Browser tab) would take the moves and the release, and the drag would stick to the pointer.
    doc.body.classList.add('tool-resizing');
    const move = (ev) => applyWidth((win.innerWidth || 0) - ev.clientX);
    const up = () => {
      doc.body.classList.remove('tool-resizing');
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', up);
      win.removeEventListener('blur', up);
      model.setPrefs({ width: parseInt(doc.body.style.getPropertyValue('--term-w'), 10) || DEFAULT_WIDTH });
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
    win.addEventListener('blur', up);
  });

  // ── boot ─────────────────────────────────────────────────────────────────────────────────────────
  const prefs = model.prefs();
  applyWidth(prefs.width);
  setMax(prefs.max);
  st.view = viewOf(getPageContext ? getPageContext() : {});
  renderStrip();
  void pullView(st.view);
  if (prefs.open) open();

  /** A tab of `kind` in `scope` holding `state` (chat links, issue 1064): the tab `match` finds there takes the state and
   *  comes forward (drawn again when it was on screen), else a new one opens. A scope that is not the page's own shows
   *  as a guest (the side column's chat on a run page). Opens the panel (the full-screen sheet when narrow); the focus
   *  moves into the tab. */
  async function openIn(kind, scope, state = {}, { match = null } = {}) {
    if (!registry.get(kind) || !scope) return null;
    follow();
    const key = scopeKey(scope);
    const hit = match ? model.tabs().find((t) => t.kind === kind && scopeKey(t.scope) === key && match(t)) : null;
    if (!hit) {
      const made = await kindApi.openTab(kind, scope, state);
      // the 64-tab cap: say so, as openNew does (tool-panel.mjs:195)
      if (!made) { st.page = 'new'; st.note = 'Close a tab first: the panel holds at most 64.'; await open(); }
      return made;
    }
    model.update(hit.id, state);
    // a Files tab draws its new line again; a Browser tab on the same address is never reloaded
    if (st.mounted?.tab.id === hit.id && kind === 'files') unmountCurrent();
    await activate(model.get(hit.id), { focus: true });
    return model.get(hit.id);
  }
  /** open_tab brought an open tab forward (an ask-tool-tabs frame with `focus`): EVERY page holding the tab takes
   *  `patch` (so its next mirror PUT keeps the new line instead of overwriting it, review minor 5); with `show` (the
   *  page shows that chat) it also comes forward when the panel is open. The keyboard focus stays where the person
   *  is typing. → false when this page does not hold the tab. */
  async function focusTab(id, patch = {}, { show = true } = {}) {
    const t = model.get(id);
    if (!t) return false;
    if (Object.keys(patch).length) model.update(id, patch);
    // only a Files tab with a new line is drawn again (a Browser focus frame has no target: never reload the page)
    const redraw = t.kind === 'files' && Object.keys(patch).length > 0 && st.mounted?.tab.id === id;
    if (!show) {
      if (redraw) { unmountCurrent(); await activate(model.get(id)); }   // on screen as a guest: redraw at the line
      return true;
    }
    if (!st.open) { if (inView(t, currentView())) model.activate(currentView(), id); renderStrip(); return true; }
    if (redraw) unmountCurrent();
    await activate(model.get(id));
    return true;
  }
  /** The assistant's new tabs of a chat that is not the page's own (the side column's): in the strip as guests. */
  async function pullChat(threadId) {
    if (!mirror || !threadId) return;
    const added = await mirror.pull({ type: 'chat', id: threadId }, { keep: keepIds() });
    if (!added.length || st.destroyed) return;
    const pick = [...added].reverse().find((t) => t.kind !== 'terminal');
    if (st.open && pick) await activate(pick); else show();
  }

  function destroy() {
    st.destroyed = true;
    win.clearTimeout(st.pendingTimer);
    doc.removeEventListener('keydown', onDocKey, true);
    doc.removeEventListener('click', onDocClick);
    win.removeEventListener('hashchange', onHash);
    mq?.removeEventListener?.('change', onSheet);
    unmountCurrent();
  }

  return { root, registry, open, hide, toggle: () => (st.open ? hide() : open({ focus: true })), isOpen: () => st.open,
    showKind, toggleKind, openKind, refreshNewPage, showSession, syncSessions, syncIcons, onContextChange, closeScope,
    pullMirror: () => pullView(currentView()), view: () => currentView(), destroy, openIn, focusTab, pullChat };
}
