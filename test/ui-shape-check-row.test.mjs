// test/ui-shape-check-row.test.mjs — the ONE check-row component and the ONE fold() (shaper-cards D7): a check line
// that unfolds neutral ✓ / ✕ rows; and the scan that keeps every other copy out of ui/public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fold, buildCheckRows, buildCheckFold } from '../ui/public/shape/check-row.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const item = (id, pass, detail) => ({ id, label: `Label ${id}`, pass, ...(detail ? { detail } : {}) });
const CHECK = { passed: 4, total: 5, ok: false, items: [
  item('sections', true), item('testable', true), item('decisions', true), item('paths', false, '1 path not found'), item('tests', true),
] };

test('buildCheckFold: one line "Shape 4/5 · 1 to fix" that unfolds 5 neutral rows', () => {
  const f = buildCheckFold(doc, CHECK);
  assert.equal(f.line.querySelector('.plan-fold-text').textContent, 'Shape 4/5 · 1 to fix');
  assert.ok(f.line.classList.contains('plan-check-line'));
  assert.equal(f.line.type, 'button');
  assert.equal(f.rows.hidden, true);
  const rows = [...f.rows.querySelectorAll('.plan-check-row')];
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((r) => r.classList.contains('ok')).length, 4);
  const bad = rows.find((r) => !r.classList.contains('ok'));
  assert.ok(bad.querySelector('.plan-check-mark svg'), 'the x icon (icons.mjs), not a glyph');
  assert.equal(bad.querySelector('.plan-check-mark').textContent, '');
  assert.equal(bad.querySelector('.plan-check-mark').getAttribute('aria-label'), 'unmet');
  assert.equal(bad.querySelector('.plan-check-detail').textContent, '1 path not found');
  assert.equal(rows[0].querySelector('.plan-check-detail'), null, 'a met row carries no detail');
  assert.equal(buildCheckFold(doc, CHECK, 'Outline').line.textContent.replace('›', ''), 'Outline 4/5 · 1 to fix');
});

test('update() repaints in place and an open fold stays open', () => {
  const f = buildCheckFold(doc, CHECK);
  f.line.click();
  assert.equal(f.rows.hidden, false);
  f.update({ passed: 5, total: 5, ok: true, items: CHECK.items.map((it) => ({ ...it, pass: true })) });
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

// ---- the scan: ui/public .mjs/.js only, comments stripped
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const FILES = walk(join(ROOT, 'ui/public')).map((p) => ({ rel: relative(ROOT, p).split('\\').join('/'), src: strip(readFileSync(p, 'utf8')) }));
const hits = (re, files = FILES) => files.filter((f) => re.test(f.src)).map((f) => f.rel);

test('scan: plan-check-row is drawn only by ui/public/shape/check-row.mjs', () => {
  assert.deepEqual(hits(/plan-check-row/), ['ui/public/shape/check-row.mjs']);
});

test('scan: under ui/public/shape/ fold() is defined only in check-row.mjs', () => {
  const shape = FILES.filter((f) => f.rel.startsWith('ui/public/shape/'));
  assert.deepEqual(hits(/function fold\(|const fold = \(/, shape), ['ui/public/shape/check-row.mjs']);
});

test('scan: no held layout, no chip check row, no "Run this plan" anywhere', () => {
  for (const re of [/renderHeld/, /paintChecks/, /buildCheckRow\(/, /Run this plan/]) assert.deepEqual(hits(re), [], String(re));
});

test('scan: the gate-another button is created only in ui/public/shape/step-card.mjs (the delegate only names it)', () => {
  // D19: question-delegate.mjs keeps its DECISIONS map and Q_BUTTONS, which the run page's one delegate still uses.
  assert.deepEqual(hits(/(?<![.\w-])gate-another\b/), ['ui/public/question-delegate.mjs', 'ui/public/shape/step-card.mjs']);
});
