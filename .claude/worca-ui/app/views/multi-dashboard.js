/**
 * Multi-pipeline dashboard — card grid showing parallel pipelines
 * for the current project. Each card shows status, stage progress,
 * elapsed time, and quick actions (pause/stop).
 */

import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { Clock, iconSvg, Pause, Play, Square } from '../utils/icons.js';

const STAGES = ['plan', 'coordinate', 'implement', 'test', 'review'];

function stageDots(currentStage) {
  const idx = STAGES.indexOf(String(currentStage || '').toLowerCase());
  return STAGES.map(
    (s, i) => html`
      <span
        class="stage-dot ${i < idx ? 'completed' : i === idx ? 'active' : ''}"
        title=${s}
      ></span>
    `,
  );
}

function elapsedTime(startedAt) {
  if (!startedAt) return '';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function pipelineStatusClass(status) {
  switch (status) {
    case 'running':
      return 'pipeline-running';
    case 'succeeded':
      return 'pipeline-succeeded';
    case 'failed':
      return 'pipeline-failed';
    case 'paused':
      return 'pipeline-paused';
    default:
      return 'pipeline-unknown';
  }
}

export function pipelineCardView(
  pipeline,
  { onPause, onStop, onResume, onClick } = {},
) {
  const status = pipeline.status;
  return html`
    <div
      class="pipeline-card ${pipelineStatusClass(status)}"
      @click=${() => onClick?.(pipeline.run_id)}
    >
      <div class="pipeline-card-header">
        <span class="pipeline-title"
          >${(pipeline.title || pipeline.run_id || '').slice(0, 60)}</span
        >
        <span class="pipeline-status-badge pipeline-badge-${status}"
          >${status}</span
        >
      </div>
      <div class="pipeline-card-progress">
        ${stageDots(pipeline.stage)}
        ${pipeline.stage
          ? html`<span class="pipeline-stage-label">${pipeline.stage}</span>`
          : nothing}
      </div>
      <div class="pipeline-card-footer">
        <span class="pipeline-elapsed">
          ${unsafeHTML(iconSvg(Clock, 12))} ${elapsedTime(pipeline.started_at)}
        </span>
        <span class="pipeline-run-id">${pipeline.run_id || ''}</span>
        ${status === 'running'
          ? html`
              <span
                class="pipeline-actions"
                @click=${(e) => e.stopPropagation()}
              >
                <button
                  class="pipeline-action-btn"
                  title="Pause"
                  @click=${() => onPause?.(pipeline.run_id)}
                >
                  ${unsafeHTML(iconSvg(Pause, 14))}
                </button>
                <button
                  class="pipeline-action-btn"
                  title="Stop"
                  @click=${() => onStop?.(pipeline.run_id)}
                >
                  ${unsafeHTML(iconSvg(Square, 14))}
                </button>
              </span>
            `
          : status === 'paused'
            ? html`
                <span
                  class="pipeline-actions"
                  @click=${(e) => e.stopPropagation()}
                >
                  <button
                    class="pipeline-action-btn"
                    title="Resume"
                    @click=${() => onResume?.(pipeline.run_id)}
                  >
                    ${unsafeHTML(iconSvg(Play, 14))}
                  </button>
                </span>
              `
            : nothing}
      </div>
    </div>
  `;
}

export function multiPipelineDashboardView(
  pipelines,
  { onPause, onStop, onResume, onClick } = {},
) {
  const entries = Object.values(pipelines || {});
  if (entries.length === 0) return nothing;

  const running = entries.filter((p) => p.status === 'running');
  const paused = entries.filter((p) => p.status === 'paused');
  const completed = entries.filter((p) => p.status !== 'running' && p.status !== 'paused');
  const cardOpts = { onPause, onStop, onResume, onClick };

  return html`
    <div class="multi-pipeline-section">
      <h3 class="dashboard-section-title">Parallel Pipelines</h3>
      ${running.length > 0 || paused.length > 0
        ? html`
            <div class="pipeline-grid">
              ${running.map((p) => pipelineCardView(p, cardOpts))}
              ${paused.map((p) => pipelineCardView(p, cardOpts))}
            </div>
          `
        : nothing}
      ${completed.length > 0
        ? html`
            <sl-details summary="Completed (${completed.length})">
              <div class="pipeline-grid">
                ${completed.map((p) => pipelineCardView(p, cardOpts))}
              </div>
            </sl-details>
          `
        : nothing}
    </div>
  `;
}
