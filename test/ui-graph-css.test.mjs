// test/ui-graph-css.test.mjs — the CSS geometry contract: style.css may express
// canvas geometry ONLY through the --gv-* variables injectGeometry writes, so
// the box model can never drift from nodeSize/portAnchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { injectGeometry, GEOMETRY_CSS_VARS } from '../src/shared/graph/geometry.mjs';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

// The v2 CANVAS block only — bounded ABOVE by the composer-shell block Task 9
// appends after it. Slicing to end-of-file (the first draft did) drags the shell
// and dialog CSS in, and `.gv-drag-ghost{border:1.5px …}` then trips the
// "no hard-coded geometry number" assertion for a decorative border.
function v2Block() {
  const from = css.indexOf('/* v2 node-graph canvas');
  const to = css.indexOf('/* v2 composer shell', from + 1);
  return css.slice(from, to === -1 ? css.length : to);
}

test('every --gv-* variable style.css uses is one injectGeometry writes, and vice versa', () => {
  const dom = new JSDOM('<!doctype html><body><div id="s"></div></body>');
  const el = dom.window.document.getElementById('s');
  injectGeometry(el);
  const written = new Set((el.getAttribute('style') || '').match(/--gv-[a-z0-9-]+/g) || []);
  const used = new Set(css.match(/--gv-[a-z0-9-]+/g) || []);
  assert.ok(written.size >= 10, `injectGeometry wrote ${written.size} vars`);
  assert.deepEqual([...used].sort(), [...written].sort(), 'style.css --gv-* set === injectGeometry set');
  assert.equal(Object.keys(GEOMETRY_CSS_VARS).length, written.size);
});

test('the v2 canvas block hard-codes no geometry number', () => {
  const block = v2Block();
  assert.ok(block.length > 400, 'the v2 canvas block exists in style.css');
  // Geometry constants only — decorative px (font sizes, radii, the dot grid) are fine.
  // The lookbehind keeps `font-size:11.5px` from reading as the BORDER constant
  // `1.5px`: the ban is on a geometry number STANDING ALONE, not on any suffix.
  for (const bad of ['220px', '34px', '8.5px', '1.5px', '26px', '191.5px', '110.5px']) {
    const re = new RegExp(`(?<![\\d.])${bad.replace('.', '\\.')}`);
    assert.ok(!re.test(block), `v2 canvas CSS must not hard-code ${bad} — use var(--gv-*)`);
  }
});

test('.gv-wires path carries fill:none on the ELEMENT selector (ghost blob is impossible)', () => {
  const rule = css.match(/\.gv-wires\s+path\s*\{[^}]*\}/);
  assert.ok(rule, '.gv-wires path rule exists');
  assert.ok(/fill\s*:\s*none/.test(rule[0]), 'fill:none is on the layer element selector, not on .wire');
});

test('v2 cards neutralise the unscoped v1 .node rule', () => {
  const block = v2Block();
  const card = block.match(/\.gv-world\s+\.node\s*\{[^}]*\}/);
  assert.ok(card, '.gv-world .node rule exists');
  for (const prop of ['position:absolute', 'display:block', 'padding:0', 'gap:0', 'width:var(--gv-node-w)']) {
    assert.ok(card[0].replace(/\s+/g, '').includes(prop), `resets ${prop}`);
  }
  assert.ok(/\.gv-world\s+\.node::before\s*\{[^}]*content\s*:\s*none/.test(block), 'kills the v1 colour bar');
});
