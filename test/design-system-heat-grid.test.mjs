// HeatGrid (docs/rail/look.md › look.heat-grid, slice 10 D14): people by values in ink shades, a focusable cell per value,
// and a table that says the same to a screen reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as C from '../ui/public/design-system/components/index.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;
const people = ['Maya', 'Jonas', 'Priya', 'Sam', 'Lee'], cols = ['billing-api', 'web-app', 'worca-cc'];
const values = [[186, 120, 0], [90, 60, 30], [40, 20, 10], [12, 6, 3], [5, 2, 1]];
const grid = () => C.heatGrid({ label: 'Who spends where by project, this month', rows: people.map((label) => ({ label })), columns: cols.map((label) => ({ label })), max: 186, off: "The whole team's numbers: Tasks lists your own",
  cells: values.map((row) => row.map((v) => ({ value: v, text: v ? `$${v}, ${v === 186 ? 21 : 2} tasks` : '' }))) });

test('heatGrid: 5 rows by 3 columns of focusable cells; each cell\'s shade rises with its value', () => {
  const g = dom(grid());
  assert.ok(g.classList.contains('heat-grid'));
  const cells = [...g.querySelectorAll('.hg-cell')];
  assert.equal(cells.length, 15);
  assert.ok(cells.every((c) => c.getAttribute('tabindex') === '0'));
  assert.equal(g.querySelectorAll('.hg-row:not(.is-head)').length, 5);
  const shade = (c) => +/is-h(\d)/.exec(c.className)[1];
  const flat = values.flat();
  for (let i = 0; i < flat.length; i++) for (let j = 0; j < flat.length; j++) if (flat[i] > flat[j]) assert.ok(shade(cells[i]) >= shade(cells[j]), `${flat[i]} is at least as dark as ${flat[j]}`);
  assert.equal(shade(cells[0]), 4); assert.equal(shade(cells[2]), 0);
  assert.ok(shade(cells[0]) > shade(cells[14]));
});

test('heatGrid: a cell reads "Maya, billing-api: $186, 21 tasks"; an empty cell reads "none"; the cells open nothing', () => {
  const g = dom(grid()), cells = g.querySelectorAll('.hg-cell');
  assert.equal(cells[0].getAttribute('aria-label'), 'Maya, billing-api: $186, 21 tasks');
  assert.equal(cells[2].getAttribute('aria-label'), 'Maya, worca-cc: none');
  assert.equal(cells[0].getAttribute('title'), "Maya, billing-api: $186, 21 tasks · The whole team's numbers: Tasks lists your own");
  assert.equal(g.querySelectorAll('button, a').length, 0);
});

test('heatGrid: a screen-reader table carries the same 15 values, and no hue class anywhere', () => {
  const g = dom(grid()), t = g.querySelector('table.bc-table');
  assert.ok(t);
  assert.deepEqual([...t.querySelectorAll('thead th')].map((th) => th.textContent).slice(1), cols);
  const tds = [...t.querySelectorAll('tbody td')].map((td) => td.textContent);
  assert.equal(tds.length, 15);
  assert.equal(tds[0], '$186, 21 tasks'); assert.equal(tds[2], 'none');
  assert.doesNotMatch(grid(), /is-(red|green|amber|blue|warn|ok|bad)\b|style="[^"]*(color|background)/);
});
