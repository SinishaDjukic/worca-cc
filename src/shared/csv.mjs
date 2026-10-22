// src/shared/csv.mjs — the ONE CSV writer (RFC 4180). Browser-safe, no imports: team metrics and
// Statistics both export through it.

/** One cell: '' for null, a leading-quote guard against spreadsheet formulas, quotes when needed. */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // spreadsheet formula injection guard; a finite number cannot carry a formula, and a negative Saved must stay numeric
  if (!(typeof v === 'number' && Number.isFinite(v)) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** header: string[]; rows: unknown[][] → CSV text with a BOM and CRLF line ends.
 *  BOM: Excel otherwise reads the file as the local code page and mangles non-ASCII text. */
export function rowsToCsv(header, rows) {
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
