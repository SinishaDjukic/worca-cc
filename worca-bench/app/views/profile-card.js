import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import {
  outcomeClass,
  outcomeIcon,
  profileOutcome,
  variantFor,
} from '../utils/badge.js';
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  num,
  pct,
} from '../utils/format.js';

/**
 * One card per benchmark profile. Follows the worca-ui 4-section card layout:
 * top (status pip + name + outcome badge) -> meta (benchmark/ref/template) ->
 * stages (resolved-rate + cost/time/iteration badges) -> actions (View / Run).
 *
 * @param {object} agg  aggregate summary from the /api/profiles endpoint
 * @param {object} [handlers]
 * @param {(name: string) => void} [handlers.onOpen]
 * @param {(name: string) => void} [handlers.onRun]
 * @param {Set<string>} [handlers.selected]  names currently selected to compare
 * @param {(name: string) => void} [handlers.onToggleSelect]
 */
/** Compact active-state label for the card badge. */
function _activeLabel(agg) {
  if (agg.active_kind === 'canary') return 'canary';
  if (agg.phase === 'grading') return 'grading';
  return agg.stage ? `running · ${agg.stage}` : 'running';
}

export function profileCardView(
  agg,
  { onOpen, onRun, selected, onToggleSelect, showSource } = {},
) {
  const outcome = profileOutcome(agg);
  const variant = variantFor(outcome);
  const cost = formatCost(agg.mean_cost_usd);
  const selKey = `${agg.name}@${agg.src}`;
  const isSelected = selected?.has(selKey) ?? false;

  return html`
    <div
      class="run-card ${outcomeClass(outcome)} ${isSelected ? 'run-card--selected' : ''} ${agg.archived ? 'run-card--archived' : ''}"
      @click=${onOpen ? () => onOpen(agg) : null}
    >
      <div class="run-card-top">
        ${
          onToggleSelect
            ? html`<input
                class="run-card-select"
                type="checkbox"
                aria-label=${`Select ${agg.name} to compare`}
                .checked=${isSelected}
                @click=${(e) => e.stopPropagation()}
                @change=${(e) => {
                  e.stopPropagation();
                  onToggleSelect(agg);
                }}
              />`
            : nothing
        }
        <span class="run-card-status">${unsafeHTML(outcomeIcon(outcome, 16))}</span>
        <span class="run-card-title">${agg.name}</span>
        ${
          agg.active
            ? html`<sl-badge variant="primary" pill class="run-card-running"
                ><span class="running-dot"></span>${_activeLabel(agg)}</sl-badge
              >`
            : html`<sl-badge variant="${variant}" pill class="status-badge-${outcome}">${outcome}</sl-badge>`
        }
      </div>

      <div class="run-card-meta">
        ${
          agg.benchmark
            ? html`<span class="run-card-meta-item"><span class="meta-label">Benchmark:</span> <span class="meta-value">${agg.benchmark}</span></span>`
            : nothing
        }
        ${
          agg.template
            ? html`<span class="run-card-meta-item"><span class="meta-label">Template:</span> <span class="meta-value">${agg.template}</span></span>`
            : nothing
        }
        ${
          showSource && agg.source_label
            ? html`<span class="run-card-meta-item"><span class="meta-label">Source:</span> <span class="meta-value">${agg.source_label}</span></span>`
            : nothing
        }
      </div>

      <div class="run-card-meta">
        <span class="run-card-meta-item"><span class="meta-label">Tests:</span> <span class="meta-value">${agg.instance_count ?? 'all'}</span></span>
        <span class="run-card-meta-item"><span class="meta-label">Runs:</span> <span class="meta-value">${agg.reps}</span></span>
        <span class="run-card-meta-item"><span class="meta-label">Last run:</span> <span class="meta-value">${formatTimestamp(agg.last_run)}</span></span>
      </div>

      <div class="run-card-stages">
        <sl-badge variant="${variant}" pill class="run-card-stage-badge">Resolved ${pct(agg.resolved_rate)}</sl-badge>
        ${
          cost
            ? html`<sl-badge variant="neutral" pill class="run-card-stage-badge">${cost} avg</sl-badge>`
            : nothing
        }
        ${
          agg.mean_wall_s !== null && agg.mean_wall_s !== undefined
            ? html`<sl-badge variant="neutral" pill class="run-card-stage-badge">${formatDuration(agg.mean_wall_s)} avg</sl-badge>`
            : nothing
        }
        ${
          agg.mean_iterations !== null && agg.mean_iterations !== undefined
            ? html`<sl-badge variant="neutral" pill class="run-card-stage-badge">${num(agg.mean_iterations, 1)} iters</sl-badge>`
            : nothing
        }
      </div>

      <div class="run-card-actions">
        ${
          onRun
            ? html`<button class="action-btn action-btn--primary" @click=${(
                e,
              ) => {
                e.stopPropagation();
                onRun(agg.name);
              }}>Run</button>`
            : nothing
        }
      </div>
    </div>
  `;
}
