// test/orchestrator-results.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerProject, rollupSummary } from '../src/core/results.mjs';

// Unit-test the workspace rollup logic that _buildResults uses (the orchestrator
// wiring itself is exercised by the existing run integration tests + manual run).
test('rollupSummary sums member counts', () => {
  const perProject = {
    a: { summary: { filesNew: 1, filesChanged: 2, filesDeleted: 0, linesAdded: 10, linesRemoved: 1, blockingIssues: 1, nitpicks: 0 } },
    b: { summary: { filesNew: 0, filesChanged: 1, filesDeleted: 1, linesAdded: 4, linesRemoved: 3, blockingIssues: 0, nitpicks: 2 } },
  };
  const s = rollupSummary(perProject);
  assert.equal(s.filesNew, 1);
  assert.equal(s.filesChanged, 3);
  assert.equal(s.filesDeleted, 1);
  assert.equal(s.linesAdded, 14);
  assert.equal(s.blockingIssues, 1);
  assert.equal(s.nitpicks, 2);
});

test('buildPerProject keys results by projectKey', () => {
  const out = buildPerProject([
    { projectKey: 'a', results: { summary: { filesNew: 1 } } },
    { projectKey: 'b', results: { summary: { filesNew: 0 } } },
  ]);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.equal(out.a.summary.filesNew, 1);
});
