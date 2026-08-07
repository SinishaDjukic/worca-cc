// test/ui-stats-chart-hover-css.test.mjs — the chart hover band must not hide
// the bars. The .ch-hit rect is appended AFTER the bar segments (SVG paints in
// DOM order), so its :hover fill sits ON TOP of the column: an opaque fill
// (e.g. var(--field)) erases the hovered bar. The hover highlight must be a
// translucent overlay instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'),
  'utf8',
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

test('.ch-hit base rect stays invisible', () => {
  const body = ruleBody('.ch-hit');
  assert.ok(body, '.ch-hit rule missing');
  assert.match(body, /fill:\s*transparent/);
});

test('.ch-hit:hover is a translucent overlay, never an opaque fill over the bars', () => {
  const body = ruleBody('.ch-hit:hover');
  assert.ok(body, '.ch-hit:hover rule missing');
  assert.doesNotMatch(body, /fill:\s*var\(--field\)/,
    'opaque --field paints over the bar segments and hides them');
  assert.match(body, /fill-opacity:\s*\.0?\d+/,
    'hover band must be translucent so the hovered bar stays visible');
});
