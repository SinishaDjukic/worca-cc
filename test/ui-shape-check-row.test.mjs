// test/ui-shape-check-row.test.mjs — the ONE check-row component and the ONE fold() (shaper-cards D7): a check line
// that unfolds neutral ✓ / ✕ rows; and the scan that keeps every other copy out of ui/public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fold, swapOpen, buildCheckRows, buildCheckFold } from '../ui/public/shape/check-row.mjs';

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

test('buildCheckFold with no opts matches today; opts.text, rows and open replace them; update keeps it open', () => {
  const html = (f) => f.line.outerHTML + f.rows.outerHTML;
  assert.equal(html(buildCheckFold(doc, CHECK, 'Shape', {})), html(buildCheckFold(doc, CHECK)));
  const closed = buildCheckFold(doc, CHECK, 'Shape', { text: () => 'x' });
  assert.deepEqual([closed.line.querySelector('.plan-fold-text').textContent, closed.line.getAttribute('aria-expanded'), closed.rows.hidden], ['x', 'false', true]);
  assert.equal(closed.rows.querySelectorAll('.plan-check-row').length, 5, 'no opts.rows: the rows of the check');
  const opts = { text: (c) => `${c.items.length} things`, rows: (d, c) => [d.createElement('dl'), ...c.items.slice(0, 1).map(() => d.createElement('p'))], open: true };
  const f = buildCheckFold(doc, CHECK, 'Shape', opts);
  assert.equal(f.line.querySelector('.plan-fold-text').textContent, '5 things');
  assert.deepEqual([...f.rows.children].map((e) => e.tagName), ['DL', 'P']);
  assert.deepEqual([f.line.getAttribute('aria-expanded'), f.rows.hidden], ['true', false]);
  f.update({ items: [] });
  assert.equal(f.line.querySelector('.plan-fold-text').textContent, '0 things');
  assert.deepEqual([...f.rows.children].map((e) => e.tagName), ['DL']);
  assert.deepEqual([f.line.getAttribute('aria-expanded'), f.rows.hidden], ['true', false], 'update keeps it open');
  f.line.click();
  assert.deepEqual([f.line.getAttribute('aria-expanded'), f.rows.hidden], ['false', true], 'an open fold still closes');
});

test('buildCheckRows: tip sets the row title and an sr-only id; no tip leaves the markup unchanged', () => {
  const [row] = buildCheckRows(doc, { items: [{ id: 'R-po-1', label: 'Export', pass: true, tip: 'R-po-1' }] });
  assert.equal(row.title, 'R-po-1');
  assert.equal(row.querySelector('.sr-only').textContent, 'R-po-1');
  assert.equal(row.querySelector('.plan-check-label').textContent, 'Export');
  assert.equal(row.querySelector('.sr-only').compareDocumentPosition(row.querySelector('.plan-check-label')) & 4, 4, 'the id is read before the label');
  assert.equal(row.querySelectorAll(':is(button, [tabindex])').length, 0, 'no tab stop');
  const [bare] = buildCheckRows(doc, { items: [{ id: 'R-po-1', label: 'Export', pass: true }] });
  assert.equal(bare.outerHTML.includes('sr-only'), false);
  assert.equal(bare.hasAttribute('title'), false);
  assert.deepEqual([...bare.children].map((e) => e.className), ['plan-check-mark', 'plan-check-label']);
});

test('swapOpen: onClose runs before the button takes focus; without it Cancel behaves as today', () => {
  const rig = (onClose) => {
    const b = doc.createElement('button'); const region = doc.createElement('div'); region.hidden = true;
    const cancel = doc.createElement('button');
    const foot = doc.createElement('div'); foot.appendChild(b);
    doc.body.append(foot, region, cancel);
    swapOpen(b, region, cancel, () => { if (onClose) foot.hidden = true; }, onClose && (() => onClose(foot)));
    return { b, region, cancel, foot };
  };
  const order = [];
  const r = rig((foot) => { order.push('close'); foot.hidden = false; });
  r.b.addEventListener('focus', () => order.push(`focus foot-hidden=${r.foot.hidden} region-hidden=${r.region.hidden}`));
  r.b.click();
  assert.deepEqual([r.region.hidden, r.b.hidden, r.b.getAttribute('aria-expanded')], [false, true, 'true']);
  r.cancel.click();
  assert.deepEqual(order, ['close', 'focus foot-hidden=false region-hidden=true']);
  const plain = rig();
  plain.b.click();
  plain.cancel.click();
  assert.deepEqual([plain.region.hidden, plain.b.hidden, plain.b.getAttribute('aria-expanded'), doc.activeElement === plain.b], [true, false, 'false', true]);
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

// Shaper requirements s3 (D10): the ledger's item states. A marked item passes the count; not met keeps its ✕ and
// dropped draws the `none` icon; an item's own ariaLabel names its mark.
test('buildCheckRows: state dropped draws the none icon with aria-label dropped; not-met keeps the ✕; ariaLabel overrides', () => {
  const ledger = { passed: 3, total: 4, items: [
    { id: 'R-po-1', label: 'R-po-1 · Export', pass: true, ariaLabel: 'met' },
    { id: 'R-sec-2', label: 'R-sec-2 · Sign · moved to Run 5', pass: true, state: 'not-met', ariaLabel: 'not met' },
    { id: 'R-ux-1', label: 'R-ux-1 · Dark theme · out of budget', pass: true, state: 'dropped', ariaLabel: 'dropped' },
    { id: 'R-ops-1', label: 'R-ops-1 · Alert', pass: false, ariaLabel: 'not marked', detail: 'covered by the diff' },
  ] };
  const rows = buildCheckRows(doc, ledger);
  const mark = (r) => r.querySelector('.plan-check-mark');
  assert.deepEqual(rows.map((r) => mark(r).getAttribute('aria-label')), ['met', 'not met', 'dropped', 'not marked']);
  assert.deepEqual(rows.map((r) => r.classList.contains('ok')), [true, false, false, false]);
  assert.equal(mark(rows[2]).innerHTML.includes('stroke-dasharray'), true, 'the none icon');
  assert.equal(mark(rows[1]).innerHTML, mark(rows[3]).innerHTML, 'not met draws the same ✕ as unmarked');
  assert.equal(rows[1].querySelector('.plan-check-detail'), null, 'a marked row carries no detail');
  assert.equal(rows[3].querySelector('.plan-check-detail').textContent, 'covered by the diff');
  assert.equal(buildCheckFold(doc, ledger, 'Requirements').line.textContent.replace('›', ''), 'Requirements 3/4 · 1 to fix');
});
