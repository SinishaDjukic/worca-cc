// test/ui-runs-view-menu.test.mjs — the Runs list's View menu (runs redesign §3.1): the per-browser record, the chip, the items
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRunsView, saveRunsView, viewChip, viewMenuItems, DEFAULT_VIEW, VIEW_KEY } from '../ui/public/runs-view-menu.mjs';

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
  assert.equal(viewChip({ show: 'all', groupBy: 'project', person: '' }, { shown: 41, total: 41 }), 'By project');
});

test('labels: the record round-trips them and drops non-strings; a labels-only filter shows "N of M runs"', () => {
  const s = mem();
  saveRunsView(s, { show: 'all', groupBy: 'none', person: '', labels: ['Hotfix', 3, null] });
  assert.deepEqual(loadRunsView(s), { show: 'all', groupBy: 'none', person: '', labels: ['hotfix'] });
  assert.equal(viewChip({ show: 'all', groupBy: 'none', person: '', labels: ['hotfix'] }, { shown: 1, total: 3 }), '1 of 3 runs');
});

test('menu items: Show with counts, Group by, Select; Started by only on shared deployments', () => {
  const items = viewMenuItems({ show: 'all', groupBy: 'none', person: '' }, { all: 41, needs: 2, running: 3, waiting: 2, finished: 36, archived: null },
    { people: [], onPick: () => {} });
  assert.deepEqual(items.filter((i) => i.header).map((i) => i.header), ['Show', 'Group by']);
  assert.deepEqual(items.filter((i) => i.checked != null).slice(0, 6).map((i) => [i.label, i.hint, i.checked]),
    [['All', '41', true], ['Needs you', '2', false], ['Running', '3', false], ['Waiting', '2', false], ['Finished', '36', false], ['Archived', '', false]]);
  assert.equal(viewChip({ show: 'waiting', groupBy: 'none', person: '' }, { shown: 2, total: 41 }), 'Waiting · 2 of 41 runs');
  assert.ok(items.some((i) => i.label === 'Select'));
  const shared = viewMenuItems(DEFAULT_VIEW, {}, { people: [{ key: 'ana', name: 'Ana' }], onPick: () => {} });
  assert.ok(shared.some((i) => i.header === 'Started by'));
});
