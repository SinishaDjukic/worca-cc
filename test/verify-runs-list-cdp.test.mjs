// test/verify-runs-list-cdp.test.mjs — the Runs list Chrome proof (tools/verify-runs-list-cdp.mjs) cannot silently shrink:
// it must keep walking both widths, both themes and all three popovers (runs redesign §3.3a, D27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../tools/verify-runs-list-cdp.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the Runs list proof covers 290, 375 and 1440, light and dark, the View menu, the row ⋯ menu, Add to group, the resize handle, running dividers', () => {
  for (const needle of ['290', '375', '1440', 'runs-resize', 'Page.reload', "'light'", "'dark'", 'runs-view-btn', 'runs-more', 'group-picker', 'auditRunsLayout', 'auditButtons', 'full width minus 16px',
    'runs-sec-waiting', 'PASS waiting section', 'PASS running dividers']) {
    assert.ok(src.includes(needle), `the proof names ${needle}`);
  }
  assert.equal(pkg.scripts['verify:runs-list'], 'node --disable-warning=ExperimentalWarning tools/verify-runs-list-cdp.mjs');
});
