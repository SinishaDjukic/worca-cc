// The Chats column (issue #948 slice 2, flag chatsColumn), mounted by ask-panel.mjs into its aside.chat-history. The Runs
// list's parts: the head (Chats + View), the view chip, renderRunsList's sections, rows and notes, the ⋯ menu (openMenu),
// the .runs-bulk bar (list-dom.mjs paintBulkBar), createRunsSelection / rangeKeys, the roving Tab stop (list-dom.mjs
// createListRove), the resize handle and the shared list keys. It owns the fetch and the paging; the panel owns
// opening, new chat, rename and delete (deps).
import { renderRunsList } from './runs-list.mjs';
import { createRunsSelection, rangeKeys } from './runs-selection.mjs';
import { listKeyAction, LIST_FIELD, isMac } from './list-keys.mjs';
import { createListRove, paintBulkBar, navKey } from './list-dom.mjs';
import { mountRunsResize } from './runs-resize.mjs';
import { openMenu } from './workflows/menu.mjs';
import { notify } from './feedback.mjs';
import { icon } from './icons.mjs';
import { CHAT_BUSY } from '../../src/shared/chat-busy.mjs';
import { buildChatsModel, chatArchivePlan, chatRowMenuItems, chatsViewChip, chatsViewMenuItems, loadChatsView,
  saveChatsView, DEFAULT_CHATS_VIEW, CHATS_PAGE, CHATS_EMPTY, CHATS_LOADING, CHATS_OFFLINE, CHATS_LIST_W_KEY } from './chats-list.mjs';

// The route's own clamp. A refresh re-reads as many chats as are loaded, up to this; past it the refresh keeps the
// first MAX_PAGE and the cursor after them, so "Show older" / "Show more" carries on from there (rows loaded beyond
// MAX_PAGE drop out of the list until paged in again).
const MAX_PAGE = 200;

export function mountChatsColumn({ host, fetch: fetchImpl, storage, win, now = () => Date.now(), level = () => 'simple',
  scopeName = () => '', currentId = () => null, onOpen, onRename, onDelete, onHelp = () => {} }) {
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // focusKey uses list-dom.mjs's navKey form (`row:chat:ID`, `sec:older`), as runsUi does.
  const st = { view: loadChatsView(storage), threads: [], cursor: null, total: null, counts: {}, gen: 0, olderOpen: false,
    collapsed: new Set(), sel: createRunsSelection(), selecting: false, anchorKey: null, focusKey: null, near: [], byKey: new Map(),
    model: null, timer: null, cmd: new Map(), destroyed: false, loaded: false, failed: false };

  // Head, chip, list, bar: the Runs markup (index.html #runs-list-pane and #runs-bulk), built here because ask-panel
  // builds the whole aside in JS.
  const head = el('div', 'runs-head');
  const viewBtn = el('button', 'btn btn-sm btn-quiet runs-view-btn', 'View ');
  viewBtn.type = 'button';
  viewBtn.id = 'chats-view-btn';
  viewBtn.setAttribute('aria-haspopup', 'menu');
  viewBtn.setAttribute('aria-expanded', 'false');
  viewBtn.append(icon(doc, 'chevron-down', 14));
  head.append(el('h2', 'runs-head-title', 'Chats'), viewBtn);
  const chip = el('div', 'runs-view-chip');
  chip.id = 'chats-view-chip';
  chip.hidden = true;
  const chipT = el('span', 'runs-view-chip-t');
  const reset = el('button', 'btn btn-sm btn-quiet btn-icon runs-view-reset');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset view');
  reset.title = 'Reset view';
  reset.append(icon(doc, 'x', 12));
  chip.append(chipT, reset);
  const list = el('div', 'runs-list chats-list');
  list.id = 'chats-list';
  list.setAttribute('aria-label', 'Chats');
  const bar = el('div', 'runs-bulk');
  bar.id = 'chats-bulk';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected chats');
  bar.hidden = true;
  const archBtn = el('button', 'btn btn-sm');
  archBtn.type = 'button';
  archBtn.dataset.bulk = 'archive';
  archBtn.append(el('span', 'runs-bulk-w', 'Archive'), ' ', el('span', 'runs-bulk-c', '0'));
  const cancelBtn = el('button', 'btn btn-sm btn-quiet', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.dataset.bulk = 'cancel';
  bar.append(el('span', 'runs-bulk-n', '0 selected'), archBtn, cancelBtn);
  host.classList.add('chats-col');
  host.replaceChildren(head, chip, list, bar);
  const rove = createListRove({ host: list, state: st });   // the Runs list's one Tab stop (list-dom.mjs)
  const page = host.closest('[data-chat-page]') || host.parentElement;
  const resize = mountRunsResize(page, { storage, win, key: CHATS_LIST_W_KEY, cssVar: '--chats-list-w', paneSel: '.chat-history',
    label: 'Resize the chats list' });

  // ---- data ----
  const query = (extra = {}) => new URLSearchParams({ show: st.view.show,
    sort: st.view.groupBy === 'date' && st.view.show === 'all' ? 'activity' : st.view.sort,
    limit: String(extra.limit || CHATS_PAGE), ...(extra.cursor ? { cursor: extra.cursor } : {}) }).toString();
  async function load({ cursor = null } = {}) {
    const gen = ++st.gen;
    const limit = cursor ? CHATS_PAGE : Math.min(MAX_PAGE, Math.max(CHATS_PAGE, st.threads.length));
    let body = null;
    try {
      const r = await fetchImpl(`/api/ask/threads?${query({ limit, cursor })}`);
      body = r && r.ok ? await r.json() : null;
    } catch { body = null; }
    if (st.destroyed || gen !== st.gen) return;
    if (!body || !Array.isArray(body.threads)) {
      // Nothing loaded yet: the offline note with Try again. Rows on screen: keep them and say so once.
      if (!st.threads.length) { st.failed = true; paint(); }
      else notify({ tone: 'err', title: 'Could not load the chats', key: 'chats-load' }, { doc });
      return;
    }
    if (cursor) {
      const have = new Set(st.threads.map((t) => t.id));
      st.threads = [...st.threads, ...body.threads.filter((t) => !have.has(t.id))];
    } else st.threads = body.threads;
    st.cursor = body.cursor || null;
    st.total = Number.isFinite(body.total) ? body.total : st.threads.length;
    st.counts = body.counts || {};
    st.loaded = true;
    st.failed = false;
    paint();
  }
  const refresh = () => load();
  function scheduleRefresh() {
    if (st.timer) return;
    st.timer = win.setTimeout(() => { st.timer = null; void refresh(); }, 250);
  }

  // ---- paint ----
  function paint() {
    if (st.destroyed) return;
    const hadFocus = list.contains(doc.activeElement);
    st.model = buildChatsModel({ threads: st.threads, view: st.view, total: st.total, more: !!st.cursor, olderOpen: st.olderOpen,
      collapsed: st.collapsed, scopeName, now: now() });
    st.byKey = new Map(st.model.sections.flatMap((s) => s.rows).map((r) => [r.key, r]));
    st.sel.prune(new Set(st.byKey.keys()));
    const checked = new Set([...st.sel.keys()]);
    list.replaceChildren(...renderRunsList(doc, st.model, { checked, selecting: st.selecting || st.sel.size > 0,
      emptyText: 'No chats yet.', emptyByShow: CHATS_EMPTY, loading: !st.loaded && !st.failed, offline: st.failed,
      retry: st.failed, loadingText: CHATS_LOADING, offlineText: CHATS_OFFLINE }));
    paintCurrent();
    paintChip();
    paintBar();
    // A focused row the repaint dropped (E, a bulk archive) hands its stop to the nearest row still shown.
    if (st.near.length && !rove.find([st.focusKey])) { const n = rove.find(st.near); if (n) st.focusKey = navKey(n); }
    st.near = [];
    const target = rove.rove();
    if (hadFocus && target) target.focus();
  }
  function paintCurrent() {
    const id = currentId();
    for (const a of list.querySelectorAll('a.runs-row')) {
      const on = !!id && a.dataset.rowKey === `chat:${id}`;
      a.classList.toggle('selected', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
  }
  function paintChip() {
    const t = chatsViewChip(st.view, { shown: st.total ?? st.threads.length });
    chip.hidden = !t;
    chipT.textContent = t;
  }
  const selectedRows = () => [...st.sel.keys()].map((k) => st.byKey.get(k)).filter(Boolean);
  function paintBar() {
    const on = st.selecting || st.sel.size > 0;
    bar.hidden = !on;
    list.classList.toggle('is-selecting', on);
    if (!on) return;
    const unarchive = st.view.show === 'archived';
    const plan = chatArchivePlan(selectedRows(), { unarchive });
    paintBulkBar(bar, { label: `${st.sel.size} selected`,
      actions: { archive: { count: plan.count, title: plan.title, word: unarchive ? 'Restore' : 'Archive' } } });
  }

  // ---- actions ----
  const patch = (id, body) => fetchImpl(`/api/ask/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  /** Before rows leave: every stop after the focused one, then those before it (nearest first), minus the leaving. */
  function noteNear(rows) {
    const keys = rove.items().map(navKey);
    const gone = new Set(rows.map((r) => `row:${r.key}`));
    const i = keys.indexOf(st.focusKey);
    st.near = i < 0 ? [] : [...keys.slice(i + 1), ...keys.slice(0, i).reverse()].filter((k) => !gone.has(k));
  }
  async function archive(rows, { unarchive = false } = {}) {
    const plan = chatArchivePlan(rows, { unarchive });
    if (!plan.count) return;
    noteNear(plan.apply);
    const done = [];
    let error = '';
    for (const r of plan.apply) {
      const res = await patch(r.id, { archived: !unarchive }).catch(() => null);
      if (res && res.ok) done.push(r);
      else if (!error) error = res ? ((await res.json().catch(() => ({}))).error || '') : 'The server is not reachable.';
    }
    st.sel.clear();
    st.selecting = false;
    await refresh();
    const word = (n) => `${n} chat${n === 1 ? '' : 's'}`;
    if (done.length) {
      notify({ tone: 'ok', title: `${unarchive ? 'Restored' : 'Archived'} ${word(done.length)}`, detail: plan.title,
        action: unarchive ? null : { label: 'Undo', run: async () => { for (const r of done) await patch(r.id, { archived: false }).catch(() => null); await refresh(); } } }, { doc });
    }
    if (error) notify({ tone: 'err', title: `Could not ${unarchive ? 'restore' : 'archive'} the chat`, detail: error }, { doc });
  }
  async function pin(r) {
    await patch(r.id, { pinned: !r.pinned }).catch(() => null);
    await refresh();
  }
  function toggleSel(key) {
    st.sel.toggle(key);
    st.anchorKey = key;
    if (!st.sel.size) st.selecting = false;
    paint();
  }
  const on = {
    select: (r) => { st.selecting = true; if (!st.sel.has(r.key)) toggleSel(r.key); else paint(); },
    rename: (r) => onRename(r),
    pin,
    archive,
    del: (r) => onDelete(r),
  };
  const menuItems = (r) => chatRowMenuItems(r, { mac: isMac(win), on });
  function openRowMenu(r, anchor) {
    openMenu({ doc, anchor, items: menuItems(r), align: 'end', label: `More for ${r.title}` });
  }
  function toggleSection(id, open = null) {
    if (id === 'older') st.olderOpen = open == null ? !st.olderOpen : open;
    else if (id) { const shut = open == null ? !st.collapsed.has(id) : !open; if (shut) st.collapsed.add(id); else st.collapsed.delete(id); }
    st.focusKey = `sec:${id}`;
    paint();
  }

  // ---- events ----
  list.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-runs-retry]')) { st.failed = false; paint(); void refresh(); return; }
    const more = t.closest('.runs-more');
    if (more) { e.preventDefault(); const r = st.byKey.get(more.dataset.rowKey); if (r) openRowMenu(r, more); return; }
    const box = t.closest('.runs-check');
    if (box) { const k = box.closest('.runs-item')?.dataset.rowKey; if (k) { e.preventDefault(); toggleSel(k); } return; }
    const secHead = t.closest('button.runs-sec-head');
    if (secHead) { toggleSection(secHead.dataset.sectionKey); return; }
    if (t.closest('.runs-older')) { void load({ cursor: st.cursor }); return; }
    const a = t.closest('a.runs-row');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      const r = st.byKey.get(a.dataset.rowKey);
      if (!r) return;
      if (st.selecting || st.sel.size) { toggleSel(r.key); return; }
      st.focusKey = navKey(a);
      onOpen(r.id);
    }
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target;
    const rowEl = t.closest('a.runs-row');
    const act = listKeyAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey,
      targetIsRow: !!rowEl, inField: !!t.closest(LIST_FIELD) }, { size: st.sel.size, list: 'chats', level: level() });
    if (!act || act === 'help') return;     // `?` is the panel's page-wide key
    const r = rowEl ? st.byKey.get(rowEl.dataset.rowKey) : null;
    const nav = t.closest('a.runs-row, button.runs-sec-head');
    e.preventDefault();
    switch (act) {
      case 'down': case 'up': rove.move(nav, act === 'down' ? 1 : -1); return;
      case 'extend-down': case 'extend-up': {
        if (!r) return;
        const stops = rove.items();
        const next = stops[stops.indexOf(nav) + (act === 'extend-down' ? 1 : -1)];
        const nk = next && next.dataset.rowKey;
        if (!nk) return;
        st.selecting = true;
        if (!st.anchorKey) st.anchorKey = r.key;
        st.sel.selectAll(rangeKeys(stops.map((n) => n.dataset.rowKey).filter(Boolean), st.anchorKey, nk));
        paint();
        st.focusKey = `row:${nk}`;   // after the paint, as Runs' extendRunsSelection (slice 1 cycle 2)
        rove.focus(rove.rove());
        return;
      }
      case 'open': if (r) { st.focusKey = navKey(rowEl); onOpen(r.id); } return;
      case 'unfold': case 'fold': {
        const h = t.closest('button.runs-sec-head');
        if (h) toggleSection(h.dataset.sectionKey, act === 'unfold');
        return;
      }
      case 'menu': if (r) openRowMenu(r, rowEl.closest('.runs-item').querySelector('.runs-more')); return;
      case 'toggle': if (r) { st.selecting = true; toggleSel(r.key); } return;
      case 'all': st.selecting = true; st.sel.selectAll([...st.byKey.keys()]); paint(); return;
      case 'clear': st.sel.clear(); st.selecting = false; paint(); return;
      default: break;
    }
    if (act === 'archive' && st.sel.size) { void archive(selectedRows(), { unarchive: st.view.show === 'archived' }); return; }
    if (!r) return;
    // A busy row's Archive is disabled in ⋯; from the keyboard the reason comes as a toast (no hover there).
    if (act === 'archive' && r.busy && !r.isArchived) { notify({ tone: 'info', title: CHAT_BUSY[r.busy], key: 'chat-busy' }, { doc }); return; }
    const it = menuItems(r).find((x) => x.key === act);       // a key does exactly what its ⋯ item does (slice 1 D5)
    if (it && !it.disabled) it.onSelect();
  });
  viewBtn.addEventListener('click', () => {
    openMenu({ doc, anchor: viewBtn, align: 'end', label: 'View', items: chatsViewMenuItems(st.view, st.counts, { onPick: (p) => {
      if (p.select) { st.selecting = true; paint(); return; }
      if (p.shortcuts) { onHelp(viewBtn); return; }
      setView(p);
    } }) });
  });
  reset.addEventListener('click', () => setView({ ...DEFAULT_CHATS_VIEW }));
  function setView(p) {
    st.view = { ...st.view, ...p };
    saveChatsView(storage, st.view);
    st.threads = [];
    st.cursor = null;
    st.total = null;          // "Loading chats…" until the new view answers, never the old view's count
    st.loaded = false;
    st.sel.clear();
    st.olderOpen = false;
    paint();
    void refresh();
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b || b.disabled) return;
    if (b.dataset.bulk === 'cancel') { st.sel.clear(); st.selecting = false; paint(); return; }
    void archive(selectedRows(), { unarchive: st.view.show === 'archived' });
  });

  paint();   // "Loading chats…" until the first answer
  return {
    refresh,
    paintCurrent,
    /** A WS frame the panel saw: a command starting or ending changes a chat's busy state (ask-command tails do not). */
    onFrame(f) {
      // Clear chat history: the chats it names (every one when it names none) leave at once, then the list re-reads.
      if (f && f.type === 'ask-history-cleared') {
        const gone = Array.isArray(f.threadIds) ? new Set(f.threadIds) : null;
        st.threads = gone ? st.threads.filter((t) => !gone.has(t.id)) : [];
        if (!gone) { st.cursor = null; st.total = 0; st.counts = {}; }
        paint();
        scheduleRefresh();
        return;
      }
      if (!f || f.type !== 'ask-command' || !f.command) return;
      const k = `${f.threadId}:${f.command.blockId}`;
      if (st.cmd.get(k) === f.command.status) return;
      st.cmd.set(k, f.command.status);
      scheduleRefresh();
    },
    focusList() { const n = rove.rove(); if (n) n.focus(); return !!n; },
    /** The chat before (-1) or after (+1) `id` in the list as shown, or null. */
    neighbour(id, dir) {
      const keys = [...list.querySelectorAll('a.runs-row')].map((a) => a.dataset.rowKey);
      const i = keys.indexOf(`chat:${id}`);
      const k = i < 0 ? keys[dir > 0 ? 0 : keys.length - 1] : keys[i + dir];
      return k ? k.slice('chat:'.length) : null;
    },
    focusTarget: () => rove.rove() || viewBtn,
    destroy() {
      st.destroyed = true;
      if (st.timer) win.clearTimeout(st.timer);
      resize.destroy();
      host.classList.remove('chats-col');
      host.replaceChildren();
    },
  };
}
