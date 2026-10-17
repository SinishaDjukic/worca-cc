// src/shared/csv.mjs — the ONE CSV writer (RFC 4180). Browser-safe, no imports: team metrics and
// Statistics both export through it.

/** One cell: '' for null, a leading-quote guard against spreadsheet formulas, quotes when needed. */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;            // spreadsheet formula injection guard
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** header: string[]; rows: unknown[][] → CSV text with a BOM and CRLF line ends.
 *  BOM: Excel otherwise reads the file as the local code page and mangles non-ASCII text. */
export function rowsToCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
