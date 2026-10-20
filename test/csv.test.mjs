// test/csv.test.mjs — the generic CSV writer: BOM, CRLF, RFC 4180 quoting, formula guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, rowsToCsv } from '../src/shared/csv.mjs';

/** Minimal RFC 4180 reader (quoted fields, "" escapes, CRLF) — enough to prove a round trip. */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

test('rowsToCsv starts with the UTF-8 BOM bytes EF BB BF', () => {
  const bytes = Buffer.from(rowsToCsv(['a'], [['x']]), 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('a value with comma, ampersand and umlauts round-trips intact', () => {
  const csv = rowsToCsv(['client', 'spendUsd'], [['Müller & Söhne, GmbH', 1.5], ['say "hi"', 0]]);
  const decoded = Buffer.from(csv, 'utf8').toString('utf8').replace(/^﻿/, '');
  assert.ok(csv.endsWith('\r\n'));
  assert.deepEqual(parseCsv(decoded), [['client', 'spendUsd'], ['Müller & Söhne, GmbH', '1.5'], ['say "hi"', '0']]);
});

test('csvCell guards formulas and leaves null empty', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

test('csvCell keeps negative numbers as numbers; strings that start with "-" stay guarded', () => {
  assert.equal(csvCell(-15), '-15');
  assert.equal(csvCell(-0.5), '-0.5');
  assert.equal(csvCell('-SUM(A1)'), "'-SUM(A1)");
  assert.equal(csvCell('=1+1'), "'=1+1");
});
