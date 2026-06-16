import { html } from 'lit-html';
import { outcomeOf, variantFor } from '../utils/badge.js';
import { formatCost, formatDuration, num, pct } from '../utils/format.js';

function _median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _iterations(row) {
  const c = row.loop_counters;
  if (!c || typeof c !== 'object') return 0;
  return Object.values(c).reduce(
    (a, b) => a + (typeof b === 'number' ? b : 0),
    0,
  );
}

function _statRow(label, value) {
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>
  `;
}

/**
 * Detail view body for one profile: aggregate stat tiles + a per-rep table.
 * The profile name, outcome badge, back button, and "Run profile" action now
 * live in main.js's shared content header.
 *
 * @param {object} data  { aggregate, reps }
 */
export function profileDetailView(data) {
  if (!data?.aggregate) {
    return html`<section class="page"><p class="empty-state">Profile not found.</p></section>`;
  }
  const agg = data.aggregate;
  const reps = data.reps || [];

  const costs = reps
    .map((r) => r.cost_usd)
    .filter((c) => typeof c === 'number');
  const medianCost = _median(costs);

  return html`
    <section class="page">
      <div class="stat-grid">
        ${_statRow('Benchmark', agg.benchmark || 'N/A')}
        ${_statRow('Reps', String(agg.reps))}
        ${_statRow('Resolved rate', pct(agg.resolved_rate))}
        ${_statRow('Mean cost', formatCost(agg.mean_cost_usd) || 'N/A')}
        ${_statRow('Median cost', formatCost(medianCost) || 'N/A')}
        ${_statRow('Mean wall time', formatDuration(agg.mean_wall_s))}
        ${_statRow('Mean iterations', num(agg.mean_iterations, 2))}
      </div>

      <table class="reps-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Rep</th>
            <th>Status</th>
            <th>Score</th>
            <th>Cost</th>
            <th>Wall</th>
            <th>Iters</th>
          </tr>
        </thead>
        <tbody>
          ${reps.map((r) => {
            const ro = outcomeOf(r);
            return html`
              <tr>
                <td class="reps-instance" title=${r.instance_id || ''}>${r.instance_id || '—'}</td>
                <td>${r.rep ?? '—'}</td>
                <td><sl-badge variant="${variantFor(ro)}" pill>${ro}</sl-badge></td>
                <td>${typeof r.score === 'number' ? num(r.score, 2) : '—'}</td>
                <td>${formatCost(r.cost_usd) || '—'}</td>
                <td>${typeof r.wall_time_s === 'number' ? formatDuration(r.wall_time_s) : '—'}</td>
                <td>${_iterations(r)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}
