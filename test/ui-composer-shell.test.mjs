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
  // NOT `:scope >` and NOT className.split(' ')[0]: .gv-head/.gv-canvas live one
  // level down inside the canvas <section class="card">, and .gv-agents/.gv-saved
  // carry `card` FIRST in their class list. Both mistakes make this assertion
  // unsatisfiable by the markup this very task ships. Match the gv- token in
  // document order instead.
  const order = [...view.querySelectorAll('.gv-head, .gv-canvas, .gv-agents, .gv-saved')]
    .map((el) => [...el.classList].find((c) => c.startsWith('gv-')));
  assert.deepEqual(order, ['gv-head', 'gv-canvas', 'gv-agents', 'gv-saved']);
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
  for (const id of ['gv-head', 'gv-name', 'gv-new', 'gv-autolayout', 'gv-save', 'gv-dirty', 'gv-errors',
    'gv-canvas', 'gv-chip', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-agents', 'gv-agent-filter',
    'gv-palette', 'gv-legend', 'gv-saved-list', 'gv-saved-count', 'gv-archived', 'gv-dialog-host']) {
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
