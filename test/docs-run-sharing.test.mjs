// test/docs-run-sharing.test.mjs — docs/run-sharing.md names what an operator must know (run sharing s1, R-ops-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../docs/run-sharing.md', import.meta.url), 'utf8');

test('the run-sharing doc names the branch, the protection exemption, the stop rule and staleness', () => {
  for (const s of ['worca-runs', 'branch protection', 'git push origin --delete worca-runs', 'everyone must switch it off', 'Share my runs', 'stale', 'Include my runs',
    'Mine / Team / All', 'once a minute', 'read-only', 'times out after 30 seconds', 'at most 500 records']) {
    assert.ok(text.includes(s), s);
  }
});

test('the run-sharing doc names the retention, the compaction and the force-push exemption (s3)', () => {
  for (const s of ['14 days', 'single commit', 'force push', '--force-with-lease', 'exempt', 'git rev-list --count origin/worca-runs']) {
    assert.ok(text.includes(s), s);
  }
  assert.equal(text.includes('until the branch is pruned'), false);
});
