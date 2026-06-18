import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { outcomeOf, variantFor } from '../utils/badge.js';
import { formatCost, formatDuration, num, pct } from '../utils/format.js';
import { REGRADE_MODES } from '../utils/regrade-dialog.js';
import { loadRunPrefs, saveRunPrefs } from '../utils/run-prefs.js';
import { sortStagesByOrder, stageLabel } from '../utils/stages.js';

// Grader backends offered in the Run options dropdown, per benchmark. Reuses the
// regrade backends (local-docker / sb-cli / modal) plus `stub` (record diff, no
// grade). Commit0 has no hosted (`sb-cli`) backend — it grades via `commit0 test`
// on local Docker or Modal — so that option is dropped for commit0 profiles.
function graderOptions(benchmark) {
  const base = REGRADE_MODES.filter(
    (m) => benchmark !== 'commit0' || m.value !== 'sb-cli',
  ).map((m) => ({ value: m.value, label: m.label }));
  return [...base, { value: 'stub', label: 'Stub (no grade)' }];
}

// Lucide "refresh-cw" — the regrade action icon.
const REGRADE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

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
    preflight: box.querySelector('.run-opt-preflight')?.value ?? 'on',
    claudeMd: box.querySelector('.run-opt-claudemd')?.value ?? 'project',
    grader: box.querySelector('.run-opt-grader')?.value ?? '',
    timeout: box.querySelector('.run-opt-timeout')?.value.trim() ?? '',
  };
}

/**
 * "Run options" launcher: per-run overrides for reps, caps, parallelism, the
 * canary preflight, and the engine modes. Reads control values at click time
 * (lit-html is stateless) from the enclosing `.run-options` container, and
 * persists them per-profile to localStorage so a page reload restores the last
 * set values instead of snapping back to the profile defaults.
 */
function _runOptionsView(agg, onRun, onNotes, runDisabled = false) {
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
      preflight: c.preflight !== 'off',
      claudeMdMode: c.claudeMd,
      gradeMode: c.grader || undefined,
      // Empty => no override (use the profile's timeout). A number (incl. 0,
      // which means no limit) is sent through as an explicit per-run override.
      timeout: c.timeout === '' ? undefined : Number.parseInt(c.timeout, 10),
    });
  };
  // Grader options depend on the benchmark (commit0 has no sb-cli backend).
  const graderOpts = graderOptions(agg.benchmark);
  // Grader dropdown defaults to the profile's own grade.mode (falling back to
  // modal), unless the user has picked one before (persisted per profile). If the
  // resolved default isn't valid for this benchmark, fall back to the first option.
  let grader = saved.grader || agg.grade_mode || 'modal';
  if (!graderOpts.some((m) => m.value === grader)) grader = graderOpts[0].value;
  // Canary radio default: the user's saved pref wins; otherwise the profile's
  // `canary` flag (only an explicit `false` means Off — unspecified => On).
  const canaryDefault = saved.canary || (agg.canary === false ? 'off' : 'on');
  // Max-parallel placeholder shows the profile's own concurrency.worca when set,
  // so the field reflects what the run will actually use (else the runner default).
  const maxParallelPlaceholder =
    agg.max_parallel != null ? String(agg.max_parallel) : 'default';
  // Timeout field prefills with the profile's own timeout (seconds) when defined,
  // else an empty placeholder. Empty = use the profile; 0 = no limit.
  const timeoutPlaceholder = agg.timeout != null ? String(agg.timeout) : '';
  return html`
    <div class="run-options">
      <div class="run-options-title">Run options</div>
      <div class="run-options-row">
      <label class="run-opt"
        ><sl-tooltip
          content="How many times each instance is run. Total runs = instances × this. Empty = use the profile's value."
          ><span class="run-opt-label-inline">Reps / instance</span></sl-tooltip
        >
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
          placeholder=${maxParallelPlaceholder}
          .value=${saved.maxParallel ?? ''}
          @input=${persist}
      /></label>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Canary</span>
        <sl-radio-group
          class="run-opt-canary"
          size="small"
          value=${canaryDefault}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="on">On</sl-radio-button>
        </sl-radio-group>
      </div>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Preflight</span>
        <sl-radio-group
          class="run-opt-preflight"
          size="small"
          value=${saved.preflight || agg.preflight || 'on'}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="on">On</sl-radio-button>
        </sl-radio-group>
      </div>
      <label class="run-opt"
        >CLAUDE.md
        <select
          class="run-opt-claudemd run-opt-select"
          .value=${saved.claudeMd || 'project'}
          @change=${persist}
        >
          <option value="none">none</option>
          <option value="project">project</option>
          <option value="project+local">project+local</option>
          <option value="all">all</option>
        </select>
      </label>
      <label class="run-opt"
        >Grader
        <select class="run-opt-grader run-opt-select" @change=${persist}>
          ${graderOpts.map(
            (m) => html`<option
              value=${m.value}
              ?selected=${m.value === grader}
            >${m.label}</option>`,
          )}
        </select>
      </label>
      <div class="run-opt run-opt-engine">
        <span class="run-opt-label">Graphify</span>
        <sl-radio-group
          class="run-opt-graphify"
          size="small"
          value=${saved.graphify || agg.graphify || 'off'}
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
          value=${saved.codeReviewGraph || agg.code_review_graph || 'off'}
          @sl-change=${persist}
        >
          <sl-radio-button value="off">Off</sl-radio-button>
          <sl-radio-button value="structural">Structural</sl-radio-button>
        </sl-radio-group>
      </div>
      </div>
      <div class="run-options-row">
      <label class="run-opt"
        ><sl-tooltip
          content="Max build seconds per instance. Empty = use the profile's value; 0 = no limit; otherwise the cap in seconds."
          ><span class="run-opt-label-inline">Timeout (s)</span></sl-tooltip
        >
        <input
          class="run-opt-timeout"
          type="number"
          min="0"
          placeholder=${timeoutPlaceholder}
          .value=${saved.timeout ?? ''}
          @input=${persist}
      /></label>
      ${
        onNotes
          ? html`<button
              class="action-btn run-opt-notes"
              @click=${() => onNotes(agg.name)}
            >Notes</button>`
          : ''
      }
      <button
        class="action-btn action-btn--primary run-opt-launch"
        ?disabled=${runDisabled}
        title=${runDisabled ? 'A run is already in progress for this profile' : 'Launch a run'}
        @click=${runDisabled ? () => {} : launch}
      >
        ${runDisabled ? 'Running…' : 'Run'}
      </button>
      </div>
    </div>
  `;
}

/** Compact UTC timestamp: "2026-06-17 06:12 UTC" (guarded). */
function _fmtTs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/**
 * Score cell: the numeric score, plus the fine-grained test count when the
 * grader ran a real suite (Commit0 held-out tests, e.g. "38/38"). Counts are
 * null for pass/fail-only graders (SWE-bench, stub), which show score alone.
 */
function _scoreCell(r) {
  if (typeof r.score !== 'number') return '—';
  const score = num(r.score, 2);
  if (typeof r.tests_passed === 'number' && typeof r.tests_total === 'number') {
    return html`${score}
      <span class="reps-testcount" title="held-out tests passed / total"
        >${r.tests_passed}/${r.tests_total}</span
      >`;
  }
  return score;
}

/** One-line grading-provenance string for the status-badge tooltip. */
function _gradeTooltip(r) {
  const env = r.grade_mode ? ` via ${r.grade_mode}` : '';
  const parts = [];
  if (r.status === 'graded') {
    parts.push(`${r.resolved ? 'resolved' : 'unresolved'}${env}`);
    if (
      typeof r.tests_passed === 'number' &&
      typeof r.tests_total === 'number'
    ) {
      parts.push(`${r.tests_passed}/${r.tests_total} tests`);
    }
    if (typeof r.score === 'number') parts.push(`score ${num(r.score, 2)}`);
  } else if (r.status === 'error') {
    parts.push(`error${env}`);
    if (r.error || r.grade_detail) {
      parts.push(String(r.error || r.grade_detail).slice(0, 160));
    }
  } else {
    parts.push(`${r.status}${env}`);
  }
  const ts = r.regraded_at || r.graded_at || r.completed_at;
  if (ts) parts.push(`${r.regraded_at ? 'regraded' : 'graded'} ${_fmtTs(ts)}`);
  if (r.report_path) parts.push(`report: ${r.report_path}`);
  return parts.join(' · ');
}

/** Rough "time left" for a running sweep from elapsed ÷ done × remaining. */
function _regradeEta(rg) {
  if (!rg?.started_at || !rg.done || !rg.total) return null;
  const start = Date.parse(rg.started_at);
  if (Number.isNaN(start) || rg.done <= 0) return null;
  const per = (Date.now() - start) / 1000 / rg.done;
  return formatDuration(Math.round(per * Math.max(0, rg.total - rg.done)));
}

/**
 * Live regrade-sweep progress (from the heartbeat the runner writes). Renders
 * nothing unless a sweep is active. The dashboard auto-refresh keeps it current.
 */
function _regradeProgressView(rg) {
  if (!rg || !rg.active) return '';
  const total = rg.total || 0;
  const done = rg.done || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const c = rg.counts || {};
  const eta = _regradeEta(rg);
  return html`
    <div class="regrade-progress">
      <div class="regrade-progress-head">
        <span class="running-dot"></span>
        <span class="regrade-progress-label"
          >Regrading ${done}/${total} via ${rg.mode || '—'}</span
        >
        ${
          rg.current
            ? html`<span class="regrade-progress-current">${rg.current}</span>`
            : nothing
        }
        ${
          eta
            ? html`<span class="regrade-progress-eta">~${eta} left</span>`
            : nothing
        }
      </div>
      <div class="regrade-progress-bar">
        <div class="regrade-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="regrade-progress-counts">
        ${c.resolved ?? 0} resolved · ${c.graded ?? 0} graded · ${c.error ?? 0} error
      </div>
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
        // The instance (test) name is the run's primary identifier, so it sits
        // prominently next to the status. The active pipeline stage is already
        // highlighted in the stage-chips row below, so we don't repeat it here.
        const meta = [
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
                run.instance
                  ? html`<span class="live-run-instance">${run.instance}</span>`
                  : nothing
              }
              ${meta ? html`<span class="live-run-meta">${meta}</span>` : nothing}
            </div>
            <div class="stage-chips">
              ${sortStagesByOrder(run.stages).map((s) => {
                const cls = s.skipped
                  ? 'stage-chip--skipped'
                  : _STAGE_CLASS[s.status] || 'stage-chip--pending';
                const title = [s.agent, s.model].filter(Boolean).join(' · ');
                // Bead progress (completed/dispatched) rides inside the chip for
                // the implementer, e.g. "Implement 1/3"; the loop-back count is
                // appended as "×N" when a stage ran more than once.
                const beads = s.beads
                  ? html`<span class="stage-chip-beads"
                      >${s.beads.done}/${s.beads.total}</span
                    >`
                  : nothing;
                const iters = s.iters
                  ? html`<span class="stage-chip-iters">×${s.iters}</span>`
                  : nothing;
                return html`<span
                  class="stage-chip ${cls}"
                  title=${title || s.status}
                  >${stageLabel(s.name)}${beads}${iters}</span
                >`;
              })}
              <!-- Grading is a worca-bench step AFTER the pipeline, not a worca
                   stage — set it apart with a spacer. While the run is live it's
                   either pending (grey) or, once the pipeline finishes, active
                   (blue, phase=grading); a finished "done" grade only shows in
                   the per-rep table, not here. -->
              <span class="stage-chip-sep" aria-hidden="true"></span>
              <span
                class="stage-chip ${grading ? 'stage-chip--active' : 'stage-chip--pending'}"
                title="benchmark grading (not a pipeline stage)"
                >Grade</span
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
export function profileDetailView(
  data,
  { onRun, onRegrade, onNotes, runDisabled = false } = {},
) {
  if (!data?.aggregate) {
    return html`<section class="page"><p class="empty-state">Profile not found.</p></section>`;
  }
  const agg = data.aggregate;
  const reps = data.reps || [];
  // True planned reps-per-instance = the highest rep index across rows (NOT
  // agg.reps, which is the total row count). Only used to annotate "Rep #".
  const repsPlanned = reps.reduce((m, r) => Math.max(m, r.rep || 0), 0);

  const regrade = data.regrade;
  const grading = regrade?.active ? regrade.current : null;

  return html`
    <section class="page">
      ${_liveView(data.active)}
      ${_regradeProgressView(regrade)}
      ${onRun ? _runOptionsView(agg, onRun, onNotes, runDisabled) : ''}
      ${_configView(agg)}
      <div class="stat-grid">
        ${_statRow('Benchmark', agg.benchmark || 'N/A')}
        ${_statRow('Runs', String(agg.reps))}
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
            <th>Rep #</th>
            <th>Status</th>
            <th>Score</th>
            <th>Cost</th>
            <th>Duration</th>
            <th>Iters</th>
            <th>Graphify</th>
            <th>CRG</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${reps.map((r) => {
            const ro = outcomeOf(r);
            const isGrading = grading && r.instance_id === grading;
            return html`
              <tr class=${isGrading ? 'reps-row--grading' : nothing}>
                <td class="reps-instance" title=${r.instance_id || ''}>${r.instance_id || '—'}</td>
                <td>${r.rep ? (repsPlanned > 1 ? `${r.rep} / ${repsPlanned}` : r.rep) : '—'}</td>
                <td>
                  <sl-tooltip content=${_gradeTooltip(r)}>
                    <sl-badge variant="${variantFor(ro)}" pill>${ro}</sl-badge>
                  </sl-tooltip>
                </td>
                <td>${_scoreCell(r)}</td>
                <td>${formatCost(r.cost_usd) || '—'}</td>
                <td>${typeof r.wall_time_s === 'number' ? formatDuration(r.wall_time_s) : '—'}</td>
                <td>${_iterations(r)}</td>
                <td>${_engineBadge(r.graphify, 'graphify')}</td>
                <td>${_engineBadge(r.code_review_graph, 'crg')}</td>
                <td class="reps-action">
                  ${
                    onRegrade && r.instance_id
                      ? html`<sl-tooltip
                          content="Re-grade this instance from its saved diff — pick the backend (local Docker / SWE-bench cloud / Modal). No pipeline re-run."
                        >
                          <button
                            class="icon-btn reps-regrade-btn"
                            aria-label="Re-grade ${r.instance_id}"
                            @click=${() => onRegrade(agg.name, r.instance_id)}
                          >
                            ${unsafeHTML(REGRADE_ICON)}
                          </button>
                        </sl-tooltip>`
                      : nothing
                  }
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}
