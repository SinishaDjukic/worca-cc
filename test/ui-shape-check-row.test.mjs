// test/ui-shape-check-row.test.mjs — the shared shape/outline check row (spec D6, §3.8): passing checks as chips, each
// failing one with its detail and, when given, a Fix button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildCheckRow, fold, buildCheckRows, buildCheckFold } from '../ui/public/shape/check-row.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const CHECK = {
  items: [
    { id: 'sections', label: 'Every section', pass: true },
    { id: 'paths', label: 'Paths are real', pass: false, detail: '1 path not found' },
    { id: 'misc', label: 'Misc', pass: false },
  ],
};

test('passing checks are chips, failing ones carry label and detail', () => {
  const row = buildCheckRow(doc, CHECK);
  assert.equal(row.className, 'plan-check');
  const ok = row.querySelectorAll('.plan-check-ok');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].textContent, '✓ Every section');
  const bad = row.querySelectorAll('.plan-check-bad');
  assert.equal(bad.length, 2);
  assert.equal(bad[0].querySelector('.plan-check-label').textContent, 'Paths are real');
  assert.equal(bad[0].querySelector('.plan-check-detail').textContent, '1 path not found');
  assert.equal(bad[1].querySelector('.plan-check-detail').textContent, '');
});

test('no Fix button without onFix', () => {
  assert.equal(buildCheckRow(doc, CHECK).querySelector('.plan-fix'), null);
});

test('each failing check gets a Fix button that calls onFix with its item', () => {
  const got = [];
  const row = buildCheckRow(doc, CHECK, { onFix: (it) => got.push(it.id) });
  const fixes = row.querySelectorAll('button.plan-fix');
  assert.equal(fixes.length, 2);
  assert.equal(fixes[0].textContent, 'Fix');
  assert.equal(fixes[0].type, 'button');
  assert.ok(fixes[0].classList.contains('btn'));
  fixes[1].click();
  fixes[0].click();
  assert.deepEqual(got, ['misc', 'paths']);
});

const foldItem = (id, pass, detail) => ({ id, label: `Label ${id}`, pass, ...(detail ? { detail } : {}) });
const FOLD_CHECK = { passed: 4, total: 5, ok: false, items: [
  foldItem('sections', true), foldItem('testable', true), foldItem('decisions', true), foldItem('paths', false, '1 path not found'), foldItem('tests', true),
] };

test('buildCheckFold: one line "Shape 4/5 · 1 to fix" that unfolds 5 neutral rows', () => {
  const f = buildCheckFold(doc, FOLD_CHECK);
  assert.equal(f.line.querySelector('.plan-fold-text').textContent, 'Shape 4/5 · 1 to fix');
  assert.ok(f.line.classList.contains('plan-check-line'));
  assert.equal(f.line.type, 'button');
  assert.equal(f.rows.hidden, true);
  const rows = [...f.rows.querySelectorAll('.plan-check-row')];
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((r) => r.classList.contains('ok')).length, 4);
  const bad = rows.find((r) => !r.classList.contains('ok'));
  assert.equal(bad.querySelector('.plan-check-mark').textContent, '✕');
  assert.equal(bad.querySelector('.plan-check-mark').getAttribute('aria-label'), 'unmet');
  assert.equal(bad.querySelector('.plan-check-detail').textContent, '1 path not found');
  assert.equal(rows[0].querySelector('.plan-check-detail'), null, 'a met row carries no detail');
  assert.equal(buildCheckFold(doc, FOLD_CHECK, 'Outline').line.textContent.replace('›', ''), 'Outline 4/5 · 1 to fix');
});

test('update() repaints in place and an open fold stays open', () => {
  const f = buildCheckFold(doc, FOLD_CHECK);
  f.line.click();
  assert.equal(f.rows.hidden, false);
  f.update({ passed: 5, total: 5, ok: true, items: FOLD_CHECK.items.map((it) => ({ ...it, pass: true })) });
  assert.equal(f.rows.hidden, false);
  assert.equal(f.line.querySelector('.plan-fold-text').textContent, 'Shape 5/5');
  assert.equal(f.rows.querySelectorAll('.plan-check-row.ok').length, 5);
});

test('buildCheckRows: nothing for a check without items', () => {
  assert.deepEqual(buildCheckRows(doc, null), []);
  assert.deepEqual(buildCheckRows(doc, { items: 'x' }), []);
});

test('fold() toggles the region and aria-expanded, and calls onOpen only on open', () => {
  const b = doc.createElement('button');
  const region = doc.createElement('div'); region.hidden = true;
  let opened = 0;
  fold(b, region, () => { opened += 1; });
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  b.click();
  assert.equal(region.hidden, false);
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  b.click();
  assert.equal(region.hidden, true);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(opened, 1);
});
