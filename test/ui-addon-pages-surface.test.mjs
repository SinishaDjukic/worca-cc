// Marketplace, Providers and Models carry the same card surface as Connectors, from theme tokens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the LAST rule whose selector list contains `selector` (later rules win in the cascade). */
function lastRuleBody(selector) {
  let found = null;
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector)) found = m[2];
  }
  return found;
}
const noWs = (s) => s.replace(/\s+/g, '');

const ROW_SELECTORS = [
  '.pl-list > .drow', '.pl-available > .drow', '.pl-mkts > .drow', '.pl-orphans > .drow', '.mv-providers-split > .mv-pv-card',
];
const CONNECTORS = noWs(bare.match(/(?:^|\})\s*\.card\s*\{([^}]*)\}/)[1]); // the base .card rule, not a later override

test('Connectors card chrome is the reference (guard so the needles below mean something)', () => {
  assert.match(CONNECTORS, /background:var\(--panel\)/);
  assert.match(CONNECTORS, /border:1pxsolidvar\(--line\)/);
  assert.match(CONNECTORS, /border-radius:var\(--r-card\)/);
});

for (const sel of ROW_SELECTORS) {
  test(`${sel} has the Connectors surface from tokens`, () => {
    const body = noWs(lastRuleBody(sel) || '');
    assert.match(body, /background:var\(--panel\)/, 'panel background');
    assert.match(body, /border:1pxsolidvar\(--line\)/, 'hairline --line border on all four sides');
    assert.match(body, /border-radius:var\(--r-card\)/, 'card radius');
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bwhite\b|\bblack\b/i, 'no colour literal');
  });
}

test('Models Engines card is a card inside the Models view only', () => {
  const body = noWs(lastRuleBody('[data-view="models"] .card.settings-card') || '');
  assert.match(body, /background:var\(--panel\)/);
  assert.match(body, /border:1pxsolidvar\(--line\)/);
  assert.match(body, /border-radius:var\(--r-card\)/);
  assert.match(body, /max-width:none/, 'as wide as the .mv-card list');
  assert.match(noWs(lastRuleBody('.card.settings-card')), /background:none/, 'Settings cards stay flat');
});

test('the built-in strips use the card border token, not --line-2', () => {
  for (const sel of ['.mv-builtin', '.mv-hide-builtin-row']) {
    const body = noWs(lastRuleBody(sel));
    assert.match(body, /border-color:var\(--line\)/, sel);
    assert.match(body, /background:var\(--panel\)/, sel);
  }
});

test('the new rules come after the .drow base rule, so the surface wins on order', () => {
  assert.ok(bare.lastIndexOf('.pl-list > .drow') > bare.indexOf('.drow:last-child'));
});
