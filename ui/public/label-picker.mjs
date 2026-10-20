// ui/public/label-picker.mjs — run labels (slice 1): the label chip and the one picker (selection bar, run page,
// Runs filter). A fixed popover placed by placeFlyout; one native checkbox per label (indeterminate = some of the
// selected runs have it); "Create "word"" for a new word. Pure DOM; `doc` is injected for jsdom.
import { icon } from './icons.mjs';
import { placeFlyout } from './side-flyout.mjs';
import { labelHue, pickerRows } from '../../src/shared/run-labels.mjs';

/** GET /api/labels → [{ label, count }]; [] on any failure (suggestions are a nicety). */
export const fetchLabels = () => fetch('/api/labels').then((r) => (r.ok ? r.json() : { labels: [] })).then((b) => b.labels || []).catch(() => []);

/** <span class="label-chip"><span class="label-dot hue-x"></span><span class="label-chip-t">word</span>[remove button]</span> — the remove button is an svg icon, never a glyph */
export function labelChip(doc, label, { onRemove = null } = {}) {
  const c = doc.createElement('span');
  c.className = 'label-chip';
  const dot = doc.createElement('span');
  dot.className = `label-dot hue-${labelHue(label)}`;
  dot.setAttribute('aria-hidden', 'true');
  const t = doc.createElement('span');
  t.className = 'label-chip-t';
  t.textContent = label;
  c.append(dot, t);
  if (onRemove) {
    const x = doc.createElement('button');
    x.type = 'button';
    x.className = 'label-x';
    x.setAttribute('aria-label', `Remove ${label}`);
    x.append(icon(doc, 'x', 12));
    x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onRemove(label); });
    c.append(x);
  }
  return c;
}

// One picker at a time, per document (a WeakMap keeps jsdom documents apart).
const openByDoc = new WeakMap();

/** True when a picker opened from `anchor` is open: the anchor's click handler closes it instead of opening another. */
export function closeLabelPickerFor(doc, anchor) {
  const cur = openByDoc.get(doc);
  if (!cur || cur.anchor() !== anchor) return false;
  cur.close();
  return true;
}

/**
 * Open the picker. used: [{label,count}]; states: Map(label → 'all'|'some'); onToggle(label, on) may return a promise.
 * The picker stays open across toggles (several labels in one go); Esc or an outside press closes it. Opening one
 * closes any other open picker first. anchor: the opening button, or a function answering the current one when a
 * toggle repaint rebuilds that button (Esc refocuses it; a press on it is left to its own click handler).
 * → { el, close }.
 */
export function openLabelPicker({ doc, anchor, used = [], states = new Map(), allowCreate = true, mode = 'down',
  title = 'Labels', onToggle, onClose = () => {} }) {
  openByDoc.get(doc)?.close();
  const anchorEl = typeof anchor === 'function' ? anchor : () => anchor;
  const local = new Map(states);
  let focusLabel = null;   // the checkbox the person just toggled keeps focus across the repaint
  let enterTarget = null;  // what Enter in the search field picks
  const el = doc.createElement('div');
  el.className = 'label-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', title);
  const q = doc.createElement('input');
  q.type = 'search';
  q.className = 'input lp-search';
  q.placeholder = allowCreate ? 'Find or create a label' : 'Find a label';
  q.setAttribute('aria-label', q.placeholder);
  const list = doc.createElement('div');
  list.className = 'lp-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  const empty = doc.createElement('p');
  empty.className = 'lp-empty';
  const known = [...used];
  const toggle = async (label, on) => {
    local.set(label, on ? 'all' : 'none');
    if (on && !known.some((u) => u.label === label)) known.push({ label, count: 0 });
    paint();
    await onToggle(label, on);
  };
  function paint() {
    const states2 = new Map([...local].filter(([, s]) => s !== 'none'));
    const { rows, create } = pickerRows({ query: q.value, used: known, states: states2, allowCreate });
    const nodes = [];
    let createBtn = null;
    if (create) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'lp-create';
      b.setAttribute('role', 'option');
      b.textContent = `Create "${create}"`;
      b.addEventListener('click', () => { q.value = ''; void toggle(create, true); });
      createBtn = b;
    }
    for (const r of rows) {
      const row = doc.createElement('label');
      row.className = 'lp-row';
      row.setAttribute('role', 'option');
      row.dataset.label = r.label;
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.className = 'lp-check';
      box.checked = r.state === 'all';
      box.indeterminate = r.state === 'some';
      row.setAttribute('aria-selected', String(r.state === 'all'));
      box.addEventListener('change', () => { focusLabel = r.label; void toggle(r.label, box.checked); });
      const name = doc.createElement('span');
      name.className = 'lp-name';
      name.append(labelChip(doc, r.label));
      const n = doc.createElement('span');
      n.className = 'runs-count';
      n.textContent = r.count ? String(r.count) : '';
      row.append(box, name, n);
      nodes.push(row);
    }
    // A known prefix outranks Create (Enter takes the first option): "spi" picks spike, not a near-duplicate word.
    const prefix = create ? rows.findIndex((r) => r.label.startsWith(create)) : -1;
    if (createBtn) nodes.splice(prefix >= 0 ? nodes.length : 0, 0, createBtn);
    enterTarget = prefix >= 0 ? nodes[prefix] : nodes[0];
    list.replaceChildren(...nodes);
    empty.textContent = known.length ? 'No labels match.' : 'No labels yet.';
    empty.hidden = nodes.length > 0;
    if (focusLabel != null) {
      [...list.querySelectorAll('.lp-row')].find((n) => n.dataset.label === focusLabel)?.querySelector('.lp-check')?.focus();
      focusLabel = null;
    }
  }
  q.addEventListener('input', paint);
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (enterTarget?.classList.contains('lp-create')) enterTarget.click();
    else enterTarget?.querySelector('.lp-check')?.click();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchorEl()?.focus(); } });
  // A press on the anchor (or its icon) is left to the anchor's click handler, which toggles via closeLabelPickerFor.
  const onDown = (e) => { if (!el.contains(e.target) && !anchorEl()?.contains(e.target)) close(); };
  el.append(q, list, empty);
  doc.body.append(el);
  paint();
  placeFlyout(el, anchorEl(), { mode, gap: 4, margin: 8, win: doc.defaultView });
  doc.addEventListener('pointerdown', onDown, true);
  q.focus();
  let open = true;
  const handle = { el, anchor: anchorEl, close };
  openByDoc.set(doc, handle);
  function close() {
    if (!open) return;
    open = false;
    if (openByDoc.get(doc) === handle) openByDoc.delete(doc);
    doc.removeEventListener('pointerdown', onDown, true);
    el.remove();
    onClose();
  }
  return { el, close };
}
