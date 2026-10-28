// ui/public/workflows/menu.mjs
// One popover menu at a time for the Workflows view ("Workflows ▾", "+", the zoom %, the toolbar's
// Model/Effort pickers, the chat's scope pill). role=menu with roving focus; Escape, Tab, an outside
// press or focus leaving close it. It OWNS every key it receives: the composer's document keydown
// acts on arrows/Delete/Space whatever the modifiers (memory: app-js-escape-handlers), so plain keys
// stop at the menu.
import { icon } from '../icons.mjs';

let current = null;
let segSeq = 0;

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.anchor  the trigger: aria-expanded tracks the menu; Escape and a pick return focus to it
 * @param {Array<{label:string, icon?:string, danger?:boolean, hint?:string, chip?:Node, checked?:boolean, disabled?:boolean, title?:string, onSelect?:Function}
 *   |{sep:true}|{header:string}>} o.items
 * @param {'start'|'end'} [o.align]  the edge shared with the anchor
 * @param {'bottom'|'top'} [o.side]   open below (default) or above the anchor
 * @param {string} [o.label]  aria-label of the menu
 * @param {HTMLElement} [o.host]  append the menu inside it (a split button's .btn-split.mini) and let its CSS place it;
 *   else <body>, fixed
 * @param {string} [o.className]  extra classes on the menu
 * An item `{ switch: true, label, help, checked, onToggle(button) }` is a menuitemcheckbox switch row whose toggle keeps
 * the menu open (the account menu's rule); onToggle owns aria-checked.
 * An item `{ segmented: true, label, options: [{ id, label, title? }], value, onSelect(id) }` is a `.menu-h` header and
 * one `.seg` control (role=group of menuitemradio): ←/→ move inside it, ↑/↓ treat it as one stop, and a pick keeps the
 * menu open (the View menus' Sort by / Group by).
 * @returns {{el:HTMLElement, close:() => void}}
 */
export function openMenu({ doc, anchor, items, align = 'start', side = 'bottom', label = '', host = null, className = '' }) {
  closeMenus();
  const win = doc.defaultView || globalThis;
  const el = doc.createElement('div');
  el.className = ['menu wfv-menu', className].filter(Boolean).join(' ');
  el.setAttribute('role', 'menu');
  if (label) el.setAttribute('aria-label', label);
  el.dataset.canvasKeys = 'off';
  const buttons = [];
  for (const it of items) {
    if (it.sep) { const s = doc.createElement('div'); s.className = 'menu-sep wfv-menu-sep'; s.setAttribute('role', 'separator'); el.appendChild(s); continue; }
    if (it.header) { const h = doc.createElement('div'); h.className = 'menu-h wfv-menu-h'; h.textContent = it.header; el.appendChild(h); continue; }
    if (it.segmented) {
      const h = doc.createElement('div');
      h.className = 'menu-h wfv-menu-h';
      h.id = `wfv-seg-h-${++segSeq}`;
      h.textContent = it.label;
      const g = doc.createElement('div');
      g.className = 'seg wfv-seg';
      g.setAttribute('role', 'group');
      g.setAttribute('aria-labelledby', h.id);
      for (const o of it.options) {
        const s = doc.createElement('button');
        s.type = 'button';
        s.tabIndex = -1;
        s.setAttribute('role', 'menuitemradio');
        s.setAttribute('aria-checked', o.id === it.value ? 'true' : 'false');
        s.dataset.segId = o.id;
        s.textContent = o.label;
        if (o.title) s.title = o.title;
        // A pick repaints the list behind and keeps the menu open (as a switch row); the picked segment again is a no-op.
        s.addEventListener('click', () => {
          if (s.getAttribute('aria-checked') === 'true') return;
          for (const x of g.children) x.setAttribute('aria-checked', x === s ? 'true' : 'false');
          if (typeof it.onSelect === 'function') it.onSelect(o.id);
        });
        g.appendChild(s);
      }
      el.append(h, g);
      buttons.push(g);   // one ↑/↓ stop; focusAt lands on its checked segment
      continue;
    }
    const b = doc.createElement('button');
    b.type = 'button';
    if (it.switch) {
      b.tabIndex = -1;
      b.className = 'menu-item wfv-menu-item sw-item';
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.icon) b.appendChild(icon(doc, it.icon, 16, 'ic wfv-menu-ic'));
      const tx = doc.createElement('span');
      tx.className = 'wfv-menu-l';
      const name = doc.createElement('b');
      name.textContent = it.label;
      tx.appendChild(name);
      if (it.help) { const s = doc.createElement('small'); s.setAttribute('aria-live', 'polite'); s.textContent = it.help; tx.appendChild(s); }
      const sw = doc.createElement('span');
      sw.className = 'switch';
      sw.setAttribute('aria-hidden', 'true');
      b.append(tx, sw);
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true' && typeof it.onToggle === 'function') it.onToggle(b); });
      el.appendChild(b);
      buttons.push(b);
      continue;
    }
    b.className = it.danger ? 'menu-item wfv-menu-item is-danger' : 'menu-item wfv-menu-item';
    b.setAttribute('role', it.checked == null ? 'menuitem' : 'menuitemradio');
    if (it.checked != null) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
    b.tabIndex = -1;
    if (it.icon) b.appendChild(icon(doc, it.icon, 16, 'ic wfv-menu-ic'));   // an icons.mjs glyph before the label
    const l = doc.createElement('span');
    l.className = 'wfv-menu-l';
    l.textContent = it.label;
    b.appendChild(l);
    if (it.chip) b.appendChild(it.chip);                // a kind chip (B8): the one chip, never a text hint
    if (it.hint) { const h = doc.createElement('span'); h.className = it.hint === '0' ? 'wfv-menu-hint is-zero' : 'wfv-menu-hint'; h.textContent = it.hint; b.appendChild(h); }
    if (it.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    if (it.title) b.title = it.title;
    // The pick removes the item that holds the focus: hand it back to the trigger first (the menu-button pattern),
    // never <body>, where the canvas takes Delete and the arrows. onSelect may still move it on (the scope menu does).
    b.addEventListener('click', () => {
      if (b.disabled) return;
      close();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
      if (typeof it.onSelect === 'function') it.onSelect();
    });
    el.appendChild(b);
    buttons.push(b);
  }
  if (host) {
    // No fixed placement and no measuring: `.btn-split` is position:relative and `.btn-split.mini .btn-split-menu`
    // drops the absolute menu below the split (style.css).
    host.appendChild(el);
  } else {
    // Fixed BEFORE it is measured: a block menu in <body> is as wide as the viewport, which clamped every menu to left:8.
    el.style.position = 'fixed';
    el.style.left = '0px';
    el.style.top = '0px';
    doc.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    el.style.left = `${Math.max(8, Math.min(align === 'end' ? r.right - w : r.left, vw - w - 8))}px`;
    let top = side === 'top' ? r.top - h - 6 : r.bottom + 6;
    if (top < 8) top = r.bottom + 6;
    else if (top + h > vh - 8 && side !== 'top') top = Math.max(8, r.top - h - 6);
    el.style.top = `${top}px`;
  }
  anchor.setAttribute('aria-expanded', 'true');

  const enabled = () => buttons.filter((b) => !b.disabled);
  // A segmented group is one stop: focus its checked segment (else its first).
  const target = (s) => (s.classList.contains('wfv-seg') ? s.querySelector('[aria-checked="true"]') || s.firstElementChild : s);
  const focusAt = (i) => { const list = enabled(); if (!list.length) return; target(list[((i % list.length) + list.length) % list.length]).focus(); };
  function onKey(ev) {
    const a = doc.activeElement;
    const seg = a && a.closest ? a.closest('.wfv-seg') : null;
    const i = enabled().indexOf(seg || a);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); anchor.focus(); return; }
    if (ev.key === 'Tab') { close(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusAt(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusAt(i < 0 ? -1 : i - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); focusAt(0); }
    else if (ev.key === 'End') { ev.preventDefault(); focusAt(-1); }
    else if (seg && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      const segs = [...seg.children];
      segs[(segs.indexOf(a) + (ev.key === 'ArrowRight' ? 1 : -1) + segs.length) % segs.length].focus();
    }
    if (!ev.ctrlKey && !ev.metaKey) ev.stopPropagation();   // Enter/Space activate the focused button natively
  }
  const onDocDown = (ev) => { if (!el.contains(ev.target) && !anchor.contains(ev.target)) close(); };
  // Close when focus LEAVES (memory: sidebar-popup-focus-traps) — never on a focus move inside.
  const onFocusIn = (ev) => { if (!el.contains(ev.target) && !anchor.contains(ev.target)) close(); };
  el.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onDocDown, true);
  doc.addEventListener('focusin', onFocusIn);
  const handle = { el, close, anchor };
  function close() {
    if (current !== handle) return;
    current = null;
    el.removeEventListener('keydown', onKey);
    doc.removeEventListener('pointerdown', onDocDown, true);
    doc.removeEventListener('focusin', onFocusIn);
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
  }
  current = handle;
  focusAt(0);
  return handle;
}

export function closeMenus() { if (current) current.close(); }
/** The trigger's second click closes its own menu. */
export function toggleMenu(o) {
  if (current && current.anchor === o.anchor) { closeMenus(); return null; }
  return openMenu(o);
}
