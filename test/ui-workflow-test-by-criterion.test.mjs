// test/ui-workflow-test-by-criterion.test.mjs — board 12: one row per criterion, coloured when it changed and decides; board 5: the
// "By example · By criterion" tabs and the "Worca's checking" line in Compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderByCriterion } from '../ui/public/workflows/criteria-pages.mjs';
import { renderCompare } from '../ui/public/workflows/test-compare.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const R = { state: 'reliable', n: 20, agree: 19, decides: true };
const data = { counts: { total: 3, reliable: 2, unreliable: 1, waiting: 0 }, more: 4, checking: false, rows: [
  { key: '1|k', label: 'Names a success metric', exampleName: 'Bulk invoice export', exact: false, trust: R, a: { met: 3, of: 3 }, b: { met: 1, of: 3 }, changed: 'worse', unreliableChange: false },
  { key: '2|k', label: 'Proposes a test within 4 weeks', exampleName: 'Pricing page A/B test', exact: false, trust: { state: 'unreliable', n: 10, agree: 6, decides: false },
    a: { met: 3, of: 3 }, b: { met: 3, of: 3 }, changed: null, unreliableChange: false },
  { key: '1|c', label: "Mentions that today's export stops at 200 invoices", exampleName: 'Bulk invoice export', exact: true, trust: { state: 'exact', decides: true },
    a: { met: 3, of: 3 }, b: { met: 2, of: 3 }, changed: null, unreliableChange: false },
] };

test('the legend, the rows with their example, counts and trust, and the collapsed line', () => {
  const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window;
  const root = doc.getElementById('r');
  renderByCriterion(root, data, { doc, labels: { a: 'v4', b: 'v5' } });
  assert.match(root.textContent, /Can you trust Worca's checking of each criterion\?/);
  assert.deepEqual([...root.querySelectorAll('.wft-bc-legend-grid > div')].map((d) => d.textContent), [
    'ReliableWorca agrees with people almost every time and catches the mistakes planted on purpose.',
    'Confirm 4 resultsNew criterion. It counts, but you have not confirmed that Worca judges it right.',
    'UnreliableAfter at least 10 answers, Worca often judges differently from people. It still runs and is shown, but does not decide better or worse until you fix it.',
  ]);
  assert.deepEqual([...root.querySelectorAll('.wft-bc-row.is-head > span')].map((x) => x.textContent), ['Criterion', 'v4 met', 'v5 met', "Worca's checking"]);
  const rows = [...root.querySelectorAll('.wft-bc-row:not(.is-head):not(.is-more)')];
  assert.equal(rows[0].querySelector('b').textContent, 'Names a success metric');
  assert.equal(rows[0].querySelector('.wft-bc-ex').textContent, 'Bulk invoice export');
  assert.ok(rows[0].classList.contains('is-worse'));
  assert.deepEqual([...rows[0].querySelectorAll('.wft-bc-n')].map((x) => x.textContent), ['3 of 3', '1 of 3']);
  assert.match(rows[0].textContent, /Reliable[\s\S]*Agrees with people 19 of 20 times/, 'board 12: "Agrees with people", the column says whose');
  assert.match(rows[1].textContent, /Unreliable[\s\S]*Agrees with people 6 of 10 times/);
  assert.match(rows[2].textContent, /Can be checked exactly/);
  assert.equal(rows[2].querySelector('.wft-exact').textContent, 'Can be checked exactly');
  assert.equal(rows[2].querySelector('.badge').textContent, 'Reliable');
  assert.equal(root.querySelector('.wft-bc-more').textContent, '4 more criteria, all met in every try by both versions');
  assert.equal(root.querySelector('.wft-bc-foot').textContent,
    'Rows with a coloured background changed between the versions. If a change shows only in unreliable criteria, Compare says so instead of calling it better or worse.');
});

test('one version (Try it once): no "<A> met" column; one more criterion says "criterion"', () => {
  const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window;
  const root = doc.getElementById('r');
  renderByCriterion(root, { ...data, more: 1, rows: [{ ...data.rows[1], a: null }] }, { doc, labels: { a: null, b: 'your draft' } });
  assert.deepEqual([...root.querySelectorAll('.wft-bc-row.is-head > span')].map((x) => x.textContent), ['Criterion', 'your draft met', "Worca's checking"]);
  assert.ok(root.querySelector('.wft-bc-rows').classList.contains('is-one'));
  assert.equal(root.querySelector('.wft-bc-more').textContent, '1 more criterion, all met in every try by both versions');
});

const v = { passed: true, basics: [], checks: [], facts: { durationMs: 60000, sentBack: 0 } };
const tries = [{ id: 1, side: 'a', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }, { id: 2, side: 'b', exampleId: 1, status: 'passed', costUsd: 1, verdict: v }];
const cmp = (over = {}) => ({ run: { id: 7, kind: 'compare', a: 4, b: 'draft', tries: 1, status: 'done', finishedAt: '2026-10-26T10:00:00Z', capUsd: 15, exampleIds: [1] },
  title: 'Your v5 draft compared with v4', labels: { a: 'v4', b: 'v5 draft' }, examples: 1, costUsd: 2,
  model: compareModel({ examples: [{ id: 1, name: 'Bulk invoice export' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries }),
  changes: [], fair: [], criteria: { ...data, counts: { total: 12, reliable: 10, unreliable: 1, waiting: 1 } }, ...over });
const NOW = Date.parse('2026-10-26T12:00:00Z');
const click = (n) => n.dispatchEvent(new n.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const key = (n, k) => n.dispatchEvent(new n.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('board 5: with criteria, the tabs and the line; By criterion paints full width, and stays on a repaint; without, the heading as before', () => {
  const { window } = new JSDOM('<!doctype html><div id="r"></div>');
  const doc = window.document;
  const root = doc.getElementById('r');
  const actions = { back() {}, testAgain() {}, open() {}, tryMore() {} };
  renderCompare(root, cmp(), actions, { doc, now: NOW });
  const tabs = () => [...root.querySelectorAll('.wft-by-tabs [role="tab"]')];
  assert.equal(root.querySelector('.wft-by-tabs').getAttribute('aria-label'), 'Show results');
  assert.deepEqual(tabs().map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['By example', 'true'], ['By criterion', 'false']]);
  assert.equal(root.querySelector('.wft-by-title'), null, 'the tabs name the view');
  const line = root.querySelector('.wft-changes .wft-check-line');
  assert.equal(line.querySelector('b').textContent, "Worca's checking");
  assert.equal(line.textContent,
    "Worca's checking is reliable for 10 of 12 criteria. 1 unreliable criterion is shown, but does not decide better or worse. See by criterion");
  tabs()[1].focus();   // a browser focuses a clicked button; jsdom does not
  click(tabs()[1]);
  const shown = () => [root.querySelector('.wft-by-crit').hidden, root.querySelector('.wft-by .wft-table').hidden,
    root.querySelector('.wft-tiles').hidden, root.querySelector('.wft-changes').hidden];
  assert.deepEqual(shown(), [false, true, true, true], 'board 12: the criteria take the page under the tabs');
  assert.match(root.querySelector('.wft-by-crit').textContent, /Can you trust Worca's checking of each criterion\?/);
  assert.equal(root.querySelectorAll('.wft-by-crit .wft-bc-row:not(.is-head):not(.is-more)').length, 3);
  assert.equal(doc.activeElement, tabs()[1]);
  renderCompare(root, cmp(), actions, { doc, now: NOW });   // a frame repaints the page
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['false', 'true'], 'a repaint keeps By criterion');
  assert.deepEqual(shown(), [false, true, true, true]);
  assert.equal(doc.activeElement, tabs()[1], 'and the focus');
  key(tabs()[1], 'ArrowLeft');
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['true', 'false']);
  assert.deepEqual(shown(), [true, false, false, false]);
  assert.equal(doc.activeElement, tabs()[0]);
  click(root.querySelector('.wft-check-line button'));   // See by criterion
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(doc.activeElement, tabs()[1]);
  renderCompare(root, { ...cmp(), run: { ...cmp().run, id: 8 } }, actions, { doc, now: NOW });
  assert.deepEqual(tabs().map((t) => t.getAttribute('aria-selected')), ['true', 'false'], 'another test opens on By example');

  const plain = doc.createElement('div');
  renderCompare(plain, cmp({ criteria: null }), actions, { doc, now: NOW });
  assert.equal(plain.querySelector('.wft-by-tabs'), null);
  assert.equal(plain.querySelector('.wft-check-line'), null);
  assert.equal(plain.querySelector('.wft-by-title').textContent, 'By example', 'G9: one view keeps its heading');
  const none = doc.createElement('div');
  renderCompare(none, cmp({ criteria: { ...data, counts: { total: 0, reliable: 0, unreliable: 0, waiting: 0 }, rows: [], more: 0 } }), actions, { doc, now: NOW });
  assert.equal(none.querySelector('.wft-by-tabs'), null, 'no criteria: no tabs');
});
