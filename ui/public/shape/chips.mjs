// ui/public/shape/chips.mjs — perspective chips (spec D4): Product locked on; `fixed` keys cannot be toggled.
import { PERSPECTIVES } from '../../../src/shared/shape/perspectives.mjs';

export function buildPerspectiveChips(doc, { picked, fixed = [], hidden = [], collapsed = true, onChange = () => {} }) {
  // `hidden` keys are not offered: no chip, not in value(), not in "+ N more".
  const offered = PERSPECTIVES.filter((p) => !hidden.includes(p.key));
  const on = new Set(['product', ...picked.filter((k) => !hidden.includes(k))]);
  const el = doc.createElement('div');
  el.className = 'shape-chips';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Perspectives');
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'shape-chip-more';
  let collapsedNow = collapsed;
  const value = () => offered.map((p) => p.key).filter((k) => on.has(k));
  const paint = () => {
    el.replaceChildren();
    const shown = offered.filter((p) => !collapsedNow || on.has(p.key));
    for (const p of shown) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `shape-chip${on.has(p.key) ? ' on' : ''}`;
      b.dataset.perspective = p.key;
      b.textContent = p.label;
      b.title = p.help;
      b.setAttribute('aria-pressed', String(on.has(p.key)));
      const locked = !!p.locked || fixed.includes(p.key);
      b.disabled = locked;
      if (locked) b.dataset.locked = '1';              // setPanelBusy's idle restore keeps it disabled (F32)
      b.addEventListener('click', () => { if (on.has(p.key)) on.delete(p.key); else on.add(p.key); paint(); onChange(value()); });
      el.appendChild(b);
    }
    const rest = offered.length - shown.length;
    if (collapsedNow && rest > 0) { more.textContent = `+ ${rest} more`; el.appendChild(more); }
  };
  more.addEventListener('click', () => { collapsedNow = false; paint(); });
  paint();
  return { el, value };
}
