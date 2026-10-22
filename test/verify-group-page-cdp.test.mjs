// test/verify-group-page-cdp.test.mjs — the group page's Chrome proof (tools/verify-feature-page-cdp.mjs) cannot
// silently shrink: it must keep auditing the group page's layout at both widths and in both themes (slice 4, D21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../tools/verify-feature-page-cdp.mjs', import.meta.url), 'utf8');

test('the feature page proof audits the group page at 290, 375 and 1440, light and dark', () => {
  for (const needle of ['auditGroupPageLayout', '290', '375', '1440', "'light'", "'dark'", '.gpage']) {
    assert.ok(src.includes(needle), `the proof names ${needle}`);
  }
});

test('the feature page proof opens the group page in the Runs pane, beside the list (run 3, D1-D6)', () => {
  for (const needle of ['#runs-pane', 'member-open', 'rd-crumbs', 'PASS group page in the pane']) {
    assert.ok(src.includes(needle), `the proof names ${needle}`);
  }
});
