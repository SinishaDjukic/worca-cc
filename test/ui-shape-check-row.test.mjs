// test/ui-shape-check-row.test.mjs — the shared shape/outline check row (spec D6, §3.8): passing checks as chips, each
// failing one with its detail and, when given, a Fix button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildCheckRow } from '../ui/public/shape/check-row.mjs';

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
