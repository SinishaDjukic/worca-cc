// test/ui-shape-checklist-view.test.mjs — the "Perspective checklists" groups of the run page's and History's
// Overview (spec D7): one <details> per review cycle that carries a checklist, newest first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChecklistGroups } from '../ui/public/shape/checklist-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const row = (cycle, checklist) => ({ kind: 'impl', cycle, issues: [], summary: '', ...(checklist ? { checklist } : {}) });
const item = (id, status, evidence = '') => ({ id, perspective: 'qa', text: `text ${id}`, status, evidence });

test('null without a review that carries a checklist', () => {
  assert.equal(renderChecklistGroups(doc, []), null);
  assert.equal(renderChecklistGroups(doc, undefined), null);
  assert.equal(renderChecklistGroups(doc, [row(1), row(2, [])]), null);
});

test('two cycles: newest first, the first open, captions with the tally', () => {
  const root = renderChecklistGroups(doc, [
    row(1, [item('R-qa-1', 'unmet', 'no test'), item('R-qa-2', 'met', 'x')]),
    row(2, [item('R-qa-1', 'met', 'test y'), item('R-qa-2', 'na', 'n/a here')]),
  ]);
  assert.equal(root.querySelector('.shape-cl-title').textContent, 'Perspective checklists');
  const groups = [...root.querySelectorAll('details.shape-cl-cycle')];
  assert.equal(groups.length, 2);
  assert.equal(groups[0].open, true);
  assert.equal(groups[1].open, false);
  assert.equal(groups[0].querySelector('summary').textContent, 'Review cycle 2 · 1 met · 0 unmet · 1 n/a');
  assert.equal(groups[1].querySelector('summary').textContent, 'Review cycle 1 · 1 met · 1 unmet · 0 n/a');
});

test('each item shows its status class, label, id, text and evidence only when present', () => {
  const root = renderChecklistGroups(doc, [row(1, [item('R-qa-1', 'met', 'proof'), item('R-qa-2', 'na'), item('R-qa-3', 'unmet', 'gap')])]);
  const lis = [...root.querySelectorAll('li.shape-cl-item')];
  assert.deepEqual(lis.map((l) => l.className), ['shape-cl-item st-met', 'shape-cl-item st-na', 'shape-cl-item st-unmet']);
  assert.deepEqual(lis.map((l) => l.querySelector('.shape-cl-status').textContent), ['Met', 'N/A', 'Unmet']);
  assert.equal(lis[0].querySelector('.shape-cl-id').textContent, 'R-qa-1');
  assert.equal(lis[0].querySelector('.shape-cl-text').textContent, 'text R-qa-1');
  assert.equal(lis[0].querySelector('.shape-cl-evidence').textContent, 'proof');
  assert.equal(lis[1].querySelector('.shape-cl-evidence'), null);
});

test('an unknown status renders as "Not reported"', () => {
  const root = renderChecklistGroups(doc, [row(1, [item('R-qa-1', 'missing'), item('R-qa-2', 'weird')])]);
  const lis = [...root.querySelectorAll('li')];
  assert.deepEqual(lis.map((l) => l.querySelector('.shape-cl-status').textContent), ['Not reported', 'Not reported']);
  assert.ok(lis[1].classList.contains('st-missing'));
});
