// test/ui-topnav.test.mjs — the top bar's page name (ui/public/topnav.mjs): one pure lookup that
// app.js paints into #topnav-title on every route. It names every routed page, agrees with the
// sidebar's own labels, and says "New run" / "Runs" where the sidebar has no row of that name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { pageTitle, PAGE_TITLES } from '../ui/public/topnav.mjs';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');

test('pageTitle: New run, the three Runs routes, and the pages the sidebar does not list', () => {
  assert.equal(pageTitle('new'), 'New run');
  for (const v of ['runs', 'running', 'history']) assert.equal(pageTitle(v), 'Runs', v);
  assert.equal(pageTitle('getting-started'), 'Getting started');
  assert.equal(pageTitle('workspace-create'), 'New workspace');
  assert.equal(pageTitle('workflows'), 'Workflows');
  assert.equal(pageTitle('settings'), 'Settings');
});

test('pageTitle: every sidebar page is named by its own sidebar label', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const rows = [...doc.querySelectorAll('.nav button[data-nav]:not([data-nav="new"])')];
  assert.ok(rows.length >= 12, `${rows.length} sidebar pages`);
  for (const b of rows) {
    const label = b.querySelector(':scope > span:not(.nav-count):not(.nav-rollup)').textContent.trim();
    assert.equal(pageTitle(b.dataset.nav), label, b.dataset.nav);
  }
});

test('pageTitle: every route app.js knows has a name; anything else is "Worca"', () => {
  const names = JSON.parse(read('app.js').match(/const VIEW_NAMES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.ok(names.length >= 18, `${names.length} routes`);
  for (const v of names) assert.notEqual(pageTitle(v), 'Worca', `${v} has no title`);
  for (const v of ['', 'bogus', 'constructor', '__proto__', 'toString', undefined]) assert.equal(pageTitle(v), 'Worca', String(v));
  assert.ok(Object.isFrozen(PAGE_TITLES));
});
