// test/ui-shape-proposal.test.mjs — the run card's Shape it first parts (spec §3.2): chips on a shaped card,
// the nudge (open decisions, both choices with estimates) on a nudged one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { shapeCardExtras, shapeWhatHappens, shapeAdvancedSummary } from '../ui/public/shape/proposal.mjs';
import { SHAPE_ATTENTION } from '../ui/public/shape/plan-text.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const est = (planningUsd, buildUsd, minutes) => ({ costUsd: planningUsd + buildUsd, planningUsd, buildUsd, minutes, samples: 4 });
const nudge = (over = {}) => ({
  reason: 'decisions', size: 'large', openDecisions: ['Storage engine', 'Auth model'], perspectives: ['architect'],
  estimates: { asIs: est(0.5, 1, 12), shaped: est(1.25, 1, 9) }, asIsAuto: false, ...over,
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
  assert.deepEqual(ests, ['Planning ≈ $0.50 + build ≈ $1.00 · ~12 min', `Planning ≈ $1.25 + build ≈ $1.00 · ~9 min · ${SHAPE_ATTENTION}`]);
  assert.equal(ui.el.querySelector('.shape-est-shared'), null);
  assert.equal(ui.el.querySelector('.shape-choice.primary b').textContent, 'Shaper');
  assert.equal(ui.el.querySelector('.shape-choice.primary span').textContent,
    'Up to 3 questions now, then a plan you approve before anything is built.');
  assert.ok(ui.el.querySelector('.shape-chips'));
});

test('one open decision → singular head', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ openDecisions: ['Storage engine'] }) });
  assert.equal(ui.el.querySelector('.shape-nudge-head').textContent, 'This task leaves 1 decision open');
});

test('missing estimates → "no estimate yet"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: null, shaped: null } }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'), ['no estimate yet', `no estimate yet · ${SHAPE_ATTENTION}`]);
  const none = shapeCardExtras(doc(), { nudge: nudge({ estimates: null }) });
  assert.deepEqual(texts(none.el, '.shape-choice .shape-est'), ['no estimate yet', `no estimate yet · ${SHAPE_ATTENTION}`]);
});

test('asIsAuto → "Auto picks the workflow at start"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ asIsAuto: true }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'),
    ['Auto picks the workflow at start', `Planning ≈ $1.25 + build ≈ $1.00 · ~9 min · ${SHAPE_ATTENTION}`]);
});

test('no open decisions (large only) → "This is a large task"', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ reason: 'large', openDecisions: [] }) });
  assert.equal(ui.el.querySelector('.shape-nudge-head').textContent, 'This is a large task');
  assert.equal(ui.el.querySelector('.shape-nudge-list'), null);
});

test('equal figures on both choices still show on both, and there is no shared line', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: est(2, 1.5, 9), shaped: est(2, 1.5, 9) } }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'),
    ['Planning ≈ $2.00 + build ≈ $1.50 · ~9 min', `Planning ≈ $2.00 + build ≈ $1.50 · ~9 min · ${SHAPE_ATTENTION}`]);
  assert.equal(ui.el.querySelector('.shape-est-shared'), null);
});

test('a card stored before the split keeps its single figure', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge({ estimates: { asIs: { costUsd: 1.5, minutes: 12, samples: 4 }, shaped: null } }) });
  assert.deepEqual(texts(ui.el, '.shape-choice .shape-est'), ['≈ $1.50 · ~12 min', `no estimate yet · ${SHAPE_ATTENTION}`]);
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

test('a nudged card body() carries the nudge perspectives and size', () => {
  const ui = shapeCardExtras(doc(), { nudge: nudge() });
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'architect'], size: 'large' } });
});

test('a shaped card body() sends the slices and size of card.shape', () => {
  const ui = shapeCardExtras(doc(), { shape: { perspectives: ['product', 'qa'], slices: 'off', size: 'medium' } });
  assert.deepEqual(ui.body(), { workflowId: 'wf_shape', shape: { perspectives: ['product', 'qa'], slices: 'off', size: 'medium' } });
});

test('shapeWhatHappens: the questions and the approval; slices only when suggested', () => {
  assert.equal(shapeWhatHappens({ perspectives: ['product'] }), 'Up to 3 questions, then a plan you approve.');
  assert.equal(shapeWhatHappens({ likelySlices: 3 }), 'Up to 3 questions, then a plan you approve. Likely 3 slices, one PR each.');
  assert.equal(shapeWhatHappens({ likelySlices: 1 }), 'Up to 3 questions, then a plan you approve.');
  assert.equal(shapeWhatHappens(null), 'Up to 3 questions, then a plan you approve.');
});

test('shapeAdvancedSummary', () => {
  assert.equal(shapeAdvancedSummary({ engine: 'Claude', guardrails: 'Normal', agents: 7 }),
    'Advanced · Claude · Normal guardrails · 7 agents on workflow defaults');
  assert.equal(shapeAdvancedSummary({ engine: 'Claude', guardrails: 'Normal', agents: 7, overrides: 2 }),
    'Advanced · Claude · Normal guardrails · 7 agents, 2 changed from workflow defaults');
  assert.equal(shapeAdvancedSummary({ engine: 'Codex', guardrails: 'Strict' }), 'Advanced · Codex · Strict guardrails');
  assert.equal(shapeAdvancedSummary(), 'Advanced');
});
