// ui/public/runs-view-menu.mjs — the Runs header's View menu (#740): Show and Group by as
// menuitemradio groups under one button. Owns open/close, roving focus and the outside click;
// app.js owns the state and repaints aria-checked through paint().
import { levelAtLeast, minLevelFor } from './ui-level.mjs';

const ITEM = '[data-show],[data-group-by]';

export function mountRunsViewMenu({ button, menu, onPick }) {
  const doc = button.ownerDocument;
  const wrap = button.parentElement;
  // An item the current level hides (Archived below Advanced, unless kept) is not reachable by arrows.
  const items = () => [...menu.querySelectorAll(ITEM)].filter((b) => !b.hidden && levelAtLeast(minLevelFor(b), doc));
  const isOpen = () => !menu.hidden;
  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const list = items();
    (list.find((b) => b.getAttribute('aria-checked') === 'true') || list[0])?.focus({ preventScroll: true });
  }
  function close({ focusButton = false } = {}) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focusButton) button.focus({ preventScroll: true });
  }
  function paint({ show, groupBy }) {
    for (const b of menu.querySelectorAll('[data-show]')) b.setAttribute('aria-checked', b.dataset.show === show ? 'true' : 'false');
    for (const b of menu.querySelectorAll('[data-group-by]')) b.setAttribute('aria-checked', b.dataset.groupBy === groupBy ? 'true' : 'false');
  }
  // Enter/Space arrive as the button's native click (D7); arrows open it too.
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    open();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest(ITEM);
    if (!b) return;
    close({ focusButton: true });
    onPick(b.dataset.show ? { show: b.dataset.show } : { groupBy: b.dataset.groupBy });
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close({ focusButton: true }); return; }
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
    if (isOpen() && !(e.target.closest && wrap.contains(e.target))) close();
  });
  return { open, close, paint, isOpen };
}
