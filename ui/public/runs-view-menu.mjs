// ui/public/runs-view-menu.mjs — the Runs list's one View menu (runs redesign §3.1): Show (with counts), Group by,
// Started by (shared deployments) and Select. Pure: items for workflows/menu.mjs openMenu, the chip text, and the
// per-browser record. app.js opens the menu and repaints.
import { normaliseLabels } from '../../src/shared/run-labels.mjs';

export const VIEW_KEY = 'worca-cc.runs.view';
export const DEFAULT_VIEW = Object.freeze({ show: 'all', groupBy: 'none', person: '', labels: Object.freeze([]) });
const SHOW = [['all', 'All'], ['needs', 'Needs you'], ['running', 'Running'], ['waiting', 'Waiting'], ['finished', 'Finished'], ['archived', 'Archived']];
const GROUP = [['none', 'None'], ['project', 'Project'], ['date', 'Date']];
const OLD_SHOW = { all: 'all', live: 'running', finished: 'finished', needs: 'needs', archived: 'archived' };

function clean(v) {
  return {
    show: SHOW.some(([id]) => id === v?.show) ? v.show : 'all',
    groupBy: GROUP.some(([id]) => id === v?.groupBy) ? v.groupBy : 'none',
    person: typeof v?.person === 'string' ? v.person : '',
    labels: normaliseLabels(Array.isArray(v?.labels) ? v.labels.filter((l) => typeof l === 'string') : []).labels.slice(0, 20),
  };
}

export function loadRunsView(storage) {
  try {
    const raw = storage.getItem(VIEW_KEY);
    if (raw) return clean(JSON.parse(raw));
    const f = storage.getItem('worca-cc.runs.filter');
    const g = storage.getItem('worca-cc.runs.groupBy');
    if (f == null && g == null) return { ...DEFAULT_VIEW };
    const v = clean({ show: OLD_SHOW[f] || 'all', groupBy: g === 'project' || g === 'date' ? g : 'none' });
    storage.setItem(VIEW_KEY, JSON.stringify(v));
    storage.removeItem('worca-cc.runs.filter');
    storage.removeItem('worca-cc.runs.groupBy');
    return v;
  } catch { return { ...DEFAULT_VIEW }; }
}

export function saveRunsView(storage, v) {
  try { storage.setItem(VIEW_KEY, JSON.stringify(clean(v))); } catch { /* private mode: the view lasts the session */ }
}

const isDefault = (v) => v.show === 'all' && v.groupBy === 'none' && !v.person && !(v.labels || []).length;

/** '' for the default view, else the non-default parts and "N of M runs". */
export function viewChip(v, { shown, total, personName = '' }) {
  if (isDefault(v)) return '';
  const parts = [];
  if (v.show !== 'all') parts.push(SHOW.find(([id]) => id === v.show)[1]);
  if (v.groupBy !== 'none') parts.push(`By ${v.groupBy}`);
  if (v.person) parts.push(personName || v.person);
  if (v.show !== 'all' || v.person || (v.labels || []).length) parts.push(v.show === 'archived' ? `${shown} run${shown === 1 ? '' : 's'}` : `${shown} of ${total} runs`);
  return parts.join(' · ');
}

/** Items for openMenu. `onPick(patch)` gets {show} | {sort} | {groupBy} | {person} | {select: true} | {shortcuts: true}.
 *  `showOpts` / `groupOpts` default to the Runs lists; `sortOpts` adds a Sort by block (the Chats column); a group option's
 *  third entry is its hint. */
export function viewMenuItems(v, counts, { people = [], onPick, showOpts = SHOW, sortOpts = null, groupOpts = GROUP }) {
  const n = (x) => (x == null ? '' : String(x));
  const items = [{ header: 'Show' }];
  for (const [id, label] of showOpts) items.push({ label, hint: n(counts[id]), checked: v.show === id, onSelect: () => onPick({ show: id }) });
  if (sortOpts) {
    items.push({ header: 'Sort by' });
    for (const [id, label] of sortOpts) items.push({ label, checked: v.sort === id, onSelect: () => onPick({ sort: id }) });
  }
  items.push({ header: 'Group by' });
  for (const [id, label, hint] of groupOpts) items.push({ label, ...(hint ? { hint } : {}), checked: v.groupBy === id, onSelect: () => onPick({ groupBy: id }) });
  if (people.length) {
    items.push({ header: 'Started by' }, { label: 'Everyone', checked: !v.person, onSelect: () => onPick({ person: '' }) });
    for (const p of people) items.push({ label: p.name, checked: v.person === p.key, onSelect: () => onPick({ person: p.key }) });
  }
  items.push({ sep: true }, { label: 'Select', onSelect: () => onPick({ select: true }) },
    { label: 'Keyboard shortcuts', hint: '?', onSelect: () => onPick({ shortcuts: true }) });
  return items;
}
