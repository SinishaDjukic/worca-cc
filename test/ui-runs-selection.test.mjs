// test/ui-runs-selection.test.mjs — Runs list selection (runs redesign §3.2, §5a.4): keys, the selection set, the bar, the bulk body
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunsSelection, runsKeyAction, barModel, bulkBody, rangeKeys, rowTarget, labelTargets } from '../ui/public/runs-selection.mjs';
import { buildRunsModel } from '../ui/public/runs-list.mjs';

const ev = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, targetIsRow: true, inField: false, ...o });

test('keys (§5a.4): Space on a row toggles, ⌘A / Ctrl+A selects all, Esc clears only a non-empty selection', () => {
  assert.equal(runsKeyAction(ev(' ')), 'toggle');
  assert.equal(runsKeyAction(ev(' ', { targetIsRow: false })), null);
  assert.equal(runsKeyAction(ev('a', { metaKey: true })), 'all');
  assert.equal(runsKeyAction(ev('a', { ctrlKey: true })), 'all');
  assert.equal(runsKeyAction(ev('a', { metaKey: true, inField: true })), null);
  assert.equal(runsKeyAction(ev('Escape'), { size: 2 }), 'clear');
  assert.equal(runsKeyAction(ev('Escape'), { size: 0 }), null);
});

test('selection: toggle, select all, prune rows that left the list', () => {
  const s = createRunsSelection();
  s.toggle('a'); s.toggle('b'); s.toggle('a');
  assert.deepEqual([...s.keys()], ['b']);
  s.selectAll(['a', 'b', 'c']);
  assert.equal(s.size, 3);
  s.prune(new Set(['a']));
  assert.deepEqual([...s.keys()], ['a']);
  s.clear();
  assert.equal(s.size, 0);
});

test('the bar: "2 selected", per-action counts, a group stop counts its waiting members, skips named in the title', () => {
  const targets = [
    { id: 'g', title: 'Feature', state: 'working', groupId: 'feat_1', groupKind: 'feature', members: [
      { id: 'p1', title: 'S1', state: 'working' }, { id: 't2', title: 'S2', state: 'waiting' }] },
    { id: 'h', title: 'Old', state: 'merged', pipelineId: 'h' },
  ];
  const bar = barModel(targets);
  assert.equal(bar.label, '2 selected');
  assert.deepEqual([bar.stop.count, bar.archive.count, bar.delete.count], [2, 1, 2]);
  assert.equal(bar.archive.title, 'Skipped 1 still running: S1. Skipped 1 not started yet: S2.');
  assert.deepEqual(bulkBody('stop', targets), { action: 'stop', targets: [{ pipelineId: 'h', runId: null, ticketId: null }],
    groups: [{ id: 'feat_1', kind: 'feature', title: 'Feature' }] });
});

test('a plain Run-after chain is sent as a group with its member refs, so the server cancels its waiting members', () => {
  const chain = { id: 'chain:p:p1', title: 'Chain', state: 'working', groupId: 'p:p1', groupKind: 'chain', members: [
    { id: 'p1', title: 'One', state: 'working', pipelineId: 'p1', runId: 'r1', ticketId: null },
    { id: 't2', title: 'Two', state: 'waiting', pipelineId: null, runId: null, ticketId: 't2' }] };
  assert.equal(barModel([chain]).stop.count, 2);
  assert.deepEqual(bulkBody('stop', [chain]), { action: 'stop', targets: [], groups: [{ id: 'p:p1', kind: 'chain', title: 'Chain',
    members: [{ pipelineId: 'p1', runId: 'r1', ticketId: null }, { pipelineId: null, runId: null, ticketId: 't2' }] }] });
});

test('rangeKeys (A11, spec §3.2): Shift-click selects the visible keys from the anchor through the key, either way', () => {
  assert.deepEqual(rangeKeys(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeKeys(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeKeys(['a', 'b', 'c', 'd'], 'x', 'c'), ['c'], 'a missing anchor selects just the key');
  assert.deepEqual(rangeKeys(['a', 'b', 'c', 'd'], 'a', 'z'), [], 'a key outside the list selects nothing');
});

test('labelTargets: a chain expands to its members\' pipeline ids, deduped; a scheduled ticket is skipped', () => {
  const m = { state: 'done' };
  const chain = rowTarget({ kind: 'chain', key: 'chain:c1', title: 'C', model: m, groupId: 'c1', groupKind: 'chain', members: [
    { key: 'member:c1/p1', pipelineId: 'p1', model: m, labels: ['hotfix'] },
    { key: 'member:c1/t1', kind: 'sched', ticketId: 't1', model: m }] });
  const solo = rowTarget({ kind: 'hist', key: 'hist:k/p1', pipelineId: 'p1', model: m, labels: ['hotfix'] });
  const other = rowTarget({ kind: 'hist', key: 'hist:k/p2', pipelineId: 'p2', model: m });
  const ticket = rowTarget({ kind: 'sched', key: 'sched:t2', model: m });
  assert.deepEqual(labelTargets([chain, solo, other, ticket]), [{ pipelineId: 'p1', labels: ['hotfix'] }, { pipelineId: 'p2', labels: [] }]);
});

test('an interrupted History row with no resume point offers Archive and Delete; one that can resume does not', () => {
  const history = [
    { id: 'p1', projectKey: 'k', title: 'Dead', status: 'interrupted', resumable: false, startedAt: '2026-08-01T00:00:00Z' },
    { id: 'p2', projectKey: 'k', title: 'Parked', status: 'interrupted', resumable: true, startedAt: '2026-08-02T00:00:00Z' },
  ];
  const rows = buildRunsModel({ history }).sections.flatMap((s) => s.rows);
  const by = Object.fromEntries(rows.map((r) => [r.pipelineId, barModel([rowTarget(r)])]));
  assert.deepEqual([by.p1.archive.count, by.p1.delete.count, by.p1.stop.count], [1, 1, 0]);
  assert.deepEqual([by.p2.archive.count, by.p2.delete.count, by.p2.stop.count], [0, 0, 0]);
  assert.equal(by.p2.archive.title, 'Skipped 1 interrupted — resume it first: Parked.');
});
