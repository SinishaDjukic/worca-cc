// ui/public/workspace-map-view.mjs
// Pure DOM renderer for the workspace page's Map tab (spec D17): coverage strip, graph (layered
// SVG), edge table with evidence and override actions, filters, add-edge form, Regenerate
// description. Like team-metrics-surfaces.mjs: no fetch, no listeners — app.js delegates events
// through the class hooks .wm-confirm .wm-reject .wm-clear .wm-del .wm-add .wm-regen .wm-rescan
// .wm-filter .wm-pair. Every repo- or agent-authored string reaches the DOM through textContent
// or setAttribute, never markup.
import { layoutMap, pairsOf } from '../../src/shared/workspace-map/layout.mjs';
import { KINDS, KIND_LABELS, CONFIDENCE, EDGE_STATES } from '../../src/shared/workspace-map/schema.mjs';
import { mapSummary } from '../../src/shared/workspace-map/summary.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONF_TONE = { exact: 'green', verified: 'blue', heuristic: 'amber', inferred: 'grey' };
const STATE_TONE = { auto: 'grey', confirmed: 'green', rejected: 'red', manual: 'violet', missing: 'amber', stale: 'amber' };
const ACTIONS = {
  auto: [['wm-confirm', 'Confirm'], ['wm-reject', 'Reject']],
  confirmed: [['wm-reject', 'Reject'], ['wm-clear', 'Clear']],
  rejected: [['wm-confirm', 'Confirm'], ['wm-clear', 'Clear']],
  missing: [['wm-clear', 'Clear']],
  stale: [['wm-clear', 'Clear']],
  manual: [['wm-del', 'Delete']],
};
const NAME_MAX = 20;
const ROW_MAX = 500;   // table rows painted per repaint (thousands of edges are realistic); the badge still counts all

const str = (v) => (typeof v === 'string' ? v : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const kindOf = (k) => (KINDS.includes(k) ? k : 'other');
const kindLabel = (k) => KIND_LABELS[kindOf(k)] || kindOf(k);

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function btn(doc, cls, text) {
  const b = h(doc, 'button', `btn-ghost btn-mini ${cls}`, text);
  b.type = 'button';
  return b;
}
function svg(doc, tag, attrs = {}) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
function select(doc, { cls, name, filter, label, options, value }) {
  const wrap = h(doc, 'div', 'select-wrap');
  const s = h(doc, 'select', cls ? `select ${cls}` : 'select');
  if (name) s.name = name;
  if (filter) s.dataset.filter = filter;
  s.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const o = h(doc, 'option', null, text);
    o.value = v;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  wrap.appendChild(s);
  return wrap;
}

/** A fresh filter set: '' = no filter; pair = {from, to} | null. */
export function emptyMapFilters() {
  return { member: '', kind: '', confidence: '', state: '', pair: null };
}

/** Effective edges narrowed by the filters (member matches either end; a manual edge has no
 *  confidence, so a confidence filter never matches it). Never throws. */
export function filterEdges(edges, filters) {
  const f = { ...emptyMapFilters(), ...(filters && typeof filters === 'object' ? filters : {}) };
  return (Array.isArray(edges) ? edges : []).filter((e) => e && typeof e === 'object'
    && (!f.member || e.from === f.member || e.to === f.member)
    && (!f.kind || kindOf(e.kind) === f.kind)
    && (!f.confidence || (e.state !== 'manual' && e.confidence === f.confidence))
    && (!f.state || (str(e.state) || 'auto') === f.state)
    && (!f.pair || (e.from === f.pair.from && e.to === f.pair.to)));
}

/** The Map tab body. data = GET /api/workspaces/:id/map ({ map, synthesis, overrides, edges,
 *  descriptionOrigin }) + { workspace } (+ { error } when the last load failed: above the last
 *  good map, or alone when there is none).
 *  filters = emptyMapFilters() shape. → a detached <div class="wm">. */
export function renderMapTab(data, { doc = globalThis.document, filters = emptyMapFilters() } = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const f = { ...emptyMapFilters(), ...(filters && typeof filters === 'object' ? filters : {}) };
  const root = h(doc, 'div', 'wm');
  if (str(d.error)) root.appendChild(h(doc, 'small', 'hint err wm-error', d.error));
  const map = d.map && typeof d.map === 'object' ? d.map : null;
  if (!map) {
    if (str(d.error)) return root;                     // unknown, not empty: no Re-scan offer
    const card = h(doc, 'section', 'card wm-empty');
    card.append(h(doc, 'b', null, 'No map yet'), btn(doc, 'wm-rescan', 'Re-scan'));
    root.appendChild(card);
    return root;
  }
  const members = (Array.isArray(map.members) ? map.members : []).filter((m) => m && typeof m === 'object' && str(m.key));
  const names = new Map(members.map((m) => [m.key, str(m.name) || m.key]));
  const nameOf = (k) => names.get(k) || str(k);
  const edges = (Array.isArray(d.edges) ? d.edges : []).filter((e) => e && typeof e === 'object');
  // A filter can outlive what it names (a re-scan dropped the member): ignore it rather than show
  // an empty table under a select that reads "All".
  if (!names.has(f.member)) f.member = '';
  if (!f.pair || !names.has(f.pair.from) || !names.has(f.pair.to)) f.pair = null;
  if (!KINDS.includes(f.kind)) f.kind = '';
  if (!CONFIDENCE.includes(f.confidence)) f.confidence = '';
  if (!EDGE_STATES.includes(f.state)) f.state = '';

  root.appendChild(renderTop(doc, map, d.overrides, d.descriptionOrigin));
  root.appendChild(renderCoverage(doc, members, f));
  root.appendChild(renderGraph(doc, { map, members, edges, nameOf, f }));
  root.appendChild(renderEdges(doc, { members, edges, nameOf, f }));
  return root;
}

function renderTop(doc, map, overrides, origin) {
  const top = h(doc, 'div', 'wm-top');
  const s = mapSummary(map, overrides && typeof overrides === 'object' ? overrides : null) || {};
  const parts = [plural(Number(s.members) || 0, 'project'), plural(Number(s.edges) || 0, 'edge')];
  if (Number(s.gaps) > 0) parts.push(plural(Number(s.gaps), 'gap'));
  const at = str(map.scannedAt);
  if (/^\d{4}-\d{2}-\d{2}/.test(at)) parts.push(`scanned ${at.slice(0, 10)}`);
  top.appendChild(h(doc, 'small', 'wm-meta', parts.join(' · ')));
  if (origin === 'edited') top.appendChild(btn(doc, 'wm-regen', 'Regenerate description'));
  return top;
}

function renderCoverage(doc, members, f) {
  const card = h(doc, 'section', 'card wm-coverage-card');
  const head = h(doc, 'div', 'card-head');
  head.appendChild(h(doc, 'b', null, 'Coverage'));
  const strip = h(doc, 'div', 'wm-coverage');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Coverage');
  for (const m of members) {
    const cov = m.coverage && typeof m.coverage === 'object' ? m.coverage : {};
    const level = ['rich', 'partial', 'none'].includes(cov.level) ? cov.level : 'none';
    const failed = cov.usageStatus === 'failed';
    // coverage.graph: null (no graphify graph), P1 { nodes, fresh }, or P7 { nodes, bytes, fresh, used }
    // (used = at least one edge end of this member resolved to a graph symbol).
    const g = cov.graph && typeof cov.graph === 'object' ? cov.graph : null;
    const graph = !g ? ['wm-tag is-off', 'no graph']
      : g.fresh !== true ? ['wm-tag is-off', 'stale graph']
        : g.used === false ? ['wm-tag is-off', 'graph unused']
          : ['wm-tag', 'graph'];
    const chip = h(doc, 'button', `wm-chip wm-filter lvl-${level}`);
    chip.type = 'button';
    chip.dataset.filter = 'member';
    chip.dataset.value = m.key;
    chip.setAttribute('aria-pressed', f.member === m.key ? 'true' : 'false');
    if (f.member === m.key) chip.classList.add('is-active');
    const dot = h(doc, 'span', 'wm-dot');
    dot.setAttribute('aria-hidden', 'true');
    chip.append(dot, h(doc, 'span', 'wm-chip-name', str(m.name) || m.key), h(doc, 'span', 'wm-tag', level));
    if (cov.surveyed === 'failed') chip.appendChild(h(doc, 'span', 'wm-tag is-bad', 'survey failed'));
    if (failed) chip.appendChild(h(doc, 'span', 'wm-tag is-bad', 'usage failed'));
    chip.appendChild(h(doc, 'span', graph[0], graph[1]));
    chip.title = `${str(m.name) || m.key} (${m.key})`;
    strip.appendChild(chip);
  }
  card.append(head, strip);
  return card;
}

function renderGraph(doc, { map, members, edges, nameOf, f }) {
  const card = h(doc, 'section', 'card wm-graph-card');
  const head = h(doc, 'div', 'card-head');
  head.appendChild(h(doc, 'b', null, 'Graph'));
  const pairs = pairsOf(edges);
  const lay = layoutMap({ members, pairs, order: map.order });
  const used = KINDS.filter((k) => lay.edges.some((e) => e.kinds.includes(k)));
  if (used.length) {
    const legend = h(doc, 'div', 'wm-legend');
    for (const k of used) {
      const item = h(doc, 'span', `wm-legend-item wm-k-${k}`);
      const sw = h(doc, 'i', 'wm-swatch');
      sw.setAttribute('aria-hidden', 'true');
      item.append(sw, KIND_LABELS[k] || k);
      legend.appendChild(item);
    }
    head.appendChild(legend);
  }
  const scroll = h(doc, 'div', 'wm-graph-scroll');
  const focus = Boolean(f.member || f.pair);
  const hit = (from, to) => (f.pair ? f.pair.from === from && f.pair.to === to : Boolean(f.member) && (from === f.member || to === f.member));
  const root = svg(doc, 'svg', {
    class: focus ? 'wm-graph has-focus' : 'wm-graph',
    role: 'group',                       // not 'img': an ARIA img would hide its focusable pairs
    'aria-label': `Workspace map: ${plural(lay.nodes.length, 'project')}, ${plural(lay.edges.length, 'connection')}`,
    viewBox: `0 0 ${lay.width} ${lay.height}`,
    width: lay.width,
    height: lay.height,
  });
  const defs = svg(doc, 'defs');
  for (const k of used) {
    const marker = svg(doc, 'marker', { id: `wm-arrow-${k}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' });
    marker.appendChild(svg(doc, 'path', { d: 'M0 0L10 5L0 10z', class: `wm-arrow wm-k-${k}` }));
    defs.appendChild(marker);
  }
  root.appendChild(defs);
  const gEdges = svg(doc, 'g', { class: 'wm-edges' });
  for (const e of lay.edges) {
    const kind = kindOf(e.kinds[0]);
    const cls = ['wm-pair', `wm-k-${kind}`];
    if (e.confidence === 'inferred' || e.state === 'manual') cls.push('is-dashed');
    if (e.state === 'confirmed') cls.push('is-confirmed');
    if (focus) cls.push(hit(e.from, e.to) ? 'is-selected' : 'is-dim');
    const label = `${nameOf(e.from)} uses ${nameOf(e.to)}: ${plural(e.count, 'edge')} (${e.kinds.map(kindLabel).join(', ')})`;
    const g = svg(doc, 'g', {
      class: cls.join(' '), tabindex: 0, role: 'button', 'aria-pressed': f.pair && hit(e.from, e.to) ? 'true' : 'false',
      'data-from': e.from, 'data-to': e.to, 'aria-label': label,
    });
    const title = svg(doc, 'title');
    title.textContent = label;
    g.append(title, svg(doc, 'path', { class: 'wm-hit', d: e.d }), svg(doc, 'path', { class: 'wm-line', d: e.d, 'marker-end': `url(#wm-arrow-${kind})` }));
    gEdges.appendChild(g);
  }
  const gNodes = svg(doc, 'g', { class: 'wm-nodes' });
  for (const n of lay.nodes) {
    const on = f.member === n.key || (f.pair && (f.pair.from === n.key || f.pair.to === n.key));
    const g = svg(doc, 'g', {
      class: `wm-node wm-filter lvl-${n.level}${on ? ' is-selected' : ''}`,
      'data-filter': 'member', 'data-value': n.key, transform: `translate(${n.x} ${n.y})`,
    });
    const title = svg(doc, 'title');
    title.textContent = `${n.name} (${n.key})`;
    const text = svg(doc, 'text', { x: 14, y: n.h / 2 + 4.5 });
    text.textContent = n.name.length > NAME_MAX ? `${n.name.slice(0, NAME_MAX - 1)}…` : n.name;
    g.append(title, svg(doc, 'rect', { width: n.w, height: n.h, rx: 10 }), text);
    gNodes.appendChild(g);
  }
  root.append(gEdges, gNodes);
  scroll.appendChild(root);
  card.append(head, scroll);
  return card;
}

function renderEvidence(doc, e) {
  const cell = h(doc, 'td', 'wm-evidence');
  const ev = e.evidence && typeof e.evidence === 'object' ? e.evidence : {};
  const ctx = e.context && typeof e.context === 'object' ? e.context : {};
  for (const side of ['from', 'to']) {
    const items = (Array.isArray(ev[side]) ? ev[side] : []).filter((x) => x && typeof x === 'object' && str(x.file));
    const c = ctx[side] && typeof ctx[side] === 'object' ? ctx[side] : null;
    if (!items.length && !(c && str(c.symbol))) continue;
    const block = h(doc, 'div', 'wm-ev');
    block.appendChild(h(doc, 'span', 'wm-ev-side', side));
    for (const x of items) {
      const loc = h(doc, 'code', 'wm-ev-loc mono', Number.isInteger(x.line) ? `${x.file}:${x.line}` : x.file);
      if (str(x.match)) loc.title = x.match;
      block.appendChild(loc);
    }
    if (c && str(c.symbol)) {
      const callers = (Array.isArray(c.callers) ? c.callers : []).filter((s) => typeof s === 'string' && s);
      block.appendChild(h(doc, 'small', 'wm-ctx', callers.length ? `in ${c.symbol} · callers: ${callers.join(', ')}` : `in ${c.symbol}`));
    }
    cell.appendChild(block);
  }
  if (!cell.childNodes.length) cell.textContent = '—';
  return cell;
}

function renderRow(doc, e, nameOf) {
  const state = EDGE_STATES.includes(e.state) ? e.state : 'auto';
  const kind = kindOf(e.kind);
  const tr = h(doc, 'tr', `wm-row is-${state}`);
  tr.dataset.edge = str(e.id);
  const from = h(doc, 'td', 'wm-from', nameOf(e.from));
  from.title = str(e.from);
  const to = h(doc, 'td', 'wm-to', nameOf(e.to));
  to.title = str(e.to);
  const kindCell = h(doc, 'td');
  const k = h(doc, 'span', `wm-kind wm-k-${kind}`);
  const sw = h(doc, 'i', 'wm-swatch');
  sw.setAttribute('aria-hidden', 'true');
  k.append(sw, kindLabel(kind));
  kindCell.appendChild(k);
  const disp = h(doc, 'td', 'wm-disp');
  disp.appendChild(h(doc, 'span', 'mono', str(e.display) || str(e.norm) || '—'));
  if (str(e.label)) disp.appendChild(h(doc, 'small', 'wm-sub', e.label));
  if (str(e.detail)) disp.appendChild(h(doc, 'small', 'wm-sub', e.detail));
  const conf = h(doc, 'td');
  // A manual edge has no confidence, whatever P1 stamped on it (v1: 'verified'; v2: null).
  if (state !== 'manual' && CONFIDENCE.includes(e.confidence)) conf.appendChild(h(doc, 'span', `badge wm-conf ${CONF_TONE[e.confidence]}`, e.confidence));
  else conf.textContent = '—';
  const st = h(doc, 'td');
  st.appendChild(h(doc, 'span', `badge wm-state ${STATE_TONE[state]}`, state));
  const acts = h(doc, 'td', 'wm-actions');
  const what = `${nameOf(e.from)} → ${nameOf(e.to)} ${str(e.display)}`.trim();
  for (const [cls, text] of ACTIONS[state]) {
    const b = btn(doc, cls, text);
    b.dataset.edge = str(e.id);
    b.setAttribute('aria-label', `${text} ${what}`);
    acts.appendChild(b);
  }
  tr.append(from, to, kindCell, disp, conf, st, renderEvidence(doc, e), acts);
  return tr;
}

function renderEdges(doc, { members, edges, nameOf, f }) {
  const card = h(doc, 'section', 'card wm-edges-card');
  const shown = filterEdges(edges, f);
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'b', null, 'Edges'), h(doc, 'span', 'badge', shown.length === edges.length ? String(edges.length) : `${shown.length} / ${edges.length}`));
  const bar = h(doc, 'div', 'wm-filters');
  bar.append(
    select(doc, { cls: 'wm-filter', filter: 'member', label: 'Project', value: f.member, options: [['', 'All projects'], ...members.map((m) => [m.key, str(m.name) || m.key])] }),
    select(doc, { cls: 'wm-filter', filter: 'kind', label: 'Kind', value: f.kind, options: [['', 'All kinds'], ...KINDS.map((k) => [k, KIND_LABELS[k] || k])] }),
    select(doc, { cls: 'wm-filter', filter: 'confidence', label: 'Confidence', value: f.confidence, options: [['', 'All confidence'], ...CONFIDENCE.map((c) => [c, c])] }),
    select(doc, { cls: 'wm-filter', filter: 'state', label: 'State', value: f.state, options: [['', 'All states'], ...EDGE_STATES.map((s) => [s, s])] }),
  );
  if (f.pair) {
    const chip = btn(doc, 'wm-filter wm-pair-chip', `${nameOf(f.pair.from)} → ${nameOf(f.pair.to)} ×`);
    chip.dataset.filter = 'pair';
    chip.dataset.value = '';
    chip.setAttribute('aria-label', `Clear the ${nameOf(f.pair.from)} → ${nameOf(f.pair.to)} filter`);
    bar.appendChild(chip);
  }
  if (f.member || f.kind || f.confidence || f.state || f.pair) {
    const clear = btn(doc, 'wm-filter', 'Clear filters');
    clear.dataset.filter = 'all';
    clear.dataset.value = '';
    bar.appendChild(clear);
  }
  const wrap = h(doc, 'div', 'wm-table-scroll');
  const table = h(doc, 'table', 'wm-table');
  const thead = h(doc, 'thead');
  const hr = h(doc, 'tr');
  for (const t of ['From', 'To', 'Kind', 'Edge', 'Confidence', 'State', 'Evidence', 'Actions']) {
    const th = h(doc, 'th', null, t);
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = h(doc, 'tbody');
  if (!shown.length) {
    const tr = h(doc, 'tr', 'wm-none');
    const td = h(doc, 'td', null, 'No edges');
    td.colSpan = 8;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const e of shown.slice(0, ROW_MAX)) tbody.appendChild(renderRow(doc, e, nameOf));
  if (shown.length > ROW_MAX) {
    const tr = h(doc, 'tr', 'wm-more');
    const td = h(doc, 'td', null, `+${shown.length - ROW_MAX} more`);
    td.colSpan = 8;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  card.append(head, bar, wrap, renderAddForm(doc, members));
  return card;
}

function renderAddForm(doc, members) {
  const box = h(doc, 'div', 'wm-add-box');
  box.appendChild(h(doc, 'b', null, 'Add edge'));
  const form = h(doc, 'div', 'wm-add-form');
  form.setAttribute('role', 'group');
  form.setAttribute('aria-label', 'Add edge');
  const opts = members.map((m) => [m.key, str(m.name) || m.key]);
  form.append(
    select(doc, { name: 'wm-from', label: 'From', options: opts, value: opts[0] ? opts[0][0] : '' }),
    select(doc, { name: 'wm-to', label: 'To', options: opts, value: opts[1] ? opts[1][0] : '' }),
    select(doc, { name: 'wm-kind', label: 'Kind', options: KINDS.map((k) => [k, KIND_LABELS[k] || k]), value: 'http' }),
  );
  for (const [name, label] of [['wm-display', 'Edge'], ['wm-detail', 'Detail']]) {
    const input = h(doc, 'input', 'input');
    input.type = 'text';
    input.name = name;
    input.maxLength = 200;               // P5 refuses a longer display (MANUAL_DISPLAY_MAX) or detail (LIMITS.DETAIL_MAX)
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    form.appendChild(input);
  }
  const add = h(doc, 'button', 'btn btn-primary btn-mini wm-add', 'Add edge');
  add.type = 'button';
  form.appendChild(add);
  const msg = h(doc, 'small', 'hint err wm-add-msg');
  msg.hidden = true;
  box.append(form, msg);
  return box;
}
