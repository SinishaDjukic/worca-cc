// test/ui-runs-view-menu.test.mjs — the Runs header's View menu (ui/public/runs-view-menu.mjs, #740):
// one search field and one View button, no status bar, and the menu's keyboard. The real
// index.html markup is loaded without app.js; the module is mounted on it directly.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { mountRunsViewMenu } from '../ui/public/runs-view-menu.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'index.html'), 'utf8');

function setup({ level = 'advanced' } = {}) {
  const { window } = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const doc = window.document;
  doc.documentElement.dataset.level = level;
  const button = doc.getElementById('runs-view-btn');
  const menu = doc.getElementById('runs-view-menu');
  const picks = [];
  const api = mountRunsViewMenu({ button, menu, onPick: (p) => picks.push(p) });
  const key = (node, k) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const item = (sel) => menu.querySelector(sel);
  return { window, doc, button, menu, api, picks, key, click, item };
}

test('the Runs header renders exactly one search field and one View button, and no status filter bar', () => {
  const { doc } = setup();
  const head = doc.querySelector('#runs-list-pane .runs-head');
  const searches = head.querySelectorAll('input[type="search"]');
  assert.equal(searches.length, 1);
  assert.equal(searches[0].id, 'runs-search');
  assert.equal(searches[0].placeholder, 'Search runs or tags (client:acme)');
  const menuButtons = head.querySelectorAll('button[aria-haspopup="menu"]');
  assert.equal(menuButtons.length, 1);
  assert.equal(menuButtons[0].textContent.trim(), 'View');
  assert.equal(head.querySelectorAll('button:not([role="menuitemradio"])').length, 1, 'View is the only header button');
  for (const id of ['runs-filter', 'runs-archived-btn', 'runs-group-btn', 'runs-search-btn', 'runs-search-row']) {
    assert.equal(doc.getElementById(id), null, `#${id} is gone`);
  }
  assert.equal(doc.querySelector('#runs-list-pane .seg'), null, 'no segmented status bar');
  assert.equal(doc.getElementById('runs-view-chip-row').hidden, true, 'no chip until the view is non-default');
});

test('the menu groups Show (Active, Finished, Archived) and Group by (Project, Date)', () => {
  const { menu } = setup();
  const groups = [...menu.querySelectorAll('[role="group"]')];
  assert.deepEqual(groups.map((g) => g.querySelector('.runs-view-label').textContent), ['Show', 'Group by']);
  assert.deepEqual([...groups[0].querySelectorAll('[role="menuitemradio"]')].map((b) => b.dataset.show), ['active', 'finished', 'archived']);
  assert.deepEqual([...groups[1].querySelectorAll('[role="menuitemradio"]')].map((b) => b.dataset.groupBy), ['project', 'date']);
});

test('opening focuses the checked item; ArrowDown and ArrowUp move focus between items and wrap', () => {
  const { doc, button, menu, key, click, item } = setup();
  assert.equal(menu.hidden, true);
  click(button);
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement, item('[data-show="active"]'));
  key(menu, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-show="finished"]'));
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-show="archived"]'));
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-group-by="project"]'), 'arrows cross from Show into Group by');
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-show="active"]'), 'ArrowDown wraps to the top');
  key(doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, item('[data-group-by="date"]'), 'ArrowUp wraps to the bottom');
  key(doc.activeElement, 'Home');
  assert.equal(doc.activeElement, item('[data-show="active"]'));
  key(doc.activeElement, 'End');
  assert.equal(doc.activeElement, item('[data-group-by="date"]'));
});

test('Escape closes the menu and returns focus to View', () => {
  const { doc, button, menu, key, click } = setup();
  click(button);
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'Escape');
  assert.equal(menu.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, button);
});

test('ArrowDown on View opens the menu; a second click on View closes it', () => {
  const { doc, button, menu, key, click, item } = setup();
  button.focus();
  key(button, 'ArrowDown');
  assert.equal(menu.hidden, false);
  assert.equal(doc.activeElement, item('[data-show="active"]'));
  click(button);
  assert.equal(menu.hidden, true);
});

test('a pick reports one choice, closes the menu and refocuses View; paint moves the check', () => {
  const { doc, button, menu, api, picks, click, item } = setup();
  click(button);
  click(item('[data-group-by="date"]'));
  assert.deepEqual(picks, [{ groupBy: 'date' }]);
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, button);
  click(button);
  click(item('[data-show="archived"]'));
  assert.deepEqual(picks[1], { show: 'archived' });
  api.paint({ show: 'finished', groupBy: 'date' });
  assert.deepEqual([...menu.querySelectorAll('[aria-checked="true"]')].map((b) => b.dataset.show || b.dataset.groupBy), ['finished', 'date']);
});

test('a click outside closes the menu; a click inside the menu chrome does not', () => {
  const { doc, button, menu, click } = setup();
  click(button);
  click(menu.querySelector('.runs-view-label'));
  assert.equal(menu.hidden, false, 'a heading click keeps it open');
  click(doc.body);
  assert.equal(menu.hidden, true);
});

test('below Advanced the arrows skip Show › Archived, unless it is kept visible as the pick', () => {
  const { doc, menu, button, key, click, item } = setup({ level: 'simple' });
  click(button);
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-group-by="project"]'), 'Finished → Project: Archived is hidden');
  key(doc.activeElement, 'Escape');
  item('[data-show="archived"]').dataset.levelKeep = '1';
  click(button);
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, item('[data-show="archived"]'), 'a kept Archived item is reachable');
  assert.equal(menu.hidden, false);
});
