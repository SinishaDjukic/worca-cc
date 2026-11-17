// test/design-system-search-two-lines.test.mjs — gate G F-W3a1-10 (docs/stillhet/components.md Search): a top-bar hit for a
// Settings home not in Stillhet yet ("network proxy", "machine load") carries a long where line ("… · Not in Stillhet
// yet: turn Stillhet off …"). On one line the where took the row, the name collapsed to 0–7px and drew over it, and the
// where ran past the popover at 1280 and 390. The rule now (list.one-line): a result is one line, its name keeps at least
// 40% of it, and where it lives folds to … at its end with the whole text in the tooltip. jsdom has no layout, so this
// reads the cascade the app loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('ui/public/stillhet/css/stillhet.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const last = (sel, prop) => {
  let hit = null;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.trim()).includes(sel)) continue;
    const d = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(m[2]); if (d) hit = d[1].trim();
  }
  return hit;
};

test('F-W3a1-10, list.one-line: a search result is one line, its name first and where it lives at its end', () => {
  assert.equal(last('.rl-search-res .menu-item', 'display'), 'grid');
  assert.equal(last('.rl-search-res .menu-item > .mi-l', 'grid-row'), '1');
  assert.equal(last('.rl-search-res .menu-item > .mi-l', 'grid-column'), '2');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'grid-row'), '1');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'grid-column'), '3');
});

test('F-W3a1-10: the name keeps its room, and a long where folds inside the popover instead of running past it', () => {
  assert.match(last('.rl-search-res .menu-item', 'grid-template-columns'), /^auto minmax\(40%,\s*1fr\) minmax\(0,\s*auto\)$/, 'the name holds at least 40% of the row');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'white-space'), 'nowrap');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'min-width'), '0');
  assert.equal(last('.rl-search-res .menu-item > .mi-hint', 'text-overflow'), 'ellipsis');
});
