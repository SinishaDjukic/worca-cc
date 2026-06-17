import { html, nothing } from 'lit-html';
import { outcomeOf, variantFor } from '../utils/badge.js';
import { formatCost, formatDuration, num, pct } from '../utils/format.js';
import { loadRunPrefs, saveRunPrefs } from '../utils/run-prefs.js';

/** Colored engine badge (graphify cyan / crg indigo) or a gray OFF. */
function _engineBadge(value, kind) {
  if (!value) {
    return html`<span class="engine-badge engine-badge--off">OFF</span>`;
  }
  return html`<span class="engine-badge engine-badge--${kind}">${value}</span>`;
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

/** Read the raw control values from the `.run-options` container. */
function _readControls(box) {
  return {
    reps: box.querySelector('.run-opt-reps').value.trim(),
    maxInstances: box.querySelector('.run-opt-instances').value.trim(),
    maxParallel: box.querySelector('.run-opt-parallel').value.trim(),
    canary: box.querySelector('.run-opt-canary')?.value ?? 'on',
    graphify: box.querySelector('.run-opt-graphify')?.value ?? 'off',
    codeReviewGraph: box.querySelector('.run-opt-crg')?.value ?? 'off',
  };
}

/**
 * "Run options" launcher: per-run overrides for reps, caps, parallelism, the
 * canary preflight, and the engine modes. Reads control values at click time
 * (lit-html is stateless) from the enclosing `.run-options` container, and
 * persists them per-profile to localStorage so a page reload restores the last
 * set values instead of snapping back to the profile defaults.
 */
function _runOptionsView(agg, onRun) {
  const saved = loadRunPrefs(agg.name);
  const persist = (e) => {
    const box = e.target.closest('.run-options');
    if (box) saveRunPrefs(agg.name, _readControls(box));
  };
  const launch = (e) => {
    const box = e.target.closest('.run-options');
    const c = _readControls(box);
    saveRunPrefs(agg.name, c);
    const graphify = c.graphify !== 'off' ? c.graphify : undefined;
    const codeReviewGraph =
      c.codeReviewGraph !== 'off' ? c.codeReviewGraph : undefined;
    onRun(agg.name, {
      reps: c.reps ? Number.parseInt(c.reps, 10) : undefined,
      maxInstances: c.maxInstances
        ? Number.parseInt(c.maxInstances, 10)
        : undefined,
      maxParallel: c.maxParallel
        ? Number.parseInt(c.maxParallel, 10)
        : undefined,
      canary: c.canary !== 'off',
      graphify,
      codeReviewGraph,
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
          .value=${saved.reps ?? ''}
          @input=${persist}
      /></label>
      <label class="run-opt"
        >Max tests
        <input
          class="run-opt-instances"
          type="number"
          min="1"
          placeholder="all"
          .value=${saved.maxInstances ?? ''}
          @input=${persist}
      /></label>
      <label class="run-opt"
        >Max parallel
        <input
          class="run-opt-parallel"
          type="number"
          min="1"
          placeholder="default"
          .value=${saved.maxParallel ?? ''}
          @input=${persist}
      /></label>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Canary</span>
        <sl-radio-group
          class="run-opt-canary"
          size="small"
          value=${saved.canary || 'on'}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="on">On</sl-radio-button>
        </sl-radio-group>
      </div>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Graphify</span>
        <sl-radio-group
          class="run-opt-graphify"
          size="small"
          value=${saved.graphify || 'off'}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="structural">Structural</sl-radio-button>
          <sl-radio-button value="full">Full</sl-radio-button>
        </sl-radio-group>
      </div>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Code Review Graph</span>
        <sl-radio-group
          class="run-opt-crg"
          size="small"
          value=${saved.codeReviewGraph || 'off'}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="structural">Structural</sl-radio-button>
        </sl-radio-group>
      </div>
      <button class="action-btn action-btn--primary run-opt-launch" @click=${launch}>
        Run
      </button>
    </div>
  `;
}

const _STAGE_CLASS = {
  completed: 'stage-chip--done',
  in_progress: 'stage-chip--active',
  failed: 'stage-chip--failed',
  error: 'stage-chip--failed',
};

function _phaseLabel(run) {
  if (run.kind === 'canary') return 'Canary';
  if (run.phase === 'grading') return 'Grading';
  if (run.phase === 'failed') return 'Failed';
  return 'Running';
}

function _elapsedSince(iso) {
  if (!iso) return null;
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return null;
  return formatDuration(Math.max(0, Math.round((Date.now() - start) / 1000)));
}

/**
 * Live progress for in-flight reps (read from worca status.json under work/).
 * Renders nothing when there are no active runs. The dashboard's auto-refresh
 * keeps the phase/stage chips and elapsed time current.
 */
function _liveView(active) {
  if (!active || active.length === 0) return '';
  return html`
    <div class="live-runs">
      ${active.map((run) => {
        const meta = [
          run.instance,
          run.rep != null ? `rep ${run.rep}` : null,
          _elapsedSince(run.started_at),
        ]
          .filter(Boolean)
          .join(' · ');
        const grading = run.phase === 'grading';
        return html`
          <div class="live-run ${run.phase === 'failed' ? 'live-run--failed' : ''}">
            <div class="live-run-head">
              <span class="running-dot"></span>
              <span class="live-run-label">${_phaseLabel(run)}</span>
              ${
                run.stage && !grading
                  ? html`<span class="live-run-stage">${run.stage}</span>`
                  : nothing
              }
              ${meta ? html`<span class="live-run-meta">${meta}</span>` : nothing}
            </div>
            <div class="stage-chips">
              ${(run.stages || []).map((s) => {
                const cls = s.skipped
                  ? 'stage-chip--skipped'
                  : _STAGE_CLASS[s.status] || 'stage-chip--pending';
                const title = [s.agent, s.model].filter(Boolean).join(' · ');
                return html`<span
                  class="stage-chip ${cls}"
                  title=${title || s.status}
                  >${s.name}</span
                >`;
              })}
              <!-- Grading is a worca-bench step after the pipeline, not a worca stage. -->
              <span
                class="stage-chip ${grading ? 'stage-chip--active' : 'stage-chip--done'}"
                title="benchmark grading"
                >grade</span
              >
            </div>
          </div>
        `;
      })}
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
  // No explicit instance_ids selection → the benchmark runs its full set ("All").
  const instances =
    typeof agg.instance_count === 'number' ? String(agg.instance_count) : 'All';
  const items = [
    ['Worca', worca],
    ['Template', agg.template || '—'],
    ['Benchmark', agg.benchmark || '—'],
    ['Grade', agg.grade_mode || '—'],
    ['Test Count', instances],
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

  return html`
    <section class="page">
      ${_liveView(data.active)}
      ${onRun ? _runOptionsView(agg, onRun) : ''}
      ${_configView(agg)}
      <div class="stat-grid">
        ${_statRow('Benchmark', agg.benchmark || 'N/A')}
        ${_statRow('Reps', String(agg.reps))}
        ${_statRow('Resolved rate', pct(agg.resolved_rate))}
        ${_statRow('Avg score', typeof agg.mean_score === 'number' ? num(agg.mean_score, 2) : 'N/A')}
        ${_statRow('Avg cost', formatCost(agg.mean_cost_usd) || 'N/A')}
        ${_statRow('Avg duration', formatDuration(agg.mean_wall_s))}
        ${_statRow('Avg iterations', num(agg.mean_iterations, 2))}
      </div>

      <table class="reps-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Rep</th>
            <th>Status</th>
            <th>Score</th>
            <th>Cost</th>
            <th>Duration</th>
            <th>Iters</th>
            <th>Graphify</th>
            <th>CRG</th>
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
                <td>${_engineBadge(r.graphify, 'graphify')}</td>
                <td>${_engineBadge(r.code_review_graph, 'crg')}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}
