// test/ui-runs-view-menu.test.mjs — the Runs list's View menu (runs redesign §3.1): the per-browser record, the chip, the items
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRunsView, saveRunsView, viewChip, viewMenuItems, DEFAULT_VIEW, VIEW_KEY } from '../ui/public/runs-view-menu.mjs';
import { chatsViewMenuItems } from '../ui/public/chats-list.mjs';

const mem = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('the view is remembered per browser; old keys migrate once; junk falls back to the default', () => {
  const s = mem({ 'worca-cc.runs.filter': 'live', 'worca-cc.runs.groupBy': 'project' });
  assert.deepEqual(loadRunsView(s), { show: 'running', groupBy: 'project', person: '', labels: [] });
  assert.equal(s.m.has('worca-cc.runs.filter'), false);
  saveRunsView(s, { show: 'needs', groupBy: 'none', person: '' });
  assert.deepEqual(loadRunsView(s), { show: 'needs', groupBy: 'none', person: '', labels: [] });
  assert.deepEqual(loadRunsView(mem({ [VIEW_KEY]: '{bad' })), DEFAULT_VIEW);
  assert.deepEqual(loadRunsView({ getItem() { throw new Error('denied'); } }), DEFAULT_VIEW);
});

test('chip: none for the default; "Running · 2 of 41 runs"; group by alone', () => {
  assert.equal(viewChip(DEFAULT_VIEW, { shown: 41, total: 41 }), '');
  assert.equal(viewChip({ show: 'running', groupBy: 'none', person: '' }, { shown: 2, total: 41 }), 'Running · 2 of 41 runs');
  assert.equal(viewChip({ show: 'all', groupBy: 'project', person: '' }, { shown: 41, total: 41 }), '', 'grouping alone draws no chip');
  assert.equal(viewChip({ show: 'all', groupBy: 'date', person: '' }, { shown: 41, total: 41 }), '');
});

test('labels: the record round-trips them and drops non-strings; a labels-only filter shows "N of M runs"', () => {
  const s = mem();
  saveRunsView(s, { show: 'all', groupBy: 'none', person: '', labels: ['Hotfix', 3, null] });
  assert.deepEqual(loadRunsView(s), { show: 'all', groupBy: 'none', person: '', labels: ['hotfix'] });
  assert.equal(viewChip({ show: 'all', groupBy: 'none', person: '', labels: ['hotfix'] }, { shown: 1, total: 3 }), '1 of 3 runs');
});

test('menu items: Show with counts, Group by, Select; Started by only on shared deployments', () => {
  const items = viewMenuItems({ show: 'all', groupBy: 'none', person: '' }, { all: 41, needs: 2, running: 3, waiting: 2, finished: 36, ready: 9, archived: null },
    { people: [], onPick: () => {} });
  assert.deepEqual(items.filter((i) => i.header).map((i) => i.header), ['Show']);
  assert.deepEqual(items.filter((i) => i.segmented).map((i) => i.label), ['Group by']);
  assert.deepEqual(items.filter((i) => i.checked != null).slice(0, 7).map((i) => [i.label, i.hint, i.checked]),
    [['All', '41', true], ['Needs you', '2', false], ['Running', '3', false], ['Waiting', '2', false], ['Finished', '36', false],
      ['Ready to ship', '9', false], ['Archived', '', false]]);
  assert.equal(viewChip({ show: 'waiting', groupBy: 'none', person: '' }, { shown: 2, total: 41 }), 'Waiting · 2 of 41 runs');
  assert.equal(viewChip({ show: 'ready', groupBy: 'none', person: '' }, { shown: 9, total: 41 }), 'Ready to ship · 9 of 41 runs');
  assert.ok(items.some((i) => i.label === 'Select'));
  const shared = viewMenuItems(DEFAULT_VIEW, {}, { people: [{ key: 'ana', name: 'Ana' }], onPick: () => {} });
  assert.ok(shared.some((i) => i.header === 'Started by'));
});

test('menu items: Keyboard shortcuts is the last item, hint ?', () => {
  let picked = null;
  const items = viewMenuItems({ show: 'all', groupBy: 'none', person: '' }, {}, { onPick: (p) => { picked = p; } });
  const last = items.at(-1);
  assert.deepEqual([last.label, last.hint], ['Keyboard shortcuts', '?']);
  last.onSelect();
  assert.deepEqual(picked, { shortcuts: true });
});

test('#948 s2: with no options the items are the Runs list', () => {
  const v = { show: 'all', groupBy: 'none', person: '' };
  const runs = viewMenuItems(v, {}, { onPick: () => {} }).map((i) => i.label || i.header || 'sep');
  assert.deepEqual(runs, ['Show', 'All', 'Needs you', 'Running', 'Waiting', 'Finished', 'Ready to ship', 'Archived', 'Group by', 'sep', 'Select', 'Keyboard shortcuts']);
});

test('#948 s2 + compact menu: Group by and Sort by are segmented items; titles carry the full names; Select hints ⌘ / Ctrl click', () => {
  const v = { show: 'all', sort: 'activity', groupBy: 'date' };
  let picked = null;
  const items = chatsViewMenuItems(v, { all: 54 }, { onPick: (p) => { picked = p; }, mac: true });
  const [sort, group] = items.filter((i) => i.segmented);
  assert.equal(sort.label, 'Sort by');
  assert.equal(sort.value, 'activity');
  assert.deepEqual(sort.options, [{ id: 'activity', label: 'Recent', title: 'Last activity' }, { id: 'created', label: 'Created' },
    { id: 'title', label: 'A–Z', title: 'Title A–Z' }, { id: 'cost', label: 'Cost' }]);
  assert.deepEqual(group.options.map((o) => [o.label, o.title || '']), [['Date', 'Today · Recent · Older'], ['Project', ''], ['Topic', ''], ['None', '']]);
  sort.onSelect('cost'); assert.deepEqual(picked, { sort: 'cost' });
  group.onSelect('topic'); assert.deepEqual(picked, { groupBy: 'topic' });
  assert.equal(items.find((i) => i.label === 'Select').hint, '⌘ click');
  assert.equal(viewMenuItems(DEFAULT_VIEW, {}, { onPick() {} }).find((i) => i.label === 'Select').hint, 'Ctrl click');
  const runs = viewMenuItems(DEFAULT_VIEW, {}, { onPick() {} });
  assert.deepEqual(runs.find((i) => i.segmented).options.map((o) => o.id), ['none', 'project', 'date']);
});
