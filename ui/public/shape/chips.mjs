// ui/public/shape/chips.mjs — perspective chips (spec D4): Product locked on; `fixed` keys cannot be toggled.
// Flag proposedPerspectives: `extra` perspectives (Compliance) are offered after the list, `reasons` give a proposed
// chip its tooltip and accessible description, and `propose` applies a proposal in place until the person's first click.
import { PERSPECTIVES } from '../../../src/shared/shape/perspectives.mjs';

export function buildPerspectiveChips(doc, { picked, fixed = [], hidden = [], collapsed = true, onChange = () => {}, extra = [], reasons = {} }) {
  // `hidden` keys are not offered: no chip, not in value(), not in "+ N more".
  const offered = [...PERSPECTIVES, ...extra].filter((p) => !hidden.includes(p.key));
  let on = new Set(['product', ...picked.filter((k) => !hidden.includes(k))]);
  let why = { ...reasons };
  let touched = false;          // the person's first chip click: a later proposal updates the reasons only
  const el = doc.createElement('div');
  el.className = 'shape-chips';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Perspectives');
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'shape-chip-more';
  let collapsedNow = collapsed;
  const value = () => offered.map((p) => p.key).filter((k) => on.has(k));
  const reasonOf = (key) => (typeof why[key] === 'string' && why[key] ? why[key] : null);
  const paint = () => {
    // A repaint replaces every chip: keep focus on the same perspective when it was inside the group.
    const active = doc.activeElement;
    const hadFocus = !!active && el.contains(active);
    const focusKey = hadFocus && active.dataset ? active.dataset.perspective : undefined;
    el.replaceChildren();
    const shown = offered.filter((p) => !collapsedNow || on.has(p.key));
    for (const p of shown) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `shape-chip${on.has(p.key) ? ' on' : ''}`;
      b.dataset.perspective = p.key;
      b.textContent = p.label;
      const reason = reasonOf(p.key);
      b.title = reason || p.help;
      if (reason) b.setAttribute('aria-description', reason);
      b.setAttribute('aria-pressed', String(on.has(p.key)));
      const locked = !!p.locked || fixed.includes(p.key);
      b.disabled = locked;
      if (locked) b.dataset.locked = '1';              // setPanelBusy's idle restore keeps it disabled (F32)
      b.addEventListener('click', () => { touched = true; if (on.has(p.key)) on.delete(p.key); else on.add(p.key); paint(); onChange(value()); });
      el.appendChild(b);
    }
    const rest = offered.length - shown.length;
    if (collapsedNow && rest > 0) { more.textContent = `+ ${rest} more`; el.appendChild(more); }
    if (hadFocus && !el.contains(doc.activeElement)) {
      const same = focusKey ? [...el.querySelectorAll('[data-perspective]')].find((b) => b.dataset.perspective === focusKey) : null;
      (same || (more.parentNode === el ? more : el.querySelector('[data-perspective]:not([disabled])')))?.focus();
    }
  };
  more.addEventListener('click', () => { collapsedNow = false; paint(); });
  /** Apply a proposal: the selection (until the person's first click) and the reasons, in place. */
  const propose = (keys, nextReasons = {}) => {
    why = { ...(nextReasons || {}) };
    if (!touched) {
      const before = value().join();
      on = new Set(['product', ...(Array.isArray(keys) ? keys : []).filter((k) => !hidden.includes(k))]);
      paint();
      if (value().join() !== before) onChange(value());
      return;
    }
    paint();
  };
  paint();
  return { el, value, propose };
}
