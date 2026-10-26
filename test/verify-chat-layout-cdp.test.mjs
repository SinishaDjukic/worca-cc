// test/verify-chat-layout-cdp.test.mjs — the Chat layout proof (tools/verify-chat-layout-cdp.mjs, #959) keeps its mock
// CLI start, both widths, the classic-scrollbar stand-in and every check the issue names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:chat-layout keeps its #959 checks', () => {
  const src = readFileSync(new URL('../tools/verify-chat-layout-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ["'ui', 'start', '--mock'", 'WORCA_HOME', '[1024, 1440]', '::-webkit-scrollbar{width:15px}',
    "every card's left and right edge is the text column's", 'no graph wider than its well', 'centred on its title line',
    'the composer and the column share one centre', 'nothing under the composer', 'Jump to latest sits in the band',
    'no pill and no corner past the card', '--report-only',
    'revalidateWorkflowProposal', "'.ask-wfcard .gv-well .gv-world .node'", 'opens at 0.3x at its start edge', 'no well taller than its placed graph']) {
    assert.ok(src.includes(needle), needle);
  }
  assert.ok(!src.includes('--hide-scrollbars'), 'the proof needs classic scrollbars drawn');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['verify:chat-layout'], /tools\/verify-chat-layout-cdp\.mjs/);
});
