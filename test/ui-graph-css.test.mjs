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

test('the frosted card is borderless (BORDER 0): every run-status cue rides the 1.5px box-shadow ring, never the border', () => {
  const rules = (css.match(/[^{}]*\.node\.is-(?:active|paused|stopped|error|skipped)\b[^{}]*\{[^}]*\}/g) || [])
    .map((r) => ({ sel: r.slice(0, r.indexOf('{')).trim(), body: r.slice(r.indexOf('{') + 1) }))
    .filter((r) => !r.sel.includes('::'));               // the corner badges (::after) are not the card
  assert.ok(rules.length >= 10, `${rules.length} status rules`);
  for (const r of rules) {
    assert.doesNotMatch(r.body, /border-(?:color|style)/, `${r.sel} paints on the 0-width border`);
    const shadow = (r.body.match(/box-shadow:([^;}]+)/) || [])[1];
    if (shadow && shadow.trim() !== 'none') assert.match(shadow, /^0 0 0 1\.5px /, `${r.sel} drops the status ring`);
  }
});

test('a moving canvas (.gv-moving) renders its cards without backdrop-filter', () => {
  const m = css.match(/\.gv-stage\.gv-moving \.gv-world \.node\{([^}]*)\}/);
  assert.ok(m, 'the .gv-moving card rule exists');
  assert.match(m[1], /(?:^|;)\s*backdrop-filter:none/);
  assert.match(m[1], /-webkit-backdrop-filter:none/);
});

test('a static run-status ring outranks the card\'s hover / focus ring on a run graph (review m1): scoped like is-error', () => {
  // `.gv-world .node:hover` / `:focus-visible` are (0,3,0) and come later than `.run-flow .node.is-*` (0,3,0): on a
  // monitor host (cards take pointer events) hovering a stopped card replaced its red ring.
  const ring = (sel) => new RegExp(`(?:^|[,}\\s])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,{]`);
  for (const sel of ['.run-flow.gv-host .gv-world .node.is-stopped', '.run-flow.gv-host .gv-world .node.is-error']) {
    assert.match(css, ring(sel), sel);
  }
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\{\n  \.run-flow \.node\.is-active[\s\S]*?\n\}/);
  assert.ok(reduced, 'the run-flow reduced-motion block');
  for (const sel of ['.run-flow.gv-host .gv-world .node.is-active', '.run-flow.gv-host .gv-world .node.is-paused']) {
    assert.match(reduced[0], ring(sel), `${sel} under reduced motion`);
  }
});
