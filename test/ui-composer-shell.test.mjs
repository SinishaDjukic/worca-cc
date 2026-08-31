// test/ui-composer-shell.test.mjs — the composer view's markup contract (D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const doc = new JSDOM(html).window.document;
const view = doc.querySelector('section.view[data-view="composer"]');

test('the composer view carries the D3 layout in order', () => {
  assert.ok(view, 'composer view exists');
  // NOT `:scope >` and NOT className.split(' ')[0]: .gv-head/.gv-canvas/.gv-foot
  // live one level down inside the canvas <section class="card">, and .gv-saved
  // carries `card` FIRST in its class list. Both mistakes make this assertion
  // unsatisfiable by the markup this very task ships. Match the gv- token in
  // document order instead.
  const order = [...view.querySelectorAll('.gv-head, .gv-canvas, .gv-foot, .gv-saved')]
    .map((el) => [...el.classList].find((c) => c.startsWith('gv-')));
  assert.deepEqual(order, ['gv-head', 'gv-canvas', 'gv-foot', 'gv-saved']);
  assert.equal(view.querySelector('.gv-agents'), null, 'the agents card below the canvas is gone');
});

test('the rail owns both panes: an Agents/Info tablist, the filter, the palette and the inspector', () => {
  const rail = view.querySelector('#gv-ins-rail');
  assert.equal(rail.dataset.tab, 'agents', 'the markup ships the default tab');
  const bar = rail.querySelector(':scope > .gv-ins-bar');
  assert.ok(bar.contains(doc.getElementById('gv-ins-toggle')), 'the toggle shares the tab row');
  const tabs = [...bar.querySelectorAll('#gv-ins-tabs [data-tab]')].map((b) => b.dataset.tab);
  assert.deepEqual(tabs, ['agents', 'info']);
  for (const id of ['gv-agent-filter', 'gv-palette', 'gv-ins-body']) {
    assert.ok(rail.contains(doc.getElementById(id)), `#${id} moved into the rail`);
  }
  assert.ok(doc.getElementById('gv-agents-pane').contains(doc.getElementById('gv-palette')));
});

test('the wire legend is the editor card footer, spanning canvas and rail', () => {
  const foot = view.querySelector('.gv-editor > .gv-foot');
  assert.ok(foot, '.gv-foot is a direct child of the editor card, after the canvas');
  assert.equal(foot.previousElementSibling.id, 'gv-canvas');
  assert.ok(foot.contains(doc.getElementById('gv-legend')));
});

test('chip and inspector rail are SIBLINGS of the stage inside the canvas host', () => {
  const canvas = view.querySelector('#gv-canvas');
  assert.equal(canvas.querySelector(':scope > #gv-chip').tagName, 'DIV');
  assert.equal(canvas.querySelector(':scope > #gv-ins-rail').tagName, 'DIV');
  assert.equal(canvas.querySelector('.gv-stage'), null, 'the stage is created by createGraphView, not shipped in HTML');
  for (const id of ['gv-save', 'gv-autolayout', 'gv-new']) {
    assert.ok(!canvas.contains(doc.getElementById(id)), `#${id} must live in the header bar, never inside the canvas`);
  }
});

test('every id the editor binds exists exactly once', () => {
  for (const id of ['gv-head', 'gv-name', 'gv-new', 'gv-autolayout', 'gv-save', 'gv-errors',
    'gv-canvas', 'gv-chip', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-ins-tabs', 'gv-agents-pane',
    'gv-agent-filter', 'gv-palette', 'gv-legend', 'gv-saved-list', 'gv-saved-count', 'gv-archived',
    'gv-dialog-host']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} appears exactly once`);
  }
  assert.equal(doc.getElementById('gv-legend').textContent.trim(),
    'grey = data · amber = loop · ◆ = conditional · ○ = gate · ⤫N = fan-out');
});

test('the v1 composer markup is gone', () => {
  for (const id of ['composer-flow', 'composer-wires', 'composer-palette', 'composer-saved-list']) {
    assert.ok(!html.includes(`id="${id}"`), `v1 #${id} removed`);
  }
});
