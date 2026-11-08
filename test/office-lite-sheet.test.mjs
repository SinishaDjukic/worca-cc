// test/office-lite-sheet.test.mjs — the simplified preview's spreadsheet readers (ui/public/artifacts/office-sheet.mjs):
// visible sheets in order, shown values (D12's number formats, fixed to en-US), the 1,000 × 100 cut, ODS repeats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { readXlsx, readOds, formatCell, colName, BUILTIN_NUMFMTS } from '../ui/public/artifacts/office-sheet.mjs';
import { openCappedZip } from '../ui/public/artifacts/office-zip.mjs';
import { OFFICE_LITE_LIMITS } from '../src/shared/artifact-kinds.mjs';
import { fixture } from './helpers/office-lite-fixtures.mjs';

const JSZip = createRequire(import.meta.url)('jszip');
const { DOMParser } = new JSDOM('').window;
const L = OFFICE_LITE_LIMITS;
const open = (name, limits = L) => openCappedZip(JSZip, fixture(name), limits);

test('T-X1 budget.xlsx: visible sheets in order (the hidden one skipped), shared/rich/inline strings, booleans, errors, str formulas', async () => {
  const m = await readXlsx(await open('budget.xlsx'), DOMParser, L);
  assert.equal(m.format, 'sheet');
  assert.deepEqual(m.sheets.map((s) => s.name), ['Budget', 'Notes']);
  const [budget, notes] = m.sheets;
  assert.deepEqual(budget.rows[0], ['Item', 'Rich text', 'Inline', 'TRUE', 'FALSE', '#DIV/0!', 'Hello', '']);
  assert.deepEqual(budget.rows[1], ['1,234', '12%', '2026-01-15', '13:05:09', '2026-01-15 12:00', '3.14', '12345.678', '0.3']);
  assert.deepEqual(budget.rows[2].slice(0, 2), ['Total', '7'], 'cells without r take the next column');
  assert.deepEqual(budget.rows[3], ['', '', '', '', '', '', '', ''], 'an absent row is an empty row');
  assert.deepEqual(budget.rows[4].slice(0, 2), ['', '42']);
  assert.equal(budget.rows.length, 5);
  assert.equal(budget.cutRows || budget.cutCols, false);
  assert.deepEqual(notes.rows, [['Second sheet']]);
  assert.ok(!JSON.stringify(m).includes('PHONETIC'), 'phonetic runs are skipped');
  assert.ok(!JSON.stringify(m).includes('Secret'));
});

test('T-X2 formatCell: General, fixed, thousands, percent, dates and times, 1904, the 1900 leap bug, raw fallbacks', () => {
  const rows = [
    [0.30000000000000004, 'General', '0.3'], [1234.5, '', '1234.5'], [3.14159, '0.00', '3.14'], [2.5, '0', '3'],
    [1234567, '#,##0', '1,234,567'], [-1234.5, '#,##0.00', '-1,234.50'], [999.996, '#,##0.00', '1,000.00'],
    [0.12, '0%', '12%'], [0.1234, '0.00%', '12.34%'],
    [46037, BUILTIN_NUMFMTS[14], '2026-01-15'], [0.54524305555555552, BUILTIN_NUMFMTS[21], '13:05:09'],
    [46037.5, 'yyyy-mm-dd hh:mm', '2026-01-15 12:00'], [46037.5, BUILTIN_NUMFMTS[22], '2026-01-15 12:00'],
    [46037, 'mmm d, yyyy', 'Jan 15, 2026'], [46037, 'dddd, mmmm dd, yy', 'Thursday, January 15, 26'],
    [46037.75, 'h:mm AM/PM', '6:00 PM'], [46037.25, 'hh:mm:ss AM/PM', '06:00:00 AM'], [46037.0, 'h:mm AM/PM', '12:00 AM'],
    [0.0104166666666667, 'mm:ss', '15:00'], [1.5, '[h]:mm:ss', '36:00:00'], [46037, 'm/d/yyyy', '1/15/2026'],
    [59, 'yyyy-mm-dd', '1900-02-28'], [61, 'yyyy-mm-dd', '1900-03-01'], [1, 'yyyy-mm-dd', '1900-01-01'],
    [12345.678, '0.00E+00', '12345.678'], [5, '# ?/?', '5'],
    [1234.5, '"$"#,##0.00', '1,234.50'], [-3, '[Red]0.00', '-3.00'], [42, '0.00\\ "kg"', '42.00'],
    [7, '0.00;(0.00)', '7.00'], [-7, '0.00;(0.00)', '-7.00'],
  ];
  for (const [v, code, want] of rows) assert.equal(formatCell(v, code, { date1904: false }), want, `${v} ${code}`);
  assert.equal(formatCell(0, 'yyyy-mm-dd', { date1904: true }), '1904-01-01');
  assert.equal(formatCell(44575, 'yyyy-mm-dd', { date1904: true }), '2026-01-15');
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(104), 'DA');
  for (const id of [0, 1, 2, 3, 4, 9, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]) assert.equal(typeof BUILTIN_NUMFMTS[id], 'string', `built-in ${id}`);
});

test('T-X3 wide.xlsx: 1,000 × 100 kept and both cuts flagged; a sheet exactly at the limits is not cut', async () => {
  const m = await readXlsx(await open('wide.xlsx'), DOMParser, L);
  const s = m.sheets[0];
  assert.equal(s.rows.length, 1, 'only row 1 holds data inside the limits');
  assert.equal(s.rows[0][0], '1');
  assert.equal(s.cutRows, true);
  assert.equal(s.cutCols, true);
  const exact = await readXlsx(await open('wide.xlsx'), DOMParser, { ...L, maxRows: 1005, maxCols: 105 });
  const e = exact.sheets[0];
  assert.equal(e.rows.length, 1005);
  assert.equal(e.rows[1004].length, 105);
  assert.equal(e.rows[1004][104], 'far');
  assert.equal(e.cutRows || e.cutCols, false);
  const rowsOnly = (await readXlsx(await open('wide.xlsx'), DOMParser, { ...L, maxRows: 1000, maxCols: 105 })).sheets[0];
  assert.deepEqual([rowsOnly.cutRows, rowsOnly.cutCols], [true, false]);
});

test('T-X4 table.ods: repeated columns expand, the trailing 1,048,000 empty rows are never built, a covered cell keeps its place', async () => {
  const m = await readOds(await open('table.ods'), DOMParser, L);
  assert.deepEqual(m.sheets.map((s) => s.name), ['Data', 'Second'], 'a sheet whose table style says display=false is skipped');
  const d = m.sheets[0];
  assert.deepEqual(d.rows, [
    ['Name', 'x', 'x', 'x'],
    ['1,234.50', '', '', ''],
    ['1,234.50', '', '', ''],
    ['Wide', '', '3', 'line one\nline two'],
  ]);
  assert.equal(d.cutRows || d.cutCols, false);
  const cut = (await readOds(await open('table.ods'), DOMParser, { ...L, maxRows: 2, maxCols: 2 })).sheets[0];
  assert.deepEqual(cut.rows, [['Name', 'x'], ['1,234.50', '']]);
  assert.deepEqual([cut.cutRows, cut.cutCols], [true, true]);
});

test('T-X5 cell text that looks like markup renders as text in the simplified preview (td.textContent, no img)', async () => {
  const { renderOfficeLite } = await import('../ui/public/artifacts/office-lite.mjs');
  const { officeVendor } = await import('./helpers/office-vendor.mjs');
  const { respond } = await import('./helpers/office-lite-fixtures.mjs');
  const SML = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const z = new JSZip();
  z.file('xl/workbook.xml', `<workbook ${SML}><sheets><sheet name="&lt;b&gt;S" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  z.file('xl/worksheets/sheet1.xml', `<worksheet ${SML}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lt;img src=x onerror=alert(1)&gt;</t></is></c></row></sheetData></worksheet>`);
  const bytes = await z.generateAsync({ type: 'uint8array' });
  const { window: win } = new JSDOM('<!doctype html><body><div id="s"></div></body>', { runScripts: 'outside-only', url: 'http://localhost:4317/' });
  const vendor = officeVendor(win);
  const stage = win.document.getElementById('s');
  const out = await renderOfficeLite({ name: 'evil.xlsx', stage, url: '/evil', downloadUrl: '/evil?download=1', fetch: async () => respond(bytes), deps: { officeImport: vendor.importer } });
  assert.equal(out.state, 'shown');
  assert.equal(stage.querySelector('table.olp-table tbody td').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(stage.querySelector('img'), null);
  assert.equal(stage.querySelector('[role="tab"]').textContent, '<b>S');
  assert.equal(stage.querySelector('b'), null);
});

test('T-X5 ODS: a non-empty cell repeated a billion times across, and a row repeated a billion times down, stop at the caps', async () => {
  const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const X = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const content = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="${T}" xmlns:text="${X}">`
    + '<office:body><office:spreadsheet><table:table table:name="S">'
    + '<table:table-row><table:table-cell table:number-columns-repeated="1000000000"><text:p>wide</text:p></table:table-cell></table:table-row>'
    + '<table:table-row table:number-rows-repeated="1000000000"><table:table-cell><text:p>tall</text:p></table:table-cell></table:table-row>'
    + '</table:table></office:spreadsheet></office:body></office:document-content>';
  const z = new JSZip();
  z.file('content.xml', content);
  const zip = await openCappedZip(JSZip, await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), L);
  const limits = { ...L, maxRows: 10, maxCols: 10 };
  const before = process.cpuUsage();
  const m = await readOds(zip, DOMParser, limits);
  const cpu = process.cpuUsage(before);
  assert.ok((cpu.user + cpu.system) / 1000 < 1500, `${(cpu.user + cpu.system) / 1000} ms of CPU`);
  const [sheet] = m.sheets;
  assert.equal(sheet.cutRows, true);
  assert.equal(sheet.cutCols, true);
  assert.equal(sheet.rows.length, 10);
  assert.deepEqual(sheet.rows[0], Array(10).fill('wide'));
  assert.deepEqual(sheet.rows[9].slice(0, 2), ['tall', '']);
});
