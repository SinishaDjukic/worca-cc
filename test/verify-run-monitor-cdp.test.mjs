// test/verify-run-monitor-cdp.test.mjs — the run monitor proof (tools/verify-run-monitor-cdp.mjs) keeps its Live view
// check (1d): the graph beside the card when the run pane is wide, under the run details otherwise, at 1440 and 1920,
// with the Runs list at 280px and at its max.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:run-monitor keeps the graph beside-or-under proof (run 3, D16)', () => {
  const src = readFileSync(new URL('../tools/verify-run-monitor-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ['1d graph beside the card', '1d graph under the details', 'both beside the card and under it',
    '>= 960', '1920', '1440', 'worca-cc.runs.listWidth', 'maxListWidth', '.rd-live']) {
    assert.ok(src.includes(needle), needle);
  }
});
