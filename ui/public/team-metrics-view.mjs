// ui/public/team-metrics-view.mjs
// Team metrics page renderers (team-metrics-design.md §4.10; mockup boards 1–3). Pure DOM:
// every function takes an aggregate() result (src/shared/team-metrics/aggregate.mjs) and
// returns detached elements. app.js owns fetch, mounting and delegated events.
import { niceScale, roundedTopBar } from './stats-view.mjs';
import { safeHttpUrl } from '../../src/shared/team-metrics/aggregate.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Series palette (mockup legend order): blue-ink, amber-ink, violet-ink, green-ink, red-ink, ink-3. */
export const SERIES_COLORS = ['var(--blue-ink)', 'var(--amber-ink)', 'var(--violet-ink)', 'var(--green-ink)', 'var(--red-ink)', 'var(--ink-3)'];
const RESULT_STACKS = [
  { key: 'done', label: 'Done', color: 'var(--green-ink)' },
  { key: 'failed', label: 'Failed', color: 'var(--red-ink)' },
  { key: 'stopped', label: 'Stopped', color: 'var(--ink-3)' },
];
const PREV_WORD = { 'this-month': 'month', 'last-month': 'month', quarter: 'quarter', year: 'year', custom: 'period' };

export const TM_FMT = {
  usd: (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  duration: (ms) => {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  },
  pct: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`),
  day: (iso) => { const d = new Date(iso); return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}`; },
};

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function s(doc, tag, attrs = {}) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

export function renderScopeOptions(select, scopes, selectedId, { doc = globalThis.document } = {}) {
  select.replaceChildren();
  const groups = [['Projects', scopes.projects || []], ['Workspaces', scopes.workspaces || []]];
  let any = false;
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const g = h(doc, 'optgroup'); g.label = label;
    for (const it of items) {
      const o = h(doc, 'option', null, it.label);
      o.value = it.id;
      if (it.recordedIn) o.title = `recorded in ${it.recordedIn}`;
      g.append(o);
    }
    select.append(g);
    any = true;
  }
  if (!any) {
    const o = h(doc, 'option', null, 'Nothing is recording yet'); o.value = '';
    select.append(o);
  }
  select.disabled = !any;
  select.value = any ? selectedId : '';
}

function ago(iso, now) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

/** Topbar right slot: "Synced 2 min ago | 3 runs pending push | Refresh | Push now". */
export function renderSyncChip({ sync = [], stats = {}, refresh = null, fetchError = null }, { doc = globalThis.document, now = Date.now() } = {}) {
  const chip = h(doc, 'div', 'sync-chip-inner');
  const pending = sync.reduce((a, x) => a + (x.pending || 0), 0);
  const lastError = sync.map((x) => x.lastError).find(Boolean) || null;
  const pushHintText = sync.map((x) => x.hint).find(Boolean) || null;
  // Newest of BOTH stamps: `lastSyncAt || fetchedAt` showed the last push even when a newer fetch
  // had just run, so the chip could claim "Synced 2 h ago" right after a successful refresh.
  const synced = sync.flatMap((x) => [x.lastSyncAt, x.fetchedAt]).filter(Boolean).sort().pop() || null;
  const tone = lastError || fetchError ? 'red' : pending ? 'amber' : 'green';
  chip.append(h(doc, 'span', `dot ${tone}`));
  const txt = h(doc, 'span', 'sync-text');
  txt.append(synced ? 'Synced ' : 'Not synced yet');
  if (synced) txt.append(h(doc, 'b', null, ago(synced, now)));
  if (pending) { txt.append(' | '); txt.append(h(doc, 'b', null, String(pending)), ` run${pending === 1 ? '' : 's'} pending push`); }
  if (stats.unknownV) txt.append(` | ${stats.unknownV} records need a newer Worca`);
  // Only when the throttle actually skipped the fetch: a throttled refresh that still did its
  // regular 60 s fetch serves fresh data, and "refresh again in N s" would be a lie.
  if (refresh?.limited && !refresh.fetched) txt.append(` | refresh again in ${Math.ceil(refresh.retryInMs / 1000)} s`);
  chip.append(txt);
  const refreshBtn = h(doc, 'button', 'btn-ghost btn-mini tm-refresh', 'Refresh'); refreshBtn.type = 'button';
  const pushBtn = h(doc, 'button', 'btn-ghost btn-mini tm-push-now', 'Push now'); pushBtn.type = 'button';
  pushBtn.disabled = pending === 0;
  chip.append(refreshBtn, pushBtn);
  const err = lastError || fetchError;
  if (err) {
    // §4.7: the stderr verbatim. <pre> + white-space:pre-wrap, so a multi-line remote: block is
    // readable instead of collapsed to its first line.
    const e = h(doc, 'pre', 'hint mono tm-sync-error', String(err).trim());
    e.title = String(err);
    chip.append(e);
  }
  // §4.7 also asks for the "exempt worca-metrics" hint next to the stderr, as on the Projects cell.
  if (pushHintText) chip.append(h(doc, 'small', 'hint tm-sync-hint', pushHintText));
  return chip;
}

function deltaChip(doc, text, title) {
  if (text == null) return null;
  const c = h(doc, 'span', 'stat-delta', text);
  if (title) c.title = title;
  return c;
}
const signedPct = (v) => (v == null ? null : `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`);

/** The six mockup tile glyphs, path data verbatim from boards 1–2 (`svg.stat-ico`). */
const TILE_ICONS = Object.freeze({
  spend: ['M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3'],
  runs: ['M5 20v-7M12 20V4M19 20v-11'],
  costPerRun: ['circle:12,12,8', 'M12 8v8M9.5 10.5h5'],
  duration: ['circle:12,12,8', 'M12 8v4l3 2'],
  autonomy: ['M4 12h4l2-5 4 10 2-5h4'],
  cycles: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v4h4'],
});
function tileIcon(doc, key) {
  const svg = s(doc, 'svg', { class: 'stat-ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const d of TILE_ICONS[key] || []) {
    if (d.startsWith('circle:')) { const [cx, cy, r] = d.slice(7).split(','); svg.append(s(doc, 'circle', { cx, cy, r })); }
    else svg.append(s(doc, 'path', { d }));
  }
  return svg;
}

function tile(doc, { label, chip, value, sub, meterPct = null, icon = null }) {
  const card = h(doc, 'section', 'card stat-tile');
  const lab = h(doc, 'div', 'stat-label');
  if (icon) lab.append(tileIcon(doc, icon));
  lab.append(h(doc, 'span', null, label));
  if (chip) lab.append(chip);
  card.append(lab, h(doc, 'div', 'stat-value mono', value));
  if (meterPct != null) {
    const m = h(doc, 'span', 'stat-meter');
    const f = h(doc, 'span', 'stat-meter-fill'); f.style.width = `${Math.max(0, Math.min(100, meterPct))}%`;
    m.append(f); card.append(m);
  }
  const subEl = h(doc, 'small', 'stat-sub');
  for (const part of sub) subEl.append(typeof part === 'string' ? part : h(doc, 'b', null, part.b));
  card.append(subEl);
  return card;
}

export function renderTmKpiRow(agg, { doc = globalThis.document, now = Date.now(), scopeKind = 'project' } = {}) {
  const k = agg.kpis;
  const d = agg.deltas;
  const prevTitle = PREV_WORD[agg.range.range] ? `vs prev. ${PREV_WORD[agg.range.range]}` : null;
  const withTitle = (t) => (t && prevTitle ? `${t} ${prevTitle}` : t);
  const row = h(doc, 'div', 'stat-row tm-kpis');
  const month = MONTH_FULL[new Date(now).getUTCMonth()];
  // spendThisMonthUsd is computed over the current calendar month regardless of the selected
  // range, so it is only meaningful when "now" actually falls inside that range — e.g. for
  // range=last-month every record predates the current month and the sub-line would always
  // read "$0.00 so far in <this month>" under a correct, non-zero Spend headline.
  const nowInRange = (agg.range.startMs == null || now >= agg.range.startMs) && (agg.range.endMs == null || now < agg.range.endMs);
  row.append(tile(doc, {
    icon: 'spend', label: 'Spend', chip: deltaChip(doc, d && withTitle(signedPct(d.spendPct))), value: TM_FMT.usd(k.spendUsd),
    sub: scopeKind === 'workspace'
      ? ['attributed to the workspace, not to single projects']
      : nowInRange ? [{ b: TM_FMT.usd(k.spendThisMonthUsd) }, ` so far in ${month}`] : [],
  }));
  row.append(tile(doc, {
    icon: 'runs', label: 'Runs', chip: deltaChip(doc, d && signedPct(d.runsPct)), value: String(k.runs),
    sub: [{ b: String(k.done) }, ` done · ${k.failed} failed · ${k.stopped} stopped · `, { b: TM_FMT.pct(k.successRate) }, ' success'],
  }));
  const costSub = ['median ', { b: TM_FMT.usd(k.costPerRunMedianUsd) }, ` · P90 ${TM_FMT.usd(k.costPerRunP90Usd)}`];
  if (k.runsWithPr) costSub.push(` · with a PR ${TM_FMT.usd(k.costPerRunWithPrUsd)}`);
  row.append(tile(doc, { icon: 'costPerRun', label: 'Cost per run', chip: deltaChip(doc, d && signedPct(d.costPerRunPct)), value: k.costPerRunUsd == null ? '—' : TM_FMT.usd(k.costPerRunUsd), sub: costSub }));
  row.append(tile(doc, {
    icon: 'duration', label: 'Duration', chip: deltaChip(doc, d && signedPct(d.durationPct)), value: TM_FMT.duration(k.durationMedianMs),
    sub: ['median wall-clock · ', { b: TM_FMT.duration(k.machineMs) }, ' machine time in total'],
  }));
  row.append(tile(doc, {
    icon: 'autonomy', label: 'Autonomy', chip: deltaChip(doc, d && d.autonomyPts != null ? `${d.autonomyPts >= 0 ? '+' : '−'}${Math.abs(d.autonomyPts)} pts` : null),
    value: TM_FMT.pct(k.autonomy), meterPct: k.autonomy == null ? 0 : k.autonomy * 100,
    sub: ['active ÷ wall-clock · ', { b: k.interventionsPerRun == null ? '—' : String(k.interventionsPerRun) }, ' interventions per run'],
  }));
  row.append(tile(doc, {
    icon: 'cycles', label: 'Review cycles', chip: deltaChip(doc, d && d.reviewCycles != null ? `${d.reviewCycles >= 0 ? '+' : '−'}${Math.abs(d.reviewCycles)}` : null),
    value: k.reviewCyclesMean == null ? '—' : String(k.reviewCyclesMean),
    sub: ['mean implement→review loops · ', { b: TM_FMT.pct(k.convergeInOneRate) }, ' converge in one'],
  }));
  return row;
}

const CW = 560, CH = 240, L = 44, R = 12, T = 18, B = 26;
const PW = CW - L - R, PH = CH - T - B;

/** Stacked weekly column chart. stacks: [{key,label,color}], valueOf(pt,key) → number. */
export function renderStackedWeekChart({ title, weeks, stacks, valueOf, yFmt, tipFmt = yFmt, legendValue, hint = null, integer = false }, { doc = globalThis.document } = {}) {
  const card = h(doc, 'section', 'card chart-card');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', null, title));
  card.append(head);
  const legend = h(doc, 'div', 'chart-legend');
  for (const st of stacks) {
    const item = h(doc, 'span', 'lg-item');
    const sw = h(doc, 'span', 'lg-swatch'); sw.style.background = st.color;
    item.append(sw, `${st.label} `, h(doc, 'b', 'mono', legendValue(st)));
    legend.append(item);
  }
  card.append(legend);
  if (!weeks.length) { card.append(h(doc, 'div', 'chart-empty hint', 'No runs in this range')); return card; }
  const totals = weeks.map((pt) => stacks.reduce((a, st) => a + (valueOf(pt, st.key) || 0), 0));
  const { step, top } = niceScale(Math.max(...totals, 0), integer);
  const yOf = (v) => T + PH - (v / top) * PH;
  const svg = s(doc, 'svg', { class: 'chart-svg', viewBox: `0 0 ${CW} ${CH}`, 'aria-label': title });
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg.append(s(doc, 'line', { x1: L, y1: yOf(v), x2: CW - R, y2: yOf(v), stroke: v === 0 ? 'var(--line-2)' : 'var(--line)', 'stroke-width': 1 }));
    const t = s(doc, 'text', { x: L - 6, y: yOf(v) + 3.5, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--ink-3)' });
    // class="ch-ytick" as in stats-view.mjs chartScaffold (:415-455) — the Stats stylesheet already
    // styles that class, and without it the new charts render their ticks unstyled.
    t.setAttribute('class', 'ch-ytick');
    t.textContent = yFmt(v); svg.append(t);
  }
  const band = PW / weeks.length;
  const every = weeks.length <= 10 ? 1 : Math.ceil(weeks.length / 8);
  weeks.forEach((pt, i) => {
    const bx = L + i * band;
    const w = Math.max(1, Math.min(24, band - 4));   // band - 4 goes negative past ~126 weeks ("All time")
    let acc = 0;
    const tipLines = [];
    for (const st of stacks) {
      const v = valueOf(pt, st.key) || 0;
      if (v <= 0) continue;
      const y0 = yOf(acc + v), y1 = yOf(acc);
      const isTop = stacks.slice(stacks.indexOf(st) + 1).every((o) => !(valueOf(pt, o.key) > 0));
      svg.append(s(doc, 'path', { d: isTop ? roundedTopBar(bx + (band - w) / 2, y0, w, y1 - y0) : `M${bx + (band - w) / 2},${y1} v${y0 - y1} h${w} v${y1 - y0} Z`, fill: st.color }));
      acc += v;
      // TM_FMT.usd, not yFmt: the axis formatter rounds to whole dollars for tick labels, so a
      // $4.12 week read "Auto: $4" and anything under $0.50 read "$0". Ticks keep yFmt.
      tipLines.push(`${st.label}: ${tipFmt(v)}`);
    }
    if (i % every === 0 || i === weeks.length - 1) {
      const t = s(doc, 'text', { x: bx + band / 2, y: CH - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--ink-3)' });
      t.textContent = TM_FMT.day(new Date(pt.weekStartMs).toISOString()); svg.append(t);
    }
    const hit = s(doc, 'rect', { class: 'ch-hit', x: bx, y: T, width: band, height: PH, tabindex: 0, role: 'img', 'aria-label': `Week of ${TM_FMT.day(new Date(pt.weekStartMs).toISOString())}: ${tipLines.join(', ') || 'none'}` });
    hit.dataset.tip = `Week of ${TM_FMT.day(new Date(pt.weekStartMs).toISOString())}\n${tipLines.join('\n') || 'No runs'}`;
    svg.append(hit);
  });
  const fig = h(doc, 'figure', 'chart-fig'); fig.append(svg); card.append(fig);
  // Parity with stats-view.mjs chartScaffold (:415-455): an sr-only table is the accessible
  // equivalent of the bars. Without it the whole series is unreachable to a screen reader, which
  // would be a regression against the page this one is modelled on.
  const srt = h(doc, 'table', 'sr-only');
  const srh = h(doc, 'tr');
  for (const c of ['Week', ...stacks.map((st) => st.label)]) srh.append(h(doc, 'th', null, c));
  srt.append(srh);
  for (const pt of weeks) {
    const tr = h(doc, 'tr');
    tr.append(h(doc, 'td', null, TM_FMT.day(new Date(pt.weekStartMs).toISOString())));
    for (const st of stacks) tr.append(h(doc, 'td', null, tipFmt(valueOf(pt, st.key) || 0)));
    srt.append(tr);
  }
  card.append(srt);
  if (hint) card.append(h(doc, 'small', 'hint', hint));
  return card;
}

const BREAKDOWN_SPECS = {
  workflow: { title: 'By workflow', sub: 'share of spend', cols: [['label', 'Workflow'], ['runs', 'Runs'], ['usd', 'Spend'], ['perRunUsd', 'Per run'], ['successRate', 'Success'], ['share', '']] },
  source: { title: 'By ticket', sub: 'task source · top 5', limit: 5, cols: [['label', 'Source'], ['runs', 'Runs'], ['usd', 'Spend'], ['perRunUsd', 'Per run'], ['cyclesMean', 'Cycles']] },
  actor: { title: 'By actor', sub: 'who ran it', cols: [['label', 'Actor'], ['runs', 'Runs'], ['usd', 'Spend'], ['perRunUsd', 'Per run'], ['successRate', 'Success']] },
  project: { title: 'By project touched', sub: 'a run touching two projects counts in both', cols: [['label', 'Project'], ['runs', 'Runs touched'], ['usd', 'Spend of those runs'], ['filesChanged', 'Files changed']] },
  models: { title: 'By model mix', sub: 'models seen in the run', cols: [['label', 'Models'], ['runs', 'Runs'], ['usd', 'Spend'], ['perRunUsd', 'Per run']] },
};

function cellText(key, row) {
  switch (key) {
    case 'usd': case 'perRunUsd': return row[key] == null ? '—' : TM_FMT.usd(row[key]);
    case 'successRate': return TM_FMT.pct(row[key]);
    case 'cyclesMean': return row[key] == null ? '—' : String(row[key]);
    default: return String(row[key] ?? '—');
  }
}

export function renderBreakdownTable(dim, rows, { doc = globalThis.document, sort = null, activeKey = null, homeSlug = null } = {}) {
  const spec = BREAKDOWN_SPECS[dim];
  const card = h(doc, 'section', 'card chart-card tm-breakdown');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', null, spec.title), h(doc, 'small', 'hint', spec.sub));
  card.append(head);
  const table = h(doc, 'table', 'tm-tbl');
  table.dataset.dim = dim;
  const thr = h(doc, 'tr');
  for (const [key, label] of spec.cols) {
    const th = h(doc, 'th', key === 'label' ? null : 'num', label);
    if (label) { th.dataset.sort = key; th.setAttribute('role', 'button'); th.tabIndex = 0; }
    if (sort && sort.key === key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    thr.append(th);
  }
  const thead = h(doc, 'thead');
  thead.append(thr);
  table.append(thead);
  let sorted = [...rows];
  if (sort && sort.key) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => (a.isNone - b.isNone) || (a[sort.key] > b[sort.key] ? dir : a[sort.key] < b[sort.key] ? -dir : 0));
  }
  if (spec.limit) sorted = sorted.filter((r) => !r.isNone).slice(0, spec.limit).concat(sorted.filter((r) => r.isNone));
  const tbody = h(doc, 'tbody');
  for (const r of sorted) {
    const tr = h(doc, 'tr', `${r.isNone ? 'dim' : ''}${activeKey === r.key ? ' on' : ''}`.trim() || null);
    tr.dataset.filterDim = dim;
    tr.dataset.filterKey = r.key;
    tr.tabIndex = 0;
    for (const [key] of spec.cols) {
      const td = h(doc, 'td', key === 'label' ? null : 'num mono');
      if (key === 'label') {
        td.append(h(doc, 'span', null, r.label));
        if (r.sub) td.append(' ', h(doc, 'small', 'hint', r.sub));
        if (dim === 'project' && homeSlug && r.key === homeSlug) td.append(' ', h(doc, 'span', 'badge violet', 'metrics home'));
      } else if (key === 'share') {
        const bar = h(doc, 'span', 'tm-share'); const fill = h(doc, 'span', 'tm-share-fill');
        fill.style.width = `${Math.round(r.share * 100)}%`; bar.append(fill); td.append(bar);
      } else td.textContent = cellText(key, r);
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (!sorted.length) {
    // `.hint{display:block}` (style.css:355) on a <td> takes the cell out of table layout and the
    // row collapses. Keep the class on an inner <small>.
    const tr = h(doc, 'tr'); const td = h(doc, 'td'); td.colSpan = spec.cols.length;
    td.append(h(doc, 'small', 'hint', 'No runs in this range')); tr.append(td); tbody.append(tr);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

export function renderRunsTable(runs, { doc = globalThis.document, total = runs.length, limit = 50 } = {}) {
  const card = h(doc, 'section', 'card tm-runs');
  const head = h(doc, 'div', 'card-head tm-runs-head');
  const title = h(doc, 'h2', null, 'Runs ');
  title.append(h(doc, 'small', 'hint', `${total} in range`));
  const exp = h(doc, 'button', 'btn-ghost btn-mini tm-export', 'Export CSV'); exp.type = 'button'; exp.disabled = total === 0;
  head.append(title, exp);
  card.append(head);
  if (!runs.length) { card.append(h(doc, 'div', 'chart-empty hint', 'No runs recorded in this range')); return card; }
  const table = h(doc, 'table', 'tm-tbl tm-run-tbl');
  const thead = h(doc, 'thead'); const thr = h(doc, 'tr');
  for (const c of ['Title', 'Workflow', 'Result', 'Cost', 'Duration', 'Cycles', 'PR', 'Actor', 'Started']) thr.append(h(doc, 'th', null, c));
  thead.append(thr); table.append(thead);
  const tbody = h(doc, 'tbody');
  for (const r of runs.slice(0, limit)) {
    const tr = h(doc, 'tr');
    tr.append(h(doc, 'td', 'tm-title', r.title));
    tr.append(h(doc, 'td', null, r.workflow ?? '—'));
    const res = h(doc, 'td'); res.append(h(doc, 'span', `badge ${r.result === 'done' ? 'green' : r.result === 'failed' ? 'red' : 'grey'}`, r.result)); tr.append(res);
    tr.append(h(doc, 'td', 'mono num', TM_FMT.usd(r.usd)));
    tr.append(h(doc, 'td', 'mono num', TM_FMT.duration(r.wallMs)));
    tr.append(h(doc, 'td', 'mono num', r.reviewCycles == null ? '—' : String(r.reviewCycles)));
    const pr = h(doc, 'td', 'mono');
    const href = safeHttpUrl(r.pr?.url); // defence in depth: toRunRow already dropped non-http(s) URLs
    if (href) { const a = h(doc, 'a', null, r.pr.number != null ? `#${r.pr.number}` : 'PR'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; pr.append(a); }
    else pr.textContent = r.pr?.number != null ? `#${r.pr.number}` : '—';
    tr.append(pr);
    tr.append(h(doc, 'td', null, r.actor ?? '—'));
    tr.append(h(doc, 'td', 'mono', TM_FMT.day(r.startedAt)));
    tbody.append(tr);
  }
  table.append(tbody); card.append(table);
  const shown = Math.min(limit, runs.length);
  const foot = h(doc, 'div', 'tm-runs-foot');
  foot.append(h(doc, 'small', 'hint', `Showing ${shown} of ${total} · newest first`));
  // §4.9 asks for "every record in range". The mockup's first paint is capped for layout, so the
  // remaining rows must stay REACHABLE on screen, not only through Export CSV.
  if (shown < runs.length) {
    const more = h(doc, 'button', 'btn-ghost btn-mini tm-show-all', `Show all ${runs.length} runs`);
    more.type = 'button';
    foot.append(more);
  }
  card.append(foot);
  return card;
}

export function renderTeamMetricsBody(agg, { doc = globalThis.document, now = Date.now(), scopeKind = 'project', sort = {}, filter = {}, homeHint = null, runLimit = 50 } = {}) {
  const wrap = h(doc, 'div', 'tm-body');
  if (homeHint) wrap.append(homeHint);
  wrap.append(renderTmKpiRow(agg, { doc, now, scopeKind }));
  const charts = h(doc, 'div', 'charts-grid');
  const stacks = agg.series.stackKeys.map((st, i) => ({ ...st, color: SERIES_COLORS[Math.min(i, SERIES_COLORS.length - 1)] }));
  charts.append(renderStackedWeekChart({
    title: 'Spend per week', weeks: agg.series.spend, stacks, valueOf: (pt, key) => pt.stacks[key],
    yFmt: (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`), tipFmt: TM_FMT.usd, legendValue: (st) => TM_FMT.usd(st.totalUsd),
    hint: agg.groupBy === 'project' && scopeKind === 'workspace' ? 'Stacked by project touched · a run touching two projects is split evenly here' : null,
  }, { doc }));
  const runTotals = Object.fromEntries(RESULT_STACKS.map((r) => [r.key, agg.series.runs.reduce((a, p) => a + (p[r.key] || 0), 0)]));
  charts.append(renderStackedWeekChart({
    title: 'Runs per week', weeks: agg.series.runs, stacks: RESULT_STACKS, valueOf: (pt, key) => pt[key],
    yFmt: (v) => String(Math.round(v)), legendValue: (st) => String(runTotals[st.key]), integer: true,
  }, { doc }));
  wrap.append(charts);
  const tables = h(doc, 'div', 'charts-grid tm-breakdowns');
  const dims = scopeKind === 'workspace' ? ['project', 'workflow', 'source', 'actor', 'models'] : ['workflow', 'source', 'actor', 'models'];
  for (const dim of dims) {
    const rows = agg.breakdowns[dim];
    if (!rows) continue;
    tables.append(renderBreakdownTable(dim, rows, { doc, sort: sort[dim] || null, activeKey: filter[dim] ?? null, homeSlug: agg.homeSlug ?? null }));
  }
  wrap.append(tables);
  wrap.append(renderRunsTable(agg.runs, { doc, total: agg.runs.length, limit: runLimit }));
  return wrap;
}

export function renderTmEmptyState({ doc = globalThis.document } = {}) {
  const grid = h(doc, 'div', 'empty tm-empty');
  const card = (step, title, body, href, label, primary) => {
    const c = h(doc, 'section', 'card');
    c.append(h(doc, 'div', 'tm-step', step), h(doc, 'h3', null, title));
    const p = h(doc, 'p', 'hint');
    for (const part of body) p.append(typeof part === 'string' ? part : h(doc, 'code', 'mono', part.code));
    const a = h(doc, 'a', primary ? 'btn btn-primary btn-mini' : 'btn btn-ghost btn-mini', label); a.href = href;
    c.append(p, a);
    return c;
  };
  grid.append(
    card('01 · PROJECT', 'Enable team metrics on a project',
      ['Creates a ', { code: 'worca-metrics' }, " branch on the project's origin. Every finished run is pushed there as one small file, from every teammate's machine. Nothing is added to your code branches."], '#projects', 'Go to Projects', true),
    card('02 · WORKSPACE', 'Pick a metrics home for a workspace',
      ['Workspace runs touch several repositories, so their cost is attributed to the workspace and written to one member you choose. The choice lives on this machine and can be changed on the workspace card.'], '#workspaces', 'Go to Workspaces', false),
  );
  const foot = h(doc, 'small', 'hint tm-empty-foot', "Already enabled by a teammate? Worca checks each project's origin for the branch on start and every hour. ");
  const check = h(doc, 'button', 'linkish tm-check-now', 'Check now'); check.type = 'button';
  foot.append(check);
  const out = h(doc, 'div');
  out.append(grid, foot);
  return out;
}
