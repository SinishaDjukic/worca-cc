// test/ui-settings-icon.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');

// Grab the SIDEBAR Settings nav link's <svg> specifically. The sidebar link is
// `data-nav="settings">` immediately followed (after whitespace) by an <svg>; the
// topnav link is `data-nav="settings">Settings` (text, no svg). String#match (no /g)
// returns the FIRST match in document order — the sidebar link comes first AND is the
// only one followed by <svg>, so this matches only the icon-bearing sidebar link.
function settingsNavSvg() {
  const m = html.match(/data-nav="settings">\s*<svg[\s\S]*?<\/svg>/);
  assert.ok(m, 'sidebar Settings nav link with an <svg> not found');
  return m[0];
}

// Pull the <path d="..."> data out of an <svg> string.
function pathData(svg) {
  const m = svg.match(/<path[^>]*\bd="([^"]+)"/);
  assert.ok(m, 'Settings icon <path d="..."> not found');
  return m[1];
}

test('Settings nav icon is a gear, not a sun', () => {
  const svg = settingsNavSvg();
  const d = pathData(svg);

  // (1) the sun is gone: its radial-spoke signature must not appear.
  assert.ok(!svg.includes('M12 2.5v3'), 'sun radial spokes are still present');

  // (2) the gear hub is kept (consistency guard for the icon family).
  assert.ok(/<circle cx="12" cy="12" r="3"/.test(svg), 'gear hub circle missing');

  // (3) the gear teeth are drawn with elliptical-arc commands. The sun path used
  //     only M/v/h/l (no arc), so any a/A in the path data proves a gear ring and
  //     rules out a bare circle. Robust to coordinate/whitespace changes.
  assert.ok(/[aA]/.test(d), 'gear teeth (elliptical-arc path commands) missing');

  // (4) icon stays in the shared sizing/coloring envelope used by `.nav button svg`.
  assert.ok(svg.includes('viewBox="0 0 24 24"'), 'icon must keep the 24x24 viewBox');
  assert.ok(svg.includes('stroke="currentColor"'), 'icon must inherit color via currentColor');
});

test('topnav Settings link stays text-only (icon not duplicated there)', () => {
  // The compact topnav Settings link is text-only by design; guard against
  // accidentally adding an <svg> to it during the swap.
  assert.ok(/data-nav="settings">Settings<\/button>/.test(html),
    'topnav text-only Settings button should remain unchanged');
});
