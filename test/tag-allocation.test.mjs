// test/tag-allocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ALLOC_TOP, sharePercents, allocationModel, fromStatsRows, fromBreakdownRows,
  renderAllocationTable, renderAllocationTables, allocationCsv,
} from '../ui/public/tag-allocation.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const fmt = { usd: (n) => `$${n.toFixed(2)}` };
const sum = (xs) => xs.reduce((a, v) => a + v, 0);
const visibleShares = (m) => [...m.top, ...(m.other ? [m.other] : []), ...m.tail].map((r) => r.share);

test('sharePercents: integers by largest remainder, summing to exactly 100; a $0 total gives nulls', () => {
  assert.deepEqual(sharePercents([1, 1, 1]), [34, 33, 33]);
  assert.equal(sum(sharePercents([2.25, 2, 0.5, 0.75])), 100);
  assert.deepEqual(sharePercents([0, 0]), [null, null]);
});

test('allocationModel: values by spend, an Untagged row even when the server dropped it, Ask Worca last', () => {
  const m = allocationModel({ key: 'client', label: 'client', rows: fromStatsRows([
    { kind: 'value', label: 'globex', spentUsd: 2, runs: 1 },
    { kind: 'value', label: 'acme', spentUsd: 2.25, runs: 2 },
    { kind: 'ask', label: 'Ask Worca', spentUsd: 0.75, runs: 0 },
  ]) });
  assert.deepEqual(m.top.map((r) => r.label), ['acme', 'globex']);
  assert.deepEqual(m.tail.map((r) => [r.label, r.usd, r.runs]), [['Untagged', 0, 0], ['Ask Worca', 0.75, null]]);
  assert.equal(sum(visibleShares(m)), 100);
  assert.equal(m.totalUsd, 5);
  assert.equal(m.totalRuns, 3);
});

test('allocationModel: more than 8 values → top 7 and "Other (n)" whose share keeps the column at 100', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ key: `v${i}`, label: `v${i}`, usd: 10 - i, runs: 1, isNone: false }))
    .concat([{ key: '__none__', label: '(no cc)', usd: 3, runs: 2, isNone: true }]);
  const m = allocationModel({ key: 'cc', label: 'Cost centre', rows: fromBreakdownRows(rows) });
  assert.equal(m.top.length, ALLOC_TOP);
  assert.equal(m.other.label, 'Other (3)');
  assert.deepEqual(m.more.map((r) => r.label), ['v7', 'v8', 'v9']);
  assert.equal(m.other.usd, 6);
  assert.equal(sum(visibleShares(m)), 100);
  const eight = allocationModel({ key: 'cc', label: 'Cost centre', rows: fromBreakdownRows(rows.slice(2)) });
  assert.equal(eight.other, null);
  assert.equal(eight.top.length, 8);
});

test('renderAllocationTable: header, Untagged, a 100% total, a CSV link, and an Other toggle', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ kind: 'value', label: `v${i}`, usd: 9 - i, runs: 1 }));
  const card = renderAllocationTable(allocationModel({ key: 'cc', label: 'Cost centre', rows }), { doc, fmt, rangeLabel: 'Aug 1 – Aug 31' });
  assert.equal(card.querySelector('h2').textContent, 'Cost centre');
  assert.deepEqual([...card.querySelectorAll('thead th')].map((t) => t.textContent), ['Cost centre', 'Spend', 'Share', 'Runs']);
  const csv = card.querySelector('button.alloc-csv');
  assert.equal(csv.dataset.key, 'cc');
  assert.equal(csv.textContent, 'CSV');
  assert.equal([...card.querySelectorAll('tbody tr')].filter((r) => r.cells[0].textContent === 'Untagged').length, 1);
  const foot = card.querySelector('tfoot tr');
  assert.deepEqual([...foot.cells].map((c) => c.textContent), ['Total', '$45.00', '100%', '9']);
  const more = card.querySelectorAll('tr.alloc-more');
  assert.equal(more.length, 2);
  assert.ok([...more].every((r) => r.hidden));
  const toggle = card.querySelector('button.alloc-other-toggle');
  assert.equal(toggle.textContent, 'Other (2)');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok([...more].every((r) => !r.hidden));
});

test('renderAllocationTables: no tables → one empty card; a $0 table shows — shares', () => {
  const empty = renderAllocationTables([], { doc, fmt, empty: 'No tagged runs in this period.' });
  assert.equal(empty.querySelector('.chart-empty').textContent, 'No tagged runs in this period.');
  const zero = renderAllocationTable(allocationModel({ key: 'cc', label: 'cc', rows: [] }), { doc, fmt });
  assert.equal(zero.querySelector('tfoot tr').cells[2].textContent, '—');
});

test('allocationCsv: label, spendUsd, sharePct, runs; hidden rows included', () => {
  const m = allocationModel({ key: 'client', label: 'Client', rows: [{ kind: 'value', label: 'acme', usd: 3, runs: 2 }, { kind: 'none', label: '(no client)', usd: 1, runs: 1 }] });
  const csv = allocationCsv(m);
  assert.ok(csv.startsWith('\uFEFFClient,spendUsd,sharePct,runs\r\n'));
  assert.match(csv, /acme,3,75,2\r\nUntagged,1,25,1\r\n$/);
});
