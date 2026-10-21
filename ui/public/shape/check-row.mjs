// ui/public/shape/check-row.mjs — the ONE check-row component and the ONE fold() (shaper-cards spec §2.2): a check line
// (`Shape 4/5 · 1 to fix`) that unfolds neutral ✓ / ✕ rows. Plan and Split cards both use it; nothing else draws checks.
import { checkLine } from './plan-text.mjs';
import { icon } from '../icons.mjs';

/** A control that shows/hides `region` (folded by default). */
export function fold(b, region, onOpen) {
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', () => {
    region.hidden = !region.hidden;
    b.setAttribute('aria-expanded', String(!region.hidden));
    if (!region.hidden && onOpen) onOpen();
  });
  return b;
}

/** Run 4 (D8): a control that gives way to `region` (Ask for changes → the changes field); `cancel` gives it back. */
export function swapOpen(b, region, cancel, onOpen) {
  b.setAttribute('aria-expanded', 'false');
  const show = (open) => { region.hidden = !open; b.hidden = open; b.setAttribute('aria-expanded', String(open)); };
  b.addEventListener('click', () => { show(true); if (onOpen) onOpen(); });
  cancel.addEventListener('click', (e) => { e.stopPropagation(); show(false); b.focus(); });
  return b;
}

/** The rows of a check: one `.plan-check-row` per item, ✓ met / ✕ unmet with its detail. */
export function buildCheckRows(doc, check) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
  return (check && Array.isArray(check.items) ? check.items : []).map((it) => {
    const row = h('div', `plan-check-row${it.pass ? ' ok' : ''}`);
    const mark = h('span', 'plan-check-mark');
    mark.append(icon(doc, it.pass ? 'check' : 'x', 12));
    mark.setAttribute('aria-label', it.pass ? 'met' : 'unmet');
    row.append(mark, h('span', 'plan-check-label', it.label));
    if (!it.pass && it.detail) row.appendChild(h('span', 'plan-check-detail', it.detail));
    return row;
  });
}

/** The folded check: `{ line, rows, update(check) }`; update repaints in place, so an open fold stays open. */
export function buildCheckFold(doc, check, name = 'Shape') {
  const rows = doc.createElement('div'); rows.className = 'plan-checks'; rows.hidden = true;
  const line = doc.createElement('button'); line.type = 'button'; line.className = 'btn plan-fold plan-check-line';
  const text = doc.createElement('span'); text.className = 'plan-fold-text';
  const chev = doc.createElement('span'); chev.className = 'plan-chev'; chev.textContent = '›'; chev.setAttribute('aria-hidden', 'true');
  line.append(text, chev);
  fold(line, rows);
  const update = (c) => { text.textContent = checkLine(c, name); rows.replaceChildren(...buildCheckRows(doc, c)); };
  update(check);
  return { line, rows, update };
}
