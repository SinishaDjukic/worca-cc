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
 * "Run options" launcher: per-run overrides for reps and instance cap. Empty
 * inputs fall back to the profile's defaults. Reads input values at click time
 * (lit-html is stateless) from the enclosing `.run-options` container.
 */
function _runOptionsView(agg, onRun) {
  const launch = (e) => {
    const box = e.target.closest('.run-options');
    const reps = box.querySelector('.run-opt-reps').value.trim();
    const maxInstances = box.querySelector('.run-opt-instances').value.trim();
    onRun(agg.name, {
      reps: reps ? Number.parseInt(reps, 10) : undefined,
      maxInstances: maxInstances
        ? Number.parseInt(maxInstances, 10)
        : undefined,
    });
  };
  return html`
    <div class="run-options">
      <span class="run-options-title">Run options</span>
      <label class="run-opt"
        >Reps
        <input
          class="run-opt-reps"
          type="number"
          min="1"
          placeholder=${String(agg.reps || 1)}
      /></label>
      <label class="run-opt"
        >Max instances
        <input
          class="run-opt-instances"
          type="number"
          min="1"
          placeholder="all"
      /></label>
      <button class="action-btn action-btn--primary run-opt-launch" @click=${launch}>
        Run
      </button>
    </div>
  `;
}

/**
 * Configuration metadata — what pipeline/worca this profile benchmarks. Reads
 * from results rows once run (worca_version, worca_ref, template, grade_mode);
 * falls back to the YAML def's fields before the first run.
 */
function _configView(agg) {
  const worca = agg.worca_version
    ? agg.worca_ref
      ? `${agg.worca_version} (${agg.worca_ref})`
      : agg.worca_version
    : agg.worca_ref || '—';
  const items = [
    ['Worca', worca],
    ['Template', agg.template || '—'],
    ['Benchmark', agg.benchmark || '—'],
    ['Grade', agg.grade_mode || '—'],
  ];
  return html`
    <div class="config-meta">
      <div class="config-meta-title">Configuration</div>
      <div class="config-meta-grid">
        ${items.map(
          ([label, value]) => html`
            <div class="config-meta-item">
              <span class="config-meta-label">${label}</span>
              <span class="config-meta-value" title=${String(value)}>${value}</span>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

/**
 * Detail view body for one profile: aggregate stat tiles + a per-rep table.
 * The profile name, outcome badge, back button, and "Run profile" action now
 * live in main.js's shared content header.
 *
 * @param {object} data  { aggregate, reps }
 * @param {object} [handlers]
 * @param {(name: string, opts: {reps?: number, maxInstances?: number}) => void} [handlers.onRun]
 */
export function profileDetailView(data, { onRun } = {}) {
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
      ${onRun ? _runOptionsView(agg, onRun) : ''}
      ${_configView(agg)}
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
