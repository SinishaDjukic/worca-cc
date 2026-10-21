// test/verify-run-monitor-cdp.test.mjs — the run monitor proof (tools/verify-run-monitor-cdp.mjs) keeps its run 3 (D16)
// check: the Live view graph under the run details at 1440 and 1920, with the Runs list at 280px and at its max.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:run-monitor keeps the graph-under-details proof (run 3, D16)', () => {
  const src = readFileSync(new URL('../tools/verify-run-monitor-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ['1d graph under the details', '1920', '1440', 'worca-cc.runs.listWidth', 'maxListWidth', '.rd-live']) {
    assert.ok(src.includes(needle), needle);
  }
});
