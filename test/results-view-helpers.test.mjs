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
