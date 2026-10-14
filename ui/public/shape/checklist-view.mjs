// "Perspective checklists" on the run page's and History's Overview (spec D7): one group per review cycle that
// carries a checklist, newest first and open, older ones folded. Pure DOM over the saved review rows
// (readPipelineExtras), no globals.
import { checklistTally, checklistTallyText } from '../../../src/shared/shape/review-checklist.mjs';

const STATUS_LABEL = Object.freeze({ met: 'Met', unmet: 'Unmet', na: 'N/A', missing: 'Not reported' });

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
  const root = el('section', 'shape-checklists');
  root.appendChild(el('h3', 'shape-cl-title', 'Perspective checklists'));
  rows.forEach((r, i) => {
    const group = el('details', 'shape-cl-cycle');
    group.open = i === 0;
    group.appendChild(el('summary', 'shape-cl-caption',
      `Review cycle ${r.cycle} · ${checklistTallyText(checklistTally(r.checklist), { prefix: '' })}`));
    const ul = el('ul', 'shape-cl-list');
    for (const c of r.checklist) {
      const status = Object.hasOwn(STATUS_LABEL, c?.status) ? c.status : 'missing';
      const li = el('li', `shape-cl-item st-${status}`);
      li.append(el('span', 'shape-cl-status', STATUS_LABEL[status]), el('code', 'shape-cl-id', String(c?.id || '')),
        el('span', 'shape-cl-text', String(c?.text || '')));
      if (c?.evidence) li.appendChild(el('div', 'shape-cl-evidence', String(c.evidence)));
      ul.appendChild(li);
    }
    group.appendChild(ul);
    root.appendChild(group);
  });
  return root;
}
