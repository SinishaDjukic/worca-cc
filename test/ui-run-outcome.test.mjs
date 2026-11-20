// test/ui-run-outcome.test.mjs — the caveat a done run carries (E2 open issues, 2.3 End not reached).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeNote, openIssueCount } from '../ui/public/run-outcome.mjs';

test('a forced loop shows its open issues; quiescence shows End not reached; a clean run shows nothing', () => {
  const open = [{ nodeId: 'n_review', count: 2 }, { nodeId: 'n_refine', count: 1 }];
  assert.equal(openIssueCount({ openIssues: open }), 3);
  assert.equal(outcomeNote({ status: 'done', openIssues: open, endReached: true }).text, '3 open issues');
  assert.equal(outcomeNote({ status: 'done', openIssues: [{ count: 1 }] }).text, '1 open issue');
  assert.equal(outcomeNote({ status: 'done', openIssueCount: 4 }).text, '4 open issues', 'a History entry carries the count');
  assert.equal(outcomeNote({ status: 'done', endReached: false }).text, 'End not reached');
  assert.equal(outcomeNote({ status: 'done', endReached: true, openIssues: [] }), null);
  assert.equal(outcomeNote({ status: 'done' }), null, 'a v1 run (no endReached) is a plain done');
  assert.equal(outcomeNote({ status: 'error', openIssues: open }), null, 'only a done run carries the caveat');
});
