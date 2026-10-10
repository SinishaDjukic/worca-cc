// ui/public/workflows/menu.mjs
// One popover menu at a time for the Workflows view ("Workflows ▾", "+", the zoom %, the toolbar's
// Model/Effort pickers, the chat's scope pill). role=menu with roving focus; Escape, Tab, an outside
// press or focus leaving close it. It OWNS every key it receives: the composer's document keydown
// acts on arrows/Delete/Space whatever the modifiers (memory: app-js-escape-handlers), so plain keys
// stop at the menu.
let current = null;

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {HTMLElement} o.anchor  the trigger: aria-expanded tracks the menu; Escape and a pick return focus to it
 * @param {Array<{label:string, hint?:string, checked?:boolean, disabled?:boolean, title?:string, onSelect?:Function}
 *   |{sep:true}|{header:string}>} o.items
 * @param {'start'|'end'} [o.align]  the edge shared with the anchor
 * @param {'bottom'|'top'} [o.side]   open below (default) or above the anchor
 * @param {string} [o.label]  aria-label of the menu
 * @returns {{el:HTMLElement, close:() => void}}
 */
export function openMenu({ doc, anchor, items, align = 'start', side = 'bottom', label = '' }) {
  closeMenus();
  const win = doc.defaultView || globalThis;
  const el = doc.createElement('div');
  el.className = 'wfv-menu';
  el.setAttribute('role', 'menu');
  if (label) el.setAttribute('aria-label', label);
  el.dataset.canvasKeys = 'off';
  const buttons = [];
  for (const it of items) {
    if (it.sep) { const s = doc.createElement('div'); s.className = 'wfv-menu-sep'; s.setAttribute('role', 'separator'); el.appendChild(s); continue; }
    if (it.header) { const h = doc.createElement('div'); h.className = 'wfv-menu-h'; h.textContent = it.header; el.appendChild(h); continue; }
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'wfv-menu-item';
    b.setAttribute('role', it.checked == null ? 'menuitem' : 'menuitemradio');
    if (it.checked != null) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
    b.tabIndex = -1;
    const l = doc.createElement('span');
    l.className = 'wfv-menu-l';
    l.textContent = it.label;
    b.appendChild(l);
    if (it.hint) { const h = doc.createElement('span'); h.className = 'wfv-menu-hint'; h.textContent = it.hint; b.appendChild(h); }
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
  anchor.setAttribute('aria-expanded', 'true');

  const enabled = () => buttons.filter((b) => !b.disabled);
  const focusAt = (i) => { const list = enabled(); if (!list.length) return; list[((i % list.length) + list.length) % list.length].focus(); };
  function onKey(ev) {
    const i = enabled().indexOf(doc.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); anchor.focus(); return; }
    if (ev.key === 'Tab') { close(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusAt(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusAt(i < 0 ? -1 : i - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); focusAt(0); }
    else if (ev.key === 'End') { ev.preventDefault(); focusAt(-1); }
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
