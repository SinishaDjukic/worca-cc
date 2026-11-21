// ui/public/artifacts/office-sheet.mjs — spreadsheets for the simplified Office preview: .xlsx and .ods → value tables, one per
// visible sheet, at most limits.maxRows × limits.maxCols, trailing empties trimmed. Shown values follow the common number
// formats (dates and times, percent, fixed decimals, thousands separators), fixed to en-US and UTC; any other format
// shows the raw number. Pure over a CappedZip and the stage window's DOMParser.
import { attr, descendants, kid, kids, odfText, relId, relsOf, resolvePart } from './office-xml.mjs';
import { OfficeLiteError } from './office-zip.mjs';

/** Excel's built-in number formats we show (id → code). 14 is ISO on purpose (Excel localises it). */
export const BUILTIN_NUMFMTS = Object.freeze({
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'yyyy-mm-dd hh:mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0',
});

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const general = (v) => String(Number(v.toPrecision(15)));
const group = (s) => {
  const [int, frac] = s.split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac == null ? g : `${g}.${frac}`;
};

/** The first section of a format code with quoted literals, backslash escapes and [Red]-style brackets removed
 *  (the elapsed-time brackets [h] [mm] [ss] stay). */
function cleanCode(code) {
  let s = '';
  let inQuote = false;
  const c = String(code);
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (inQuote) { if (ch === '"') inQuote = false; continue; }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === '\\') { i += 1; continue; }
    if (ch === '_' || ch === '*') { i += 1; continue; }        // padding directives
    if (ch === ';') break;
    if (ch === '[') {
      const end = c.indexOf(']', i);
      const inner = end < 0 ? '' : c.slice(i + 1, end);
      if (/^(h+|m+|s+)$/i.test(inner)) s += `[${inner.toLowerCase()}]`;
      i = end < 0 ? c.length : end;
      continue;
    }
    s += ch;
  }
  return s.trim();
}

const DATE_TOKEN = /^(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|\[h+\]|\[m+\]|\[s+\]|\.0+)/i;

function formatDate(v, code, date1904) {
  const tokens = [];
  for (let i = 0; i < code.length;) {
    const m = DATE_TOKEN.exec(code.slice(i));
    if (m) { tokens.push({ t: m[1].toLowerCase(), lit: false }); i += m[1].length; } else { tokens.push({ t: code[i], lit: true }); i += 1; }
  }
  const real = tokens.filter((k) => !k.lit);
  // m / mm after an hour or before a second is minutes.
  for (let k = 0; k < real.length; k++) {
    if (real[k].t !== 'm' && real[k].t !== 'mm') continue;
    const prev = real[k - 1]?.t || '';
    const next = real[k + 1]?.t || '';
    if (/^(h|hh|\[h+\])$/.test(prev) || /^(s|ss|\[s+\])$/.test(next)) real[k].minute = true;
  }
  const frac = real.find((k) => k.t.startsWith('.'));
  const digits = frac ? Math.min(3, frac.t.length - 1) : 0;
  const unit = 1000 / 10 ** digits;
  const ms = Math.round((v * 86400000) / unit) * unit;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30) + (v < 61 ? 86400000 : 0);
  const d = new Date(epoch + ms);
  const ampm = real.some((k) => k.t === 'am/pm' || k.t === 'a/p');
  const h24 = d.getUTCHours();
  const h = ampm ? (h24 % 12 || 12) : h24;
  let out = '';
  for (const k of tokens) {
    if (k.lit) { out += k.t; continue; }
    switch (k.t) {
      case 'yyyy': out += pad(d.getUTCFullYear(), 4); break;
      case 'yy': out += pad(d.getUTCFullYear() % 100); break;
      case 'mmmmm': out += MONTHS[d.getUTCMonth()][0]; break;
      case 'mmmm': out += MONTHS[d.getUTCMonth()]; break;
      case 'mmm': out += MONTHS[d.getUTCMonth()].slice(0, 3); break;
      case 'mm': out += k.minute ? pad(d.getUTCMinutes()) : pad(d.getUTCMonth() + 1); break;
      case 'm': out += k.minute ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1); break;
      case 'dddd': out += DAYS[d.getUTCDay()]; break;
      case 'ddd': out += DAYS[d.getUTCDay()].slice(0, 3); break;
      case 'dd': out += pad(d.getUTCDate()); break;
      case 'd': out += String(d.getUTCDate()); break;
      case 'hh': out += pad(h); break;
      case 'h': out += String(h); break;
      case 'ss': out += pad(d.getUTCSeconds()); break;
      case 's': out += String(d.getUTCSeconds()); break;
      case 'am/pm': out += h24 < 12 ? 'AM' : 'PM'; break;
      case 'a/p': out += h24 < 12 ? 'A' : 'P'; break;
      default:
        if (k.t.startsWith('.')) out += `.${pad(d.getUTCMilliseconds(), 3).slice(0, digits)}`;
        else if (k.t.startsWith('[h')) out += pad(Math.floor(ms / 3600000), k.t.length - 2);
        else if (k.t.startsWith('[m')) out += pad(Math.floor(ms / 60000), k.t.length - 2);
        else if (k.t.startsWith('[s')) out += pad(Math.floor(ms / 1000), k.t.length - 2);
    }
  }
  return out;
}

/** A number as a cell shows it under `code` (D12). */
export function formatCell(value, code, { date1904 = false } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v)) return String(value);
  const raw = String(code ?? '').trim();
  if (raw === '' || /^general$/i.test(raw)) return general(v);
  const c = cleanCode(raw);
  if (c === '' || /^general$/i.test(c)) return general(v);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (!/[0#?]/.test(c) && /[ydhsm]|am\/pm/i.test(c)) {
    if (v < 0) return general(v);
    return formatDate(v, c, date1904);
  }
  let m = /^0(?:\.(0+))?%$/.exec(c);
  if (m) return sign + (a * 100).toFixed(m[1] ? m[1].length : 0) + '%';
  m = /^0(?:\.(0+))?$/.exec(c);
  if (m) return sign + a.toFixed(m[1] ? m[1].length : 0);
  m = /^#,##0(?:\.(0+))?$/.exec(c);
  if (m) return sign + group(a.toFixed(m[1] ? m[1].length : 0));
  return general(v);
}

/** Collects cells, never past the limits; a non-empty cell past them sets the cut flag. */
function grid(limits) {
  const cells = new Map();
  let lastRow = -1;
  let lastCol = -1;
  const g = { cutRows: false, cutCols: false };
  g.set = (r, c, text) => {
    if (text === '' || text == null) return;
    const pastRows = r >= limits.maxRows;
    const pastCols = c >= limits.maxCols;
    if (pastRows) g.cutRows = true;
    if (pastCols) g.cutCols = true;
    if (pastRows || pastCols) return;
    cells.set(r * limits.maxCols + c, text);
    if (r > lastRow) lastRow = r;
    if (c > lastCol) lastCol = c;
  };
  g.finish = (name) => {
    const rows = [];
    for (let r = 0; r <= lastRow; r++) {
      const row = [];
      for (let c = 0; c <= lastCol; c++) row.push(cells.get(r * limits.maxCols + c) ?? '');
      rows.push(row);
    }
    return { name, rows, cutRows: g.cutRows, cutCols: g.cutCols };
  };
  return g;
}

const cellRef = (ref) => {
  const m = /^([A-Z]+)(\d+)$/i.exec(String(ref || ''));
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
};
const runText = (el) => {
  const t = kid(el, 't');
  if (t) return t.textContent;
  return kids(el, 'r').map((r) => kid(r, 't')?.textContent ?? '').join('');
};

/** .xlsx → SheetModel. */
export async function readXlsx(zip, DOMParserCtor, limits) {
  const WB = 'xl/workbook.xml';
  if (!zip.has(WB)) throw new OfficeLiteError('UNREADABLE', 'no workbook');
  const wb = (await zip.xml(WB, DOMParserCtor)).documentElement;
  const date1904 = /^(1|true)$/i.test(attr(kid(wb, 'workbookPr'), 'date1904') || '');
  const rels = await relsOf(zip, WB, DOMParserCtor);
  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    for (const si of kids((await zip.xml('xl/sharedStrings.xml', DOMParserCtor)).documentElement, 'si')) shared.push(runText(si));
  }
  const custom = new Map();
  const xfs = [];
  if (zip.has('xl/styles.xml')) {
    const st = (await zip.xml('xl/styles.xml', DOMParserCtor)).documentElement;
    for (const f of kids(kid(st, 'numFmts'), 'numFmt')) custom.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') || '');
    for (const xf of kids(kid(st, 'cellXfs'), 'xf')) xfs.push(Number(attr(xf, 'numFmtId') || 0));
  }
  const codeOf = (s) => {
    const id = xfs[Number(s) || 0] ?? 0;
    return custom.has(id) ? custom.get(id) : (BUILTIN_NUMFMTS[id] ?? 'General');
  };
  const sheets = [];
  for (const sh of kids(kid(wb, 'sheets'), 'sheet')) {
    if (/^(hidden|veryHidden)$/.test(attr(sh, 'state') || '')) continue;
    const rel = rels.get(relId(sh) || '');
    if (!rel || rel.external) continue;
    const path = resolvePart(WB, rel.target);
    if (!zip.has(path)) continue;
    const root = (await zip.xml(path, DOMParserCtor)).documentElement;
    const g = grid(limits);
    let r = -1;
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      const rn = Number(attr(row, 'r'));
      r = Number.isInteger(rn) && rn > 0 ? rn - 1 : r + 1;
      let c = -1;
      for (const cell of kids(row, 'c')) {
        const ref = cellRef(attr(cell, 'r'));
        c = ref ? ref.c : c + 1;
        const t = attr(cell, 't') || 'n';
        const v = kid(cell, 'v')?.textContent ?? '';
        let text;
        if (t === 's') text = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') text = runText(kid(cell, 'is'));
        else if (t === 'b') text = v === '1' || /^true$/i.test(v) ? 'TRUE' : v === '' ? '' : 'FALSE';
        else if (t === 'str' || t === 'e' || t === 'd') text = v;
        else text = v === '' ? '' : formatCell(Number(v), codeOf(attr(cell, 's')), { date1904 });
        g.set(r, c, text);
      }
    }
    sheets.push(g.finish(attr(sh, 'name') || `Sheet ${sheets.length + 1}`));
  }
  return { format: 'sheet', sheets };
}

const intAttr = (el, local) => Math.max(1, Number.parseInt(attr(el, local), 10) || 1);

/** .ods → SheetModel. Repeated rows and columns advance the index without materialising past the caps. */
export async function readOds(zip, DOMParserCtor, limits) {
  if (!zip.has('content.xml')) throw new OfficeLiteError('UNREADABLE', 'no content');
  const root = (await zip.xml('content.xml', DOMParserCtor)).documentElement;
  const hiddenStyles = new Set();
  for (const s of descendants(kid(root, 'automatic-styles'), 'style')) {
    if (attr(s, 'family') === 'table' && attr(kid(s, 'table-properties'), 'display') === 'false') hiddenStyles.add(attr(s, 'name'));
  }
  const book = kid(kid(root, 'body'), 'spreadsheet');
  const sheets = [];
  for (const table of kids(book, 'table')) {
    if (attr(table, 'display') === 'false' || hiddenStyles.has(attr(table, 'style-name'))) continue;
    const g = grid(limits);
    let r = 0;
    const walkRows = (el) => {
      for (const node of [...el.childNodes].filter((n) => n.nodeType === 1)) {
        if (node.localName === 'table-row') {
          const repeat = intAttr(node, 'number-rows-repeated');
          const cells = [];
          let c = 0;
          for (const cell of [...node.childNodes].filter((n) => n.nodeType === 1)) {
            if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue;
            const span = intAttr(cell, 'number-columns-repeated');
            const ps = kids(cell, 'p');
            const text = ps.length ? ps.map((p) => odfText(p)).join('\n') : (attr(cell, 'value') ?? '');
            if (text !== '') cells.push([c, span, text]);
            c += span;
          }
          if (cells.length) {
            const rowsHere = Math.min(repeat, Math.max(0, limits.maxRows - r) + 1);
            for (let k = 0; k < rowsHere; k++) {
              for (const [c0, span, text] of cells) {
                const colsHere = Math.min(span, Math.max(0, limits.maxCols - c0) + 1);
                for (let j = 0; j < colsHere; j++) g.set(r + k, c0 + j, text);
              }
            }
          }
          r += repeat;
        } else if (/^table-(row-group|header-rows|rows)$/.test(node.localName)) {
          walkRows(node);
        }
      }
    };
    walkRows(table);
    sheets.push(g.finish(attr(table, 'name') || `Sheet ${sheets.length + 1}`));
  }
  return { format: 'sheet', sheets };
}
