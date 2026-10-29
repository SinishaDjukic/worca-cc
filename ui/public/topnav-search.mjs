// ui/public/topnav-search.mjs — the top bar's "Search or ask" combobox: the input, its listbox
// popover and the ⌘K / Ctrl+K chord. Pure DOM over the markup in index.html (.tsearch); the rows
// come from global-search.mjs over the sources app.js hands in, so this module holds no app state.
//
//   const search = createTopnavSearch({ doc, win, root, getSources, loadLazy, onAsk, navigate, openWorkflow, onLabel });
//   getSources()      the current sources (global-search.mjs shape), read on every render
//   loadLazy()        fetch what is not kept in memory (workflows, schedules); called once per open,
//                     the popover re-renders when it settles
//   onAsk(query)      the Ask Worca row ('' when nothing is typed)
//   askRow()          the Ask row's words, read at render ({ title, meta }; default Ask in Chat · opens a chat)
//   navigate(href)    a row with a route ('#running/…', '#projects/…', …)
//   openWorkflow(id)  a workflow row
//   onLabel(label)    a "Runs labelled hotfix" row: apply the Runs list label filter
//   openSetting(row)  a Settings, Add-ons or Plugins row; a locked one carries row.locks (default: navigate(row.href))
//   searchChats(q)    #948 s2: the Chats group's rows (global-search.mjs chatRows), async; null = none
//   chatsFirst()      the Chats group leads (the Chat page); else it follows Runs
//
// Focus stays in the input while the popover is open: the rows are options it points at with
// aria-activedescendant. ⌘K / Ctrl+K and a consumed Escape are read in the capture phase on the
// document — app.js creates this before any page-level Escape handler, and stopImmediatePropagation
// keeps a run's detail from stepping back on the same key.
import { searchRows, shortcutLabel, isSearchCombo } from './global-search.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Lucide, 24-unit grid (the canvas kit's icon set).
const ICONS = Object.freeze({
  project: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  workspace: ['M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z',
    'm22 17.6-9.2 4.2a2 2 0 0 1-1.6 0L2 17.6', 'm22 12.6-9.2 4.2a2 2 0 0 1-1.6 0L2 12.6'],
  workflow: ['M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M7 11v4a2 2 0 0 0 2 2h4',
    'M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z'],
  schedule: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  ticket: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2'],
  label: ['M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', 'M7.5 7.5h.01'],
  setting: ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
  addon: ['M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
    'M12 22V12', 'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7', 'm7.5 4.27 9 5.15'],
  plugin: ['M9 3v5', 'M15 3v5', 'M6 8h12v3a6 6 0 0 1-12 0V8z', 'M12 17v4'],
  ask: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
  chat: ['M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12z'],   // icons.mjs `chat`
});

function icon(doc, kind) {
  const s = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'tsearch-ic', viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    s.setAttribute(k, String(v));
  }
  for (const d of ICONS[kind] || []) {
    const p = doc.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
}

function span(doc, cls, text) {
  const n = doc.createElement('span');
  n.className = cls;
  n.textContent = text;
  return n;
}

/** A key the IME still owns: mid-composition, or WebKit's committing keydown (isComposing false, keyCode 229). */
function imeKey(e) {
  return !!(e.isComposing || e.keyCode === 229);
}

export function createTopnavSearch({ doc, win, root, getSources, loadLazy, onAsk, navigate, openWorkflow, onLabel = () => {},
  openSetting = (row) => navigate(row.href), askRow = () => ({ title: 'Ask in Chat', meta: 'opens a chat' }), searchChats = null,
  chatsFirst = () => false }) {
  const input = root.querySelector('#tsearch-input');
  const pop = root.querySelector('#tsearch-pop');
  const kbd = root.querySelector('.tsearch-kbd');
  const openBtn = root.querySelector('#tsearch-open');
  const closeBtn = root.querySelector('#tsearch-close');
  const st = { open: false, items: [], active: -1, prev: null, gen: 0 };
  if (kbd) kbd.textContent = shortcutLabel(win);
  // #948 s2: chats come from the server (title and message text), debounced; the last answer for the current query wins.
  const chats = { query: '', rows: [], timer: null, gen: 0 };
  function queueChats(query) {
    if (chats.timer) win.clearTimeout(chats.timer);
    if (!searchChats || !query) { chats.query = ''; chats.rows = []; return; }
    const gen = ++chats.gen;
    chats.timer = win.setTimeout(() => {
      Promise.resolve(searchChats(query)).catch(() => []).then((rows) => {
        if (gen !== chats.gen) return;
        chats.query = query;
        chats.rows = Array.isArray(rows) ? rows : [];
        if (st.open) render({ keep: true });
      });
    }, 150);
  }

  function option(id, kind, row, label) {
    const o = doc.createElement('div');
    o.id = id;
    o.className = `tsearch-opt tsearch-opt-${kind}`;
    o.setAttribute('role', 'option');
    o.setAttribute('aria-selected', 'false');
    o.setAttribute('aria-label', label);
    if (kind === 'run') {
      const dot = span(doc, `tsearch-dot tone-${row.tone || 'idle'}`, '');
      dot.setAttribute('aria-hidden', 'true');
      o.appendChild(dot);
    } else o.appendChild(icon(doc, kind));
    // #948 s2: a chat that matched on a message shows the snippet under its title.
    const title = span(doc, 'tsearch-title', row.title);
    if (row.sub) {
      const tx = span(doc, 'tsearch-tx', '');
      tx.append(title, span(doc, 'tsearch-sub', row.sub));
      o.append(tx, span(doc, 'tsearch-meta', row.meta));
    } else o.append(title, span(doc, 'tsearch-meta', row.meta));
    // A locked Settings row: what unlocks it, on a line of its own so the meta's ellipsis never cuts it.
    if (row.note) { o.classList.add('is-locked'); o.appendChild(span(doc, 'tsearch-note', row.note)); }
    return o;
  }

  function group(key, label, rows) {
    const g = doc.createElement('div');
    g.className = 'tsearch-group';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-labelledby', `tsearch-g-${key}`);
    const head = span(doc, 'tsearch-label', label);
    head.id = `tsearch-g-${key}`;
    head.setAttribute('role', 'presentation');
    g.appendChild(head);
    for (const row of rows) {
      const id = `tsearch-opt-${st.items.length}`;
      const label = [row.title, row.kind === 'plugin' ? row.sub : '', row.meta, row.note].filter(Boolean).join(', ');
      const el = option(id, row.kind, row, label);
      st.items.push({ key: `${row.kind}:${row.id}`, row, el });
      g.appendChild(el);
    }
    return g;
  }

  /** Paint the popover. `keep`: hold the active row (by key) across a repaint the user did not cause. */
  function render({ keep = false } = {}) {
    if (!st.open) return;
    const query = input.value.trim();
    const was = keep && st.items[st.active] ? st.items[st.active].key : '';
    const { runs, other, settings = [], addons = [], plugins = [] } = searchRows(getSources() || {}, query);
    st.items = [];
    const chatsRows = chats.query === query ? chats.rows : [];
    const first = chatsFirst();
    const parts = [];
    if (chatsRows.length && first) parts.push(group('chats', 'Chats', chatsRows));
    if (runs.length) parts.push(group('runs', 'Runs', runs));
    if (chatsRows.length && !first) parts.push(group('chats', 'Chats', chatsRows));
    if (other.length) parts.push(group('other', 'Projects, workflows, schedules', other));
    if (settings.length) parts.push(group('settings', 'Settings', settings));
    if (addons.length) parts.push(group('addons', 'Add-ons', addons));
    if (plugins.length) parts.push(group('plugins', 'Plugins', plugins));
    if (query && !parts.length) {
      const none = span(doc, 'tsearch-none', 'No matches');
      none.setAttribute('role', 'presentation');
      parts.push(none);
    }
    if (parts.length) {
      const sep = doc.createElement('div');
      sep.className = 'tsearch-sep';
      sep.setAttribute('aria-hidden', 'true');
      parts.push(sep);
    }
    // Ask worca beside the page: on a page with the side column the row names it (app.js askRow).
    let words = null;
    try { words = askRow(); } catch { words = null; }
    const title = words && typeof words.title === 'string' && words.title ? words.title : 'Ask in Chat';
    const meta = words && typeof words.meta === 'string' ? words.meta : 'opens a chat';
    const ask = option(`tsearch-opt-${st.items.length}`, 'ask', { title, meta }, `${title}, ${meta}`);
    st.items.push({ key: 'ask', row: null, el: ask });
    parts.push(ask);
    pop.replaceChildren(...parts);
    const at = was ? st.items.findIndex((it) => it.key === was) : -1;
    setActive(at >= 0 ? at : 0, { scroll: false });
  }

  function setActive(i, { scroll = true } = {}) {
    st.active = st.items.length ? (i + st.items.length) % st.items.length : -1;
    st.items.forEach((it, n) => {
      it.el.setAttribute('aria-selected', n === st.active ? 'true' : 'false');
      it.el.classList.toggle('is-active', n === st.active);
    });
    const cur = st.items[st.active];
    if (cur) input.setAttribute('aria-activedescendant', cur.el.id);
    else input.removeAttribute('aria-activedescendant');
    if (scroll && cur && typeof cur.el.scrollIntoView === 'function') cur.el.scrollIntoView({ block: 'nearest' });
  }

  function open({ from = null, select = false } = {}) {
    if (!st.open) {
      // The phone's search button is the one control inside the search that focus goes back to.
      const a = from || doc.activeElement;
      st.prev = a && a !== doc.body && (!root.contains(a) || a === openBtn) ? a : null;
      st.open = true;
      root.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      pop.hidden = false;
      render();
      const gen = ++st.gen;
      Promise.resolve()
        .then(() => (typeof loadLazy === 'function' ? loadLazy() : null))
        .then(() => { if (st.open && st.gen === gen) render({ keep: true }); }, () => {});
    }
    if (doc.activeElement !== input) input.focus();
    if (select) input.select();
  }

  /** Close; `refocus` hands focus back to where it was before the search took it (else it leaves the input). */
  function close({ refocus = false } = {}) {
    const had = root.contains(doc.activeElement);
    if (st.open) {
      st.open = false;
      st.gen += 1;
      root.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      pop.hidden = true;
      pop.replaceChildren();
      st.items = [];
      st.active = -1;
    }
    const prev = st.prev;
    st.prev = null;
    if (!refocus || !had) return;
    if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus();
    if (root.contains(doc.activeElement) && doc.activeElement !== prev) doc.activeElement.blur();
  }

  function activate(i) {
    const it = st.items[i];
    if (!it) return;
    const query = input.value.trim();
    input.value = '';
    close();
    input.blur();
    if (!it.row) onAsk(query);
    else if (it.row.kind === 'workflow') openWorkflow(it.row.workflowId);
    else if (it.row.kind === 'label') onLabel(it.row.label);
    else if (it.row.kind === 'setting' || it.row.kind === 'addon' || it.row.kind === 'plugin') openSetting(it.row);
    else navigate(it.row.href);
  }

  function onDocKey(e) {
    if (isSearchCombo(e)) {
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('.term-pane')) return;   // the shell's kill-line
      if (e.isComposing || root.closest('[inert]')) return;
      // An open modal (the app's .viewer-modal overlays, a native dialog) or a running tour keeps its keys and its focus.
      if (doc.querySelector('.viewer-modal:not(.hidden), dialog[open], .guide-layer')) return;
      e.preventDefault();
      if (e.repeat) return;                        // a held chord toggles nothing (and never reaches the browser's own Ctrl+K)
      if (st.open && doc.activeElement === input) close({ refocus: true });
      else open({ select: true });
      return;
    }
    if (e.key !== 'Escape' || imeKey(e)) return;
    if (e.target !== input && !(st.open && root.contains(doc.activeElement))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close({ refocus: true });
  }

  function onDocPointerdown(e) {
    if (st.open && !root.contains(e.target)) close();
  }

  input.addEventListener('focus', (e) => open({ from: e.relatedTarget }));
  input.addEventListener('input', () => { queueChats(input.value.trim()); if (st.open) render(); else open(); });
  input.addEventListener('keydown', (e) => {
    if (imeKey(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!st.open) open();
      else setActive(st.active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && st.open && st.active >= 0) {
      e.preventDefault();
      activate(st.active);
    }
  });
  root.addEventListener('focusout', (e) => { if (st.open && !root.contains(e.relatedTarget)) close(); });
  // A press inside the popover or on the close button keeps focus in the input (no blur, no early close).
  for (const n of [pop, closeBtn]) if (n) n.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('pointermove', (e) => {
    const o = e.target && typeof e.target.closest === 'function' ? e.target.closest('[role="option"]') : null;
    const i = o ? st.items.findIndex((it) => it.el === o) : -1;
    if (i >= 0 && i !== st.active) setActive(i, { scroll: false });
  });
  pop.addEventListener('click', (e) => {
    const o = e.target && typeof e.target.closest === 'function' ? e.target.closest('[role="option"]') : null;
    const i = o ? st.items.findIndex((it) => it.el === o) : -1;
    if (i >= 0) activate(i);
  });
  if (openBtn) openBtn.addEventListener('click', () => open());
  if (closeBtn) closeBtn.addEventListener('click', () => close({ refocus: true }));
  doc.addEventListener('keydown', onDocKey, true);
  doc.addEventListener('pointerdown', onDocPointerdown, true);

  return Object.freeze({
    open,
    close,
    isOpen: () => st.open,
    render: () => render({ keep: true }),
    destroy() {
      if (chats.timer) win.clearTimeout(chats.timer);
      close();
      doc.removeEventListener('keydown', onDocKey, true);
      doc.removeEventListener('pointerdown', onDocPointerdown, true);
    },
  });
}
