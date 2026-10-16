// ui/public/tag-allocation.mjs — the "By tag" cost-allocation tables (#718 slice 4), shared by Statistics and
// Team metrics. Pure DOM like stats-view.mjs: detached elements, textContent only. The one listener it owns is
// the Other (n) toggle on its own table; app.js delegates the CSV link (button.alloc-csv[data-key]).
import { rowsToCsv } from '../../src/shared/csv.mjs';

export const ALLOC_MAX_ROWS = 8;   // more value rows than this → the top ALLOC_TOP plus "Other (n)"
export const ALLOC_TOP = 7;

const cents = (n) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const byLabel = (a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
const shareText = (s) => (s == null ? '—' : `${s}%`);

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Integer percents by largest remainder: they sum to exactly 100 when the total is > 0; all null at $0. */
export function sharePercents(amounts) {
  const vals = amounts.map((v) => Math.max(0, Number(v) || 0));
  const total = vals.reduce((a, v) => a + v, 0);
  if (!(total > 0)) return vals.map(() => null);
  const raw = vals.map((v) => (v / total) * 100);
  const out = raw.map((v) => Math.floor(v));
  let left = 100 - out.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; left > 0; j++, left--) out[order[j % order.length][1]] += 1;
  return out;
}

/** Statistics groups rows ({ kind, label, spentUsd, runs }) → allocation rows. */
export const fromStatsRows = (rows) => (rows || []).map((r) => ({
  kind: r.kind, label: r.label, usd: r.spentUsd || 0, runs: r.kind === 'ask' ? null : r.runs,
}));

/** Team-metrics breakdown rows ({ label, usd, runs, isNone }) → allocation rows. */
export const fromBreakdownRows = (rows) => (rows || []).map((r) => ({
  kind: r.isNone ? 'none' : 'value', label: r.label, usd: r.usd || 0, runs: r.runs,
}));

/**
 * One key's table: value rows by spend (top ALLOC_TOP + "Other (n)" past ALLOC_MAX_ROWS), then Untagged
 * (always, $0 when absent) and Ask Worca. Shares are over every row, so the visible column sums to 100.
 * @param {{ key: string, label: string, rows: { kind: 'value'|'none'|'ask', label: string, usd: number, runs: number|null }[] }} t
 */
export function allocationModel({ key, label, rows }) {
  const values = rows.filter((r) => r.kind === 'value').sort((a, b) => b.usd - a.usd || byLabel(a, b));
  const none = rows.find((r) => r.kind === 'none');
  const ask = rows.find((r) => r.kind === 'ask');
  const tail = [{ kind: 'none', label: 'Untagged', usd: none ? none.usd : 0, runs: none ? none.runs : 0 }]
    .concat(ask ? [{ kind: 'ask', label: ask.label, usd: ask.usd, runs: null }] : []);
  const all = values.concat(tail);
  const pct = sharePercents(all.map((r) => r.usd));
  const withShare = all.map((r, i) => ({ ...r, share: pct[i] }));
  const valueRows = withShare.slice(0, values.length);
  const fold = valueRows.length > ALLOC_MAX_ROWS;
  const more = fold ? valueRows.slice(ALLOC_TOP) : [];
  return {
    key, label,
    top: fold ? valueRows.slice(0, ALLOC_TOP) : valueRows,
    more,
    other: fold ? {
      label: `Other (${more.length})`,
      usd: cents(more.reduce((a, r) => a + r.usd, 0)),
      runs: more.reduce((a, r) => a + (r.runs || 0), 0),
      share: pct[0] == null ? null : more.reduce((a, r) => a + r.share, 0),
    } : null,
    tail: withShare.slice(values.length),
    totalUsd: cents(all.reduce((a, r) => a + r.usd, 0)),
    totalRuns: all.reduce((a, r) => a + (r.runs || 0), 0),
  };
}

function rowEl(doc, r, fmt, cls) {
  const tr = h(doc, 'tr', cls);
  tr.appendChild(h(doc, 'td', 'people-name', r.label));
  tr.appendChild(h(doc, 'td', 'num people-usd', fmt.usd(r.usd)));
  tr.appendChild(h(doc, 'td', 'num', shareText(r.share)));
  tr.appendChild(h(doc, 'td', 'num', r.runs == null ? '—' : String(r.runs)));
  return tr;
}

/** One allocationModel → section.card.alloc-card (title, range hint, CSV link, table with a Total footer). */
export function renderAllocationTable(m, { doc = globalThis.document, fmt, rangeLabel = '' } = {}) {
  const card = h(doc, 'section', 'card chart-card alloc-card');
  card.dataset.key = m.key;
  const head = h(doc, 'div', 'card-head');
  head.appendChild(h(doc, 'h2', null, m.label));
  if (rangeLabel) head.appendChild(h(doc, 'small', 'hint', rangeLabel));
  const csv = h(doc, 'button', 'linkish alloc-csv', 'CSV');
  csv.type = 'button';
  csv.dataset.key = m.key;
  csv.setAttribute('aria-label', `Download ${m.label} as CSV`);
  head.appendChild(csv);
  card.appendChild(head);

  const table = h(doc, 'table', 'people-table groups-table alloc-table');
  const hr = h(doc, 'tr', null);
  [m.label, 'Spend', 'Share', 'Runs'].forEach((t, i) => hr.appendChild(h(doc, 'th', i ? 'num' : null, t)));
  const thead = h(doc, 'thead', null); thead.appendChild(hr); table.appendChild(thead);
  const tbody = h(doc, 'tbody', null);
  for (const r of m.top) tbody.appendChild(rowEl(doc, r, fmt, null));
  if (m.other) {
    const tr = rowEl(doc, m.other, fmt, 'alloc-other');
    const btn = h(doc, 'button', 'linkish alloc-other-toggle', m.other.label);
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    tr.cells[0].replaceChildren(btn);
    tbody.appendChild(tr);
    const hidden = m.more.map((r) => { const x = rowEl(doc, r, fmt, 'alloc-more'); x.hidden = true; tbody.appendChild(x); return x; });
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      for (const x of hidden) x.hidden = !open;
    });
  }
  for (const r of m.tail) tbody.appendChild(rowEl(doc, r, fmt, r.kind === 'ask' ? 'groups-row-ask' : 'groups-row-none'));
  table.appendChild(tbody);
  const tfoot = h(doc, 'tfoot', null);
  const ft = h(doc, 'tr', null);
  ft.appendChild(h(doc, 'td', null, 'Total'));
  ft.appendChild(h(doc, 'td', 'num people-usd', fmt.usd(m.totalUsd)));
  ft.appendChild(h(doc, 'td', 'num', m.totalUsd > 0 ? '100%' : '—'));
  ft.appendChild(h(doc, 'td', 'num', String(m.totalRuns)));
  tfoot.appendChild(ft); table.appendChild(tfoot);
  const scroll = h(doc, 'div', 'people-scroll');
  scroll.appendChild(table);
  card.appendChild(scroll);
  return card;
}

/** Every key's table in a two-column grid; no tables → one card with `empty`. */
export function renderAllocationTables(tables, { doc = globalThis.document, fmt, rangeLabel = '', empty = 'No tagged runs in this range.' } = {}) {
  const grid = h(doc, 'div', 'charts-grid alloc-grid');
  if (!tables.length) {
    const card = h(doc, 'section', 'card chart-card alloc-card');
    card.appendChild(h(doc, 'p', 'chart-empty hint', empty));
    grid.appendChild(card);
    return grid;
  }
  for (const t of tables) grid.appendChild(renderAllocationTable(t, { doc, fmt, rangeLabel }));
  return grid;
}

/** One table as CSV (BOM + CRLF via rowsToCsv), including the rows folded into "Other (n)". */
export function allocationCsv(m) {
  const rows = [...m.top, ...m.more, ...m.tail];
  return rowsToCsv([m.label, 'spendUsd', 'sharePct', 'runs'], rows.map((r) => [r.label, r.usd, r.share ?? '', r.runs ?? '']));
}
