// test/design-system-search-two-lines.test.mjs — gate G F-W3a1-10 (docs/rail/components.md Search): a top-bar hit for a
// Settings home not in Stillhet yet ("network proxy", "machine load") carries a long where line ("… · Not in Stillhet
// yet: turn Stillhet off …"). On one line the where took the row, the name collapsed to 0–7px and drew over it, and the
// where ran past the popover at 1280 and 390. The rule: a result is its name on one line and where it lives on the line
// under it; the where wraps inside the popover. jsdom has no layout, so this reads the cascade the app loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const last = (sel, prop) => {
  let hit = null;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.trim()).includes(sel)) continue;
    const d = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(m[2]); if (d) hit = d[1].trim();
  }
  return hit;
};

test('F-W3a1-10: a search result is two rows, its name on the first and where it lives under it', () => {
  assert.equal(last('.rl-search-res .menu-item', 'display'), 'grid');
  assert.equal(last('.rl-search-res .menu-item > .mi-l', 'grid-row'), '1');
  assert.equal(last('.rl-search-res .menu-item > .mi-l', 'grid-column'), '2');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'grid-row'), '2');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'grid-column'), '2');
});

test('F-W3a1-10: the where line wraps inside the popover instead of running past it', () => {
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'white-space'), 'normal');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'margin-left'), '0');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'overflow-wrap'), 'anywhere');
  assert.equal(last('.rl-search-res .menu-item', 'height'), 'auto');
});
