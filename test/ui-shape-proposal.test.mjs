// test/ui-shape-proposal.test.mjs — the run card's Shape it first parts (spec §3.2): chips on a shaped card,
// the nudge (open decisions, both choices with estimates) on a nudged one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { shapeCardExtras } from '../ui/public/shape/proposal.mjs';
import { SHAPE_ATTENTION } from '../ui/public/shape/plan-text.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const est = (costUsd, minutes) => ({ costUsd, minutes, samples: 4 });
const nudge = (over = {}) => ({
  reason: 'decisions', size: 'large', openDecisions: ['Storage engine', 'Auth model'], perspectives: ['architect'],
  estimates: { asIs: est(1.5, 12), shaped: est(2.25, 9), same: false }, asIsAuto: false, ...over,
});
const texts = (el, sel) => [...el.querySelectorAll(sel)].map((e) => e.textContent);

test('no shape and no nudge → null', () => {
  assert.equal(shapeCardExtras(doc(), {}), null);
  assert.equal(shapeCardExtras(doc(), null), null);
  assert.equal(shapeCardExtras(doc(), { title: 'Fix it', workflowId: 'wf_default' }), null);
});

test('a nudge lists the open decisions and shows both estimates', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge() });
  assert.equal(ui.el.querySelector('.shape-nudge-head').textContent, 'This task leaves 2 decisions open');
  assert.deepEqual(texts(ui.el, '.shape-nudge-list li'), ['Storage engine', 'Auth model']);
  const ests = texts(ui.el, '.shape-choice .shape-est');
  assert.deepEqual(ests, ['≈ $1.50 · ~12 min', `≈ $2.25 · ~9 min · ${SHAPE_ATTENTION}`]);
  assert.equal(ui.el.querySelector('.shape-est-shared'), null);
  assert.ok(ui.el.querySelector('.shape-choice.primary'));
  assert.ok(ui.el.querySelector('.shape-chips'));
});

test('one open decision → singular head', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ openDecisions: ['Storage engine'] }) });
  assert.equal(ui.el.querySelector('.shape-nudge-head').textContent, 'This task leaves 1 decision open');
});

test('missing estimates → "no estimate yet"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: null, shaped: null, same: false } }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'), ['no estimate yet', `no estimate yet · ${SHAPE_ATTENTION}`]);
  const none = shapeCardExtras(doc(), { nudge: nudge({ estimates: null }) });
  assert.deepEqual(texts(none.el, '.shape-choice .shape-est'), ['no estimate yet', `no estimate yet · ${SHAPE_ATTENTION}`]);
});

test('asIsAuto → "Auto picks the workflow at start"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ asIsAuto: true }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'),
    ['Auto picks the workflow at start', `≈ $2.25 · ~9 min · ${SHAPE_ATTENTION}`]);
});

test('no open decisions (large only) → "This is a large task"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ reason: 'large', openDecisions: [] }) });
  assert.equal(ui.el.querySelector('.shape-nudge-head').textContent, 'This is a large task');
  assert.equal(ui.el.querySelector('.shape-nudge-list'), null);
});

test('estimates.same → one shared build line and no per-choice figure', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: est(2.25, 9), shaped: est(2.25, 9), same: true } }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'), [SHAPE_ATTENTION]);
  assert.deepEqual(texts(ui.el, '.shape-est-shared'), ['Build ≈ $2.25 · ~9 min either way']);
});

test('estimates.same with asIsAuto keeps "Auto picks…" and the shaped figure', () => {
  const ui = shapeCardExtras(doc(), {
    nudge: nudge({ asIsAuto: true, estimates: { asIs: est(2.25, 9), shaped: est(2.25, 9), same: true } }),
  });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'),
    ['Auto picks the workflow at start', `≈ $2.25 · ~9 min · ${SHAPE_ATTENTION}`]);
  assert.equal(ui.el.querySelector('.shape-est-shared'), null);
});

test('estimates.same with shaped:null → "Build: no estimate yet"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: null, shaped: null, same: true } }) });
  assert.deepEqual(texts(ui.el, '.shape-est-shared'), ['Build: no estimate yet']);
});

test('a shaped card has chips but no choices; body() reflects a chip toggle', () => {
  const ui = shapeCardExtras(doc(), { shape: { perspectives: ['product', 'qa'] } });
  assert.equal(ui.el.querySelector('.shape-choices'), null);
  assert.equal(ui.el.querySelector('.shape-nudge-head'), null);
  assert.ok(ui.el.querySelector('.shape-chips'));
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'] } });
  ui.el.querySelector('.shape-chip[data-perspective="qa"]').click();
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product'] } });
  ui.el.querySelector('.shape-chip-more').click();
  ui.el.querySelector('.shape-chip[data-perspective="ux"]').click();
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'ux'] } });
});

test('a nudged card body() carries the nudge perspectives', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge() });
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'architect'] } });
});
