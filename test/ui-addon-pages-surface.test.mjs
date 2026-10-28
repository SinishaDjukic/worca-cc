// Marketplace and Providers: each list is ONE card holding divided rows (docs/design-system.md › Cards versus divided
// rows), the .card primitive with no values of its own; the rows keep their divider and are never boxes. The Models
// page Engines card is a page card, not a flat Settings card, so no view-scoped override is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderAllInstalled, renderLeftover } from '../ui/public/marketplace/installed-view.mjs';
import { renderProvidersCard } from '../ui/public/bridge-view.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bare = read('ui/public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('Marketplace lists are one .card each, holding divided rows that are not boxes', () => {
  const lists = [
    renderAllInstalled(doc, [{ name: 'alpha', version: '1.0.0', enabled: true }, { name: 'beta', version: '2.0.0', enabled: true }]),
    renderLeftover(doc, [{ name: 'ghost', dataDir: '/tmp/ghost' }]),
  ].map((sec) => sec.querySelector(':scope > ul.mk-rows'));
  for (const list of lists) {
    assert.ok(list.classList.contains('card'), list.className);
    const rows = [...list.children].filter((r) => r.classList.contains('mk-row'));
    assert.ok(rows.length > 0, list.className);
    for (const row of rows) assert.equal(row.classList.contains('card'), false, row.className);
  }
});

test('Providers page: the split list is one .card of divided rows; the Models-view card keeps its head', () => {
  const split = renderProvidersCard({}, { doc, split: true });
  assert.ok(split.classList.contains('card') && split.classList.contains('drows') && split.classList.contains('mv-providers-split'));
  const rows = split.querySelectorAll(':scope > .mv-pv-card');
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(r.classList.contains('drow') && !r.classList.contains('card'), r.className);
  assert.ok(renderProvidersCard({}, { doc }).classList.contains('card'));
});

test('no rule boxes a list row or restyles a list card: the .card and .drow primitives carry the look', () => {
  const listSel = /\.(mk-rows|mk-row|mv-providers-split|mv-pv-card)(?![\w-])/;
  const boxy = /(^|;)\s*(background|border|border-radius|box-shadow)\s*:/;
  const bad = rules.filter((r) => listSel.test(r.sel) && !/\s/.test(r.sel.replace(/,\s*/g, ',')) && boxy.test(r.body)).map((r) => r.sel);
  assert.deepEqual(bad, []);
  assert.equal(rules.some((r) => r.sel.includes('[data-view="models"]') && r.sel.includes('settings-card')), false, 'no view-scoped Settings card override');
  assert.ok(rules.some((r) => r.sel === '.card.drows:empty' && /display:none/.test(r.body)), 'an empty list draws no card');
});

test('the Models Engines card is a page card, full width, not a flat Settings card', () => {
  const page = new JSDOM(read('ui/public/index.html')).window.document;
  const card = page.getElementById('engine-settings-card');
  assert.ok(card.closest('[data-view="models"]'));
  assert.ok(card.classList.contains('card'));
  assert.equal(card.classList.contains('settings-card'), false, '.settings-card is the 760px Settings-pane card');
});

test('the built-in model strips use the card tokens, no colour literal', () => {
  for (const sel of ['.mv-builtin', '.mv-hide-builtin-row']) {
    const body = rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
    assert.match(body, /border:1px solid var\(--line\)/, sel);
    assert.match(body, /background:var\(--panel\)/, sel);
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bwhite\b|\bblack\b/i, sel);
  }
});
