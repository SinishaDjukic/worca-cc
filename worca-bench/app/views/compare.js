import { html, nothing } from 'lit-html';
import { profileOutcome, variantFor } from '../utils/badge.js';
import { formatCost, formatDuration, num, pct } from '../utils/format.js';

/**
 * Config-vs-config comparison table body. Each requested profile is a column.
 * The page title and back button live in main.js's shared content header.
 *
 * @param {object[]} rows  aggregate summaries from /api/compare
 */
export function compareView(rows) {
  return html`
    <section class="page">
      ${
        !rows || rows.length === 0
          ? html`<p class="empty-state">No profiles selected to compare.</p>`
          : html`
        <table class="compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${(() => {
                const counts = new Map();
                for (const r of rows)
                  counts.set(r.name, (counts.get(r.name) || 0) + 1);
                return rows.map(
                  (r) => html`<th>
                    <span class="compare-col-name">${r.name}</span>
                    ${
                      counts.get(r.name) > 1 && r.source_label
                        ? html`<span class="compare-col-src">${r.source_label}</span>`
                        : nothing
                    }
                  </th>`,
                );
              })()}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="compare-metric">Status</td>
              ${rows.map((r) => {
                const o = profileOutcome(r);
                return html`<td><sl-badge variant="${variantFor(o)}" pill>${o}</sl-badge></td>`;
              })}
            </tr>
            <tr>
              <td class="compare-metric">Reps (n)</td>
              ${rows.map((r) => html`<td>${r.n ?? r.reps ?? 0}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Resolved rate</td>
              ${rows.map((r) => html`<td>${pct(r.resolved_rate)}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Avg score</td>
              ${rows.map((r) => html`<td>${typeof r.mean_score === 'number' ? num(r.mean_score, 2) : 'N/A'}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Avg cost</td>
              ${rows.map((r) => html`<td>${formatCost(r.mean_cost_usd) || 'N/A'}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Avg duration</td>
              ${rows.map((r) => html`<td>${formatDuration(r.mean_wall_s)}</td>`)}
            </tr>
            <tr>
              <td class="compare-metric">Avg iterations</td>
              ${rows.map((r) => html`<td>${num(r.mean_iterations, 2)}</td>`)}
            </tr>
          </tbody>
        </table>
      `
      }
    </section>
  `;
}
