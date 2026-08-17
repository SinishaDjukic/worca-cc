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

// `new` is included because omitting it let a diff whose every line landed in NEW
// files announce itself as "0 changed · 0 removed" — as no diff at all.
test('diffBadges always returns new + changed + removed, even at zero', () => {
  assert.deepEqual(
    diffBadges({ summary: { filesNew: 2, filesChanged: 1, filesDeleted: 0 } }),
    [{ kind: 'new', n: 2, text: '2 new' },
      { kind: 'changed', n: 1, text: '1 changed' },
      { kind: 'removed', n: 0, text: '0 removed' }],
  );
  assert.deepEqual(
    diffBadges(null),
    [{ kind: 'new', n: 0, text: '0 new' },
      { kind: 'changed', n: 0, text: '0 changed' },
      { kind: 'removed', n: 0, text: '0 removed' }],
  );
});

// The regression that motivated it: all-new-files must not read as an empty diff.
test('diffBadges reports an all-new-files change instead of calling it empty', () => {
  const [isNew, changed] = diffBadges({ summary: { filesNew: 2, filesChanged: 0, filesDeleted: 0, linesAdded: 14 } });
  assert.equal(isNew.text, '2 new');
  assert.equal(changed.n, 0, 'nothing was modified — and that is now sayable without implying nothing happened');
});
