// The frame parts (ui/public/design-system/components/shell-frame.mjs): landmarks, aria, ids and classes the stylesheets
// address; each has a catalog entry, a rule line and a gallery example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as C from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document;
const PARTS = ['brandRow', 'navSection', 'barGrip', 'sidebarFrame', 'sideToggle', 'menuButton', 'topBarFrame', 'askButton'];

test('brandRow: the wordmark and the mark open Chat; Close menu is optional', () => {
  const d = dom(C.brandRow());
  assert.equal(d.querySelectorAll('a[href="#chat/new"]').length, 2);
  assert.equal(d.querySelector('#side-close').getAttribute('aria-label'), 'Close menu');
  assert.equal(dom(C.brandRow({ close: false })).querySelector('#side-close'), null);
});

test('sideToggle and menuButton carry aria-expanded and aria-controls for the bar', () => {
  const on = dom(C.sideToggle()).querySelector('#side-toggle'), off = dom(C.sideToggle({ expanded: false })).querySelector('#side-toggle');
  assert.equal(on.getAttribute('aria-expanded'), 'true'); assert.equal(on.title, 'Collapse menu');
  assert.equal(off.getAttribute('aria-expanded'), 'false'); assert.equal(off.getAttribute('aria-label'), 'Expand menu');
  const m = dom(C.menuButton({ expanded: true })).querySelector('#mbar-menu');
  assert.equal(m.getAttribute('aria-controls'), 'side-rail'); assert.equal(m.getAttribute('aria-expanded'), 'true');
});

test('barGrip is a vertical separator with its limits; navSection escapes its label', () => {
  const g = dom(C.barGrip({ min: 200, max: 300 })).querySelector('.bar-grip');
  assert.equal(g.getAttribute('role'), 'separator'); assert.equal(g.getAttribute('aria-valuemin'), '200'); assert.equal(g.getAttribute('aria-valuemax'), '300');
  assert.equal(dom(C.navSection({ label: '<b>x</b>' })).querySelector('b'), null);
});

test('sidebarFrame places each slot once, in order; topBarFrame holds its regions and the one h1', () => {
  const d = dom(C.sidebarFrame({ brand: C.brandRow(), nav: C.navSection({ label: 'Work' }), above: '<div id="A"></div>', lists: '<div id="L"></div>', foot: '<i id="F"></i>', extras: '<div id="X"></div>', grip: C.barGrip() }));
  for (const id of ['A', 'L', 'F', 'X']) assert.equal(d.querySelectorAll('#' + id).length, 1);
  assert.equal(d.querySelector('nav.nav').getAttribute('aria-label'), 'Primary');
  assert.ok(d.querySelector('#side-scroll nav.nav') && d.querySelector('#side-scroll #L') && d.querySelector('#side-scroll #A'), 'nav and its lists sit in the one scrolling band');
  assert.equal(d.querySelector('#side-foot #F') !== null, true);
  const t = dom(C.topBarFrame({ title: 'Tasks', left: 'L', centre: 'C', right: 'R' }));
  assert.equal(t.querySelector('header.topnav h1#topnav-title').textContent, 'Tasks');
  assert.deepEqual(['.topnav-l', '.topnav-c', '.topnav-r'].map((s) => t.querySelector(s).textContent.replace('Tasks', '')), ['L', 'C', 'R']);
});

test('every frame part has a catalog entry, a rule line and a gallery example', () => {
  const cat = JSON.parse(read('docs/design-system-catalog.json')).components;
  const gallery = read('plans/rail/prototype/components.html'), rules = read('docs/rail/navigation.md') + read('docs/rail/narrow.md');
  assert.match(rules, /nav\.frame/); assert.match(rules, /narrow\.frame-toggles/);
  for (const fn of PARTS) {
    const e = cat.find((c) => c.code === `ui/public/design-system/components/shell-frame.mjs#${fn}`);
    assert.ok(e, `${fn}: catalog entry`);
    assert.equal(typeof C[fn], 'function', `${fn}: exported from index.mjs`);
    assert.ok(gallery.includes(`${e.name}: [`), `${fn}: gallery example ${e.name}`);
  }
});
