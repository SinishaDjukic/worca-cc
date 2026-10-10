// Watch PR live test (PR #659): flaky on purpose. On GitHub Actions it fails on a run's first attempt
// and passes when the failed jobs are re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('watch probe: fails on the first CI attempt only', () => {
  if (process.env.GITHUB_ACTIONS) assert.notEqual(process.env.GITHUB_RUN_ATTEMPT, '1', 'flaky on purpose: the first attempt fails');
});
