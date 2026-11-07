// test/docs-run-sharing.test.mjs — docs/run-sharing.md names what an operator must know (run sharing s1, R-ops-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../docs/run-sharing.md', import.meta.url), 'utf8');

test('the run-sharing doc names the branch, the protection exemption, the stop rule and staleness', () => {
  for (const s of ['worca-runs', 'branch protection', 'git push origin --delete worca-runs', 'everyone must switch it off', 'Share my runs', 'stale', 'Include my runs']) {
    assert.ok(text.includes(s), s);
  }
});
