// ui/public/labels-settings.mjs — Settings › Labels & cost tags › Labels (slice s2): the labels in use, Rename, Delete.
// Pure DOM: app.js passes the rows (GET /api/labels) and the two callbacks, which own the modals and the requests.
import { labelHue } from '../../src/shared/run-labels.mjs';
import { icon } from './icons.mjs';
import { toggleMenu } from './workflows/menu.mjs';

export const runCount = (n) => `${n} run${n === 1 ? '' : 's'}`;

/** labels: [{ label, count }] most used first → the list element (rows, or the empty hint). */
export function renderLabelsSection(doc, labels, { onRename, onDelete } = {}) {
  const list = doc.createElement('div');
  list.className = 'lbl-set-list drows';
  if (!labels.length) {
    const p = doc.createElement('p');
    p.className = 'hint lbl-set-empty';
    p.textContent = 'No labels yet. Add one from a run page or the Runs list.';
    list.append(p);
    return list;
  }
  for (const row of labels) {
    const r = doc.createElement('div');
    r.className = 'drow lbl-set-row';
    r.dataset.label = row.label;
    const dot = doc.createElement('span');
    dot.className = `label-dot hue-${labelHue(row.label)}`;
    dot.setAttribute('aria-hidden', 'true');
    const name = doc.createElement('span');
    name.className = 'lbl-set-name';
    name.textContent = row.label;
    const count = doc.createElement('span');
    count.className = 'lbl-set-count';
    count.textContent = `on ${runCount(row.count)}`;
    const more = doc.createElement('button');
    more.type = 'button';
    more.className = 'btn btn-sm btn-quiet btn-icon lbl-set-more';
    more.setAttribute('aria-label', `More for ${row.label}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.append(icon(doc, 'more', 14));
    more.addEventListener('click', () => toggleMenu({ doc, anchor: more, align: 'end', label: `Actions for ${row.label}`, items: [
      { label: 'Rename', onSelect: () => onRename && onRename(row) },
      { label: 'Delete', onSelect: () => onDelete && onDelete(row) },
    ] }));
    const label = doc.createElement('span');
    label.className = 'drow-label';
    label.append(dot, name, count);
    const ctl = doc.createElement('span');
    ctl.className = 'drow-control';
    ctl.append(more);
    r.append(label, ctl);
    list.append(r);
  }
  return list;
}
