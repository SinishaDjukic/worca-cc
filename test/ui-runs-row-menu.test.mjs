// test/ui-runs-row-menu.test.mjs — the Runs list's row ⋯ menu (ui/public/runs-row-menu.mjs, #739),
// mounted on the real index.html with rows rendered by runs-list.mjs, without app.js.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { mountRunsRowMenu } from '../ui/public/runs-row-menu.mjs';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';
import { rowMenuItems } from '../ui/public/runs-archive.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'index.html'), 'utf8');
const NOW = Date.parse('2026-10-17T12:00:00Z');

function setup() {
  const { window } = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const doc = window.document;
  const host = doc.getElementById('runs-list');
  const menu = doc.getElementById('runs-row-menu');
  const model = buildRunsModel({
    live: [{ runId: 'r1', pipelineId: 'p1', title: 'Live', status: 'running', startedAt: NOW }],
    history: [
      { id: 'h1', projectKey: 'k', title: 'Done', status: 'done', startedAt: NOW - 1000, mtime: NOW - 1000 },
      { id: 'h2', projectKey: 'k', title: 'Kept', status: 'done', startedAt: NOW - 2000, mtime: NOW - 2000, retained: true },
    ],
    now: NOW,
  });
  host.append(...renderRunsList(doc, model));
  const rows = new Map(model.sections.flatMap((s) => s.groups.flatMap((g) => g.rows)).map((r) => [r.key, r]));
  const picks = [];
  const api = mountRunsRowMenu({ host, menu, itemsFor: (k) => rowMenuItems(rows.get(k)), onPick: (a, k) => picks.push([a, k]) });
  const key = (node, k) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const more = (k) => host.querySelector(`.runs-item[data-row-key="${k}"] .runs-row-more`);
  return { window, doc, host, menu, api, picks, key, click, more };
}

test('⋯ opens the menu on the first item; arrows rove; Escape closes and refocuses ⋯', () => {
  const { doc, menu, key, click, more } = setup();
  click(more('hist:k/h1'));
  assert.equal(menu.hidden, false);
  assert.equal(more('hist:k/h1').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.dataset.action), ['archive', 'new-run', 'copy-id']);
  assert.equal(doc.activeElement.dataset.action, 'archive');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement.dataset.action, 'new-run');
  key(doc.activeElement, 'End');
  assert.equal(doc.activeElement.dataset.action, 'copy-id');
  key(doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement.dataset.action, 'archive', 'wraps');
  key(doc.activeElement, 'Escape');
  assert.equal(menu.hidden, true);
  assert.equal(doc.activeElement, more('hist:k/h1'));
  assert.equal(more('hist:k/h1').getAttribute('aria-expanded'), 'false');
});

test('a pick reports the action and the row key and closes the menu', () => {
  const { menu, picks, click, more } = setup();
  click(more('hist:k/h1'));
  click(menu.querySelector('[data-action="archive"]'));
  assert.deepEqual(picks, [['archive', 'hist:k/h1']]);
  assert.equal(menu.hidden, true);
});

test('a retained row: Archive is aria-disabled with its reason, and a click on it picks nothing', () => {
  const { menu, picks, click, more } = setup();
  click(more('hist:k/h2'));
  const arch = menu.querySelector('[data-action="archive"]');
  assert.equal(arch.getAttribute('aria-disabled'), 'true');
  assert.equal(arch.querySelector('.runs-row-menu-why').textContent, 'Recover or discard the retained work first');
  click(arch);
  assert.deepEqual(picks, []);
  assert.equal(menu.hidden, false);
});

test('right-click on a finished row opens its menu and cancels the browser menu; a live row is left alone', () => {
  const { window, host, menu } = setup();
  const ctx = (node) => node.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  assert.equal(ctx(host.querySelector('.runs-row[data-run-id="r1"]')), true, 'not cancelled: no menu for a live row');
  assert.equal(menu.hidden, true);
  assert.equal(ctx(host.querySelector('.runs-row[data-pipeline-id="h1"]')), false, 'cancelled');
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.top, '50px');
});

test('an outside click closes the menu; a second click on the same ⋯ closes it', () => {
  const { doc, menu, click, more } = setup();
  click(more('hist:k/h1'));
  click(doc.body);
  assert.equal(menu.hidden, true);
  click(more('hist:k/h1'));
  click(more('hist:k/h1'));
  assert.equal(menu.hidden, true);
});
