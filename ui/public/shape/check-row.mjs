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

/** Run 4 (D8): a control that gives way to `region` (Ask for changes → the changes field); `cancel` gives it back.
 *  `onClose` runs before `b` takes the focus, so it can show whatever holds `b` first. */
export function swapOpen(b, region, cancel, onOpen, onClose) {
  b.setAttribute('aria-expanded', 'false');
  const show = (open) => { region.hidden = !open; b.hidden = open; b.setAttribute('aria-expanded', String(open)); };
  b.addEventListener('click', () => { show(true); if (onOpen) onOpen(); });
  cancel.addEventListener('click', (e) => { e.stopPropagation(); show(false); if (onClose) onClose(); b.focus(); });
  return b;
}

/** The rows of a check: one `.plan-check-row` per item, ✓ met / ✕ unmet with its detail. An acceptance ledger item
 *  (Shaper requirements s3) may carry `state` ('not-met' keeps the ✕, 'dropped' draws `none`) and its own `ariaLabel`.
 *  `tip` (the Requirements card's criterion id) goes in the row's tooltip and, for screen readers, before the label. */
export function buildCheckRows(doc, check) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
  return (check && Array.isArray(check.items) ? check.items : []).map((it) => {
    const met = it.pass && !it.state;
    const row = h('div', `plan-check-row${met ? ' ok' : ''}`);
    const mark = h('span', 'plan-check-mark');
    mark.append(icon(doc, it.state === 'dropped' ? 'none' : met ? 'check' : 'x', 12));
    mark.setAttribute('aria-label', it.ariaLabel || (it.pass ? 'met' : 'unmet'));
    row.appendChild(mark);
    if (it.tip) { row.title = it.tip; row.appendChild(h('span', 'sr-only', it.tip)); }
    row.appendChild(h('span', 'plan-check-label', it.label));
    if (!it.pass && it.detail) row.appendChild(h('span', 'plan-check-detail', it.detail));
    return row;
  });
}

/** The folded check: `{ line, rows, update(check) }`; update repaints in place, so an open fold stays open.
 *  opts = { text?(check) -> string, rows?(doc, check) -> Node[], open?: boolean }: `text` replaces the check line,
 *  `rows` the rows, and `open` starts it unfolded. */
export function buildCheckFold(doc, check, name = 'Shape', opts = {}) {
  const rows = doc.createElement('div'); rows.className = 'plan-checks'; rows.hidden = true;
  const line = doc.createElement('button'); line.type = 'button'; line.className = 'btn plan-fold plan-check-line';
  const text = doc.createElement('span'); text.className = 'plan-fold-text';
  const chev = doc.createElement('span'); chev.className = 'plan-chev'; chev.textContent = '›'; chev.setAttribute('aria-hidden', 'true');
  line.append(text, chev);
  fold(line, rows);
  if (opts.open) { rows.hidden = false; line.setAttribute('aria-expanded', 'true'); }
  const update = (c) => {
    text.textContent = opts.text ? opts.text(c) : checkLine(c, name);
    rows.replaceChildren(...(opts.rows ? opts.rows(doc, c) : buildCheckRows(doc, c)));
  };
  update(check);
  return { line, rows, update };
}
