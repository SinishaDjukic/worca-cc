// test/ui-status-dot.test.mjs — the one status-dot renderer (spec §2.1): Needs you and Failed are 12px symbols, never dots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderStatusDot, paintStatusDot } from '../ui/public/status-dot.mjs';
import { RUN_STATES } from '../src/shared/run-model.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const model = (state) => ({ state, ...RUN_STATES[state] });

test('Needs you and Failed draw the 12px "?" / "!" symbol with their aria-label, never a plain dot', async () => {
  await checkRows([['needs-you', 'Needs you', 'is-amber', 'question'], ['failed', 'Failed', 'is-red', 'alert']].map(([state, label, cls, sym]) => ({ name: state, run: () => {
    const el = renderStatusDot(doc, model(state));
    assert.equal(el.getAttribute('role'), 'img');
    assert.equal(el.getAttribute('aria-label'), label);
    assert.ok(el.classList.contains('has-sym') && el.classList.contains(cls));
    assert.equal(el.dataset.symbol, sym);
    const svg = el.querySelector('svg.status-sym');
    assert.ok(svg, 'a symbol, not a plain dot');
    assert.equal(svg.getAttribute('width'), '12');
    assert.equal(svg.getAttribute('height'), '12');
    assert.ok(svg.querySelector('circle'), 'a filled circle');
    assert.ok(svg.querySelectorAll('path').length >= 2, 'the stroke glyph');
  } })));
});

test('the other 8 states draw their 8px dot, hidden from assistive tech (the word is next to it)', async () => {
  const want = { starting: 'is-peach', working: 'is-peach', paused: 'is-grey', waiting: 'is-grey-ring', stopped: 'is-dark-grey',
    ready: 'is-green', 'in-review': 'is-green', merged: 'is-violet' };
  await checkRows(Object.entries(want).map(([state, cls]) => ({ name: state, run: () => {
    const el = renderStatusDot(doc, model(state));
    assert.ok(el.classList.contains('status-dot') && el.classList.contains(cls));
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.equal(el.querySelector('svg'), null);
    assert.equal(el.classList.contains('is-pulse'), state === 'starting' || state === 'working');
  } })));
});

test('repainting the same element from a symbol to a dot drops the symbol and its label', () => {
  const el = renderStatusDot(doc, model('needs-you'));
  paintStatusDot(el, model('working'));
  assert.equal(el.querySelector('svg'), null);
  assert.equal(el.getAttribute('aria-label'), null);
  assert.equal(el.getAttribute('role'), null);
});

test('status-dot CSS: 8px dot, 12px symbol, pulse off under reduced motion', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-dot\{[^}]*width:8px;height:8px;[^}]*border-radius:50%/);
  assert.match(css, /\.status-dot\.has-sym\{[^}]*width:12px;height:12px/);
  assert.match(css, /prefers-reduced-motion: reduce\)\{[^@]*\.status-dot\.is-pulse\{animation:none;\}/);
  assert.match(css, /\.status-sym > g\{stroke:var\(--on-signal\);\}/);
  assert.match(css, /--on-signal:light-dark\(#19191B,#19191B\)/);
});

test('QA 6: a plain Needs-you dot (no symbol) still names itself "Needs you"', () => {
  const el = renderStatusDot(doc, { ...model('needs-you'), symbol: null });
  assert.equal(el.querySelector('svg'), null);
  assert.ok(el.classList.contains('is-amber') && !el.classList.contains('has-sym'));
  assert.equal(el.getAttribute('role'), 'img');
  assert.equal(el.getAttribute('aria-label'), 'Needs you');
  assert.equal(el.getAttribute('aria-hidden'), null);
});
