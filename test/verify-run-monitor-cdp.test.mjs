// test/verify-run-monitor-cdp.test.mjs — the run monitor proof (tools/verify-run-monitor-cdp.mjs) keeps its one-level
// check (1d): #running/<id> opens Details on its Overview tab, the run card inside `.rd-details`, and no glance shows
// beside it. (The Live view beside-or-under matrix went with the glance.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:run-monitor keeps the one-level proof (1d) and the live graph in the card (1e)', () => {
  const src = readFileSync(new URL('../tools/verify-run-monitor-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ["check('1d'", '1d one level', '#run-detail .rd-details .rd-glance .rd-sheet',
    "one.mode === 'details'", '/overview/i', 'strayGlance', ':scope > .rd-glance:not([hidden])',
    "check('1e'", '.rd-sheet-nav > .rd-live:not([hidden]) .gv-world .node', 'lg.left >= lg.mainRight']) {
    assert.ok(src.includes(needle), needle);
  }
  for (const gone of ['1d graph beside the card', '1d graph under the details', '.rd-live-switch', 'rd-live.is-in']) {
    assert.ok(!src.includes(gone), `the Live view proof is gone: ${gone}`);
  }
});
