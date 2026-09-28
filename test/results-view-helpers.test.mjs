// test/results-view-helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryChips, mergeFindings, statusChip, diffBadges } from '../ui/public/results-view.mjs';

test('summaryChips renders human counts', () => {
  const chips = summaryChips({ summary: { filesNew: 3, filesChanged: 7, filesDeleted: 1, linesAdded: 412, linesRemoved: 88, blockingIssues: 2 } });
  assert.deepEqual(chips, ['3 new', '7 changed', '1 deleted', '+412 / −88', '2 to check']);
});

test('summaryChips omits zero buckets', () => {
  const chips = summaryChips({ summary: { filesNew: 0, filesChanged: 2, filesDeleted: 0, linesAdded: 5, linesRemoved: 0, blockingIssues: 0 } });
  assert.deepEqual(chips, ['2 changed', '+5 / −0', 'Clean']);
});

test('mergeFindings tags origin and never drops review checks', () => {
  const checks = [{ id: 'c1', severity: 'critical', title: 'review issue', origin: 'review' }];
  const findings = [{ severity: 'warn', file: 'a.ts', line: 2, title: 'agent issue', detail: 'd', newVsReview: true }];
  const merged = mergeFindings(checks, findings);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].origin, 'review');
  assert.equal(merged[1].origin, 'agent');
  assert.equal(merged[1].isNew, true);
});

test('statusChip is Clean with no blocking issues, else "N to check"', () => {
  assert.equal(statusChip({ summary: { blockingIssues: 0 } }), 'Clean');
  assert.equal(statusChip({ summary: { blockingIssues: 3 } }), '3 to check');
  assert.equal(statusChip(null), 'Clean'); // missing results -> Clean
});

test('diffBadges always returns changed + removed, even at zero', () => {
  assert.deepEqual(
    diffBadges({ summary: { filesChanged: 1, filesDeleted: 0 } }),
    [{ kind: 'changed', n: 1, text: '1 changed' }, { kind: 'removed', n: 0, text: '0 removed' }],
  );
  assert.deepEqual(
    diffBadges(null),
    [{ kind: 'changed', n: 0, text: '0 changed' }, { kind: 'removed', n: 0, text: '0 removed' }],
  );
});

import { memoryChangesRows } from '../ui/public/results-view.mjs';

test('memoryChangesRows: one row per change entry, chips per file, rejected and failed chips carry the reason as title', () => {
  const rows = memoryChangesRows({ changes: [
    { executionId: 'x:n_impl:1', nodeId: 'n_impl', agentKey: 'implementer',
      added: [{ scope: 'project', name: 'lesson' }], modified: [{ scope: 'global', name: 'testing' }], deleted: [],
      rejected: [{ scope: 'global', name: 'huge', reason: 'over the 32768-byte cap' }],
      failed: [{ scope: 'project', name: 'trap', reason: 'written into the read-only rules copy — Claude requested permissions to edit /x which is a sensitive file.' }] },
    { executionId: null, nodeId: 'resume', agentKey: null, added: [], modified: [], deleted: [{ scope: 'project', name: 'old' }], rejected: [] },
    { executionId: null, nodeId: 'final', agentKey: null, added: [], modified: [], deleted: [], rejected: [], failed: [{ scope: '', name: 'notes', reason: 'disk full' }] },
  ] });
  assert.deepEqual(rows, [
    { node: 'implementer', chips: [
      { kind: 'add', text: '+ project/lesson.md', scope: 'project', name: 'lesson' },
      { kind: 'mod', text: '~ global/testing.md', scope: 'global', name: 'testing' },
      { kind: 'rej', text: '✕ global/huge.md', title: 'over the 32768-byte cap', scope: 'global', name: 'huge' },
      { kind: 'fail', text: '⊘ project/trap.md', title: 'written into the read-only rules copy — Claude requested permissions to edit /x which is a sensitive file.', scope: 'project', name: 'trap' },
    ] },
    { node: 'resume', chips: [{ kind: 'del', text: '− project/old.md', scope: 'project', name: 'old' }] },
    { node: 'final', chips: [{ kind: 'fail', text: '⊘ notes.md', title: 'disk full', scope: '', name: 'notes' }] },
  ]);
  assert.deepEqual(memoryChangesRows(null), []);
  assert.deepEqual(memoryChangesRows({ changes: [] }), []);
  assert.deepEqual(memoryChangesRows({ changes: [{ nodeId: 'n', added: [], modified: [], deleted: [], rejected: [] }] }), [], 'an empty (pre-split) entry renders nothing');
});
