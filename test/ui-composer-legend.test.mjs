// test/ui-composer-legend.test.mjs — Pipeline Composer legend swatches are
// rendered as solid colored circles (not dashed line segments). The sequential
// swatch must match the canvas edge color (COMPOSER_SEQ in app.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../ui/public/style.css'), 'utf8');
const appJs = readFileSync(join(here, '../ui/public/app.js'), 'utf8');
const html = readFileSync(join(here, '../ui/public/index.html'), 'utf8');

const ruleBody = (selector) => {
  // Match `selector{...}` allowing whitespace and multi-line bodies. Selector is
  // matched literally; assume callers don't pass regex metachars.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? m[1] : null;
};

const tokenValue = (name) => {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().toLowerCase() : null;
};

test('--seq token exposes the canvas sequential edge color', () => {
  const seq = tokenValue('seq');
  assert.ok(seq, '--seq token missing in :root');
  assert.equal(seq, '#b7b7bc', '--seq must equal COMPOSER_SEQ from app.js');
  // Sanity: the JS-side constant the token mirrors still exists.
  assert.match(appJs, /COMPOSER_SEQ\s*=\s*'#B7B7BC'/);
});

test('.legend .ll is a filled circle, not a dashed line', () => {
  const body = ruleBody('.legend .ll');
  assert.ok(body, '.legend .ll rule missing');
  assert.match(body, /border-radius\s*:\s*50%/, 'swatch must be a circle');
  assert.match(body, /width\s*:\s*12px/, 'circle width');
  assert.match(body, /height\s*:\s*12px/, 'circle height');
  assert.match(body, /background\s*:\s*var\(--seq\)/, 'default swatch uses --seq');
  assert.match(body, /flex\s*:\s*none/, 'flex:none prevents flex parent from squashing the circle');
  assert.doesNotMatch(body, /border-top/, 'no leftover dashed line border');
  assert.doesNotMatch(body, /dashed/, 'no leftover dashed style');
});

test('.legend .ll.fb overrides background to amber', () => {
  const body = ruleBody('.legend .ll.fb');
  assert.ok(body, '.legend .ll.fb rule missing');
  assert.match(body, /background\s*:\s*var\(--amber\)/);
  assert.doesNotMatch(body, /border-top/);
  assert.doesNotMatch(body, /dashed/);
});

test('--violet token exposes the canvas self-loop color', () => {
  const violet = tokenValue('violet');
  assert.ok(violet, '--violet token missing in :root');
  assert.equal(violet, '#8c7fd6', '--violet must equal COMPOSER_COLORS.violet from app.js');
  // Sanity: the JS-side constant the token mirrors still exists.
  assert.match(appJs, /COMPOSER_COLORS\s*=\s*\{[^}]*violet:\s*'#8C7FD6'/);
});

test('.legend .ll.sl overrides background to violet (self-loop swatch)', () => {
  const body = ruleBody('.legend .ll.sl');
  assert.ok(body, '.legend .ll.sl rule missing');
  assert.match(body, /background\s*:\s*var\(--violet\)/);
  assert.doesNotMatch(body, /border-top/);
  assert.doesNotMatch(body, /dashed/);
});

test('legend markup contains the three swatches in order', () => {
  const m = html.match(/<div class="legend">([\s\S]*?)<\/div>/);
  assert.ok(m, '.legend block missing in index.html');
  const block = m[1];
  assert.match(block, /<span class="ll"><\/span>\s*sequential/);
  assert.match(block, /<span class="ll fb"><\/span>\s*feedback loop/);
  assert.match(block, /<span class="ll sl"><\/span>\s*self loop/);
  const iSeq = block.indexOf('class="ll"');
  const iFb  = block.indexOf('class="ll fb"');
  const iSl  = block.indexOf('class="ll sl"');
  assert.ok(iSeq < iFb && iFb < iSl, 'legend swatches must appear in seq → fb → sl order');
});
