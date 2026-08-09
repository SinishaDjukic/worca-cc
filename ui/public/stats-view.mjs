// ui/public/stats-view.mjs
// Pure DOM renderers for the Statistics view, the sidebar budget indicator,
// the Settings budget readout, and the cost-pause banners. Every function
// takes the target `document` via opts (defaults to the browser global) and
// returns DETACHED elements — no fetch, no listeners outside the returned
// tree. app.js owns endpoint calls and mounting; node:test drives these via
// jsdom. Interactive elements carry data-* + routing classes (cb-override,
// cb-settings, ch-hit, data-nav) so app.js wires delegated listeners.
// Formatters are injected via opts.fmt = { usd, usd4, duration, estTitle };
// DEFAULT_FMT keeps pure tests standalone.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Spend meter turns amber at 80% of the total limit (display-only). */
export const BUDGET_WARN_AT = 0.8;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DEFAULT_FMT = {
  usd: (n) => `$${(Math.round(((n || 0) + Number.EPSILON) * 100) / 100).toFixed(2)}`,
  usd4: (n) => `$${(n || 0).toFixed(4)}`,
  duration: (ms) => {
    const s = Math.floor((ms || 0) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  },
  estTitle: (n) => `Estimated cost $${(n || 0).toFixed(4)} — Claude Code client-side estimate (total_cost_usd), not authoritative billing`,
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

/** 16px stroke icon matching the app's nav glyph style. */
function icon(doc, d) {
  const svg = s(doc, 'svg', {
    class: 'stat-ico', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.9',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  svg.appendChild(s(doc, 'path', { d }));
  return svg;
}

const ICONS = {
  spent: 'M12 4v16M16 6.8c-.8-1-2.2-1.6-4-1.6-2.2 0-3.8 1-3.8 2.7 0 3.6 7.8 1.7 7.8 5.4 0 1.7-1.7 2.9-4 2.9-1.9 0-3.4-.7-4.2-1.8',
  time: 'M12 8v4l3 2M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
  finished: 'M20 7 9 18l-5-5',
  prs: 'M6 8.6v6.8M18 15.4V11a4 4 0 0 0-4-4h-2M6 3.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM6 15.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM18 15.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z',
};

function fmtResetAt(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtIn(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

const periodWord = (b) => (b && b.resetPeriod === 'weekly' ? 'week' : 'month');

/** Neutral delta chip "↑ 23%" vs the previous window; null when not meaningful. */
function deltaChip(doc, cur, prevVal, range) {
  if (range === 'all' || prevVal == null || !(prevVal > 0)) return null;
  const pct = Math.round(((cur - prevVal) / prevVal) * 100);
  const chip = h(doc, 'span', 'stat-delta', `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`);
  chip.title = range === 'today' ? 'vs yesterday'
    : range === 'week' ? 'vs previous week' : 'vs previous month';
  return chip;
}

// Numeric tokens in tile sub-lines ($50.00, 3d 4h, bare counts) get <b> so the
// figures read at a glance; surrounding prose stays plain. Unit groups like
// "3d 4h" bold as one token.
const SUB_NUM_RE = /\$[\d,.]+|\d+[a-z]+(?: \d+[a-z]+)*|\d+/g;
function subEl(doc, str) {
  const el = h(doc, 'small', 'stat-sub');
  let last = 0;
  for (const m of str.matchAll(SUB_NUM_RE)) {
    if (m.index > last) el.appendChild(doc.createTextNode(str.slice(last, m.index)));
    el.appendChild(h(doc, 'b', null, m[0]));
    last = m.index + m[0].length;
  }
  if (last < str.length) el.appendChild(doc.createTextNode(str.slice(last)));
  return el;
}

function tile(doc, { iconD, label, chip, valueNodes, meter, sub, title }) {
  const card = h(doc, 'section', 'card stat-tile');
  if (title) card.title = title;
  const lab = h(doc, 'div', 'stat-label');
  lab.appendChild(icon(doc, iconD));
  lab.appendChild(h(doc, 'span', null, label));
  if (chip) lab.appendChild(chip);
  card.appendChild(lab);
  const value = h(doc, 'div', 'stat-value mono');
  for (const n of valueNodes) value.appendChild(n);
  card.appendChild(value);
  if (meter) card.appendChild(meter);
  if (sub) card.appendChild(subEl(doc, sub));
  return card;
}

function meterEl(doc, cls, pct) {
  const m = h(doc, 'span', cls);
  const fill = h(doc, 'span', `${cls}-fill`);
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  m.appendChild(fill);
  return m;
}

/** KPI row: Spent · Time worked · Pipelines finished · PRs merged (spec §6.13). */
export function renderKpiRow(model, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const { totals, prev, budget, range } = model;
  const row = h(doc, 'div', 'stat-row');

  // Spent. `totals.spentUsd` follows the SELECTED RANGE, while totalLimitUsd and
  // msUntilReset are scoped to the budget RESET WINDOW — so metering one against the
  // other, and printing "resets in…" beside it, is truthful only while the range IS
  // that window. Under a mismatch ('All time', or Month with a weekly reset) the bar
  // pins at 100% and the copy is nonsense, so the tile drops the meter and states the
  // window's own spend explicitly instead.
  const limit = budget ? budget.totalLimitUsd : null;
  const windowRange = budget && budget.resetPeriod === 'weekly' ? 'week' : 'month';
  const limitInRange = limit != null && range === windowRange;
  const spentMeter = limitInRange
    ? (() => {
        const m = meterEl(doc, 'stat-meter', (totals.spentUsd / limit) * 100);
        m.setAttribute('role', 'img');
        m.setAttribute('aria-label', `${Math.round((totals.spentUsd / limit) * 100)}% of total limit used`);
        return m;
      })()
    : null;
  row.appendChild(tile(doc, {
    iconD: ICONS.spent, label: 'Spent',
    chip: prev ? deltaChip(doc, totals.spentUsd, prev.spentUsd, range) : null,
    valueNodes: [doc.createTextNode(fmt.usd(totals.spentUsd))],
    meter: spentMeter,
    sub: limit == null
      ? 'No total limit set'
      : limitInRange
        ? `of ${fmt.usd(limit)} · resets in ${fmtIn(budget.msUntilReset)}`
        : `this ${windowRange}: ${fmt.usd(budget.windowSpendUsd)} of ${fmt.usd(limit)}`,
    title: fmt.estTitle(totals.spentUsd),
  }));

  // Time worked
  row.appendChild(tile(doc, {
    iconD: ICONS.time, label: 'Time worked',
    chip: prev ? deltaChip(doc, totals.workedMs, prev.workedMs, range) : null,
    valueNodes: [doc.createTextNode(fmt.duration(totals.workedMs))],
    sub: `across ${totals.runs} run${totals.runs === 1 ? '' : 's'}`,
  }));

  // Pipelines finished
  const finVal = [doc.createTextNode(`${totals.finished} `), h(doc, 'span', 'stat-frac', `/ ${totals.runs}`)];
  const bits = [];
  if (totals.stopped) bits.push(`${totals.stopped} stopped`);
  if (totals.failed) bits.push(`${totals.failed} failed`);
  if (totals.paused) bits.push(`${totals.paused} paused`);
  if (totals.running) bits.push(`${totals.running} running now`);
  row.appendChild(tile(doc, {
    iconD: ICONS.finished, label: 'Pipelines finished',
    chip: prev ? deltaChip(doc, totals.finished, prev.finished, range) : null,
    valueNodes: finVal,
    sub: bits.length ? bits.join(' · ') : 'no stopped or failed runs',
  }));

  // PRs merged
  row.appendChild(tile(doc, {
    iconD: ICONS.prs, label: 'PRs merged',
    chip: prev ? deltaChip(doc, totals.prsMerged, prev.prsMerged, range) : null,
    valueNodes: [doc.createTextNode(`${totals.prsMerged} `), h(doc, 'span', 'stat-frac', `/ ${totals.prsOpened}`)],
    sub: 'opened in this period',
  }));

  return row;
}

/** Sidebar spend indicator (whole block navigates to #stats). */
export function renderBudgetIndicator(budget, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const b = budget || {};
  const btn = h(doc, 'button', 'spend-ind');
  btn.type = 'button';
  btn.dataset.nav = 'stats';
  const ratio = b.totalLimitUsd != null ? b.windowSpendUsd / b.totalLimitUsd : 0;
  if (b.blocked) btn.classList.add('over');
  else if (b.totalLimitUsd != null && ratio >= BUDGET_WARN_AT) btn.classList.add('warn');
  btn.title = `Estimated spend this ${periodWord(b)}: ${fmt.usd4(b.windowSpendUsd)}` +
    (b.totalLimitUsd != null ? ` of ${fmt.usd(b.totalLimitUsd)}` : '') +
    ` · resets ${fmtResetAt(b.windowEndMs)} — Claude Code client-side estimate (total_cost_usd), not authoritative billing`;
  const rowEl = h(doc, 'span', 'spend-ind-row');
  rowEl.appendChild(h(doc, 'span', 'spend-ind-label', `Spent this ${periodWord(b)}`));
  rowEl.appendChild(h(doc, 'span', 'spend-ind-amt mono', fmt.usd(b.windowSpendUsd)));
  btn.appendChild(rowEl);
  if (b.totalLimitUsd != null) {
    btn.appendChild(meterEl(doc, 'spend-ind-meter', b.blocked ? 100 : ratio * 100));
    if (b.blocked) btn.appendChild(h(doc, 'small', 'spend-ind-sub', 'limit reached · new runs blocked'));
  } else {
    btn.appendChild(h(doc, 'small', 'spend-ind-sub', 'no total limit'));
  }
  return btn;
}

/** Settings budget readout: meter + one summary line. */
export function renderBudgetReadout(budget, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const b = budget || {};
  const wrap = h(doc, 'div', 'budget-readout');
  if (b.totalLimitUsd != null) {
    wrap.appendChild(meterEl(doc, 'spend-ind-meter',
      b.blocked ? 100 : (b.windowSpendUsd / b.totalLimitUsd) * 100));
  }
  const line = h(doc, 'div', 'budget-readout-line');
  line.appendChild(doc.createTextNode('Spent '));
  line.appendChild(h(doc, 'b', 'mono', fmt.usd(b.windowSpendUsd)));
  if (b.totalLimitUsd != null) {
    line.appendChild(doc.createTextNode(' of '));
    line.appendChild(h(doc, 'b', 'mono', fmt.usd(b.totalLimitUsd)));
  }
  line.appendChild(doc.createTextNode(
    ` this ${periodWord(b)} · resets in ${fmtIn(b.msUntilReset)} (${fmtResetAt(b.windowEndMs)})`));
  wrap.appendChild(line);
  return wrap;
}

/** Cost-pause banner for run/history cards. rec = {pauseReason, pipelineId,
 *  totalCostUsd}; opts.budget supplies limits + window figures. */
export function renderCostPauseBanner(rec, { doc = globalThis.document, fmt = DEFAULT_FMT, budget = null } = {}) {
  const b = budget || {};
  const kind = rec.pauseReason === 'cost_total' ? 'cb-total' : 'cb-pipeline';
  const el = h(doc, 'div', `cost-banner ${kind}`);
  const text = h(doc, 'div', 'cb-text');
  const actions = h(doc, 'div', 'cb-actions');
  const settingsBtn = h(doc, 'button', 'btn btn-mini cb-settings', 'Open Settings');
  settingsBtn.type = 'button';

  if (kind === 'cb-pipeline') {
    el.appendChild(h(doc, 'b', null, 'Paused — pipeline cost limit reached'));
    text.appendChild(doc.createTextNode("This pipeline's estimated cost hit "));
    text.appendChild(h(doc, 'span', 'mono', fmt.usd(rec.totalCostUsd || 0)));
    text.appendChild(doc.createTextNode(' of its '));
    text.appendChild(h(doc, 'span', 'mono', fmt.usd(b.pipelineLimitUsd || 0)));
    text.appendChild(doc.createTextNode(
      ' limit. Raise or clear the limit in Settings, or continue without a cap.'));
    el.appendChild(text);
    const override = h(doc, 'button', 'btn btn-primary btn-mini cb-override',
      'Continue without cap (this pipeline)');
    override.type = 'button';
    override.dataset.pipelineId = rec.pipelineId || '';
    actions.appendChild(settingsBtn);
    actions.appendChild(override);
  } else {
    el.appendChild(h(doc, 'b', null, 'Paused — total budget reached'));
    text.appendChild(doc.createTextNode('Estimated spend is '));
    text.appendChild(h(doc, 'span', 'mono', fmt.usd(b.windowSpendUsd || 0)));
    text.appendChild(doc.createTextNode(' of the '));
    text.appendChild(h(doc, 'span', 'mono', fmt.usd(b.totalLimitUsd || 0)));
    text.appendChild(doc.createTextNode(
      ` total limit this ${periodWord(b)}. Resumes are blocked until the budget resets ` +
      `${fmtResetAt(b.windowEndMs)}, or until you raise the total limit in Settings.`));
    el.appendChild(text);
    actions.appendChild(settingsBtn);
  }
  el.appendChild(actions);
  return el;
}

// ---------------------------------------------------------------------------
// Charts. Hand-rolled inline SVG: fixed logical viewBox 0 0 560 240 scaled by
// CSS; marks are thin columns with 4px rounded data-ends; grid is hairline
// solid var(--line); all chart text wears text tokens, never series colors.

const CW = 560, CH = 240, L = 44, R = 12, T = 18, B = 26;
const PW = CW - L - R, PH = CH - T - B;

/** Nice axis max + tick step for a data max (1/2/2.5/5 × 10^n ladder).
 *  integer=true (runs chart) keeps ticks on whole numbers — a sub-1 or ×2.5
 *  step on tiny count maxima would render duplicate rounded labels ("0, 1, 1"
 *  for a 1-run day) or off-grid labels ("3" at the 2.5 line). */
function niceScale(maxVal, integer = false) {
  const m = maxVal > 0 ? maxVal : 1;
  const raw = m / 3;                                   // aim for ~3-4 ticks
  const pow = 10 ** Math.floor(Math.log10(raw));
  const ladder = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = ladder.map((k) => k * pow).find((k) => k >= raw) || pow * 10;
  if (integer) step = Math.max(1, Math.round(step));
  return { step, top: Math.ceil(m / step) * step };
}

/** Column path with a rounded TOP only (square baseline). r clamps to h/2. */
function roundedTopBar(x, y, w, hgt, r = 4) {
  const rr = Math.max(0, Math.min(r, hgt / 2, w / 2));
  return `M${x},${y + hgt} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} ` +
    `Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + hgt} Z`;
}

function bucketLabel(ms, bucket) {
  const d = new Date(ms);
  if (bucket === 'month') return MO[d.getMonth()];
  if (bucket === 'hour') return `${String(d.getHours()).padStart(2, '0')}:00`;
  return d.getDay() === 1 || d.getDate() === 1 ? `${WD[d.getDay()]} ${d.getDate()}` : String(d.getDate());
}

function tipDate(ms, bucket) {
  const d = new Date(ms);
  if (bucket === 'hour') {
    return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:00`;
  }
  return bucket === 'month'
    ? `${MO[d.getMonth()]} ${d.getFullYear()}`
    : `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`;
}

function compactUsd(fmt, v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 10) return `$${Math.round(v)}`;
  return fmt.usd(v);
}

/** Shared chart scaffolding: svg + grid + x labels + hit rects + sr table. */
function chartScaffold(doc, spec, { yMax, yFmt, ariaLabel, srHead, srRow, tip, drawBucket, integerScale = false }) {
  const { series, bucket } = spec;
  const fig = h(doc, 'figure', 'chart-fig');
  const svg = s(doc, 'svg', { class: 'chart-svg', viewBox: `0 0 ${CW} ${CH}`, 'aria-label': ariaLabel });
  const { step, top } = niceScale(yMax, integerScale);
  const yOf = (v) => T + PH - (v / top) * PH;
  // gridlines + y ticks
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = yOf(v);
    svg.appendChild(s(doc, 'line', { x1: L, y1: y, x2: CW - R, y2: y,
      stroke: v === 0 ? 'var(--line-2)' : 'var(--line)', 'stroke-width': 1 }));
    const t = s(doc, 'text', { class: 'ch-ytick', x: L - 6, y: y + 3.5,
      'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--ink-3)' });
    t.textContent = yFmt(v);
    svg.appendChild(t);
  }
  const bandW = PW / series.length;
  const labelEvery = series.length <= 10 ? 1 : Math.ceil(series.length / 8);
  series.forEach((pt, i) => {
    const bx = L + i * bandW;
    const isCurrent = pt.bucketStartMs === spec.currentBucketStartMs;
    drawBucket({ svg, pt, i, bx, bandW, yOf, isCurrent });
    if (i % labelEvery === 0 || i === series.length - 1) {
      const t = s(doc, 'text', { x: bx + bandW / 2, y: CH - 8, 'text-anchor': 'middle',
        'font-size': 10.5, fill: 'var(--ink-3)' });
      t.textContent = bucketLabel(pt.bucketStartMs, bucket);
      svg.appendChild(t);
    }
    // full-height invisible hit target (tooltip + keyboard focus)
    const hit = s(doc, 'rect', { class: 'ch-hit', x: bx, y: T, width: bandW, height: PH,
      tabindex: 0, role: 'img', 'aria-label': tip(pt).replace(/\n/g, ', ') });
    hit.dataset.tip = `${tipDate(pt.bucketStartMs, bucket)}\n${tip(pt)}`;
    svg.appendChild(hit);
  });
  fig.appendChild(svg);
  // screen-reader table twin
  const table = h(doc, 'table', 'sr-only');
  const cap = h(doc, 'caption', null, `${ariaLabel}`);
  table.appendChild(cap);
  const thead = h(doc, 'thead');
  const hr = h(doc, 'tr');
  for (const c of srHead) hr.appendChild(h(doc, 'th', null, c));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = h(doc, 'tbody');
  for (const pt of series) {
    const tr = h(doc, 'tr');
    for (const c of srRow(pt)) tr.appendChild(h(doc, 'td', null, c));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  fig.appendChild(table);
  return fig;
}

function chartCard(doc, title, rangeLabel) {
  const card = h(doc, 'section', 'card chart-card');
  const head = h(doc, 'div', 'card-head');
  head.appendChild(h(doc, 'h2', null, title));
  if (rangeLabel) head.appendChild(h(doc, 'small', 'hint', rangeLabel));
  card.appendChild(head);
  return card;
}

const unitWord = (bucket) => (bucket === 'month' ? 'month' : bucket === 'hour' ? 'hour' : 'day');

/** Spend column chart: uniform blue columns; per-bucket values live in the tooltip + sr table. */
export function renderSpendChart(spec, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const card = chartCard(doc, `Spend per ${unitWord(spec.bucket)}`, spec.rangeLabel);
  const total = spec.series.reduce((a, p) => a + (p.spentUsd || 0), 0);
  const fig = chartScaffold(doc, spec, {
    yMax: Math.max(...spec.series.map((p) => p.spentUsd || 0), 0),
    yFmt: (v) => compactUsd(fmt, v),
    ariaLabel: `Spend per ${unitWord(spec.bucket)}, ${spec.rangeLabel}, total ${fmt.usd(total)}`,
    srHead: ['Bucket', 'Spend'],
    srRow: (pt) => [tipDate(pt.bucketStartMs, spec.bucket), fmt.usd(pt.spentUsd || 0)],
    tip: (pt) => fmt.usd(pt.spentUsd || 0),
    drawBucket: ({ svg, pt, bx, bandW, yOf }) => {
      const v = pt.spentUsd || 0;
      if (v <= 0) return;
      const w = Math.min(24, bandW - 4);
      const x = bx + (bandW - w) / 2;
      const y = yOf(v);
      svg.appendChild(s(doc, 'path', { d: roundedTopBar(x, y, w, T + PH - y),
        fill: 'var(--blue)' }));
    },
  });
  card.appendChild(fig);
  return card;
}

const OUTCOMES = [
  { key: 'finished', label: 'Finished', color: 'var(--green-ink)' },
  { key: 'stopped', label: 'Stopped', color: 'var(--amber)' },
  { key: 'failed', label: 'Failed', color: 'var(--red-ink)' },
];

/** Runs stacked column chart by outcome; legend carries the counts. */
export function renderRunsChart(spec, { doc = globalThis.document, fmt = DEFAULT_FMT } = {}) {
  const card = chartCard(doc, `Runs per ${unitWord(spec.bucket)}`, spec.rangeLabel);
  const sums = Object.fromEntries(OUTCOMES.map((o) => [o.key,
    spec.series.reduce((a, p) => a + (p[o.key] || 0), 0)]));
  const legend = h(doc, 'div', 'chart-legend');
  for (const o of OUTCOMES) {
    const item = h(doc, 'span', 'lg-item');
    const sw = h(doc, 'span', 'lg-swatch');
    sw.style.background = o.color;
    item.appendChild(sw);
    item.appendChild(doc.createTextNode(`${o.label} `));
    item.appendChild(h(doc, 'b', 'mono', String(sums[o.key])));
    legend.appendChild(item);
  }
  card.appendChild(legend);
  const totalRuns = sums.finished + sums.stopped + sums.failed;
  const fig = chartScaffold(doc, spec, {
    yMax: Math.max(...spec.series.map((p) => (p.finished || 0) + (p.stopped || 0) + (p.failed || 0)), 0),
    integerScale: true,
    yFmt: (v) => String(Math.round(v)),
    ariaLabel: `Runs per ${unitWord(spec.bucket)} by outcome, ${spec.rangeLabel}, ${totalRuns} runs`,
    srHead: ['Bucket', 'Finished', 'Stopped', 'Failed'],
    srRow: (pt) => [tipDate(pt.bucketStartMs, spec.bucket),
      String(pt.finished || 0), String(pt.stopped || 0), String(pt.failed || 0)],
    tip: (pt) => `${pt.finished || 0} finished\n${pt.stopped || 0} stopped\n${pt.failed || 0} failed`,
    drawBucket: ({ svg, pt, bx, bandW, yOf, isCurrent }) => {
      if (isCurrent) {
        svg.appendChild(s(doc, 'rect', { class: 'ch-currentband', x: bx, y: T,
          width: bandW, height: PH, fill: 'var(--field)' }));
      }
      const stack = OUTCOMES.map((o) => ({ ...o, v: pt[o.key] || 0 })).filter((o) => o.v > 0);
      if (!stack.length) return;
      const w = Math.min(24, bandW - 4);
      const x = bx + (bandW - w) / 2;
      let yCursor = T + PH;
      // heights from the shared y scale: yOf(v) maps value->y, so a segment of
      // value v has pixel height (T + PH - yOf(v)).
      stack.forEach((segSpec, idx) => {
        const hPx = T + PH - yOf(segSpec.v);
        const isTop = idx === stack.length - 1;
        const gap = isTop ? 0 : 2;                     // 2px surface gap between segments
        const y = yCursor - hPx;
        if (isTop) {
          const p = s(doc, 'path', { class: 'ch-seg',
            d: roundedTopBar(x, y, w, hPx), fill: segSpec.color });
          svg.appendChild(p);
        } else {
          svg.appendChild(s(doc, 'rect', { class: 'ch-seg', x, y: y + gap,
            width: w, height: Math.max(0, hPx - gap), fill: segSpec.color }));
        }
        yCursor = y;
      });
    },
  });
  card.appendChild(fig);
  return card;
}

/** Full Statistics body: KPI row + the two chart cards (or empty notes). */
export function renderStatsBody(model, opts = {}) {
  const { doc = globalThis.document } = opts;
  const wrap = h(doc, 'div', null);
  wrap.appendChild(renderKpiRow(model, opts));
  const grid = h(doc, 'div', 'charts-grid');
  const rangeLabel = model.range === 'all'
    ? 'last 12 months'
    : model.range === 'today'
      ? tipDate(model.windowStartMs, 'day')
      : `${tipDate(model.windowStartMs, 'day')} – ${tipDate(model.windowEndMs - 1, 'day')}`;
  const currentBucketStartMs = model.series.length
    ? model.series[model.series.length - 1].bucketStartMs : 0;
  if (!model.totals.runs && !model.series.some((p) => p.spentUsd > 0)) {
    const emptyText = model.range === 'all'
      ? 'No pipelines yet — run one from New pipeline.'
      : 'No runs in this period.';
    for (const title of ['Spend', 'Runs']) {
      const card = chartCard(doc, `${title} per ${unitWord(model.bucket)}`, rangeLabel);
      card.appendChild(h(doc, 'div', 'chart-empty hint', emptyText));
      grid.appendChild(card);
    }
  } else {
    grid.appendChild(renderSpendChart({ series: model.series, bucket: model.bucket,
      currentBucketStartMs, rangeLabel }, opts));
    grid.appendChild(renderRunsChart({ series: model.series, bucket: model.bucket,
      currentBucketStartMs, rangeLabel }, opts));
  }
  wrap.appendChild(grid);
  return wrap;
}
