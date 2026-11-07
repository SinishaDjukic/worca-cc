// ui/public/tool-overview.mjs — the tool panel's Overview (issue 1064): what the panel shows for a run, chat or project
// with no tab selected. It is a view of the panel, not a tab or a kind. A quiet list: small section labels, rows of
// icon + one line + right-aligned meta, collapsible sections with a count, empty sections hidden, one quiet line when
// nothing has anything. The sections come from `source(view)` (tool-overview-sources.mjs); each settles on its own,
// so a slow one never holds up the others, and a mount generation drops answers that arrive after the view changed.
import { icon } from './icons.mjs';
import { paintStatusDot } from './status-dot.mjs';
import { viewKey as keyOfView } from './tool-tabs.mjs';
import { ctxRing, paintCtxRing } from './ask-context-view.mjs';

const FOCUSABLE = '.tov-head, .tov-row, .tov-stop, .tov-more';
let idSeq = 0;

/**
 * `source(view)` → Section[] | null (null: this view has no Overview). Section, Row: plan §3.2. A section with
 * `quiet: true` is drawn muted; a row with `child: true` is indented under the row before it with a ↳.
 * Collapsed and "Show all" choices are kept per section id in memory for the controller's lifetime (D11).
 */
export function createOverview({ doc, win, source }) {
  const collapsed = new Map();   // section id → boolean (absent: the section's default)
  const showAll = new Set();     // section ids whose "Show all N" was pressed
  const uid = ++idSeq;
  let m = null;                  // the mount: { gen, ac, host, key, root, empty, slots, unsubs, timers }
  let gen = 0;

  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const isCollapsed = (sec) => (collapsed.has(sec.id) ? collapsed.get(sec.id) : sec.collapsed === true);

  function unmount() {
    gen += 1;
    const cur = m;
    m = null;
    if (!cur) return;
    try { cur.ac.abort(); } catch { /* already */ }
    for (const u of cur.unsubs) { try { u(); } catch { /* a source's own trouble */ } }
    for (const t of cur.timers) win.clearInterval(t);
    cur.root.remove();
  }

  function mount(host, view, { expand = null } = {}) {
    unmount();
    if (expand) collapsed.set(expand, false);
    const my = ++gen;
    const ac = new AbortController();
    const root = make('div', 'tov');
    root.tabIndex = -1;
    root.addEventListener('keydown', onKey);
    const empty = make('p', 'tov-empty', 'Nothing here yet.');
    empty.hidden = true;
    m = { gen: my, ac, host, key: keyOfView(view), root, empty, slots: [], unsubs: [], timers: [] };
    let sections = null;
    try { sections = source(view); } catch { sections = null; }
    for (const sec of Array.isArray(sections) ? sections : []) {
      if (!sec || typeof sec.id !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(sec.id)) continue;
      const slot = buildSlot(sec);
      m.slots.push(slot);
      root.append(slot.el);
    }
    root.append(empty);
    host.append(root);
    const cur = m;
    for (const slot of cur.slots) {
      load(cur, slot);
      if (typeof slot.sec.subscribe === 'function') {
        try { const u = slot.sec.subscribe(() => { if (m === cur) load(cur, slot); }); if (typeof u === 'function') cur.unsubs.push(u); } catch { /* no live data */ }
      }
      if (Number.isFinite(slot.sec.tick) && slot.sec.tick > 0) cur.timers.push(win.setInterval(() => retick(cur, slot), slot.sec.tick));   // unmount clears it
    }
    syncEmpty(cur);
  }

  // ── one section ──────────────────────────────────────────────────────────────────────────────────
  function buildSlot(sec) {
    const el = make('section', sec.quiet === true ? 'tov-sec is-quiet' : 'tov-sec');
    el.dataset.tovSection = sec.id;
    el.hidden = true;
    const label = make('h3', 'tov-label');
    const head = make('button', 'tov-head');
    head.type = 'button';
    const boxId = `tov-${uid}-${sec.id}`;
    head.setAttribute('aria-controls', boxId);
    const name = make('span', 'tov-name', sec.label);
    const count = make('span', 'tov-count');
    const chev = make('span', 'tov-chev');
    chev.append(icon(doc, 'chevron', 12));
    head.append(name, count);
    let ring = null;
    if (typeof sec.summary === 'function') {
      ring = make('span', 'tov-ring');
      ring.append(ctxRing(doc));
      ring.hidden = true;
      head.append(ring);
    }
    head.append(chev);
    label.append(head);
    const box = make('div', 'tov-box');
    box.id = boxId;
    el.append(label, box);
    const slot = { sec, el, head, count, ring, box, settled: false, visible: false, rows: null, drawn: false };
    head.addEventListener('click', () => setCollapsed(slot, !isCollapsed(sec)));
    applyCollapsed(slot);
    return slot;
  }
  function applyCollapsed(slot) {
    const shut = isCollapsed(slot.sec);
    slot.head.setAttribute('aria-expanded', String(!shut));
    slot.el.classList.toggle('is-collapsed', shut);
    slot.box.hidden = shut;
  }
  function setCollapsed(slot, shut) {
    collapsed.set(slot.sec.id, shut);
    applyCollapsed(slot);
    if (!shut && typeof slot.sec.body === 'function' && m) drawBody(m, slot);
  }

  function load(cur, slot) {
    const { sec } = slot;
    if (typeof sec.body === 'function' || typeof sec.summary === 'function') { drawSummary(cur, slot); return; }
    let out;
    try { out = typeof sec.rows === 'function' ? sec.rows(cur.ac.signal) : []; } catch { failed(cur, slot); return; }
    if (out && typeof out.then === 'function') {
      out.then((list) => { if (m === cur && cur.gen === gen) drawRows(cur, slot, list); }, () => { if (m === cur && cur.gen === gen) failed(cur, slot); });
      return;
    }
    drawRows(cur, slot, out);
  }
  function failed(cur, slot) {
    slot.settled = true;
    if (!slot.drawn) { slot.visible = false; slot.el.hidden = true; }   // a failed redraw keeps what it drew
    syncEmpty(cur);
  }
  function drawSummary(cur, slot) {
    let s = null;
    try { s = typeof slot.sec.summary === 'function' ? slot.sec.summary() : { text: '' }; } catch { s = null; }
    slot.settled = true;
    slot.visible = !!s;
    slot.el.hidden = !s;
    if (s) {
      slot.count.textContent = s.text || '';
      if (slot.ring) {
        slot.ring.hidden = !s.meter;
        if (s.meter) paintCtxRing(slot.ring.firstChild, s.meter);
      }
      slot.drawn = true;
      if (!isCollapsed(slot.sec) && typeof slot.sec.body === 'function') drawBody(cur, slot);
    }
    syncEmpty(cur);
  }
  function drawBody(cur, slot) {
    let host = slot.box.querySelector(':scope > .tov-body');
    if (!host) { host = make('div', 'tov-body'); slot.box.append(host); }
    const had = host.contains(doc.activeElement);
    host.replaceChildren();
    try { slot.sec.body(host, cur.ac.signal); } catch { /* the body's own trouble: the summary stays */ }
    if (had && !host.contains(doc.activeElement)) slot.head.focus();
  }

  function drawRows(cur, slot, list) {
    const all = Array.isArray(list) ? list.filter((r) => r && r.key != null) : [];
    slot.settled = true;
    slot.drawn = true;
    slot.rows = all;
    slot.visible = all.length > 0;
    slot.el.hidden = !slot.visible;
    slot.count.textContent = String(all.length);
    // Keep the focus on the row it was on (a live redraw replaces the nodes).
    const focused = slot.box.contains(doc.activeElement) ? doc.activeElement : null;
    const fKey = focused?.closest('.tov-item')?.dataset.tovKey;
    const fCls = focused ? [...focused.classList].find((c) => c.startsWith('tov-')) : null;
    slot.box.replaceChildren();
    const ul = make('ul', 'tov-list');
    const limit = Number.isInteger(slot.sec.limit) && slot.sec.limit > 0 && !showAll.has(slot.sec.id) ? slot.sec.limit : Infinity;
    all.forEach((r, i) => { const li = rowItem(r); if (i >= limit) li.hidden = true; ul.append(li); });
    slot.box.append(ul);
    if (all.length > limit) {
      const more = make('button', 'tov-more', `Show all ${all.length}`);
      more.type = 'button';
      more.addEventListener('click', () => {
        showAll.add(slot.sec.id);
        const first = ul.querySelector('.tov-item[hidden]');
        for (const li of ul.querySelectorAll('.tov-item[hidden]')) li.hidden = false;
        more.remove();
        (first?.querySelector('button.tov-row, a.tov-row, .tov-stop') || slot.head).focus();
      });
      slot.box.append(more);
    }
    let note = null;
    try { note = typeof slot.sec.note === 'function' ? slot.sec.note() : null; } catch { note = null; }
    if (note) slot.box.append(make('p', 'tov-note', note));
    if (focused) {
      const li = fKey != null ? [...ul.children].find((n) => n.dataset.tovKey === fKey) : null;
      const target = (li && fCls && li.querySelector(`.${fCls}`)) || li?.querySelector('.tov-row') || slot.head;
      if (!li?.hidden) target.focus(); else slot.head.focus();
    }
    syncEmpty(cur);
  }
  function rowItem(r) {
    const li = make('li', r.child === true ? 'tov-item is-child' : 'tov-item');
    li.dataset.tovKey = String(r.key);
    let row;
    if (typeof r.href === 'string' && /^https?:\/\//i.test(r.href)) {   // a link only to the web: never javascript: or data:
      row = make('a', 'tov-row');
      row.setAttribute('href', r.href);
      row.setAttribute('target', '_blank');
      row.setAttribute('rel', 'noopener noreferrer');
    } else if (typeof r.open === 'function') {
      row = make('button', 'tov-row');
      row.type = 'button';
      row.addEventListener('click', () => { try { r.open(); } catch { /* the opener's own trouble */ } });
    } else {
      row = make('span', 'tov-row is-static');
    }
    if (r.title) row.title = r.title;
    if (r.child === true) { const arrow = make('span', 'tov-child', '\u21b3'); arrow.setAttribute('aria-hidden', 'true'); row.append(arrow); }
    if (r.dot) { const d = make('span'); paintStatusDot(d, r.dot); const w = make('span', 'tov-dot'); w.append(d); row.append(w); }
    else row.append(icon(doc, r.icon || 'none', 14, 'ic tov-ic'));
    row.append(make('span', 'tov-text', r.text == null ? '' : String(r.text)));
    if (r.pill && r.pill.text) row.append(make('span', `tov-pill tone-${r.pill.tone || 'slate'}`, r.pill.text));
    row.append(make('span', 'tov-meta', r.meta == null ? '' : String(r.meta)));
    li.append(row);
    if (r.stop && typeof r.stop.run === 'function') {
      const label = r.stop.label || 'Stop';
      const stop = make('button', 'tov-stop', label);
      stop.type = 'button';
      stop.setAttribute('aria-label', `${label} ${r.text == null ? '' : r.text}`.trim());
      stop.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (stop.disabled) return;
        stop.disabled = true;
        try { await r.stop.run(); } catch { /* the row stays; a live redraw drops it once stopped */ }
        stop.disabled = false;
      });
      li.append(stop);
    }
    return li;
  }
  /** A tick: meta texts re-read in place, nothing else moves (the focus stays where it is). */
  function retick(cur, slot) {
    if (!slot.drawn || typeof slot.sec.rows !== 'function') return;
    let out;
    try { out = slot.sec.rows(cur.ac.signal); } catch { return; }
    const apply = (list) => {
      if (!Array.isArray(list)) return;
      const byKey = new Map(list.filter((r) => r && r.key != null).map((r) => [String(r.key), r]));
      for (const li of slot.box.querySelectorAll('.tov-item')) {
        const r = byKey.get(li.dataset.tovKey);
        const meta = li.querySelector('.tov-meta');
        const text = r && r.meta != null ? String(r.meta) : null;
        if (meta && text != null && meta.textContent !== text) meta.firstChild ? (meta.firstChild.nodeValue = text) : (meta.textContent = text);
      }
    };
    if (out && typeof out.then === 'function') out.then(apply, () => {});
    else apply(out);
  }
  function syncEmpty(cur) {
    if (m !== cur) return;
    cur.empty.hidden = !(cur.slots.every((s) => s.settled) && !cur.slots.some((s) => s.visible));
  }

  // ── keyboard and focus ───────────────────────────────────────────────────────────────────────────
  const walk = () => (m ? [...m.root.querySelectorAll(FOCUSABLE)].filter((n) => n.tagName !== 'SPAN' && !n.disabled && !n.closest('[hidden]')) : []);
  function onKey(e) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!e.target?.closest?.(FOCUSABLE)) return;
    const list = walk();
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(e.target.closest(FOCUSABLE));
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
      : e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    list[next]?.focus();
  }
  function focus(sectionId = null) {
    if (!m) return;
    const slot = sectionId ? m.slots.find((s) => s.sec.id === sectionId && !s.el.hidden) : null;
    const target = slot ? slot.head : walk()[0];
    (target || m.root).focus();
  }
  function expand(sectionId) {
    if (typeof sectionId !== 'string' || !sectionId) return;
    const slot = m && m.slots.find((s) => s.sec.id === sectionId);
    if (slot) setCollapsed(slot, false); else collapsed.set(sectionId, false);
  }

  return { mount, unmount, focus, expand, viewKey: () => (m ? m.key : null) };
}
