// look.state-contrast (docs/rail/look.md): every state a mark, a ring or a step shows holds 3:1 or more against the page
// and the surface, in light and in dark, so no theme lets a state fade. Reads the Rail look's own table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../plans/rail/prototype/design-system/rail-look.css', import.meta.url), 'utf8');
const pair = (name) => {
  const m = new RegExp(`--${name}:light-dark\\((#[0-9A-Fa-f]{6}),\\s*(#[0-9A-Fa-f]{6})\\)`).exec(css);
  assert.ok(m, `--${name} is a light-dark pair in the Rail look`);
  return { light: m[1], dark: m[2] };
};
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const STATES = ['ink-2', 'amber', 'red', 'green', 'violet', 'slate'];   // running is ink; the rest are colours
const GROUNDS = ['bg', 'surface'];

test('every state holds 3:1 or more on the page and the surface, in both themes', () => {
  for (const s of STATES) for (const g of GROUNDS) for (const theme of ['light', 'dark']) {
    const r = ratio(pair(s)[theme], pair(g)[theme]);
    assert.ok(r >= 3, `--${s} on --${g} in ${theme}: ${r.toFixed(2)}:1, under 3:1`);
  }
});
