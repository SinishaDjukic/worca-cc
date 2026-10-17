// ui/public/runs-row-menu.mjs — the Runs list's row ⋯ menu (#739): ONE role="menu" shared by every row,
// opened from a row's ⋯ button or by right-clicking the row. Owns open/close, roving focus, the outside
// click and placement; app.js owns which items a row gets (runs-archive.mjs rowMenuItems) and what they do.

export function mountRunsRowMenu({ host, menu, itemsFor, onPick }) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  let key = '';
  let opener = null;
  const isOpen = () => !menu.hidden;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const moreFor = (k) => [...host.querySelectorAll('.runs-row-more')].find((b) => b.dataset.rowKey === k) || null;

  function build(list) {
    return list.map((it) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.action = it.id;
      const label = doc.createElement('span');
      label.className = 'runs-row-menu-label';
      label.textContent = it.label;
      b.appendChild(label);
      if (it.disabled) {
        b.setAttribute('aria-disabled', 'true');   // still focusable, so the reason can be read
        if (it.why) {
          const why = doc.createElement('span');
          why.className = 'runs-row-menu-why';
          why.textContent = it.why;
          b.appendChild(why);
          b.title = it.why;
        }
      }
      return b;
    });
  }
  function place({ anchor = null, x = 0, y = 0 }) {
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    const w = menu.offsetWidth || 0;
    const h = menu.offsetHeight || 0;
    const r = anchor ? anchor.getBoundingClientRect() : null;
    let left = r ? r.right - w : x;
    let top = r ? r.bottom + 4 : y;
    left = Math.max(8, Math.min(left, vw - w - 8));
    if (top + h > vh - 8) top = Math.max(8, (r ? r.top - 4 : y) - h);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  function open(rowKey, at = {}) {
    const list = (rowKey && itemsFor(rowKey)) || [];
    if (!list.length) return false;
    close();
    key = rowKey;
    opener = at.anchor || at.row || null;
    menu.replaceChildren(...build(list));
    menu.hidden = false;
    place(at);
    if (at.anchor) at.anchor.setAttribute('aria-expanded', 'true');
    items()[0]?.focus({ preventScroll: true });
    return true;
  }
  function close({ focusBack = false } = {}) {
    if (!isOpen()) return;
    menu.hidden = true;
    const k = key;
    if (opener && opener.classList.contains('runs-row-more')) opener.setAttribute('aria-expanded', 'false');
    // A list rebuild may have replaced the opener: fall back to the same row's new ⋯ button.
    const back = opener && opener.isConnected ? opener : moreFor(k);
    opener = null;
    key = '';
    if (focusBack && back) back.focus({ preventScroll: true });
  }

  host.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.runs-row-more');
    if (!b) return;
    e.preventDefault();
    if (isOpen() && opener === b) { close(); return; }
    open(b.dataset.rowKey, { anchor: b });
  });
  host.addEventListener('contextmenu', (e) => {
    const item = e.target.closest && e.target.closest('.runs-item');
    if (!item) return;
    const row = item.querySelector('.runs-row');
    const r = row ? row.getBoundingClientRect() : { left: 0, bottom: 0 };
    // The keyboard ContextMenu key reports 0,0: place the menu under the row instead.
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY, row } : { x: r.left + 16, y: r.bottom, row };
    if (open(item.dataset.rowKey, at)) e.preventDefault();
  });
  host.addEventListener('scroll', () => close(), { passive: true });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[role="menuitem"]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const k = key;
    close({ focusBack: true });
    onPick(b.dataset.action, k);
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close({ focusBack: true }); return; }
    if (e.key === 'Tab') { close(); return; }
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(doc.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    list[next].focus();
  });
  doc.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (menu.contains(t) || (t.closest && t.closest('.runs-row-more'))) return;
    close();
  });
  return { open, close, isOpen };
}
