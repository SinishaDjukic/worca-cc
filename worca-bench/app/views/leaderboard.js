import { html, nothing } from 'lit-html';
import { pct } from '../utils/format.js';

/**
 * Public cross-agent leaderboard view. Rows come from the server's static
 * fixture today (a later phase fetches live standings). The local entry
 * (resolved_rate null) renders as a "this run" placeholder row.
 *
 * @param {object} data  { benchmark, rows, benchmarks }
 * @param {object} [handlers]
 * @param {() => void} [handlers.onBack]
 * @param {(benchmark: string) => void} [handlers.onSelectBenchmark]
 */
export function leaderboardView(data, { onBack, onSelectBenchmark } = {}) {
  const rows = data?.rows || [];
  const benchmarks = data?.benchmarks || [];
  const current = data?.benchmark || '';

  return html`
    <section class="page">
      <div class="page-head">
        <h1>Leaderboard</h1>
        ${onBack ? html`<button class="action-btn" @click=${onBack}>Back</button>` : nothing}
      </div>

      ${
        benchmarks.length > 1 && onSelectBenchmark
          ? html`<div class="leaderboard-tabs">
        ${benchmarks.map(
          (b) => html`<button
            class="leaderboard-tab ${b === current ? 'leaderboard-tab--active' : ''}"
            @click=${() => onSelectBenchmark(b)}
          >${b}</button>`,
        )}
      </div>`
          : nothing
      }

      <p class="leaderboard-note">
        Cross-agent standings for <strong>${current}</strong>. Public rows are a
        static snapshot — a later phase fetches swebench.com / commit-0 live.
      </p>

      ${
        rows.length === 0
          ? html`<p class="empty-state">No leaderboard data for this benchmark.</p>`
          : html`
        <table class="leaderboard-table">
          <thead>
            <tr><th>#</th><th>Agent</th><th>Resolved rate</th><th>Source</th></tr>
          </thead>
          <tbody>
            ${rows.map(
              (r, i) => html`
              <tr class=${r.source === 'local' ? 'leaderboard-row--local' : ''}>
                <td>${i + 1}</td>
                <td>${r.agent}</td>
                <td>${r.resolved_rate === null || r.resolved_rate === undefined ? '—' : pct(r.resolved_rate)}</td>
                <td><span class="leaderboard-source">${r.source}</span></td>
              </tr>
            `,
            )}
          </tbody>
        </table>
      `
      }
    </section>
  `;
}
