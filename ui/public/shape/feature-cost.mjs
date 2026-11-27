// ui/public/shape/feature-cost.mjs — feature page slice 6 (R-ux-3, R-arch-2): the Cost tab of a marked feature. One
// row per run (Planning, the numbered runs, each Verifier round, then one row for earlier tries and fix runs), each
// with its cost, and the Total the group row shows. Run and cost only. The model is pure; the DOM is the design
// system's Table (`.table-wrap > .table`), whose rows carry no listeners, so keepUnchanged may replace them.
import { groupCostParts } from '../runs-list.mjs';
import { fmtUsd } from '../graph/run-decor.mjs';

const round2 = (x) => Math.round(x * 100) / 100;
const SUFFIX = Object.freeze({ error: ' · failed', stopped: ' · stopped' });

/** group: { cost?: { usd, byPipeline, checks? }, liveCost?, members: [{ pipelineId?, position, title, adhoc? }],
 *  planning?: { pipelineId } | null }. totalUsd: the group row's cost (row.costUsd), passed through unchanged.
 *  → { rows: [{ key, num, label, usd }], totalLabel, totalUsd }. `usd` is null for a run with no pipeline yet, and for
 *  every row while the group has no cost. Each pipeline's cost is in one row only. */
export function featureCostModel(group, totalUsd) {
  const parts = group.cost ? groupCostParts(group, group.liveCost || {}) : null;
  const used = new Set();
  const take = (pid) => {
    if (!pid) return null;
    if (!parts) return null;
    if (used.has(pid)) return 0;
    used.add(pid);
    return parts[pid] ?? 0;
  };
  const rows = [];
  if (group.planning && group.planning.pipelineId) rows.push({ key: 'planning', num: null, label: 'Planning', usd: take(group.planning.pipelineId) });
  for (const m of [...(group.members || [])].sort((a, b) => a.position - b.position)) {
    rows.push({ key: `run:${m.position}`, num: m.adhoc ? null : m.position, label: m.title || '(untitled)', usd: take(m.pipelineId) });
  }
  if (parts) {
    const checks = Object.entries((group.cost && group.cost.checks) || {}).filter(([id]) => id in parts && !used.has(id))
      .sort(([a, x], [b, y]) => (x.at < y.at ? -1 : x.at > y.at ? 1 : a < b ? -1 : a > b ? 1 : 0));
    for (const [id, c] of checks) rows.push({ key: `check:${id}`, num: null, label: `Verifier · round ${c.round}${SUFFIX[c.status] || ''}`, usd: take(id) });
    const rest = round2(Object.entries(parts).filter(([id]) => !used.has(id)).reduce((a, [, v]) => a + v, 0));
    if (rest > 0) rows.push({ key: 'earlier', num: null, label: 'Earlier tries and fix runs', usd: rest });
  }
  return { rows, totalLabel: 'Total', totalUsd };
}

/** The Cost table: Run and Cost (`th.num`), a data-label on every cell (it stacks under 560px), the Total in tfoot. */
export function renderFeatureCost(doc, model) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cells = (tr, run, usd) => {
    const name = h('td', 'table-main');
    name.dataset.label = 'Run';
    name.append(...run);
    const cost = h('td', 'num', usd == null ? '—' : fmtUsd(usd));
    cost.dataset.label = 'Cost';
    tr.append(name, cost);
    return tr;
  };
  const table = h('table', 'table');
  const head = h('tr');
  head.append(h('th', null, 'Run'), h('th', 'num', 'Cost'));
  const thead = h('thead');
  thead.append(head);
  const body = h('tbody');
  for (const r of model.rows) body.append(cells(h('tr'), [...(r.num != null ? [h('span', 'row-num', String(r.num))] : []), doc.createTextNode(r.label)], r.usd));
  const foot = h('tfoot');
  foot.append(cells(h('tr'), [doc.createTextNode(model.totalLabel)], model.totalUsd));
  table.append(thead, body, foot);
  const wrap = h('div', 'table-wrap gpage-cost');
  wrap.append(table);
  return wrap;
}
