// ui/public/cost-report.mjs — Statistics › Cost: the Cost and value report (labels-cost-tags s3). KPIs, filter bar,
// Allocate by → then by, the stacked area chart, one expandable table, saved views, Download CSV. The math is
// src/shared/cost/allocation.mjs; this module paints and keeps the person's choices (per browser). app.js keeps ONE
// instance, so a refetch repaints the same chart and its areas morph.
import {
  allocate, allocationSeries, matchesFilters, dimensionOptions, valueOptions, valueLabel, formatShare, reportCsv,
} from '../../src/shared/cost/allocation.mjs';
import { statTile, statDeltaChip, STAT_ICONS, signedUsd, SAVED_NOTE, DEFAULT_FMT } from './stats-view.mjs';
import { flagOn } from './flags.mjs';
import { createAreaChart } from './cost-area-chart.mjs';
import { openDimensionPicker } from './cost-dimension-picker.mjs';
import { icon } from './icons.mjs';

export const COST_STATE_KEY = 'worca-cc.stats.cost.v1';
export const COST_VIEWS_KEY = 'worca-cc.stats.costViews.v1';
const MAX_VIEWS = 20;
const MAX_FILTERS = 10;
/** The table's columns after the row name: the head, and each cell's label when the rows stack on phones. */
const VALUE_HEADS = ['Share', 'AI spend', 'Human hours', 'Saved', '$ per hour', 'Runs'];

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(doc, cls, text, aria) {
  const b = h(doc, 'button', cls, text);
  b.type = 'button';
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}
function readJson(storage, key, fallback) {
  try { const v = JSON.parse(storage?.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; }
}
function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
const cleanFilters = (a) => (Array.isArray(a) ? a : [])
  .filter((f) => f && typeof f.dim === 'string' && (typeof f.value === 'string' || f.value === null))
  .map((f) => ({ dim: f.dim, value: f.value })).slice(0, MAX_FILTERS);
export const cleanState = (v) => ({
  by: typeof v?.by === 'string' ? v.by : '',
  thenBy: typeof v?.thenBy === 'string' ? v.thenBy : '',
  metric: v?.metric === 'hours' ? 'hours' : 'spend',
  filters: cleanFilters(v?.filters),
});

/** Saved views (per browser, clarified): [{ name, by, thenBy, metric, filters }], oldest first, at most 20. */
export function loadViews(storage, key = COST_VIEWS_KEY) {
  const list = readJson(storage, key, []);
  return (Array.isArray(list) ? list : [])
    .filter((v) => v && typeof v.name === 'string' && v.name.trim())
    .map((v) => ({ name: v.name.trim().slice(0, 60), ...cleanState(v) })).slice(-MAX_VIEWS);
}
/** Save (a name used before, in any case, is replaced) → the new list. */
export function saveView(storage, name, state, key = COST_VIEWS_KEY) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return loadViews(storage, key);
  const list = loadViews(storage, key).filter((v) => v.name.toLowerCase() !== n.toLowerCase());
  list.push({ name: n, ...cleanState(state) });
  writeJson(storage, key, list.slice(-MAX_VIEWS));
  return loadViews(storage, key);
}
export function deleteView(storage, name, key = COST_VIEWS_KEY) {
  const list = loadViews(storage, key).filter((v) => v.name !== name);
  writeJson(storage, key, list);
  return list;
}

/** The first policy dimension, else the cost tag key with the most spend, else Person. */
export function defaultBy(options) {
  return (options.find((o) => o.group === 'policy') || options.find((o) => o.group === 'other') || { id: 'person' }).id;
}

/**
 * @param {{ doc?, fmt?, storage?, reducedMotion?, onOpenRuns?: ((ids: string[]) => void)|null,
 *   onDownload(csv: string, name: string): void, stateKey?, viewsKey?, csvName?(state, key): string,
 *   extras?(ctx: { runs, model, by, byLabel }): { lead?: Node|null, tail?: Node[] } }} deps
 *   onOpenRuns null: the runs are not this machine's (Team metrics), so no run links and no "select unallocated".
 * @returns {{ el: HTMLElement, update({ data, dims, rangeLabel, range }): void, state: object }}
 */
export function createCostReport({ doc = globalThis.document, fmt = DEFAULT_FMT, storage = null, reducedMotion = false,
  onOpenRuns = () => {}, onDownload = () => {}, stateKey = COST_STATE_KEY, viewsKey = COST_VIEWS_KEY,
  csvName = (s, key) => `statistics-${s.range}-cost-${key}.csv`, extras = null, requirementsEnabled = undefined } = {}) {
  const canOpen = typeof onOpenRuns === 'function';
  const st = { ...cleanState(readJson(storage, stateKey, {})), view: '', expanded: new Set(),
    data: null, dims: [], rangeLabel: '', range: 'month' };
  const el = h(doc, 'div', 'cost-report');
  const kpis = h(doc, 'div', 'stat-row cr-kpis');
  const bar = h(doc, 'div', 'cr-bar');
  const controls = h(doc, 'div', 'cr-controls');
  const chart = createAreaChart({ doc, fmt, reducedMotion, onTagRuns: (ids) => { if (canOpen) onOpenRuns(ids); } });
  const chartCard = h(doc, 'section', 'card chart-card cr-chart-card');
  const chartHead = h(doc, 'div', 'card-head');
  chartCard.append(chartHead, chart.el);
  const tableCard = h(doc, 'section', 'card cr-table-card');
  const emptyCard = h(doc, 'section', 'card cr-empty-card');
  const leadEl = h(doc, 'div', 'cr-lead');
  const tailEl = h(doc, 'div', 'cr-tail');
  el.append(kpis, bar, controls, leadEl, chartCard, tableCard, tailEl, emptyCard);

  let options = [];
  let runs = [];
  let model = null;
  const rowsByPath = new Map();
  const persist = () => writeJson(storage, stateKey, cleanState(st));
  const dimLabel = (dim) => options.find((o) => o.id === dim)?.label || (dim.startsWith('tag:') ? dim.slice(4) : dim);
  const askOn = () => !st.filters.length && !!st.data?.report?.ask;
  // Requirements spend: like Chat's, but only while the requirements flag is on (as the Statistics tile).
  const reqOn = () => !st.filters.length && !!st.data?.report?.requirements
    && (requirementsEnabled ?? flagOn('requirements', doc));

  function paintKpis(prev) {
    const t = model.total;
    const none = model.rows.find((r) => r.kind === 'none');
    // The red lives on `.stat-tile .stat-value.is-neg` (style.css), as renderKpiRow's Saved tile sets it.
    const savedTile = statTile(doc, { iconD: STAT_ICONS.saved, label: 'Saved',
      valueNodes: [doc.createTextNode(signedUsd(fmt, t.savedUsd))], title: SAVED_NOTE });
    savedTile.querySelector('.stat-value').classList.toggle('is-neg', t.savedUsd < 0);
    kpis.replaceChildren(
      statTile(doc, { iconD: STAT_ICONS.spent, label: 'Spent', chip: prev && statDeltaChip(doc, t.spentUsd, prev.spentUsd, st.range),
        valueNodes: [doc.createTextNode(fmt.usd(t.spentUsd))] }),
      statTile(doc, { iconD: STAT_ICONS.time, label: 'Human hours', chip: prev && statDeltaChip(doc, t.humanHours, prev.humanHours, st.range),
        valueNodes: [doc.createTextNode(fmt.hours(t.humanHours))] }),
      savedTile,
      statTile(doc, { iconD: STAT_ICONS.spent, label: 'Cost per hour', valueNodes: [doc.createTextNode(t.usdPerHour == null ? '—' : `${fmt.usd(t.usdPerHour)}/h`)] }),
      statTile(doc, { iconD: STAT_ICONS.finished, label: 'Allocated',
        valueNodes: [doc.createTextNode(model.allocatedShare == null ? '—' : model.allocatedShare === 0 ? '0%' : formatShare(model.allocatedShare, 1))],
        sub: none ? `Unallocated ${fmt.usd(none.spentUsd)}` : '' }),
    );
  }

  function paintBar() {
    const chips = st.filters.map((f, i) => {
      const chip = h(doc, 'span', 'tag-chip cr-chip', `${dimLabel(f.dim)} = ${valueLabel(f.dim, f.value)}`);
      const x = btn(doc, 'tag-x cr-chip-x', null, `Remove filter ${dimLabel(f.dim)} = ${valueLabel(f.dim, f.value)}`);
      x.dataset.i = String(i);
      x.append(icon(doc, 'x', 12));
      chip.append(x);
      return chip;
    });
    bar.replaceChildren(...chips, btn(doc, 'btn btn-sm btn-quiet cr-add-filter', 'Add filter'));
  }

  function paintControls() {
    const views = loadViews(storage, viewsKey);
    const by = btn(doc, 'btn btn-sm cr-dim', dimLabel(st.by), `Allocate by: ${dimLabel(st.by)}`);
    by.dataset.role = 'by';
    by.setAttribute('aria-haspopup', 'dialog');
    const then = btn(doc, 'btn btn-sm cr-dim', st.thenBy ? dimLabel(st.thenBy) : 'None', `Then by: ${st.thenBy ? dimLabel(st.thenBy) : 'none'}`);
    then.dataset.role = 'thenBy';
    then.setAttribute('aria-haspopup', 'dialog');
    const seg = h(doc, 'div', 'seg seg-sm cr-metric');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Chart shows');
    for (const [m, text] of [['spend', 'AI spend'], ['hours', 'Human hours']]) {
      const b = btn(doc, st.metric === m ? 'on' : '', text);
      b.dataset.metric = m;
      b.setAttribute('aria-pressed', String(st.metric === m));
      seg.append(b);
    }
    const sel = h(doc, 'select', 'select cr-views');
    sel.setAttribute('aria-label', 'Saved views');
    sel.append(Object.assign(h(doc, 'option', null, 'Saved views'), { value: '' }),
      ...views.map((v) => Object.assign(h(doc, 'option', null, v.name), { value: v.name })));
    sel.value = views.some((v) => v.name === st.view) ? st.view : '';
    const wrap = h(doc, 'div', 'select-wrap');
    wrap.append(sel);
    const del = btn(doc, 'btn btn-sm btn-quiet cr-delete-view', 'Delete view');
    del.hidden = !sel.value;
    controls.replaceChildren(h(doc, 'span', 'hint', 'Allocate by'), by, h(doc, 'span', 'hint', 'then by'), then, seg, wrap,
      btn(doc, 'btn btn-sm cr-save-view', 'Save view'), del, btn(doc, 'btn btn-sm cr-csv', 'Download CSV'));
  }

  function shareCell(row) {
    const td = h(doc, 'td', 'cr-share-cell');
    const inner = h(doc, 'span', 'cr-share-in');      // flex lives on the inner span: a flex td stops being a table cell
    const barEl = h(doc, 'span', 'cr-share-bar');
    const fill = h(doc, 'span', 'cr-share-fill');
    fill.style.width = `${model.total.units > 0 ? Math.min(100, (row.units / model.total.units) * 100) : 0}%`;
    barEl.append(fill);
    inner.append(barEl, h(doc, 'span', 'num', formatShare(row.units, model.total.units)));
    td.append(inner);
    return td;
  }

  function rowEl(row, depth, parentPath) {
    const path = parentPath ? `${parentPath}/${row.key}` : row.key;
    rowsByPath.set(path, row);
    // `cr-kind-…`, never `cr-${kind}`: a value row classed `cr-value` would match the click handler's
    // closest('.cr-value') from ANY cell, so "N runs" would add a filter instead of opening the runs.
    const tr = h(doc, 'tr', `cr-row cr-kind-${row.kind}${depth ? ' cr-row-child' : ''}`);
    tr.dataset.path = path;
    tr.dataset.top = parentPath ? parentPath.split('/')[0] : row.key;
    tr.dataset.depth = String(depth);                  // read back by toggle(); the CSS variable only indents
    tr.style.setProperty('--cr-depth', String(depth));
    const nameTd = h(doc, 'td', 'cr-name');
    const name = h(doc, 'div', 'cr-name-in');         // flex wrapper, so the td stays a table cell
    nameTd.append(name);
    const kids = row.kind === 'other' ? row.members : row.children;
    if (kids.length) {
      const openNow = st.expanded.has(path);
      const x = btn(doc, 'btn btn-quiet btn-sm btn-icon cr-expand', null, `${openNow ? 'Hide' : 'Show'} rows under ${row.label}`);
      x.setAttribute('aria-expanded', String(openNow));
      x.append(icon(doc, openNow ? 'chevron-down' : 'chevron', 14));
      name.append(x);
    } else name.append(h(doc, 'span', 'cr-expand-gap'));
    if (row.kind === 'value' || row.kind === 'none') {
      const v = btn(doc, 'linkish cr-value', row.label, `Filter by ${dimLabel(row.dim)} = ${row.label}`);
      name.append(v);
    } else name.append(h(doc, 'span', 'cr-value-text', row.label));
    const savedTd = h(doc, 'td', `num${row.savedUsd < 0 ? ' is-neg' : ''}`, signedUsd(fmt, row.savedUsd));
    const runsTd = h(doc, 'td', 'num');
    if (row.runIds.length && canOpen) runsTd.append(btn(doc, 'linkish cr-runs', `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`, `Open the ${row.runIds.length} runs of ${row.label} in the Runs list`));
    else if (!canOpen && row.runs) runsTd.textContent = `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`;
    else runsTd.textContent = '—';
    tr.append(nameTd, shareCell(row),
      h(doc, 'td', 'num', fmt.usd(row.spentUsd)),
      h(doc, 'td', 'num', row.kind === 'ask' || row.kind === 'requirements' ? '—' : fmt.hours(row.humanHours)),
      savedTd,
      h(doc, 'td', 'num', row.usdPerHour == null ? '—' : `${fmt.usd(row.usdPerHour)}/h`),
      runsTd);
    // Stacked on phones the thead is clipped: the name leads the row, every other cell names its column.
    nameTd.classList.add('table-main');
    VALUE_HEADS.forEach((t, i) => { tr.cells[i + 1].dataset.label = t; });
    return tr;
  }

  /** The row and, when expanded, its descendants (depth-first). */
  function rowTree(row, depth, parentPath) {
    const tr = rowEl(row, depth, parentPath);
    const out = [tr];
    if (st.expanded.has(tr.dataset.path)) {
      for (const k of (row.kind === 'other' ? row.members : row.children)) out.push(...rowTree(k, depth + 1, tr.dataset.path));
    }
    return out;
  }

  function paintTable() {
    rowsByPath.clear();
    const table = h(doc, 'table', 'table people-table cr-table');
    const head = h(doc, 'tr');
    [dimLabel(st.by), ...VALUE_HEADS]
      .forEach((t, i) => head.append(h(doc, 'th', i ? 'num' : null, t)));
    const thead = h(doc, 'thead');
    thead.append(head);
    const tbody = h(doc, 'tbody');
    for (const r of model.rows) tbody.append(...rowTree(r, 0, ''));
    table.append(thead, tbody);
    const wrap = h(doc, 'div', 'table-wrap');
    wrap.append(table);
    tableCard.replaceChildren(wrap);
  }

  function toggle(path) {
    const tr = [...tableCard.querySelectorAll('tr[data-path]')].find((x) => x.dataset.path === path);   // no selector escaping
    const row = rowsByPath.get(path);
    if (!tr || !row) return;
    const depth = Number(tr.dataset.depth) || 0;
    if (st.expanded.has(path)) {
      st.expanded.delete(path);
      for (const x of [...tableCard.querySelectorAll('tr[data-path]')]) if (x.dataset.path.startsWith(`${path}/`)) { st.expanded.delete(x.dataset.path); x.remove(); }
    } else {
      st.expanded.add(path);
      const kids = (row.kind === 'other' ? row.members : row.children).flatMap((k) => rowTree(k, depth + 1, path));
      for (const k of kids) k.classList.add('cr-enter');
      tr.after(...kids);
    }
    const fresh = rowEl(row, depth, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    tr.replaceWith(fresh);
    fresh.querySelector('.cr-expand')?.focus();
  }

  function paint() {
    const rep = st.data?.report;
    if (!rep) return;
    options = dimensionOptions({ dims: st.dims, runs: rep.runs });
    if (!options.some((o) => o.id === st.by)) { st.by = defaultBy(options); st.expanded.clear(); }
    if (st.thenBy && (st.thenBy === st.by || !options.some((o) => o.id === st.thenBy))) st.thenBy = '';
    runs = rep.runs.filter((r) => matchesFilters(r, st.filters));
    const prevRuns = rep.prevRuns ? rep.prevRuns.filter((r) => matchesFilters(r, st.filters)) : null;
    const rate = st.data.humanRateUsd;
    model = allocate(runs, { by: st.by, thenBy: st.thenBy || null, rate, askUsd: askOn() ? rep.ask.spentUsd : 0,
      requirementsUsd: reqOn() ? rep.requirements.spentUsd : 0 });
    const prev = prevRuns ? allocate(prevRuns, { by: st.by, rate, askUsd: askOn() ? rep.ask.prevSpentUsd || 0 : 0,
      requirementsUsd: reqOn() ? rep.requirements.prevSpentUsd || 0 : 0 }).total : null;
    paintKpis(prev);
    paintBar();
    paintControls();
    const empty = !model.rows.length;
    chartCard.hidden = empty;
    tableCard.hidden = empty;
    emptyCard.hidden = !empty;
    leadEl.hidden = true;
    tailEl.hidden = true;
    if (empty) {
      emptyCard.replaceChildren(h(doc, 'p', 'chart-empty hint', st.filters.length ? 'No runs match these filters.' : 'No spend in this period.'),
        ...(st.filters.length ? [btn(doc, 'btn btn-sm cr-clear-filters', 'Clear filters')] : []));
      return;
    }
    chartHead.replaceChildren(h(doc, 'h2', null, 'Cost and value'), h(doc, 'small', 'hint', st.rangeLabel));
    const none = model.rows.find((r) => r.kind === 'none');
    chart.update({
      series: allocationSeries(model, runs, { buckets: rep.buckets, metric: st.metric, askSeries: askOn() ? rep.ask.series : null,
        requirementsSeries: reqOn() ? rep.requirements.series : null }),
      buckets: rep.buckets, bucket: st.data.bucket, metric: st.metric,
      unallocated: none && canOpen && st.by.startsWith('tag:') ? { ids: none.runIds } : null,
    });
    paintTable();
    const x = (extras && extras({ runs, model, by: st.by, byLabel: dimLabel(st.by) })) || {};
    leadEl.replaceChildren(...(x.lead ? [x.lead] : []));
    leadEl.hidden = !x.lead;
    tailEl.replaceChildren(...(x.tail || []).filter(Boolean));
    tailEl.hidden = !tailEl.childElementCount;
  }

  function setFilter(f) {
    st.filters = [...st.filters.filter((x) => x.dim !== f.dim), f].slice(-MAX_FILTERS);
    if (f.dim === st.by && st.thenBy) { st.by = st.thenBy; st.thenBy = ''; }
    st.expanded.clear();
    st.view = '';
    persist();
    paint();
  }
  const anchorFor = (role) => () => controls.querySelector(`.cr-dim[data-role="${role}"]`);
  const pickerOptions = () => options.map((o) => ({ ...o, hint: o.group === 'other' ? formatShare(o.share, 1) : '' }));

  el.addEventListener('click', (e) => {
    const t = e.target;
    const dim = t.closest('.cr-dim');
    if (dim) {
      const role = dim.dataset.role;
      openDimensionPicker({ doc, anchor: anchorFor(role), options: pickerOptions(), selected: role === 'by' ? st.by : st.thenBy,
        title: role === 'by' ? 'Allocate by' : 'Then by', noneLabel: role === 'thenBy' ? 'None' : null,
        onPick: (id) => {
          if (role === 'by') { st.by = id; if (st.thenBy === id) st.thenBy = ''; } else st.thenBy = id;
          st.expanded.clear(); st.view = ''; persist(); paint();
        } });
      return;
    }
    if (t.closest('.cr-add-filter')) {
      const anchor = () => bar.querySelector('.cr-add-filter');
      openDimensionPicker({ doc, anchor, options: pickerOptions(), title: 'Add filter', onPick: (id) => {
        // Values come from the runs the OTHER filters leave: a chip on this dimension is about to be replaced.
        const vals = valueOptions(st.data.report.runs.filter((r) => matchesFilters(r, st.filters.filter((f) => f.dim !== id))), id);
        openDimensionPicker({ doc, anchor, title: `${dimLabel(id)} is`, placeholder: 'Search values', empty: 'No matching values.',
          options: vals.map((v) => ({ id: v.value === null ? '\u0000none' : v.value, label: v.label, hint: fmt.usd(v.spentUsd) })),
          onPick: (v) => setFilter({ dim: id, value: v === '\u0000none' ? null : v }) });
      } });
      return;
    }
    const x = t.closest('.cr-chip-x');
    if (x) { st.filters.splice(Number(x.dataset.i), 1); st.view = ''; persist(); paint(); bar.querySelector('.cr-add-filter')?.focus(); return; }
    if (t.closest('.cr-clear-filters')) { st.filters = []; st.view = ''; persist(); paint(); return; }
    const m = t.closest('.cr-metric button[data-metric]');
    if (m) { st.metric = m.dataset.metric; persist(); paint(); return; }
    const exp = t.closest('.cr-expand');
    if (exp) { toggle(exp.closest('tr').dataset.path); return; }
    const val = t.closest('.cr-value');
    if (val) { const row = rowsByPath.get(val.closest('tr').dataset.path); if (row) setFilter({ dim: row.dim, value: row.value }); return; }
    const rn = t.closest('.cr-runs');
    if (rn) { const row = rowsByPath.get(rn.closest('tr').dataset.path); if (row && canOpen) onOpenRuns(row.runIds); return; }
    if (t.closest('.cr-csv')) {
      const key = st.by.startsWith('tag:') ? st.by.slice(4) : st.by;
      onDownload(reportCsv(model, { byLabel: dimLabel(st.by), thenByLabel: st.thenBy ? dimLabel(st.thenBy) : '' }),
        csvName(st, key));
      return;
    }
    if (t.closest('.cr-save-view')) { openSaveForm(); return; }
    if (t.closest('.cr-delete-view')) {
      deleteView(storage, st.view, viewsKey); st.view = ''; paintControls();
      controls.querySelector('.cr-views')?.focus();   // the button is gone after the repaint: focus the select
      return;
    }
  });
  el.addEventListener('change', (e) => {
    if (!e.target.matches('.cr-views')) return;
    const v = loadViews(storage, viewsKey).find((x) => x.name === e.target.value);
    if (!v) return;
    Object.assign(st, cleanState(v), { view: v.name });
    st.expanded.clear();
    persist();
    paint();
  });
  tableCard.addEventListener('pointerover', (e) => { const tr = e.target.closest('tr[data-top]'); if (tr) chart.focus(tr.dataset.top); });
  tableCard.addEventListener('pointerleave', () => chart.focus(null));

  function openSaveForm() {
    const form = h(doc, 'form', 'cr-save-form');
    const name = h(doc, 'input', 'input cr-view-name');
    Object.assign(name, { type: 'text', maxLength: 60, placeholder: 'View name' });
    name.setAttribute('aria-label', 'View name');
    form.append(name, Object.assign(btn(doc, 'btn btn-sm btn-primary', 'Save'), { type: 'submit' }), btn(doc, 'btn btn-sm btn-quiet cr-save-cancel', 'Cancel'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!name.value.trim()) return;
      saveView(storage, name.value, st, viewsKey);
      st.view = name.value.trim().slice(0, 60);
      paintControls();
      controls.querySelector('.cr-views')?.focus();
    });
    form.addEventListener('click', (e) => { if (e.target.closest('.cr-save-cancel')) { paintControls(); controls.querySelector('.cr-save-view')?.focus(); } });
    controls.querySelector('.cr-save-view').replaceWith(form);
    name.focus();
  }

  return {
    el,
    state: st,
    update({ data, dims = [], rangeLabel = '', range = 'month' }) {
      Object.assign(st, { data, dims, rangeLabel, range });
      paint();
    },
  };
}
