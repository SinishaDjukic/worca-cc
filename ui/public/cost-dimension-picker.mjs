// ui/public/cost-dimension-picker.mjs — the Cost report's searchable picker (Allocate by, then by, Add filter).
// One per document, placed like the label picker (placeFlyout). Options: [{ id, label, group?, hint? }]. Typing
// filters by label or id; Enter picks the first visible row; Esc or a press outside closes and refocuses the anchor
// (`anchor` may be a function that re-queries the button, since the report repaints it).
import { placeFlyout } from './side-flyout.mjs';
import { filterDimensionOptions } from '../../src/shared/cost/allocation.mjs';

export const PICKER_GROUPS = Object.freeze({ policy: 'Policy dimensions', builtin: 'Built-in', other: 'Other cost tags' });
const open = new WeakMap();   // doc → { el, close }
const FOCUSABLE = 'button, a[href], input, select, textarea, summary, label, [contenteditable], [tabindex]';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function closeDimensionPicker(doc) { open.get(doc)?.close(); }

/** @returns {{ el: HTMLElement, close(): void }} */
export function openDimensionPicker({ doc = globalThis.document, anchor, options, selected = null, title,
  placeholder = 'Search keys', empty = 'No matching keys.', noneLabel = null, onPick, onClose = () => {} }) {
  closeDimensionPicker(doc);
  const anchorEl = () => (typeof anchor === 'function' ? anchor() : anchor);
  const el = h(doc, 'div', 'cr-picker');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  const search = h(doc, 'input', 'input cr-pick-search');
  Object.assign(search, { type: 'search', placeholder });
  search.setAttribute('aria-label', `Search ${title.toLowerCase()}`);
  const list = h(doc, 'div', 'cr-pick-list');
  list.setAttribute('role', 'listbox');
  const none = h(doc, 'p', 'hint cr-pick-empty', empty);
  el.append(search, list, none);

  const row = (o) => {
    const b = h(doc, 'button', 'cr-pick-row');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(o.id === selected));
    b.dataset.id = o.id === null ? '' : String(o.id);
    b.dataset.none = o.id === null ? '1' : '';
    b.append(h(doc, 'span', 'cr-pick-label', o.label));
    if (o.hint) b.append(h(doc, 'small', 'cr-pick-hint', o.hint));
    b._opt = o;
    return b;
  };
  function paint() {
    const shown = filterDimensionOptions(options, search.value);
    const nodes = [];
    if (noneLabel && !search.value.trim()) nodes.push(row({ id: '', label: noneLabel }));
    let group = null;
    for (const o of shown) {
      if (o.group && o.group !== group && PICKER_GROUPS[o.group]) nodes.push(h(doc, 'div', 'cr-pick-group', PICKER_GROUPS[o.group]));
      group = o.group;
      nodes.push(row(o));
    }
    list.replaceChildren(...nodes);
    none.hidden = shown.length > 0 || nodes.length > 0;
  }
  function close(refocus = true) {
    if (open.get(doc)?.el !== el) return;
    open.delete(doc);
    doc.removeEventListener('pointerdown', outside, true);
    el.remove();
    if (refocus) anchorEl()?.focus();
    onClose();
  }
  // The press's default mousedown action blurs the refocused anchor again: hold it back unless the press lands on a
  // control that should take the focus itself.
  function outside(e) {
    if (el.contains(e.target) || anchorEl()?.contains(e.target)) return;
    close();
    doc.addEventListener('mousedown', keepFocus, { capture: true, once: true });
  }
  function keepFocus(e) { if (!e.target.closest?.(FOCUSABLE)) e.preventDefault(); }
  // onPick repaints the report, which replaces the anchor button: refocus AFTER it, through anchorEl() (it re-queries),
  // and not when onPick opened a follow-up picker (Add filter's value step) that holds the focus now.
  function pick(b) {
    const o = b._opt;
    close(false);
    onPick(o.id);
    if (!open.has(doc)) anchorEl()?.focus();
  }

  search.addEventListener('input', paint);
  el.addEventListener('click', (e) => { const b = e.target.closest('.cr-pick-row'); if (b) pick(b); });
  el.addEventListener('keydown', (e) => {
    const rows = [...list.querySelectorAll('.cr-pick-row')];
    const at = rows.indexOf(doc.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target === search && rows[0]) { e.preventDefault(); pick(rows[0]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(rows.length - 1, at + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (at <= 0 ? search : rows[at - 1]).focus(); }
  });
  doc.body.append(el);
  paint();
  placeFlyout(el, anchorEl(), { mode: 'down', gap: 4, margin: 8, win: doc.defaultView });
  doc.addEventListener('pointerdown', outside, true);
  search.focus();
  const handle = { el, close };
  open.set(doc, handle);
  return handle;
}
