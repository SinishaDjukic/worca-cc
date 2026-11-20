// Marketplace and Providers: each list is ONE card holding divided rows (docs/design-system.md › Cards versus divided
// rows), the .card primitive with no values of its own; the rows keep their divider and are never boxes. The Models
// page's Jobs tab draws page cards, not flat Settings cards, so no view-scoped override is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderAllInstalled, renderLeftover } from '../ui/public/marketplace/installed-view.mjs';
import { renderProvidersTab } from '../ui/public/models/providers-tab.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bare = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
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

test('Providers tab: two .card lists of divided rows, seven rows in all', () => {
  const tab = renderProvidersTab({}, { doc });
  const cards = [...tab.querySelectorAll('.mv-providers-split')];
  assert.equal(cards.length, 2);
  for (const c of cards) assert.ok(c.classList.contains('card') && c.classList.contains('drows'), c.className);
  const rows = cards.flatMap((c) => [...c.querySelectorAll(':scope > .mv-pv-card')]);
  assert.equal(rows.length, 7);
  for (const r of rows) assert.ok(r.classList.contains('drow') && r.classList.contains('drow-stack') && !r.classList.contains('card'), r.className);
});

test('no rule boxes a list row or restyles a list card: the .card and .drow primitives carry the look', () => {
  const listSel = /\.(mk-rows|mk-row|mv-providers-split|mv-pv-card)(?![\w-])/;
  const boxy = /(^|;)\s*(background|border|border-radius|box-shadow)\s*:/;
  const bad = rules.filter((r) => listSel.test(r.sel) && !/\s/.test(r.sel.replace(/,\s*/g, ',')) && boxy.test(r.body)).map((r) => r.sel);
  assert.deepEqual(bad, []);
  assert.equal(rules.some((r) => r.sel.includes('[data-view="models"]') && r.sel.includes('settings-card')), false, 'no view-scoped Settings card override');
  assert.ok(rules.some((r) => r.sel === '.card.drows:empty' && /display:none/.test(r.body)), 'an empty list draws no card');
});

test('the Models Jobs tab draws page cards, full width, not flat Settings cards', () => {
  const page = new JSDOM(readIndexHtml()).window.document;
  assert.ok(page.getElementById('jobs-root').closest('[data-view="models"] #models-tab-jobs'), 'the tab draws into #jobs-root');
  assert.equal(page.getElementById('engine-settings-card'), null, 'the old Engines card is gone');
  // jobs-view.mjs builds each job card: a page .card, never .settings-card (the 760px Settings-pane card).
  const view = read('ui/public/models/jobs-view.mjs');
  assert.match(view, /make\(doc, 'section', 'card drows mdl-job-card'\)/);
  assert.doesNotMatch(view, /settings-card/);
});
