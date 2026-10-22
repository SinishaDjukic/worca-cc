// test/ui-cost-area-chart.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { smoothPath, stackBands, createAreaChart } from '../ui/public/cost-area-chart.mjs';

const SPEC = (vals) => ({
  buckets: [0, 86400000, 172800000], bucket: 'day', metric: 'spend',
  series: [{ key: 'v:acme', kind: 'value', label: 'acme', values: vals }, { key: 'none', kind: 'none', label: 'Unallocated', values: [1, 1, 1] }],
  unallocated: { ids: ['p4', 'p5'] },
});

test('smoothPath is monotone: control points never leave the band of their two points', () => {
  const d = smoothPath([[0, 100], [10, 20], [20, 20], [30, 90]]);
  const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
  assert.ok(Math.min(...ys) >= 20 && Math.max(...ys) <= 100, d);
});

test('stackBands: each band starts where the one below ends', () => {
  const b = stackBands([{ values: [1, 2] }, { values: [3, -1] }]);
  assert.deepEqual(b, [{ lo: [0, 0], hi: [1, 2] }, { lo: [1, 2], hi: [4, 2] }]);
});

test('Unallocated is hatched; its legend item offers Tag 2 runs; areas are kept across updates', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const tagged = [];
  const c = createAreaChart({ doc, onTagRuns: (ids) => tagged.push(ids) });
  c.update(SPEC([2, 3, 4]));
  const none = c.el.querySelector('.cr-area[data-key="none"]');
  assert.match(none.getAttribute('fill'), /^url\(#cr-hatch-\d+\)$/);
  assert.ok(c.el.querySelector(`pattern#${none.getAttribute('fill').slice(5, -1)}`));
  c.el.querySelector('.cr-tag-runs').click();
  assert.deepEqual(tagged, [['p4', 'p5']]);
  c.update(SPEC([5, 1, 2]));
  assert.equal(c.el.querySelector('.cr-area[data-key="none"]'), none, 'the same path element morphs');
  assert.equal(c.el.querySelectorAll('.ch-hit').length, 3);
});

test('motion: the first paint wipes in and an update animates d; reduced motion does neither', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const calls = [];
  doc.defaultView.SVGElement.prototype.animate = function (k) { calls.push(k); return {}; };
  const c = createAreaChart({ doc });
  c.update(SPEC([2, 3, 4]));
  assert.ok(c.el.querySelector('.cr-plot').classList.contains('is-wiping'));
  c.update(SPEC([5, 1, 2]));
  assert.ok(calls.length >= 1);
  calls.length = 0;
  const r = createAreaChart({ doc, reducedMotion: true });
  r.update(SPEC([2, 3, 4]));
  r.update(SPEC([5, 1, 2]));
  assert.equal(r.el.querySelector('.cr-plot').classList.contains('is-wiping'), false);
  assert.equal(calls.length, 0);
});

test('hover dims the other areas', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const c = createAreaChart({ doc });
  c.update(SPEC([2, 3, 4]));
  c.focus('v:acme');
  assert.ok(c.el.querySelector('.cr-area[data-key="none"]').classList.contains('is-dim'));
  c.focus(null);
  assert.equal(c.el.querySelectorAll('.cr-area.is-dim').length, 0);
});

test('hovering an area through the tooltip rects dims the other areas; above the stack nothing dims', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const c = createAreaChart({ doc });
  c.update(SPEC([2, 3, 4]));
  c.el.querySelector('svg').getBoundingClientRect = () => ({ left: 0, top: 0, width: 560, height: 260 });
  const hit = c.el.querySelectorAll('.ch-hit')[0];
  const move = (clientY) => hit.dispatchEvent(new doc.defaultView.MouseEvent('pointermove', { bubbles: true, clientY }));
  move(231);                                         // just above the baseline: inside acme's band
  assert.ok(c.el.querySelector('.cr-area[data-key="none"]').classList.contains('is-dim'));
  assert.equal(c.el.querySelector('.cr-area[data-key="v:acme"]').classList.contains('is-dim'), false);
  move(19);                                          // the top of the plot, above bucket 0's stack of 3
  assert.equal(c.el.querySelectorAll('.cr-area.is-dim').length, 0);
});

test('the canvas tracks the rendered width at a fixed 260px height, so the axis text stays 11px on a wide card; a resize does not morph', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  let fire = null;
  doc.defaultView.ResizeObserver = class { constructor(cb) { fire = cb; } observe() {} };
  const calls = [];
  doc.defaultView.SVGElement.prototype.animate = function (k) { calls.push(k); return {}; };
  const c = createAreaChart({ doc });
  c.update(SPEC([2, 3, 4]));
  fire([{ contentRect: { width: 936 } }]);
  assert.equal(c.el.querySelector('svg').getAttribute('viewBox'), '0 0 936 260');
  assert.equal(c.el.querySelector('.ch-ytick').getAttribute('font-size'), '11');
  const xs = [...c.el.querySelectorAll('.cr-axis text:not(.ch-ytick)')].map((t) => Number(t.getAttribute('x')));
  assert.equal(xs.at(-1), 936 - 12, 'the last label sits at the right edge of the wider plot');
  assert.equal(calls.length, 0);
  fire([{ contentRect: { width: 0 } }]);              // hidden: keep the last canvas
  assert.equal(c.el.querySelector('svg').getAttribute('viewBox'), '0 0 936 260');
});

test('the label just before the last one is dropped instead of colliding with it', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const c = createAreaChart({ doc });
  const days = Array.from({ length: 20 }, (_, i) => new Date(2026, 9, 1 + i).getTime());
  c.update({ buckets: days, bucket: 'day', metric: 'spend', series: [{ key: 'v:a', kind: 'value', label: 'a', values: days.map(() => 1) }] });
  const labels = [...c.el.querySelectorAll('.cr-axis text:not(.ch-ytick)')].map((t) => t.textContent);
  assert.deepEqual(labels, ['Thu 1', '4', '7', '10', '13', '16', '20']);
});
