// test/ui-shape-checklist-view.test.mjs — the "Perspective checklists" view of the run page's and History's Overview
// (spec D7, D23): the latest cycle as one summary line, unmet items open, met items and earlier cycles behind buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChecklistGroups, foldLabel } from '../ui/public/shape/checklist-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const row = (cycle, checklist) => ({ kind: 'impl', cycle, issues: [], summary: '', ...(checklist ? { checklist } : {}) });
const item = (id, status, evidence = '') => ({ id, perspective: 'qa', text: `text ${id}`, status, evidence });
const ids = (scope) => [...scope.querySelectorAll('li .shape-cl-id')].map((n) => n.textContent);
const target = (root, btn) => root.querySelector(`#${btn.getAttribute('aria-controls')}`);
const latest = (root) => root.querySelector(':scope > .shape-cl-cycle');

test('null without a review that carries a checklist', () => {
  assert.equal(renderChecklistGroups(doc, []), null);
  assert.equal(renderChecklistGroups(doc, undefined), null);
  assert.equal(renderChecklistGroups(doc, [row(1), row(2, [])]), null);
});

test('only the latest cycle is open, as one summary line with the right counts', () => {
  const root = renderChecklistGroups(doc, [
    row(1, [item('R-qa-1', 'unmet', 'no test'), item('R-qa-2', 'met', 'x')]),
    row(2, [item('R-qa-1', 'met', 'test y'), item('R-qa-2', 'na', 'n/a here'), item('R-qa-3', 'unmet', 'gap')]),
  ]);
  assert.equal(root.querySelector('.shape-cl-title').textContent, 'Perspective checklists');
  assert.equal(root.querySelectorAll(':scope > .shape-cl-cycle').length, 1);
  assert.equal(latest(root).dataset.cycle, '2');
  assert.equal(latest(root).querySelector('.shape-cl-caption').textContent, 'Review cycle 2 · 1 met · 1 unmet · 1 n/a');
  assert.equal(root.querySelector('details'), null);
});

test('unmet, not-reported and met-without-evidence items are listed open, with their evidence', () => {
  const root = renderChecklistGroups(doc, [row(1, [
    item('R-qa-1', 'met', 'proof'), item('R-qa-2', 'unmet', 'gap'), item('R-qa-3', 'met'), item('R-qa-4', 'missing'),
  ])]);
  const open = latest(root).querySelector('.shape-cl-open');
  assert.equal(open.hidden, false);
  assert.deepEqual(ids(open), ['R-qa-2', 'R-qa-3', 'R-qa-4']);
  const lis = [...open.querySelectorAll('li')];
  assert.deepEqual(lis.map((l) => l.className), ['shape-cl-item st-unmet', 'shape-cl-item st-met', 'shape-cl-item st-missing']);
  assert.equal(lis[0].querySelector('.shape-cl-evidence').textContent, 'gap');
  assert.equal(lis[1].querySelector('.shape-cl-evidence'), null);
});

test('met and n/a items appear only after the "Show … met items" button', () => {
  const root = renderChecklistGroups(doc, [row(1, [
    item('R-qa-1', 'met', 'proof'), item('R-qa-2', 'na', 'not here'), item('R-qa-3', 'unmet', 'gap'), item('R-qa-4', 'met', 'p4'),
  ])]);
  const btn = latest(root).querySelector('button.shape-cl-more');
  assert.equal(btn.type, 'button');
  assert.equal(btn.textContent.replace('▾', '').trim(), 'Show 2 met and 1 n/a items');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  const folded = target(root, btn);
  assert.ok(folded.classList.contains('shape-cl-folded'));
  assert.equal(folded.hidden, true);
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(folded.hidden, false);
  assert.deepEqual(ids(folded), ['R-qa-1', 'R-qa-2', 'R-qa-4']);
  assert.equal(folded.querySelector('li .shape-cl-evidence').textContent, 'proof');
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(folded.hidden, true);
});

test('an all-met cycle shows no open list, only the summary and "Show N met items"', () => {
  const list = Array.from({ length: 23 }, (_, i) => item(`R-qa-${i + 1}`, 'met', `e${i}`));
  const root = renderChecklistGroups(doc, [row(2, list)]);
  assert.equal(latest(root).querySelector('.shape-cl-caption').textContent, 'Review cycle 2 · 23 met · 0 unmet · 0 n/a');
  assert.equal(latest(root).querySelector('.shape-cl-open'), null);
  assert.equal(latest(root).querySelector('.shape-cl-more .shape-cl-toggle-label').textContent, 'Show 23 met items');
  assert.equal(root.querySelector('.shape-cl-earlier-btn'), null);
});

test('no fold button when nothing folds', () => {
  const root = renderChecklistGroups(doc, [row(1, [item('R-qa-1', 'unmet', 'gap')])]);
  assert.equal(root.querySelector('.shape-cl-more'), null);
});

test('earlier cycles appear only after their button, newest first, each rendered the same way', () => {
  const root = renderChecklistGroups(doc, [
    row(1, [item('R-qa-1', 'unmet', 'no test'), item('R-qa-2', 'met', 'x')]),
    row(3, [item('R-qa-1', 'met', 'z'), item('R-qa-2', 'met', 'z')]),
    row(2, [item('R-qa-1', 'unmet', 'still'), item('R-qa-2', 'met', 'x')]),
  ]);
  const btn = root.querySelector('button.shape-cl-earlier-btn');
  assert.equal(btn.querySelector('.shape-cl-toggle-label').textContent, 'Earlier cycles (2)');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  const box = target(root, btn);
  assert.equal(box.hidden, true);
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(box.hidden, false);
  const cycles = [...box.querySelectorAll('.shape-cl-cycle')];
  assert.deepEqual(cycles.map((c) => c.dataset.cycle), ['2', '1']);
  assert.equal(cycles[1].querySelector('.shape-cl-caption').textContent, 'Review cycle 1 · 1 met · 1 unmet · 0 n/a');
  assert.deepEqual(ids(cycles[1].querySelector('.shape-cl-open')), ['R-qa-1']);
  const more = cycles[1].querySelector('button.shape-cl-more');
  assert.equal(target(root, more).hidden, true);
  more.click();
  assert.equal(target(root, more).hidden, false);
});

test('aria-controls ids are unique across two mounts', () => {
  const data = [row(1, [item('R-qa-1', 'met', 'x')]), row(2, [item('R-qa-1', 'met', 'y')])];
  const a = renderChecklistGroups(doc, data);
  const b = renderChecklistGroups(doc, data);
  const all = [...a.querySelectorAll('[aria-controls]'), ...b.querySelectorAll('[aria-controls]')]
    .map((n) => n.getAttribute('aria-controls'));
  assert.equal(new Set(all).size, all.length);
});

test('status labels, and an unknown status renders as "Not reported"', () => {
  const root = renderChecklistGroups(doc, [row(1, [item('R-qa-1', 'unmet', 'g'), item('R-qa-2', 'missing'), item('R-qa-3', 'weird')])]);
  const lis = [...root.querySelectorAll('.shape-cl-open li')];
  assert.deepEqual(lis.map((l) => l.querySelector('.shape-cl-status').textContent), ['Unmet', 'Not reported', 'Not reported']);
  assert.ok(lis[2].classList.contains('st-missing'));
  assert.equal(lis[0].querySelector('.shape-cl-text').textContent, 'text R-qa-1');
});

test('fold label wording', () => {
  assert.equal(foldLabel(23, 0), 'Show 23 met items');
  assert.equal(foldLabel(1, 0), 'Show 1 met item');
  assert.equal(foldLabel(20, 3), 'Show 20 met and 3 n/a items');
  assert.equal(foldLabel(0, 1), 'Show 1 n/a item');
});
