import { html, nothing } from 'lit-html';
import { profileOutcome, variantFor } from '../utils/badge.js';
import { formatCost, formatDuration, num, pct } from '../utils/format.js';

/**
 * Config-vs-config comparison table. Each requested profile is a column.
 *
 * @param {object[]} rows  aggregate summaries from /api/compare
 * @param {object} [handlers]
 * @param {() => void} [handlers.onBack]
 */
export function compareView(rows, { onBack } = {}) {
  return html`
    <section class="page">
      <div class="page-head">
        <h1>Compare Profiles</h1>
        ${onBack ? html`<button class="action-btn" @click=${onBack}>Back</button>` : nothing}
      </div>
      ${
        !rows || rows.length === 0
          ? html`<p class="empty-state">No profiles selected to compare.</p>`
          : html`
        <table class="compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${rows.map((r) => {
                const o = profileOutcome(r);
                return html`<th><span class="compare-col-name">${r.name}</span> <sl-badge variant="${variantFor(o)}" pill>${o}</sl-badge></th>`;
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="compare-metric">Reps (n)</td>
              ${rows.map((r) => html`<td>${r.n ?? r.reps ?? 0}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Resolved rate</td>
              ${rows.map((r) => html`<td>${pct(r.resolved_rate)}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Mean cost</td>
              ${rows.map((r) => html`<td>${formatCost(r.mean_cost_usd) || 'N/A'}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Mean wall time</td>
              ${rows.map((r) => html`<td>${formatDuration(r.mean_wall_s)}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Mean iterations</td>
              ${rows.map((r) => html`<td>${num(r.mean_iterations, 2)}</td>`)}
            </tr>
          </tbody>
        </table>
      `
      }
    </section>
  `;
}
