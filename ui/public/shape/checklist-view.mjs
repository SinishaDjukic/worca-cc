// "Perspective checklists" on the run page's and History's Overview (spec D7, D23): the latest review cycle as one
// summary line, its unmet / unproven items open, its met and n/a items folded behind a button, and earlier cycles
// behind one more. Pure DOM over the saved review rows (readPipelineExtras), no globals.
import { icon } from '../icons.mjs';
import { checklistTally, checklistTallyText } from '../../../src/shared/shape/review-checklist.mjs';

const STATUS_LABEL = Object.freeze({ met: 'Met', unmet: 'Unmet', na: 'N/A', missing: 'Not reported' });
let seq = 0;   // aria-controls ids, unique across mounts

const statusOf = (c) => (Object.hasOwn(STATUS_LABEL, c?.status) ? c.status : 'missing');
/** Met with evidence and n/a fold away; unmet, not reported and met-without-evidence stay open. */
const folds = (c) => { const s = statusOf(c); return s === 'na' || (s === 'met' && !!c?.evidence); };
const items = (n, word) => `${n} ${word} item${n === 1 ? '' : 's'}`;

/** "Show 23 met items", "Show 20 met and 3 n/a items", "Show 1 n/a item". */
export function foldLabel(met, na) {
  if (met && na) return `Show ${met} met and ${na} n/a items`;
  return `Show ${met ? items(met, 'met') : items(na, 'n/a')}`;
}

/** @returns {HTMLElement|null} null when no review carries a checklist. */
export function renderChecklistGroups(doc, reviews) {
  const rows = (Array.isArray(reviews) ? reviews : [])
    .filter((r) => r && Array.isArray(r.checklist) && r.checklist.length)
    .sort((a, b) => (Number(b.cycle) || 0) - (Number(a.cycle) || 0));
  if (!rows.length) return null;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // A real button that shows/hides `target` and says so through aria-expanded.
  const disclosure = (cls, label, target) => {
    const id = `shape-cl-${++seq}`;
    target.id = id;
    target.hidden = true;
    const btn = el('button', `link-btn shape-cl-toggle ${cls}`);
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    const chev = el('span', 'chev');
    chev.append(icon(doc, 'chevron-down', 12));
    chev.setAttribute('aria-hidden', 'true');
    btn.append(el('span', 'shape-cl-toggle-label', label), chev);
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      target.hidden = !open;
    });
    return btn;
  };
  const list = (cls, checklist) => {
    const ul = el('ul', `shape-cl-list ${cls}`);
    for (const c of checklist) {
      const status = statusOf(c);
      const li = el('li', `shape-cl-item st-${status}`);
      li.append(el('span', 'shape-cl-status', STATUS_LABEL[status]), el('code', 'shape-cl-id', String(c?.id || '')),
        el('span', 'shape-cl-text', String(c?.text || '')));
      if (c?.evidence) li.appendChild(el('div', 'shape-cl-evidence', String(c.evidence)));
      ul.appendChild(li);
    }
    return ul;
  };
  const cycle = (r) => {
    const box = el('div', 'shape-cl-cycle');
    box.dataset.cycle = String(r.cycle);
    box.appendChild(el('p', 'shape-cl-caption',
      `Review cycle ${r.cycle} · ${checklistTallyText(checklistTally(r.checklist), { prefix: '' })}`));
    const open = r.checklist.filter((c) => !folds(c));
    const folded = r.checklist.filter(folds);
    if (open.length) box.appendChild(list('shape-cl-open', open));
    if (folded.length) {
      const met = folded.filter((c) => statusOf(c) === 'met').length;
      const ul = list('shape-cl-folded', folded);
      box.append(disclosure('shape-cl-more', foldLabel(met, folded.length - met), ul), ul);
    }
    return box;
  };

  const root = el('section', 'shape-checklists');
  root.appendChild(el('h3', 'shape-cl-title', 'Perspective checklists'));
  root.appendChild(cycle(rows[0]));
  const earlier = rows.slice(1);
  if (earlier.length) {
    const box = el('div', 'shape-cl-earlier');
    for (const r of earlier) box.appendChild(cycle(r));
    root.append(disclosure('shape-cl-earlier-btn', `Earlier cycles (${earlier.length})`, box), box);
  }
  return root;
}
